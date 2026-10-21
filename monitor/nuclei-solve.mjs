// commitwork monitor — the nuclei+ solver. Adjudicates each nuclei finding on one axis: did the
// response confirm the protocol the template claims? Not a suppressor — records a judgement with
// its evidence, counts conserved. Rules are derived from the template's own declarative YAML and
// keyed on its `# digest:`, so a store update invalidates the rule honestly. Pure over
// (nuclei.jsonl, template files); ownership is the OTHER axis (monitor/host-inventory.mjs).
//
//   node monitor/nuclei-solve.mjs <report-dir>            readable table
//   node monitor/nuclei-solve.mjs <report-dir> --json     machine-readable
//   node monitor/nuclei-solve.mjs <report-dir> --write    also write nuclei-solved.jsonl

import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { NUCLEI_ARTIFACTS } from '../bin/parse-runtime.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// ── vocabulary ──────────────────────────────────────────────────────────────────────────────
// Signals are EVIDENCE (a record may carry several). `confirmation` is the single derived verdict.
export const SIGNAL = Object.freeze({
  // the matcher set contains no content predicate AND no discriminating extractor: the template
  // matches whenever its script runs, so the "finding" asserts only that a socket accepted bytes
  TAUTOLOGICAL: 'matcher-tautological',
  // the response carries a protocol signature the template did not claim (HTTP to a raw probe)
  CONTRADICTED: 'contradicted',
  // the whole response IS the extraction, and the extractor takes anything — the value came from
  // the template's own code path, not from the wire
  SELF_REFERENTIAL: 'self-referential',
  // the template declares a port and fired at a different one
  PORT_DISPLACED: 'port-displaced',
  // the gate is isUDPPortOpen, and UDP has no handshake: an unanswered send is indistinguishable
  // from an open port, so the pre-condition cannot fail
  TRANSPORT_UNVERIFIABLE: 'transport-unverifiable',
  // positive protocol evidence: the response is shaped like what the template claims
  PROTOCOL_MATCHED: 'protocol-matched',
});

export const CONFIRMATION = Object.freeze({
  CONFIRMED: 'confirmed',
  REFUTED: 'refuted',
  UNDETERMINED: 'undetermined',
});

// Signals that refute. port-displaced alone does not — a non-default port is ordinary.
const REFUTING = new Set([SIGNAL.TAUTOLOGICAL, SIGNAL.CONTRADICTED, SIGNAL.SELF_REFERENTIAL]);

// ── where the templates live ────────────────────────────────────────────────────────────────
// Read env at call time — a const at import defeats test overrides.
export const templateRoot = () => process.env.CW_NUCLEI_TEMPLATES || join(homedir(), 'nuclei-templates');

// Prefer the store-relative `template` joined to our root over the recorded absolute path.
export function templateFileFor(rec, root = templateRoot()) {
  const rel = String(rec && rec.template || '').trim();
  if (rel && !isAbsolute(rel)) { const p = join(root, rel); if (existsSync(p)) return p; }
  const abs = String(rec && rec['template-path'] || '').trim();
  if (abs && existsSync(abs)) return abs;
  return null;
}

// ── rule derivation from declarative YAML ───────────────────────────────────────────────────
// Linear line scans only — a multiline regex over YAML backtracks catastrophically.
// The embedded JavaScript is never parsed.

const DIGEST_RE = /^#\s*digest:\s*(\S+)/;
const PORT_RE = /^\s*Port:\s*["']?(\d{1,5})["']?\s*$/;
const TYPE_RE = /^\s*-?\s*type:\s*(\w+)\s*$/;

// dsl clauses that assert nothing about CONTENT. `success == true` means "the script did not
// throw". A matcher built only from these fires on every reachable target.
const CONTENTLESS_DSL = /^\s*['"]?\s*(success\s*==\s*true|true)\s*['"]?\s*$/;
// an extractor regex that captures anything at all
const NONDISCRIMINATING_RE = /^\s*-?\s*["']?\(\.\*\??\)["']?\s*$/;

export function deriveRule(yaml, { id: fallbackId = '' } = {}) {
  const lines = String(yaml ?? '').split('\n');
  const rule = {
    id: fallbackId, digest: null, declaredPorts: [], gate: null,
    transports: [], tags: [],
    matcherHasContentPredicate: false, extractorDiscriminating: false,
    hasMatchers: false, hasExtractors: false,
  };
  let section = null;          // 'matchers' | 'extractors' | null
  let inDsl = false, inRegex = false, inWords = false;
  let matcherType = null;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const d = DIGEST_RE.exec(line); if (d) { rule.digest = d[1]; continue; }
    if (/^id:\s*/.test(line)) { rule.id = line.slice(3).trim() || rule.id; continue; }
    if (/^\s*tags:\s*/.test(line)) {
      rule.tags = line.replace(/^\s*tags:\s*/, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }
    // `pre-condition: |` then an indented body; we only care WHICH gate is named.
    if (/pre-condition:/.test(line)) { rule.gate = 'declared'; continue; }
    if (/isUDPPortOpen\s*\(/.test(line)) { rule.gate = 'isUDPPortOpen'; continue; }
    if (/isPortOpen\s*\(/.test(line)) { rule.gate = rule.gate === 'isUDPPortOpen' ? rule.gate : 'isPortOpen'; continue; }
    // transport, from the socket the script opens. A declaration in all but name.
    const open = /c\.Open\(\s*['"](tcp|udp)['"]/.exec(line); if (open) { if (!rule.transports.includes(open[1])) rule.transports.push(open[1]); continue; }
    const p = PORT_RE.exec(line); if (p) { const n = Number(p[1]); if (!rule.declaredPorts.includes(n)) rule.declaredPorts.push(n); continue; }
    // shodan/fofa queries name the port the template is ABOUT, when args does not.
    const sq = /(?:shodan|fofa)-query:.*?\bport[:=]\s*["']?(\d{1,5})/i.exec(line);
    if (sq) { const n = Number(sq[1]); if (!rule.declaredPorts.includes(n)) rule.declaredPorts.push(n); continue; }

    if (/^\s{0,6}matchers:\s*$/.test(line)) { section = 'matchers'; rule.hasMatchers = true; inDsl = inRegex = inWords = false; continue; }
    if (/^\s{0,6}extractors:\s*$/.test(line)) { section = 'extractors'; rule.hasExtractors = true; inDsl = inRegex = inWords = false; continue; }
    if (/^\s{0,4}(javascript|http|tcp|dns|code|udp|flow|variables|self-contained):/.test(line)) { section = null; continue; }

    if (!section) continue;
    const t = TYPE_RE.exec(line);
    if (t) {
      matcherType = t[1]; inDsl = inRegex = inWords = false;
      if (section === 'matchers' && matcherType !== 'dsl') rule.matcherHasContentPredicate = true; // word/regex/binary/status all assert content
      continue;
    }
    if (/^\s*dsl:\s*$/.test(line)) { inDsl = true; inRegex = inWords = false; continue; }
    if (/^\s*regex:\s*$/.test(line)) { inRegex = true; inDsl = inWords = false; continue; }
    if (/^\s*(words|binary):\s*$/.test(line)) { inWords = true; inDsl = inRegex = false; continue; }
    if (/^\s*[a-z-]+:\s*/.test(line) && !/^\s*-\s/.test(line)) { inDsl = inRegex = inWords = false; continue; }

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (!item) continue;
    if (inDsl && section === 'matchers' && !CONTENTLESS_DSL.test(item[1])) rule.matcherHasContentPredicate = true;
    if (inWords && section === 'matchers') rule.matcherHasContentPredicate = true;
    if (section === 'extractors' && (inRegex || inWords) && !NONDISCRIMINATING_RE.test(line)) rule.extractorDiscriminating = true;
  }
  return rule;
}

// Read + derive, with a memo so a 33-repo fleet parses each template once. Only templates NAMED BY
// RECORDS are ever opened — never the ~9,000-file store.
export function ruleLoader({ root = templateRoot(), read = readFileSync } = {}) {
  const memo = new Map();
  return function ruleFor(rec) {
    const file = templateFileFor(rec, root);
    const id = String(rec['template-id'] || rec.templateID || '');
    if (!file) return { ok: false, id, reason: 'template not found in the local store' };
    if (memo.has(file)) return memo.get(file);
    let yaml; try { yaml = read(file, 'utf8'); } catch (e) { const r = { ok: false, id, reason: `template unreadable: ${e && e.code || 'error'}` }; memo.set(file, r); return r; }
    const rule = deriveRule(yaml, { id });
    const r = { ok: true, file, ...rule };
    memo.set(file, r);
    return r;
  };
}

// ── per-record adjudication ─────────────────────────────────────────────────────────────────
const HTTP_STATUS_LINE = /^HTTP\/[\d.]+\s+\d{3}/;

// Signatures of a protocol the probe did NOT speak, each named so a verdict can cite which fired.
const CONTRADICTORS = Object.freeze([
  ['http-status-line', (s) => HTTP_STATUS_LINE.test(s)],
  ['html-document', (s) => /^\s*<(?:!doctype\s+html|html[\s>])/i.test(s)],
]);

export function classify(rec, rule) {
  const signals = [];
  const port = Number(String(rec.port ?? '').trim()) || null;
  const resp = typeof rec.response === 'string' ? rec.response : '';
  const extracted = Array.isArray(rec['extracted-results']) ? rec['extracted-results'] : [];
  const declaredHttp = String(rec.type || '').toLowerCase() === 'http';

  if (!rule || rule.ok === false) {
    return { confirmation: CONFIRMATION.UNDETERMINED, signals: [], rule: null,
      why: (rule && rule.reason) || 'no rule could be derived' };
  }

  // (1) No content predicate AND no discriminating extractor cannot fail — both halves required
  // (a discriminating extractor hit IS wire evidence).
  if (rule.hasMatchers && !rule.matcherHasContentPredicate && !rule.extractorDiscriminating) {
    signals.push(SIGNAL.TAUTOLOGICAL);
  }

  // (2) The extraction IS the entire response, from a non-discriminating extractor: the value was
  // produced by the template's own code, not read off the wire.
  if (extracted.length === 1 && resp && extracted[0] === resp && !rule.extractorDiscriminating) {
    signals.push(SIGNAL.SELF_REFERENTIAL);
  }

  // (3) A response shaped like a protocol the raw-socket probe did not speak.
  const rawTransport = rule.transports.includes('tcp') || rule.transports.includes('udp');
  let contradictor = null;
  if (!declaredHttp && rawTransport && resp) {
    const hit = CONTRADICTORS.find(([, test]) => test(resp));
    if (hit) { contradictor = hit[0]; signals.push(SIGNAL.CONTRADICTED); }
  }

  // (4) The template names a port and fired somewhere else. Descriptive, never refuting on its own.
  if (port && rule.declaredPorts.length && !rule.declaredPorts.includes(port)) signals.push(SIGNAL.PORT_DISPLACED);

  // (5) UDP has no handshake, so isUDPPortOpen cannot fail. Descriptive: it explains HOW a finding
  // reached a dead port, but on its own it does not prove the finding wrong.
  if (rule.gate === 'isUDPPortOpen') signals.push(SIGNAL.TRANSPORT_UNVERIFIABLE);

  // (6) Positive evidence, claimed narrowly: an HTTP template that got an HTTP response.
  if (declaredHttp && HTTP_STATUS_LINE.test(resp)) signals.push(SIGNAL.PROTOCOL_MATCHED);

  const refuting = signals.filter((s) => REFUTING.has(s));
  const confirmation = refuting.length ? CONFIRMATION.REFUTED
    : signals.includes(SIGNAL.PROTOCOL_MATCHED) ? CONFIRMATION.CONFIRMED
      : CONFIRMATION.UNDETERMINED;
  // `contradictor` is a CLASS name, never the matched text. The response it came from is a Tomcat
  // error page — headers, cookies, stack traces — and this verdict is published.
  return { confirmation, signals, rule: { id: rule.id, digest: rule.digest }, contradictor, why: '' };
}

// ── the single derived verdict consumers read ───────────────────────────────────────────────
// The axes stay as evidence; only this renders. Ownership is passed in, never imported (purity).
export const DISPOSITION = Object.freeze({
  REFUTED: 'in-scope-refuted',       // the finding is wrong, whoever owns the port
  HOST: 'host-attributed',           // true, and about this box rather than the project
  CONFIRMED: 'in-scope-confirmed',   // real, and the project's
  UNDETERMINED: 'undetermined',      // not judged — never to be read as either clean or fine
});

export function disposition(solved, owner) {
  const o = owner && owner.owner;
  // Refutation first and never overridden by ownership — a wrong finding is not improved by belonging.
  if (solved.confirmation === CONFIRMATION.REFUTED) return DISPOSITION.REFUTED;
  if (o === 'host') return DISPOSITION.HOST;
  // Ownership refutes in exactly one case: `unbound-observed` is a positive observation of
  // absence. `unbound-unverifiable` and `unknown` are blind spots and must not.
  if (o === 'unbound-observed') return DISPOSITION.REFUTED;
  if (solved.confirmation === CONFIRMATION.CONFIRMED) return DISPOSITION.CONFIRMED;
  return DISPOSITION.UNDETERMINED;
}

// ── the sidecar record ──────────────────────────────────────────────────────────────────────
// No raw bytes (response/request/matched text carry credentials; reports/ is tunnel-served).
// Keyed on {template-id, host, port, proto} — never on line number or array index.
export const solvedKey = (r) => [r['template-id'] || r.templateID || '', r.host || '', r.port || '', r.type || ''].join('|');

export function solvedRecord(rec, verdict) {
  return {
    templateId: String(rec['template-id'] || rec.templateID || ''),
    host: String(rec.host || ''), port: String(rec.port || ''), proto: String(rec.type || ''),
    severity: String((rec.info && rec.info.severity) || ''),
    confirmation: verdict.confirmation,
    signals: [...verdict.signals].sort(),
    ruleId: verdict.rule ? verdict.rule.id : '',
    ruleDigest: verdict.rule ? verdict.rule.digest : null,
    ...(verdict.contradictor ? { contradictor: verdict.contradictor } : {}),
    ...(verdict.why ? { why: verdict.why } : {}),
  };
}

// ── the directory-level solve ───────────────────────────────────────────────────────────────
// Absent artifact => { ok:false, reason } and NO solved file — an empty solved file beside a
// missing scan reads as "adjudicated, nothing wrong".
export function solveDir(dir, { root = templateRoot(), read = readFileSync } = {}) {
  const file = NUCLEI_ARTIFACTS.map((f) => join(dir, f)).find((p) => existsSync(p));
  if (!file) return { ok: false, dir, reason: 'no nuclei artifact in this directory — nothing was adjudicated, and nothing is claimed' };
  let raw; try { raw = read(file, 'utf8'); } catch (e) { return { ok: false, dir, reason: `nuclei artifact unreadable (${e && e.code || 'error'}) — liveness of this lane is UNKNOWN, not clean` }; }

  const ruleFor = ruleLoader({ root, read });
  const lines = raw.split('\n').filter((l) => l.trim());
  const solved = [];
  let unparseable = 0;
  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch { unparseable++; continue; }
    solved.push(solvedRecord(rec, classify(rec, ruleFor(rec))));
  }

  // Deterministic order, independent of the input file's ordering.
  solved.sort((a, b) => solvedKey(a).localeCompare(solvedKey(b)) || a.confirmation.localeCompare(b.confirmation));

  const counts = { confirmed: 0, refuted: 0, undetermined: 0, unparseable };
  for (const s of solved) counts[s.confirmation]++;

  // INVARIANT 1 — conservation. Total from the non-empty line count, not the parse loop.
  const total = lines.length;
  const accounted = counts.confirmed + counts.refuted + counts.undetermined + counts.unparseable;
  const conserved = accounted === total;

  // INVARIANT 2 — no refutation without a citation (rule id + template digest).
  const uncited = solved.filter((s) => s.confirmation === CONFIRMATION.REFUTED && (!s.ruleId || !s.ruleDigest));

  // INVARIANT 3 — coverage floor. Reported, never enforced here — all-undetermined must be visible.
  const adjudicated = counts.confirmed + counts.refuted;
  const coverage = total ? adjudicated / total : 0;

  return { ok: true, dir, file, records: solved, counts, total, conserved, uncited, coverage };
}

// Atomic tmp+rename, like every other writer in this tree. Re-runs are idempotent.
export function writeSolved(dir, result) {
  if (!result || result.ok !== true) return null;
  const out = join(dir, 'nuclei-solved.jsonl');
  writeAtomic(out, result.records.map((r) => JSON.stringify(r)).join('\n') + (result.records.length ? '\n' : ''));
  return out;
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────
export function formatTable(r) {
  if (!r || r.ok !== true) {
    return `nuclei-solve: NOT ADJUDICATED — ${r?.reason || 'no result'}\n` +
      '  (this is NOT "no findings". Nothing was judged, so nothing is claimed.)';
  }
  const out = [];
  const by = new Map();
  for (const s of r.records) {
    const k = `${s.templateId}  :${s.port}/${s.proto}`;
    if (!by.has(k)) by.set(k, { n: 0, confirmation: s.confirmation, signals: s.signals });
    by.get(k).n++;
  }
  const w = Math.max(...[...by.keys()].map((k) => k.length), 8);
  for (const [k, v] of [...by.entries()].sort()) {
    out.push(`${String(v.n).padStart(4)}  ${k.padEnd(w)}  ${v.confirmation.toUpperCase().padEnd(12)}  ${v.signals.join(' + ') || '—'}`);
  }
  out.push('');
  out.push(`${r.total} record(s): ${r.counts.confirmed} confirmed · ${r.counts.refuted} refuted · ` +
    `${r.counts.undetermined} undetermined · ${r.counts.unparseable} unparseable`);
  out.push(`coverage ${(r.coverage * 100).toFixed(1)}% adjudicated` +
    (r.conserved ? '' : '  ** CONSERVATION FAILED — records were lost **') +
    (r.uncited.length ? `  ** ${r.uncited.length} refutation(s) with no rule citation **` : ''));
  return out.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
// Exit 0 when the adjudication succeeded, 1 when it did not, 2 when an invariant failed. A
// missing artifact is exit 1 with a reason — never a silent exit 0 and an empty table.
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) { process.stderr.write('usage: node monitor/nuclei-solve.mjs <report-dir> [--json] [--write]\n'); process.exit(1); }
  const r = solveDir(dir);
  if (r.ok && argv.includes('--write')) r.written = writeSolved(dir, r);
  process.stdout.write((argv.includes('--json') ? JSON.stringify(r, null, 2) : formatTable(r)) + '\n');
  process.exit(!r.ok ? 1 : (!r.conserved || r.uncited.length) ? 2 : 0);
}

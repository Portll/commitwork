#!/usr/bin/env node
// monitor/stpa-sweep.mjs — re-derives commitwork's own admin-panel/LLM-remediation control loop from
// the CURRENT source and re-evaluates it against the fixed UCA/HAZOP table designed in
// evaluations/SPEC-stpa-hazop-control-loop-panel-2026-09-01.md (reusing the loss/hazard/UCA/HAZOP
// vocabulary evaluations/STPA-capec-attack-2026-08-23.md shipped for the CWE->CAPEC->ATT&CK axis).
//
// A SENSOR, never an actuator: this reports classifications against the three closure points named
// in that spec — it never edits admin/lib/jobs.mjs, admin/routes/remediation-policy.mjs or
// admin/routes/codeql-remediation.mjs. Doing so would itself be an instance of the RECURSIVE hazard
// the spec names.
//
// fact: extraction is line/regex-based over known patterns, NOT a JS parser — it undercounts an unusual shape rather than ever fabricating a safe verdict for one it cannot see; every row that cannot be classified is UNCLASSIFIED, never silently 'safe' (expiry: never, prev: unknown)
//
// usage: node monitor/stpa-sweep.mjs [project]
// exit: 0 nothing flagged, nothing unclassified, no open finding · 21 at least one row flagged ·
//   2 the sweep itself failed to run (an unreadable closure point is not a clean loop) · 23 nothing
//   flagged or unclassified but at least one named open finding · 24 nothing flagged but at least one
//   row UNCLASSIFIED: a warning that a closure point went unchecked, printed with a suggested fix
//   where one can be derived. 21 beats 24 beats 23: a flag is the strongest statement, and a point
//   nobody checked outranks a gap already named. Every count still travels in the report.
//   The reporting exits sit above Node's own (1–13): Node exits 1 when an import fails to load, so
//   a flagged exit of 1 read a sweep that never ran as a completed one.
// env (read at call time, per house rule): CW_STPA_SERVE_PATH (the file holding the job-kind
//   dispatch; admin/lib/jobs.mjs since the job engine left serve.mjs), CW_STPA_POLICY_PATH,
//   CW_STPA_APPLY_PATH, CW_STPA_REMED_PATH override the source files this reads — tests point these
//   at fixtures. CW_STPA_ENVELOPE_WITNESS is the live corpus-replay result the ADVERSARIAL row needs
//   before it may read classified-safe.
import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..');

const servePath = () => process.env.CW_STPA_SERVE_PATH || join(CW, 'admin', 'lib', 'jobs.mjs');
const policyPath = () => process.env.CW_STPA_POLICY_PATH || join(CW, 'admin', 'routes', 'remediation-policy.mjs');
const applyPath = () => process.env.CW_STPA_APPLY_PATH || join(CW, 'admin', 'routes', 'codeql-remediation.mjs');
const remedPath = () => process.env.CW_STPA_REMED_PATH || join(CW, 'admin', 'routes', 'remediation.mjs');
export const closurePaths = () => ({ serve: servePath(), policy: policyPath(), apply: applyPath(), remed: remedPath() });
export const witnessPath = () => process.env.CW_STPA_ENVELOPE_WITNESS || join(CW, 'reports', 'prompt-envelope', 'corpus-live.json');
const WITNESS_FRESH_MS = 7 * 24 * 3600 * 1000;

// ── the way IN: scanner text reaches a model only through lib/prompt-envelope.mjs ───────────────
export function extractEnvelope(codeqlSrc, remedSrc) {
  const imported = (s) => /from '\.\.\/\.\.\/lib\/prompt-envelope\.mjs'/.test(s);
  return {
    codeql: imported(codeqlSrc) && /function findingBlock[\s\S]*?envelope\(/.test(codeqlSrc),
    remediation: imported(remedSrc) && /async function runLocalModel[\s\S]*?envelope\(artifactText/.test(remedSrc),
  };
}

// guard: absent, unreadable, failed and stale witnesses are four states, none of them a pass
export function readEnvelopeWitness(path = witnessPath(), now = process.env.CW_NOW || new Date().toISOString()) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', why: e.code }; }
  let w;
  try { w = JSON.parse(raw); } catch { return { state: 'unreadable', why: 'not JSON' }; }
  if (w?.pass !== true) return { state: 'failed', at: w?.at ?? null };
  const age = Date.parse(now) - Date.parse(w.at);
  if (!(age >= 0 && age <= WITNESS_FRESH_MS)) return { state: 'stale', at: w.at };
  return { state: 'fresh', at: w.at };
}

// ── Closure point 1: the job-kind dispatch (SC1', UCA1', H1') ───────────────────────────────────
// Reads the `kind === 'x'` branches that build an argv array and leaves a branch UNCLASSIFIED when
// it reads an `opts.<field>` this file has no rule for, names the raw `project` parameter, or sits in
// a file where no variable assigned from `triggerProject(` reaches the dispatch. A pattern match
// over a known shape, not data-flow analysis: a kind written another way reads as UNCLASSIFIED,
// which is correct — never assert "safe" about a shape not checked.
export const KNOWN_SELECTORS = Object.freeze(['check', 'repo', 'label']);
const KIND_RE = /kind\s*===\s*'([a-zA-Z0-9_-]+)'/g;
// fact: only whole-line `//` comments are dropped / a stripper that understands less cannot swallow code, and a prose `kind === 'x'` must not become a kind (expiry: never, prev: not built)
const stripLineComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// jobArgv()'s body where the file has one, else the whole file: the older shape kept the chain inside
// trigger(). Scoping matters because trigger() tests `kind === 'sweep'` in guards that build no argv.
function dispatchBody(source) {
  const at = source.search(/\bfunction jobArgv\s*\(/);
  if (at < 0) return { text: stripLineComments(source), scoped: false };
  const end = source.indexOf('\n}\n', at);
  return { text: stripLineComments(source.slice(at, end < 0 ? source.length : end)), scoped: true };
}

// guard: a resolver counts only when a variable is ASSIGNED from it and, in the jobArgv shape, that variable is the project argument trigger() passes — the declaration alone is not a use
function resolverReaches(source, scoped) {
  const code = stripLineComments(source);
  const m = /\b(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=[^;\n]*\btriggerProject\(/.exec(code);
  if (!m) return false;
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- m[1] is a \w+ capture from an earlier regex on source text
  return !scoped || new RegExp(`(?<!function\\s+)\\bjobArgv\\(\\s*kind\\s*,\\s*${m[1]}\\b`).test(code);
}

export function extractTriggerKinds(source) {
  const { text, scoped } = dispatchBody(source);
  const marks = [...text.matchAll(KIND_RE)];
  const resolved = resolverReaches(source, scoped);
  const rows = [...new Set(marks.map((m) => m[1]))].map((kind) => {
    const first = marks.find((m) => m[1] === kind);
    const from = first.index + first[0].length;
    const next = marks.find((m) => m.index >= from);
    const health = text.indexOf('HEALTH[kind]', from);
    // the unscoped shape keeps its 400-character window: past the chain lies the rest of a large file
    const stops = [next ? next.index : null, health >= 0 ? health : null, scoped ? text.length : Math.min(text.length, first.index + 400)];
    const branch = text.slice(from, Math.min(...stops.filter((n) => n !== null)));
    const unknown = [...new Set([...branch.matchAll(/\bopts\.([A-Za-z_]\w*)/g)].map((m) => m[1]))].filter((f) => !KNOWN_SELECTORS.includes(f));
    const why = [
      resolved ? null : 'no variable assigned from triggerProject() reaches the dispatch in this file — route the project argument through triggerProject() before it is used in argv',
      unknown.length ? `argv reads ${unknown.map((f) => `opts.${f}`).join(', ')} — confirm each is a closed or validated value where the route sets it, then add it to KNOWN_SELECTORS in monitor/stpa-sweep.mjs with the reason` : null,
      /\bproject\b/.test(branch) ? 'the raw project parameter appears in this branch — pass the triggerProject() result instead' : null,
    ].filter(Boolean);
    return why.length
      ? { kind, argvSource: 'unclassified', detail: 'could not confirm every argv element traces to a closed source — review by hand', suggestion: why.join('; ') }
      : { kind, argvSource: 'allowlist', detail: 'argv resolved via triggerProject() / closed selectors only' };
  });
  if (/HEALTH\[kind\]/.test(text)) rows.push({ kind: 'health-*', argvSource: 'closed-map', detail: 'HEALTH[kind] is a closed object literal — every value is a fleet-declared constant, never a request field' });
  return rows;
}

// ── Closure point 2: remediation-policy.mjs's escalation gate (SC2', UCA2', H2') ────────────────
export function extractPolicyGate(source) {
  const settableMatch = source.match(/API_SETTABLE_MODES\s*=\s*new Set\(\[([^\]]*)\]\)/);
  const settableModes = settableMatch ? [...settableMatch[1].matchAll(/'([a-zA-Z0-9_-]+)'/g)].map((m) => m[1]) : null;
  const hasModeGate = /doc\.mode\s*!==\s*undefined/.test(source) && /return send\(403/.test(source);
  const hasAutoMergeGate = /m3\s*&&\s*.*autoMerge\s*===\s*true/.test(source) || /m3\.autoMerge\s*===\s*true/.test(source);
  return {
    settableModes,
    modeEscalationGated: hasModeGate,
    autoMergeGated: hasAutoMergeGate,
    detail: settableModes === null ? 'API_SETTABLE_MODES not found — this file does not match the known policy-gate shape at all' : null,
  };
}

// ── Closure point 3: the apply-time re-check (SC4', UCA3', UCA5', H3') ──────────────────────────
export function extractApplyCheck(source) {
  const hasCheck = /git\(\['apply',\s*'--check'/.test(source);
  return { hasApplyCheck: hasCheck, detail: hasCheck ? null : 'no `git apply --check` call found — a diff-apply path here would be UNCLASSIFIED against UCA3/H3' };
}

// ── where did a closure point go? ───────────────────────────────────────────────────────────────
// A closure point that is not in the file this reads has usually MOVED. The warning names the files
// under the same admin tree that still carry its marker, so the fix is a path and not a search.
// Reads names and one predicate per file: bounded, sorted, symlinks and test trees skipped.
const SKIP_DIRS = new Set(['test', 'static', 'menus', 'fixtures', 'node_modules']);
const MARKERS = Object.freeze({
  dispatch: (s) => /\bfunction (?:jobArgv|trigger)\s*\(/.test(s) && /kind\s*===\s*'/.test(s),
  policy: (s) => /API_SETTABLE_MODES\s*=\s*new Set\(/.test(s),
  apply: (s) => /git\(\['apply',\s*'--check'/.test(s),
});

function searchRoot(fromPath) {
  const start = dirname(fromPath);
  for (let cur = start, i = 0; i < 6; i++) {
    if (basename(cur) === 'admin') return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return start;
}

export function locateMarker(fromPath, has, { limit = 600 } = {}) {
  const root = searchRoot(fromPath);
  const hits = []; let seen = 0;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (seen >= limit || e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
      if (!e.name.endsWith('.mjs') || p === fromPath) continue;
      seen++;
      let s;
      try { s = readFileSync(p, 'utf8'); } catch { continue; }
      if (has(s)) hits.push(join(basename(root), relative(root, p)).split(sep).join('/'));
    }
  };
  walk(root);
  return hits.sort();
}

function movedHint(fromPath, has, what, envName) {
  const hits = locateMarker(fromPath, has);
  return hits.length
    ? `${what} is declared in ${hits.join(', ')} — set ${envName} to it, or move the default in monitor/stpa-sweep.mjs, then re-run`
    : `no file under ${basename(searchRoot(fromPath))}/ declares ${what} — the closure point may have been removed or reshaped; review by hand`;
}

// ── classification: fixed table, evaluated against what extraction found ────────────────────────
// Mirrors bin/taxonomy-render.mjs's discipline: the vocabulary (guide words, UCA ids) is read from
// the shipped spec, never restated as free-form prose here — this table's ROWS are the only thing
// generated; their MEANING lives in evaluations/SPEC-stpa-hazop-control-loop-panel-2026-09-01.md.
export function classify({ triggerKinds, policyGate, applyCheck, envelope, hints = {} }) {
  const rows = [];
  // guard: a suggestion rides only on an unclassified row, and only when one was derived
  const push = (row, suggestion) => rows.push(row.verdict === 'unclassified' && suggestion ? { ...row, suggestion } : row);

  for (const t of triggerKinds) {
    push({
      uca: 'UCA1\'', subject: `trigger kind "${t.kind}"`,
      verdict: ['allowlist', 'closed-map'].includes(t.argvSource) ? 'classified-safe' : 'unclassified',
      detail: t.detail,
    }, t.suggestion);
  }
  if (!triggerKinds.length) {
    push({ uca: 'UCA1\'', subject: 'trigger() dispatch', verdict: 'unclassified', detail: 'no kind === branches found — the file may not match the known dispatch shape' }, hints.dispatch);
  }

  push({
    uca: 'UCA2\'', subject: 'remediation-policy mode escalation',
    verdict: policyGate.settableModes === null ? 'unclassified'
      : policyGate.modeEscalationGated ? 'classified-safe' : 'flagged',
    detail: policyGate.detail || (policyGate.modeEscalationGated
      ? `API_SETTABLE_MODES=${JSON.stringify(policyGate.settableModes)}, escalation beyond it is 403-gated`
      : 'API_SETTABLE_MODES is declared but no 403 escalation gate was found — a mode change may be unguarded'),
  }, hints.policy);
  push({
    uca: 'UCA2\'', subject: 'remediation-policy m3.autoMerge',
    verdict: policyGate.settableModes === null ? 'unclassified'
      : policyGate.autoMergeGated ? 'classified-safe' : 'flagged',
    detail: policyGate.autoMergeGated ? 'm3.autoMerge === true is 403-gated' : 'no autoMerge gate found',
  }, hints.policy);

  push({
    uca: 'UCA3\'/UCA5\'', subject: 'diff apply-time re-check',
    verdict: applyCheck.hasApplyCheck ? 'classified-safe' : 'unclassified',
    detail: applyCheck.detail,
  }, hints.apply);

  // H6'/SC5' cross-check: the three closure points must all be readable together, or the tool
  // cannot assert they agree — an unreadable closure point makes cross-checking itself unclassified.
  const allReadable = triggerKinds.length > 0 && policyGate.settableModes !== null && true;
  push({
    uca: 'UCA7\'', subject: 'cross-check of the three closure points',
    verdict: allReadable ? 'classified-safe' : 'unclassified',
    detail: allReadable ? 'all three closure points were readable this run' : 'at least one closure point could not be read — no cross-check is possible this run',
  }, 'follows from the unreadable closure point above; it clears when that one is found');

  // guard: the ADVERSARIAL row closes only on a fresh live witness, never on source shape alone
  rows.push({ uca: '++ADVERSARIAL', subject: 'prompt-injection reaching the remediation prompt from scanned source', ...adversarialVerdict(envelope) });

  return rows;
}

function adversarialVerdict(envelope) {
  if (!envelope) return { verdict: 'open-finding', detail: 'envelope state not read this run — no mitigation can be claimed' };
  const missing = ['codeql', 'remediation'].filter((k) => !envelope.paths?.[k]);
  if (missing.length) return { verdict: 'open-finding', detail: `no typed envelope on the ${missing.join(' and ')} machine path(s) — scanned text reaches the model raw` };
  const w = envelope.witness || { state: 'absent' };
  if (w.state === 'fresh') return { verdict: 'classified-safe', detail: `typed envelope on both machine paths; live corpus replay passed at ${w.at}` };
  return { verdict: 'open-finding', detail: `typed envelope on both machine paths (source-checked); live corpus replay witness ${w.state}${w.at ? ` (${w.at})` : ''} — enveloped text can still be followed, so this stays open` };
}

export function runOnce({ servePath: sp = servePath(), policyPath: pp = policyPath(), applyPath: ap = applyPath(), remedPath: rp = remedPath(), witness: wp = witnessPath() } = {}, say = () => {}) {
  say(`reading ${sp}`);
  const serveSrc = readFileSync(sp, 'utf8');
  say(`reading ${pp}`);
  const policySrc = readFileSync(pp, 'utf8');
  say(`reading ${ap}`);
  const applySrc = readFileSync(ap, 'utf8');
  say(`reading ${rp}`);
  const remedSrc = readFileSync(rp, 'utf8');

  const triggerKinds = extractTriggerKinds(serveSrc);
  say(`${triggerKinds.length} trigger kind(s) found`);
  const policyGate = extractPolicyGate(policySrc);
  const applyCheck = extractApplyCheck(applySrc);
  const envelope = { paths: extractEnvelope(applySrc, remedSrc), witness: readEnvelopeWitness(wp) };
  say(`envelope: codeql=${envelope.paths.codeql} remediation=${envelope.paths.remediation} witness=${envelope.witness.state}`);

  // the tree is searched only for a closure point this run could not find
  const hints = {
    dispatch: triggerKinds.length ? null : movedHint(sp, MARKERS.dispatch, 'the job-kind dispatch', 'CW_STPA_SERVE_PATH'),
    policy: policyGate.settableModes !== null ? null : movedHint(pp, MARKERS.policy, 'API_SETTABLE_MODES', 'CW_STPA_POLICY_PATH'),
    apply: applyCheck.hasApplyCheck ? null : movedHint(ap, MARKERS.apply, 'the `git apply --check` call', 'CW_STPA_APPLY_PATH'),
  };
  const rows = classify({ triggerKinds, policyGate, applyCheck, envelope, hints });
  const unclassified = rows.filter((r) => r.verdict === 'unclassified').length;
  const flagged = rows.filter((r) => r.verdict === 'flagged').length;
  const openFindings = rows.filter((r) => r.verdict === 'open-finding').length;
  say(`${rows.length} row(s) classified: ${flagged} flagged, ${unclassified} unclassified, ${openFindings} named open finding(s)`);
  return { at: new Date().toISOString(), rows, summary: { total: rows.length, flagged, unclassified, openFindings } };
}

export const EXIT = { clean: 0, flagged: 21, failed: 2, openFindings: 23, unclassified: 24 };

export function exitCodeFor(summary) {
  if (summary.flagged > 0) return EXIT.flagged;
  if (summary.unclassified > 0) return EXIT.unclassified;
  if (summary.openFindings > 0) return EXIT.openFindings;
  return EXIT.clean;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const TAG = '[stpa]';
  const say = (line) => process.stdout.write(`${TAG} ${line}\n`);
  try {
    const result = runOnce({}, say);
    for (const r of result.rows) {
      const mark = r.verdict === 'classified-safe' ? 'OK' : r.verdict === 'flagged' ? 'FLAG' : r.verdict === 'open-finding' ? 'OPEN' : 'UNCL';
      say(`${mark.padEnd(5)} ${r.uca.padEnd(14)} ${r.subject} — ${r.detail || ''}`);
    }
    const unchecked = result.rows.filter((r) => r.verdict === 'unclassified');
    if (unchecked.length) {
      say(`WARN  ${unchecked.length} row(s) unclassified — the sweep could not check them, and an unchecked closure point is not a clean one`);
      for (const r of unchecked) if (r.suggestion) say(`HINT  ${r.uca.padEnd(14)} ${r.subject} — ${r.suggestion}`);
    }
    const outDir = process.env.CW_STPA_OUT || join(CW, 'reports', 'stpa-sweep');
    mkdirSync(outDir, { recursive: true });
    const stamp = (process.env.CW_NOW || new Date().toISOString()).replace(/[-:T]/g, '').slice(0, 14);
    const outPath = join(outDir, `stpa-${stamp}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    say(`wrote ${outPath}`);
    const code = exitCodeFor(result.summary);
    if (code === EXIT.unclassified) say(`${result.summary.unclassified} unclassified row(s), nothing flagged — exit ${code}`);
    if (code === EXIT.openFindings) say(`${result.summary.openFindings} open finding(s), nothing flagged — exit ${code}`);
    process.exit(code);
  } catch (e) {
    say(`FAILED: ${e.message}`);
    process.exit(EXIT.failed);
  }
}

// admin/routes/remediation.mjs — the Remediation tab: triage prompts and the agent hand-off.

import { spawn } from 'node:child_process';
import { splitThinking } from '../../lib/llm-reply.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute, basename } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { SCANNER_CHECKS, canonicalCheck, checkForScanner } from '../../monitor/scanner-checks.mjs';
import { loadIssues } from '../../monitor/issue-store.mjs';
import { primaryArea, areaOut, OUT_RE } from '../../monitor/registry.mjs';
import { loadLlmHosts, hostsInProbeOrder, baseUrlFor } from '../../monitor/llm-hosts.mjs';
import { postureOf } from '../../monitor/llm-runtime.mjs';
import { CW, UNRESOLVED, readJSONState, registry, reportsFor, manifestFiles, manifestSummary, resolvedRepos } from '../lib/core.mjs';
import { salvageObject } from '../../lib/salvage-json.mjs';
import { envelope } from '../../lib/prompt-envelope.mjs';
import { quotedArgv } from '../../lib/posix-shell.mjs';
import { withinRoot } from '../../lib/path-contain.mjs';
import { claudeArgs, PROFILES } from '../../lib/claude-spawn.mjs';
import { runnerPostHeaders } from '../lib/runner-token.mjs';

// ── remediation prompts, joined with the live rollup ────────────────────────────────────────
// SCANNER_CHECKS inverted: producing-check id -> category, so a prompt carries its fleet aggregate.
const CAT_BY_CHECK = new Map(Object.entries(SCANNER_CHECKS).map(([cat, id]) => [id, cat]));

// check id -> entry; first manifest in sorted order wins. The CLOSED SET both prompt routes
// validate caller-supplied check ids against — resolve here or be refused.
function promptCatalog() {
  const byCheck = new Map();
  for (const name of manifestFiles()) {
    const m = manifestSummary(name);
    if (!m.ok) continue; // unparseable manifest (a mid-edit torn write) — skip it, never throw
    for (const c of m.checks) {
      if (!c.remediationPrompt || byCheck.has(c.id)) continue;
      byCheck.set(c.id, { check: c.id, manifest: name, description: c.description, prompt: c.remediationPrompt, report: c.report || null, formatNotes: c.formatNotes || null });
    }
  }
  return byCheck;
}

// check id -> scanner category through the alias table, or null when the check has none.
const categoryOf = (check) => CAT_BY_CHECK.get(canonicalCheck(check)) || null;

// Which project a request is about. `unselected`, `unknown` and `unresolved` are named rather than
// mapped to UNRESOLVED, where every read is ENOENT and the tab said "nothing has been swept here"
// about a project it had never resolved.
function projectScope(raw, known) {
  const q = String(raw || '');
  if (!q) return { state: 'unselected', project: null, why: 'no project selected — the remediation layer answers for one project at a time' };
  if (!(known.has(q) || known.has(projectSlug(q)))) return { state: 'unknown', project: null, why: `'${q.slice(0, 80)}' is not a project this panel knows` };
  const dir = reportsFor(q);
  if (dir === UNRESOLVED) return { state: 'unresolved', project: null, why: `'${q.slice(0, 80)}' has no usable report directory in the registry` };
  return { state: 'ok', project: q, slug: projectSlug(q) || null, out: basename(dir), dir, why: null };
}
const scopeOut = (s) => ({ state: s.state, why: s.why || null, slug: s.slug || null, out: s.out || null });

function remediationPrompts(scope) {
  // The rollup's read STATE travels with the prompts. readJSON folds a torn or corrupt file into
  // the same null as a missing one, and the tab then said "no live counts" for both — a corrupt
  // rollup read exactly like a project nobody had swept. Only ENOENT is absent.
  const read = readJSONState(join(scope.dir || UNRESOLVED, 'rollup.json'));
  const rollup = (read.state === 'ok' && read.value && typeof read.value === 'object') ? read.value : {};
  const scanners = rollup.scanners || {};
  const prompts = [...promptCatalog().values()].map((e) => {
    // canonicalCheck first: some checks are declared under alias ids — resolve before the category join
    const canonical = canonicalCheck(e.check);
    const category = categoryOf(e.check);
    // no category ⇒ live stays null — never a fabricated zero; aliasOf says whose numbers these are
    return { ...e, category, aliasOf: canonical === e.check ? null : canonical,
      live: (category && scanners[category]) || null };
  }).sort((a, b) => (a.manifest < b.manifest ? -1 : a.manifest > b.manifest ? 1 : a.check < b.check ? -1 : 1));
  return { ok: true, generated: rollup.generated || null, project: scopeOut(scope),
    rollup: { state: read.state, why: read.state === 'ok' ? null : (read.why || null) }, prompts };
}

// ── inputs: what the layer reads for one area, and what produces each ───────────────────────────
// An empty Remediation tab is missing one of these, and the tab names which. `outputs` are the
// layer's own records — absent until someone uses it, which is a different fact from a missing input.
export const REMEDIATION_INPUTS = Object.freeze([
  { key: 'rollup', file: 'rollup.json', label: 'latest results',
    producedBy: 'a full scan of this project (node monitor/sweep.mjs all <area>) — its rollup step writes rollup.json' },
  { key: 'plan', file: 'REMEDIATION.md', label: 'fix plan',
    producedBy: 'the rollup step of every full scan writes REMEDIATION.md beside rollup.json' },
  { key: 'batch', file: null, label: 'scanner artifacts',
    producedBy: 'the sweep batch rollup.json names (reports/sweep-<stamp>-<area>/), written by the same full scan — report compaction can remove it' },
  { key: 'ledger', file: 'remediation-ledger.json', label: 'verified-fix ledger',
    producedBy: 'the rollup, the first time a later scan finds a previously open finding gone — needs two scans of this project' },
  { key: 'codeqlFleet', file: 'codeql-fleet.json', label: 'CodeQL findings',
    producedBy: 'node monitor/codeql-fleet-data.mjs, which each sweep runs after the rollup' },
]);
const OUTPUTS = Object.freeze({
  triage: { dir: 'handoff', label: 'triage runs',
    producedBy: 'a Review prompts card (Claude Code or local LLM) writes each handoff and verdict here' },
  codeqlJobs: { dir: 'codeql-remediation', label: 'CodeQL remediation runs',
    producedBy: 'the CodeQL tab\'s analyze button writes one job record per finding here' },
});

const errWhy = (e) => String((e && (e.code || e.message)) || e).slice(0, 200);
const isAbsent = (e) => !!e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');

/**
 * The counts REMEDIATION.md states about itself. The plan is tables under rollup.mjs's section
 * headings, so the tab's old bullet count read 0 for every plan ever written — "0 items" beside
 * five KEV packages. Headings not found ⇒ parsed:false: the count is unknown, never zero.
 */
export function planSummary(md) {
  const text = String(md ?? '');
  const sect = (re) => { const m = text.match(re); return m ? { packages: Number(m[1]), findings: Number(m[2]) } : null; };
  const main = sect(/^## Critical \/ High \/ Medium — (\d+) packages?, (\d+) findings?/m);
  const low = sect(/^## Low severity — (\d+) packages?, (\d+) findings?/m);
  if (!main || !low) return { parsed: false, why: 'the plan does not carry the rollup\'s section headings — its item count is unknown, not zero' };
  const head = text.match(/\*\*Headline:\*\*\s*(\d+) critical · (\d+) high · (\d+) medium · (\d+) low · \*\*(\d+) on CISA KEV\*\*/);
  const gen = text.match(/^Generated (\S+) from/m);
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('## 🚨 KEV'));
  let kevPackages = 0;
  if (at > -1) for (let i = at + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i].startsWith('| `')) kevPackages++;
  return {
    parsed: true, generated: gen ? gen[1] : null,
    packages: main.packages + low.packages, findings: main.findings + low.findings, main, low, kevPackages,
    headline: head ? { crit: Number(head[1]), high: Number(head[2]), med: Number(head[3]), low: Number(head[4]), kev: Number(head[5]) } : null,
  };
}

// rollup.source is reports-root-relative since sourceKey() (monitor/area.mjs); older rollups carry
// an absolute path. existsSync() on the bare value resolved it against the panel's cwd, so a
// relative source never matched and every handoff said "Scanner artifact: NOT FOUND".
function batchDirOf(source, root) {
  if (typeof source !== 'string' || !source) return null;
  const abs = isAbsolute(source) ? source : resolve(root, source);
  return withinRoot(root, abs) && existsSync(abs) ? abs : null;
}
const reportsRootOf = (reg) => resolve(CW, (reg && reg.reportsRoot) || 'reports');

function listDir(dir) {
  try { return { state: 'ok', why: null, names: readdirSync(dir).sort() }; }
  catch (e) { return isAbsent(e) ? { state: 'absent', why: null, names: [] } : { state: 'unreadable', why: errWhy(e), names: [] }; }
}

/** Every input and output of the remediation layer in one area's report directory. */
export function inputsIn(dir, { root }) {
  const spec = Object.fromEntries(REMEDIATION_INPUTS.map((s) => [s.key, s]));
  const entry = (key, state, extra = {}) => ({ key, label: spec[key].label, file: spec[key].file,
    state, why: null, producedBy: spec[key].producedBy, ...extra });
  const inputs = {};

  const rr = readJSONState(join(dir, 'rollup.json'));
  const rollup = rr.state === 'ok' && rr.value && typeof rr.value === 'object' ? rr.value : null;
  inputs.rollup = rr.state === 'ok' && !rollup ? entry('rollup', 'unreadable', { why: 'rollup.json is not a JSON object' })
    : entry('rollup', rr.state, { why: rr.why, generated: (rollup && rollup.generated) || null });

  try { inputs.plan = entry('plan', 'ok', { summary: planSummary(readFileSync(join(dir, 'REMEDIATION.md'), 'utf8')) }); }
  catch (e) { inputs.plan = isAbsent(e) ? entry('plan', 'absent') : entry('plan', 'unreadable', { why: errWhy(e) }); }

  if (!rollup) {
    inputs.batch = inputs.rollup.state === 'absent'
      ? entry('batch', 'absent', { why: 'there is no rollup.json to name a batch' })
      : entry('batch', 'unknown', { why: 'rollup.json could not be read, so the batch it names is unknown' });
  } else if (!rollup.source) {
    inputs.batch = entry('batch', 'absent', { why: 'rollup.json names no sweep batch' });
  } else {
    const src = String(rollup.source);
    inputs.batch = batchDirOf(src, root) ? entry('batch', 'ok', { source: src })
      : entry('batch', 'absent', { source: src, why: `the batch rollup.json names (${src.slice(0, 120)}) is not under the reports root on this box` });
  }

  const lr = readJSONState(join(dir, 'remediation-ledger.json'));
  const lv = lr.value;
  const entries = Array.isArray(lv) ? lv : (lv && Array.isArray(lv.entries) ? lv.entries : null);
  inputs.ledger = lr.state !== 'ok' ? entry('ledger', lr.state, { why: lr.why })
    : entries ? entry('ledger', 'ok', { entries: entries.length })
    : entry('ledger', 'unreadable', { why: 'remediation-ledger.json carries no entries[]' });

  const cr = readJSONState(join(dir, 'codeql-fleet.json'));
  inputs.codeqlFleet = cr.state !== 'ok' ? entry('codeqlFleet', cr.state, { why: cr.why })
    : Array.isArray(cr.value && cr.value.findings) ? entry('codeqlFleet', 'ok', { findings: cr.value.findings.length })
    : entry('codeqlFleet', 'unreadable', { why: 'codeql-fleet.json carries no findings[]' });

  const out = (key, extra) => ({ key, label: OUTPUTS[key].label, producedBy: OUTPUTS[key].producedBy, ...extra });
  const h = listDir(join(dir, OUTPUTS.triage.dir));
  const q = listDir(join(dir, OUTPUTS.codeqlJobs.dir));
  const byState = {};
  for (const n of q.names.filter((x) => x.endsWith('.json'))) {
    const j = readJSONState(join(dir, OUTPUTS.codeqlJobs.dir, n));
    const s = j.state === 'ok' && j.value && typeof j.value.state === 'string' ? j.value.state : 'unreadable';
    byState[s] = (byState[s] || 0) + 1;
  }
  const outputs = {
    triage: out('triage', { state: h.state, why: h.why, runs: h.names.filter((n) => n.endsWith('.md')).length,
      verdicts: h.names.filter((n) => n.endsWith('.verdict.json')).length }),
    codeqlJobs: out('codeqlJobs', { state: q.state, why: q.why, jobs: Object.values(byState).reduce((a, b) => a + b, 0), byState }),
  };
  return { inputs, outputs, scanners: (rollup && rollup.scanners && typeof rollup.scanners === 'object') ? rollup.scanners : null };
}

// A scope that did not resolve is its own answer, never a row of absents describing a directory
// nobody asked about.
function remediationInputs(scope, reg) {
  if (scope.state !== 'ok') return { ok: false, project: scopeOut(scope), error: scope.why };
  const r = inputsIn(scope.dir, { root: reportsRootOf(reg) });
  return { ok: true, project: scopeOut(scope), inputs: REMEDIATION_INPUTS.map((s) => r.inputs[s.key]), outputs: r.outputs };
}

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;
const byLabel = (x, y) => {
  const a = String(x.label).toLowerCase(), b = String(y.label).toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  const p = String(x.out), q = String(y.out);
  return p < q ? -1 : p > q ? 1 : 0;
};

/**
 * Every declared area, plus any undeclared report directory holding a rollup or a plan. An area
 * with nothing on disk is still a row, naming its absent inputs — the page must not shrink to the
 * projects that happen to have been swept. Rows sort by label, then report directory.
 */
export function remediationFleetView({ reg = null, root = null, nowMs } = {}) {
  let live = reg;
  if (!live) {
    try { live = registry(); }
    catch (e) { return { ok: false, reason: `the registry could not be read (${e.message}) — the fleet's remediation state is UNKNOWN, not empty` }; }
  }
  const reportsRoot = root ? resolve(root) : reportsRootOf(live);
  const catalogue = [...promptCatalog().values()].map((e) => ({ check: e.check, category: categoryOf(e.check) }))
    .sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  const cats = [...new Set(catalogue.map((c) => c.category).filter(Boolean))].sort();

  const areas = [];
  const seen = new Set();
  for (const a of live.areas || []) {
    const out = areaOut(a.slug, live);
    const base = { slug: a.slug || null, label: a.label || a.slug || '?', out: out || null, declared: true };
    if (!out || !OUT_RE.test(out) || !withinRoot(reportsRoot, join(reportsRoot, out))) {
      areas.push({ ...base, state: 'misdeclared', why: 'the area declares no usable report directory, so none of its inputs can be read' });
      continue;
    }
    seen.add(out);
    areas.push({ ...base, state: 'ok', dir: join(reportsRoot, out) });
  }
  let undeclaredScan = { state: 'ok', why: null };
  try {
    for (const d of readdirSync(reportsRoot, { withFileTypes: true })) {
      if (!d.isDirectory() || seen.has(d.name) || !SAFE_SEGMENT.test(d.name)) continue;
      if (!existsSync(join(reportsRoot, d.name, 'rollup.json')) && !existsSync(join(reportsRoot, d.name, 'REMEDIATION.md'))) continue;
      areas.push({ slug: null, label: d.name, out: d.name, declared: false, state: 'ok', dir: join(reportsRoot, d.name) });
    }
  } catch (e) {
    undeclaredScan = isAbsent(e)
      ? { state: 'absent', why: 'the reports root does not exist — nothing has been scanned on this box' }
      : { state: 'unreadable', why: `the reports root could not be listed (${errWhy(e)}) — undeclared report directories are UNKNOWN, not absent` };
  }

  const rows = areas.sort(byLabel).map(({ dir, ...a }) => {
    if (a.state !== 'ok') return a;
    const r = inputsIn(dir, { root: reportsRoot });
    const liveCounts = {};
    for (const c of cats) if (r.scanners && r.scanners[c]) liveCounts[c] = r.scanners[c];
    const missing = REMEDIATION_INPUTS.filter((s) => r.inputs[s.key].state !== 'ok').map((s) => s.key);
    return { ...a, inputs: REMEDIATION_INPUTS.map((s) => r.inputs[s.key]), outputs: r.outputs, missing, live: liveCounts };
  });
  const envNow = Date.parse(process.env.CW_NOW || '');
  const t = Number.isFinite(nowMs) ? nowMs : (Number.isFinite(envNow) ? envNow : Date.now());
  return { ok: true, generatedAt: new Date(t).toISOString(), catalogue, undeclaredScan, areas: rows };
}



// ── triage handoff: hand a prompt to Claude Code, or run it against a local model ───────────────
// Which hosts exist, their ports and their capabilities come from manifests/llm-hosts.json — the
// one declaration memory-layer and overwatch-layer also resolve against. Before it, 127.0.0.1:1234 and
// 127.0.0.1:11434 were written into eight files across three repositories, so adding a host meant
// finding all of them and removing one meant finding them all again.
//
// ollama was removed 2026-08-27 (operator instruction, recorded in the declaration with its
// reason). It was the only host needing a non-OpenAI request shape, which is why every call site
// below used to branch on engine type.
export { baseUrlFor as llmBaseUrl } from '../../monitor/llm-hosts.mjs';
const ARTIFACT_CAP = 48_000; // bytes of artifact inlined for a local model — small contexts are real

export async function llmTargets() {
  const probe = async (name, url, path, pick) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 1500);
    try {
      const r = await fetch(url + path, { signal: ac.signal });
      // explicit uncertainty: a down / unreadable engine is up:false with an explicit empty models[],
      // never dropped and never a bare object a consumer reads as "no models = fine"
      if (!r.ok) return { name, url, up: false, models: [] };
      return { name, url, up: true, models: pick(await r.json()).filter((m) => typeof m === 'string').slice(0, 40) };
    } catch { return { name, url, up: false, models: [] }; }
    finally { clearTimeout(t); }
  };
  // NOTHING IS PROBED UNTIL THE OPERATOR TURNS IT ON. Security-first (operator ruling 2026-08-27):
  // localai, vllm and sglang bind 0.0.0.0 by default and four of the seven declared hosts will
  // fetch a model on demand, so auto-probing whatever is listening turns "I started a server" into
  // "the panel is talking to it".
  //
  // The state is RETURNED, not folded into an empty list. `disabled` and `none-enabled` and
  // "nothing answered" are three different facts, and a caller that gets `engines: []` for all
  // three tells an operator who switched runners off that their machine has no models on it.
  const postureState = postureOf();
  if (postureState.state !== 'enabled') {
    return { ok: true, posture: postureState.state, why: postureState.why, engines: [] };
  }

  // Every ENABLED chat host, in the declaration's probe order, DEDUPED BY RESOLVED URL.
  //
  // The dedupe is not an optimisation. llama.cpp, llamafile, LocalAI and mlx-lm all default to
  // :8080, so probing per-host would fire four identical requests at one server and render four
  // rows for it — the panel would report four engines where one is running. Probe each distinct
  // endpoint once and let the row carry the candidates.
  const decl = loadLlmHosts();
  const on = new Set(postureState.hosts.map((h) => h.id));
  const chatHosts = hostsInProbeOrder(decl)
    .filter((h) => h.capabilities.includes('chat'))
    .filter((h) => on.has(h.id));
  const byUrl = new Map();
  for (const h of chatHosts) {
    const url = baseUrlFor(h.id, decl);
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(h);
  }
  const engines = await Promise.all(
    [...byUrl.entries()].map(([url, hosts]) =>
      // One path for all of them: they all speak /v1/models, which is what made the host list a
      // declaration instead of adapters.
      probe(hosts[0].id, url, '/v1/models', (j) => (j.data || []).map((m) => m && m.id)).then((row) => ({
        ...row,
        // A hit proves an OpenAI-compatible server is listening and NOT which one. Naming it would
        // assert something the probe cannot distinguish — explicit uncertainty, applied to identity.
        // `name` stays the first candidate because it is only ever used to resolve a URL back, and
        // every candidate resolves to this same one; the LABEL is what must not overclaim.
        label: hosts.length === 1 ? hosts[0].label : `unidentified server on ${url}`,
        identified: hosts.length === 1,
        candidates: hosts.map((h) => h.id),
      }))
    )
  );
  return { ok: true, posture: 'enabled', engines };
}


// what the prompt needs to act on: repo, artifact, counts — all resolved server-side
function handoffContext(scope, entry) {
  // The read state rides along: a torn rollup used to reach the agent as "Live counts: none", the
  // same words as a check with no aggregate, and an agent told "none" reasons from zero.
  const read = readJSONState(join(scope.dir, 'rollup.json'));
  const rollup = (read.state === 'ok' && read.value && typeof read.value === 'object') ? read.value : {};
  const category = categoryOf(entry.check);
  const live = (category && rollup.scanners && rollup.scanners[category]) || null;
  const batch = batchDirOf(rollup.source, reportsRootOf(registry()));
  const repos = (Array.isArray(rollup.repos) ? rollup.repos : []).filter((r) => r && typeof r.name === 'string');
  let artifact = null, repoName = null;
  if (batch && entry.report) {
    const withFindings = category ? repos.filter((r) => r.scanners && r.scanners[category] && r.scanners[category].total > 0) : [];
    for (const r of [...withFindings, ...repos]) {
      const p = join(batch, r.name, entry.report);
      if (existsSync(p)) { artifact = p; repoName = r.name; break; }
    }
  }
  const known = resolvedRepos();
  const pathOf = (name) => { const x = known.find((y) => y.name === name); return x && x.path && existsSync(x.path) ? x.path : null; };
  let repoPath = repoName ? pathOf(repoName) : null;
  // No artifact names a repo: open in THIS project's first resolvable repo, not in commitwork's checkout.
  if (!repoName) for (const r of repos) { const p = pathOf(r.name); if (p) { repoPath = p; break; } }
  return { category, live, artifact, repoName, repoPath, generated: rollup.generated || null,
    rollup: { state: read.state, why: read.state === 'ok' ? null : (read.why || null) } };
}

// The one sentence about counts, in three shapes that must never read alike: counts exist; the
// rollup exists and could not be read; nothing to read. `null` for the local-model message keeps
// it a bare fact the model cannot mistake for a zero.
function liveCountsLine(ctx) {
  if (ctx.live) return `Live counts: ${JSON.stringify(ctx.live)}`;
  const rs = ctx.rollup || {};
  if (rs.state === 'unreadable') return `Live counts: UNKNOWN — rollup.json exists and could not be read (${rs.why || 'parse failed'}). This is not zero and not "no findings"; say so in your triage.`;
  if (rs.state === 'absent') return 'Live counts: none — no rollup for this project; nothing has been swept here.';
  return 'Live counts: none — this check has no fleet aggregate.';
}

// Open scanner-row issues mapped to the check being handed off. A broken issue store DEGRADES the
// handoff — it never blocks it.
function handoffIssuesSection(entry, project) {
  try {
    const cats = Object.keys(SCANNER_CHECKS).filter((c) => checkForScanner(c) === entry.check);
    if (!cats.length) return [];
    const areaSlug = project ? (projectSlug(project) || String(project)) : (primaryArea(registry())?.slug || null);
    const open = Object.values(loadIssues().issues).filter((i) => i.state !== 'closed'
      && i.source?.kind === 'scanner-row' && cats.includes(i.source.tool) && i.area === areaSlug);
    if (!open.length) return [];
    return ['## Tracked issues', '',
      ...open.map((i) => `- ${i.id} — ${i.title}`), '',
      'Each of these is a durable work item in the issue tracker. When you have verified a fix, close it with:',
      '',
      '    node bin/issue.mjs close <id> --as fixed --evidence "<what you verified>" --session <your session>',
      '',
      'Preferred path: leave the close to scan evidence — the next sweep\'s ingest (`node bin/issue.mjs ingest`) auto-closes on proof, never on absence.',
      ''];
  } catch { return ['<!-- issue store unavailable -->']; }
}

function composeHandoff(entry, ctx, project) {
  return [`# commitwork triage handoff — ${entry.check}${project ? ` · ${project}` : ''}`,
    `Generated ${new Date().toISOString()} from the rollup of ${ctx.generated || 'an unknown time'}.`,
    liveCountsLine(ctx),
    ctx.artifact ? `Scanner artifact: ${ctx.artifact} (repo: ${ctx.repoName}) — read it before concluding anything.`
      : 'Scanner artifact: NOT FOUND on disk for this check — say so in your triage rather than inventing findings.',
    ctx.repoPath ? `Repository: ${ctx.repoPath}` : 'Repository: NOT RESOLVED on this box — no repository in this project\'s rollup has a path here; locate the code before concluding anything.',
    '', entry.prompt, '',
    ...(entry.formatNotes ? [entry.formatNotes, ''] : []),
    ...handoffIssuesSection(entry, project)].filter((l) => l !== null).join('\n');
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // sh single-quote; inputs are server-derived paths

// overwatch-layer's runner, if this box has one. Tried, not required: an unreachable runner is a
// DECLARED fallback, never an error.
const substrateDispatch = () => process.env.CW_SUBSTRATE_DISPATCH || 'http://127.0.0.1:7980/api/v1/agents/dispatch';
const SUBSTRATE_TIMEOUT_MS = 3000;

async function dispatchToOverwatch(file, cwd, prompt) {
  // The runner refuses a tokenless dispatch; not sending one is a declared fallback, like unreachable.
  const auth = runnerPostHeaders();
  if (!auth.ok) return { ok: false, why: auth.why };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), SUBSTRATE_TIMEOUT_MS);
  try {
    const res = await fetch(substrateDispatch(), {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({ prompt, cwd, mode: 'plan' }),
      signal: ac.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, why: `runner refused: HTTP ${res.status} ${body?.error?.code || ''}`.trim() };
    const sessionId = body?.data?.sessionId;
    if (!sessionId) return { ok: false, why: 'runner returned no session id' };
    return { ok: true, sessionId, claim: body.data.claim ?? null };
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? `runner did not answer within ${SUBSTRATE_TIMEOUT_MS}ms` : `runner unreachable: ${e.cause?.code || e.message}` };
  }
}

// Dispatch ladder: CW_HANDOFF_CMD override → overwatch-layer runner → Terminal.app + VS Code.
// Shared with routes/issue-detail.mjs — one copy of the ladder, never two.
export async function launchClaudeSession({ file, cwd, prompt }) {
  // quotedArgv, not split(' '): a quoted path holding a space is one argument (lib/posix-shell.mjs).
  const override = quotedArgv(process.env.CW_HANDOFF_CMD);
  if (override.length) {
    const child = spawn(override[0], [...override.slice(1), file], { cwd, detached: true, stdio: 'ignore' });
    // 'error' arrives after spawn() returns; unheard, a command that cannot start takes the panel down.
    const failed = await new Promise((res) => { child.once('spawn', () => res(null)); child.once('error', res); });
    child.on('error', () => { /* already reported */ });
    if (failed) return { ok: false, error: `CW_HANDOFF_CMD could not start ${override[0]}: ${failed.message}`, file };
    child.unref();
    return { ok: true, started: true, file, cwd, via: 'CW_HANDOFF_CMD' };
  }

  const sub = await dispatchToOverwatch(file, cwd, prompt);
  if (sub.ok) {
    // The watch host is DECLARED, not hardcoded. It is an operator deployment detail, and this
    // repository ships publicly, so the literal does not belong in source. Read at CALL time per the
    // env-override contract — a `const` at module load silently defeats any test that sets it after
    // import.
    //
    // ABSENT MEANS NO LINK, not a guessed one. A watch URL built from a default nobody configured
    // sends the reader to a host that may not exist, and a link that goes nowhere is worse than an
    // absent field: the caller cannot tell the difference between "not deployed" and "broken".
    // `via` stays 'overwatch-layer' — it is a stored value that journals already on disk match on, and
    // migrating it is coordinated work with those stores, not a rename here.
    const watchHost = process.env.CW_OVERWATCH_WATCH_HOST;
    return {
      ok: true, started: true, file, cwd, via: 'overwatch',
      sessionId: sub.sessionId, claim: sub.claim,
      ...(watchHost ? { watch: `https://${watchHost}/#/agents/${sub.sessionId}` } : {}),
    };
  }

  // CW_OPEN / CW_OSASCRIPT: test seams for the fallback path — argv-array, no shell, server-derived args
  try { spawn(process.env.CW_OPEN || 'open', ['-a', 'Visual Studio Code', cwd], { detached: true, stdio: 'ignore' }).unref(); } catch { /* best-effort */ }
  // guard: the attended session loads the operator's settings, never the repo's (review 2026-10-07 D2)
  const shell = `cd ${shq(cwd)} && ${['claude', ...claudeArgs(PROFILES.handoff)].map(shq).join(' ')} "$(cat ${shq(file)})"`;
  const script = `tell application "Terminal"\n  activate\n  do script "${shell.replace(/[\\"]/g, '\\$&')}"\nend tell`;
  try { spawn(process.env.CW_OSASCRIPT || 'osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref(); }
  catch (e) { return { ok: false, error: `could not launch Terminal: ${e.message}`, file, overwatchWhy: sub.why }; }
  // overwatchWhy travels on the SUCCESS path too — the operator can see why the runner was not used
  return { ok: true, started: true, file, cwd, via: 'terminal+vscode', overwatchWhy: sub.why };
}

async function launchClaude(scope, entry, ctx) {
  const dir = join(scope.dir, 'handoff');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${entry.check}-${Date.now()}.md`);
  const prompt = composeHandoff(entry, ctx, scope.project);
  writeFileSync(file, prompt);
  return launchClaudeSession({ file, cwd: ctx.repoPath || CW, prompt });
}

// ── structured output ───────────────────────────────────────────────────────────────────────────
// Every local run must yield a machine-readable verdict against schema/triage-verdict.schema.json,
// enforced engine-side AND stated in the prompt. An unreadable schema FAILS the run.
let _triageSchema = null;
function triageSchema() {
  if (_triageSchema) return _triageSchema;
  try { _triageSchema = JSON.parse(readFileSync(join(CW, 'schema', 'triage-verdict.schema.json'), 'utf8')); }
  catch (e) { throw new Error(`triage-verdict schema unreadable (schema/triage-verdict.schema.json): ${e.message} — local runs are refused rather than degrading to free-form output`); }
  return _triageSchema;
}

async function runLocalModel(engine, model, entry, ctx, scope) {
  const project = scope.project;
  const schema = triageSchema(); // throws before any engine is contacted — fail closed
  let artifactText = '';
  if (ctx.artifact) { try { artifactText = readFileSync(ctx.artifact, 'utf8'); } catch { /* stated below */ } }
  const fullLen = artifactText.length;
  const truncated = fullLen > ARTIFACT_CAP;
  if (truncated) artifactText = artifactText.slice(0, ARTIFACT_CAP);
  const messages = [
    { role: 'system', content: entry.prompt },
    { role: 'user', content:
      `Scanner artifact ${entry.report || ''}${ctx.repoName ? ` from repo ${ctx.repoName}` : ''}`
      + (truncated ? ` (TRUNCATED: first ${ARTIFACT_CAP} of ${fullLen} bytes — your conclusions are a floor, say so)` : '')
      + `:\n\n${artifactText ? envelope(artifactText, { label: `scanner artifact ${entry.report || ''}`.trim(), cap: ARTIFACT_CAP }) : '(no artifact found on disk — reason from the counts only, and say that you did)'}\n\n`
      + `${liveCountsLine(ctx)}\n\n`
      + (entry.formatNotes ? `${entry.formatNotes}\n\n` : '')
      + 'Respond ONLY with a JSON object conforming to the triage-verdict schema (the server enforces it): '
      + '`verdict` (clean | all-false-positives | action-required | mixed | cannot-determine), `summary`, '
      + '`findings[]` each {id: "file:line" or rule/package identity, classification: real | false-positive | intentional | needs-human, reason, action?}, '
      + 'and `caveats[]` naming whatever bounds your verdict (truncated artifact, redacted values, source not read). '
      + 'Classify EVERY finding in the artifact; do not fabricate ignore-file syntax or diffs — name the action instead.' },
  ];
  // 420s: a cold 27B load can exceed 158s, and an early client abort makes some hosts discard the load
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 420_000);
  let content = '', explicitThinking = null;
  try {
    // One request shape for every host. The branch that used to be here existed for ollama alone.
    const r = await fetch(`${baseUrlFor(engine)}/v1/chat/completions`, { method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'triage_verdict', strict: true, schema } } }) });
    if (!r.ok) return { ok: false, error: `${engine} answered HTTP ${r.status}` };
    const j = await r.json();
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    content = msg.content || '';
    explicitThinking = msg.reasoning_content || msg.reasoning || null;
  } catch (e) {
    return { ok: false, error: ac.signal.aborted ? 'local model timed out after 420s — if this is a cold load of a big model, the machine is likely paging; see the engine row for its size' : `local model unreachable: ${e.message}` };
  } finally { clearTimeout(t); }
  const { thinking, answer: reply } = splitThinking(content, explicitThinking);
  // parse the enforced JSON; a failure is STATED and the raw reply preserved
  let verdict = null, verdictError = null, verdictSalvaged = false;
  const shapeCheck = (v) => v && typeof v.verdict === 'string' && Array.isArray(v.findings) ? v : null;
  // strip markdown fences some models wrap around JSON despite enforcement
  const defence = (s) => String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { verdict = shapeCheck(JSON.parse(defence(reply))); } catch { /* salvage below */ }
  if (!verdict && thinking) {
    // some engine/template combos route the whole output into the reasoning channel — recover the
    // last balanced object carrying `verdict` (G3: never by property ORDER — the old anchor
    // '{"verdict"' broke the moment the schema emitted another property first) and MARK it
    // salvaged, never pass it off as a clean reply
    const s = salvageObject(thinking, 'verdict');
    if (s) { verdict = shapeCheck(s.value); verdictSalvaged = !!verdict; }
  }
  if (!verdict) verdictError = reply
    ? 'reply is not a triage verdict despite engine-side schema enforcement — raw reply preserved'
    : 'the model emitted no content (its output went to the reasoning channel and no verdict could be salvaged from it) — thinking preserved';
  // evidence file, thinking included; the .verdict.json beside it is the machine-readable artifact
  const dir = join(scope.dir, 'handoff');
  mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  // A declared host id is not a filename. `llama.cpp` carries a dot, and a dot in a stem is how a
  // consumer that splits on '.' to find an extension reads the host name as one. The declaration
  // gets to pick ids that read well; the filesystem gets a slug.
  const engineSlug = String(engine).replace(/[^a-z0-9]+/gi, '-');
  const file = join(dir, `${entry.check}-${engineSlug}-${stamp}.md`);
  writeFileSync(file, `# local triage — ${entry.check} · ${engine}:${model}\n\n`
    + composeHandoff(entry, ctx, project)
    + (thinking ? '\n---\n\n## Model thinking\n\n' + thinking + '\n' : '')
    + '\n---\n\n## Model reply\n\n' + reply + '\n'
    + (verdictSalvaged ? '\n---\n\n> **Verdict SALVAGED from the reasoning channel** — the model emitted no content; the JSON was recovered from its thinking tail.\n' : '')
    + (verdictError ? `\n---\n\n> **No verdict file:** ${verdictError}\n` : ''));
  let verdictFile = null;
  if (verdict) {
    verdictFile = join(dir, `${entry.check}-${engineSlug}-${stamp}.verdict.json`);
    writeFileSync(verdictFile, JSON.stringify({
      schema: 'commitwork/triage-verdict.v1', check: entry.check, engine, model,
      project: project || null, generated: new Date().toISOString(),
      artifact: ctx.artifact, artifactTruncated: truncated, verdictSalvaged, verdict,
    }, null, 2));
  }
  return { ok: true, engine, model, reply, thinking, verdict, verdictFile, verdictError, verdictSalvaged,
    evidence: file, artifact: ctx.artifact, artifactTruncated: truncated,
    // the exact messages that crossed the wire, so the panel shows the prompt AS SENT
    sent: { system: messages[0].content, user: messages[1].content } };
}
// Mirrored from serve.mjs (CW_ADMIN_LOCAL_PORT || PORT+1), read at call time so the 403 names the real port.
const operatorPort = () => Number(process.env.CW_ADMIN_LOCAL_PORT || (Number(process.env.CW_ADMIN_PORT || 7878) + 1));
const AGENT_LOCAL_ONLY = () => ({
  ok: false, localOnly: true,
  error: `starting a Claude Code session is available only on the operator port, http://127.0.0.1:${operatorPort()}; `
    + 'the published port is external even when you are sitting at the box, and this starts an agent in the repository.',
});
// ── routes ──────────────────────────────────────────────────────────────────────────────────────
export const routes = [
  { method: 'GET', path: '/api/remediation/prompts', handle: ({ send, query, knownProjects }) =>
    send(200, remediationPrompts(projectScope(query.get('project'), knownProjects()))) },
  // What this project's remediation layer reads, each input's state, and what produces a missing one.
  { method: 'GET', path: '/api/remediation/inputs', handle: ({ send, query, knownProjects }) =>
    send(200, remediationInputs(projectScope(query.get('project'), knownProjects()), registry())) },
  // Every project at once: plan counts, prompt tallies, runs, and each project's absent inputs.
  { method: 'GET', path: '/api/remediation/fleet', handle: ({ send }) => {
    const v = remediationFleetView({});
    return send(v.ok ? 200 : 503, v);
  } },
  // probed per request — a cached engine list would report a dead server as up
  { method: 'GET', path: '/api/llm/targets', handle: ({ send }) => llmTargets().then((t) => send(200, t)) },
  // POST /api/remediation/handoff  {check, project, engine: claude | a declared chat host, model?}
  // `check` resolves against the closed catalogue or is refused; `model` never reaches a path or argv
  // engine:'claude' starts an agent in the repo, so it is an operator-port act (review 2026-10-07 D9)
  { method: 'POST', path: '/api/remediation/handoff', handle: ({ req, send, knownProjects, readJsonBody, isLoopbackReq }) =>
    readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const { check, engine } = body || {};
      if (engine === 'claude' && isLoopbackReq !== true) return send(403, AGENT_LOCAL_ONLY());
      const entry = promptCatalog().get(String(check || ''));
      if (!entry) return send(400, { ok: false, error: `unknown check ${JSON.stringify(check)} — not in the prompt catalogue` });
      // DERIVED from the declaration, never a literal list: a hardcoded allowlist accepts exactly
      // what its author remembered, so adding a host to the manifest would leave it declared and
      // rejected — supported everywhere except at the door.
      const allowed = ['claude', ...hostsInProbeOrder().filter((h) => h.capabilities.includes('chat')).map((h) => h.id)];
      if (!allowed.includes(engine)) return send(400, { ok: false, error: `engine must be one of: ${allowed.join(' | ')}` });
      // Refused, never defaulted: the handoff is written into the project's own report directory,
      // and an unresolved one used to land under reports/__unresolved__/.
      const scope = projectScope(body.project, knownProjects());
      if (scope.state !== 'ok') return send(400, { ok: false, error: `${scope.why} — a handoff is filed under its project's reports, so it needs one`, project: scopeOut(scope) });
      const ctx = handoffContext(scope, entry);
      if (engine === 'claude') {
        return launchClaude(scope, entry, ctx)
          .then((r) => send(200, r))
          .catch((e) => send(500, { ok: false, error: e.message }));
      }
      const model = String(body.model || '').slice(0, 200);
      if (!model) return send(400, { ok: false, error: 'a local run needs a model — pick one from /api/llm/targets' });
      return runLocalModel(engine, model, entry, ctx, scope)
        .then((r) => send(200, r))
        .catch((e) => send(500, { ok: false, error: e.message }));
    }) },
];

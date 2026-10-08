// admin/routes/codeql-remediation.mjs — per-finding dual-agent remediation for the CodeQL tab:
// independent local + Claude analyses, cross-review, lodge (disagreement lodged AS disagreement),
// and an operator-gated apply (pathspec commit + targeted resweep).

import { spawn } from 'node:child_process';
import { scannedGit } from '../../bin/lib/git-env.mjs';
import { quotedArgv } from '../../lib/posix-shell.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withinRoot } from '../../lib/path-contain.mjs'; // `startsWith(root + '/')` is false on Windows
import { createHash } from 'node:crypto';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { CW, readJSON, readJSONState, reportsFor, resolvedRepos } from '../lib/core.mjs';
import { splitThinking } from '../../lib/llm-reply.mjs';
import { writeAtomic } from '../../monitor/lockfile.mjs';
import { claudeSpawnPlan, PROFILES } from '../../lib/claude-spawn.mjs';
import { envelope, stripHidden } from '../../lib/prompt-envelope.mjs';

// Resolved from manifests/llm-hosts.json, the one declaration memory-layer and overwatch-layer share.
import { baseUrlFor } from '../../monitor/llm-hosts.mjs';
import { salvageObject, keyFromAnchor } from '../../lib/salvage-json.mjs';
const LMSTUDIO = () => baseUrlFor('lmstudio');
const LOCAL_TIMEOUT_MS = () => Number(process.env.CW_CODEQL_LOCAL_TIMEOUT_MS || 420_000); // dense 27B cold-load measured >158s; same margin as remediation.mjs
const CLAUDE_TIMEOUT_MS = () => Number(process.env.CW_CODEQL_CLAUDE_TIMEOUT_MS || 900_000);
const SOURCE_CONTEXT_LINES = 80;   // ± around the scan-time line
const SOURCE_CAP = 16_000;         // bytes of source shown to the agents — truncation is STATED

// SARIF filename → resweep check id; an unknown name yields no resweep, stated as such.
const RESWEEP_CHECK = { 'codeql-java.sarif': 'sast-codeql-java', 'codeql.sarif': 'sast-codeql' };

// ── identity ────────────────────────────────────────────────────────────────────────────────────
// service|sarif|ruleId|file — LINE EXCLUDED (never key identity on line numbers); one job file per
// identity, a re-run supersedes.
export const findingKey = (f) => [f.service, f.sarif, f.ruleId, f.file].map((x) => String(x ?? '')).join('|');
export const jobIdFor = (f) => createHash('sha256').update(findingKey(f)).digest('hex').slice(0, 16);

const jobsDir = (project) => join(reportsFor(project), 'codeql-remediation');
const iso = () => new Date().toISOString();

// job narration for the console popout; capped, oldest lines dropped and stated.
const EVENT_CAP = 120;
function logEvent(job, msg) {
  job.events = job.events || [];
  job.events.push({ at: iso(), msg: String(msg).slice(0, 400) });
  if (job.events.length > EVENT_CAP) job.events = [{ at: job.events[0].at, msg: `(${job.events.length - EVENT_CAP + 1} earlier events dropped)` }, ...job.events.slice(-(EVENT_CAP - 1))];
}

// atomic write (tmp+rename), same discipline as every other store in this repo
function writeJob(project, job) {
  const dir = jobsDir(project);
  mkdirSync(dir, { recursive: true });
  job.updatedAt = iso();
  const p = join(dir, `${job.id}.json`);
  writeAtomic(p, JSON.stringify(job, null, 2) + '\n');
  return p;
}

// ── schema ──────────────────────────────────────────────────────────────────────────────────────
let _schema = null;
function schema() {
  if (_schema) return _schema;
  try { _schema = JSON.parse(readFileSync(join(CW, 'schema', 'codeql-remediation.schema.json'), 'utf8')); }
  catch (e) { throw new Error(`codeql-remediation schema unreadable (schema/codeql-remediation.schema.json): ${e.message} — runs are refused rather than degrading to free-form output`); }
  if (!_schema.analysis || !_schema.cross) { _schema = null; throw new Error('codeql-remediation schema is missing its analysis/cross shapes — runs refused'); }
  return _schema;
}

const CLASSIFICATIONS = new Set(['real', 'false-positive', 'needs-human']);
function shapeCheck(v, { cross = false } = {}) {
  if (!v || typeof v !== 'object') return null;
  if (!CLASSIFICATIONS.has(v.classification)) return null;
  if (typeof v.diff !== 'string' || typeof v.remediation !== 'string') return null;
  if (cross && typeof v.agreesWithPeer !== 'boolean') {
    // derived only when absent and MARKED derived — agreement rests on the classifications, not this
    v.agreesWithPeer = null; v.agreesWithPeerDerived = true;
  }
  return v;
}
const defence = (s) => String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

// ── local model (LM Studio) ─────────────────────────────────────────────────────────────────────
export async function resolveLocalModel() {
  const pinned = process.env.CW_CODEQL_LOCAL_MODEL;
  if (pinned) return { ok: true, model: pinned, pinned: true };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 3000);
  try {
    const r = await fetch(`${LMSTUDIO()}/v1/models`, { signal: ac.signal });
    if (!r.ok) return { ok: false, error: `LM Studio answered HTTP ${r.status} at ${LMSTUDIO()}` };
    const ids = (((await r.json()).data) || []).map((m) => m && m.id).filter((s) => typeof s === 'string');
    // "Qwen 3.8" as the operator means it: the qwen3.8 family (qwen/qwen3.8-…) or a qwen3-8b id.
    const hit = ids.find((id) => /qwen[/-]?3[._-]?8/i.test(id) && !/embed/i.test(id));
    if (!hit) return { ok: false, error: `no Qwen 3.8-family model is loaded in LM Studio — available: ${ids.join(', ') || '(none)'}; load one or pin CW_CODEQL_LOCAL_MODEL` };
    return { ok: true, model: hit, pinned: false };
  } catch (e) {
    return { ok: false, error: `LM Studio unreachable at ${LMSTUDIO()}: ${e.name === 'AbortError' ? 'no answer within 3s' : e.message}` };
  } finally { clearTimeout(t); }
}

// salvageAnchor is the caller's first schema key, for output that lands in the reasoning channel.
export async function runLocal(model, systemPrompt, userPrompt, jsonSchema, schemaName, extSignal, salvageAnchor = '{"classification"') {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), LOCAL_TIMEOUT_MS());
  // operator stop aborts the same controller as the timeout
  const onExt = () => ac.abort();
  if (extSignal) { if (extSignal.aborted) ac.abort(); else extSignal.addEventListener('abort', onExt, { once: true }); }
  let content = '', explicitThinking = null;
  try {
    const r = await fetch(`${LMSTUDIO()}/v1/chat/completions`, {
      method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' },
      // temperature PINNED to 0 — an unpinned rater cannot be re-derived, and this route's output
      // is written into the adjudication ledger as evidence. Unreproducible evidence is not evidence.
      body: JSON.stringify({ model, temperature: 0,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: jsonSchema } } }),
    });
    if (!r.ok) return { ok: false, error: `lmstudio answered HTTP ${r.status}` };
    const j = await r.json();
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    content = msg.content || '';
    explicitThinking = msg.reasoning_content || msg.reasoning || null;
  } catch (e) {
    if (extSignal && extSignal.aborted) return { ok: false, stopped: true, error: 'stopped by operator' };
    return { ok: false, error: ac.signal.aborted ? `local model timed out after ${Math.round(LOCAL_TIMEOUT_MS() / 1000)}s — a cold load of a big model on a paging machine is the usual cause` : `local model unreachable: ${e.message}` };
  } finally { clearTimeout(t); if (extSignal) extSignal.removeEventListener('abort', onExt); }
  const { thinking, answer: reply } = splitThinking(content, explicitThinking);
  let verdict = null, salvaged = false;
  try { verdict = JSON.parse(defence(reply)); } catch { /* salvage below */ }
  if (!verdict && thinking) {
    // the whole output may land in the reasoning channel — salvage the last balanced object that
    // carries the required key, MARK it salvaged. By KEY, never by the anchor's property order
    // (G3): `salvageAnchor` keeps its name and accepts either a key or the legacy '{"key"' form.
    const s = salvageObject(thinking, keyFromAnchor(salvageAnchor));
    if (s) { verdict = s.value; salvaged = true; }
  }
  return { ok: true, verdict, salvaged, thinking, raw: reply };
}

// ── claude -p (Opus) ────────────────────────────────────────────────────────────────────────────
// Prompt over STDIN (argv is visible fleet-wide in ps); CW_CODEQL_CLAUDE_CMD is the test seam.
// guard: analysis runs in a scratch cwd and reads the repo via --add-dir, so the repo's hooks and settings never load (review 2026-10-07 D2)
function runClaude(prompt, repo, ctrl) {
  return new Promise((resolvePromise) => {
    let plan;
    try { plan = claudeSpawnPlan(PROFILES.codeql, { readDirs: repo ? [repo] : [] }); }
    catch (e) { return resolvePromise({ ok: false, error: `claude -p not started: ${e.message}` }); }
    const seam = process.env.CW_CODEQL_CLAUDE_CMD ? quotedArgv(process.env.CW_CODEQL_CLAUDE_CMD) : null;
    const argv = seam || [plan.file, ...plan.args];
    // the scratch cwd holds nothing, so the agent is told where the repository is
    const input = repo ? `Repository root (finding paths are relative to it; read it with Read, Grep and Glob): ${repo}\n\n${prompt}` : prompt;
    let out = '', err = '', settled = false;
    let stopFn = null;
    const finish = (r) => { if (!settled) { settled = true; plan.cleanup(); if (ctrl && stopFn) ctrl.kills.delete(stopFn); resolvePromise(r); } };
    let p;
    // detached process-group leader — a stop must reach claude's tool subprocesses too
    try { p = spawn(argv[0], argv.slice(1), { cwd: plan.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: plan.env }); }
    catch (e) { return finish({ ok: false, error: `could not spawn ${argv[0]}: ${e.message}` }); }
    const killTree = (sig) => { try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch { /* already gone */ } } };
    stopFn = () => { killTree('SIGTERM'); setTimeout(() => { if (!settled) killTree('SIGKILL'); }, 2000); };
    if (ctrl) ctrl.kills.add(stopFn);
    const t = setTimeout(() => { killTree('SIGKILL'); finish({ ok: false, error: `claude -p timed out after ${Math.round(CLAUDE_TIMEOUT_MS() / 1000)}s` }); }, CLAUDE_TIMEOUT_MS());
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); finish({ ok: false, error: `could not spawn ${argv[0]}: ${e.message}` }); });
    p.on('exit', (code) => {
      clearTimeout(t);
      if (settled) return;
      if (ctrl && ctrl.stopped) return finish({ ok: false, stopped: true, error: 'stopped by operator' });
      if (code !== 0) return finish({ ok: false, error: `claude -p exited ${code}: ${err.trim().slice(0, 500) || '(no stderr)'}` });
      let verdict = null, raw = out.trim();
      try {
        const outer = JSON.parse(defence(raw));
        // --output-format json wraps the reply; a stub (or a future format) may emit the verdict bare
        const inner = outer && typeof outer.result === 'string' ? JSON.parse(defence(outer.result)) : outer;
        verdict = inner;
      } catch { /* stated by the caller's shape check */ }
      finish({ ok: true, verdict, raw: raw.slice(0, 20_000) });
    });
    p.stdin.on('error', () => { /* child died first — exit handler reports it */ });
    p.stdin.end(input);
  });
}

// ── prompts ─────────────────────────────────────────────────────────────────────────────────────
// The builders are exported pure so bin/test/injection-corpus.test.mjs can replay a corpus through them.
export function sourceContext(repoPath, file, line) {
  if (!repoPath) return { text: null, note: 'repository path not resolved on this box — source not read' };
  const p = resolve(repoPath, file);
  // withinRoot(): the old `startsWith(resolve(repoPath) + '/')` is false for every path on Windows,
  // where resolve() yields backslashes — so every source read was refused. See lib/path-contain.mjs.
  if (!withinRoot(repoPath, p)) return { text: null, note: 'finding path escapes the repository — source read refused' };
  let src; try { src = readFileSync(p, 'utf8'); } catch { return { text: null, note: `source file ${file} not readable in the working tree — it may have moved since the scan` }; }
  const lines = src.split('\n');
  const at = Number(line) || 1;
  const from = Math.max(1, at - SOURCE_CONTEXT_LINES), to = Math.min(lines.length, at + SOURCE_CONTEXT_LINES);
  let text = lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n');
  let capped = false;
  if (text.length > SOURCE_CAP) { text = text.slice(0, SOURCE_CAP); capped = true; }
  return { text, note: `lines ${from}-${to} of ${lines.length}${capped ? ` (capped at ${SOURCE_CAP} bytes — your conclusions are a floor, say so)` : ''}` };
}

const VERDICT_FIELDS_ANALYSIS = 'Respond ONLY with a JSON object: {"classification": "real"|"false-positive"|"needs-human", "investigation": string, "falsePositiveAnalysis": string, "remediation": string, "diff": string (unified diff, git-apply-able from the repo root with a/ b/ prefixes; "" when no change is warranted), "confidence": "low"|"medium"|"high"}. No prose outside the JSON.';
const VERDICT_FIELDS_CROSS = 'Respond ONLY with a JSON object: {"classification": "real"|"false-positive"|"needs-human", "agreesWithPeer": boolean, "positionChanged": boolean, "response": string (your analysis of the other agent\'s verdict), "remediation": string (your FINAL position), "diff": string (your FINAL unified diff; "" when no change is warranted), "confidence": "low"|"medium"|"high"}. No prose outside the JSON.';

export function findingBlock(finding, ctx) {
  const data = [
    `message: ${finding.message}`,
    '',
    ctx.text != null
      ? `source context (current working tree — may differ from the scanned commit; ${ctx.note}):\n${ctx.text}`
      : `source context NOT AVAILABLE: ${ctx.note}. Reason from the finding alone and say that you did.`,
  ].join('\n');
  return [
    '# CodeQL finding',
    `- repo/service: ${finding.service}`,
    `- rule: ${finding.ruleId}${finding.ruleName ? ` (${finding.ruleName})` : ''}`,
    `- severity: ${finding.severity}${finding.securitySeverity != null ? ` (security-severity ${finding.securitySeverity})` : ''}`,
    `- file: ${stripHidden(finding.file).text}`,
    `- line AT SCAN TIME: ${finding.line ?? 'unknown'} — code moves; the finding's identity is file+rule, NOT the line. If the code has shifted, find it rather than concluding it is gone.`,
    `- source SARIF: ${finding.sarif}`,
    '',
    envelope(data, { label: 'CodeQL finding message and source context', cap: SOURCE_CAP + 4_000 }),
  ].join('\n');
}

// House rules the MACHINE's output must obey, not just its reasoning. Two separate failures were
// visible on the panel: diffs that carried the agent's argument as a comment block, and a
// `remediation` field that restated the investigation instead of saying what changes.
const OUTPUT_RULES = [
  '# How your output must READ',
  'COMMENTS IN THE DIFF: this repository bans narrative comments. A comment is one terse functional line ("// Updates x", "// Fail closed: only ENOENT is absence"). Where the code explains itself, write NO comment. NEVER paste your analysis, your false-positive argument, or a justification of the fix into the source — that belongs in this JSON, not in the file. A diff whose comment restates the argument will be rejected.',
  'THE `remediation` FIELD: write it as exactly three bullets, in this order and no other prose:',
  '* Issue: what is wrong, in one sentence, in terms of what the code does — not what the rule is called.',
  '* Fix: what the diff changes, in one sentence. If the diff is empty, say what would need to change and why it is not being changed.',
  '* Caveats: what this does not cover, what a reader should check, or "none" — never omit the line.',
].join('\n');

export function analysisPrompt(finding, ctx, who) {
  return [
    `You are one of two independent security agents (${who}) investigating a single CodeQL finding. The other agent works the same finding in parallel; you will each review the other's verdict afterwards, so commit to your own analysis — do not hedge toward a hypothetical consensus.`,
    '',
    findingBlock(finding, ctx),
    '',
    '# Your tasks',
    '1. INVESTIGATE: what does the flagged code actually do — the data flow, the trust boundary, what the rule matched.',
    '2. FALSE-POSITIVE ANALYSIS: make the explicit case for and against this being a false positive, and say which side wins and why.',
    '3. REMEDIATION: the appropriate fix (or why none is needed, or why a human must decide).',
    '4. DIFF: a minimal unified diff realising the remediation — repo-root relative, a/ b/ prefixes, must apply cleanly with `git apply`. Empty string when classification is false-positive or needs-human. Never invent suppression-file syntax; if suppression is the right call, say so in prose and leave the diff empty.',
    '',
    OUTPUT_RULES,
    '',
    VERDICT_FIELDS_ANALYSIS,
  ].join('\n');
}

export function crossPrompt(finding, ctx, own, peer, whoOwn, whoPeer) {
  return [
    `You are agent ${whoOwn}. You and agent ${whoPeer} independently analyzed the same CodeQL finding. Below are BOTH verdicts. Analyze the other agent's findings, then re-analyze YOUR OWN in light of them: where the peer is right, adopt it and say your position changed; where it is wrong, refute it specifically. Then state your FINAL position.`,
    '',
    findingBlock(finding, ctx),
    '',
    `# The other agent's (${whoPeer}) verdict`,
    '```json', JSON.stringify(peer, null, 2), '```',
    '',
    `# Your (${whoOwn}) original verdict`,
    '```json', JSON.stringify(own, null, 2), '```',
    '',
    OUTPUT_RULES,
    '',
    VERDICT_FIELDS_CROSS,
  ].join('\n');
}

// The opus analysis stage as one exported call: the spawn itself stays private, so the only prompts
// that reach it are ones this module built.
// `cwd` is the old name for `repo`: the repository the agent reads, never its working directory.
export function reviewFinding(finding, ctx, { repo = null, cwd = null, ctrl = null, who = 'the reviewing agent' } = {}) {
  return runClaude(analysisPrompt(finding, ctx, who), repo || cwd, ctrl);
}

// ── the lane manager ────────────────────────────────────────────────────────────────────────────
// Each STAGE queues on its engine's lane (local defaults to 1 slot, opus 2; CW_CODEQL_*_CONCURRENCY
// read per pump). All in-memory — a restart forgets the queue, and the job files say so.
function lane(limitFn) {
  let active = 0; const waiting = [];
  const pump = () => {
    while (active < Math.max(1, limitFn() | 0) && waiting.length) {
      active++;
      const { fn, resolve, reject } = waiting.shift();
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; pump(); });
    }
  };
  return { submit: (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); pump(); }) };
}
const LOCAL_LANE = lane(() => Number(process.env.CW_CODEQL_LOCAL_CONCURRENCY || 1));
const OPUS_LANE = lane(() => Number(process.env.CW_CODEQL_OPUS_CONCURRENCY || 2));
const ACTIVE = new Set();
// per-run control blocks keyed by job id — CONTROLS membership IS "something a stop can reach".
const CONTROLS = new Map();

async function runPipeline(project, job, ctrl) {
  const save = () => writeJob(project, job);
  const STAGE_LABEL = { local: 'local analysis', opus: 'opus analysis', localCross: 'local cross-review', opusCross: 'opus cross-review' };
  // 'stopped' is terminal — never 'failed', never a verdict; finished stages keep their evidence
  const markStopped = () => {
    job.state = 'stopped'; job.stoppedAt = iso(); job.stoppedBy = ctrl.stoppedBy || 'operator'; job.error = null;
    logEvent(job, 'STOPPED by operator — run halted; finished stages keep their verdicts, no agreement or remediation is derived. Retry re-runs from scratch.');
    save();
  };
  // waiting = queued behind other findings; running = the engine is actually on it
  const stage = async (name, laneQ, fn) => {
    if (ctrl.stopped) { job.stages[name] = { status: 'stopped', finishedAt: iso() }; save(); return job.stages[name]; }
    job.stages[name] = { status: 'waiting', queuedAt: iso() };
    logEvent(job, `${STAGE_LABEL[name]} queued for its lane`);
    save();
    let r;
    try {
      r = await laneQ.submit(async () => {
        // the stop may have landed while this stage sat in its lane — the engine never starts
        if (ctrl.stopped) return { ok: false, stopped: true, error: 'stopped by operator before the engine started' };
        job.stages[name].status = 'running'; job.stages[name].startedAt = iso();
        logEvent(job, `${STAGE_LABEL[name]} started`);
        save();
        return fn();
      });
    } catch (e) { r = { ok: false, error: e.message }; }
    const verdict = r.ok ? shapeCheck(r.verdict, { cross: name.endsWith('Cross') }) : null;
    const stopped = !verdict && (r.stopped || ctrl.stopped);
    job.stages[name] = {
      ...job.stages[name], finishedAt: iso(),
      status: verdict ? 'done' : stopped ? 'stopped' : 'failed',
      verdict,
      thinking: r.thinking || null,
      salvaged: r.salvaged || false,
      raw: verdict ? null : (r.raw || null), // the raw reply is evidence exactly when it failed to parse
      error: verdict ? null : stopped ? 'stopped by operator' : (r.ok ? 'reply is not a remediation verdict (schema fields missing or malformed) — raw reply preserved' : r.error),
    };
    logEvent(job, verdict
      ? `${STAGE_LABEL[name]}: ${verdict.classification} (confidence ${verdict.confidence})${verdict.positionChanged ? ' — position CHANGED' : ''}${String(verdict.diff || '').trim() ? ' · diff offered' : ''}${r.salvaged ? ' · verdict salvaged from the reasoning channel' : ''}`
      : stopped ? `${STAGE_LABEL[name]} stopped` : `${STAGE_LABEL[name]} FAILED: ${job.stages[name].error}`);
    save();
    return job.stages[name];
  };

  try {
    job.state = 'running'; logEvent(job, 'pipeline started'); save();
    const sch = schema(); // throws before any engine is contacted — fail closed
    const local = await resolveLocalModel();
    if (!local.ok) { job.state = 'failed'; job.error = local.error; logEvent(job, `FAILED: ${local.error}`); save(); return; }
    job.engines = { local: { engine: 'lmstudio', model: local.model, pinned: !!local.pinned }, review: { engine: 'claude-p', model: 'opus' } };
    logEvent(job, `engines: lmstudio ${local.model}${local.pinned ? ' (pinned)' : ''} + claude -p opus`);

    const rr = resolvedRepos().find((x) => x.name === job.finding.service);
    const repoPath = rr && rr.path && existsSync(rr.path) ? rr.path : null;
    job.repoPath = repoPath;
    const ctx = sourceContext(repoPath, job.finding.file, job.finding.line);
    job.sourceNote = ctx.note;
    logEvent(job, `source context: ${ctx.note}`);

    // stage 1 — independent analyses, both lanes fed at once
    const [ls, os] = await Promise.all([
      stage('local', LOCAL_LANE, () => runLocal(local.model, `You are a precise application-security analyst. ${VERDICT_FIELDS_ANALYSIS}`, analysisPrompt(job.finding, ctx, 'the local analyst'), sch.analysis, 'codeql_remediation_analysis', ctrl.ac.signal)),
      stage('opus', OPUS_LANE, () => reviewFinding(job.finding, ctx, { repo: repoPath, ctrl })),
    ]);
    if (ls.status !== 'done' || os.status !== 'done') {
      if (ctrl.stopped) return markStopped();
      job.state = 'failed';
      job.error = [ls.status !== 'done' ? `local analysis failed: ${ls.error}` : null, os.status !== 'done' ? `opus analysis failed: ${os.error}` : null].filter(Boolean).join(' · ');
      logEvent(job, `FAILED: ${job.error}`);
      save(); return;
    }
    logEvent(job, 'independent analyses complete — exchanging verdicts for cross-review');

    // stage 2 — cross-review: each agent reads the other's verdict, re-analyses its own
    const [lc, oc] = await Promise.all([
      stage('localCross', LOCAL_LANE, () => runLocal(local.model, `You are a precise application-security analyst re-reviewing your own verdict against a peer's. ${VERDICT_FIELDS_CROSS}`, crossPrompt(job.finding, ctx, ls.verdict, os.verdict, 'LOCAL (you)', 'OPUS'), sch.cross, 'codeql_remediation_cross', ctrl.ac.signal)),
      stage('opusCross', OPUS_LANE, () => runClaude(crossPrompt(job.finding, ctx, os.verdict, ls.verdict, 'OPUS (you)', 'LOCAL'), repoPath, ctrl)),
    ]);
    if (lc.status !== 'done' || oc.status !== 'done') {
      if (ctrl.stopped) return markStopped();
      job.state = 'failed';
      job.error = [lc.status !== 'done' ? `local cross-review failed: ${lc.error}` : null, oc.status !== 'done' ? `opus cross-review failed: ${oc.error}` : null].filter(Boolean).join(' · ');
      logEvent(job, `FAILED: ${job.error}`);
      save(); return;
    }

    // a stop landing before the lodge still wins — no verdict is published after a stop
    if (ctrl.stopped) return markStopped();
    // stage 3 — agreement, from the FINAL (cross) classifications; then lodge, agreed or not
    const a = lc.verdict, b = oc.verdict;
    const agree = a.classification === b.classification;
    job.agreement = {
      agree,
      classifications: { local: a.classification, opus: b.classification },
      basis: agree
        ? `both agents conclude "${a.classification}" after cross-review`
        : `DISPUTED after cross-review — local: "${a.classification}", opus: "${b.classification}". Both positions are lodged; the diff below is the ${String(b.diff || '').trim() ? 'opus' : 'local'} agent's and executing it is an operator judgement.`,
    };
    // the executable diff: prefer the reviewing (opus) agent's final diff, fall back to local's
    const chosen = String(b.diff || '').trim() ? { diff: b.diff, source: 'opus-cross' }
      : String(a.diff || '').trim() ? { diff: a.diff, source: 'local-cross' } : null;
    job.remediation = {
      classification: agree ? a.classification : 'disputed',
      executable: !!chosen,
      diff: chosen ? chosen.diff : '',
      source: chosen ? chosen.source : null,
      summary: (String(b.diff || '').trim() ? b.remediation : a.remediation) || b.remediation || a.remediation,
    };
    job.state = 'lodged'; job.lodgedAt = iso(); job.error = null;
    logEvent(job, `agreement: ${job.agreement.agree ? `AGREED — both say ${a.classification}` : `DISPUTED — local ${a.classification}, opus ${b.classification}`}`);
    logEvent(job, chosen ? `lodged with an executable diff (${chosen.source})` : `lodged with no executable diff — final classification ${job.remediation.classification}`);
    save();
  } catch (e) {
    if (ctrl.stopped) return markStopped();
    job.state = 'failed'; job.error = e.message;
    logEvent(job, `FAILED: ${e.message}`);
    try { save(); } catch { /* the job dir itself failed — nothing left to record to */ }
  }
}

// ── apply: git apply → pathspec commit → targeted resweep ───────────────────────────────────────
function applyJob(project, job, trigger) {
  const rr = resolvedRepos().find((x) => x.name === job.finding.service);
  if (!rr || !rr.path || !existsSync(rr.path)) return { ok: false, error: `repository for ${job.finding.service} is not resolvable on this box` };
  const diff = job.remediation && job.remediation.diff;
  if (!diff || !diff.trim()) return { ok: false, error: 'this job lodged no executable diff' };
  const patch = join(jobsDir(project), `${job.id}.patch`);
  writeFileSync(patch, diff.endsWith('\n') ? diff : diff + '\n');
  // a fleet repo, written on the host: its commit hooks and filter drivers do not run here
  const git = (args) => scannedGit(rr.path, args);
  const fail = (what, r) => ({ ok: false, error: `${what}: ${(r.stderr || r.stdout || '').trim().slice(0, 600) || `exit ${r.status}`}` });

  const chk = git(['apply', '--check', '--whitespace=nowarn', patch]);
  if (chk.status !== 0) return fail('git apply --check refused the lodged diff (the tree may have moved since it was lodged — re-run the analysis)', chk);
  const ap = git(['apply', '--whitespace=nowarn', patch]);
  if (ap.status !== 0) return fail('git apply failed after a clean --check', ap);

  // pathspec-scoped commit — another session's staged work must not ride along
  const files = [...new Set([...diff.matchAll(/^(?:\+\+\+|---) [ab]\/(.+)$/gm)].map((m) => m[1].trim()).filter((f) => f && f !== 'dev/null'))];
  const rollback = () => { try { git(['apply', '-R', '--whitespace=nowarn', patch]); } catch { /* best effort */ } };
  if (!files.length) { rollback(); return { ok: false, error: 'could not derive the touched files from the diff — applied change rolled back' }; }
  const add = git(['add', '--', ...files]);
  if (add.status !== 0) { rollback(); return fail('git add failed — applied change rolled back', add); }
  const msg = `codeql remediation: ${job.finding.ruleId} in ${job.finding.file} — dual-agent job ${job.id}, ${job.agreement && job.agreement.agree ? 'agents in agreement' : 'lodged under dispute'} (${job.remediation.source})`;
  const cm = git(['commit', '-m', msg, '--', ...files]);
  if (cm.status !== 0) { git(['reset', '--', ...files]); rollback(); return fail('git commit failed — applied change rolled back', cm); }
  const head = git(['rev-parse', 'HEAD']).stdout.trim();

  // targeted resweep of THIS repo's CodeQL check, through the same trigger() the ⏺ buttons use
  const check = RESWEEP_CHECK[job.finding.sarif] || null;
  const resweep = !check
    ? { started: false, reason: `no resweep check mapped for SARIF ${JSON.stringify(job.finding.sarif)}` }
    : typeof trigger === 'function'
      ? trigger('sweep', project, { check, repo: rr.name, label: `resweep · ${rr.name} · ${job.finding.ruleId}` })
      : { started: false, reason: 'trigger unavailable to this route' };
  job.applied = { at: iso(), commit: head, files, message: msg, resweep };
  job.state = 'applied';
  logEvent(job, `applied as ${head.slice(0, 8)} (${files.join(', ')})`);
  logEvent(job, resweep.started ? 'targeted resweep started' : `resweep NOT started — ${resweep.reason}`);
  writeJob(project, job);
  return { ok: true, id: job.id, commit: head, files, resweep };
}

// ── job store reads (fail closed: a parse failure is its own state, never an empty list) ────────
function listJobs(project) {
  const dir = jobsDir(project);
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); }
  catch (e) { if (e.code === 'ENOENT') return { ok: true, jobs: [] }; return { ok: false, error: `job store unreadable: ${e.message}`, jobs: [] }; }
  const jobs = names.map((n) => {
    const j = readJSON(join(dir, n));
    if (!j) return { id: n.replace(/\.json$/, ''), state: 'unreadable', error: 'job file did not parse — this is not an absent job' };
    // queued/running with no in-memory pipeline is 'orphaned' — derived at READ time from ACTIVE,
    // never repaired on disk
    const state = ['queued', 'running'].includes(j.state) && !ACTIVE.has(j.id) ? 'orphaned' : j.state;
    return {
      id: j.id, key: j.key, state, updatedAt: j.updatedAt, lodgedAt: j.lodgedAt || null,
      finding: j.finding ? { service: j.finding.service, ruleId: j.finding.ruleId, file: j.finding.file, sarif: j.finding.sarif, severity: j.finding.severity, line: j.finding.line ?? null } : null,
      agreement: j.agreement || null,
      executable: !!(j.remediation && j.remediation.executable),
      error: j.error || null,
      // per-stage status + verdict heart, so the console streams without pulling full records
      stages: j.stages ? Object.fromEntries(Object.entries(j.stages).map(([k, v]) => [k, {
        status: v.status,
        queuedAt: v.queuedAt || null,
        startedAt: v.startedAt || null,
        classification: (v.verdict && v.verdict.classification) || null,
        confidence: (v.verdict && v.verdict.confidence) || null,
        diff: !!(v.verdict && String(v.verdict.diff || '').trim()),
      }])) : {},
      events: (j.events || []).slice(-14),
      applied: j.applied ? { at: j.applied.at, commit: j.applied.commit, resweep: j.applied.resweep } : null,
    };
  });
  jobs.sort((x, y) => String(y.updatedAt || '').localeCompare(String(x.updatedAt || '')));
  return { ok: true, jobs };
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────────
// The POSTs execute — beyond CSRF they require a session or the loopback operator port.
const authed = (ctx) => ctx.isLoopbackReq || !!ctx.adminSession(ctx.req);
const resolveProject = (ctx, raw) => {
  const known = ctx.knownProjects();
  return raw && (known.has(raw) || known.has(projectSlug(raw))) ? raw : null;
};

export const routes = [
  { method: 'GET', path: '/api/codeql/remediation', handle: (ctx) => {
    const proj = resolveProject(ctx, ctx.query.get('project'));
    return ctx.send(200, listJobs(proj));
  } },

  { method: 'GET', path: '/api/codeql/remediation/job', handle: (ctx) => {
    const proj = resolveProject(ctx, ctx.query.get('project'));
    const id = String(ctx.query.get('id') || '');
    if (!/^[a-f0-9]{16}$/.test(id)) return ctx.send(400, { ok: false, error: 'id must be a 16-hex job id' });
    const r = readJSONState(join(jobsDir(proj), `${id}.json`));
    if (r.state === 'absent') return ctx.send(404, { ok: false, error: 'no such job' });
    // A record that exists and will not read as a job is a fault here, not a missing job: 500, as
    // cobolwork's detail read answers. A 404 told the client to treat a torn file as never filed.
    if (r.state !== 'ok' || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) {
      return ctx.send(500, { ok: false, error: 'job file did not parse — this is not an absent job', why: r.why || 'not a job object' });
    }
    return ctx.send(200, { ok: true, job: r.value });
  } },

  // POST /api/codeql/remediate {project, service, ruleId, file, sarif}
  // The finding must exist in the area's codeql-fleet.json — the request selects, it never supplies.
  { method: 'POST', path: '/api/codeql/remediate', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, async (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route executes — sign in, or use the operator port' });
      const proj = resolveProject(ctx, body && body.project);
      const fleet = readJSON(join(reportsFor(proj), 'codeql-fleet.json'));
      if (!fleet || !Array.isArray(fleet.findings)) return ctx.send(409, { ok: false, error: 'no codeql-fleet.json for this project — nothing to remediate against (generate with node monitor/codeql-fleet-data.mjs)' });
      const want = { service: String(body.service || ''), ruleId: String(body.ruleId || ''), file: String(body.file || ''), sarif: String(body.sarif || '') };
      const finding = fleet.findings.find((f) => f.service === want.service && f.ruleId === want.ruleId && f.file === want.file && f.sarif === want.sarif);
      if (!finding) return ctx.send(404, { ok: false, error: 'that finding is not in the current codeql-fleet.json — the fleet file may have been regenerated since the tab loaded' });
      const id = jobIdFor(finding);
      if (ACTIVE.has(id)) return ctx.send(409, { ok: false, error: 'a remediation run for this finding is already queued or running', id });
      const local = await resolveLocalModel(); // refuse NOW with an actionable answer, not a failed job later
      if (!local.ok) return ctx.send(409, { ok: false, error: local.error });
      const job = {
        schema: 'commitwork/codeql-remediation-job.v1',
        id, key: findingKey(finding), project: proj, createdAt: iso(),
        finding: { ...finding }, state: 'queued',
        engines: { local: { engine: 'lmstudio', model: local.model, pinned: !!local.pinned }, review: { engine: 'claude-p', model: 'opus' } },
        stages: {}, agreement: null, remediation: null, error: null, applied: null,
      };
      writeJob(proj, job);
      ACTIVE.add(id);
      const ctrl = { stopped: false, stoppedBy: null, ac: new AbortController(), kills: new Set() };
      CONTROLS.set(id, ctrl);
      // fire-and-forget — stages queue on the engine lanes
      runPipeline(proj, job, ctrl).catch(() => { /* recorded on the job */ }).finally(() => { ACTIVE.delete(id); CONTROLS.delete(id); });
      return ctx.send(200, { ok: true, id, state: 'queued', engines: job.engines });
    }) },

  // POST /api/codeql/remediate/stop {project, id} — halt a running remediation
  { method: 'POST', path: '/api/codeql/remediate/stop', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route signals processes — sign in, or use the operator port' });
      const proj = resolveProject(ctx, body && body.project);
      const id = String((body && body.id) || '');
      if (!/^[a-f0-9]{16}$/.test(id)) return ctx.send(400, { ok: false, error: 'id must be a 16-hex job id' });
      const ctrl = CONTROLS.get(id);
      if (!ctrl) {
        const j = readJSON(join(jobsDir(proj), `${id}.json`));
        return ctx.send(409, { ok: false, error: j ? `nothing is running for this job — it is ${j.state}` : 'no such job' });
      }
      if (!ctrl.stopped) {
        ctrl.stopped = true; ctrl.stoppedBy = 'operator';
        try { ctrl.ac.abort(); } catch { /* nothing in flight on the local lane */ }
        for (const kill of [...ctrl.kills]) { try { kill(); } catch { /* child already gone */ } }
      }
      return ctx.send(200, { ok: true, stopping: true, id,
        note: 'waiting stages will not start; the local request is aborted; the claude process group gets SIGTERM, SIGKILL after 2s. Finished stage verdicts are kept as evidence; the job records "stopped" and no remediation is lodged.' });
    }) },

  // POST /api/codeql/remediation/clear {project, id?} — remove finished job records (+ .patch);
  // a queued/running job is refused, never killed from here
  { method: 'POST', path: '/api/codeql/remediation/clear', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route deletes records — sign in, or use the operator port' });
      const proj = resolveProject(ctx, body && body.project);
      const dir = jobsDir(proj);
      const one = body && body.id != null ? String(body.id) : null;
      if (one && !/^[a-f0-9]{16}$/.test(one)) return ctx.send(400, { ok: false, error: 'id must be a 16-hex job id' });
      if (one && ACTIVE.has(one)) return ctx.send(409, { ok: false, error: 'that job is queued or running — a pipeline in flight is not cleared, it finishes or fails' });
      let names = [];
      try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); }
      catch (e) { return e.code === 'ENOENT' ? ctx.send(200, { ok: true, cleared: 0, kept: 0 }) : ctx.send(500, { ok: false, error: `job store unreadable: ${e.message}` }); }
      let cleared = 0, kept = 0;
      for (const n of names) {
        const id = n.replace(/\.json$/, '');
        if (one && id !== one) { kept++; continue; }
        if (ACTIVE.has(id)) { kept++; continue; }
        try { unlinkSync(join(dir, n)); cleared++; } catch { kept++; continue; }
        try { unlinkSync(join(dir, `${id}.patch`)); } catch { /* no patch was written for this job */ }
      }
      if (one && !cleared) return ctx.send(404, { ok: false, error: 'no such job' });
      return ctx.send(200, { ok: true, cleared, kept });
    }) },

  // POST /api/codeql/remediate/apply {project, id} — the panel's ▶ button
  { method: 'POST', path: '/api/codeql/remediate/apply', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route commits code — sign in, or use the operator port' });
      const proj = resolveProject(ctx, body && body.project);
      const id = String((body && body.id) || '');
      if (!/^[a-f0-9]{16}$/.test(id)) return ctx.send(400, { ok: false, error: 'id must be a 16-hex job id' });
      const job = readJSON(join(jobsDir(proj), `${id}.json`));
      if (!job) return ctx.send(404, { ok: false, error: 'no such job (or its file did not parse)' });
      if (job.state === 'applied') return ctx.send(409, { ok: false, error: `already applied as ${job.applied && job.applied.commit}`, applied: job.applied });
      if (job.state !== 'lodged') return ctx.send(409, { ok: false, error: `job is ${job.state}, not lodged — only a lodged remediation can be executed` });
      const r = applyJob(proj, job, ctx.trigger);
      return ctx.send(r.ok ? 200 : 422, r);
    }) },
];

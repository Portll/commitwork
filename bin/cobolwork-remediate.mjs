#!/usr/bin/env node
// bin/cobolwork-remediate.mjs — cobolwork remediation from a terminal: draft and gate a fix for one
// finding, apply what the gate passed, verify it held. The same jobs the panel route writes.
//
// usage:
//   node bin/cobolwork-remediate.mjs draft  --repo <path> --fingerprint <fp> [--name <repo>] [--attempts N] [--remote]
//   node bin/cobolwork-remediate.mjs apply  --repo <path> --job <id> [--acknowledge-undecided]
//   node bin/cobolwork-remediate.mjs verify --repo <path> --job <id>
//   node bin/cobolwork-remediate.mjs list
// --dir <path> (or CW_COBOLWORK_REMEDIATION_DIR) is where job files live; default reports/cobolwork-remediation.
// exit: 0 done · 1 refused, failed, or a verdict other than pass · 2 usage

import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { FINGERPRINT_RE } from '../lib/cobolwork-bridge.mjs';
import { jobIdFor } from '../lib/cobolwork-remediation.mjs';
import { resolveLocalModel, lmStudioDrafter, claudeReviewer } from '../lib/cobolwork-remediation-engines.mjs';
import { draftingAllowed, newJob, readJob, listJobs, runJob, applyJob, verifyJob, writeJob } from '../lib/cobolwork-remediation-jobs.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--repo') o.repo = val();
    else if (a === '--fingerprint') o.fingerprint = val();
    else if (a === '--name') o.name = val();
    else if (a === '--attempts') o.attempts = Number(val());
    else if (a === '--job') o.job = val();
    else if (a === '--dir') o.dir = val();
    else if (a === '--remote') o.remote = true;
    else if (a === '--acknowledge-undecided') o.acknowledgeUndecided = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

const out = (doc) => process.stdout.write(JSON.stringify(doc, null, 1) + '\n');

export async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { process.stderr.write(`cobolwork-remediate: ${e.message}\n`); return 2; }
  const cmd = o._[0];
  const dir = resolve(o.dir || process.env.CW_COBOLWORK_REMEDIATION_DIR || join(CW, 'reports', 'cobolwork-remediation'));
  if (cmd === 'list') { out(listJobs(dir)); return 0; }
  if (!['draft', 'apply', 'verify'].includes(cmd) || !o.repo) {
    process.stderr.write('usage: cobolwork-remediate draft|apply|verify --repo <path> (--fingerprint <fp> | --job <id>); or list\n');
    return 2;
  }
  const repoPath = resolve(o.repo);
  if (cmd === 'draft') {
    if (!FINGERPRINT_RE.test(String(o.fingerprint || ''))) { process.stderr.write('cobolwork-remediate: --fingerprint is the 32-hex cobolwork fingerprint\n'); return 2; }
    const allowed = draftingAllowed();
    if (!allowed.ok) { out({ ok: false, error: allowed.error }); return 1; }
    const local = await resolveLocalModel();
    if (!local.ok) { out({ ok: false, error: local.error }); return 1; }
    const job = newJob({ repo: o.name || basename(repoPath), fingerprint: o.fingerprint, maxAttempts: Math.min(5, Math.max(1, o.attempts || 3)), remote: !!o.remote,
      engines: { drafter: { engine: 'lmstudio', model: local.model, pinned: !!local.pinned }, reviewer: o.remote ? { engine: 'claude-p' } : null } });
    writeJob(dir, job);
    const done = await runJob(dir, job, { repoPath, drafter: lmStudioDrafter({ model: local.model }), reviewer: o.remote ? claudeReviewer() : null });
    out({ ok: done.state === 'lodged', id: done.id, state: done.state, final: done.final && { verdict: done.final.verdict, outcome: done.final.outcome, attempt: done.final.attempt, files: done.final.files },
      attempts: done.attempts.map((a) => ({ n: a.n, verdict: a.verdict || null, outcome: a.outcome || null, rejected: !!a.rejected, error: a.error || null })), error: done.error, file: join(dir, `${done.id}.json`) });
    return done.state === 'lodged' && done.final.verdict === 'pass' ? 0 : 1;
  }
  const id = /^[a-f0-9]{16}$/.test(String(o.job || '')) ? o.job : (o.fingerprint && FINGERPRINT_RE.test(o.fingerprint) ? jobIdFor(o.name || basename(repoPath), o.fingerprint) : null);
  if (!id) { process.stderr.write('cobolwork-remediate: --job is a 16-hex job id\n'); return 2; }
  const r = readJob(dir, id);
  if (!r.job) { out({ ok: false, error: r.unreadable || `no job ${id} in ${dir}` }); return 1; }
  const res = cmd === 'apply'
    ? await applyJob(dir, r.job, { repoPath, acknowledgeUndecided: !!o.acknowledgeUndecided })
    : await verifyJob(dir, r.job, { repoPath, artifact: join(dir, `${id}.json`) });
  out(res);
  return res.ok && (cmd === 'apply' || res.verdict === 'pass') ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`cobolwork-remediate: ${e.stack || e.message}\n`); process.exitCode = 2; });
}

#!/usr/bin/env node
// cra/refresh.mjs — produce the WHOLE compliance-evidence set in one command, and sign it.
//
// The individual tools are separately runnable, but day-to-day (after a sweep, or on a
// schedule) you want one call that regenerates everything in the right order, signs the
// durable evidence, and leaves a catalogue of what was produced. Order matters:
//
//   preflight (gate) → sbom → vex → pack → poam (+ xlsx) → soc2 → coverage
//   → watch (clocks last, on the freshest evidence) → dashboard
//   → attest sign + verify (over rollup/ledger/cases/annotations/products)
//   → timestamp (an RFC 3161 token per signature record, then verified; only when CW_TSA_URL is set)
//   → evidence-index.json (every artifact + its sha256, and the inputs it was built from)
//   → refresh-status.json (how this run ended — exit + reason — read by cra/evidence-status.mjs)
//
// Non-gate step failures are reported and the run continues; the process exit is the worst
// child's (watch overdue=3 / stale=4 and timestamp unanchored=20 propagate) so a scheduled run
// signals real problems.
// `--fetch` refreshes the KEV catalog. Zero deps.
//
//   node cra/refresh.mjs [--fetch] [--product <id>] [--no-sign] [--no-xlsx]
//   env, read at call time: CW_TSA_URL (the TSA the timestamp step asks; unset skips the step)

import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolvePaths, writeJSONAtomic, sha256, nowISO, resolveKeyDir, ATTEST_KEY } from './lib.mjs';
import { fingerprintInputs, worstTimestamp, EVIDENCE_INDEX, EVIDENCE_INDEX_SCHEMA, REFRESH_STATUS, REFRESH_STATUS_SCHEMA } from './evidence-status.mjs';
import { evidenceArtifacts } from './attest.mjs';
import { EXIT as TSA_EXIT } from './timestamp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s), cyan = (s) => c('36', s);

const argv = process.argv.slice(2);
const productArgs = argv.includes('--product') ? ['--product', argv[argv.indexOf('--product') + 1]] : [];
const fetchEnv = argv.includes('--fetch') ? { CRA_FETCH: '1' } : {};
const doSign = !argv.includes('--no-sign');
const doXlsx = !argv.includes('--no-xlsx');

const paths = resolvePaths();
const startedAt = nowISO();
const lastLine = (s) => (s || '').trim().split('\n').slice(-1)[0]?.replace(/\x1b\[[0-9;]*m/g, '').trim() || '';
// Written on every exit path, the gate's included, so a failed scheduled run is visible to the
// freshness reader rather than only in a launchd log.
function recordRun(exit, reason, steps) {
  writeJSONAtomic(join(paths.out, REFRESH_STATUS), {
    schema: REFRESH_STATUS_SCHEMA, startedAt, finishedAt: nowISO(), exit,
    ok: !steps.some((s) => s.outcome === 'failed'), reason, steps,
  });
}
// Probe the ONE directory attest.mjs will actually read (lib.mjs resolveKeyDir) — not the default
// OR the override, which scheduled a sign step that attest.mjs then failed with exit 2.
const keyPresent = existsSync(join(resolveKeyDir(paths), ATTEST_KEY));

// [id, cmd, args, {gate?, optional?, env?}] — cmd 'node:<script>' or 'py:<script>'
const steps = [
  ['preflight', 'node:preflight.mjs', [], { gate: true }],
  ['sbom', 'node:sbom.mjs', productArgs, { optional: true }],   // needs a sweep's per-repo SBOMs
  ['vex', 'node:vex.mjs', productArgs, {}],
  ['pack', 'node:pack.mjs', productArgs, {}],
  ['poam', 'node:poam.mjs', productArgs, {}],
  ...(doXlsx ? [['poam-xlsx', 'py:poam-to-xlsx.py', productArgs, { optional: true }]] : []), // needs python/openpyxl
  ['soc2', 'node:soc2.mjs', productArgs, {}],
  ['coverage', 'node:controls.mjs', ['coverage', ...productArgs], {}],
  ['oscal', 'node:oscal.mjs', productArgs, {}],                 // NIST + SOC 2 controls as machine-readable OSCAL
  ['watch', 'node:watch.mjs', ['watch'], { env: fetchEnv }],    // clocks reflect freshest evidence
  ['dashboard', 'node:dashboard.mjs', [], {}],
  ...(doSign && keyPresent ? [['sign', 'node:attest.mjs', ['sign'], {}], ['verify', 'node:attest.mjs', ['verify'], {}]] : []),
];

console.log(bold('cra refresh') + dim(`  full evidence pipeline${productArgs.length ? ` · product=${productArgs[1]}` : ''}`));
if (doSign && !keyPresent) console.log(yel('  (signing skipped — no attestation key; run `node cra/attest.mjs keygen` to enable)'));

let worst = 0;
const results = [];
for (const [id, cmd, args, opts] of steps) {
  const [kind, script] = cmd.split(':');
  const exe = kind === 'py' ? 'python3' : 'node';
  process.stdout.write(dim(`  ▸ ${id} … `));
  const r = spawnSync(exe, [join(HERE, script), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, ...(opts.env || {}) },
  });
  const code = r.status ?? 1;
  const tail = lastLine(r.stdout);
  const why = r.error ? r.error.message : (lastLine(r.stderr) || (r.signal ? `killed by ${r.signal}` : tail) || null);
  if (code === 0) { results.push({ step: id, exit: code, outcome: 'ok' }); console.log(grn('ok') + dim(tail ? ` — ${tail}` : '')); }
  else if (id === 'watch' && (code === 3 || code === 4)) {
    results.push({ step: id, exit: code, outcome: 'signal', reason: code === 3 ? 'overdue clock(s)' : 'stale evidence' });
    console.log(yel(code === 3 ? 'OVERDUE clock(s)' : 'STALE evidence')); worst = Math.max(worst, code);
  }
  else if (opts.optional) { results.push({ step: id, exit: code, outcome: 'skipped', reason: why }); console.log(yel(`skipped (exit ${code})`) + dim(r.stderr ? ` — ${lastLine(r.stderr)}` : '')); }
  else {
    results.push({ step: id, exit: code, outcome: 'failed', reason: why });
    console.log(red(`failed (exit ${code})`));
    if (r.stderr) console.log(dim('    ' + r.stderr.trim().split('\n').slice(-2).join('\n    ')));
    worst = Math.max(worst, code);
    if (opts.gate) {
      recordRun(code, `preflight gate failed (exit ${code}): ${why || 'no reason on stderr'}`, results);
      console.log(red('  ✗ preflight gate failed — fix config (node cra/preflight.mjs) before evidence can be trusted')); process.exit(code);
    }
  }
}

// ── timestamp: an RFC 3161 token over each signature record attest sign wrote ──────────────────
// Treated as sign is: unconfigured, it is skipped and the run is unaffected; configured and failing,
// the step fails and so does the run. A skip records timestamp.mjs's "absent" exit, never 0.
function runTimestamp(cmd, files) {
  const r = spawnSync('node', [join(HERE, 'timestamp.mjs'), cmd, ...files, '--json'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  let verdicts = null;
  try { const v = JSON.parse(r.stdout); if (Array.isArray(v)) verdicts = v; } catch {}
  return { code: r.status ?? 1, verdicts, why: r.error ? r.error.message : (lastLine(r.stderr) || (r.signal ? `killed by ${r.signal}` : null)) };
}

function timestampStep() {
  const end = (outcome, exit, reason, records = []) => ({
    result: { step: 'timestamp', exit, outcome, ...(outcome === 'ok' ? {} : { reason }) },
    record: { state: worstTimestamp(records.map((r) => r.state)), reason: outcome === 'ok' ? null : reason, revocation: 'not checked', records },
  });
  if (!process.env.CW_TSA_URL) return end('skipped', TSA_EXIT.ABSENT, 'no CW_TSA_URL');
  if (!(doSign && keyPresent)) return end('skipped', TSA_EXIT.ABSENT, 'no signature records to stamp: signing did not run');
  if (!['sign', 'verify'].every((id) => results.some((s) => s.step === id && s.outcome === 'ok'))) {
    return end('skipped', TSA_EXIT.ABSENT, 'no verified signature records to stamp: attest sign or verify failed');
  }
  try {
    const files = evidenceArtifacts(paths).map((a) => join(paths.out, 'signatures', `${a.role}.sig`));
    const stamp = runTimestamp('stamp', files);
    const check = runTimestamp('verify', files);
    const by = (list) => new Map((list || []).map((v) => [v.record, v]));
    const stamped = by(stamp.verdicts), read = by(check.verdicts);
    const records = files.map((f) => {
      const s = stamped.get(f), v = read.get(f), rec = { record: relative(paths.out, f) };
      // A reply that fails verification is never written, so the readback says absent; the stamp's verdict is the finding.
      if (s?.state === 'invalid') return { ...rec, state: 'invalid', reason: s.reason };
      if (!v) return { ...rec, state: 'invalid', reason: `timestamp verify gave no verdict (exit ${check.code}${check.why ? `: ${check.why}` : ''})` };
      if (v.state === 'anchored' || v.state === 'unanchored') return { ...rec, state: v.state, genTime: v.genTime, tsa: v.tsa };
      return { ...rec, state: v.state === 'absent' ? 'absent' : 'invalid', reason: s?.state === 'request-failed' ? s.reason : v.reason };
    });
    if (!stamp.verdicts) return end('failed', stamp.code || 1, `timestamp stamp gave no verdicts (exit ${stamp.code}${stamp.why ? `: ${stamp.why}` : ''})`, records);
    const bad = records.filter((r) => r.state === 'absent' || r.state === 'invalid');
    if (bad.length) {
      const groups = new Map();
      for (const r of bad) groups.set(`${r.state}: ${r.reason}`, (groups.get(`${r.state}: ${r.reason}`) || 0) + 1);
      const exit = [stamp.code, check.code].find((c) => c !== 0 && c !== TSA_EXIT.UNANCHORED) ?? TSA_EXIT.INVALID;
      return end('failed', exit, [...groups].map(([k, n]) => `${n} of ${records.length} ${k}`).join('; '), records);
    }
    if (records.some((r) => r.state === 'unanchored')) {
      return end('signal', TSA_EXIT.UNANCHORED, 'tokens verify but are unanchored: CW_TSA_CA names no trust anchor', records);
    }
    return end('ok', 0, null, records);
  } catch (e) {
    return end('failed', 1, `timestamp step threw: ${e.message}`);
  }
}

process.stdout.write(dim('  ▸ timestamp … '));
const ts = timestampStep();
results.push(ts.result);
if (ts.result.outcome === 'ok') console.log(grn('ok') + dim(` — ${ts.record.records.length} token(s) anchored (revocation not checked)`));
else if (ts.result.outcome === 'skipped') console.log(yel('skipped') + dim(` — ${ts.result.reason}`));
else if (ts.result.outcome === 'signal') { console.log(yel('UNANCHORED') + dim(` — ${ts.result.reason}`)); worst = Math.max(worst, ts.result.exit); }
else { console.log(red(`failed (exit ${ts.result.exit})`) + dim(` — ${ts.result.reason}`)); worst = Math.max(worst, ts.result.exit); }

// ── evidence index: catalogue every artifact under reports/cra with its sha256 ──────
function walk(dir, base, acc) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, acc);
    else if (e.isFile() && !e.name.endsWith('.tmp') && e.name !== EVIDENCE_INDEX && e.name !== REFRESH_STATUS) {
      try { acc.push({ path: p.slice(base.length + 1), bytes: statSync(p).size, sha256: sha256(readFileSync(p)) }); } catch {}
    }
  }
  return acc;
}
const at = nowISO();
const artifacts = walk(paths.out, paths.out, []).sort((a, b) => a.path.localeCompare(b.path));
// Fingerprinted after the steps, since watch may rewrite kev.json during the run.
const index = {
  schema: EVIDENCE_INDEX_SCHEMA, generatedAt: at, slice: null, steps: results, inputs: fingerprintInputs(paths),
  signed: doSign && keyPresent, timestamp: ts.record, artifactCount: artifacts.length, artifacts,
  note: 'Catalogue of the compliance-evidence set produced by cra/refresh.mjs. Each artifact carries a sha256; when signed=true the durable evidence (rollup/ledger/cases/annotations/products) additionally has ed25519 attestations under signatures/ + attestations.jsonl (verify: node cra/attest.mjs verify). When timestamp.state is anchored or unanchored, each signature record also has an RFC 3161 token beside it as <record>.tsq + <record>.tsr (verify: node cra/timestamp.mjs verify).',
};
try { index.slice = JSON.parse(readFileSync(paths.rollup, 'utf8')).sliceId || null; } catch {}
writeJSONAtomic(join(paths.out, EVIDENCE_INDEX), index);
const failedSteps = results.filter((s) => s.outcome === 'failed');
recordRun(worst, failedSteps.length ? `step(s) failed: ${failedSteps.map((s) => `${s.step} (exit ${s.exit}${s.reason ? `: ${s.reason}` : ''})`).join('; ')}` : null, results);

console.log(worst === 0 ? grn(`  ✓ evidence set refreshed`) : yel(`  ⚠ refreshed with signals (exit ${worst})`));
console.log(dim(`  ${artifacts.length} artifact(s) catalogued → ${join(paths.out, EVIDENCE_INDEX)}${index.signed ? ' (signed)' : ''}`));
process.exit(worst);

#!/usr/bin/env node
// bin/offbox-fetch.mjs — pull the latest off-box probe result and verify its attestation
// usage: node bin/offbox-fetch.mjs [--json]
// env, read at call time: CW_OFFBOX_EVIDENCE (dest), CW_OFFBOX_REPO, CW_GH, CW_OFFBOX_ALLOW_UNATTESTED
// exit: 0 evidence replaced · 1 refused (unverified, no run) · 2 gh unavailable
// fact: unverified evidence never replaces verified evidence
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

export const DEFAULT_REPO = 'Portll/commitwork-remote';
export const DEFAULT_WORKFLOW = 'probe.yml';
export const ARTIFACT = 'probe-results';
export const defaultEvidencePath = (env = process.env) => env.CW_OFFBOX_EVIDENCE || join(homedir(), '.commitwork', 'offbox', 'probe-results.json');
const receiptPath = (p) => `${p}.receipt.json`;

function gh(env, args, opts = {}) {
  const bin = env.CW_GH || 'gh';
  const r = spawnSync(bin, args, { encoding: 'utf8', env, timeout: opts.timeoutMs || 60_000 });
  if (r.error && r.error.code === 'ENOENT') return { missing: true, status: null, stdout: '', stderr: `${bin} not found` };
  return { missing: false, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Latest successful run of the probe workflow, or null with a reason. */
export function latestRun({ env = process.env } = {}) {
  const repo = env.CW_OFFBOX_REPO || DEFAULT_REPO;
  const r = gh(env, ['run', 'list', '--repo', repo, '--workflow', env.CW_OFFBOX_WORKFLOW || DEFAULT_WORKFLOW, '--status', 'success', '--limit', '1', '--json', 'databaseId,createdAt,headSha']);
  if (r.missing) return { run: null, reason: r.stderr, ghMissing: true };
  if (r.status !== 0) return { run: null, reason: `gh run list exited ${r.status}: ${r.stderr.trim().slice(0, 200)}` };
  let list;
  try { list = JSON.parse(r.stdout); } catch { return { run: null, reason: 'gh run list returned unparseable JSON' }; }
  if (!Array.isArray(list) || !list.length) return { run: null, reason: 'no successful probe run found' };
  return { run: list[0], repo };
}

/** Download the artifact and verify its provenance. Returns the verdict; never writes evidence. */
export function fetchAndVerify({ env = process.env } = {}) {
  const found = latestRun({ env });
  if (!found.run) return { ok: false, code: found.ghMissing ? 2 : 1, reason: found.reason };
  const { run, repo } = found;
  const dir = mkdtempSync(join(tmpdir(), 'cw-offbox-'));
  try {
    const dl = gh(env, ['run', 'download', String(run.databaseId), '--repo', repo, '-n', ARTIFACT, '-D', dir], { timeoutMs: 120_000 });
    if (dl.status !== 0) return { ok: false, code: 1, reason: `artifact download failed (${dl.stderr.trim().slice(0, 200)})`, run };
    const file = join(dir, 'probe-results.json');
    if (!existsSync(file)) return { ok: false, code: 1, reason: 'artifact holds no probe-results.json', run };
    const text = readFileSync(file, 'utf8');
    try { JSON.parse(text); } catch { return { ok: false, code: 1, reason: 'probe-results.json is not JSON', run }; }
    const at = gh(env, ['attestation', 'verify', file, '--repo', repo], { timeoutMs: 120_000 });
    const attested = at.status === 0;
    // Two failures wear one exit code and must not: an attestation that is PRESENT and does not
    // verify is the tamper signal (refuse always but for the blanket override); an attestation that
    // cannot EXIST — a private repo returns 404 "Feature not available for user-owned private
    // repositories", which failed 8/8 scheduled runs — is a known-unavailable feature, not evidence
    // of tampering. Accepting the second under an explicit opt-in keeps the off-box witness alive
    // while the repo is private, without ever laundering a bad signature into a pass.
    const stderr = String(at.stderr || '');
    const unavailable = /no attestation|not available|404|no attestations found|feature not/i.test(stderr);
    const attestationState = attested ? 'verified' : unavailable ? 'unavailable' : 'invalid';
    if (!attested && env.CW_OFFBOX_ALLOW_UNATTESTED !== '1') {
      const optionalOk = attestationState === 'unavailable' && env.CW_OFFBOX_ATTEST_OPTIONAL === '1';
      if (!optionalOk) {
        const hint = attestationState === 'unavailable'
          ? 'set CW_OFFBOX_ATTEST_OPTIONAL=1 to accept run-provenance-verified evidence when attestation is unavailable (e.g. a private repo)'
          : 'a present attestation FAILED to verify — treat as tampering; CW_OFFBOX_ALLOW_UNATTESTED=1 overrides only if you are certain';
        return { ok: false, code: 1, reason: `attestation NOT verified (${stderr.trim().slice(0, 200) || 'no attestation'}) — ${hint}`, run };
      }
    }
    return { ok: true, code: 0, text, attested, attestationState, run, repo };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Replace the evidence file atomically, with a receipt beside it. */
export function writeEvidence(res, { env = process.env, now = new Date() } = {}) {
  const dest = defaultEvidencePath(env);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  writeFileSync(tmp, res.text);
  renameSync(tmp, dest);
  const receipt = { fetchedAt: now.toISOString(), repo: res.repo, runId: res.run.databaseId, runCreatedAt: res.run.createdAt, headSha: res.run.headSha, attested: res.attested, attestationState: res.attestationState ?? (res.attested ? 'verified' : 'unavailable') };
  writeFileSync(`${receiptPath(dest)}.tmp-${process.pid}`, JSON.stringify(receipt, null, 2) + '\n');
  renameSync(`${receiptPath(dest)}.tmp-${process.pid}`, receiptPath(dest));
  return { dest, receipt };
}

if (isMainModule(import.meta.url)) {
  const json = process.argv.includes('--json');
  const res = fetchAndVerify();
  if (!res.ok) {
    const out = { ok: false, reason: res.reason, run: res.run || null };
    if (json) console.log(JSON.stringify(out)); else console.error(`offbox-fetch: REFUSED — ${res.reason}`);
    process.exit(res.code);
  }
  const w = writeEvidence(res);
  const out = { ok: true, dest: w.dest, ...w.receipt };
  if (json) console.log(JSON.stringify(out));
  else console.log(`offbox-fetch: evidence ${w.dest} ← run ${w.receipt.runId} (${w.receipt.runCreatedAt}) attested=${w.receipt.attested}\nexport CW_OFFBOX_EVIDENCE=${w.dest}`);
}

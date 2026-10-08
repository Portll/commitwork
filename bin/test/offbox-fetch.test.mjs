// offbox-fetch: verified evidence lands, unverified is refused, missing gh is exit 2
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAndVerify, writeEvidence, latestRun } from '../offbox-fetch.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-offbox-test-'));
test.after(() => rmSync(T, { recursive: true, force: true }));

// fact: a shell fake gh, driven by env, stands in for GitHub
function fakeGh(name, { list = '[{"databaseId":1,"createdAt":"2026-09-11T00:00:00Z","headSha":"abc"}]', verifyExit = 0, verifyErr = '', download = true } = {}) {
  const p = join(T, name);
  writeFileSync(p, `#!/bin/sh
case "$1 $2" in
  "run list") printf '%s' '${list}'; exit 0;;
  "run download") ${download ? 'D=""; while [ $# -gt 0 ]; do [ "$1" = "-D" ] && D="$2"; shift; done; printf \'{"generated":"2026-09-11T00:00:00Z","vantage":"github-actions","cadenceSeconds":21600,"results":[]}\' > "$D/probe-results.json"; exit 0' : 'echo "no artifact" >&2; exit 1'};;
  "attestation verify") ${verifyErr ? `echo '${verifyErr}' >&2;` : ''} exit ${verifyExit};;
esac
exit 3
`);
  chmodSync(p, 0o755);
  return p;
}

describe('offbox-fetch', () => {
  test('verified: evidence and receipt are written, attested:true', () => {
    const env = { ...process.env, CW_GH: fakeGh('gh-ok'), CW_OFFBOX_EVIDENCE: join(T, 'ok', 'probe-results.json') };
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.attested, true);
    const w = writeEvidence(r, { env });
    assert.ok(existsSync(w.dest));
    const receipt = JSON.parse(readFileSync(`${w.dest}.receipt.json`, 'utf8'));
    assert.equal(receipt.runId, 1);
    assert.equal(receipt.attested, true);
    assert.equal(JSON.parse(readFileSync(w.dest, 'utf8')).vantage, 'github-actions');
  });

  test('unverified attestation is REFUSED, and nothing is written', () => {
    const dest = join(T, 'refused', 'probe-results.json');
    const env = { ...process.env, CW_GH: fakeGh('gh-bad', { verifyExit: 1 }), CW_OFFBOX_EVIDENCE: dest };
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, false);
    assert.equal(r.code, 1);
    assert.match(r.reason, /attestation NOT verified/);
    assert.ok(!existsSync(dest));
  });

  test('CW_OFFBOX_ALLOW_UNATTESTED=1 accepts it deliberately, and the receipt says attested:false', () => {
    const env = { ...process.env, CW_GH: fakeGh('gh-bad2', { verifyExit: 1 }), CW_OFFBOX_ALLOW_UNATTESTED: '1', CW_OFFBOX_EVIDENCE: join(T, 'unatt', 'probe-results.json') };
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, true);
    assert.equal(r.attested, false);
    const w = writeEvidence(r, { env });
    assert.equal(JSON.parse(readFileSync(`${w.dest}.receipt.json`, 'utf8')).attested, false);
  });

  test('attestation UNAVAILABLE (private-repo 404) is refused by default but names the opt-in', () => {
    const env = { ...process.env, CW_GH: fakeGh('gh-404', { verifyExit: 1, verifyErr: 'HTTP 404: Feature not available for user-owned private repositories' }), CW_OFFBOX_EVIDENCE: join(T, 'u404', 'probe-results.json') };
    delete env.CW_OFFBOX_ATTEST_OPTIONAL; delete env.CW_OFFBOX_ALLOW_UNATTESTED;
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, false);
    assert.match(r.reason, /CW_OFFBOX_ATTEST_OPTIONAL=1/);
  });

  test('CW_OFFBOX_ATTEST_OPTIONAL=1 accepts UNAVAILABLE attestation, receipt attestationState:unavailable', () => {
    const env = { ...process.env, CW_GH: fakeGh('gh-opt', { verifyExit: 1, verifyErr: 'no attestations found' }), CW_OFFBOX_ATTEST_OPTIONAL: '1', CW_OFFBOX_EVIDENCE: join(T, 'opt', 'probe-results.json') };
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.attested, false);
    assert.equal(r.attestationState, 'unavailable');
    const w = writeEvidence(r, { env });
    assert.equal(JSON.parse(readFileSync(`${w.dest}.receipt.json`, 'utf8')).attestationState, 'unavailable');
  });

  test('CW_OFFBOX_ATTEST_OPTIONAL=1 still REFUSES a present-but-INVALID attestation (tamper stays fatal)', () => {
    const env = { ...process.env, CW_GH: fakeGh('gh-tamper', { verifyExit: 1, verifyErr: 'verification failed: signature does not match' }), CW_OFFBOX_ATTEST_OPTIONAL: '1', CW_OFFBOX_EVIDENCE: join(T, 'tamper', 'probe-results.json') };
    delete env.CW_OFFBOX_ALLOW_UNATTESTED;
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, false);
    assert.match(r.reason, /tampering/);
  });

  test('no successful run is a refusal with the reason, not an empty evidence file', () => {
    const env = { ...process.env, CW_GH: fakeGh('gh-none', { list: '[]' }), CW_OFFBOX_EVIDENCE: join(T, 'none', 'probe-results.json') };
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, false);
    assert.match(r.reason, /no successful probe run/);
  });

  test('a missing gh binary is exit 2 — unavailable, never a verdict', () => {
    const env = { ...process.env, CW_GH: join(T, 'does-not-exist') };
    assert.equal(latestRun({ env }).ghMissing, true);
    assert.equal(fetchAndVerify({ env }).code, 2);
  });

  test('a failed download is refused', () => {
    const env = { ...process.env, CW_GH: fakeGh('gh-nodl', { download: false }), CW_OFFBOX_EVIDENCE: join(T, 'nodl', 'probe-results.json') };
    const r = fetchAndVerify({ env });
    assert.equal(r.ok, false);
    assert.match(r.reason, /download failed/);
  });
});

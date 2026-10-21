// lib/release-signing.mjs: a release that declares a cosign-signed checksums file installs only when
// cosign verifies it AND the signed digest for the asset equals the pin. Every refusal path is
// asserted separately from the pass, because the one that lies is a verifier that reports clean
// over a step it never ran. cosign is a stub script (CW_COSIGN_BIN) that records its argv.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyReleaseSignature, checksumFor, cosignArgv, signingKind, signingAssets, GITHUB_ACTIONS_ISSUER } from '../../lib/release-signing.mjs';

const POSIX = process.platform !== 'win32';
const SHA = 'a'.repeat(64);
const ASSET = 'zz_1.0.0_linux_x64.tar.gz';
const SIGNING = { kind: 'cosign-checksums', checksums: 'zz_1.0.0_checksums.txt', identity: '^https://github\\.com/o/zz/', issuer: GITHUB_ACTIONS_ISSUER };
const CHECKSUMS = `${SHA}  ${ASSET}\n${'b'.repeat(64)}  zz_1.0.0_linux_arm64.tar.gz\n`;

function stubCosign(t, { exit = 0 }) {
  const d = mkdtempSync(join(tmpdir(), 'cw-cosign-stub-'));
  t.after(() => { rmSync(d, { recursive: true, force: true }); delete process.env.CW_COSIGN_BIN; });
  const log = join(d, 'argv.log');
  writeFileSync(join(d, 'cosign'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n[ "$1" = version ] && exit 0\necho 'stub says no' >&2\nexit ${exit}\n`, { mode: 0o755 });
  process.env.CW_COSIGN_BIN = join(d, 'cosign');
  return { argv: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) };
}

const serve = (files) => async (name) => { if (!(name in files)) throw new Error('HTTP 404'); return Buffer.from(files[name]); };
const siblings = (checksums = CHECKSUMS) => ({ [SIGNING.checksums]: checksums, [`${SIGNING.checksums}.sig`]: 'sig', [`${SIGNING.checksums}.pem`]: 'pem' });

test('checksumFor reads a goreleaser checksums file and ignores other assets', () => {
  assert.equal(checksumFor(CHECKSUMS, ASSET), SHA);
  assert.equal(checksumFor(CHECKSUMS, 'zz_1.0.0_linux_arm64.tar.gz'), 'b'.repeat(64));
  assert.equal(checksumFor(CHECKSUMS, 'zz_1.0.0_darwin_x64.tar.gz'), null);
  assert.equal(checksumFor(`${SHA} *${ASSET}\r\n`, ASSET), SHA, 'BSD-style binary marker and CRLF');
  assert.equal(checksumFor(`${SHA}  ${ASSET}x\n`, ASSET), null, 'a name that merely starts with the asset is not it');
});

test('cosignArgv binds certificate, signature, identity and issuer to the checksums file', () => {
  const argv = cosignArgv(SIGNING, '/d');
  assert.deepEqual(argv.slice(1), ['verify-blob', '--certificate', '/d/zz_1.0.0_checksums.txt.pem', '--signature', '/d/zz_1.0.0_checksums.txt.sig',
    '--certificate-identity-regexp', SIGNING.identity, '--certificate-oidc-issuer', GITHUB_ACTIONS_ISSUER, '/d/zz_1.0.0_checksums.txt']);
  assert.deepEqual(signingAssets(SIGNING), { checksums: 'zz_1.0.0_checksums.txt', signature: 'zz_1.0.0_checksums.txt.sig', certificate: 'zz_1.0.0_checksums.txt.pem' });
});

test('signingKind is undeclared for anything but the two recorded kinds', () => {
  assert.equal(signingKind({ signing: SIGNING }), 'cosign-checksums');
  assert.equal(signingKind({ signing: { kind: 'none', checkedAt: '2026-10-08' } }), 'none');
  assert.equal(signingKind({}), 'undeclared');
  assert.equal(signingKind({ signing: { kind: 'gpg' } }), 'undeclared');
});

test('a verified signature whose digest matches the pin passes at the cosign tier', { skip: !POSIX && 'sh stub' }, async (t) => {
  const stub = stubCosign(t, { exit: 0 });
  const r = await verifyReleaseSignature({ spec: { signing: SIGNING }, asset: ASSET, sha256: SHA, fetchAsset: serve(siblings()) });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.tier, 'cosign');
  assert.match(r.detail, /cosign keyless, identity \^https/);
  const argv = stub.argv();
  assert.equal(argv[0], 'verify-blob');
  assert.ok(argv.includes('--certificate-oidc-issuer') && argv.includes(GITHUB_ACTIONS_ISSUER), 'issuer pinned');
  assert.ok(argv.includes(SIGNING.identity), 'identity regexp passed');
});

test('cosign exiting non-zero refuses the install and quotes its stderr', { skip: !POSIX && 'sh stub' }, async (t) => {
  stubCosign(t, { exit: 1 });
  const r = await verifyReleaseSignature({ spec: { signing: SIGNING }, asset: ASSET, sha256: SHA, fetchAsset: serve(siblings()) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /cosign verify-blob exit 1 — stub says no/);
});

test('a verified checksums file that disagrees with the pin refuses: two witnesses must agree', { skip: !POSIX && 'sh stub' }, async (t) => {
  stubCosign(t, { exit: 0 });
  const r = await verifyReleaseSignature({ spec: { signing: SIGNING }, asset: ASSET, sha256: SHA, fetchAsset: serve(siblings(`${'c'.repeat(64)}  ${ASSET}\n`)) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /signed checksum c{64} disagrees with the pinned a{64}/);
});

test('a verified checksums file with no line for the asset refuses', { skip: !POSIX && 'sh stub' }, async (t) => {
  stubCosign(t, { exit: 0 });
  const r = await verifyReleaseSignature({ spec: { signing: SIGNING }, asset: 'zz_1.0.0_darwin_x64.tar.gz', sha256: SHA, fetchAsset: serve(siblings()) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /has no line for zz_1.0.0_darwin_x64/);
});

test('a missing sibling asset refuses before cosign runs', { skip: !POSIX && 'sh stub' }, async (t) => {
  const stub = stubCosign(t, { exit: 0 });
  const files = siblings(); delete files[`${SIGNING.checksums}.sig`];
  const r = await verifyReleaseSignature({ spec: { signing: SIGNING }, asset: ASSET, sha256: SHA, fetchAsset: serve(files) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not fetch zz_1.0.0_checksums.txt.sig — HTTP 404/);
  assert.deepEqual(stub.argv(), ['version'], 'only the presence probe ran');
});

test('a cosign-signed release with no cosign on the box refuses and names the installers', async (t) => {
  process.env.CW_COSIGN_BIN = join(tmpdir(), 'cw-no-such-cosign');
  t.after(() => delete process.env.CW_COSIGN_BIN);
  let fetched = 0;
  const r = await verifyReleaseSignature({ spec: { signing: SIGNING }, asset: ASSET, sha256: SHA, fetchAsset: async () => { fetched++; return Buffer.alloc(0); } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /cosign-signed and .*cw-no-such-cosign is not installed \(brew install cosign/);
  assert.equal(fetched, 0);
});

test('an incomplete cosign block refuses rather than verifying against nothing', async () => {
  const r = await verifyReleaseSignature({ spec: { signing: { kind: 'cosign-checksums', checksums: 'x' } }, asset: ASSET, sha256: SHA, fetchAsset: serve({}) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing checksums, identity or issuer/);
});

test('a measured absence passes at the sha256 tier and says so with its date', async () => {
  const r = await verifyReleaseSignature({ spec: { signing: { kind: 'none', checkedAt: '2026-10-08' } }, asset: ASSET, sha256: SHA, fetchAsset: serve({}) });
  assert.deepEqual(r, { ok: true, tier: 'sha256', detail: 'publisher signature: none published (checked 2026-10-08)' });
});

test('an undeclared block passes at the sha256 tier as undetermined, never as verified', async () => {
  const r = await verifyReleaseSignature({ spec: {}, asset: ASSET, sha256: SHA, fetchAsset: serve({}) });
  assert.equal(r.tier, 'sha256');
  assert.match(r.detail, /undeclared in the catalogue \(undetermined\)/);
});

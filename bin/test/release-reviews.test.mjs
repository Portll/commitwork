// Tests for release-reviews (load, key, apply) and pre-publish settling findings on reviewed rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadReviews, applyReviews, blobShas, draftRows, gitBlobSha, findingKey, REVIEWS_REL,
} from '../lib/release-reviews.mjs';
import { scanLine } from '../secrets-sweep.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREPUB = resolve(HERE, '..', 'pre-publish.mjs');
// guard: assembled so this source carries no literal the sweep matches
const FAKE_AWS = ['AK', 'IA', 'FR5ZYQP3MZKW3TAC'].join('');
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 1, 2, 3]);

const ROOTS = [];
function dir(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-reviews-'));
  ROOTS.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
process.on('exit', () => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });

function withEnv(env, fn) {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const row = (o) => ({ verdict: 'REAL-SECRET', count: 1, disposition: 'synthetic-fixture', reason: 'test value', reviewer: 'tester', reviewedAt: '2026-10-04', ...o });
const doc = (findings = [], assets = []) => JSON.stringify({ note: 'test', findings, assets });
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

test('gitBlobSha agrees with git hash-object', () => {
  const root = dir({ 'a.bin': BINARY });
  assert.equal(gitBlobSha(BINARY), execFileSync('git', ['hash-object', join(root, 'a.bin')], { encoding: 'utf8' }).trim());
});

test('a finding fingerprint ignores the line and the truncation', () => {
  const [a] = scanLine(`key = ${FAKE_AWS}`, 3);
  const [b] = scanLine(`key = ${FAKE_AWS}`, 90);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{16}$/);
  const long = 'x'.repeat(70);
  const [c] = scanLine(`password = "${long}A1"`, 1);
  const [d] = scanLine(`password = "${long}B2"`, 1);
  assert.ok(c && d, 'both lines must match a rule');
  assert.equal(c.match, d.match, 'the truncated match collides');
  assert.notEqual(c.fingerprint, d.fingerprint, 'the fingerprint does not');
});

test('loadReviews: an override file loads, and every malformed one throws', () => {
  const root = dir({
    'ok.json': doc([row({ file: 'f', cls: 'c', fingerprint: '0123456789abcdef' })]),
    'bad.json': '{',
    'schema.json': JSON.stringify({ note: 'x', findings: [{ file: 'f' }], assets: [] }),
    'dup.json': doc([row({ file: 'f', cls: 'c', fingerprint: '0123456789abcdef' }), row({ file: 'f', cls: 'c', fingerprint: '0123456789abcdef' })]),
    'unsigned.json': doc([row({ file: 'f', cls: 'c', fingerprint: '0123456789abcdef', reviewer: '' })]),
    'pending.json': doc([row({ file: 'f', cls: 'c', fingerprint: '0123456789abcdef', disposition: 'pending', reviewer: '', reason: '', reviewedAt: null })]),
  });
  const load = (f) => withEnv({ CW_RELEASE_REVIEWS: join(root, f) }, loadReviews);
  assert.equal(load('ok.json').findings.length, 1);
  assert.equal(load('pending.json').findings.length, 1, 'a pending row needs no reviewer');
  assert.throws(() => load('bad.json'), /not valid JSON/);
  assert.throws(() => load('schema.json'), /fails its schema/);
  assert.throws(() => load('dup.json'), /twice/);
  assert.throws(() => load('unsigned.json'), /without a reason, reviewer and date/);
  assert.throws(() => load('missing.json'), /cannot read/);
});

test('loadReviews: no sidecar or no committed record is empty, and only the commit counts', () => {
  const none = withEnv({ CW_RELEASE_REVIEWS: undefined, CW_SIDECAR: join(dir(), 'absent') }, loadReviews);
  assert.equal(none.source, 'none');
  assert.deepEqual([none.findings, none.assets], [[], []]);

  const sidecar = dir({ 'README.md': 'x\n' });
  git(sidecar, 'init', '-q');
  git(sidecar, 'add', '-A');
  git(sidecar, 'commit', '-q', '-m', 'init');
  const load = () => withEnv({ CW_RELEASE_REVIEWS: undefined, CW_SIDECAR: sidecar }, loadReviews);
  assert.match(load().source, /:absent$/);

  mkdirSync(join(sidecar, 'release'));
  writeFileSync(join(sidecar, REVIEWS_REL), doc([row({ file: 'f', cls: 'c', fingerprint: '0123456789abcdef' })]));
  assert.equal(load().findings.length, 0, 'an uncommitted review does not count');
  git(sidecar, 'add', '-A');
  git(sidecar, 'commit', '-q', '-m', 'reviews');
  assert.equal(load().findings.length, 1);
});

test('applyReviews: accepts within count, keeps the rest open, reports stale rows', () => {
  const f = (o) => ({ file: 'a.mjs', line: 1, cls: 'provider-key/aws', verdict: 'REAL-SECRET', fingerprint: '1111111111111111', ...o });
  const findings = [f({ line: 4 }), f({ line: 9 }), f({ cls: 'jwt', fingerprint: '2222222222222222' }), f({ verdict: 'FALSE-POSITIVE', fingerprint: '3333333333333333' })];
  const reviews = {
    findings: [
      row({ file: 'a.mjs', cls: 'provider-key/aws', fingerprint: '1111111111111111' }),
      row({ file: 'a.mjs', cls: 'jwt', fingerprint: '2222222222222222', disposition: 'redact' }),
      row({ file: 'gone.mjs', cls: 'jwt', fingerprint: '4444444444444444' }),
    ],
    assets: [{ blob: 'a'.repeat(40), path: 'img.png', disposition: 'publish' }, { blob: 'b'.repeat(40), path: 'w.bin', disposition: 'withhold' }],
  };
  const unscanned = [{ file: 'img.png', reason: 'binary-content' }, { file: 'w.bin', reason: 'binary-content' }, { file: 'new.png', reason: 'binary-content' }];
  const shas = new Map([['img.png', 'a'.repeat(40)], ['w.bin', 'b'.repeat(40)], ['new.png', 'c'.repeat(40)]]);
  const r = applyReviews({ findings, unscanned }, reviews, shas);
  assert.equal(r.reviewed.length, 1);
  assert.deepEqual(r.unreviewed.map((u) => [u.cls, u.beyondCount ?? null, u.disposition ?? null]),
    [['provider-key/aws', 1, null], ['jwt', null, 'redact']]);
  assert.deepEqual(r.assetsReviewed.map((a) => a.file), ['img.png']);
  assert.deepEqual(r.assetsUnreviewed.map((a) => [a.file, a.disposition ?? null]), [['w.bin', 'withhold'], ['new.png', null]]);
  assert.deepEqual(r.stale.map((s) => s.file), ['gone.mjs']);
  const draft = draftRows(r);
  assert.deepEqual(draft.findings.map((d) => [d.cls, d.count, d.disposition]), [['provider-key/aws', 1, 'pending'], ['jwt', 1, 'pending']]);
  assert.deepEqual(draft.assets.map((a) => a.path), ['w.bin', 'new.png']);
  assert.ok(!JSON.stringify(draft).includes('match'), 'a draft never carries the matched text');
});

test('blobShas reads a ref when given and the disk otherwise', () => {
  const root = dir({ 'img.png': BINARY });
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  const want = gitBlobSha(BINARY);
  assert.equal(blobShas(root, ['img.png'], 'HEAD').get('img.png'), want);
  assert.equal(blobShas(root, ['img.png']).get('img.png'), want);
  assert.equal(blobShas(root, ['nope.png']).get('nope.png'), null);
});

function prepub(root, reviews, extra = []) {
  const env = { ...process.env, CW_SECRETS_ROOT: root, CW_VERDICT_DIR: join(root, 'verdicts'), CW_SIDECAR: join(root, 'no-sidecar') };
  if (reviews) { writeFileSync(join(root, 'reviews.json'), reviews); env.CW_RELEASE_REVIEWS = join(root, 'reviews.json'); }
  try {
    return { code: 0, out: JSON.parse(execFileSync(process.execPath, [PREPUB, '--paths', 'packet', '--json', ...extra], { encoding: 'utf8', env })) };
  } catch (e) {
    return { code: e.status, out: JSON.parse(String(e.stdout || '{}')) };
  }
}

test('pre-publish: a reviewed finding passes as clean-reviewed, and moving it does not reopen it', () => {
  const root = dir({ 'packet/conf.md': `aws = ${FAKE_AWS}\n` });
  let r = prepub(root, null);
  assert.equal(r.code, 1);
  assert.equal(r.out.verdict, 'blocked-secret');
  const open = r.out.open[0];
  assert.equal(open.file, 'packet/conf.md');
  assert.ok(!JSON.stringify(r.out).includes(FAKE_AWS), 'the JSON report never carries the secret');

  const reviews = doc([row({ file: open.file, cls: open.cls, fingerprint: open.fingerprint })]);
  r = prepub(root, reviews);
  assert.equal(r.code, 0);
  assert.equal(r.out.verdict, 'clean-reviewed');
  assert.equal(r.out.reviews.reviewed['REAL-SECRET'], 1);

  writeFileSync(join(root, 'packet/conf.md'), `# moved\n\n\naws = ${FAKE_AWS}\n`);
  assert.equal(prepub(root, reviews).out.verdict, 'clean-reviewed', 'a line move is the same finding');

  writeFileSync(join(root, 'packet/conf.md'), `aws = ${FAKE_AWS}\nagain = ${FAKE_AWS}\n`);
  r = prepub(root, reviews);
  assert.equal(r.out.verdict, 'blocked-secret', 'a second occurrence exceeds the reviewed count');
});

test('pre-publish: an unscanned blob is incomplete until its hash is reviewed', () => {
  const root = dir({ 'packet/ok.md': 'nothing\n', 'packet/logo.png': BINARY });
  let r = prepub(root, null);
  assert.equal(r.code, 2);
  assert.equal(r.out.verdict, 'unreviewed-unscanned');
  assert.equal(r.out.openAssets[0].blob, gitBlobSha(BINARY));

  const asset = { blob: gitBlobSha(BINARY), path: 'packet/logo.png', disposition: 'publish', reason: 'house mark', reviewer: 'tester', reviewedAt: '2026-10-04' };
  r = prepub(root, doc([], [asset]));
  assert.equal(r.code, 0);
  assert.equal(r.out.verdict, 'clean-reviewed');

  writeFileSync(join(root, 'packet/logo.png'), Buffer.concat([BINARY, Buffer.from([9])]));
  assert.equal(prepub(root, doc([], [asset])).out.verdict, 'unreviewed-unscanned', 'changed bytes are a different blob');
});

test('pre-publish: an unreadable review record is cannot-check, never clean', () => {
  const root = dir({ 'packet/ok.md': 'nothing\n' });
  const r = prepub(root, '{');
  assert.equal(r.code, 2);
  assert.equal(r.out.verdict, 'cannot-check');
  assert.match(r.out.error, /^reviews: /);
});

test('pre-publish --draft-reviews prints pending rows and no secret', () => {
  const root = dir({ 'packet/conf.md': `aws = ${FAKE_AWS}\n` });
  const env = { ...process.env, CW_SECRETS_ROOT: root, CW_VERDICT_DIR: join(root, 'verdicts'), CW_SIDECAR: join(root, 'no-sidecar') };
  let out;
  try { out = execFileSync(process.execPath, [PREPUB, '--paths', 'packet', '--draft-reviews'], { encoding: 'utf8', env }); }
  catch (e) { out = String(e.stdout); }
  const draft = JSON.parse(out);
  assert.equal(draft.findings.length, 1);
  assert.equal(draft.findings[0].disposition, 'pending');
  assert.ok(!out.includes(FAKE_AWS));
});

test('one blob at two paths drafts one asset row, and its review settles both', () => {
  const unscanned = [{ file: 'a/logo.png', reason: 'binary-extension' }, { file: 'b/logo.png', reason: 'binary-extension' }];
  const shas = new Map([['a/logo.png', 'd'.repeat(40)], ['b/logo.png', 'd'.repeat(40)]]);
  const draft = draftRows(applyReviews({ findings: [], unscanned }, { findings: [], assets: [] }, shas));
  assert.deepEqual(draft.assets.map((a) => a.path), ['a/logo.png']);
  const settled = applyReviews({ findings: [], unscanned }, { findings: [], assets: [{ ...draft.assets[0], disposition: 'publish' }] }, shas);
  assert.equal(settled.assetsReviewed.length, 2);
  assert.equal(settled.assetsUnreviewed.length, 0);
});

test('findingKey has no line in it', () => {
  assert.equal(findingKey({ file: 'f', cls: 'c', fingerprint: 'x', line: 7 }), findingKey({ file: 'f', cls: 'c', fingerprint: 'x', line: 8 }));
});

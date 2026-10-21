// The scrub and the path containment are what keep secret values out of the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeJoin, scrub, readContext, redactExcerpt } from '../routes/leaks-check.mjs';

const root = mkdtempSync(join(tmpdir(), 'cw-leaks-'));
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src', 'a.js'), ['one', 'const k="AKIAIOSFODNN7EXAMPLE";', 'three'].join('\n'));

test('safeJoin refuses traversal, absolute paths and empties', () => {
  assert.equal(safeJoin(root, '../etc/passwd'), null);
  assert.equal(safeJoin(root, 'src/../../escape'), null);
  assert.equal(safeJoin(root, '/etc/passwd'), null);
  assert.equal(safeJoin(root, ''), null);
  assert.equal(safeJoin(null, 'src/a.js'), null);
  assert.ok(safeJoin(root, 'src/a.js').endsWith('src/a.js'));
});

test('safeJoin allows a path that merely contains .. inside a name', () => {
  assert.ok(safeJoin(root, 'src/a..b.js'));
});

test('scrub removes the secret token, not just the whole line', () => {
  const line = 'const k="AKIAIOSFODNN7EXAMPLE";';
  const out = scrub('The value AKIAIOSFODNN7EXAMPLE looks like an AWS key', line);
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'), 'the token must not survive');
  assert.match(out, /\[redacted\]/);
});

test('scrub handles a token echoed inside other text', () => {
  const token = `${'ghp'}_abcdefghijklmnopqrstuvwxyz0123456789`;
  const line = `token: ${token}`;
  const out = scrub(`prefix-${token}-suffix`, line);
  assert.ok(!out.includes(token));
});

test('scrub leaves short words alone so reasoning stays readable', () => {
  const out = scrub('this is a test fixture in a spec file', 'const k="abc";');
  assert.equal(out, 'this is a test fixture in a spec file');
});

test('scrub is null-safe and returns a string', () => {
  assert.equal(scrub(null, 'x'), '');
  assert.equal(scrub('kept', null), 'kept');
});

test('readContext returns an excerpt and keeps the matched line back', () => {
  const r = readContext(join(root, 'src', 'a.js'), 2);
  assert.equal(r.ok, true);
  assert.match(r.excerpt, /const k=/);
  assert.match(r.matched, /AKIAIOSFODNN7EXAMPLE/);
});

test('a missing file is undetermined, never a clean verdict', () => {
  const r = readContext(join(root, 'src', 'gone.js'), 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /no longer present/);
});

test('a line number past the end clamps instead of throwing', () => {
  const r = readContext(join(root, 'src', 'a.js'), 9999);
  assert.equal(r.ok, true);
  assert.ok(r.excerpt.length > 0);
});

// ── THE HANDLER ITSELF ──────────────────────────────────────────────────────────────────────────
// Everything above this line tests a pure helper. The route was written as `await readJsonBody()`
// when the signature is (req, cb), so `req` was undefined inside it and every check died on
// `req.on('data')` — "bad body: Cannot read properties of undefined (reading 'on')". Nine green
// tests sat over a handler that had never executed once. These invoke it.
import { routes } from '../routes/leaks-check.mjs';

const route = routes.find((r) => r.path === '/api/leaks/check');
// Mirrors serve.mjs's readJsonBody contract: (req, cb) -> cb(body, errString).
const ctxFor = ({ body = {}, err = null, user = { user: 'op' } } = {}) => {
  const sent = [];
  return {
    sent,
    ctx: {
      req: {},
      send: (status, payload) => { sent.push({ status, payload }); return payload; },
      adminSession: () => user,
      readJsonBody: (req, cb) => {
        assert.ok(req, 'readJsonBody must be handed the request — passing nothing is the original bug');
        return cb(err ? null : body, err);
      },
    },
  };
};

test('the handler reads the body through readJsonBody(req, cb) — the shape the server actually provides', async () => {
  const { ctx, sent } = ctxFor({ body: {} });
  await route.handle(ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 400);
  assert.match(sent[0].payload.error, /repo and file are required/,
    'reaching the field check proves the body was read; the old form died before this line with a TypeError about `on`');
});

test('a body-read failure is reported as the READER said, not as an exception message', async () => {
  const { ctx, sent } = ctxFor({ err: 'body too large' });
  await route.handle(ctx);
  assert.equal(sent[0].status, 400);
  assert.equal(sent[0].payload.error, 'bad body: body too large',
    'err arrives as a string from cb(null, msg); treating it as an Error prints "undefined"');
});

test('an unauthenticated caller is refused before the body is read at all', async () => {
  let read = false;
  const sent = [];
  await route.handle({
    req: {}, send: (status, payload) => { sent.push({ status, payload }); },
    adminSession: () => null,
    readJsonBody: () => { read = true; },
  });
  assert.equal(sent[0].status, 401);
  assert.equal(read, false, 'an unauthenticated request must not get as far as consuming a body');
});

test('an unknown repo is a 404 naming it, not a traversal attempt or a crash', async () => {
  const { ctx, sent } = ctxFor({ body: { repo: 'no-such-repo-xyz', file: 'a.js' } });
  await route.handle(ctx);
  assert.equal(sent[0].status, 404);
  assert.match(sent[0].payload.error, /no resolved repo named 'no-such-repo-xyz'/);
});

// ── THE EVIDENCE THE OPERATOR SEES ──────────────────────────────────────────────────────────────
// The verdict is advisory and the operator adjudicates it, so the source has to travel with it —
// a claim whose evidence is out of reach is one they can only take on trust. The constraint is that
// the matched value must never reach the browser, and scrub() alone does not achieve that: it only
// removes tokens of >=8 chars taken from the matched line, so a short secret would survive on the
// one line certain to contain it.
const excerptFixture = () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-red-'));
  const f = join(d, 'app.js');
  writeFileSync(f, [
    'const cfg = {',
    '  region: "ap-southeast-2",',
    '  aws_key = "AKIAIOSFODNN7EXAMPLE",',
    '  note: "AKIAIOSFODNN7EXAMPLE appears again here",',
    '};',
  ].join('\n'));
  return f;
};

test('the matched value never survives into the excerpt, on its own line or a neighbouring one', () => {
  const c = readContext(excerptFixture(), 3);
  const out = redactExcerpt(c.excerpt, c.matched, 3);
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'),
    'the secret reached the browser — this is the one assertion that must never be relaxed');
  assert.match(out, /appears again here/, 'a second occurrence is scrubbed, not the whole line deleted');
});

test('a SHORT secret is masked too — scrub alone would have let it through', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-short-'));
  const f = join(d, 'x.env');
  writeFileSync(f, ['# config', 'PIN=4821', 'other=1'].join('\n'));
  const c = readContext(f, 2);
  const out = redactExcerpt(c.excerpt, c.matched, 2);
  assert.ok(!/PIN=4821/.test(out),
    'scrub() only removes tokens of 8+ chars; the matched line must be masked structurally or a short value survives');
});

test('surrounding lines stay verbatim — they are what decides fixture versus real', () => {
  const c = readContext(excerptFixture(), 3);
  const out = redactExcerpt(c.excerpt, c.matched, 3);
  assert.match(out, /region: "ap-southeast-2"/,
    'context is the evidence; masking it too would leave the operator with nothing to judge');
  assert.match(out, /const cfg = \{/);
});

test('the excerpt keeps its line numbers, so the reader can locate the match', () => {
  const c = readContext(excerptFixture(), 3);
  const out = redactExcerpt(c.excerpt, c.matched, 3);
  assert.match(out, /^ *3\| /m, 'the matched line is still addressable');
});

test('redactExcerpt is null-safe and never throws on odd input', () => {
  for (const [e, m, l] of [[null, null, 1], ['', 'x', 0], ['  1| a', undefined, 99]]) {
    assert.equal(typeof redactExcerpt(e, m, l), 'string');
  }
});

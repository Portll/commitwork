// docsite build: deterministic by construction (no clock in the output — two builds are
// byte-identical unconditionally), fail closed (a missing source is a named failure, an
// undeclared pages/ dir is an orphan, never adopted), --check is the drift witness, and the
// rendered page keeps untrusted input inert (entity-escaped markup, disarmed link schemes,
// SVG embedded only as an image).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURE = join(HERE, 'fixtures', 'docsite');
const BUILD = join(REPO, 'bin', 'docsite-build.mjs');

const freshRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-docsite-btest-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
};

const run = (root, args = []) => {
  try {
    const stdout = execFileSync(process.execPath, [BUILD, ...args], {
      encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CW_DOCSITE_ROOT: root },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

const ALPHA_PAGE = 'pages/0a1b2c3d-1111-4222-8333-444455556666/index.html';

describe('docsite build', () => {
  test('builds, and a rebuild is byte-identical (determinism without a clock)', () => {
    const root = freshRoot();
    assert.equal(run(root).code, 0);
    const first = readFileSync(join(root, ALPHA_PAGE));
    assert.equal(run(root).code, 0);
    assert.deepEqual(readFileSync(join(root, ALPHA_PAGE)), first);
  });

  test('drafts build locally too — the publish bundle is where states filter', () => {
    const root = freshRoot();
    run(root);
    assert.ok(existsSync(join(root, 'pages', 'beta', 'index.html')));
  });

  test('--check: clean after build, DRIFT (exit 1) after a hand-edit', () => {
    const root = freshRoot();
    run(root);
    assert.equal(run(root, ['--check']).code, 0);
    writeFileSync(join(root, ALPHA_PAGE), '<!doctype html><p>hand-edited</p>');
    const r = run(root, ['--check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /alpha/);
  });

  // --check copied imported snapshots into pages/ before comparing anything, so a stale copy was
  // repaired in place and reported clean.
  test('--check reports a stale imported copy as DRIFT and leaves it untouched', () => {
    const root = freshRoot();
    run(root);
    const copy = join(root, 'pages', 'legacy.html');
    writeFileSync(copy, '<!doctype html><p>stale copy</p>');
    const r = run(root, ['--check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /legacy.*differs from its imported source/);
    assert.equal(readFileSync(copy, 'utf8'), '<!doctype html><p>stale copy</p>');
  });

  test('missing source is a FAILURE naming the entry, never a skip', () => {
    const root = freshRoot();
    rmSync(join(root, 'content', 'alpha.md'));
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /alpha.*unreadable|unreadable.*alpha/s);
  });

  test('missing imported snapshot fails the build', () => {
    const root = freshRoot();
    rmSync(join(root, 'imported', 'legacy.html'));
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /legacy.*missing|missing.*legacy/s);
  });

  test('an undeclared pages/ dir is an orphan — reported, not adopted, not deleted', () => {
    const root = freshRoot();
    run(root);
    mkdirSync(join(root, 'pages', 'deadbeef-dead-4bee-8fde-adbeefdeadbe'), { recursive: true });
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /orphan/);
    assert.ok(existsSync(join(root, 'pages', 'deadbeef-dead-4bee-8fde-adbeefdeadbe')), 'orphan must not be deleted');
  });

  test('rendered page keeps hostile input inert', () => {
    const root = freshRoot();
    run(root);
    const page = readFileSync(join(root, ALPHA_PAGE), 'utf8');
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
    assert.ok(!page.includes('<script>alert'), 'raw markup must be entity-escaped');
    assert.ok(page.includes('&lt;script&gt;'), 'escaped form present');
    assert.ok(!/href="javascript:/i.test(page), 'javascript: hrefs must be disarmed');
    assert.ok(page.includes('data-blocked-scheme'), 'disarmed link is marked, not silently dropped');
    assert.match(page, /<img alt="figure" src="data:image\/svg\+xml;base64,/, 'svg fence becomes an inert image');
    assert.ok(!/<svg/i.test(page), 'no live inline SVG reaches the page');
  });

  test('page carries the tier-4 header and its source hash', () => {
    const root = freshRoot();
    run(root);
    const page = readFileSync(join(root, ALPHA_PAGE), 'utf8');
    const md = readFileSync(join(root, 'content', 'alpha.md'), 'utf8');
    assert.match(page.split('\n')[1], /Generated by bin\/docsite-build\.mjs/);
    const hash = createHash('sha256').update(md).digest('hex');
    assert.ok(page.includes(`data-src-sha256="${hash}"`), 'embedded hash must match the source');
  });

  test('multi-byte content survives the pipeline intact', () => {
    const root = freshRoot();
    run(root);
    const page = readFileSync(join(root, ALPHA_PAGE), 'utf8');
    assert.ok(page.includes('✓ Ünïcode — 多字節'), 'unicode marker must arrive undamaged');
  });
});

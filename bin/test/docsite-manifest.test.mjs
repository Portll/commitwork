// docsite manifest: the loader VALIDATES AT THE LOAD and fails closed — an unreadable or invalid
// manifest throws, it never comes back as an empty doc list. Identity discipline: only
// bin/docsite-new.mjs mints urlPaths; the build source must contain no minting call. The
// manifest↔pages pairing (uuid-rotation tripwire) reads HEAD both directions, tracked-assets
// style, and skips loudly while docsite/ has not yet landed in HEAD.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadManifest, ManifestError } from '../../lib/docsite-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURE = join(HERE, 'fixtures', 'docsite');

const withRoot = (root, fn) => {
  const prev = process.env.CW_DOCSITE_ROOT;
  process.env.CW_DOCSITE_ROOT = root;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CW_DOCSITE_ROOT; else process.env.CW_DOCSITE_ROOT = prev;
  }
};

const tmpManifest = (obj) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-docsite-mtest-'));
  writeFileSync(join(dir, 'manifest.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
  return dir;
};

describe('docsite manifest loader', () => {
  test('valid fixture loads and freezes', () => {
    const m = withRoot(FIXTURE, () => loadManifest());
    assert.equal(m.docs.length, 3);
    assert.ok(Object.isFrozen(m));
    assert.ok(Object.isFrozen(m.docs[0]));
  });

  test('ENOENT is its own code — ABSENT, distinct from invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-docsite-mtest-'));
    withRoot(dir, () => assert.throws(() => loadManifest(), (e) => e instanceof ManifestError && e.code === 'ABSENT'));
  });

  test('broken JSON throws INVALID, never returns empty', () => {
    const dir = tmpManifest('{ not json');
    withRoot(dir, () => assert.throws(() => loadManifest(), (e) => e instanceof ManifestError && e.code === 'INVALID' && /not an empty one/.test(e.message)));
  });

  const base = (docs) => ({ version: 1, docs });
  const doc = (over = {}) => ({ slug: 's1', urlPath: 's1', title: 'T', source: 'content/s1.md', kind: 'md', state: 'draft', ...over });

  test('duplicate slug refused', () => {
    const dir = tmpManifest(base([doc(), doc({ urlPath: 'other' })]));
    withRoot(dir, () => assert.throws(() => loadManifest(), /duplicate slug/));
  });

  test('duplicate urlPath refused — identity is unique', () => {
    const dir = tmpManifest(base([doc(), doc({ slug: 's2' })]));
    withRoot(dir, () => assert.throws(() => loadManifest(), /duplicate urlPath/));
  });

  test('unknown state refused (the authoritative enum is the schema)', () => {
    const dir = tmpManifest(base([doc({ state: 'live' })]));
    withRoot(dir, () => assert.throws(() => loadManifest(), /state must be/));
  });

  test('kind/source prefix mismatch refused both ways', () => {
    withRoot(tmpManifest(base([doc({ kind: 'md', source: 'imported/x.html' })])), () => assert.throws(() => loadManifest(), /kind md requires/));
    withRoot(tmpManifest(base([doc({ kind: 'imported', source: 'content/x.md' })])), () => assert.throws(() => loadManifest(), /kind imported requires/));
  });

  test('source escaping the root refused', () => {
    const dir = tmpManifest(base([doc({ source: 'content/../../etc/passwd' })]));
    withRoot(dir, () => assert.throws(() => loadManifest(), /escapes|bad source/));
  });

  test('unknown keys refused — a typoed field must not silently vanish', () => {
    const dir = tmpManifest({ version: 1, docs: [], extra: true });
    withRoot(dir, () => assert.throws(() => loadManifest(), /unknown top-level key/));
  });
});

describe('identity minting discipline', () => {
  test('the build never mints: no randomUUID in bin/docsite-build.mjs', () => {
    const src = readFileSync(join(REPO, 'bin', 'docsite-build.mjs'), 'utf8');
    assert.ok(!src.includes('randomUUID'), 'bin/docsite-build.mjs must not mint identity');
  });

  test('manifest↔pages pairing in HEAD, both directions (uuid-rotation tripwire)', () => {
    let headManifest;
    try {
      headManifest = execFileSync('git', ['-C', REPO, 'show', 'HEAD:docsite/manifest.json'], { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      // Loud skip, not silent: the gate arms itself the commit docsite/ lands.
      console.log('  [skip] docsite/manifest.json not in HEAD yet — pairing gate arms on first commit');
      return;
    }
    const m = JSON.parse(headManifest);
    // POPULATION, not just the md half. The reverse direction below walks EVERY file under
    // docsite/pages, so an expected set built from `kind === 'md'` alone reported all five flat
    // imported pages as orphans — and asserted on the alphabetically first of them while a real
    // half-landed rotation sat further down the same list, unread. A guard whose expected set is
    // narrower than the population it walks cannot tell "unaccounted for" from "a kind nobody
    // told me about", and it fails on the second while claiming the first.
    //
    // The kinds land at different paths because bin/docsite-build.mjs writes them differently: an
    // md doc renders to <urlPath>/index.html (lib/docsite-manifest.mjs's pagePath), an imported
    // doc is COPIED to pages/<basename of source> (bin/docsite-build.mjs:47) — keyed on the source
    // filename, never on urlPath. That asymmetry is asserted on its own below rather than smoothed
    // over here, because it is the reason a urlPath rotation cannot take effect for an imported doc.
    const importedDest = (d) => `docsite/pages/${String(d.source || '').replace(/^imported\//, '')}`;
    const expected = new Map();
    for (const d of m.docs) {
      expected.set(d.kind === 'md' ? `docsite/pages/${d.urlPath}/index.html` : importedDest(d), d);
    }
    const headFiles = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', 'HEAD', 'docsite/pages'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    for (const p of expected.keys()) {
      assert.ok(headFiles.includes(p), `manifest names ${p} but HEAD lacks it — page and manifest must land together`);
    }
    for (const f of headFiles) {
      assert.ok(expected.has(f), `HEAD carries ${f} with no manifest entry — an orphaned (possibly rotated) urlPath`);
    }
  });

  // THE ROTATION, made executable. An imported doc is ADDRESSED by urlPath and STORED under its
  // source basename, so rotating urlPath to a UUID changes the URL and leaves the file where it
  // was. The retired identity then survives in the tracked path after the identity it names has
  // been rotated away — which is the whole point of rotating it.
  //
  // This is the gate for the identity scheme: a UUID that cannot reach the filename it replaces
  // is a rename that only looks like one.
  test('an imported doc is stored under its urlPath, so a rotation reaches the file', () => {
    let headManifest;
    try {
      headManifest = execFileSync('git', ['-C', REPO, 'show', 'HEAD:docsite/manifest.json'], { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      console.log('  [skip] docsite/manifest.json not in HEAD yet — rotation gate arms on first commit');
      return;
    }
    const drift = JSON.parse(headManifest).docs
      .filter((d) => d.kind !== 'md')
      .map((d) => ({ d, stored: String(d.source || '').replace(/^imported\//, '').replace(/\.html$/, '') }))
      .filter(({ d, stored }) => stored !== d.urlPath);
    assert.deepEqual(drift.map(({ d, stored }) => `${d.urlPath} addressed, ${stored} stored`), [],
      'an imported doc whose stored basename differs from its urlPath — the rotation renamed the URL and left the file');
  });
});

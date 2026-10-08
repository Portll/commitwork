// The docsite's two roots (lib/docsite-roots.mjs): docsite/ holds the published documents, and the
// private root (CW_DOCSITE_PRIVATE; the sidecar link in the operator's checkout) holds the draft and
// hidden ones. What is pinned here: the manifest is the union and fails closed on a collision or a
// broken private file, every doc builds and writes back inside its own root, publish ships hidden
// private pages and never a private draft, and a fixture root never inherits a private one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadManifest, writeManifestAtomic, readManifestState, sourcePath, pagePath, isPrivateDoc, privateRoot, ManifestError,
} from '../../lib/docsite-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB_UUID = '0a1b2c3d-1111-4222-8333-444455556666';
const DRAFT_UUID = '9f8e7d6c-1111-4222-8333-444455556666';

const write = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const manifest = (docs) => `${JSON.stringify({ version: 1, note: 'fixture', docs }, null, 2)}\n`;

function twoRoots({ privateDocs = null } = {}) {
  const pub = mkdtempSync(join(tmpdir(), 'cw-docsite-pub-'));
  const priv = mkdtempSync(join(tmpdir(), 'cw-docsite-priv-'));
  write(pub, 'content/alpha.md', '# Alpha\n\nPublished.\n');
  // A published page carries og:image, and publish refuses a tag whose asset the bundle lacks.
  write(pub, 'public/og.png', 'png');
  write(pub, 'manifest.json', manifest([
    { slug: 'alpha', urlPath: PUB_UUID, title: 'Alpha', source: 'content/alpha.md', kind: 'md', state: 'published' },
  ]));
  write(priv, 'content/guide.md', '# Guide\n\nHidden.\n');
  write(priv, 'content/budget.md', '# Budget\n\nDraft.\n');
  write(priv, 'imported/register.html', '<!doctype html><title>Register</title><p>hidden register</p>\n');
  write(priv, 'imported/notes.html', '<!doctype html><title>Notes</title><p>draft notes</p>\n');
  write(priv, 'manifest.json', manifest(privateDocs || [
    { slug: 'guide', urlPath: 'guide', title: 'Guide', source: 'content/guide.md', kind: 'md', state: 'hidden' },
    { slug: 'budget', urlPath: DRAFT_UUID, title: 'Budget', source: 'content/budget.md', kind: 'md', state: 'draft' },
    { slug: 'register', urlPath: 'register', title: 'Register', source: 'imported/register.html', kind: 'imported', state: 'hidden' },
    { slug: 'notes', urlPath: 'notes', title: 'Notes', source: 'imported/notes.html', kind: 'imported', state: 'draft' },
  ]));
  return { pub, priv, env: { CW_DOCSITE_ROOT: pub, CW_DOCSITE_PRIVATE: priv } };
}

// Runs fn with the env applied in this process, restoring it after.
const withEnv = (vars, fn) => {
  const saved = {};
  for (const k of ['CW_DOCSITE_ROOT', 'CW_DOCSITE_PRIVATE']) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

const node = (script, env, args = []) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(REPO, 'bin', script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

describe('the manifest is the union of both roots', () => {
  test('private docs are loaded, tagged and resolved inside the private root', () => {
    const { priv, env } = twoRoots();
    withEnv(env, () => {
      const m = loadManifest();
      assert.deepEqual(m.docs.map((d) => d.slug), ['alpha', 'guide', 'budget', 'register', 'notes']);
      const guide = m.docs.find((d) => d.slug === 'guide');
      assert.equal(isPrivateDoc(guide), true);
      assert.equal(isPrivateDoc(m.docs[0]), false);
      assert.equal(sourcePath(guide), join(priv, 'content', 'guide.md'));
      assert.equal(pagePath(guide), join(priv, 'pages', 'guide', 'index.html'));
    });
  });

  test('a slug both manifests claim is a broken declaration, not a shadow', () => {
    const { env } = twoRoots({ privateDocs: [{ slug: 'alpha', urlPath: 'other', title: 'X', source: 'content/guide.md', kind: 'md', state: 'draft' }] });
    withEnv(env, () => assert.throws(() => loadManifest(), (e) => e instanceof ManifestError && e.code === 'INVALID'));
  });

  test('an absent private manifest is the public checkout: no throw, public docs only', () => {
    const pub = twoRoots().pub;
    const empty = mkdtempSync(join(tmpdir(), 'cw-docsite-nopriv-'));
    withEnv({ CW_DOCSITE_ROOT: pub, CW_DOCSITE_PRIVATE: empty }, () => {
      assert.deepEqual(loadManifest().docs.map((d) => d.slug), ['alpha']);
    });
  });

  test('a private manifest that does not parse fails closed', () => {
    const { priv, env } = twoRoots();
    writeFileSync(join(priv, 'manifest.json'), '{ "version": 1, "docs": [ TORN');
    withEnv(env, () => assert.throws(() => loadManifest(), (e) => e instanceof ManifestError && e.code === 'INVALID'));
  });

  test('a fixture root never inherits a private root', () => {
    withEnv({ CW_DOCSITE_ROOT: mkdtempSync(join(tmpdir(), 'cw-docsite-fx-')) }, () => assert.equal(privateRoot(), null));
  });

  test('the baseHash covers both files, so an edit to either refuses a stale base', () => {
    const { priv, env } = twoRoots();
    withEnv(env, () => {
      const before = readManifestState().hash;
      writeFileSync(join(priv, 'manifest.json'), readFileSync(join(priv, 'manifest.json'), 'utf8').replace('"Guide"', '"Guide 2"'));
      assert.notEqual(readManifestState().hash, before);
    });
  });
});

describe('writes go back to the manifest a doc came from', () => {
  test('a state change on a private doc rewrites the private manifest and leaves the public one\'s docs alone', () => {
    const { pub, priv, env } = twoRoots();
    withEnv(env, () => {
      const m = readManifestState().parsed;
      writeManifestAtomic({ ...m, docs: m.docs.map((d) => (d.slug === 'budget' ? { ...d, state: 'hidden' } : d)) });
    });
    const p = JSON.parse(readFileSync(join(priv, 'manifest.json'), 'utf8'));
    assert.equal(p.docs.find((d) => d.slug === 'budget').state, 'hidden');
    assert.deepEqual(JSON.parse(readFileSync(join(pub, 'manifest.json'), 'utf8')).docs.map((d) => d.slug), ['alpha'],
      'no private doc may be written into the public manifest');
  });

  test('a public-only document (an archived public manifest) never empties the private manifest', () => {
    const { pub, priv, env } = twoRoots();
    const before = readFileSync(join(priv, 'manifest.json'), 'utf8');
    withEnv(env, () => writeManifestAtomic(JSON.parse(readFileSync(join(pub, 'manifest.json'), 'utf8'))));
    assert.equal(readFileSync(join(priv, 'manifest.json'), 'utf8'), before);
  });

  test('docsite-new mints a draft into the private root when one is present', () => {
    const { pub, priv, env } = twoRoots();
    const r = node('docsite-new.mjs', env, ['fresh', 'Fresh draft']);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(priv, 'content', 'fresh.md')));
    assert.ok(!existsSync(join(pub, 'content', 'fresh.md')), 'a draft never lands in the public tree');
    assert.ok(JSON.parse(readFileSync(join(priv, 'manifest.json'), 'utf8')).docs.some((d) => d.slug === 'fresh'));
  });
});

describe('build and publish cover both roots', () => {
  test('the build renders each doc in its own root and checks orphans per root', () => {
    const { pub, priv, env } = twoRoots();
    let r = node('docsite-build.mjs', env);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(priv, 'pages', 'guide', 'index.html')));
    assert.ok(existsSync(join(priv, 'pages', 'register.html')), 'an imported private doc is copied beside its own pages');
    assert.ok(!existsSync(join(pub, 'pages', 'guide')), 'nothing private is built into the public root');
    mkdirSync(join(priv, 'pages', 'stray'), { recursive: true });
    r = node('docsite-build.mjs', env);
    assert.equal(r.code, 2);
    assert.match(r.out, /orphan: .*stray/);
  });

  test('publish ships hidden private pages and never a private draft', () => {
    const { env } = twoRoots();
    const dist = mkdtempSync(join(tmpdir(), 'cw-docsite-dist-'));
    assert.equal(node('docsite-build.mjs', env).code, 0);
    const r = node('docsite-publish.mjs', { ...env, CW_DOCSITE_DIST: dist }, ['--dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(dist, 'guide', 'index.html')), 'a hidden private md doc ships');
    assert.ok(existsSync(join(dist, 'register.html')), 'a hidden private imported doc ships');
    assert.ok(!existsSync(join(dist, DRAFT_UUID)), 'a private draft never ships');
    assert.ok(!existsSync(join(dist, 'notes.html')), 'a private draft import never ships');
    assert.match(r.out, /budget \(draft\)/, 'and its exclusion is named');
    assert.doesNotMatch(readFileSync(join(dist, 'index.html'), 'utf8'), /Guide|Register|Budget/, 'the index lists published docs only');
  });
});

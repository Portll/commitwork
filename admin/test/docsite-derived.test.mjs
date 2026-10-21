// A derived docsite doc (manifest editVia) is edited as Markdown and stored in its registry. These
// drive the real route handlers against temp copies: open, save, conflict, refusal and restore must
// all go through the registry, never write the generated Markdown as a second truth.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.env.CW_DOCSITE_SKIP_DEPLOY = '1';

import { routes } from '../routes/docsite.mjs';
import { toMarkdown } from '../../lib/remediation-md.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = readFileSync(join(REPO, 'monitor', 'failure-taxonomy.json'), 'utf8');
const UUID = 'e231ef2a-e056-497e-86c8-1e6c204f284a';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const handlerFor = (method, path) => routes.find((x) => x.method === method && x.path === path).handle;

class FakeReq extends EventEmitter {
  constructor(method) { super(); this.method = method; this.headers = {}; }
  destroy() { this.emit('end'); }
}
class FakeRes {
  constructor() { this.headers = {}; this.done = new Promise((r) => { this._resolve = r; }); }
  writeHead(code, headers = {}) { this.code = code; Object.assign(this.headers, headers); }
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; }
  end(buf) { this.body = buf === undefined ? '' : buf; this._resolve(this); }
  get json() { return JSON.parse(this.body.toString()); }
}
const call = async (method, path, { query = '', body } = {}) => {
  const req = new FakeReq(method);
  const res = new FakeRes();
  handlerFor(method, path)({ req, res, pathname: path, query: new URLSearchParams(query), adminSession: () => ({ user: 'op' }), isLoopbackReq: false });
  if (method === 'POST') { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }
  return res.done;
};

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-docsite-derived-'));
  const root = join(dir, 'docsite');
  mkdirSync(join(root, 'content'), { recursive: true });
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, docs: [{
    slug: 'taxonomy-remediation', urlPath: UUID, title: 'Remediation register', source: 'content/taxonomy-remediation.md',
    kind: 'md', state: 'draft', editVia: 'remediations',
  }] }, null, 2));
  const registry = join(dir, 'failure-taxonomy.json');
  writeFileSync(registry, RAW);
  writeFileSync(join(root, 'content', 'taxonomy-remediation.md'), 'stale generated copy\n');
  process.env.CW_DOCSITE_ROOT = root;
  process.env.CW_TAXONOMY_JSON = registry;
  return { root, registry, md: () => readFileSync(join(root, 'content', 'taxonomy-remediation.md'), 'utf8') };
};
const MD = toMarkdown(JSON.parse(RAW));
const edit = (md) => md.replace(/(### Action 3: [^\n]*\n\n- \*\*Status:\*\* )[^\n]*/, '$1DONE 2026-10-05 edited in the docsite');

describe('derived docsite doc (editVia: remediations)', () => {
  test('open serves the registry rendering, not the stale file on disk', async () => {
    setup();
    const res = await call('GET', '/api/docsite/doc', { query: 'slug=taxonomy-remediation' });
    assert.equal(res.code, 200);
    assert.equal(res.json.content, MD);
    assert.equal(res.json.hash, sha(MD));
    const head = await call('GET', '/api/docsite/head', { query: 'slug=taxonomy-remediation' });
    assert.equal(head.json.hash, sha(MD), 'the watcher polls the same truth the editor loaded');
  });

  test('save writes the registry, the canonical Markdown and the themed page', async () => {
    const t = setup();
    const res = await call('POST', '/api/docsite/save', { body: { slug: 'taxonomy-remediation', content: edit(MD), baseHash: sha(MD) } });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    const reg = JSON.parse(readFileSync(t.registry, 'utf8'));
    assert.equal(reg.remediations.find((r) => r.rank === 3).status, 'DONE 2026-10-05 edited in the docsite');
    // The summary above the entries is regenerated, so the stored text is the registry's rendering.
    assert.equal(t.md(), toMarkdown(reg));
    assert.match(t.md(), /\*\*Status count:\*\* DONE 8 · PARTIAL 13 · OPEN 3/);
    assert.equal(res.json.newHash, sha(toMarkdown(reg)));
    assert.equal(res.json.content, toMarkdown(reg), 'the editor is handed the normalised text');
    const page = readFileSync(join(t.root, 'pages', UUID, 'index.html'), 'utf8');
    assert.match(page, /edited in the docsite/);
    assert.doesNotMatch(page, /<script/i);
  });

  test('a stale base is a conflict carrying the current text, and nothing is written', async () => {
    const t = setup();
    const res = await call('POST', '/api/docsite/save', { body: { slug: 'taxonomy-remediation', content: edit(MD), baseHash: sha('older') } });
    assert.equal(res.code, 409);
    assert.equal(res.json.currentContent, MD);
    assert.equal(readFileSync(t.registry, 'utf8'), RAW);
  });

  test('Markdown the register cannot place is refused and the registry is untouched', async () => {
    const t = setup();
    const res = await call('POST', '/api/docsite/save', { body: { slug: 'taxonomy-remediation', content: MD.replace(/\n- \*\*Risk:\*\*[^\n]*/, ''), baseHash: sha(MD) } });
    assert.equal(res.code, 422);
    assert.match(res.json.error, /Risk line is missing/);
    assert.equal(readFileSync(t.registry, 'utf8'), RAW);
  });

  test('restoring an editor version goes back through the registry', async () => {
    const t = setup();
    await call('POST', '/api/docsite/save', { body: { slug: 'taxonomy-remediation', content: edit(MD), baseHash: sha(MD) } });
    const listed = await call('GET', '/api/docsite/versions', { query: `key=${UUID}&origin=editor-save` });
    assert.equal(listed.json.versions.length, 1);
    const res = await call('POST', '/api/docsite/restore', { body: { key: UUID, origin: 'editor-save', id: listed.json.versions[0].id } });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    assert.equal(readFileSync(t.registry, 'utf8'), RAW, 'the registry is byte-identical to before the edit');
    assert.equal(t.md(), MD);
    assert.ok(existsSync(join(t.root, 'pages', UUID, 'index.html')));
  });

  test('diff compares against the registry rendering, not the stale file on disk', async () => {
    setup();
    const res = await call('POST', '/api/docsite/diff', { body: { slug: 'taxonomy-remediation', text: MD } });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    assert.equal(res.json.unchanged, true, 'the stale disk copy was used as the base');
    assert.equal(res.json.baseHash, sha(MD));
  });

  test('a first save whose page write fails leaves no Markdown behind', async () => {
    const t = setup();
    rmSync(join(t.root, 'content', 'taxonomy-remediation.md'));
    mkdirSync(join(t.root, 'pages'), { recursive: true });
    writeFileSync(join(t.root, 'pages', UUID), 'a file where the page directory goes');
    const res = await call('POST', '/api/docsite/save', { body: { slug: 'taxonomy-remediation', content: edit(MD), baseHash: sha(MD) } });
    assert.equal(res.code, 500, JSON.stringify(res.json));
    assert.equal(res.json.rolledBack, true);
    assert.equal(readFileSync(t.registry, 'utf8'), RAW, 'the registry is restored');
    assert.equal(existsSync(join(t.root, 'content', 'taxonomy-remediation.md')), false, 'the rejected edit stayed on disk as Markdown');
  });

  test('a private doc keeps its save versions in its own root, where restore finds them', async () => {
    const t = setup();
    const priv = join(dirname(t.root), 'private');
    mkdirSync(join(priv, 'content'), { recursive: true });
    writeFileSync(join(priv, 'manifest.json'), readFileSync(join(t.root, 'manifest.json')));
    writeFileSync(join(t.root, 'manifest.json'), JSON.stringify({ version: 1, docs: [] }));
    process.env.CW_DOCSITE_PRIVATE = priv;
    try {
      const saved = await call('POST', '/api/docsite/save', { body: { slug: 'taxonomy-remediation', content: edit(MD), baseHash: sha(MD) } });
      assert.equal(saved.code, 200, JSON.stringify(saved.json));
      const listed = await call('GET', '/api/docsite/versions', { query: `key=${UUID}&origin=editor-save` });
      assert.equal(listed.json.versions?.length, 1, JSON.stringify(listed.json));
      const publicVersions = join(t.root, '.versions');
      assert.equal(existsSync(publicVersions) && readdirSync(publicVersions).includes(UUID), false, 'the private register was versioned in the public root');
    } finally { delete process.env.CW_DOCSITE_PRIVATE; }
  });
});

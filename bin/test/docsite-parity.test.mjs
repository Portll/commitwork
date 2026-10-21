// Preview === published, held two ways with different failure modes: (1) the bytes the editor is
// served ARE lib/docsite-md.mjs and lib/render-markdown.mjs (file identity through the asset
// route); (2) importing those served bytes from a copy renders a fixture doc byte-identically to
// the build's own import (behavioral identity). One witness catches a route serving the wrong
// file; the other catches an import graph that resolves somewhere unexpected.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { routes } from '../../admin/routes/docsite.mjs';
import { renderDocBody } from '../../lib/docsite-md.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURE_MD = readFileSync(join(HERE, 'fixtures', 'docsite', 'content', 'alpha.md'), 'utf8');

const serveBytes = async (path) => {
  const r = routes.find((x) => x.method === 'GET' && x.path === path);
  assert.ok(r, `asset route ${path} must exist`);
  const res = {
    headers: {}, writeHead(code, h) { this.code = code; Object.assign(this.headers, h); },
    end(buf) { this.body = buf; },
  };
  r.handle({ pathname: path, res, req: { headers: {} } });
  assert.equal(res.code, 200, `${path} must serve`);
  return res.body;
};

describe('docsite parser parity', () => {
  test('served parser bytes are lib/ bytes, verbatim', async () => {
    const pairs = [
      ['/edit-assets/docsite-md.mjs', join(REPO, 'lib', 'docsite-md.mjs')],
      ['/edit-assets/render-markdown.mjs', join(REPO, 'lib', 'render-markdown.mjs')],
      ['/edit-assets/html-escape.mjs', join(REPO, 'lib', 'html-escape.mjs')],
      ['/edit-assets/editor.js', join(REPO, 'docsite', 'editor', 'editor.js')],
      ['/edit-assets/editor.css', join(REPO, 'docsite', 'editor', 'editor.css')],
    ];
    for (const [route, file] of pairs) {
      assert.deepEqual(await serveBytes(route), readFileSync(file), `${route} !== ${file}`);
    }
  });

  test('importing the served bytes renders byte-identically to the build import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-docsite-parity-'));
    writeFileSync(join(dir, 'docsite-md.mjs'), await serveBytes('/edit-assets/docsite-md.mjs'));
    writeFileSync(join(dir, 'render-markdown.mjs'), await serveBytes('/edit-assets/render-markdown.mjs'));
    writeFileSync(join(dir, 'html-escape.mjs'), await serveBytes('/edit-assets/html-escape.mjs'));
    const served = await import(pathToFileURL(join(dir, 'docsite-md.mjs')).href);
    assert.equal(served.renderDocBody(FIXTURE_MD), renderDocBody(FIXTURE_MD),
      'the preview parser and the build parser disagree — the parity the editor promises is broken');
  });
});

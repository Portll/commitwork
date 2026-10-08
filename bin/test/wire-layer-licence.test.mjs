// Wire layer: manifest entries exist and carry their licence marker
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'manifests', 'wire-layer.json'), 'utf8'));
const head = (p, n = 3) => readFileSync(p, 'utf8').split('\n').slice(0, n).join('\n');

describe('the Apache-2.0 wire layer is declared, present and marked', () => {
  test('the licence text named by the manifest is the Apache License 2.0', () => {
    const t = readFileSync(join(REPO, MANIFEST.licenseText), 'utf8');
    assert.equal(MANIFEST.license, 'Apache-2.0');
    assert.match(t, /Apache License\s+Version 2\.0, January 2004/);
  });

  test('every entry exists, and a directory entry carries its LICENSE file', () => {
    for (const e of MANIFEST.entries) {
      const p = join(REPO, e.path);
      assert.ok(existsSync(p), `${e.path} is listed but absent`);
      if (e.kind === 'directory') {
        assert.ok(statSync(p).isDirectory(), `${e.path} is not a directory`);
        assert.match(readFileSync(join(REPO, e.marker), 'utf8'), /SPDX-License-Identifier: Apache-2\.0/, `${e.marker} must name the licence`);
      }
    }
  });

  test('every file entry marked spdx-header carries the SPDX line in its first lines', () => {
    for (const e of MANIFEST.entries.filter((x) => x.marker === 'spdx-header')) {
      assert.match(head(join(REPO, e.path)), /SPDX-License-Identifier: Apache-2\.0/, `${e.path} lacks its SPDX header`);
    }
  });

  test('nothing executable rides the wire licence under schema/', () => {
    const names = readdirSync(join(REPO, 'schema'));
    const code = names.filter((n) => /\.(mjs|cjs|js|ts|sh|py)$/.test(n));
    assert.deepEqual(code, [], `code under schema/: ${code.join(', ')}`);
    assert.ok(names.includes('LICENSE'));
  });

  test('vendored upstream schemas are excluded by name, in the manifest and in the LICENSE file', () => {
    const ex = (MANIFEST.excluded || []).map((e) => e.path);
    assert.ok(ex.includes('schema/upstream/'), 'schema/upstream/ is third-party and must be excluded');
    assert.match(readFileSync(join(REPO, 'schema', 'LICENSE'), 'utf8'), /schema\/upstream\//);
    const dirEntry = MANIFEST.entries.find((e) => e.path === 'schema/');
    assert.ok((dirEntry.excludes || []).includes('schema/upstream/'));
  });

  test('mcp/tools.mjs imports nothing — a wire file must not pull AGPL code across the boundary', () => {
    const src = readFileSync(join(REPO, 'mcp', 'tools.mjs'), 'utf8');
    assert.ok(!/^\s*import\s/m.test(src), 'mcp/tools.mjs must have no import statements');
  });

  test('the server publishes exactly the descriptors the wire file declares', async () => {
    const { toolDescriptors } = await import('../../mcp/tools.mjs');
    const { handleRequest, makeContext } = await import('../../mcp/server.mjs');
    const listed = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, makeContext()).result.tools.map((t) => t.name).sort();
    assert.deepEqual(listed, Object.keys(toolDescriptors()).sort());
  });
});

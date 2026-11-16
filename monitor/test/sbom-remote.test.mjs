// node --test monitor/test/sbom-remote.test.mjs — remote deno.lock entries become one component per package.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteUrl, collapseRemote } from '../sbom-remote.mjs';

test('remote URLs name their package, including the esm.sh forms syft misreads', () => {
  assert.deepEqual(parseRemoteUrl('https://deno.land/std@0.216.0/assert/_constants.ts'),
    { name: 'deno.land/std', version: '0.216.0', base: 'https://deno.land/std@0.216.0', registry: 'https://deno.land' });
  assert.equal(parseRemoteUrl('https://deno.land/x/fresh@1.7.3/dev.ts').name, 'deno.land/x/fresh');
  assert.equal(parseRemoteUrl('https://esm.sh/@babel/helper-validator-identifier@7.22.20/denonext/x.mjs').name, '@babel/helper-validator-identifier');
  assert.deepEqual(parseRemoteUrl('https://esm.sh/*@preact/signals-core@1.5.1').version, '1.5.1');
  assert.equal(parseRemoteUrl('https://esm.sh/*preact-render-to-string@6.3.1').name, 'preact-render-to-string');
  assert.equal(parseRemoteUrl('https://esm.sh/v135/preact@10.22.0/denonext/preact.mjs').name, 'preact');
  assert.equal(parseRemoteUrl('https://example.com/mod.ts'), null);
  assert.equal(parseRemoteUrl('not a url'), null);
});

const comp = (id, name, version, loc = '/site/deno.lock') => ({ 'bom-ref': `pkg:npm/x?package-id=${id}`, type: 'library', name, version,
  purl: `pkg:npm/${encodeURIComponent(name)}@${version}?repository_url=https%3A%2F%2Fesm.sh`,
  properties: [{ name: 'syft:location:0:path', value: loc }] });
const art = (id, url) => ({ id, metadataType: 'deno-remote-lock-entry', metadata: { url } });

test('per-file components merge into one per package and lockfile, renamed from the URL, counted not dropped', () => {
  const cdx = { components: [
    comp('a1', 'esm.sh/', 'babel'), comp('a2', 'esm.sh/', 'babel'),
    comp('b1', 'deno.land/std', '0.216.0'), comp('b2', 'deno.land/std', '0.216.0'), comp('b3', 'deno.land/std', '0.216.0'),
    comp('c1', 'deno.land/std', '0.216.0', '/e2e/deno.lock'),
    { 'bom-ref': 'pkg:npm/zod@3?package-id=z1', name: 'zod', version: '3.0.0', purl: 'pkg:npm/zod@3.0.0' },
  ], dependencies: [{ ref: 'pkg:npm/x?package-id=b2', dependsOn: ['pkg:npm/x?package-id=a2'] }] };
  const native = { artifacts: [
    art('a1', 'https://esm.sh/@babel/helper-validator-identifier@7.22.20'), art('a2', 'https://esm.sh/@babel/helper-validator-identifier@7.22.20/denonext/x.mjs'),
    art('b1', 'https://deno.land/std@0.216.0/a.ts'), art('b2', 'https://deno.land/std@0.216.0/b.ts'), art('b3', 'https://deno.land/std@0.216.0/c.ts'),
    art('c1', 'https://deno.land/std@0.216.0/a.ts'),
  ] };
  const { report } = collapseRemote(cdx, native);
  assert.deepEqual(report, { ran: true, remoteEntries: 6, packages: 3, merged: 3, renamed: 1, unparsed: 0 });
  assert.equal(cdx.components.length, 4);
  const babel = cdx.components.find((c) => c.name === '@babel/helper-validator-identifier');
  assert.equal(babel.version, '7.22.20');
  assert.equal(babel.purl, 'pkg:npm/%40babel/helper-validator-identifier@7.22.20?repository_url=https%3A%2F%2Fesm.sh');
  assert.equal(babel.properties.find((p) => p.name === 'commitwork:remote-files').value, '2');
  const std = cdx.components.filter((c) => c.name === 'deno.land/std');
  assert.deepEqual(std.map((c) => c.properties.find((p) => p.name === 'commitwork:remote-files').value), ['3', '1']);
  assert.deepEqual(cdx.dependencies, [{ ref: 'pkg:npm/x?package-id=b1', dependsOn: ['pkg:npm/x?package-id=a1'] }]);
  assert.ok(cdx.components.some((c) => c.name === 'zod'));
});

test('no native document: nothing is changed, and the report says it did not run', () => {
  const cdx = { components: [comp('a1', 'esm.sh/', 'babel')] };
  assert.equal(collapseRemote(cdx, null).report.ran, false);
  assert.equal(cdx.components[0].name, 'esm.sh/');
});

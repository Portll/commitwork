// The lane for code we ship but do not own. The property under test is "does it ever report a
// vendored file as safe when it has no idea what the file is".
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findVendored, identify, scan } from '../vendor-scan.mjs';

// A local stub standing in for OSV, so the online paths are exercised without the network.
let servers = [];
// listen() is async — address() is null until it fires, so this awaits rather than assuming.
function stubOsv(vulns) {
  const http = require('node:http');
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ vulns }));
    });
    srv.listen(0, '127.0.0.1', () => {
      servers.push(srv);
      resolve(`http://127.0.0.1:${srv.address().port}/v1/query`);
    });
  });
}
const restore = (prev) => { if (prev === undefined) delete process.env.CW_VENDOR_OSV_URL; else process.env.CW_VENDOR_OSV_URL = prev; };
after(() => { for (const s of servers) s.close(); });

const fixture = () => {
  const d = mkdtempSync(join(tmpdir(), 'vendor-'));
  mkdirSync(join(d, 'sitemap', 'vendor'), { recursive: true });
  mkdirSync(join(d, 'node_modules', 'three'), { recursive: true });
  mkdirSync(join(d, 'reports'), { recursive: true });
  mkdirSync(join(d, '.claude', 'worktrees', 'agent-x', 'vendor'), { recursive: true });
  return d;
};

test('findVendored takes vendor dirs and .min bundles, and NOTHING from node_modules/reports/worktrees', () => {
  const d = fixture();
  writeFileSync(join(d, 'sitemap', 'vendor', 'lib.js'), '// x');
  writeFileSync(join(d, 'app.min.js'), '// y');                       // minified anywhere counts
  writeFileSync(join(d, 'src.js'), '// ours, not vendored');
  writeFileSync(join(d, 'node_modules', 'three', 'three.js'), '// someone else s tree');
  writeFileSync(join(d, 'reports', 'out.min.js'), '// our own output');
  writeFileSync(join(d, '.claude', 'worktrees', 'agent-x', 'vendor', 'dup.js'), '// a copy of us');
  const got = findVendored(d);
  assert.deepEqual(got, ['app.min.js', join('sitemap', 'vendor', 'lib.js')]);
});

test('three.js is identified from a DEEP marker and mapped to its npm version', () => {
  // r147's only readable version marker lives ~383 KB into the bundle, not in the banner.
  const body = '/**\n * @license\n * Copyright 2010-2022 Three.js Authors\n */\n' + 'x'.repeat(9000)
    + 'console.warn("three.js r147 something")';
  const id = identify(body, 'three.min.js');
  assert.equal(id.package, 'three');
  // THE MAPPING THAT MATTERS: three ships rNNN, npm publishes 0.NNN.0. Lifting "147" verbatim
  // would query a version that does not exist and come back clean.
  assert.equal(id.version, '0.147.0');
});

test('a banner-versioned library is identified from the banner', () => {
  assert.deepEqual(
    { ...identify('/*! jQuery JavaScript Library v3.4.1 */', 'jquery.js') },
    { package: 'jquery', version: '3.4.1', ecosystem: 'npm', via: 'banner' },
  );
});

test('NO banner and no marker means UNIDENTIFIED — never a silent pass', () => {
  assert.equal(identify('( function () {\n\t// controls\n} )();', 'OrbitControls.js'), null);
});

test('an unidentified file is counted, sized, and named in the verdict', async () => {
  const d = fixture();
  writeFileSync(join(d, 'sitemap', 'vendor', 'mystery.js'), 'x'.repeat(2048));
  const r = await scan(d, { offline: true });
  assert.equal(r.summary.unidentified, 1);
  assert.equal(r.unidentified[0].bytes, 2048, 'size travels — a big blob is a bigger void');
  assert.match(r.unidentified[0].reason, /cannot resolve/);
});

test('a clean-but-unidentified run does NOT say clean', async () => {
  const d = fixture();
  writeFileSync(join(d, 'sitemap', 'vendor', 'mystery.js'), 'no version here');
  // online, advisory DB returns nothing for the identified file, one file unidentifiable
  writeFileSync(join(d, 'sitemap', 'vendor', 'jq.js'), '/*! jQuery v3.4.1 */');
  const prev = process.env.CW_VENDOR_OSV_URL;
  process.env.CW_VENDOR_OSV_URL = await stubOsv([]);
  try {
    const r = await scan(d, {});
    assert.equal(r.ran, true, 'the lookup really ran');
    assert.equal(r.findings.length, 0, 'and found nothing');
    assert.notEqual(r.summary.verdict, 'clean', 'yet the verdict is NOT clean');
    assert.match(r.summary.verdict, /could not be identified/);
  } finally { restore(prev); }
});

test('offline reports ran:false with a reason — identification is not a scan', async () => {
  const d = fixture();
  writeFileSync(join(d, 'sitemap', 'vendor', 'jq.js'), '/*! jQuery v3.4.1 */');
  const r = await scan(d, { offline: true });
  assert.equal(r.ran, false);
  assert.equal(r.skipped, true);
  assert.match(r.summary.verdict, /^NOT RUN/);
  assert.equal(r.findings.length, 0, 'no lookup happened, so no findings may be claimed either way');
});

test('an unreachable advisory database is NOT a clean one', async () => {
  const d = fixture();
  writeFileSync(join(d, 'sitemap', 'vendor', 'jq.js'), '/*! jQuery v3.4.1 */');
  const prev = process.env.CW_VENDOR_OSV_URL;
  process.env.CW_VENDOR_OSV_URL = 'http://127.0.0.1:1/nope';   // nothing listens on port 1
  try {
    const r = await scan(d, {});
    assert.equal(r.ran, false, 'a failed lookup means the run did not happen');
    assert.match(r.reason, /INCOMPLETE, not absent/);
    assert.match(r.summary.verdict, /^NOT RUN/);
  } finally { restore(prev); }
});

test('output is deterministic — same tree, byte-identical result under a fixed clock', async () => {
  const d = fixture();
  writeFileSync(join(d, 'sitemap', 'vendor', 'b.js'), '/*! jQuery v3.4.1 */');
  writeFileSync(join(d, 'sitemap', 'vendor', 'a.js'), 'mystery');
  process.env.CW_NOW = '2026-08-03T00:00:00.000Z';
  const a = JSON.stringify(await scan(d, { offline: true }));
  const b = JSON.stringify(await scan(d, { offline: true }));
  delete process.env.CW_NOW;
  assert.equal(a, b);
});

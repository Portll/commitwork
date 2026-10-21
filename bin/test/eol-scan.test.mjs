// bin/eol-scan.mjs: what counts as a pin, how a version is placed in a release line, and the
// eol / ending / supported verdict at a fixed date. A synthetic snapshot keeps these independent of
// the refreshed data; one test checks the shipped snapshot covers every product the lane names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageVersion, enginesNodeVersion, cycleFor, statusOf, declarationsIn, scan } from '../eol-scan.mjs';
import { PRODUCTS } from '../eol-snapshot.mjs';

const NOW = new Date('2026-10-11T00:00:00Z');
const SNAP = {
  fetched: '2026-10-11',
  products: {
    nodejs: [{ cycle: '16', eol: '2023-09-11' }, { cycle: '22', eol: '2027-04-30' }],
    python: [{ cycle: '3.8', eol: '2024-10-07' }, { cycle: '3.10', eol: '2026-10-04' }, { cycle: '3.13', eol: '2029-10-31' }],
    debian: [{ cycle: '10', eol: '2024-06-30', codename: 'buster' }, { cycle: '12', eol: '2028-06-30', codename: 'bookworm' }],
    ubuntu: [{ cycle: '22.04', eol: '2027-04-01', codename: 'jammy jellyfish' }],
    postgresql: [{ cycle: '14', eol: '2026-11-12' }, { cycle: '9.6', eol: '2021-11-11' }],
    go: [{ cycle: '1.25', eol: '2026-08-19' }],
    redis: [{ cycle: '8.4', eol: false }, { cycle: '6.0', eol: true }],
    dotnet: [{ cycle: '6', eol: '2024-11-12' }],
  },
};

test('only official images are read, and a floating or variable tag is not a pin', () => {
  assert.deepEqual(imageVersion('node:16-alpine'), { product: 'nodejs', version: '16-alpine' });
  assert.deepEqual(imageVersion('docker.io/library/python:3.8-slim'), { product: 'python', version: '3.8-slim' });
  assert.deepEqual(imageVersion('postgres:14@sha256:abcdef0123'), { product: 'postgresql', version: '14' });
  assert.deepEqual(imageVersion('mcr.microsoft.com/dotnet/aspnet:6.0'), { product: 'dotnet', version: '6.0' });
  for (const r of ['mxnet/python:1.9.1_cpu_py3', 'bitnami/postgresql:12', 'node', 'node:latest', '${BASE}:16', 'scratch']) assert.equal(imageVersion(r), null, r);
});

test('engines.node is a pin only when it names one major', () => {
  for (const [spec, want] of [['16', '16'], ['16.x', '16'], ['^16.0.0', '16'], ['~16.14', '16'], ['v18.20.1', '18']]) assert.equal(enginesNodeVersion(spec), want, spec);
  for (const spec of ['>=16', '>=16 <20', '16 || 18', '*', '', null]) assert.equal(enginesNodeVersion(spec), null, String(spec));
});

test('a version is placed by its longest matching prefix or by codename; an unplaced one is null', () => {
  assert.equal(cycleFor('nodejs', 'v16.20.0', SNAP).cycle, '16');
  assert.equal(cycleFor('python', '3.10.4', SNAP).cycle, '3.10', '3.10 must not collapse to 3.1');
  assert.equal(cycleFor('postgresql', '9.6.24', SNAP).cycle, '9.6');
  assert.equal(cycleFor('dotnet', '6.0', SNAP).cycle, '6');
  assert.equal(cycleFor('debian', 'buster-slim', SNAP).cycle, '10');
  assert.equal(cycleFor('ubuntu', 'jammy', SNAP).cycle, '22.04');
  for (const [p, v] of [['python', '3'], ['debian', 'testing'], ['nodejs', 'lts'], ['go', '1.99'], ['nginx', '1.25']]) assert.equal(cycleFor(p, v, SNAP), null, `${p} ${v}`);
});

test('the verdict follows the end-of-life date at the as-of date', () => {
  assert.deepEqual(statusOf({ eol: '2023-09-11' }, NOW), { status: 'eol', date: '2023-09-11' });
  assert.deepEqual(statusOf({ eol: '2026-11-12' }, NOW), { status: 'ending', date: '2026-11-12' });
  assert.equal(statusOf({ eol: '2029-10-31' }, NOW).status, 'supported');
  assert.equal(statusOf({ eol: true }, NOW).status, 'eol');
  assert.equal(statusOf({ eol: false }, NOW).status, 'supported');
});

test('each declaration file yields its pins; minimums are not pins', () => {
  assert.deepEqual(declarationsIn('Dockerfile', 'FROM --platform=linux/amd64 node:16 AS build\nFROM build\nFROM debian:bookworm-slim\n').map((d) => [d.product, d.version, d.line]),
    [['nodejs', '16', 1], ['debian', 'bookworm-slim', 3]]);
  assert.deepEqual(declarationsIn('docker-compose.yml', 'services:\n  db:\n    image: "postgres:9.6"\n').map((d) => [d.product, d.version, d.line]), [['postgresql', '9.6', 3]]);
  assert.equal(declarationsIn('.nvmrc', 'v16.20.0\n')[0].version, 'v16.20.0');
  assert.equal(declarationsIn('.nvmrc', 'lts/*\n').length, 0);
  assert.equal(declarationsIn('package.json', '{"engines":{"node":"^16"}}')[0].version, '16');
  assert.equal(declarationsIn('package.json', '{"engines":{"node":">=16"}}').length, 0);
  assert.equal(declarationsIn('package.json', '{ not json').length, 0);
  assert.equal(declarationsIn('runtime.txt', 'python-3.8.10\n')[0].version, '3.8.10');
  assert.deepEqual(declarationsIn('.tool-versions', 'nodejs 16.20.0\nterraform 1.5.0\npython 3.10.4\n').map((d) => d.product), ['nodejs', 'python']);
  assert.equal(declarationsIn('go.mod', 'module x\n\ngo 1.20\n').length, 0, 'the go directive is a minimum');
  assert.equal(declarationsIn('go.mod', 'module x\n\ngo 1.24\ntoolchain go1.25.3\n')[0].version, '1.25.3');
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-eol-'));
  const put = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  put('Dockerfile', 'FROM node:16-alpine\n');
  put('svc/docker-compose.yml', 'services:\n  db:\n    image: postgres:14\n  cache:\n    image: redis:8.4\n');
  put('.python-version', '3.13.1\n');
  put('ci/Dockerfile', 'FROM debian:testing\n');
  put('node_modules/x/Dockerfile', 'FROM node:12\n');
  put('.claude/worktrees/agent-a/Dockerfile', 'FROM node:12\n');
  return dir;
}

test('a repository scan reports eol and ending pins as SARIF, lists the unplaced, and skips copies and installs', () => {
  const doc = scan(repo(), SNAP, NOW);
  const run = doc.runs[0];
  assert.deepEqual(run.results.map((r) => [r.ruleId, r.level, r.locations[0].physicalLocation.artifactLocation.uri]),
    [['eol/nodejs-16', 'warning', 'Dockerfile'], ['eol/postgresql-14', 'note', 'svc/docker-compose.yml']]);
  assert.equal(run.tool.driver.rules.find((r) => r.id === 'eol/nodejs-16').shortDescription.text, 'Node.js 16 reached end of life on 2023-09-11');
  assert.deepEqual(run.properties.undetermined.map((u) => [u.file, u.version]), [['ci/Dockerfile', 'testing']]);
  assert.equal(run.invocations[0].executionSuccessful, true, 'an invocation record makes a zero a witnessed zero');
  assert.equal(JSON.stringify(scan(repo(), SNAP, NOW)), JSON.stringify(doc), 'same inputs, same bytes');
});

test('the shipped snapshot parses and covers every product the lane names', () => {
  const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'manifests', 'eol-snapshot.json'), 'utf8'));
  assert.match(shipped.fetched, /^\d{4}-\d{2}-\d{2}$/);
  for (const p of PRODUCTS) assert.ok(Array.isArray(shipped.products[p]) && shipped.products[p].length > 0, `${p} has no cycles`);
});

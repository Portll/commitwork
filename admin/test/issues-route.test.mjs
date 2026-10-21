// The Issues tab's wire contract — GET /api/issues against a really-spawned panel: every row's key
// set equals panelRows()'s whitelist exactly, a corrupt store is 500 (never 200-with-[]), and a
// never-ingested area says so. Fixture store built through monitor/issue-store.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock } from '../../monitor/issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-issues-'));
const ISSUES = join(TMP, 'issues.json');

// the panelRows whitelist — the ONLY keys a row may carry over the wire
const WHITELIST = ['id', 'area', 'kind', 'severity', 'state', 'ageDays', 'slaBreached', 'title'];
// a located path that exists in the store (issue body) and must never leave through this route
const PATH_MARKER = 'src/deep/secret-holder.js';

let localPort, child;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET' }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  req.end();
});

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true },
      { slug: 'empty-area', label: 'empty-area', out: 'empty-area' }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  // A rollup NEWER than lastIngest — behind by construction; 'empty-area' gets no rollup at all.
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify({
    sliceId: 'sweep-20260801120000', generated: '2026-08-01T12:00:00.000Z', repos: [], scanners: {}, scannerFindings: {},
  }));

  // fixture store, built through the library so it is schema-valid by construction
  const at = '2026-08-01T00:00:00.000Z';
  const doc = emptyIssuesDoc();
  mintIssue(doc, {
    area: 'fixarea', repo: 'alpha', kind: 'code', severity: 'high',
    title: 'aws-key [secrets] (alpha)', body: `hardcoded key at ${PATH_MARKER}:5`,
    source: { kind: 'scanner-row', key: `sc:alpha|secrets|aws-key|${PATH_MARKER}|5`, tool: 'secrets', rule: 'aws-key' },
    anchor: { file: PATH_MARKER, line: 5, hash: null },
  }, at);
  mintIssue(doc, {
    area: 'fixarea', repo: null, kind: 'task', severity: 'med',
    title: 'rotate the fixture credential',
    class: 'S',   // manual-sourced: no scanner to infer a class from, so the fixture states one
    source: { kind: 'manual', key: null, tool: null, rule: null },
  }, at);
  doc.lastIngest.fixarea = { sliceId: 'sweep-20260801000000', generated: at };
  // saveIssues refuses to write without the store's lock; a fixture build is not exempt from it.
  withIssuesLock(() => saveIssues(doc, { path: ISSUES }), { path: ISSUES });

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ISSUES: ISSUES, CW_NOW: '2026-08-02T00:00:00.000Z',
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await hit('/api/csrf')).status === 200; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

test('GET /api/issues answers 200 JSON with rows and an ingest status', async () => {
  const r = await hit('/api/issues?project=fixarea');
  assert.equal(r.status, 200);
  assert.ok(r.json, 'the payload is JSON');
  assert.ok(r.json.generated, 'the payload is dated');
  assert.equal(r.json.area, 'fixarea');
  assert.deepEqual(r.json.areaStatus, { sliceId: 'sweep-20260801000000', generated: '2026-08-01T00:00:00.000Z' });
  assert.equal(r.json.rows.length, 2, 'both fixture issues are open and served');
});

test('every row carries EXACTLY the panelRows whitelist — set equality, no extras ever', async () => {
  const r = await hit('/api/issues?project=fixarea');
  assert.ok(r.json.rows.length >= 1, 'the whitelist assertion needs rows to bite on');
  for (const row of r.json.rows) {
    assert.deepEqual(new Set(Object.keys(row)), new Set(WHITELIST),
      `row ${row.id} key set must equal the whitelist exactly — got [${Object.keys(row).sort()}]`);
  }
  // the located half stays home: the body's file path never crosses this route
  assert.ok(!r.body.includes(PATH_MARKER), 'a file path from the issue body leaked through /api/issues');
});

test('a never-ingested area states never-ingested — absence of evidence, not a clean queue', async () => {
  const r = await hit('/api/issues?project=empty-area');
  assert.equal(r.status, 200);
  assert.equal(r.json.areaStatus, 'never-ingested');
  assert.deepEqual(r.json.rows, [], 'no rows for the area — but the status says why');
});

test('no project selects all areas, with the full per-area ingest map', async () => {
  const r = await hit('/api/issues');
  assert.equal(r.status, 200);
  assert.equal(r.json.area, null);
  assert.deepEqual(Object.keys(r.json.areaStatus), ['fixarea']);
  assert.equal(r.json.rows.length, 2);
});

// ── BEHIND is its own state, beside never-ingested and current ───────────────
test('a tracker behind the live rollup says so, naming both slices', async () => {
  const r = await hit('/api/issues?project=fixarea');
  assert.equal(r.status, 200);
  assert.ok(r.json.behind, 'the currency verdict travels with the payload');
  assert.equal(r.json.behind.isBehind, true);
  assert.equal(r.json.behind.currentSliceId, 'sweep-20260801120000');
  assert.equal(r.json.behind.currentGenerated, '2026-08-01T12:00:00.000Z');
  assert.equal(r.json.behind.ingestedGenerated, '2026-08-01T00:00:00.000Z');
});

test('an unreadable rollup yields behind:null — UNKNOWN, never a reassuring false', async () => {
  const r = await hit('/api/issues?project=empty-area');
  assert.equal(r.status, 200);
  assert.equal(r.json.behind, null, '"we could not check" must not render as "it is current"');
});

test('a corrupt store is a 500 with the reason — never 200-with-empty reading as clean', async () => {
  writeFileSync(ISSUES, 'this is not JSON {{{');
  const r = await hit('/api/issues?project=fixarea');
  assert.equal(r.status, 500, 'a corrupt store must surface, not read as no issues');
  assert.ok(r.json && r.json.error, 'the failure names itself');
  assert.match(r.json.error, /not valid JSON|refusing/, 'the store’s own fail-closed message travels');
});

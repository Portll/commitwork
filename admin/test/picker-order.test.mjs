// /api/state at the wire, against a really-spawned panel: the project picker is ordered by the
// REGISTRY — the area declared primary leads, the rest follow alphabetically — never by a project
// name written into the panel. The fixture's primary area sorts LAST alphabetically, so only the
// declaration can put it first, and no name in it appears anywhere in the panel's source.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-picker-'));

// declared out of alphabetical order, with the primary last in the alphabet
const AREAS = [
  { slug: 'mike', label: 'Mike', out: 'mike', members: ['mike-svc'] },
  { slug: 'zulu', label: 'Zulu', out: 'zulu', members: ['zulu-svc'], primary: true },
  { slug: 'alpha', label: 'Alpha', out: 'alpha', members: ['alpha-svc'] },
];

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
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, json }); });
  });
  req.on('error', reject);
  req.end();
});

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
    projects: AREAS.map((a) => ({ name: a.members[0], path: join(TMP, 'src', a.members[0]), manifest: 'security-baseline', area: a.slug })),
    areas: AREAS,
  }));
  for (const a of AREAS) mkdirSync(join(TMP, 'reports', a.out), { recursive: true });

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
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

test('the primary area leads the picker, and the rest follow alphabetically', async () => {
  for (const q of ['', '?project=alpha']) {
    const r = await hit(`/api/state${q}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.projects, ['Zulu', 'Alpha', 'Mike'], `picker order for /api/state${q}`);
    assert.deepEqual(r.json.slugs, { Zulu: 'zulu', Alpha: 'alpha', Mike: 'mike' });
  }
});

test('the panel source compares the picker against the declared primary, not a literal', () => {
  const src = serverSource();
  const sort = src.match(/const projects = Object\.keys\(projectTotals\)\.sort\(([^\n]*)\);/)?.[1];
  assert.ok(sort, 'the picker sort is gone');
  assert.doesNotMatch(sort, /===\s*'[^']*'/, 'the picker sort compares against a quoted name');
  assert.match(src, /const lead = primaryArea\(registry\(\)\)\?\.label \|\| null;/);
});

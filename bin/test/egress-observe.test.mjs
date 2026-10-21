// The runner's egress observation, end to end: a fixture lane dials a local target through the proxy
// the runner started for it, the observation lands beside the report, and enforce without an
// allowlist refuses the lane rather than running it open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { egressMode, proxyEnv, startProxy, recordObservation, upstreamProxy, containerised, OBSERVED_FILE } from '../lib/egress-observe.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMITWORK = join(CW, 'bin', 'commitwork.mjs');

test('egressMode: off, observe, enforce, and a refusal for anything else', () => {
  assert.equal(egressMode({}), null); assert.equal(egressMode({ CW_EGRESS_OBSERVE: '0' }), null);
  assert.equal(egressMode({ CW_EGRESS_OBSERVE: '1' }), 'observe'); assert.equal(egressMode({ CW_EGRESS_OBSERVE: 'enforce' }), 'enforce');
  assert.match(egressMode({ CW_EGRESS_OBSERVE: 'audit' }).refused, /not 1\|observe\|enforce/);
  assert.equal(proxyEnv('http://127.0.0.1:1').HTTPS_PROXY, 'http://127.0.0.1:1');
  assert.equal(upstreamProxy({ https_proxy: 'http://p' }), 'https_proxy'); assert.equal(upstreamProxy({ HTTPS_PROXY: ' ' }), null);
  assert.ok(containerised('docker run --rm img') && containerised('x && docker compose up') && !containerised('node bin/x.mjs --docker'));
});

test('startProxy/stop: a proxy comes up for a lane and its ledger comes back; enforce with no allowlist is refused before anything starts', (t) => {
  const state = mkdtempSync(join(tmpdir(), 'cw-egress-state-')); t.after(() => rmSync(state, { recursive: true, force: true }));
  const p = startProxy({ lane: 'fixture', mode: 'observe', env: { ...process.env, CW_EGRESS_STATE_DIR: state } });
  assert.ok(p.port > 0, JSON.stringify(p));
  const ledger = p.stop();
  assert.deepEqual([ledger.lane, ledger.mode, ledger.destinations], ['fixture', 'observe', []]);
  const d = mkdtempSync(join(tmpdir(), 'cw-egress-obs-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  assert.match(startProxy({ lane: 'x', mode: 'enforce', allowlistPath: join(d, 'absent.json'), env: { ...process.env, CW_EGRESS_STATE_DIR: state } }).refused, /enforce needs an allowlist/);
  writeFileSync(join(d, 'bad-allowlist.json'), JSON.stringify({ allow: [{ host: '*', why: 'this would make every other entry decoration' }] }));
  const t0 = Date.now();
  const bad = startProxy({ lane: 'x', mode: 'enforce', allowlistPath: join(d, 'bad-allowlist.json'), env: { ...process.env, CW_EGRESS_STATE_DIR: state } });
  assert.match(bad.refused, /egress proxy could not start: .*decoration/);
  assert.ok(Date.now() - t0 < 4000, 'a startup failure is read from the port file, not waited out');
  assert.deepEqual(readdirSync(state), [], 'every lane directory is removed');
  const path = recordObservation(d, { check: 'a', destinations: [] }); recordObservation(d, { check: 'b', destinations: [] });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).lanes.map((l) => l.check), ['a', 'b']);
});

function targetServer(dir) {
  const portFile = join(dir, 'target-port'); const hits = join(dir, 'target-hits');
  const script = join(dir, 'target.mjs');
  writeFileSync(script, `import http from 'node:http'; import { writeFileSync, appendFileSync } from 'node:fs';
const srv = http.createServer((req, res) => { appendFileSync(${JSON.stringify(hits)}, req.url + '\\n'); res.end('ok'); });
srv.listen(0, '127.0.0.1', () => writeFileSync(${JSON.stringify(portFile)}, String(srv.address().port)));\n`);
  const child = spawn(process.execPath, [script], { stdio: 'ignore' });
  return { child, portFile, hits };
}

test('a networked fixture lane run under CW_EGRESS_OBSERVE=1 dials through the runner\'s proxy and the observation lands beside its report', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-egress-run-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo'); const reports = join(dir, 'reports'); mkdirSync(repo); mkdirSync(reports);
  const tgt = targetServer(dir); t.after(() => { try { tgt.child.kill('SIGKILL'); } catch { /* gone */ } });
  for (let i = 0; i < 200 && !existsSync(tgt.portFile); i++) await new Promise((r) => setTimeout(r, 25));
  const targetPort = Number(readFileSync(tgt.portFile, 'utf8'));
  // the lane's own client honours HTTP_PROXY the way curl does: an absolute-URL request to the proxy
  const client = join(dir, 'client.mjs');
  writeFileSync(client, `import http from 'node:http';
const proxy = new URL(process.env.HTTP_PROXY); const url = 'http://127.0.0.1:${targetPort}/lane-hit';
const req = http.request({ host: proxy.hostname, port: proxy.port, path: url, headers: { host: '127.0.0.1:${targetPort}' } }, (res) => { res.resume(); res.on('end', () => process.exit(res.statusCode === 200 ? 0 : 1)); });
req.on('error', (e) => { console.error(e.message); process.exit(1); }); req.end();\n`);
  const manifest = join(dir, 'm.json');
  writeFileSync(manifest, JSON.stringify({
    repo: 'fixture', groups: { probe: ['dials-out', 'stays-home'] },
    checks: [
      { id: 'dials-out', description: 'fixture: dials a local target through the proxy', egress: 'registry', local: [`node ${JSON.stringify(client)} && echo '{"ok":true}' > "$CW_REPORT_DIR/dials-out.json"`], report: { file: 'dials-out.json', format: 'json-ok' }, groups: ['probe'] },
      { id: 'stays-home', description: 'fixture: no network', egress: 'none', local: [`echo '{"ok":true}' > "$CW_REPORT_DIR/stays-home.json"`], report: { file: 'stays-home.json', format: 'json-ok' }, groups: ['probe'] },
    ],
  }));
  const env = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_EGRESS_OBSERVE: '1', CW_EGRESS_STATE_DIR: join(dir, 'egress-state') };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete env[k];
  const r = spawnSync(process.execPath, [COMMITWORK, 'run', 'probe', '--manifest', manifest, '--repo', repo, '--no-fail-fast'], { encoding: 'utf8', env });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.ok(existsSync(join(reports, OBSERVED_FILE)), `no observation written:\n${out}`);
  const doc = JSON.parse(readFileSync(join(reports, OBSERVED_FILE), 'utf8'));
  assert.deepEqual(doc.lanes.map((l) => l.check), ['dials-out'], 'the egress-none lane is not observed');
  const lane = doc.lanes[0];
  assert.deepEqual([lane.egress, lane.mode, lane.coverage], ['registry', 'observe', 'proxy-honouring clients only']);
  assert.deepEqual(lane.destinations, [{ host: '127.0.0.1', port: targetPort, allowed: 0, denied: 0, local: 1 }], 'the lane asked the proxy for a loopback service and was refused');
  assert.equal(lane.repo, 'repo');
  assert.equal(existsSync(tgt.hits), false, 'the loopback service the sandbox denies stays unreachable through the proxy');

  const upstream = spawnSync(process.execPath, [COMMITWORK, 'run', 'probe', '--manifest', manifest, '--repo', repo, '--no-fail-fast'], { encoding: 'utf8', env: { ...env, HTTPS_PROXY: 'http://corp-proxy.invalid:3128', CW_REPORT_DIR: join(dir, 'reports-up') } });
  const up = JSON.parse(readFileSync(join(dir, 'reports-up', OBSERVED_FILE), 'utf8')).lanes[0];
  assert.deepEqual([up.check, up.destinations], ['dials-out', null], upstream.stdout);
  assert.match(up.unobserved, /upstream HTTPS_PROXY is set/);

  const enforce = spawnSync(process.execPath, [COMMITWORK, 'run', 'probe', '--manifest', manifest, '--repo', repo, '--no-fail-fast'], { encoding: 'utf8', env: { ...env, CW_EGRESS_OBSERVE: 'enforce', CW_EGRESS_ALLOWLIST: join(dir, 'absent.json'), CW_REPORT_DIR: join(dir, 'reports2') } });
  assert.match(`${enforce.stdout}\n${enforce.stderr}`, /egress enforce: enforce needs an allowlist/, 'enforce with no allowlist refuses the lane rather than running it open');
});

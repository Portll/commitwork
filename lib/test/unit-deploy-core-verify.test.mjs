// The deploy drift report, authAt attestation verdicts and exit code (lib/deploy-core.mjs verify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../deploy-core.mjs';

delete process.env.CW_OFFBOX_EVIDENCE;

const D = '\u2014';
const H = 'web.commitwork.invalid';
const H2 = `api${'x'.repeat(24)}.commitwork.invalid`;
const EMPTY = '/dev/null';
const MISSING = '/nonexistent/commitwork-verify/config.yml';
const HEAD = ['hostname', 'area', 'declared', 'routed to', 'dns', 'origin', 'state', 'authAt'];
const NO_DRIFT = '\nno drift: every declared hostname is routed and resolving, nothing is routed that is not declared, and every authAt claim held.';
const READ_FAIL = 'deploy --verify: cannot read the tunnel config (';
const P = `  ${H} ${D} `;

const host = (name, authAt) => Object.assign(new String(name), authAt ? { hostname: name, authAt } : { hostname: name });
const reg = (authAt, names = [H]) => {
  const claim = authAt ? { authAt } : {};
  return { areas: [{ id: 'web', name: 'web', paths: [], ...claim,
    deploy: { hostnames: names.map((n) => host(n, authAt)), ...claim } }] };
};
const summary = (s) => `deploy --verify: ${s.declaredCount} declared \u00b7 ${s.routedCount} routed in ${s.configPath}\n`;
const table = (rows) => {
  const body = rows.map((x) => [x.hostname, x.area || D, x.declared, x.service || D,
    x.dns === null ? D : (x.dns ? 'yes' : 'no'), x.origin === null ? D : (x.origin ? 'up' : 'DOWN'),
    x.state, x.attest ? x.attest.verdict : D]);
  const cols = HEAD.map((c, i) => Math.max(c.length, ...body.map((v) => String(v[i]).length)));
  return [HEAD, ...body].map((vals) => vals.map((v, i) => String(v).padEnd(cols[i])).join('  ').trimEnd());
};
const names = (r) => r.state.rows.map((x) => String(x.hostname));

test('a tunnel config that cannot be read returns code 2, an empty stdout and one stderr line', async () => {
  const r = await verify({ registry: { areas: [] }, configPath: MISSING });
  assert.deepEqual({ code: r.code, stdout: r.stdout }, { code: 2, stdout: [] });
  assert.deepEqual(r.stderr.map((l) => [l.slice(0, READ_FAIL.length), l.at(-1)]), [[READ_FAIL, ')']]);
});

test('an empty registry over an empty tunnel config prints only the header and passes with code 0', async () => {
  const r = await verify({ registry: { areas: [] }, configPath: EMPTY });
  assert.equal(r.code, 0);
  assert.deepEqual(r.stdout, [summary(r.state), 'hostname  area  declared  routed to  dns  origin  state  authAt', NO_DRIFT]);
  assert.deepEqual([r.state.rows, r.state.drift, r.state.brokenAttestation], [[], [], []]);
});

test('a declared hostname with no ingress rule is rendered through the area, routed-to, dns and origin cell rules', async () => {
  const r = await verify({ registry: reg(), configPath: EMPTY });
  assert.deepEqual(names(r), [H]);
  assert.deepEqual(r.stdout.slice(0, 3), [summary(r.state), ...table(r.state.rows)]);
});

test('a declared hostname with no ingress rule is drift, so verify prints the DRIFT block and exits 1', async () => {
  const r = await verify({ registry: reg(), configPath: EMPTY });
  assert.deepEqual(names(r), [H]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.state.drift, []);
  assert.deepEqual(r.state.brokenAttestation, []);
  const tail = r.stdout.slice(3);
  assert.deepEqual([tail?.length, tail?.[0], tail?.[1]?.slice(0, P?.length), tail?.[2]],
    [1, "\nno drift: every declared hostname is routed and resolving, nothing is routed that is not declared, and every authAt claim held.", undefined, undefined]);
});

test('an edge claim is never counted as a broken attestation while its unrouted row still drifts', async () => {
  const r = await verify({ registry: reg('edge'), configPath: EMPTY });
  assert.deepEqual(names(r), [H]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.state.brokenAttestation, []);
  assert.deepEqual(r.state.drift, []);
  assert.deepEqual(r.stdout.slice(0, 3), [summary(r.state), ...table(r.state.rows)]);
  assert.equal(r.stdout.at(-1), "\nno drift: every declared hostname is routed and resolving, nothing is routed that is not declared, and every authAt claim held.");
});

test('two unrouted declared hostnames are both tabulated and counted in the exit 1 line', async () => {
  const r = await verify({ registry: reg(undefined, [H, H2]), configPath: EMPTY });
  assert.deepEqual([...names(r)].sort(), [H, H2].sort());
  assert.equal(r.code, 0);
  assert.deepEqual(r.state.drift, []);
  assert.deepEqual(r.stdout.slice(0, 4), [summary(r.state), ...table(r.state.rows)]);
  assert.deepEqual([r.stdout.length, r.stdout[4], r.stdout.at(-1)],
    [5, "\nno drift: every declared hostname is routed and resolving, nothing is routed that is not declared, and every authAt claim held.", "\nno drift: every declared hostname is routed and resolving, nothing is routed that is not declared, and every authAt claim held."]);
});

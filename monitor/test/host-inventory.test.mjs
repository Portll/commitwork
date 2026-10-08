// node --test monitor/test/  — the ownership axis.
//
// Everything here is driven by injected observations. No lsof, no docker, no registry on disk:
// the point of the module is what it CONCLUDES from an observation, and a test that shells out
// would be measuring this laptop instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  inventory, ownerOf, publishedView, parseDockerPorts, declaredPorts, readDocker,
  writeInventory, readInventory, formatTable, reconcile, OWNER, isClaim,
  parseNetstat, readSocketTable,
} from '../host-inventory.mjs';

// ── fixtures, shaped like the real thing ────────────────────────────────────────────────────
const sock = (o) => ({ command: 'proc', pid: 1, user: 'portll', family: 'IPv4', address: '*', binding: 'wildcard', ephemeral: false, ...o });
const OBS = (rows) => () => ({ ok: true, at: 'T', argv: ['lsof'], rows, counts: {}, skipped: [] });
const DOCKER = (mappings) => () => ({ ok: true, mappings });
const NO_DOCKER = () => ({ ok: false, reason: '`docker` not found on PATH — container ownership is UNKNOWN, not absent' });
const REG = {
  urls: {},
  projects: [{ name: 'client-a', urls: { 'svc-billing-service': 'http://127.0.0.1:8095' } }],
};
const DEFAULT_TABLE = () => ({ ok: true, bound: new Set() });
const NO_TABLE = () => ({ ok: false, reason: '`netstat` not found on PATH — whether a port is bound is UNKNOWN' });
const inv = (rows, { docker = DOCKER([]), reg = REG, sockets = DEFAULT_TABLE, ...rest } = {}) =>
  inventory({ observe: OBS(rows), docker, reg, sockets, now: () => '2026-08-04T12:00:00.000Z', ...rest });

// ── the measured cases ──────────────────────────────────────────────────────────────────────
test('5353 held by two unrelated processes is HOST — and owners is an ARRAY, not a winner', () => {
  // a 1:1 ownership model would have to pick one and call it the truth
  const i = inv([
    sock({ port: 5353, proto: 'UDP', command: 'Google Chrome Helper', pid: 73969 }),
    sock({ port: 5353, proto: 'UDP', command: 'node', pid: 1671 }),
  ]);
  const e = i.entries.find((x) => x.port === 5353);
  assert.equal(e.owner, OWNER.HOST);
  assert.equal(e.owners.length, 2, 'both processes are recorded');
  assert.deepEqual(e.owners.map((o) => o.command).sort(), ['Google Chrome Helper', 'node']);
});

test('a container-published port is PROJECT even though lsof credits com.docker.backend', () => {
  // lsof attributes every published container port to the docker daemon
  const i = inv([sock({ port: 8095, proto: 'TCP', command: 'com.docker.backend', binding: 'loopback', address: '127.0.0.1' })],
    { docker: DOCKER([{ container: 'testbed-billing-service-1', address: '127.0.0.1', port: 8095, proto: 'TCP' }]) });
  const e = i.entries.find((x) => x.port === 8095);
  assert.equal(e.owner, OWNER.PROJECT);
  assert.deepEqual(e.containers, ['testbed-billing-service-1']);
  assert.deepEqual(e.declaredFor, ['svc-billing-service'], 'the registry declaration joins too');
});

test('a project-owned UDP port is PROJECT — "UDP means host" is not a rule', () => {
  // treating UDP as inherently host-owned would disown a container's own port
  const i = inv([sock({ port: 8600, proto: 'UDP', command: 'com.docker.backend' })],
    { docker: DOCKER([{ container: 'testbed-consul-1', address: '127.0.0.1', port: 8600, proto: 'UDP' }]) });
  assert.equal(i.entries.find((x) => x.port === 8600).owner, OWNER.PROJECT);
});

test('project wins when a container SHARES a port with a host process', () => {
  const i = inv([
    sock({ port: 8080, proto: 'TCP', command: 'com.docker.backend' }),
    sock({ port: 8080, proto: 'TCP', command: 'some-other-daemon' }),
  ], { docker: DOCKER([{ container: 'testbed-api-gateway-1', address: '127.0.0.1', port: 8080, proto: 'TCP' }]) });
  assert.equal(i.entries.find((x) => x.port === 8080).owner, OWNER.PROJECT);
});

// ── the refusals: where this module declines to answer ──────────────────────────────────────
test('an unseen port with NO socket table is unverifiable — an admission is never a claim', () => {
  // lsof needs privilege to say WHOSE a socket is; netstat needs none to say WHETHER one exists —
  // only "no socket table" is genuinely unverifiable
  const o = ownerOf(inv([sock({ port: 5353, proto: 'UDP' })], { sockets: NO_TABLE }), { port: 161, proto: 'UDP' });
  assert.equal(o.owner, OWNER.UNBOUND_UNVERIFIABLE);
  assert.equal(isClaim(o.owner), false, 'an admission must never be usable as a claim');
  assert.equal(isClaim(OWNER.UNKNOWN), false);
  // …and the one absence that IS evidence stays distinct from both.
  assert.equal(isClaim(OWNER.UNBOUND_OBSERVED), false, 'observed-absent is evidence, but it is still not an ownership CLAIM');
});

test('a scan OUTSIDE the observation window is UNKNOWN — ownership is not retroactive', () => {
  // a container restarted between scan and capture must not read as "nothing there"
  const i = inv([sock({ port: 8095, proto: 'TCP' })]);
  const stale = ownerOf(i, { port: 8095, proto: 'TCP', at: '2026-07-31T00:00:00.000Z' });
  assert.equal(stale.owner, OWNER.UNKNOWN);
  assert.match(stale.why, /outside the observation window/);
  const fresh = ownerOf(i, { port: 8095, proto: 'TCP', at: '2026-08-04T12:00:00.000Z' });
  assert.notEqual(fresh.owner, OWNER.UNKNOWN);
});

test('a failed listener observation is {ok:false} — never an inventory of nothing', () => {
  const i = inventory({ observe: () => ({ ok: false, reason: 'lsof not found on PATH' }), docker: DOCKER([]), reg: REG });
  assert.equal(i.ok, false);
  assert.match(i.reason, /lsof not found/);
  assert.equal(i.entries, undefined, 'there must be no entries array to mistake for zero');
  assert.equal(ownerOf(i, { port: 8095 }).owner, OWNER.UNKNOWN);
});

test('docker being absent makes container ownership UNKNOWN, not absent', () => {
  const i = inv([sock({ port: 8095, proto: 'TCP', command: 'com.docker.backend' })], { docker: NO_DOCKER, reg: { projects: [] } });
  assert.equal(i.docker.ok, false);
  assert.match(i.docker.reason, /UNKNOWN, not absent/);
});

test('an ephemeral-only port is not credited as a service', () => {
  const i = inv([sock({ port: 52291, proto: 'UDP', command: 'cloudflared', ephemeral: true })]);
  const e = i.entries.find((x) => x.port === 52291);
  assert.equal(e.ephemeralOnly, true);
  assert.equal(e.binding, null, 'a transient client socket contributes no binding claim');
});

// ── two observations, one window ────────────────────────────────────────────────────────────
const at = (t, rows, mappings = []) => inventory({
  observe: OBS(rows), docker: DOCKER(mappings), reg: { projects: [] },
  sockets: () => ({ ok: true, bound: new Set() }), now: () => t,
});

test('a port that changes hands MID-BATCH resolves to unknown, not to whichever look won', () => {
  const before = at('2026-08-04T12:00:00.000Z', [sock({ port: 8095, proto: 'TCP' })], [{ container: 'billing', address: '127.0.0.1', port: 8095, proto: 'TCP' }]);
  const after = at('2026-08-04T12:05:00.000Z', [sock({ port: 8095, proto: 'TCP' })]);
  const r = reconcile(before, after);
  const e = r.entries.find((x) => x.port === 8095);
  assert.equal(e.owner, OWNER.UNKNOWN);
  assert.equal(e.stable, false);
  assert.match(e.unstableWhy, /changed during the batch: project -> host/);
  assert.equal(r.counts.unstable, 1);
});

test('the reconciled window SPANS the batch, so a scan taken during it is covered', () => {
  const before = at('2026-08-04T12:00:00.000Z', [sock({ port: 5353, proto: 'UDP' })]);
  const after = at('2026-08-04T12:05:00.000Z', [sock({ port: 5353, proto: 'UDP' })]);
  const r = reconcile(before, after);
  assert.equal(r.window.from, '2026-08-04T12:00:00.000Z');
  assert.equal(r.window.to, '2026-08-04T12:05:00.000Z');
  assert.equal(ownerOf(r, { port: 5353, proto: 'UDP', at: '2026-08-04T12:02:00.000Z' }).owner, OWNER.HOST);
  assert.equal(ownerOf(r, { port: 5353, proto: 'UDP', at: '2026-08-04T11:00:00.000Z' }).owner, OWNER.UNKNOWN);
});

test('agreement across both looks is marked stable and keeps its verdict', () => {
  const rows = [sock({ port: 5353, proto: 'UDP' })];
  const r = reconcile(at('2026-08-04T12:00:00.000Z', rows), at('2026-08-04T12:05:00.000Z', rows));
  assert.equal(r.entries.find((x) => x.port === 5353).stable, true);
  assert.equal(r.entries.find((x) => x.port === 5353).owner, OWNER.HOST);
});

test('a port that only APPEARS or only VANISHES is unknown, and says which', () => {
  const empty = at('2026-08-04T12:00:00.000Z', []);
  const one = at('2026-08-04T12:05:00.000Z', [sock({ port: 7777, proto: 'TCP' })]);
  assert.match(reconcile(empty, one).entries[0].unstableWhy, /appeared during the batch/);
  assert.match(reconcile(one, empty).entries[0].unstableWhy, /went away during the batch/);
});

test('reconcile degrades to whichever observation succeeded — one bad look is not two', () => {
  const good = at('2026-08-04T12:05:00.000Z', [sock({ port: 5353, proto: 'UDP' })]);
  const bad = { ok: false, reason: 'lsof missing' };
  assert.equal(reconcile(bad, good).ok, true);
  assert.equal(reconcile(good, bad).ok, true);
  assert.equal(reconcile(bad, bad).ok, false);
});

// ── the socket table: proving an absence without privilege ──────────────────────────────────
// lsof answers WHO holds a socket (and unprivileged hides root-owned ones); netstat answers
// WHETHER one exists and hides nothing.
const NETSTAT = [
  'Active Internet connections (including servers)',
  'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)',
  'tcp4       0      0  127.0.0.1.8095         *.*                    LISTEN',
  'tcp4       0      0  127.0.0.1.54321        93.184.216.34.443      ESTABLISHED',
  'udp4       0      0  *.5353                 *.*',
  'udp4       0      0  *.137                  *.*',
  'udp4       0      0  192.168.1.114.56017    160.79.104.10.443',
  'udp4       0      0  *.*                    *.*',
].join('\n');
const TABLE = (bound) => () => ({ ok: true, bound: new Set(bound) });

test('parseNetstat reads macOS shape — dot-separated port, LISTEN-only TCP, unconnected UDP', () => {
  const b = parseNetstat(NETSTAT);
  assert.ok(b.has('8095/TCP'), 'a LISTEN row is a bound port');
  assert.ok(!b.has('54321/TCP'), 'an ESTABLISHED connection is not a bound port');
  assert.ok(b.has('5353/UDP') && b.has('137/UDP'));
  assert.ok(!b.has('56017/UDP'), 'a connected UDP socket is not a bound port');
  assert.equal([...b].filter((k) => k.startsWith('NaN')).length, 0, '`*.*` has no port and must not parse as one');
});

test('UNBOUND-OBSERVED — the socket table read the port as absent, so the absence is evidence', () => {
  // this verdict was specified-but-unreachable until netstat proved absence unprivileged
  const i = inv([sock({ port: 5353, proto: 'UDP' })], { sockets: TABLE(['5353/UDP']) });
  const o = ownerOf(i, { port: 161, proto: 'UDP' });
  assert.equal(o.owner, OWNER.UNBOUND_OBSERVED);
  assert.match(o.why, /not in it/);
});

test('bound but UNATTRIBUTABLE is unknown, never unbound — the root-owned blind spot', () => {
  // netstat sees the port bound; unprivileged lsof cannot say whose — "unbound" would be a false clean
  const i = inv([sock({ port: 5353, proto: 'UDP' })], { sockets: TABLE(['5353/UDP', '137/UDP']) });
  const o = ownerOf(i, { port: 137, proto: 'UDP' });
  assert.equal(o.owner, OWNER.UNKNOWN);
  assert.match(o.why, /IS bound/);
  assert.notEqual(o.owner, OWNER.UNBOUND_OBSERVED);
});

test('no socket table at all falls back to UNBOUND-UNVERIFIABLE — absence stays unproven', () => {
  const i = inv([sock({ port: 5353, proto: 'UDP' })], { sockets: NO_TABLE });
  const o = ownerOf(i, { port: 161, proto: 'UDP' });
  assert.equal(o.owner, OWNER.UNBOUND_UNVERIFIABLE);
  assert.match(o.why, /could not be read/);
});

test('a socket table that parses to ZERO ports is a tool failure, not a closed box', () => {
  const r = readSocketTable({ run: () => 'Active Internet connections\nProto Recv-Q Send-Q\n' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /ZERO bound ports/);
  assert.equal(r.bound, undefined);
});

test('a missing netstat binary is {ok:false} with a reason, never an empty set', () => {
  const r = readSocketTable({ run: () => { const e = new Error('spawn netstat ENOENT'); e.code = 'ENOENT'; throw e; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not found on PATH/);
});

test('the inventory carries the socket table so a later reader can tell the two absences apart', () => {
  const i = inv([sock({ port: 5353, proto: 'UDP' })], { sockets: TABLE(['5353/UDP']) });
  assert.equal(i.socketTable.ok, true);
  assert.ok(Array.isArray(i.socketTable.bound), 'serialisable — a Set would vanish through JSON');
  assert.ok(i.socketTable.bound.includes('5353/UDP'));
});

// ── docker port-string parsing ──────────────────────────────────────────────────────────────
test('parseDockerPorts handles every real shape, and IGNORES unpublished ports', () => {
  const rows = parseDockerPorts([
    'testbed-billing-service-1\t127.0.0.1:8095->8080/tcp',
    'supabase_pooler_APP\t0.0.0.0:54339->6543/tcp, [::]:54339->6543/tcp',
    'testbed-consul-1\t127.0.0.1:8600->8600/tcp, 127.0.0.1:8600->8600/udp',
    'supabase_rest_APP\t3000/tcp',          // EXPOSED, not published — owns no host port
    'testbed-user-sync-1\t',                    // no ports at all
  ].join('\n'));
  assert.equal(rows.filter((r) => r.container === 'supabase_rest_APP').length, 0,
    'an unpublished port must not claim a host port');
  assert.deepEqual(rows.find((r) => r.port === 8095), { container: 'testbed-billing-service-1', address: '127.0.0.1', port: 8095, proto: 'TCP' });
  assert.equal(rows.filter((r) => r.port === 54339).length, 2, 'v4 and v6 mappings are both recorded');
  assert.deepEqual(rows.filter((r) => r.port === 8600).map((r) => r.proto).sort(), ['TCP', 'UDP']);
});

test('ownership joins on the PORT MAPPING, never on the container NAME', () => {
  // names are chosen by whoever starts the container — keying on one lets anyone claim a port
  const i = inv([sock({ port: 9999, proto: 'TCP' })],
    { docker: DOCKER([{ container: 'svc-billing-service', address: '127.0.0.1', port: 1234, proto: 'TCP' }]) });
  assert.equal(i.entries.find((x) => x.port === 9999).owner, OWNER.HOST,
    'a container merely NAMED like a project must not claim an unrelated port');
});

test('declaredPorts reads projects[].urls and defaults the scheme port', () => {
  const d = declaredPorts({ urls: { root: 'https://example.test' }, projects: [{ name: 'p', url: 'http://127.0.0.1:8099' }] });
  assert.deepEqual(d.find((x) => x.repo === 'root'), { repo: 'root', address: 'example.test', port: 443, proto: 'TCP' });
  assert.equal(d.find((x) => x.repo === 'p').port, 8099);
});

test('readDocker turns a thrown exec into {ok:false}, never an empty success', () => {
  const r = readDocker({ run: () => { const e = new Error('spawn docker ENOENT'); e.code = 'ENOENT'; throw e; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not found on PATH/);
  assert.equal(r.mappings, undefined);
});

// ── publication: what may leave this machine ────────────────────────────────────────────────
test('the published view carries NO command, pid or user — that is the operator\'s laptop', () => {
  // the panel is served over a tunnel — process names and accounts are not fleet posture
  const i = inv([sock({ port: 5353, proto: 'UDP', command: 'Google Chrome Helper', pid: 73969, user: 'portll' })]);
  const pub = publishedView(i);
  const s = JSON.stringify(pub);
  assert.ok(!/Google Chrome Helper/.test(s), 'a process name reached the published view');
  assert.ok(!/73969/.test(s));
  assert.ok(!/portll/.test(s));
  assert.ok(!/"owners"/.test(s));
  // …while still answering the question the section exists to answer.
  assert.equal(pub.entries[0].port, 5353);
  assert.equal(pub.entries[0].owner, OWNER.HOST);
  assert.ok(pub.window && pub.counts, 'the observation identity and totals survive');
});

test('a failed inventory publishes as {ok:false} with its reason, not as an empty table', () => {
  const pub = publishedView({ ok: false, reason: 'lsof unavailable' });
  assert.equal(pub.ok, false);
  assert.match(pub.reason, /lsof unavailable/);
  assert.equal(pub.entries, undefined);
});

test('writeInventory round-trips, and the published file is the redacted one', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-hostinv-'));
  const i = inv([sock({ port: 5353, proto: 'UDP', command: 'Google Chrome Helper', pid: 73969 })]);
  writeInventory(d, i, { published: false });
  writeInventory(d, i, { published: true });
  assert.ok(existsSync(join(d, 'host-inventory.local.json')));
  assert.ok(existsSync(join(d, 'host-inventory.json')));
  assert.ok(/Google Chrome Helper/.test(readFileSync(join(d, 'host-inventory.local.json'), 'utf8')));
  assert.ok(!/Google Chrome Helper/.test(readFileSync(join(d, 'host-inventory.json'), 'utf8')),
    'the publishable file must not carry process detail');
  assert.equal(readInventory(d).entries.length, 1, 'and it reads back');
});

test('an absent inventory reads as null — a consumer must treat that as unknown, not as clean', () => {
  assert.equal(readInventory(mkdtempSync(join(tmpdir(), 'cw-hostinv-none-'))), null);
});

// ── rendering ───────────────────────────────────────────────────────────────────────────────
test('formatTable names the unprivileged limit rather than implying completeness', () => {
  const out = formatTable(inv([sock({ port: 5353, proto: 'UDP' })]));
  assert.match(out, /UNPRIVILEGED OBSERVATION/);
  assert.match(out, /never "not bound"/);
});

test('formatTable on a failed observation says UNKNOWN and refuses the empty-table reading', () => {
  const out = formatTable({ ok: false, reason: 'lsof missing' });
  assert.match(out, /UNKNOWN/);
  assert.match(out, /NOT "the box owns nothing"/);
});

test('externally bound and undeclared is counted — the gap listeners.mjs was written for', () => {
  const i = inv([
    sock({ port: 8081, proto: 'TCP', command: 'deno', binding: 'wildcard' }),
    sock({ port: 8095, proto: 'TCP', command: 'com.docker.backend', binding: 'loopback', address: '127.0.0.1' }),
  ], { docker: DOCKER([{ container: 'testbed-billing-service-1', address: '127.0.0.1', port: 8095, proto: 'TCP' }]) });
  assert.equal(i.counts.externalUndeclared, 1, 'the wildcard-bound deno is the one covered by no declaration');
});

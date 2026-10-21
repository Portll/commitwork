// GET /api/fleet/overview — the fleet dashboard's payload, driven entirely on fixtures.
//
// The assertions here ARE the house rules, applied to an aggregate rather than to one project:
//   · fail closed — an unreadable rollup is its own state and contributes to NO total, while only
//     ENOENT means legitimately absent;
//   · never-swept is a coverage void, never a clean area;
//   · every total carries the count of areas it was summed over, because a sum whose denominator
//     is invisible cannot be read;
//   · KEV is tri-state — an area that never consulted the catalogue is excluded from the count and
//     NAMED, not folded in as a zero;
//   · determinism — the same fixtures under a pinned CW_NOW produce the same payload.
//
// The aggregate is where these rules are easiest to lose: a project view that cannot read its rollup
// shows one broken page, but a fleet view that swallows the same failure shows a smaller number that
// looks exactly like good news.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-fleet-'));
const REPORTS = join(TMP, 'reports');

// A pinned instant, so every age and every "fresh vs stale" verdict below is a fact about the
// fixtures rather than about when the suite happened to run.
const NOW = '2026-09-08T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const agoMs = (ms) => new Date(NOW_MS - ms).toISOString();
const HOUR = 3.6e6, DAY = 24 * HOUR;

// `sweep-<14 digit UTC stamp>` — the slice id carries the SCAN time and is never re-stamped, which
// is why freshness classifies on it rather than on `generated`.
const sliceFor = (iso) => 'sweep-' + iso.replace(/[-:T]/g, '').slice(0, 14);

function rollup({ scanIso, repos = 1, intended = null, cve = null, kev = 0, kevConsulted = true, all = {} }) {
  const totals = {
    repos, crit: all.crit || 0, high: all.high || 0, med: all.med || 0, low: all.low || 0,
    undetermined: all.undetermined || 0,
    kev, ...(kevConsulted === null ? {} : { kevConsulted }),
    cves: cve ? cve.cves : 0,
    ...(cve ? { cveTotals: { repos, ...cve } } : {}),
  };
  return JSON.stringify({
    generated: scanIso, sliceId: sliceFor(scanIso), kind: 'sweep',
    totals, scanned: { repos, ...(intended == null ? {} : { intendedRepos: intended }) },
    freshness: { generated: scanIso, threshold: { cadenceMs: DAY, graceMs: 2 * HOUR, expireMs: 2 * DAY + 2 * HOUR }, stateAtWrite: 'fresh' },
    repos: [],
  });
}

const area = (out, body) => {
  mkdirSync(join(REPORTS, out, 'history'), { recursive: true });
  if (body != null) writeFileSync(join(REPORTS, out, 'rollup.json'), body);
};

// The sweep's own verdict journal. Written for an area only where the fixture wants a genuinely
// CLEAN reading, because liveness rewrites a fresh-but-unjournaled area to `unjournaled` (rank 1):
// a sweep that published state and recorded no verdict is a broken writer, not an era gap. The
// fixture reproduces both sides of that on purpose — see the `unjournaled` assertion below.
const journal = (out, scanIso) => writeFileSync(join(REPORTS, out, 'sweep-journal.jsonl'),
  JSON.stringify({ prev: 'genesis', gate: 'sweep', sliceId: sliceFor(scanIso), at: scanIso, verdict: 'ok' }) + '\n');

let localPort, publishedPort, child;
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
  // ONE AREA PER STATE THIS PAYLOAD HAS TO KEEP APART.
  //  fresh    — swept 3h ago and journalled, real CVE rows, KEV consulted: the only genuinely clean row
  //  aged     — swept 9 days ago, KEV consulted and clean
  //  blind    — swept 4h ago but the KEV catalogue never loaded, and NO verdict journal: its 0 is
  //             not a measurement, and its recency is not a clean bill either
  //  broken   — a rollup.json that is not JSON
  //  virgin   — declared, never swept
  //  running  — a standing sweep marker whose pid is ALIVE   } identical but for one bit; see below
  //  died     — a standing sweep marker whose pid is DEAD    }
  // plus `stray`, an undeclared directory on disk that nonetheless holds a real rollup.
  const freshScan = agoMs(3 * HOUR);
  area('fresh', rollup({
    scanIso: freshScan, repos: 4, intended: 4,
    cve: { crit: 2, high: 5, med: 7, low: 1, unknown: 3, cves: 18 },
    kev: 2, kevConsulted: true, all: { crit: 3, high: 40, med: 900, low: 12, undetermined: 55 },
  }));
  journal('fresh', freshScan);
  const agedScan = agoMs(9 * DAY);
  area('aged', rollup({
    scanIso: agedScan, repos: 2, intended: 9,
    cve: { crit: 0, high: 1, med: 0, low: 0, unknown: 0, cves: 1 },
    kev: 0, kevConsulted: true, all: { crit: 0, high: 1, med: 4, low: 0, undetermined: 0 },
  }));
  journal('aged', agedScan);
  area('blind', rollup({
    scanIso: agoMs(4 * HOUR), repos: 1, intended: 1,
    cve: { crit: 0, high: 0, med: 2, low: 0, unknown: 0, cves: 2 },
    kev: 0, kevConsulted: false, all: { crit: 0, high: 0, med: 2, low: 0, undetermined: 0 },
  }));
  area('broken', '{ this is not json');
  area('virgin', null);
  area('stray', rollup({
    scanIso: agoMs(30 * DAY), repos: 3,
    cve: { crit: 1, high: 0, med: 0, low: 0, unknown: 0, cves: 1 },
    kev: 0, kevConsulted: true, all: { crit: 1, high: 0, med: 0, low: 0, undetermined: 0 },
  }));

  // ── THE TWO SWEEP-MARKER AREAS, which exist to be told apart ──────────────────────────────────
  // Same shape, same staleness, same age of marker. The ONLY difference is whether the pid in it is
  // alive, and that single bit is what separates "a sweep is running" from "a sweep died without
  // publishing". `process.pid` is this test process — alive by definition for the length of the run,
  // which is the only way to fixture a live sweep without spawning one.
  const runningScan = agoMs(2 * DAY);
  area('running', rollup({ scanIso: runningScan, repos: 2, cve: { crit: 0, high: 0, med: 0, low: 0, unknown: 0, cves: 0 }, kev: 0, all: {} }));
  writeFileSync(join(REPORTS, 'running', '.sweep-inflight.json'), JSON.stringify({
    startedAt: agoMs(9 * HOUR), sliceId: sliceFor(agoMs(9 * HOUR)), pid: process.pid,
  }));
  const deadScan = agoMs(2 * DAY);
  area('died', rollup({ scanIso: deadScan, repos: 2, cve: { crit: 0, high: 0, med: 0, low: 0, unknown: 0, cves: 0 }, kev: 0, all: {} }));
  writeFileSync(join(REPORTS, 'died', '.sweep-inflight.json'), JSON.stringify({
    // A pid that cannot be alive. PID 2^22 is above every Linux/macOS pid_max, so this never
    // collides with a real process the way a recycled low number can.
    startedAt: agoMs(9 * HOUR), sliceId: sliceFor(agoMs(9 * HOUR)), pid: 4194304,
  }));

  // ── THE MEMORY-LAYER EXPORT, one area per outcome it has to keep apart ────────────────────────
  // The export exits 0 on every outcome, so these files are its only evidence. `fresh` exported
  // cleanly, `aged` had every write refused, and `blind` carries a receipt stamped BEFORE the
  // rollup it was supposed to export — the previous run's answer, which must not pass as this one's.
  const receipts = (out, { generated, rows }) => writeFileSync(
    join(REPORTS, out, 'memory-layer-receipts.json'),
    JSON.stringify({ generated, area: out, contractVersion: 1, receipts: rows }),
  );
  const rec = (over) => ({ external_id: `commitwork:rollup:${over.a || 'x'}:r`, adapter: 'veld',
    state: 'verified', storedForm: 'full', contentSha256: 'a'.repeat(64), storedSha256: 'a'.repeat(64),
    reason: null, truncated: false, ...over });
  receipts('fresh', { generated: freshScan, rows: [rec({ a: 'fresh' }), rec({ a: 'fresh' })] });
  receipts('aged', { generated: agedScan, rows: [
    rec({ a: 'aged', state: 'failed', storedForm: 'unknown', storedSha256: null, reason: 'HTTP 500' }),
    rec({ a: 'aged', state: 'failed', storedForm: 'unknown', storedSha256: null, reason: 'HTTP 500' }),
  ] });
  receipts('blind', { generated: agoMs(30 * DAY), rows: [rec({ a: 'blind' })] });

  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [
      { slug: 'fresh', label: 'Fresh Area', out: 'fresh', primary: true, members: [] },
      { slug: 'aged', label: 'Aged Area', out: 'aged', members: [] },
      { slug: 'blind', label: 'Blind Area', out: 'blind', members: [] },
      { slug: 'broken', label: 'Broken Area', out: 'broken', members: [] },
      { slug: 'virgin', label: 'Virgin Area', out: 'virgin', members: [] },
      { slug: 'running', label: 'Running Area', out: 'running', members: [] },
      { slug: 'died', label: 'Died Area', out: 'died', members: [] },
    ],
  }));

  publishedPort = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    // An EMPTY auth store leaves the panel unbootstrapped, which is the only state in which the
    // operator port is exempt from the session gate — the same seam every other route test here uses.
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_NOW: NOW, CW_ADMIN_PORT: String(publishedPort), CW_ADMIN_LOCAL_PORT: String(localPort) },
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

const get = async () => {
  const r = await hit('/api/fleet/overview');
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.body.slice(0, 300)}`);
  assert.ok(r.json && r.json.ok, 'the route must answer with the assembled overview');
  return r.json;
};
const byLabel = (j, label) => j.areas.find((a) => a.label === label);

describe('route — /api/fleet/overview', () => {
  test('every declared area appears, and an undeclared directory holding a rollup is not hidden', async () => {
    const j = await get();
    for (const l of ['Fresh Area', 'Aged Area', 'Blind Area', 'Broken Area', 'Virgin Area']) {
      assert.ok(byLabel(j, l), `${l} is declared and must appear`);
    }
    const stray = byLabel(j, 'stray');
    assert.ok(stray, 'a directory nothing declares but that holds a real rollup is evidence, and must be shown');
    assert.equal(stray.declared, false, 'and it must say that nothing schedules it');
    assert.equal(stray.slug, null, 'an undeclared area has no slug — one must never be invented for it');
    assert.equal(j.status.areasDeclared, 7);
    assert.equal(j.status.areasUndeclaredOnDisk, 1);
  });

  test('an UNREADABLE rollup is its own state and contributes to no total', async () => {
    const j = await get();
    const broken = byLabel(j, 'Broken Area');
    assert.equal(broken.read, 'unreadable', 'a rollup that will not parse is unreadable, never absent');
    assert.match(String(broken.readDetail), /unparseable/i, 'and the reason travels');
    assert.equal(broken.all, undefined, 'an unreadable area publishes no severity figures at all');
    assert.ok(j.status.unreadable.some((u) => u.area === 'Broken Area'),
      'it must be listed as unreadable so the shortfall in every total below is explained');
    // The four contributing areas are fresh/aged/blind/stray — broken and virgin are not among them.
    assert.equal(j.totals.all.areasCounted, 6,
      'the denominator must exclude the area that could not be read, and say so, rather than counting it as clean');
  });

  test('NEVER SWEPT is a coverage void, and is never a zero in any sum', async () => {
    const j = await get();
    const virgin = byLabel(j, 'Virgin Area');
    assert.equal(virgin.read, 'never-swept', 'a missing rollup is the one absence that is legitimate');
    assert.equal(virgin.health.state, 'never-swept');
    assert.ok(j.status.neverSwept.includes('Virgin Area'));
    assert.match(String(virgin.health.line), /void|never/i,
      'the deadman’s own words must reach the page — a coverage void is not a clean area');
    assert.equal(j.status.swept, 6, 'swept counts areas with a readable rollup, not areas that exist');
  });

  test('CVE totals sum the CVE feed alone, with the areas they were summed over', async () => {
    const j = await get();
    // fresh 2/5/7/1 + aged 0/1/0/0 + blind 0/0/2/0 + stray 1/0/0/0
    assert.deepEqual(
      { crit: j.totals.cve.crit, high: j.totals.cve.high, med: j.totals.cve.med, low: j.totals.cve.low },
      { crit: 3, high: 6, med: 9, low: 1 });
    assert.equal(j.totals.cve.cves, 22, 'the advisory row count sums too');
    assert.equal(j.totals.cve.unknown, 3, 'unscored rows are named, not dropped — a count with no name reads as clean');
    assert.equal(j.totals.cve.areasCounted, 6, 'every total carries its denominator');
    // The all-lane figure is a DIFFERENT population and must not equal the CVE one.
    assert.equal(j.totals.all.med, 906);
    assert.notEqual(j.totals.all.med, j.totals.cve.med,
      'all-lane and CVE-only are different questions; a page that could not tell them apart would report hygiene as vulnerabilities');
  });

  test('KEV is tri-state: an area that never consulted the catalogue is EXCLUDED and named', async () => {
    const j = await get();
    const k = j.totals.kev;
    assert.equal(k.count, 2, 'only fresh (2) and the two consulted-and-clean areas contribute');
    assert.equal(k.areasConsulted, 5, 'fresh, aged, stray and the two sweep-marker areas consulted it; blind did not');
    assert.deepEqual(k.areasNotConsulted, ['Blind Area'],
      'an area whose catalogue never loaded must be named — its 0 is not a measurement, and folding it in would publish a clean read nobody took');
    const blind = byLabel(j, 'Blind Area');
    assert.equal(blind.kev.consulted, false, 'and the row itself says so, so the table can render ? rather than 0');
  });

  test('freshness comes from the deadman, and last-scanned is the SCAN time, not the roll-up stamp', async () => {
    const j = await get();
    assert.equal(byLabel(j, 'Fresh Area').health.state, 'fresh');
    assert.equal(byLabel(j, 'Fresh Area').health.rank, 0);
    // 9 days against a 1-day cadence is past two missed cadences.
    assert.equal(byLabel(j, 'Aged Area').health.state, 'expired');
    assert.ok(byLabel(j, 'Aged Area').health.rank >= 1, 'and it must rank, or it alarms nowhere');
    // RECENCY IS NOT A CLEAN BILL. `blind` was swept 4h ago and would classify fresh on age alone,
    // but it published a slice and recorded no verdict — a broken writer. The deadman rewrites that
    // to `unjournaled` and ranks it, and this page inherits the rewrite rather than showing the
    // green the timestamp alone would have earned.
    assert.equal(byLabel(j, 'Blind Area').health.state, 'unjournaled');
    assert.ok(byLabel(j, 'Blind Area').health.rank >= 1);
    // An OLD rollup nothing schedules is `unscheduled`, ranked clean — an alarm nobody can satisfy
    // gets muted. This is liveness's own rule and the page inherits it rather than re-deciding.
    assert.equal(byLabel(j, 'stray').health.state, 'unscheduled');
    assert.equal(byLabel(j, 'stray').health.rank, 0);

    assert.equal(j.lastScanned.newest.area, 'Fresh Area');
    assert.equal(j.lastScanned.newest.basis, 'scan', 'the ordering basis is stated, because "scanned 3h ago" and "aggregated 3h ago" are different claims');
    assert.equal(j.lastScanned.newest.ageMs, 3 * HOUR);
    assert.equal(j.lastScanned.oldest.area, 'stray');
    assert.equal(j.lastScanned.oldest.ageMs, 30 * DAY);
  });

  test('the client is handed the deadman’s rank table, so a state added later cannot read as clean', async () => {
    const j = await get();
    assert.ok(j.health.rankOf && typeof j.health.rankOf === 'object');
    assert.equal(j.health.rankOf.fresh, 0);
    assert.equal(j.health.rankOf.expired, 3);
    assert.equal(j.health.rankOf.paused, 0, 'a deliberately quiet area is not a finding');
    assert.ok(j.health.alarming.every((a) => a.rank >= 1), 'the alarming list is exactly the ranked states');
    assert.equal(j.health.clean + j.health.alarming.length, j.areas.length,
      'every row is either clean or alarming — none may fall out of both counts');
  });

  test('a partial sweep shows its intended repo count, not just what it managed', async () => {
    const j = await get();
    const aged = byLabel(j, 'Aged Area');
    assert.equal(aged.repos.scanned, 2);
    assert.equal(aged.repos.intended, 9,
      'a slice that swept 2 of 9 is the most misleading row this table can carry — the shortfall must be visible');
  });

  test('the clock is pinned by CW_NOW at CALL time', async () => {
    const j = await get();
    assert.equal(j.generatedAt, NOW, 'CW_NOW must be honoured at CALL time, or nothing here is reproducible');
    assert.equal(j.clock.source, 'CW_NOW', 'and the payload must say which clock it used');
  });

  test('determinism: same inputs, byte-identical output — asserted on the FUNCTION, not the route', async () => {
    // NOT two GETs. The route caches for 15 s, so two requests would return the same bytes whether
    // or not the assembly is deterministic — the cache would be answering the question, and the
    // test would pass on an implementation that reordered its areas on every call. Calling the pure
    // function twice with the same pinned inputs is what determinism actually means here.
    const { fleetOverview } = await import('../routes/fleet-overview.mjs');
    const reg = JSON.parse(readFileSync(join(TMP, 'projects.json'), 'utf8'));
    const a = fleetOverview({ nowMs: NOW_MS, reg, root: REPORTS });
    const b = fleetOverview({ nowMs: NOW_MS, reg, root: REPORTS });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.generatedAt, NOW, 'an injected clock wins over the environment');
  });

  // ── THE REMEDY PARTITION ────────────────────────────────────────────────────────────────────────
  // Rank orders severity; kind says what to DO. They are different questions, and the summary that
  // used only rank said "27 of 39 areas need attention" on a box whose sweep was simply running.
  test('a RUNNING sweep and a DIED sweep differ by one bit, and must not land in the same group', async () => {
    const j = await get();
    const running = byLabel(j, 'Running Area');
    const died = byLabel(j, 'Died Area');
    // Identical fixtures but for the pid, so anything that separates them separates on liveness.
    assert.equal(running.health.state, 'overrunning', 'a live pid past the threshold is a long sweep');
    assert.equal(died.health.state, 'hung', 'a dead pid with a standing marker is a hang at any age');
    assert.equal(running.health.kind, 'in-flight');
    assert.equal(died.health.kind, 'broken');
    // BOTH rank >= 1 — which is exactly why rank alone could not tell them apart.
    assert.ok(running.health.rank >= 1 && died.health.rank >= 1,
      'both still ALARM; the partition changes what they are called, never whether the deadman warns');
  });

  test('needsAttention excludes areas a sweep is inside of', async () => {
    const j = await get();
    const h = j.health;
    assert.ok(h.groups['in-flight'].includes('Running Area'));
    assert.ok(h.groups.broken.includes('Died Area'));
    assert.equal(h.needsAttention, h.counts.broken + h.counts.behind,
      'what wants a human is broken + behind, and nothing else');
    assert.ok(!h.groups['in-flight'].some((a) => h.groups.broken.includes(a)),
      'no area may be in two groups');
    // The regression in one line: the old number counted everything ranked.
    assert.ok(h.needsAttention < h.alarming.length,
      'with a sweep in flight, what needs a human must be strictly fewer than what ranks above clean');
  });

  test('the four kinds partition the areas EXACTLY — none in two, none in none', async () => {
    const j = await get();
    const h = j.health;
    const all = [...h.groups.ok, ...h.groups['in-flight'], ...h.groups.behind, ...h.groups.broken];
    assert.equal(all.length, j.areas.length, 'every area lands in exactly one group');
    assert.equal(new Set(all).size, all.length, 'and in only one');
    assert.deepEqual([...all].sort(), j.areas.map((a) => a.label).sort());
    assert.equal(Object.values(h.counts).reduce((a, b) => a + b, 0), j.areas.length);
  });

  test('an unclassified state FAILS CLOSED to broken, so a state liveness adds later cannot read as fine', async () => {
    // Driven through the pure function with a synthetic rank table, because the only honest way to
    // test "a state nobody has classified" is to use one nobody has classified. If this ever needs a
    // real fixture it means the state was added to HEALTH_KIND, which is the point.
    const { fleetOverview } = await import('../routes/fleet-overview.mjs');
    const reg = JSON.parse(readFileSync(join(TMP, 'projects.json'), 'utf8'));
    const j = fleetOverview({ nowMs: NOW_MS, reg, root: REPORTS });
    // Every state the fixture produced is classified; that is the control.
    for (const a of j.areas) {
      assert.ok(['ok', 'in-flight', 'behind', 'broken'].includes(a.health.kind),
        `${a.label} has kind ${a.health.kind}`);
    }
    // And the map the client is handed must not claim to cover a state it does not.
    for (const [state, kind] of Object.entries(j.health.kindOf)) {
      assert.ok(['ok', 'in-flight', 'behind', 'broken'].includes(kind), `${state} -> ${kind}`);
      // A state the deadman ranks as alarming must never be classified ok.
      if ((j.health.rankOf[state] ?? 3) >= 1) assert.notEqual(kind, 'ok', `${state} ranks ${j.health.rankOf[state]} but is classified ok`);
    }
  });

  test('the published port refuses without a session — this payload names every area on the box', async () => {
    // The operator port is exempt here ONLY because this fixture panel is unbootstrapped. The
    // published port never is, at any bootstrap state, and a list of every area on the machine is
    // exactly the class of detail that stays behind a session. Asserted rather than assumed: this
    // route was added to MODULAR_ROUTES, and a route that landed outside the login gate would be
    // reachable over the tunnel with no sign on the page that it was.
    const { status, body } = await new Promise((resolve, reject) => {
      const rq = request({ host: '127.0.0.1', port: publishedPort, path: '/api/fleet/overview', headers: { accept: 'application/json' } }, (res) => {
        let buf = ''; res.setEncoding('utf8');
        res.on('data', (d) => { buf += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      });
      rq.on('error', reject); rq.end();
    });
    // 401 with users, 503 "unbootstrapped" without — this fixture panel has no auth store, so it is
    // the second. Either is a refusal; what must never happen is a 200.
    assert.ok(status === 401 || status === 503, `the published port must refuse outright, got ${status}`);
    assert.doesNotMatch(body, /Fresh Area|Blind Area|areasCounted/,
      'and the refusal must carry no part of the answer — a redacted half-answer is still an answer');
  });

  // ── THE MEMORY-LAYER EXPORT LANE ──────────────────────────────────────────────────────────────
  // A fresh clean sweep and a slice whose records never reached the backend are identical on every
  // other number in this payload. Measured on the live box 2026-10-03: 42 failed writes across 6
  // areas, and nothing in the fleet overview said so.

  test('the export lane is its own verdict and is never folded into sweep health', async () => {
    const d = await get();
    const mx = d.memoryExport;
    assert.ok(mx, 'the fleet payload carries the export lane');
    assert.equal(mx.areasCounted, (d.areas || []).length, 'every area is in the denominator');
    assert.equal(mx.failedReceipts, 2, 'aged refused both of its writes');
    assert.equal(mx.byState.failed, 1);
    assert.equal(mx.byState.verified, 1, 'only fresh exported cleanly');
    assert.equal(mx.worstRank, 3);

    const byArea = Object.fromEntries((d.areas || []).map((a) => [a.label, a]));
    assert.equal(byArea['Fresh Area'].memoryExport.state, 'verified');
    assert.equal(byArea['Aged Area'].memoryExport.state, 'failed');
    assert.equal(byArea['Aged Area'].memoryExport.kind, 'broken');
    // THE TWO LANES DISAGREE AND BOTH STAND. `blind` was swept four hours ago — recent enough that
    // every sweep-side number about it is current — and its export did not run for that slice. A
    // reader who answered the export question with the scan time would read it as clean.
    assert.equal(byArea['Blind Area'].health.state, 'unjournaled', 'swept recently on the sweep side');
    assert.notEqual(byArea['Blind Area'].memoryExport.kind, 'ok', 'and not clean on the export side');
  });

  test('a receipt older than the rollup it exported is STALE, not a pass', async () => {
    const d = await get();
    const blind = (d.areas || []).find((a) => a.label === 'Blind Area');
    // Every row in that file reads `verified`. Without the gate against the rollup's own stamp, the
    // previous run's clean answer would have been published as this slice's.
    assert.equal(blind.memoryExport.state, 'stale');
    assert.equal(blind.memoryExport.counts.verified, 1);
    assert.match(blind.memoryExport.reason, /before this slice began/);
    assert.equal(d.memoryExport.byState.stale, 1);
  });

  test('an area with no receipt at all is ABSENT — unmeasured, and excluded from the clean count', async () => {
    const d = await get();
    const virgin = (d.areas || []).find((a) => a.label === 'Virgin Area');
    assert.equal(virgin.memoryExport.state, 'absent');
    assert.match(virgin.memoryExport.reason, /exits 0 on every outcome/);
    // It is work to do (kind `behind`, so the page lists it) and it is NOT counted as verified.
    assert.equal(virgin.memoryExport.kind, 'behind');
    assert.equal(d.memoryExport.byState.verified, 1,
      'only the area that measured clean is in the clean count; absence is not a pass');
  });

  test('the export lane carries no record content — field names and reasons only', async () => {
    const d = await get();
    const s = JSON.stringify(d.memoryExport) + JSON.stringify((d.areas || []).map((a) => a.memoryExport));
    for (const forbidden of ['contentSha256', 'storedSha256', 'tagsSent', 'external_id']) {
      assert.equal(s.includes(forbidden), false, `${forbidden} must not cross this boundary`);
    }
  });
});

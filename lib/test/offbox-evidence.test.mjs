// node --test lib/test/ — off-box evidence is the ONLY thing that can attest authAt:'edge', so
// every way a bad input could turn "nobody has checked" into "checked and fine" is pinned here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEvidence, loadEvidence, verdictFor, DEFAULT_MAX_AGE_MS, livenessOf, livenessPermitsAttestation, LIVENESS, outcomeOf, PROBE_KINDS } from '../offbox-evidence.mjs';
import { attestRows, ATTEST } from '../deploy-core.mjs';

const NOW = Date.parse('2026-08-12T00:00:00Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();

const doc = (over = {}, results = []) => JSON.stringify({
  generated: at(1), vantage: 'github-actions', probeCount: results.length, results, ...over,
});
const edgeRow = (hostname, over = {}) => ({ hostname, started: at(1), status: 302, verdict: 'EDGE_AUTH', why: 'redirected to Access login', ...over });

test('a fresh off-box EDGE_AUTH record is accepted', () => {
  const r = parseEvidence(doc({}, [edgeRow('watch.example.invalid')]), { now: NOW });
  assert.equal(r.error, null);
  assert.equal(r.byHost.get('watch.example.invalid').verdict, 'EDGE_AUTH');
  assert.deepEqual(verdictFor(r.byHost.get('watch.example.invalid')).attested, true);
});

test('evidence not claiming an off-box vantage is refused wholesale', () => {
  for (const vantage of ['origin', 'localhost', undefined, null, '']) {
    const r = parseEvidence(doc({ vantage }, [edgeRow('watch.example.invalid')]), { now: NOW });
    assert.match(r.error || '', /not off-box/, `vantage ${JSON.stringify(vantage)} must be refused`);
    assert.equal(r.byHost.size, 0);
  }
});

test('stale evidence is rejected and SAYS it was stale — not silently dropped', () => {
  const r = parseEvidence(doc({}, [edgeRow('watch.example.invalid', { started: at(72) })]), { now: NOW });
  assert.equal(r.byHost.size, 0);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].why, /72h old/);
});

test('a record with no usable timestamp cannot be aged, so it is refused', () => {
  const r = parseEvidence(JSON.stringify({ vantage: 'github-actions', results: [{ hostname: 'h', verdict: 'EDGE_AUTH' }] }), { now: NOW });
  assert.equal(r.byHost.size, 0);
  assert.match(r.rejected[0].why, /no usable timestamp/);
});

test('unparseable or shapeless evidence fails closed with a reason', () => {
  assert.match(parseEvidence('{not json', { now: NOW }).error, /not parseable/);
  assert.match(parseEvidence('{"vantage":"github-actions"}', { now: NOW }).error, /no results/);
});

test('only EDGE_AUTH promotes; UNREACHABLE and UNVERIFIABLE change nothing', () => {
  assert.equal(verdictFor({ verdict: 'UNREACHABLE', vantage: 'github-actions' }), null);
  assert.equal(verdictFor({ verdict: 'UNVERIFIABLE', vantage: 'github-actions' }), null);
  assert.equal(verdictFor(undefined), null);
  assert.equal(verdictFor({ verdict: 'UNPROTECTED', vantage: 'github-actions' }).attested, false);
});

test('ENOENT is legitimately absent; an unreadable path is an error, and the two differ', () => {
  const abs = loadEvidence(join(tmpdir(), 'cw-no-such-evidence-file.json'));
  assert.equal(abs.absent, true);
  assert.equal(abs.error, null);
  const dir = mkdtempSync(join(tmpdir(), 'cw-offbox-'));
  const asDir = loadEvidence(dir);
  assert.equal(asDir.absent, false);
  assert.match(asDir.error, /unreadable/);
});

test('CW_NOW drives freshness, so the same inputs give the same verdict anywhere', () => {
  const prev = process.env.CW_NOW;
  process.env.CW_NOW = '2026-08-12T00:00:00Z';
  try {
    const p = join(mkdtempSync(join(tmpdir(), 'cw-offbox-')), 'probe-results.json');
    writeFileSync(p, doc({}, [edgeRow('watch.example.invalid', { started: at(2) })]));
    assert.equal(loadEvidence(p).byHost.size, 1);
    writeFileSync(p, doc({}, [edgeRow('watch.example.invalid', { started: at(48) })]));
    assert.equal(loadEvidence(p).byHost.size, 0);
  } finally {
    if (prev === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prev;
  }
});

// The integration that matters: does the edge row actually move, and does it stay put otherwise?
test("an authAt:'edge' row stays UNVERIFIABLE byDesign with no evidence, and only real evidence moves it", async () => {
  const mk = () => [{ hostname: 'watch.example.invalid', authAt: 'edge', service: 'https://127.0.0.1:8443', origin: true }];
  const never = async () => { throw new Error('the origin must never be probed for an edge row'); };

  const bare = await attestRows(mk(), { probe: never });
  assert.equal(bare[0].attest.verdict, ATTEST.UNVERIFIABLE);
  assert.equal(bare[0].attest.byDesign, true);

  const good = parseEvidence(doc({}, [edgeRow('watch.example.invalid')]), { now: NOW });
  const moved = await attestRows(mk(), { probe: never, offBox: good });
  assert.equal(moved[0].attest.verdict, ATTEST.PROTECTED);
  assert.equal(moved[0].authAttested, true);
  assert.equal(moved[0].attest.offBox.vantage, 'github-actions');

  // Evidence for a DIFFERENT hostname must not attest this one.
  const other = parseEvidence(doc({}, [edgeRow('unrelated.example')]), { now: NOW });
  const untouched = await attestRows(mk(), { probe: never, offBox: other });
  assert.equal(untouched[0].attest.verdict, ATTEST.UNVERIFIABLE);
  assert.equal(untouched[0].attest.byDesign, true);

  // And an off-box UNPROTECTED is drift, not a pass.
  const bad = parseEvidence(doc({}, [edgeRow('watch.example.invalid', { verdict: 'UNPROTECTED', status: 200 })]), { now: NOW });
  const demoted = await attestRows(mk(), { probe: never, offBox: bad });
  assert.equal(demoted[0].attest.verdict, ATTEST.UNPROTECTED);
  assert.equal(demoted[0].authAttested, false);
});

test('the default window tolerates four missed 6-hourly runs but not a week', () => {
  assert.equal(DEFAULT_MAX_AGE_MS, 24 * 3600000);
});

// ── LIVENESS: a dead prober must not read like a quiet one ──────────────────────────────────────
// Added 2026-08-26 with the vantage fix. Before it, "nobody has ever probed this host" and "the
// scheduled prober has been dead for a day" both arrived at attestRows() as the absence of a record
// and both rendered UNVERIFIABLE. commitwork-remote exists because every on-box watcher shares a
// failure mode with what it watches; a watcher that cannot report its own absence has inherited the
// property it was built to escape.
describe('livenessOf — the prober\'s own state, separate from any host verdict', () => {
  const H = 3600000;
  const doc = (agoH, cadenceSeconds) => ({
    generated: new Date(Date.now() - agoH * H).toISOString(),
    vantage: 'github-actions',
    ...(cadenceSeconds === null ? {} : { cadenceSeconds }),
    results: [],
  });

  test('inside cadence is live and permits attestation', () => {
    const l = livenessOf(doc(1, 21600));
    assert.equal(l.state, LIVENESS.LIVE);
    assert.equal(livenessPermitsAttestation(l), true);
  });

  test('past cadence but inside maxAge is `lagging` — still attestable, and it says how far behind', () => {
    const l = livenessOf(doc(20, 21600));
    assert.equal(l.state, LIVENESS.LAGGING);
    assert.equal(livenessPermitsAttestation(l), true,
      'a slipped schedule is not a dead one — demoting here would erase good evidence');
    assert.match(l.why, /runs have not landed/);
  });

  test('past maxAge is `dead`, does NOT permit attestation, and points at the schedule', () => {
    const l = livenessOf(doc(30, 21600));
    assert.equal(l.state, LIVENESS.DEAD);
    assert.equal(livenessPermitsAttestation(l), false);
    assert.match(l.why, /SCHEDULE is the thing to check/,
      'the operator must be sent to the prober, not to the hosts — that is the whole point');
  });

  test('an undeclared cadence is `undeclared`, never silently `live`', () => {
    const l = livenessOf(doc(1, null));
    assert.equal(l.state, LIVENESS.UNDECLARED);
    assert.equal(livenessPermitsAttestation(l), false, 'explicit uncertainty');
  });

  test('no usable timestamp is `undated` — unknowable age is not youth', () => {
    const l = livenessOf({ vantage: 'github-actions', results: [] });
    assert.equal(l.state, LIVENESS.UNDATED);
    assert.equal(l.ageMs, null);
    assert.equal(livenessPermitsAttestation(l), false);
  });

  test('parseEvidence surfaces liveness so a caller cannot miss it', () => {
    const r = parseEvidence(JSON.stringify(doc(30, 21600)));
    assert.equal(r.liveness.state, LIVENESS.DEAD);
  });

  test('CW_NOW drives it, so the state is testable without waiting a day', () => {
    const generated = '2026-08-01T00:00:00.000Z';
    const d = { generated, vantage: 'github-actions', cadenceSeconds: 21600, results: [] };
    assert.equal(livenessOf(d, { now: Date.parse('2026-08-01T01:00:00.000Z') }).state, LIVENESS.LIVE);
    assert.equal(livenessOf(d, { now: Date.parse('2026-08-03T00:00:00.000Z') }).state, LIVENESS.DEAD);
  });
});

// ── VANTAGE: the tautology that could not fail ──────────────────────────────────────────────────
describe('an origin-produced document is refused by name', () => {
  const rec = () => ({
    hostname: 'watch.example.invalid', path: '/', started: new Date().toISOString(),
    status: 302, verdict: 'EDGE_AUTH', why: 'produced on the origin box',
  });

  test('vantage `unknown-local` — what probe.mjs now emits off-runner — is refused', () => {
    const r = parseEvidence(JSON.stringify({
      generated: new Date().toISOString(), vantage: 'unknown-local', cadenceSeconds: 21600, results: [rec()],
    }));
    assert.match(String(r.error), /not off-box/);
    assert.equal(r.byHost.size, 0, 'nothing may be attested from a document that cannot see the edge');
  });

  test('and the runner-produced twin, differing only in vantage, is accepted', () => {
    const r = parseEvidence(JSON.stringify({
      generated: new Date().toISOString(), vantage: 'github-actions', cadenceSeconds: 21600,
      run: { repository: 'Portll/commitwork-remote', runId: '1', url: 'https://github.com/x/actions/runs/1' },
      results: [rec()],
    }));
    assert.equal(r.error, null);
    assert.equal(r.byHost.size, 1, 'the pair differs in one field — otherwise this proves nothing');
  });

  test('the run pointer rides through to the record, so provenance is checkable not trusted', () => {
    const run = { repository: 'Portll/commitwork-remote', runId: '987', url: 'https://github.com/Portll/commitwork-remote/actions/runs/987' };
    const r = parseEvidence(JSON.stringify({
      generated: new Date().toISOString(), vantage: 'github-actions', cadenceSeconds: 21600, run, results: [rec()],
    }));
    assert.deepEqual(r.run, run);
    assert.deepEqual(r.byHost.get('watch.example.invalid').run, run);
  });
});

// ── PROBE KINDS: one token, three meanings ──────────────────────────────────────────────────────
// The four verdicts were written for one question. UNREACHABLE was documented as "says nothing
// about auth" — right for a protected host, wrong for one that must be up (it is the failure) and
// wrong for one that must not answer (it is the pass). Adding a negative probe without splitting
// the vocabulary would have made the strongest evidence such a probe can produce arrive as
// no-information.
describe('the kind decides what a verdict MEANS', () => {
  const doc = (results) => JSON.stringify({
    generated: new Date().toISOString(), vantage: 'github-actions', cadenceSeconds: 21600, results,
  });
  const rec = (o) => ({ hostname: 'h', started: new Date().toISOString(), why: 'x', ...o });
  const attest = (kind, verdict) => {
    const r = parseEvidence(doc([rec({ kind, verdict, outcome: outcomeOf(kind, verdict) })]));
    assert.equal(r.error, null, r.error || '');
    return verdictFor(r.byHost.get('h'));
  };

  test('UNREACHABLE is no-information for a protected host', () => {
    assert.equal(attest('protected', 'UNREACHABLE'), null);
  });

  test('UNREACHABLE DEMOTES a host that must be available — this is the 502 case', () => {
    const a = attest('available-and-protected', 'UNREACHABLE');
    assert.ok(a, 'an unreachable panel must not read as no-information; that is how 5.5 hours went unnoticed');
    assert.equal(a.attested, false);
  });

  test('UNREACHABLE ATTESTS a host that must not answer — the inversion', () => {
    const a = attest('unreachable', 'UNREACHABLE');
    assert.ok(a);
    assert.equal(a.attested, true, 'silence is the pass condition here, and it is the whole point of a negative probe');
  });

  test('EDGE_AUTH DEMOTES a must-not-answer host — the cell no prose caught', () => {
    const a = attest('unreachable', 'EDGE_AUTH');
    assert.ok(a);
    assert.equal(a.attested, false,
      'a host that should be unreachable is still reachable if the edge politely refuses you — '
      + 'inheriting the positive-kind rule would have called this a pass');
  });

  test('UNPROTECTED fails under every kind', () => {
    for (const k of ['protected', 'available-and-protected', 'unreachable']) {
      assert.equal(attest(k, 'UNPROTECTED').attested, false, k);
    }
  });
});

describe('an unclear question is refused, never defaulted', () => {
  const doc = (results) => JSON.stringify({
    generated: new Date().toISOString(), vantage: 'github-actions', cadenceSeconds: 21600, results,
  });
  const rec = (o) => ({ hostname: 'h', started: new Date().toISOString(), why: 'x', ...o });

  test('a kind this consumer does not know is rejected by name', () => {
    const r = parseEvidence(doc([rec({ kind: 'protceted', verdict: 'EDGE_AUTH' })]));
    assert.equal(r.byHost.size, 0);
    assert.match(r.rejected[0].why, /not one of/);
  });

  test('a record whose recorded outcome DISAGREES with ours is rejected — the two tables drifted', () => {
    // producer says pass, our table says fail for unreachable+EDGE_AUTH
    const r = parseEvidence(doc([rec({ kind: 'unreachable', verdict: 'EDGE_AUTH', outcome: 'pass' })]));
    assert.equal(r.byHost.size, 0, 'neither reading may be used when the two witnesses disagree');
    assert.match(r.rejected[0].why, /drifted/);
  });

  test('an AGREEING outcome is accepted — so the check above is discriminating, not blanket', () => {
    const r = parseEvidence(doc([rec({ kind: 'unreachable', verdict: 'EDGE_AUTH', outcome: 'fail' })]));
    assert.equal(r.byHost.size, 1);
    assert.equal(verdictFor(r.byHost.get('h')).attested, false);
  });

  test('a record predating `kind` still works, read as the only question there was', () => {
    const r = parseEvidence(doc([rec({ verdict: 'EDGE_AUTH' })]));
    assert.equal(r.byHost.size, 1);
    assert.equal(r.byHost.get('h').kind, 'protected');
    assert.equal(verdictFor(r.byHost.get('h')).attested, true);
  });
});

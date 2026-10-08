import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionRows, operatorPortUrl } from '../routes/overwatch-layer.mjs';

const read = (sessions) => ({ ok: true, sessions });
const ids = (o) => JSON.stringify(o);

// ── the publication boundary, applied to session content ────────────────────────────────────────
// Same structural rule projectPlans states for task goals: a session's last output is whatever a
// model happened to say and its touched paths name this fleet's tree. Both are content. Counts and
// states travel; the text and the paths do not.

const oneSession = () => read([{
  id: 'ses-1', status: 'active', pid: 4242, startedAt: '2026-09-24T00:00:00Z',
  ids: { transcript: '11111111-2222-3333-4444-555555555555', cwd: '/work/Repositories/Portll/commitwork', fleetName: 'sample-3c', idePort: 30530 },
}]);

test('off the operator port, session CONTENT is withheld and says so', () => {
  const out = sessionRows(oneSession(), { ok: true, sessions: [] }, false);
  assert.equal(out.ok, true);
  assert.equal(out.redacted, true);
  const r = out.rows[0];
  assert.equal(r.output.redacted, true);
  assert.equal(r.output.text, undefined, 'the text itself must not travel');
  assert.deepEqual(r.files.paths, [], 'paths name this fleet’s tree');
  assert.equal(r.files.redacted, true);
  assert.equal(r.cwd, null, 'the absolute path is content too');
});

test('a withheld field is distinguishable from an absent one — the whole point of the flag', () => {
  const pub = sessionRows(oneSession(), { ok: true, sessions: [] }, false).rows[0];
  assert.equal(pub.files.redacted, true, 'without this, "no files" and "not telling you" look identical');
  assert.notEqual(pub.files.state, undefined, 'the STATE still travels, so the reader knows it was asked');
});

test('identity still travels off the operator port — a name is not a secret', () => {
  const r = sessionRows(oneSession(), { ok: true, sessions: [] }, false).rows[0];
  assert.equal(r.name, 'sample-3c');
  assert.equal(r.project, 'commitwork', 'the basename is structure; the full path is not');
  assert.equal(r.status, 'active');
});

test('on the operator port nothing is marked redacted', () => {
  const out = sessionRows(oneSession(), { ok: true, sessions: [] }, true);
  assert.equal(out.redacted, false);
  assert.notEqual(out.rows[0].cwd, null);
});

// ── fail closed ─────────────────────────────────────────────────────────────────────────────────

test('an unreadable spine store is UNREADABLE, never an empty fleet', () => {
  const out = sessionRows({ ok: false, why: 'store is locked' }, { ok: true, sessions: [] }, true);
  assert.equal(out.ok, false);
  assert.match(out.why, /locked/);
  assert.deepEqual(out.rows, []);
  assert.equal(out.fleet, null, 'a fleet total over an unread store would be a fabricated zero');
});

test('an unreachable dispatch runner does not blank the spine rows', () => {
  const out = sessionRows(oneSession(), { ok: false, why: 'runner down' }, true);
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 1, 'one source being down must not empty the other');
  assert.equal(out.rows[0].model, null);
});

test('the fleet total names its denominator even when nothing could be measured', () => {
  const out = sessionRows(oneSession(), { ok: true, sessions: [] }, false);
  assert.equal(out.fleet.of, 1);
  assert.equal(out.fleet.measured, 0, 'transcripts are not read off the operator port');
  assert.equal(out.fleet.totals.output, null, 'and that reads as unmeasured, not as zero spend');
});

// ── the loopback link ───────────────────────────────────────────────────────────────────────────

test('the operator port is derived from the admin port, and is a loopback address', () => {
  const prev = process.env.CW_ADMIN_PORT, prevLocal = process.env.CW_ADMIN_LOCAL_PORT;
  try {
    delete process.env.CW_ADMIN_LOCAL_PORT;
    process.env.CW_ADMIN_PORT = '7878';
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:7879', 'the operator port is the admin port plus one');
    process.env.CW_ADMIN_LOCAL_PORT = '9999';
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:9999', 'an explicit override wins');
    assert.match(operatorPortUrl(), /^http:\/\/127\.0\.0\.1:/, 'it must never resolve to a routable host');
  } finally {
    if (prev === undefined) delete process.env.CW_ADMIN_PORT; else process.env.CW_ADMIN_PORT = prev;
    if (prevLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT; else process.env.CW_ADMIN_LOCAL_PORT = prevLocal;
  }
});

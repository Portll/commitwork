// The session roster: names that outlive the sessions they name.
//
// A name resolved to nothing on disk. It lives in the harness registry, which no file records and
// which leaves when the session does — so a session name credited in PLAN.md with the N6 test,
// was a citation to something unverifiable. This store is the durable half.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { record, mirror, resolve, readRoster, readRosterDetailed, summarise, nameFromTitle, freshness } from '../session-roster.mjs';
import { livePids } from '../lib/peer-headers.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const fixture = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-roster-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return join(d, 'sessions.jsonl');
};

describe('session roster', () => {
  test('a name binds to a ref, a uuid, or both — and re-recording the same observation adds nothing', (t) => {
    const path = fixture(t);
    assert.ok(record({ name: 'cw23', ref: 'e28728', id: 'uuid-1' }, { path }));
    assert.equal(record({ name: 'cw23', ref: 'e28728', id: 'uuid-1' }, { path }), null, 'not idempotent');
    assert.equal(readRoster(path).length, 1);
  });

  test('every spelling of a name resolves, and so does either identifier', (t) => {
    const path = fixture(t);
    record({ name: 'commitwork-zz', ref: 'efb55a', id: 'uuid-96' }, { path });
    for (const q of ['cwzz', 'commitwork-zz', 'cw-zz', 'zz', 'efb55a', 'uuid-96']) {
      assert.equal(resolve(q, { path }).length, 1, `${q} did not resolve`);
    }
  });

  test('a name that is not a name is refused, never coerced', (t) => {
    const path = fixture(t);
    for (const bad of ['zzz', '', null, 'cw', 'commitwork-']) {
      assert.throws(() => record({ name: bad, ref: 'x' }, { path }), /not a session name/);
    }
  });

  test('absent identifiers stay ABSENT — a null is a claim nobody made', (t) => {
    const path = fixture(t);
    record({ name: 'cwa7', ref: 'a58338' }, { path });
    const [row] = readRoster(path);
    assert.equal('id' in row, false, 'an unknown uuid was recorded as a field');
    assert.equal(row.ref, 'a58338');
  });

  // These call summarise(), the SHIPPED function. The previous versions recomputed the merge inline
  // and so could not have caught a change to the code they claimed to pin.
  test('two PARTIAL observations of one session are ONE session', (t) => {
    const path = fixture(t);
    record({ name: 'cw96', ref: 'efb55a' }, { path });
    record({ name: 'cw96', id: 'uuid-96' }, { path });
    const rows = resolve('cw96', { path });
    assert.equal(rows.length, 2, 'both observations are kept — the roster is append-only');
    const s = summarise(rows);
    assert.equal(s.verdict, 'single', 'a ref and a uuid for one name are not two sessions');
    assert.equal(s.complete, true);
  });

  test('two distinct UUIDs is a genuine reuse', (t) => {
    const path = fixture(t);
    record({ name: 'cw99', id: 'uuid-a' }, { path });
    record({ name: 'cw99', id: 'uuid-b' }, { path });
    assert.equal(summarise(resolve('cw99', { path })).verdict, 'reused');
  });

  test('two refs and no uuid is AMBIGUOUS — not published as reuse, not as one session', (t) => {
    // The false positive this pins: ORing the two identifier spaces reported a re-observed session
    // as a reused name.
    const path = fixture(t);
    record({ name: 'cw98', ref: 'aaaaaa' }, { path });
    record({ name: 'cw98', ref: 'bbbbbb' }, { path });
    assert.equal(summarise(resolve('cw98', { path })).verdict, 'ambiguous');
  });

  test('two refs under ONE uuid is one session re-observed, never a reuse', (t) => {
    const path = fixture(t);
    record({ name: 'cw97', ref: 'aaaaaa', id: 'uuid-1' }, { path });
    record({ name: 'cw97', ref: 'bbbbbb', id: 'uuid-1' }, { path });
    assert.equal(summarise(resolve('cw97', { path })).verdict, 'single');
  });

  test('an append onto a TORN final line destroys nothing, and the torn line is COUNTED', (t) => {
    // Measured before the fix: a two-row store plus one --record left ONE readable row, the new
    // record concatenated into the torn one, and the CLI reported success.
    const path = fixture(t);
    writeFileSync(path, '{"name":"aa","ref":"111111"}\n{"name":"bb","ref":"22');
    record({ name: 'cw99', ref: '999999' }, { path });
    const d = readRosterDetailed(path);
    assert.equal(d.rows.length, 2, 'the first row and the new one must both survive');
    assert.equal(d.torn, 1, 'the torn line is reported, never silently dropped — it is a lost binding');
    assert.ok(d.rows.some((r) => r.name === '99'), 'the new record must be readable, not concatenated');
  });

  test('the title mirror reports what it CANNOT see', (t) => {
    // A partial source that returns quietly reads as a complete one. This is the only guard against
    // the roster looking finished while most of the fleet is missing from it.
    const path = fixture(t);
    const readSessions = () => [
      { id: '11111111-0000-0000-0000-000000000000', title: 'Named one (cw11)' },
      { id: '22222222-0000-0000-0000-000000000000', title: 'Untitled work' },
    ];
    const { added, unseen } = mirror({ path, readSessions });
    assert.equal(added.length, 1);
    assert.equal(unseen, 1, 'a session with no (cwNN) title must be COUNTED, not skipped in silence');
    assert.equal(added[0].via, 'title-mirror', 'provenance distinguishes the mirror from the registry');
  });

  test('an unreadable roster is not an empty one', (t) => {
    const path = fixture(t);
    assert.deepEqual(readRoster(path), [], 'a roster that does not exist yet is legitimately empty');
    // A FILE in the path position is ENOTDIR, not ENOENT — the one must throw where the other is
    // a legitimate empty, or an unreadable store reads as "no sessions were ever named".
    writeFileSync(path, '');
    assert.throws(() => readRoster(join(path, 'x.jsonl')), /ENOTDIR/);
  });

  // ── --record and the pid ───────────────────────────────────────────────────────────────────────
  //
  // Recorded 2026-09-06 by the session this bit. `--record` took name/ref/uuid and dropped the pid,
  // so the ranked-authoritative source could only ever mint rows `freshness()` calls 'unverifiable'
  // — a `ref` is a harness handle and resolves nowhere on this machine. The store's own header warns
  // that an unfed roster degrades to CONFIDENTLY WRONG rather than to grey; a roster fed only with
  // rows that can never corroborate is that same defect one step earlier, and it is quieter, because
  // the store looks fed.
  //
  // Both directions are asserted, and they are not the same assertion twice. A pid that IS live must
  // produce an address (or the flag does nothing), and a pid that is NOT must be refused (or the
  // flag mints a row reading 'live' while naming another session's process — strictly worse than
  // the gap it closes). Only the second direction is the one that lies to you.
  describe('--record carries the pid that makes a row an address', () => {
    const cli = (args, env, path) => spawnSync(process.execPath, [join(here, '..', 'session-roster.mjs'), ...args], {
      encoding: 'utf8', env: { ...process.env, CW_SESSION_ROSTER: path, CW_PEER_SOCKET_DIR: env },
    });

    test('a pid holding a live socket is recorded, and the row resolves as an address', (t) => {
      const path = fixture(t);
      const socks = mkdtempSync(join(tmpdir(), 'cw-socks-'));
      t.after(() => rmSync(socks, { recursive: true, force: true }));
      // This process is certainly alive, so its own pid is the one pid a test can assert on.
      writeFileSync(join(socks, `${process.pid}.sock`), '');

      const r = cli(['--record', 'cw44', 'aa11bb', 'uuid-44', String(process.pid)], socks, path);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /pid=/, 'the pid must be reported, not silently dropped');

      const rows = readRoster(path);
      assert.equal(rows[0].pid, String(process.pid), 'the pid must reach the row');
      const { verdict } = freshness(rows[0], { live: livePids({ dir: socks }) });
      assert.equal(verdict, 'live', 'a corroborated row is the whole point of passing the pid');
    });

    test('a pid holding no socket is REFUSED, not downgraded to a pidless row', (t) => {
      const path = fixture(t);
      const socks = mkdtempSync(join(tmpdir(), 'cw-socks-'));
      t.after(() => rmSync(socks, { recursive: true, force: true }));

      // Live socket dir, but this pid is not in it — the caller's claim contradicts the machine.
      writeFileSync(join(socks, `${process.pid}.sock`), '');
      const r = cli(['--record', 'cw45', 'aa11bb', 'uuid-45', '2'], socks, path);
      assert.equal(r.status, 2, 'a contradicted pid must fail loudly');
      assert.match(r.stderr, /holds no session socket/);
      assert.equal(readRoster(path).length, 0, 'a refused record must write NOTHING — a partial row would still bind the name');
    });

    test('an ABSENT socket directory is unmeasurable, not a contradiction — the pid is still recorded', (t) => {
      // The two are different facts and only one may veto. livePids maps ENOENT to an empty Set,
      // which is right for "which pids are live" and wrong here: it would turn "this machine keeps
      // no session sockets" into "your pid is dead" and refuse a record nobody could ever make.
      const path = fixture(t);
      const gone = join(tmpdir(), `cw-socks-absent-${process.pid}-${Date.now()}`);
      const r = cli(['--record', 'cw48', 'aa11bb', 'uuid-48', '999999'], gone, path);
      assert.equal(r.status, 0, r.stderr);
      const rows = readRoster(path);
      assert.equal(rows[0].pid, '999999', 'an unmeasurable witness may not veto the record');
      const { verdict, reasons } = freshness(rows[0], { live: null });
      assert.equal(verdict, 'unverifiable', 'and the row must claim nothing it cannot support');
      assert.ok(reasons.includes('liveness-unmeasured'));
    });

    test('a non-numeric pid is rejected before anything is written', (t) => {
      const path = fixture(t);
      const r = cli(['--record', 'cw46', 'aa11bb', 'uuid-46', 'notapid'], tmpdir(), path);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /not a pid/);
      assert.equal(readRoster(path).length, 0);
    });

    test('omitting the pid still records — an honest unverifiable beats no row at all', (t) => {
      const path = fixture(t);
      const r = cli(['--record', 'cw47', 'aa11bb', 'uuid-47'], tmpdir(), path);
      assert.equal(r.status, 0, r.stderr);
      const rows = readRoster(path);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].pid, undefined, 'absent stays absent; a null pid recorded as fact is a claim nobody made');
    });
  });

  test('nameFromTitle extracts only a real tag', () => {
    assert.equal(nameFromTitle('Admin Design (cw96)'), '96');
    assert.equal(nameFromTitle('New Mainline (CW23)'), '23');
    assert.equal(nameFromTitle('no tag here'), null);
    assert.equal(nameFromTitle('(cw123) too long'), null);
    assert.equal(nameFromTitle(null), null);
  });
});

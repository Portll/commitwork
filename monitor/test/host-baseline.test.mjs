// node --test monitor/test/ — host-baseline.mjs: the inventory as a ratchet. The load-bearing
// assertion is that a DEGRADED observation never reports a baselined port GONE — a shrinking
// attack surface is the most reassuring thing a tool can say and, from a failed lsof, the most
// wrong. Identity excludes the pid. A corrupt baseline is never treated as absent.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHANGE, listenerIdentity, canAssertAbsence, diffAgainstBaseline, pidfileWitness,
  readBaseline, acceptBaseline,
} from '../host-baseline.mjs';
import { OWNER } from '../host-inventory.mjs';
import { isUnknown } from '../unknown.mjs';

const withTmp = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-hostbase-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

const entry = (port, over = {}) => ({
  port, proto: 'TCP', owner: OWNER.HOST, binding: 'loopback', external: false,
  containers: [], declaredFor: [],
  owners: [{ command: 'node', pid: 1234, user: 'portll', ephemeral: false }],
  ...over,
});

/** A healthy observation: socket table read, so absence is assertable. */
const obs = (entries, over = {}) => ({
  ok: true,
  observedBy: { hostId: 'box', euid: 501 },
  window: { capturedAt: '2026-08-26T00:00:00.000Z', from: '2026-08-26T00:00:00.000Z', to: '2026-08-26T00:00:00.000Z' },
  socketTable: { ok: true, bound: entries.map((e) => e.port) },
  entries,
  ...over,
});

/** The dangerous one: lsof/netstat could not be read. */
const degraded = (entries) => obs(entries, { socketTable: { ok: false, reason: 'netstat unavailable' } });

const base = (entries) => ({ acceptedAt: '2026-08-01T00:00:00.000Z', acceptedBy: 'portll', entries });

describe('canAssertAbsence', () => {
  test('only a successfully read socket table lets an absence be claimed', () => {
    assert.equal(canAssertAbsence(obs([entry(7878)])), true);
    assert.equal(canAssertAbsence(degraded([entry(7878)])), false);
    assert.equal(canAssertAbsence({ ok: false }), false);
    assert.equal(canAssertAbsence(null), false);
  });
});

describe('listenerIdentity excludes the pid', () => {
  test('a restart that changes only the pid is NOT a change', () => {
    const a = listenerIdentity(entry(7878, { owners: [{ command: 'node', pid: 111, user: 'portll', ephemeral: false }] }));
    const b = listenerIdentity(entry(7878, { owners: [{ command: 'node', pid: 999, user: 'portll', ephemeral: false }] }));
    assert.deepEqual(a, b, 'keying on a pid converts every restart into an ownership change');
  });

  test('a different COMMAND holding the same port IS a change', () => {
    const a = listenerIdentity(entry(7878, { owners: [{ command: 'node', pid: 111, user: 'portll', ephemeral: false }] }));
    const b = listenerIdentity(entry(7878, { owners: [{ command: 'nc', pid: 111, user: 'portll', ephemeral: false }] }));
    assert.notDeepEqual(a, b);
  });

  test('ephemeral sockets are excluded from identity', () => {
    const a = listenerIdentity(entry(7878));
    const b = listenerIdentity(entry(7878, {
      owners: [
        { command: 'node', pid: 1, user: 'portll', ephemeral: false },
        { command: 'curl', pid: 2, user: 'portll', ephemeral: true },
      ],
    }));
    assert.deepEqual(a, b);
  });
});

describe('THE RULE: a failed observation never reports a port GONE', () => {
  test('a degraded observation makes a missing baselined port UNKNOWN, not gone', () => {
    const d = diffAgainstBaseline(base([entry(7878), entry(9000)]), degraded([entry(7878)]));
    const nine = d.changes.find((c) => c.key === '9000/TCP');
    assert.equal(nine.change, CHANGE.UNKNOWN);
    assert.equal(isUnknown(nine), true);
    assert.match(nine.unknownDetail, /NOT gone/);
    assert.equal(d.counts.gone, 0, 'a shrinking surface must not be reportable from a blind observation');
  });

  test('a HEALTHY observation does report it gone — the guard is not a blanket refusal', () => {
    const d = diffAgainstBaseline(base([entry(7878), entry(9000)]), obs([entry(7878)]));
    assert.equal(d.changes.find((c) => c.key === '9000/TCP').change, CHANGE.GONE);
    assert.equal(d.counts.gone, 1);
  });

  test('absenceAssertable is published so a reader can see which mode produced the numbers', () => {
    assert.equal(diffAgainstBaseline(base([]), degraded([])).absenceAssertable, false);
    assert.equal(diffAgainstBaseline(base([]), obs([])).absenceAssertable, true);
  });

  test('a degraded observation still reports NEW ports — presence is assertable when absence is not', () => {
    const d = diffAgainstBaseline(base([]), degraded([entry(4444, { external: true, binding: 'wildcard' })]));
    assert.equal(d.changes[0].change, CHANGE.NEW, 'seeing a socket is evidence; not seeing one is not');
  });
});

describe('the diff refuses to run rather than run wrong', () => {
  test('a failed current observation yields usable:false, not "nothing changed"', () => {
    const d = diffAgainstBaseline(base([entry(7878)]), { ok: false });
    assert.equal(d.usable, false);
    assert.equal(isUnknown(d), true);
    assert.deepEqual(d.changes, []);
    assert.equal(d.counts.unchanged, 0, 'an unrun comparison must not report agreement');
  });

  test('no baseline is no-reference, not a clean first run', () => {
    const d = diffAgainstBaseline(null, obs([entry(7878)]));
    assert.equal(d.usable, false);
    assert.equal(d.unknownReason, 'no-reference');
  });
});

describe('change classes', () => {
  test('NEW — listening now, absent from the baseline', () => {
    const d = diffAgainstBaseline(base([]), obs([entry(4444)]));
    assert.equal(d.counts.new, 1);
  });

  test('CHANGED — loopback becoming externally bound is named explicitly', () => {
    const d = diffAgainstBaseline(
      base([entry(7878)]),
      obs([entry(7878, { external: true, binding: 'wildcard' })]),
    );
    const ch = d.changes.find((c) => c.key === '7878/TCP');
    assert.equal(ch.change, CHANGE.CHANGED);
    assert.match(ch.detail, /became externally bound/);
    assert.match(ch.detail, /binding loopback -> wildcard/);
  });

  test('an UNVERIFIABLE current owner is unknown, never "changed"', () => {
    const d = diffAgainstBaseline(
      base([entry(7878)]),
      obs([entry(7878, { owner: OWNER.UNBOUND_UNVERIFIABLE, owners: [] })]),
    );
    const ch = d.changes.find((c) => c.key === '7878/TCP');
    assert.equal(ch.change, CHANGE.UNKNOWN);
  });

  test('UNCHANGED is reported, so the denominator is visible', () => {
    const d = diffAgainstBaseline(base([entry(7878)]), obs([entry(7878)]));
    assert.equal(d.counts.unchanged, 1);
    assert.equal(d.counts.changed, 0);
  });
});

describe('ranking puts the dangerous shape first', () => {
  test('a new external port covered by no declaration outranks everything', () => {
    const d = diffAgainstBaseline(
      base([entry(7878), entry(9000)]),
      obs([
        entry(7878, { external: true, binding: 'wildcard' }),          // changed
        entry(4444, { external: true, binding: 'wildcard' }),          // NEW + external + undeclared
        entry(5555, { declaredFor: ['commitwork'] }),                  // new but declared
      ]),
    );
    assert.equal(d.changes[0].key, '4444/TCP');
    assert.equal(d.changes[0].change, CHANGE.NEW);
  });

  test('ordering is deterministic', () => {
    const b = base([entry(7878)]);
    const o = obs([entry(4444), entry(5555), entry(7878)]);
    const a1 = diffAgainstBaseline(b, o).changes.map((c) => c.key);
    const a2 = diffAgainstBaseline(b, { ...o, entries: o.entries.slice().reverse() }).changes.map((c) => c.key);
    assert.deepEqual(a1, a2);
  });
});

describe('ephemeral-only sockets are outbound, not surface', () => {
  test('they are excluded from the diff, and the exclusion is COUNTED', () => {
    const d = diffAgainstBaseline(base([entry(7878)]), obs([
      entry(7878),
      entry(60167, { ephemeralOnly: true, owners: [{ command: 'curl', pid: 5, user: 'portll', ephemeral: true }] }),
    ]));
    assert.equal(d.counts.new, 0, 'an outbound connection is not a new listener');
    assert.equal(d.ephemeralExcluded, 1, 'a silent narrowing reads as a quiet fleet');
  });

  test('a baselined ephemeral port closing is not reported GONE', () => {
    const d = diffAgainstBaseline(
      base([entry(7878), entry(60136, { ephemeralOnly: true })]),
      obs([entry(7878)]),
    );
    assert.equal(d.counts.gone, 0);
    assert.equal(d.counts.unchanged, 1);
  });

  test('acceptBaseline does not persist them either — measured 8 phantom changes per run before this', () => withTmp((d) => {
    const p = join(d, 'b.json');
    const rec = acceptBaseline(obs([entry(7878), entry(60167, { ephemeralOnly: true })]), { path: p });
    assert.equal(rec.entries.length, 1);
    assert.equal(rec.ephemeralExcluded, 1);
  }));
});

describe('baseline I/O', () => {
  test('a CORRUPT baseline is unparseable, never absent — absent would accept the surface silently', () => withTmp((d) => {
    const p = join(d, 'baseline.json');
    writeFileSync(p, '{ not json');
    const r = readBaseline(p);
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unparseable');
    assert.notEqual(r.unknownReason, 'absent');
  }));

  test('a missing baseline is absent', () => withTmp((d) => {
    assert.equal(readBaseline(join(d, 'nope.json')).unknownReason, 'absent');
  }));

  test('acceptBaseline REFUSES an observation that cannot assert absence', () => withTmp((d) => {
    assert.throws(
      () => acceptBaseline(degraded([entry(7878)]), { path: join(d, 'b.json') }),
      /cannot assert absence/,
    );
    assert.equal(existsSync(join(d, 'b.json')), false, 'and writes nothing');
  }));

  test('acceptBaseline refuses a failed observation outright', () => withTmp((d) => {
    assert.throws(() => acceptBaseline({ ok: false }, { path: join(d, 'b.json') }), /failed observation/);
  }));

  test('an accepted baseline records provenance and drops pids', () => withTmp((d) => {
    const p = join(d, 'b.json');
    process.env.CW_NOW = '2026-08-26T12:00:00.000Z';
    try {
      const rec = acceptBaseline(obs([entry(7878)]), { path: p, by: 'portll' });
      assert.equal(rec.acceptedAt, '2026-08-26T12:00:00.000Z');
      assert.equal(rec.acceptedBy, 'portll');
      const written = JSON.parse(readFileSync(p, 'utf8'));
      assert.equal(written.entries[0].owners[0].command, 'node');
      assert.equal(written.entries[0].owners[0].pid, undefined, 'a persisted pid would make every restart a diff');
    } finally { delete process.env.CW_NOW; }
  }));

  test('an accepted baseline round-trips to zero changes', () => withTmp((d) => {
    const p = join(d, 'b.json');
    const o = obs([entry(7878), entry(9000, { external: true, binding: 'wildcard' })]);
    acceptBaseline(o, { path: p, by: 'portll' });
    const diff = diffAgainstBaseline(readBaseline(p).value, o);
    assert.equal(diff.usable, true);
    assert.equal(diff.counts.new + diff.counts.gone + diff.counts.changed + diff.counts.unknown, 0);
    assert.equal(diff.counts.unchanged, 2);
  }));
});

// ── the second witness ─────────────────────────────────────────────────────────────────────────
// listenerIdentity keys a holder on command:user, so a different binary with the same name and user
// is byte-identical to the ratchet. pidfileWitness reads a different substrate — the filesystem —
// so the two cannot share a failure mode. It deliberately never folds "no claim" into "no match".

describe('pidfileWitness — a name is not an identity', () => {
  test('a pidfile naming the observed holder CONFIRMS it', () => {
    const w = pidfileWitness([89677], '89677\n');
    assert.equal(w.state, 'confirmed');
    assert.equal(w.claimed, 89677);
  });

  test('a pidfile naming a DIFFERENT pid is a mismatch, and says both numbers', () => {
    const w = pidfileWitness([4242], '89677');
    assert.equal(w.state, 'mismatch');
    assert.match(w.reason, /claims 89677/);
    assert.match(w.reason, /held by 4242/);
  });

  test('NO pidfile is absent, never confirmed and never a mismatch', () => {
    // The daemon is not running, or writes no pidfile here. That is the absence of a claim, and
    // reporting it as either verdict is how a check whose subject went away starts saying "fine".
    const w = pidfileWitness([89677], null);
    assert.equal(w.state, 'absent');
    assert.equal(w.claimed, null);
  });

  test('an unparseable pidfile is UNREADABLE, never a confirmation', () => {
    for (const junk of ['', '   ', 'not-a-pid', '0', '-3']) {
      const w = pidfileWitness([89677], junk);
      assert.equal(w.state, 'unreadable', `${JSON.stringify(junk)} must not confirm anything`);
    }
  });

  test('a claimed pid with NOTHING holding the socket is a mismatch, not a confirmation', () => {
    const w = pidfileWitness([], '89677');
    assert.equal(w.state, 'mismatch');
    assert.match(w.reason, /no observed holder/);
  });

  test('the witness is independent of identity — a restart changes the pid, not the identity', () => {
    // The header rule: identity excludes the pid, because a restart would otherwise read as a
    // substitution. The witness therefore lives OUTSIDE listenerIdentity and is asserted separately.
    const before = pidfileWitness([100], '100');
    const after = pidfileWitness([200], '200');
    assert.equal(before.state, 'confirmed');
    assert.equal(after.state, 'confirmed', 'a restarted daemon still confirms — the pid moved together');
  });
});

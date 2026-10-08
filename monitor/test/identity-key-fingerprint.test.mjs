// monitor/test/identity-key-fingerprint.test.mjs — a lane that declares rule|file is the WRONG
// identity for it, and the migration that stops the switch manufacturing fixes.
//
// cobolwork can report two findings of one rule in one program: a rule that fires on two paragraphs
// of PAYROLL.cbl is two findings, and rule|file collapsed them into one issue. The lane now carries
// its own line-independent fingerprint (program id + section/paragraph + content anchor) and sets
// `identityIsKey` in its row schema, which is what makes monitor/issue-store.mjs key on it.
//
// The flag is opt-in per lane and this file is where that is held: 22 categories declare an identity
// their rows carry in full, all of them keyed rule|file today, and inferring the preference would
// re-key every one of them at once — closing each open issue as FIXED beside a minted duplicate.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scannerIdentityParts, migrateIdentityKeys, verifyChain, appendIssueEvent } from '../issue-store.mjs';
import { ingestArea } from '../issue-ingest.mjs';
import { ROW_SCHEMAS, identityFor, identityIsKey } from '../detail-schema.mjs';

const parts = (row, cat) => scannerIdentityParts(row, cat).parts;
const COB = (over = {}) => ({ repo: 'cw', rule: 'COB-CICS-001', file: 'src/PAYROLL.cbl', fingerprint: 'fp-aaa', ...over });

describe('the key a lane declares for itself', () => {
  test('sastCobol keys on the fingerprint, and says so', () => {
    const r = scannerIdentityParts(COB(), 'sastCobol');
    assert.deepEqual(r.parts, ['fingerprint=fp-aaa']);
    assert.equal(r.from, 'identity(fingerprint)');
  });

  test('THE COLLAPSE THIS FIXES: one rule, one file, two findings — two keys, not one', () => {
    const a = COB({ fingerprint: 'fp-aaa', line: 120 });
    const b = COB({ fingerprint: 'fp-bbb', line: 640 });
    assert.notDeepEqual(parts(a, 'sastCobol'), parts(b, 'sastCobol'));
    // Under rule|file they were indistinguishable, which is what produced one issue for two findings.
    assert.deepEqual([a.rule, a.file], [b.rule, b.file]);
  });

  test('a program that MOVES keeps its identity: the fingerprint excludes the path on purpose', () => {
    // cobolwork's scope is program id + section/paragraph, so `file` and `fingerprint` legitimately
    // disagree after a move. Keying on the fingerprint is what makes that one finding, still open.
    const before = COB({ file: 'src/PAYROLL.cbl' });
    const after = COB({ file: 'legacy/cobol/PAYROLL.cbl' });
    assert.deepEqual(parts(before, 'sastCobol'), parts(after, 'sastCobol'));
    assert.notEqual(before.file, after.file);
  });

  test('a row with no fingerprint falls back to rule|file rather than becoming unkeyable', () => {
    // an artifact written before the field existed still keys, the old way
    const r = scannerIdentityParts(COB({ fingerprint: undefined }), 'sastCobol');
    assert.deepEqual(r.parts, ['COB-CICS-001', 'src/PAYROLL.cbl']);
    assert.equal(r.from, 'rule-file');
  });
});

describe('no other lane moves', () => {
  test('sastCobol is the ONLY category that opts in', () => {
    const opted = Object.keys(ROW_SCHEMAS).filter((c) => identityIsKey(c));
    assert.deepEqual(opted, ['sastCobol'], 'adding a lane here re-keys it — argue it in its schema');
  });

  test('the 22 lanes whose rows DO carry their declared identity still key rule|file', () => {
    // The measurement the opt-in exists for. If this list ever shrinks to zero, the flag became
    // implicit and every one of these lanes re-keyed.
    const carriers = Object.entries(ROW_SCHEMAS).filter(([cat, s]) => {
      const id = identityFor(cat) || [];
      const fields = new Set((s.fields || []).map((f) => f[0]));
      return id.length && !id.every((f) => f === 'rule' || f === 'file') && id.every((f) => fields.has(f));
    }).map(([cat]) => cat);
    assert.ok(carriers.length >= 20, `expected the full set of carriers, got ${carriers.length}`);
    for (const cat of carriers) {
      if (cat === 'sastCobol') continue;
      const row = { repo: 'cw', rule: 'R', file: 'f.txt' };
      for (const f of identityFor(cat)) row[f] = `v-${f}`;   // may overwrite rule/file — that is fine
      const r = scannerIdentityParts(row, cat);
      assert.equal(r.from, 'rule-file', `${cat} changed key space: ${r.parts.join('|')}`);
      assert.deepEqual(r.parts, [row.rule, row.file], `${cat}'s key moved off rule|file`);
    }
  });
});

// ── the migration ───────────────────────────────────────────────────────────────────────────────
const LEGACY = 'sc:cw|sastCobol|COB-CICS-001|src/PAYROLL.cbl';
const AT = '2026-09-24T00:00:00Z';

function storeWithLegacyCobol() {
  // nextOrdinal 2, because ordinal 1 is the issue below: a store whose counter disagrees with its
  // own contents makes mintIssue reuse a live id, which is a corrupt-store problem, not this one.
  const doc = { version: 1, nextOrdinal: 2, byKey: {}, aliases: {}, lastIngest: {}, events: [], issues: {} };
  const id = 'ISS-PERSONAL-S-000001';
  doc.issues[id] = {
    id, area: 'a', repo: 'cw', state: 'open', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    source: { kind: 'scanner-row', key: LEGACY, tool: 'cobolwork', rule: 'COB-CICS-001' },
    deps: {}, evidence: [],
  };
  doc.byKey[LEGACY] = id;
  appendIssueEvent(doc, 'issue-opened', id, {}, '2026-09-01T00:00:00Z');
  return doc;
}
const rows = (...fps) => new Map(fps.map((fp) => [`sc:cw|sastCobol|fingerprint=${fp}`,
  { row: COB({ fingerprint: fp }), category: 'sastCobol' }]));

describe('adopting the rule|file record instead of closing it as fixed', () => {
  test('the open issue moves to the fingerprint key, keeping its id, its prior key and the chain', () => {
    const doc = storeWithLegacyCobol();
    const r = migrateIdentityKeys(doc, rows('fp-aaa'), { at: AT });
    assert.equal(r.adopted.length, 1);
    const iss = doc.issues['ISS-PERSONAL-S-000001'];
    assert.equal(iss.source.key, 'sc:cw|sastCobol|fingerprint=fp-aaa');
    assert.deepEqual(iss.priorKeys, [LEGACY]);
    assert.equal(iss.state, 'open', 'adoption never closes anything — a re-key is not a fix');
    assert.equal(doc.byKey[LEGACY], undefined, 'the old slot is released');
    assert.equal(doc.byKey['sc:cw|sastCobol|fingerprint=fp-aaa'], 'ISS-PERSONAL-S-000001');
    assert.deepEqual(verifyChain(doc), [], 'the hash chain must still verify — this is append-only');
    assert.equal(doc.events.at(-1).type, 'issue-key-migrated');
  });

  test('A SPLIT keeps one and BORNS the rest — and still closes nothing', () => {
    // Two findings that were one issue. The kept one is the lowest key, a deterministic choice and
    // not a claim it is the same finding; the other is born as the finding it always was.
    const doc = storeWithLegacyCobol();
    const r = migrateIdentityKeys(doc, rows('fp-bbb', 'fp-aaa'), { at: AT });
    assert.equal(r.adopted.length, 1);
    assert.deepEqual(r.split, [{
      id: 'ISS-PERSONAL-S-000001', from: LEGACY,
      kept: 'sc:cw|sastCobol|fingerprint=fp-aaa', born: ['sc:cw|sastCobol|fingerprint=fp-bbb'],
    }]);
    assert.equal(doc.issues['ISS-PERSONAL-S-000001'].state, 'open');
    assert.equal(Object.values(doc.issues).filter((i) => i.state === 'closed').length, 0,
      'a split must not report a fix for the finding it split');
    assert.deepEqual(doc.events.at(-1).data.splitInto,
      ['sc:cw|sastCobol|fingerprint=fp-aaa', 'sc:cw|sastCobol|fingerprint=fp-bbb']);
  });

  test('it is idempotent: a second pass finds nothing left to adopt', () => {
    const doc = storeWithLegacyCobol();
    migrateIdentityKeys(doc, rows('fp-aaa'), { at: AT });
    const again = migrateIdentityKeys(doc, rows('fp-aaa'), { at: AT });
    assert.deepEqual(again.adopted, []);
    assert.equal(doc.issues['ISS-PERSONAL-S-000001'].priorKeys.length, 1);
  });

  test('dryRun reports the adoption and writes nothing', () => {
    const doc = storeWithLegacyCobol();
    const r = migrateIdentityKeys(doc, rows('fp-aaa'), { at: AT, dryRun: true });
    assert.equal(r.adopted.length, 1);
    assert.equal(doc.issues['ISS-PERSONAL-S-000001'].source.key, LEGACY, 'the store is untouched');
    assert.equal(doc.byKey[LEGACY], 'ISS-PERSONAL-S-000001');
  });

  test('a CLOSED legacy issue is left alone — reopening is a disposition, not a re-key', () => {
    const doc = storeWithLegacyCobol();
    doc.issues['ISS-PERSONAL-S-000001'].state = 'closed';
    const r = migrateIdentityKeys(doc, rows('fp-aaa'), { at: AT });
    assert.deepEqual(r.adopted, []);
    assert.equal(doc.byKey[LEGACY], 'ISS-PERSONAL-S-000001');
  });

  test('a lane that has NOT opted in is never migrated, whatever its rows carry', () => {
    const doc = { version: 1, nextOrdinal: 1, byKey: {}, aliases: {}, lastIngest: null, events: [], issues: {} };
    const legacy = 'sc:cw|depsJvm|CVE-1|pom.xml';
    doc.issues.X = { id: 'X', state: 'open', source: { kind: 'scanner-row', key: legacy }, deps: {}, evidence: [] };
    doc.byKey[legacy] = 'X';
    const open = new Map([['sc:cw|depsJvm|id=CVE-1|package=p',
      { row: { repo: 'cw', rule: 'CVE-1', file: 'pom.xml', id: 'CVE-1', package: 'p' }, category: 'depsJvm' }]]);
    assert.deepEqual(migrateIdentityKeys(doc, open, { at: AT }).adopted, []);
    assert.equal(doc.byKey[legacy], 'X');
  });
});

// ── through the real ingest, which is where a manufactured fix would actually appear ─────────────
// The migration is only correct if it runs BEFORE filing and resolution. Exercising it in isolation
// cannot show that; this does, and it is the one property to keep if any of the above is ever cut:
// no issue crossing the re-key is closed as fixed.
const rollupWithCobol = (findings) => ({
  generated: AT, sliceId: 'slice-rekey',
  scanners: { sastCobol: { ran: true, total: findings.length } },
  scannerFindings: { sastCobol: findings },
  repos: [],
});

describe('ingestArea across the re-key', () => {
  test('the slice that switches identity closes NOTHING as fixed', () => {
    const doc = storeWithLegacyCobol();
    const summary = ingestArea(doc, {
      areaSlug: 'a', now: AT,
      rollup: rollupWithCobol([COB({ fingerprint: 'fp-aaa', sev: 'high', line: 120 })]),
    });
    assert.deepEqual(summary.closed, [], 'the rule|file record must be adopted, never resolved');
    assert.equal(summary.created.length, 0, 'and not re-minted beside itself either');
    assert.equal(summary.identityKeysAdopted.length, 1);
    const iss = doc.issues['ISS-PERSONAL-S-000001'];
    assert.equal(iss.state, 'open');
    assert.equal(iss.source.key, 'sc:cw|sastCobol|fingerprint=fp-aaa');
  });

  test('a split files the second finding as NEW and still closes nothing', () => {
    const doc = storeWithLegacyCobol();
    const summary = ingestArea(doc, {
      areaSlug: 'a', now: AT,
      rollup: rollupWithCobol([
        COB({ fingerprint: 'fp-aaa', sev: 'high', line: 120 }),
        COB({ fingerprint: 'fp-bbb', sev: 'high', line: 640 }),
      ]),
    });
    assert.deepEqual(summary.closed, []);
    assert.equal(summary.created.length, 1, 'the finding rule|file had been hiding is born, once');
    assert.equal(summary.identityKeysSplit.length, 1);
    assert.equal(Object.values(doc.issues).filter((i) => i.state === 'open').length, 2);
    assert.deepEqual(Object.values(doc.issues).map((i) => i.source.key).sort(),
      ['sc:cw|sastCobol|fingerprint=fp-aaa', 'sc:cw|sastCobol|fingerprint=fp-bbb'],
      'the kept issue and the born one hold one key each');
  });
});

// ── version tolerance: what a cobolwork WITHOUT fingerprints does to a re-keyed store ────────────
// cobolwork before 1d0b4bb emits no fingerprint, and the extractor deliberately accepts it rather
// than making one release mandatory (2026-09-24). Those rows key rule|file and
// collapse exactly as they used to — a known cost of version tolerance, not an oversight.
//
// What must NOT happen is the store reading that downgrade as repair work. This pins the property
// under the tolerance: no fingerprint-keyed issue is closed when fingerprint-less rows arrive.
describe('a downgrade to a fingerprint-less cobolwork', () => {
  const rollupAt = (gen, sliceId, findings) => ({
    generated: gen, sliceId, scanners: { sastCobol: { ran: true, total: findings.length } },
    scannerFindings: { sastCobol: findings }, repos: [],
  });

  test('closes nothing — the open findings are not reported fixed by an older tool', () => {
    const doc = { version: 1, nextOrdinal: 1, byKey: {}, aliases: {}, lastIngest: {}, events: [], issues: {} };
    ingestArea(doc, { areaSlug: 'a', now: AT,
      rollup: rollupAt(AT, 's1', [COB({ fingerprint: 'fp-aaa', sev: 'high' }), COB({ fingerprint: 'fp-bbb', sev: 'high' })]) });
    assert.equal(Object.values(doc.issues).filter((i) => i.state === 'open').length, 2);

    const later = '2026-09-25T00:00:00Z';
    const s = ingestArea(doc, { areaSlug: 'a', now: later,
      // fingerprint EXPLICITLY absent: this is what the older tool emits. (COB() defaults one in,
      // and leaving that default in place is not a downgrade at all — it silently tested nothing.)
      rollup: rollupAt(later, 's2', [COB({ fingerprint: undefined, sev: 'high', line: 120 }),
        COB({ fingerprint: undefined, sev: 'high', line: 640 })]) });

    assert.deepEqual(s.closed, [], 'an older tool must not read as two findings fixed');
    for (const iss of Object.values(doc.issues)) assert.equal(iss.state, 'open');
    // The cost, stated so it is not mistaken for a fault later: the fingerprint-less rows collapse
    // into ONE rule|file issue beside the two they duplicate. It lingers until those findings go.
    assert.equal(s.created.length, 1);
    assert.equal(Object.values(doc.issues).length, 3);
  });
});

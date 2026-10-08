// monitor/test/a11y-attestations.test.mjs — the WCAG attestation store: refusal without identity,
// digest invalidation, attested ≠ static pass, fail closed, expiry, machine ≠ human, append-only.
// An attestation is suppression-shaped, so every property is about not lying.
// Fixtures only; monitor/a11y-attestations.json is never touched.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CRITERIA, buildReport } = await import('../../bin/a11y-scan.mjs');
const {
  emptyAttestationsDoc, loadAttestations, saveAttestations, recordAttestation, mergeAttestations,
  withAttestationsLock, holdsAttestationsLock,
  attestationStatus, attestedState, attestableCriteria, latestEntry, reportDigest,
  ATTESTATION_TTL_DAYS, ATTESTATION_MAX_TTL_DAYS, REFUSALS, VERDICTS,
} = await import('../a11y-attestations.mjs');

const T0 = '2026-08-03T12:00:00.000Z';
const daysAfter = (iso, d) => new Date(new Date(iso).getTime() + d * 86_400_000).toISOString();
const tmp = () => mkdtempSync(join(tmpdir(), 'cw-a11y-att-'));

// A logged-in panel operator, in the shape monitor/attribution.mjs::sessionWho consumes.
const HUMAN = { user: 'portll@example.com', provider: 'local' };
// A session belonging to an agent. attribution.mjs classifies this as machine on the name alone.
const AGENT = { user: 'claude-code@example.com', provider: 'local' };

const PAGE = '<html lang="en"><head><title>panel</title></head><body><h1>h</h1><p>x</p></body></html>';
const SHEET = ':root{--bg:#0f1319;--ink:#cdd3de}\n.a{color:var(--ink)}';

/** A real report, built by the real scanner, so the fixture cannot drift from the artifact. */
function report({ html = PAGE, css = SHEET } = {}) {
  return buildReport({
    files: [{ path: 'admin/index.html', html }],
    cssFiles: [{ path: 'admin/static/panel.css', css }],
    nowIso: '2026-08-01T00:00:00.000Z',
  });
}

const attest = (doc, payload, over = {}) => recordAttestation(doc, payload, {
  report: report(), area: 'fixarea', session: HUMAN, now: T0, channel: 'http', ...over,
});

describe('the closed set of attestable criteria', () => {
  test('is DERIVED from the scanner, never duplicated', () => {
    const declared = CRITERIA.filter((c) => c.static === false).map((c) => c.id).sort();
    assert.deepEqual([...attestableCriteria()].sort(), declared);
    // the six the brief names; if the scanner learns to decide one, this list must shrink with it
    for (const id of ['2.4.3', '2.5.8', '2.4.11', '1.3.2', '3.3.7', '1.4.11']) {
      assert.ok(attestableCriteria().has(id), `${id} should be attestable`);
    }
  });

  test('a criterion the SCANNER decides cannot be attested — a signature never sits in front of a measurement', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '1.1.1', verdict: 'meets' });
    assert.equal(r.ok, false);
    assert.equal(r.refused, REFUSALS.NOT_ATTESTABLE);
    assert.equal(doc.entries.length, 0);
  });

  test('every attestable criterion ships instructions for the person doing the checking', () => {
    for (const c of CRITERIA.filter((x) => x.static === false)) {
      assert.ok(c.howToVerify && c.howToVerify.length > 40, `${c.id} has no howToVerify`);
    }
  });
});

describe('(1) refusal without identity', () => {
  test('no session ⇒ REFUSED, and nothing is written', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets' }, { session: null });
    assert.equal(r.ok, false);
    assert.equal(r.refused, REFUSALS.NO_IDENTITY);
    assert.match(r.errors.join(' '), /worth exactly the identity behind it/);
    assert.equal(doc.entries.length, 0, 'a refused attestation must not be filed anonymously');
  });

  test('a session with a blank user is the same refusal — an empty string is not an identity', () => {
    const doc = emptyAttestationsDoc();
    for (const session of [{ user: '' }, { user: '   ' }, { provider: 'local' }, {}]) {
      const r = attest(doc, { criterion: '2.4.3', verdict: 'meets' }, { session });
      assert.equal(r.refused, REFUSALS.NO_IDENTITY);
    }
    assert.equal(doc.entries.length, 0);
  });

  test('identity is checked BEFORE the payload — an anonymous well-formed attestation is not "nearly valid"', () => {
    const doc = emptyAttestationsDoc();
    // a payload that would also fail the schema; the identity refusal must be the one reported
    const r = attest(doc, { criterion: 'not-a-criterion', nonsense: true }, { session: null });
    assert.equal(r.refused, REFUSALS.NO_IDENTITY);
  });

  test('an area that does not resolve is refused — an attestation names the pages it is about', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets' }, { area: '' });
    assert.equal(r.refused, REFUSALS.BAD_AREA);
    assert.equal(doc.entries.length, 0);
  });

  test('the signature is the session\'s own spelling, from sessionWho — not the caller\'s', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets', note: 'tabbed the whole page' });
    assert.equal(r.ok, true);
    assert.equal(r.entry.who, 'portll@example.com (local)');
    assert.equal(r.entry.whoKind, 'human');
  });
});

describe('(2) the digest — an attestation must not outlive what it attested to', () => {
  test('the scanner stamps a content digest over every audited file, path-qualified', () => {
    const r = report();
    assert.match(r.subject.digest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(r.subject.sources.map((s) => `${s.kind}:${s.path}`).sort(),
      ['css:admin/static/panel.css', 'html:admin/index.html']);
    assert.equal(reportDigest(r), r.subject.digest);
  });

  test('it is deterministic, and it moves when ANY audited byte moves', () => {
    assert.equal(report().subject.digest, report().subject.digest);
    assert.notEqual(report().subject.digest, report({ html: PAGE + '<p>later</p>' }).subject.digest);
    // CSS is in the digest too: target size and non-text contrast are stylesheet facts
    assert.notEqual(report().subject.digest, report({ css: SHEET + '\n.b{color:var(--ink)}' }).subject.digest);
  });

  test('a MARKUP change invalidates a focus-order attestation — the ruling was about the old page', () => {
    const doc = emptyAttestationsDoc();
    assert.equal(attest(doc, { criterion: '2.4.3', verdict: 'meets' }).ok, true);

    const before = mergeAttestations(report(), doc, { area: 'fixarea', now: T0 })
      .criteria.find((c) => c.id === '2.4.3');
    assert.equal(before.effectiveState, 'attested-pass');
    assert.equal(before.attestation.status, 'active');

    const after = mergeAttestations(report({ html: PAGE.replace('<p>x</p>', '<nav>menu</nav><p>x</p>') }), doc,
      { area: 'fixarea', now: T0 }).criteria.find((c) => c.id === '2.4.3');
    assert.equal(after.attestation.status, 'stale-subject');
    assert.equal(after.effectiveState, 'unchecked', 'a stale attestation clears nothing');
    assert.equal(after.attestation.counts, false);
  });

  test('a STYLESHEET change invalidates too — CSS moves rendered layout, which is the whole point', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.5.8', verdict: 'meets' });
    const after = mergeAttestations(report({ css: SHEET + '\n.btn{width:8px}' }), doc, { area: 'fixarea', now: T0 })
      .criteria.find((c) => c.id === '2.5.8');
    assert.equal(after.attestation.status, 'stale-subject');
    assert.equal(after.effectiveState, 'unchecked');
  });

  test('an artifact with NO digest makes every attestation unverifiable, never "probably still fine"', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'meets' });
    const old = report(); delete old.subject;                 // an artifact from before digests existed
    const row = mergeAttestations(old, doc, { area: 'fixarea', now: T0 }).criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.attestation.status, 'unverifiable');
    assert.equal(row.effectiveState, 'unchecked');
    // and nothing new may be filed against it
    assert.equal(attest(emptyAttestationsDoc(), { criterion: '2.4.3', verdict: 'meets' }, { report: old }).refused,
      REFUSALS.NO_SUBJECT);
  });

  test('the caller may PIN the digest, and a pin that no longer matches is refused', () => {
    const doc = emptyAttestationsDoc();
    const stale = 'sha256:' + '0'.repeat(64);
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets', subjectDigest: stale });
    assert.equal(r.refused, REFUSALS.STALE_SUBJECT);
    assert.equal(doc.entries.length, 0);
    // the current one is accepted
    assert.equal(attest(doc, { criterion: '2.4.3', verdict: 'meets', subjectDigest: report().subject.digest }).ok, true);
  });

  test('the caller cannot NAME its own subject — the digest stored is the artifact\'s, always', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets', subjectDigest: report().subject.digest });
    assert.equal(r.entry.subjectDigest, report().subject.digest);
  });

  test('an area is not another area — the store is keyed by both', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'meets' }, { area: 'fixarea' });
    assert.ok(latestEntry(doc, 'fixarea', '2.4.3'));
    assert.equal(latestEntry(doc, 'otherarea', '2.4.3'), null);
    const row = mergeAttestations(report(), doc, { area: 'otherarea', now: T0 }).criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.effectiveState, 'unchecked');
  });
});

describe('(3) attested is NOT a static pass', () => {
  test('the scanner\'s own levels and conformance survive the merge byte-identical', () => {
    const doc = emptyAttestationsDoc();
    for (const id of [...attestableCriteria()]) attest(doc, { criterion: id, verdict: 'meets' });
    const raw = report();
    const merged = mergeAttestations(raw, doc, { area: 'fixarea', now: T0 });
    assert.deepEqual(merged.levels, raw.levels, 'an attestation may not edit the scanner\'s tally');
    assert.deepEqual(merged.conformance, raw.conformance, 'an attestation may not edit the scanner\'s claim');
    assert.ok(raw.levels.A.unchecked > 0 || raw.levels.AA.unchecked > 0);
  });

  test('the merged tally counts attestedPass SEPARATELY from pass', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'meets' });          // level A
    const raw = report();
    const merged = mergeAttestations(raw, doc, { area: 'fixarea', now: T0 });
    assert.equal(merged.attestedLevels.A.pass, raw.levels.A.pass, 'the static pass count must not move');
    assert.equal(merged.attestedLevels.A.attestedPass, 1);
    assert.equal(merged.attestedLevels.A.unchecked, raw.levels.A.unchecked - 1);
  });

  test('the STATE is a different word, not a promoted one', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'meets' });
    const row = mergeAttestations(report(), doc, { area: 'fixarea', now: T0 }).criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.state, 'unchecked', 'the scanner\'s own state is untouched');
    assert.equal(row.effectiveState, 'attested-pass');
    assert.notEqual(row.effectiveState, 'pass');
    // and the legend travels with the data so no client can invent its own mapping
    assert.match(mergeAttestations(report(), doc, { area: 'fixarea', now: T0 }).effectiveStates['attested-pass'],
      /NOT a scanner pass/);
  });

  test('attesting every undecided criterion yields a conformance claim that is LABELLED as resting on signatures', () => {
    const doc = emptyAttestationsDoc();
    for (const id of [...attestableCriteria()]) attest(doc, { criterion: id, verdict: 'meets' });
    const merged = mergeAttestations(report(), doc, { area: 'fixarea', now: T0 });
    assert.equal(merged.conformance.AA, 'unverified', 'the scanner still cannot claim AA');
    assert.equal(merged.attestedConformance.AA, 'conformant');
    assert.match(merged.attestedConformance.note, /DIFFERENT CLAIM/);
    assert.match(merged.attestedConformance.note, /signed statement, not a measurement/);
  });

  test('a person who checks and finds it BROKEN is recorded as a failure, not as silence', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'fails', note: 'the dialog lets focus escape behind it' });
    const merged = mergeAttestations(report(), doc, { area: 'fixarea', now: T0 });
    const row = merged.criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.effectiveState, 'attested-fail');
    assert.equal(merged.attestedLevels.A.fail, 1);
    assert.equal(merged.attestedConformance.A, 'fails');
    assert.deepEqual(VERDICTS, ['meets', 'fails', 'not-applicable']);
  });

  test('attestedState never promotes a criterion the scanner already answered', () => {
    const e = { action: 'attest', verdict: 'meets', whoKind: 'human', subjectDigest: 'd', expires: null };
    assert.equal(attestedState('fail', e, { now: T0, currentDigest: 'd' }), 'fail');
    assert.equal(attestedState('pass', e, { now: T0, currentDigest: 'd' }), 'pass');
    assert.equal(attestedState('unchecked', e, { now: T0, currentDigest: 'd' }), 'attested-pass');
  });
});

describe('(4) fail closed', () => {
  test('ENOENT is the ONLY legitimate absence', () => {
    const dir = tmp();
    const doc = loadAttestations({ path: join(dir, 'nope.json') });
    assert.deepEqual(doc.entries, []);
    assert.equal(doc.version, 1);
  });

  test('unparseable JSON throws — a corrupt store is never an empty one', () => {
    const dir = tmp();
    const p = join(dir, 'a.json');
    writeFileSync(p, '{ this is not json');
    assert.throws(() => loadAttestations({ path: p }), /not valid JSON.*refusing to treat it as empty/s);
  });

  test('a document of the wrong SHAPE throws', () => {
    const dir = tmp();
    for (const [name, body] of [['arr', '[]'], ['noentries', '{"version":1}'], ['null', 'null']]) {
      const p = join(dir, `${name}.json`);
      writeFileSync(p, body);
      assert.throws(() => loadAttestations({ path: p }), /not an attestation document/);
    }
  });

  test('ONE malformed entry throws — a partial store is never served as a whole one', () => {
    const dir = tmp();
    const p = join(dir, 'a.json');
    const good = { id: 'ATT-1', action: 'attest', area: 'fixarea', criterion: '2.4.3', who: 'a', at: T0 };
    writeFileSync(p, JSON.stringify({ version: 1, entries: [good, { criterion: '2.5.8' }] }));
    assert.throws(() => loadAttestations({ path: p }), /entry 1 is malformed/);
  });

  test('an unreadable file throws rather than reading as "nobody has attested anything"', { skip: ignoresPermissions() ? 'permissions are ignored here' : false }, () => {
    const dir = tmp();
    const p = join(dir, 'a.json');
    writeFileSync(p, JSON.stringify(emptyAttestationsDoc()));
    const _deny = denyRead(p);

    assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
    try { assert.throws(() => loadAttestations({ path: p }), /unreadable.*refusing to treat it as empty/s); }
    finally { _deny.restore(); }
  });

  test('save/load round-trips atomically', () => {
    const dir = tmp();
    const p = join(dir, 'nested', 'a.json');
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'meets' });
    withAttestationsLock(() => saveAttestations(doc, { path: p }), { path: p });
    assert.ok(existsSync(p));
    assert.deepEqual(loadAttestations({ path: p }).entries, doc.entries);
    assert.ok(!existsSync(`${p}.tmp-${process.pid}`), 'the tmp file is renamed, never left behind');
  });

  test('an unlocked save is REFUSED — atomic prevents a torn file, not a lost one', () => {
    const p = join(tmp(), 'b.json');
    assert.throws(() => saveAttestations(emptyAttestationsDoc(), { path: p }), /without its lock/);
    assert.ok(!existsSync(p), 'the refused write left nothing behind');
  });

  test('holdsAttestationsLock is true only inside the lock', () => {
    const p = join(tmp(), 'c.json');
    assert.equal(holdsAttestationsLock(p), false);
    withAttestationsLock(() => assert.equal(holdsAttestationsLock(p), true), { path: p });
    assert.equal(holdsAttestationsLock(p), false, 'deregistered before release');
  });
});

describe('(5) expiry', () => {
  test('an attestation with no stated expiry gets the default TTL — nothing stands forever silently', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets' });
    assert.equal(r.entry.expires, daysAfter(T0, ATTESTATION_TTL_DAYS()));
  });

  test('a past expiry is refused', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets', expires: daysAfter(T0, -1) });
    assert.equal(r.refused, REFUSALS.BAD_EXPIRY);
    assert.equal(doc.entries.length, 0);
  });

  test('an expiry beyond the ceiling is refused', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets', expires: daysAfter(T0, ATTESTATION_MAX_TTL_DAYS() + 2) });
    assert.equal(r.refused, REFUSALS.BAD_EXPIRY);
    assert.match(r.errors.join(' '), /permanent pass in disguise/);
  });

  test('an expired attestation stops clearing the criterion', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'meets', expires: daysAfter(T0, 10) });
    const later = daysAfter(T0, 11);
    const row = mergeAttestations(report(), doc, { area: 'fixarea', now: later }).criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.attestation.status, 'expired');
    assert.equal(row.effectiveState, 'unchecked');
  });

  test('attestationStatus never returns "active" for anything but a live, on-subject, unexpired record', () => {
    const e = { action: 'attest', subjectDigest: 'd', expires: daysAfter(T0, 5) };
    assert.equal(attestationStatus(e, { now: T0, currentDigest: 'd' }), 'active');
    assert.equal(attestationStatus(e, { now: T0, currentDigest: 'other' }), 'stale-subject');
    assert.equal(attestationStatus(e, { now: T0, currentDigest: null }), 'unverifiable');
    assert.equal(attestationStatus(e, { now: daysAfter(T0, 6), currentDigest: 'd' }), 'expired');
    assert.equal(attestationStatus({ ...e, action: 'withdraw' }, { now: T0, currentDigest: 'd' }), 'withdrawn');
    assert.equal(attestationStatus(null, { now: T0, currentDigest: 'd' }), 'withdrawn');
  });
});

describe('(6) machine-attributed is not human-attributed', () => {
  test('an agent-named session is recorded as machine and clears NOTHING', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets' }, { session: AGENT });
    assert.equal(r.ok, true, 'it is still recorded — the record is the evidence');
    assert.equal(r.entry.whoKind, 'machine');
    const row = mergeAttestations(report(), doc, { area: 'fixarea', now: T0 }).criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.effectiveState, 'unchecked');
    assert.equal(row.attestation.counts, false);
    assert.match(row.attestation.notCounted, /clears nothing/);
  });

  test('a non-panel channel can never yield a human attribution, however it spells its name', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3', verdict: 'meets' }, { channel: 'mcp' });
    assert.equal(r.entry.whoKind, 'machine', 'only the panel holds a real login');
    assert.equal(mergeAttestations(report(), doc, { area: 'fixarea', now: T0 })
      .criteria.find((c) => c.id === '2.4.3').effectiveState, 'unchecked');
  });

  test('an unknown channel is refused outright', () => {
    const doc = emptyAttestationsDoc();
    assert.equal(attest(doc, { criterion: '2.4.3', verdict: 'meets' }, { channel: 'carrier-pigeon' }).refused,
      REFUSALS.BAD_CHANNEL);
  });
});

describe('(7) append-only', () => {
  test('a withdrawal APPENDS; the original attestation is still readable', () => {
    const doc = emptyAttestationsDoc();
    const first = attest(doc, { criterion: '2.4.3', verdict: 'meets', note: 'checked it' });
    const w = attest(doc, { criterion: '2.4.3', action: 'withdraw' }, { now: daysAfter(T0, 1) });
    assert.equal(w.ok, true);
    assert.equal(doc.entries.length, 2, 'nothing is deleted');
    assert.equal(doc.entries[0].id, first.entry.id);
    assert.equal(doc.entries[0].note, 'checked it');
    assert.equal(w.entry.supersedes, first.entry.id);
    const row = mergeAttestations(report(), doc, { area: 'fixarea', now: daysAfter(T0, 1) })
      .criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.effectiveState, 'unchecked');
    assert.equal(row.attestation.status, 'withdrawn');
  });

  test('withdrawing nothing is refused rather than filed as a no-op', () => {
    const doc = emptyAttestationsDoc();
    assert.equal(attest(doc, { criterion: '2.4.3', action: 'withdraw' }).refused, REFUSALS.NOTHING_TO_WITHDRAW);
    assert.equal(doc.entries.length, 0);
  });

  test('a later attestation supersedes an earlier one, and both remain', () => {
    const doc = emptyAttestationsDoc();
    attest(doc, { criterion: '2.4.3', verdict: 'meets' });
    const second = attest(doc, { criterion: '2.4.3', verdict: 'fails' }, { now: daysAfter(T0, 2) });
    assert.equal(doc.entries.length, 2);
    assert.equal(latestEntry(doc, 'fixarea', '2.4.3').id, second.entry.id);
    assert.equal(mergeAttestations(report(), doc, { area: 'fixarea', now: daysAfter(T0, 2) })
      .criteria.find((c) => c.id === '2.4.3').effectiveState, 'attested-fail');
  });
});

describe('the schema is the door', () => {
  test('an attestation with no verdict is refused — "I checked it" that says nothing is not a record', () => {
    const doc = emptyAttestationsDoc();
    const r = attest(doc, { criterion: '2.4.3' });
    assert.equal(r.refused, REFUSALS.SCHEMA);
    assert.equal(doc.entries.length, 0);
  });

  test('an unknown verdict, an unknown key and a control character in the note are all refused', () => {
    const doc = emptyAttestationsDoc();
    assert.equal(attest(doc, { criterion: '2.4.3', verdict: 'looks-fine' }).refused, REFUSALS.SCHEMA);
    assert.equal(attest(doc, { criterion: '2.4.3', verdict: 'meets', who: 'somebody else' }).refused, REFUSALS.SCHEMA);
    assert.equal(attest(doc, { criterion: '2.4.3', verdict: 'meets', at: T0 }).refused, REFUSALS.SCHEMA);
    assert.equal(attest(doc, { criterion: '2.4.3', verdict: 'meets', note: `a note with a${String.fromCharCode(10)}newline forged into it` }).refused, REFUSALS.SCHEMA);
    assert.equal(doc.entries.length, 0);
  });

  test('a non-object payload is refused before anything else touches it', () => {
    const doc = emptyAttestationsDoc();
    for (const bad of [null, 'string', 42, ['a']]) assert.equal(attest(doc, bad).refused, REFUSALS.SCHEMA);
  });
});

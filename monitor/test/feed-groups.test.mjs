// The feed's group model is keyed on place, never on a line number, and it drops nothing: every
// ungraded or suppressed row is counted where a reader sees it. The state table is checked over
// every combination, because a `fixed` that the scanner still contradicts is the unsupported pass
// this repository exists to refuse.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeedGroups, feedGroupMembers, feedView, feedState, groupKeyFor, subRowKeyFor, storeKeyFor, issueForDoc,
  subjectFieldsFor, displayRank, FEED_STATES, FOCUS_STATES, SUPPRESSING_ACTIONS,
} from '../feed-groups.mjs';
import { panelSchema } from '../detail-schema.mjs';
import { ISSUE_STATES, CLOSED_AS, SEV_RANK } from '../issue-store.mjs';

const sast = (over = {}) => ({ repo: 'acme/widgets', rule: 'js/sql-injection', file: 'src/db.js', line: 10, sev: 'high', message: 'tainted', ...over });
const dep = (over = {}) => ({ repo: 'acme/widgets', id: 'GHSA-xxxx-1', package: 'left-pad', sev: 'med', message: 'advisory', ...over });

describe('identity is line-free by construction', () => {
  test('no declared identity in any lane names line', () => {
    const schema = panelSchema();
    const offenders = Object.entries(schema).filter(([, s]) => s.identity.includes('line')).map(([k]) => k);
    assert.deepEqual(offenders, []);
    assert.ok(Object.keys(schema).length > 50, 'the schema is the one the panel reads');
  });

  test('two rows differing only in line share group and sub-row keys', () => {
    const a = sast({ line: 10 }), b = sast({ line: 412 });
    assert.equal(groupKeyFor('sastSemgrep', a).key, groupKeyFor('sastSemgrep', b).key);
    assert.equal(subRowKeyFor('sastSemgrep', a), subRowKeyFor('sastSemgrep', b));
  });

  test('a row moved to another file is the same group and a different sub-row', () => {
    const a = sast(), b = sast({ file: 'src/other.js' });
    assert.equal(groupKeyFor('sastSemgrep', a).key, groupKeyFor('sastSemgrep', b).key);
    assert.notEqual(subRowKeyFor('sastSemgrep', a), subRowKeyFor('sastSemgrep', b));
  });

  test('dependency lanes group by package with advisories as sub-rows', () => {
    assert.deepEqual(subjectFieldsFor('depsGo'), { fields: ['package'], declared: true });
    assert.deepEqual(subjectFieldsFor('supplyChain'), { fields: ['package', 'ecosystem'], declared: true });
    assert.deepEqual(subjectFieldsFor('depsRetire'), { fields: ['component'], declared: true });
    const a = dep({ id: 'GHSA-xxxx-1' }), b = dep({ id: 'GHSA-xxxx-2' });
    assert.equal(groupKeyFor('depsGo', a).key, groupKeyFor('depsGo', b).key);
    assert.notEqual(subRowKeyFor('depsGo', a), subRowKeyFor('depsGo', b));
  });

  test('control, criterion and marker lanes pick the subject the schema declares', () => {
    assert.deepEqual(subjectFieldsFor('cspm').fields, ['control']);
    assert.deepEqual(subjectFieldsFor('accessibility').fields, ['criterion']);
    assert.deepEqual(subjectFieldsFor('stubs').fields, ['marker']);
    assert.deepEqual(subjectFieldsFor('sastCobol').fields, ['fingerprint']);
  });

  test('an undeclared lane is grouped by a fallback field and reported, never dropped', () => {
    const built = buildFeedGroups({ notALane: [sast(), sast({ line: 99 })] });
    assert.deepEqual(built.undeclaredLanes, ['notALane']);
    assert.equal(built.groups.length, 1);
    assert.equal(built.groups[0].identityDeclared, false);
    assert.equal(built.totals.rows, 2);
  });
});

describe('severity and KEV', () => {
  test('severity spellings normalise and an empty one is undetermined, counted not dropped', () => {
    const built = buildFeedGroups({ sastSemgrep: [sast({ sev: 'critical' }), sast({ sev: 'crit', file: 'b' }), sast({ sev: '', file: 'c' }), sast({ file: 'd', sev: undefined })] });
    const g = built.groups[0];
    assert.equal(g.counts.crit, 2);
    assert.equal(g.counts.unknown, 2);
    assert.equal(g.undetermined, 2);
    assert.equal(built.totals.undetermined, 2);
    assert.equal(built.totals.graded, 2);
    assert.equal(g.worst, 'crit');
  });

  test('KEV floors a group between high and critical and never demotes a critical', () => {
    assert.ok(displayRank('med', true) > SEV_RANK.high);
    assert.ok(displayRank('med', true) < SEV_RANK.crit);
    assert.equal(displayRank('crit', true), SEV_RANK.crit);
    assert.equal(displayRank('low', false), SEV_RANK.low);
    const built = buildFeedGroups({ sastSemgrep: [sast({ rule: 'a', sev: 'high' }), sast({ rule: 'b', sev: 'med', kev: true })] });
    assert.deepEqual(built.groups.map((g) => g.subject), ['b', 'a']);
    assert.equal(built.totals.kev, 1);
  });

  test('a group with only undetermined rows is out of Focus and in All, with the hidden count stated', () => {
    const built = buildFeedGroups({ sastSemgrep: [sast({ rule: 'graded' }), sast({ rule: 'ungraded', sev: '' })] });
    const focus = feedView(built, { mode: 'focus' }), all = feedView(built, { mode: 'all' });
    assert.deepEqual(focus.groups.map((g) => g.subject), ['graded']);
    assert.equal(focus.hidden, 1);
    assert.equal(all.groups.length, 2);
    assert.equal(all.hidden, 0);
    assert.equal(focus.totals.undetermined, 1);
    assert.throws(() => feedView(built, { mode: 'everything' }), /focus\|all/);
  });
});

describe('suppression', () => {
  test('a suppressing annotation leaves Focus but stays counted on the group and in totals', () => {
    const rows = SUPPRESSING_ACTIONS.map((action, i) => sast({ file: `f${i}`, annotation: { action, reason: 'x' } }));
    const built = buildFeedGroups({ sastSemgrep: rows });
    const g = built.groups[0];
    assert.equal(g.suppressed, SUPPRESSING_ACTIONS.length);
    assert.equal(g.members, SUPPRESSING_ACTIONS.length);
    assert.equal(g.states.suppressed, SUPPRESSING_ACTIONS.length);
    assert.equal(g.inFocus, false);
    assert.equal(built.totals.suppressed, SUPPRESSING_ACTIONS.length);
    assert.equal(feedView(built).hidden, 1);
  });

  test('a non-suppressing annotation keeps the row open', () => {
    const built = buildFeedGroups({ sastSemgrep: [sast({ annotation: { action: 'note', reason: 'x' } })] });
    assert.equal(built.groups[0].states.open, 1);
    assert.equal(built.groups[0].inFocus, true);
  });
});

describe('the state table', () => {
  test('every combination of issue state, closedAs, presence and suppression yields a declared state', () => {
    const seen = new Set();
    for (const present of [true, false]) {
      for (const suppressed of [true, false]) {
        seen.add(feedState({ issue: null, present, suppressed }));
        for (const state of ISSUE_STATES) {
          if (state !== 'closed') { seen.add(feedState({ issue: { state }, present, suppressed })); continue; }
          for (const closedAs of CLOSED_AS) seen.add(feedState({ issue: { state, closedAs }, present, suppressed }));
        }
      }
    }
    for (const s of seen) assert.ok(FEED_STATES.includes(s), `undeclared feed state ${s}`);
    assert.deepEqual([...seen].sort(), [...FEED_STATES].sort());
  });

  test('fixed needs a fixed ruling AND an absent row; a contradicted fixed is claimed-fixed', () => {
    assert.equal(feedState({ issue: { state: 'closed', closedAs: 'fixed' }, present: false }), 'fixed');
    assert.equal(feedState({ issue: { state: 'closed', closedAs: 'fixed' }, present: true }), 'claimed-fixed');
    assert.equal(feedState({ issue: { state: 'closed', closedAs: 'accepted' }, present: true }), 'accepted');
    assert.equal(feedState({ issue: { state: 'open' }, present: true, suppressed: true }), 'open');
    assert.equal(feedState({ issue: null, present: true, suppressed: true }), 'suppressed');
    assert.equal(feedState({ issue: null, present: false }), 'gone');
    assert.ok(FOCUS_STATES.includes('claimed-fixed') && !FOCUS_STATES.includes('fixed'));
  });

  test('an issue record with an unknown state or closedAs is refused, not mapped', () => {
    assert.throws(() => feedState({ issue: { state: 'done' } }), /unknown issue state/);
    assert.throws(() => feedState({ issue: { state: 'closed', closedAs: 'resolved' } }), /closedAs/);
  });

  test('the sub-row key IS the issue store key, so a ruling joins without a second scheme', () => {
    const row = sast();
    assert.equal(storeKeyFor('sastSemgrep', row), 'sc:acme/widgets|sastSemgrep|js/sql-injection|src/db.js');
    assert.equal(subRowKeyFor('sastSemgrep', row), storeKeyFor('sastSemgrep', row));
    assert.equal(storeKeyFor('sastSemgrep', sast({ line: 999 })), storeKeyFor('sastSemgrep', row));
    assert.equal(storeKeyFor('cobolCoverage', { repo: 'r' }), null, 'an unkeyable row has no store key');
    assert.notEqual(subRowKeyFor('cobolCoverage', { repo: 'r' }), null, 'but still has a sub-row key');
    const doc = { byKey: { [storeKeyFor('sastSemgrep', row)]: 'ISS-000001' }, issues: { 'ISS-000001': { state: 'blocked' } } };
    const built = buildFeedGroups({ sastSemgrep: [row, sast({ file: 'z' })] }, { issueFor: issueForDoc(doc) });
    assert.deepEqual(built.groups[0].states, { blocked: 1, open: 1 });
    assert.equal(issueForDoc(null)('sastSemgrep', row, 'x'), null);
  });

  test('issueFor joins an issue record to a row by its sub-row key', () => {
    const row = sast();
    const key = subRowKeyFor('sastSemgrep', row);
    const built = buildFeedGroups({ sastSemgrep: [row, sast({ file: 'z' })] }, {
      issueFor: (lane, r, k) => (k === key ? { state: 'claimed' } : null),
    });
    assert.deepEqual(built.groups[0].states, { claimed: 1, open: 1 });
  });
});

describe('shape and determinism', () => {
  test('input order does not change the output', () => {
    const rows = [sast({ rule: 'b', sev: 'low' }), sast({ rule: 'a', sev: 'high' }), sast({ rule: 'a', file: 'x', sev: 'med' }), dep()];
    const a = JSON.stringify(buildFeedGroups({ sastSemgrep: rows.slice(0, 3), depsGo: [rows[3]] }));
    const b = JSON.stringify(buildFeedGroups({ depsGo: [rows[3]], sastSemgrep: [rows[2], rows[0], rows[1]] }));
    assert.equal(a, b);
  });

  test('a group carries distinct sub-row count and members are retrievable by the same key', () => {
    const sf = { sastSemgrep: [sast(), sast({ line: 20 }), sast({ file: 'b' })] };
    const built = buildFeedGroups(sf);
    const g = built.groups[0];
    assert.equal(g.members, 3);
    assert.equal(g.distinct, 2);
    assert.equal(feedGroupMembers(sf, g.key).length, 3);
    assert.equal(new Set(feedGroupMembers(sf, g.key).map((m) => m.subRowKey)).size, 2);
  });

  test('a scannerFindings that is not an object is refused and a non-array lane is skipped', () => {
    assert.throws(() => buildFeedGroups([]), /keyed by lane/);
    assert.throws(() => buildFeedGroups(null), /keyed by lane/);
    const built = buildFeedGroups({ sastSemgrep: { not: 'rows' }, depsGo: [dep()] });
    assert.equal(built.totals.rows, 1);
  });

  test('lanes option restricts the build and totals follow it', () => {
    const built = buildFeedGroups({ sastSemgrep: [sast()], depsGo: [dep()] }, { lanes: ['depsGo'] });
    assert.equal(built.groups.length, 1);
    assert.equal(built.groups[0].lane, 'depsGo');
    assert.equal(built.totals.rows, 1);
  });

  test('fifty thousand rows group without loss', () => {
    const rows = [];
    for (let i = 0; i < 50_000; i++) rows.push(sast({ rule: `r${i % 200}`, file: `f${i % 1000}`, line: i, sev: ['low', 'med', 'high', ''][i % 4] }));
    const built = buildFeedGroups({ sastSemgrep: rows });
    assert.equal(built.totals.rows, 50_000);
    assert.equal(built.groups.length, 200);
    assert.equal(built.totals.undetermined, 12_500);
    assert.equal(built.groups.reduce((n, g) => n + g.members, 0), 50_000);
  });
});

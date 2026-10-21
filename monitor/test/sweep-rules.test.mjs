// pins: last-match-wins (not specificity), excluded != no-match, and no wildcard-by-omission.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRule,
  parseRules,
  resolveFor,
  explain,
  rulesToRows,
  rowsToRules,
} from '../sweep-rules.mjs';

const rule = (include, directory, name, value) => ({ include, directory, name, value });
const target = { directory: 'Portll', name: 'commitwork' };

// --- matching --------------------------------------------------------------------------------

test('exact directory + exact name matches', () => {
  const rules = [rule(true, 'Portll', 'commitwork', 7)];
  assert.deepEqual(resolveFor(target, { rules, fallback: 0 }), {
    value: 7, source: 'rule', ruleIndex: 0, matchedBy: 'directory=exact,name=exact',
  });
});

test('exact rule does not match a different directory or a different name', () => {
  const rules = [rule(true, 'Portll', 'commitwork', 7)];
  assert.equal(resolveFor({ directory: 'Other', name: 'commitwork' }, { rules, fallback: 0 }).source, 'fallback');
  assert.equal(resolveFor({ directory: 'Portll', name: 'internal-d' }, { rules, fallback: 0 }).source, 'fallback');
});

test('* in the directory position matches any directory', () => {
  const rules = [rule(true, '*', 'commitwork', 7)];
  assert.equal(resolveFor({ directory: 'anywhere', name: 'commitwork' }, { rules, fallback: 0 }).value, 7);
  assert.equal(resolveFor({ directory: 'anywhere', name: 'internal-d' }, { rules, fallback: 0 }).source, 'fallback');
  assert.equal(resolveFor(target, { rules, fallback: 0 }).matchedBy, 'directory=*,name=exact');
});

test('* in the name position matches any name', () => {
  const rules = [rule(true, 'Portll', '*', 7)];
  assert.equal(resolveFor({ directory: 'Portll', name: 'anything' }, { rules, fallback: 0 }).value, 7);
  assert.equal(resolveFor({ directory: 'Other', name: 'anything' }, { rules, fallback: 0 }).source, 'fallback');
  assert.equal(resolveFor(target, { rules, fallback: 0 }).matchedBy, 'directory=exact,name=*');
});

test('* in both positions matches everything', () => {
  const rules = [rule(true, '*', '*', 7)];
  assert.equal(resolveFor({ directory: 'a', name: 'b' }, { rules, fallback: 0 }).value, 7);
  assert.equal(resolveFor(target, { rules, fallback: 0 }).matchedBy, 'directory=*,name=*');
});

test('directory and name match case-insensitively', () => {
  const rules = [rule(true, 'PORTLL', 'CommitWork', 7)];
  assert.equal(resolveFor({ directory: 'portll', name: 'commitwork' }, { rules, fallback: 0 }).value, 7);
  assert.equal(resolveFor({ directory: 'PoRtLl', name: 'COMMITWORK' }, { rules, fallback: 0 }).value, 7);
});

test('there is no globbing beyond a bare * — a partial pattern matches nothing', () => {
  for (const pattern of ['commit*', '*work', 'commit', 'commitworks', '**']) {
    const rules = [rule(true, 'Portll', pattern, 7)];
    assert.equal(
      resolveFor(target, { rules, fallback: 0 }).source, 'fallback',
      `'${pattern}' must not glob-match 'commitwork'`,
    );
  }
});

// --- ordering --------------------------------------------------------------------------------

test('LAST match wins: a later specific row overrides an earlier broad one', () => {
  const rules = [rule(true, '*', '*', 'global'), rule(true, 'Portll', 'commitwork', 'specific')];
  const got = resolveFor(target, { rules, fallback: 'none' });
  assert.equal(got.value, 'specific', 'first-match-wins would have answered "global"');
  assert.equal(got.ruleIndex, 1);
});

test('specificity does NOT participate — a later * row beats an earlier exact row', () => {
  const rules = [rule(true, 'Portll', 'commitwork', 'specific'), rule(true, '*', '*', 'global')];
  const got = resolveFor(target, { rules, fallback: 'none' });
  assert.equal(got.value, 'global', 'order decides; the exact row must be moved down to win');
  assert.equal(got.ruleIndex, 1);
});

// --- exclude ---------------------------------------------------------------------------------

test('a matching EXCLUDE row returns the excluded state, not the fallback', () => {
  const rules = [rule(false, 'Portll', 'commitwork', 'ignored')];
  assert.deepEqual(resolveFor(target, { rules, fallback: 'global' }), {
    value: null, source: 'excluded', ruleIndex: 0, matchedBy: 'directory=exact,name=exact',
  });
});

test('excluded and no-match are distinct states and never collapse', () => {
  const rules = [rule(false, 'Portll', 'commitwork', null)];
  const excluded = resolveFor(target, { rules, fallback: 'global' });
  const nothingSaid = resolveFor({ directory: 'Portll', name: 'internal-d' }, { rules, fallback: 'global' });
  assert.equal(excluded.source, 'excluded');
  assert.equal(nothingSaid.source, 'fallback');
  assert.notEqual(excluded.source, nothingSaid.source);
  assert.equal(excluded.value, null);
  assert.equal(nothingSaid.value, 'global');
});

test('a later INCLUDE row un-excludes what an earlier EXCLUDE row caught', () => {
  const rules = [rule(false, 'Portll', '*', null), rule(true, 'Portll', 'commitwork', 42)];
  assert.equal(resolveFor(target, { rules, fallback: 0 }).source, 'rule');
  assert.equal(resolveFor(target, { rules, fallback: 0 }).value, 42);
  assert.equal(resolveFor({ directory: 'Portll', name: 'internal-d' }, { rules, fallback: 0 }).source, 'excluded');
});

// --- fallback --------------------------------------------------------------------------------

test('no rule matches => fallback, source fallback, no rule index', () => {
  assert.deepEqual(resolveFor(target, { rules: [rule(true, 'Other', 'x', 1)], fallback: 'G' }), {
    value: 'G', source: 'fallback', ruleIndex: null, matchedBy: null,
  });
});

test('an empty or absent rule list yields the fallback', () => {
  assert.equal(resolveFor(target, { rules: [], fallback: 'G' }).source, 'fallback');
  assert.equal(resolveFor(target, { fallback: 'G' }).value, 'G');
  assert.equal(resolveFor(target, {}).source, 'fallback');
});

test('the value is opaque — objects and falsey values pass through untouched', () => {
  const cadence = { every: '6h' };
  assert.equal(resolveFor(target, { rules: [rule(true, '*', '*', cadence)], fallback: null }).value, cadence);
  for (const v of [0, '', false, null]) {
    assert.equal(resolveFor(target, { rules: [rule(true, '*', '*', v)], fallback: 'G' }).value, v);
    assert.equal(resolveFor(target, { rules: [rule(true, '*', '*', v)], fallback: 'G' }).source, 'rule');
  }
});

// --- validation ------------------------------------------------------------------------------

test('include must be a boolean', () => {
  const r = parseRule({ include: 'yes', directory: 'Portll', name: 'commitwork', value: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /include must be a boolean/);
});

test('include missing entirely is an error', () => {
  const r = parseRule({ directory: 'Portll', name: 'commitwork' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /include must be a boolean.*undefined/);
});

test('a missing name is an ERROR, never an implicit *', () => {
  const r = parseRule({ include: true, directory: 'Portll', value: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /^name must be a string/);
  assert.match(r.errors[0], /no wildcard-by-omission/);
});

test('a missing directory is an ERROR, never an implicit *', () => {
  const r = parseRule({ include: true, name: 'commitwork', value: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /^directory must be a string/);
});

test('an empty or whitespace-only directory/name is an error naming the field', () => {
  for (const bad of ['', '   ']) {
    const d = parseRule({ include: true, directory: bad, name: 'x' });
    assert.equal(d.ok, false);
    assert.match(d.errors[0], /^directory must not be empty/);
    const n = parseRule({ include: true, directory: 'x', name: bad });
    assert.equal(n.ok, false);
    assert.match(n.errors[0], /^name must not be empty/);
  }
});

test('a non-string directory/name is an error naming the field', () => {
  const r = parseRule({ include: true, directory: 3, name: ['a'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.split(' ')[0]), ['directory', 'name']);
});

test('a non-object row is an error rather than a throw', () => {
  for (const bad of [null, undefined, 'Portll', 42, ['Portll', 'commitwork']]) {
    const r = parseRule(bad);
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /^row must be an object/);
  }
});

test('every error for a row is reported at once, not just the first', () => {
  const r = parseRule({ include: 'yes' });
  assert.equal(r.errors.length, 3);
});

test('parseRules names the row index in the error and keeps index alignment', () => {
  const rows = [
    rule(true, 'Portll', 'commitwork', 1),
    { include: true, directory: 'Portll' },
    rule(false, '*', '*', 2),
  ];
  const got = parseRules(rows);
  assert.equal(got.ok, false);
  assert.equal(got.errors.length, 1);
  assert.equal(got.errors[0].index, 1);
  assert.match(got.errors[0].errors[0], /^row 1: name must be a string/);
  assert.equal(got.rules.length, 3, 'a bad row keeps its slot so later indexes do not shift');
  assert.equal(got.rules[1], null);
  assert.equal(got.rules[2].value, 2);
});

test('parseRules on all-good rows is ok and trims the fields', () => {
  const got = parseRules([{ include: true, directory: ' Portll ', name: ' commitwork ', value: 5 }]);
  assert.equal(got.ok, true);
  assert.deepEqual(got.errors, []);
  assert.deepEqual(got.rules, [{ include: true, directory: 'Portll', name: 'commitwork', value: 5 }]);
});

test('parseRules on a non-array is not ok and never throws', () => {
  const got = parseRules(null);
  assert.equal(got.ok, false);
  assert.deepEqual(got.rules, []);
});

test('an invalid rule NEVER matches at resolve time either, even if parse was skipped', () => {
  // fail closed: a hand-built row with no name must not reach every repo.
  const rules = [{ include: true, directory: 'Portll', value: 'reached-the-fleet' }];
  assert.equal(resolveFor(target, { rules, fallback: 'G' }).source, 'fallback');
  assert.equal(resolveFor(target, { rules: [null], fallback: 'G' }).source, 'fallback');
  assert.equal(resolveFor(target, { rules: parseRules(rules).rules, fallback: 'G' }).source, 'fallback');
});

test('a malformed target is its own state, not a silent fallback', () => {
  const rules = [rule(true, '*', '*', 'global')];
  assert.deepEqual(resolveFor(null, { rules, fallback: 'G' }), {
    value: null, source: 'invalid-target', ruleIndex: null, matchedBy: null,
  });
  assert.equal(resolveFor('commitwork', { rules, fallback: 'G' }).source, 'invalid-target');
});

test('* matches an absent target field but an exact literal does not', () => {
  assert.equal(resolveFor({ name: 'commitwork' }, { rules: [rule(true, '*', 'commitwork', 1)], fallback: 'G' }).value, 1);
  assert.equal(resolveFor({ name: 'commitwork' }, { rules: [rule(true, 'Portll', 'commitwork', 1)], fallback: 'G' }).source, 'fallback');
});

// --- explain ---------------------------------------------------------------------------------

test('explain returns one entry per rule, in table order, with the rule attached', () => {
  const rules = [rule(true, 'Other', 'x', 1), rule(true, '*', '*', 2), rule(true, 'Nope', 'y', 3)];
  const rows = explain(target, { rules, fallback: 'G' });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.index), [0, 1, 2]);
  assert.equal(rows[1].rule, rules[1]);
});

test('explain is truthful for rules AFTER the winner, and marks exactly one winner', () => {
  const rules = [rule(true, '*', '*', 'broad'), rule(true, 'Portll', 'commitwork', 'exact'), rule(true, 'Other', 'z', 'no')];
  const rows = explain(target, { rules, fallback: 'G' });
  assert.deepEqual(rows.map((r) => r.matched), [true, true, false]);
  assert.deepEqual(rows.map((r) => r.winner), [false, true, false]);
  assert.match(rows[0].why, /overridden by rule #1/);
  assert.match(rows[1].why, /WINS/);
  assert.match(rows[2].why, /no match — directory 'Other'/);
});

test("explain's winner agrees with resolveFor's ruleIndex", () => {
  const rules = [rule(true, 'Portll', '*', 1), rule(false, '*', 'commitwork', 2), rule(true, 'Other', 'x', 3)];
  const decided = resolveFor(target, { rules, fallback: 'G' });
  const winners = explain(target, { rules, fallback: 'G' }).filter((r) => r.winner);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].index, decided.ruleIndex);
  assert.match(winners[0].why, /EXCLUDED/);
});

test('explain marks no winner when nothing matched', () => {
  const rules = [rule(true, 'Other', 'x', 1)];
  const rows = explain(target, { rules, fallback: 'G' });
  assert.deepEqual(rows.map((r) => r.winner), [false]);
  assert.deepEqual(rows.map((r) => r.matched), [false]);
});

test('explain says why an invalid rule was skipped rather than pretending it did not match', () => {
  const rows = explain(target, { rules: [{ include: true, directory: 'Portll' }], fallback: 'G' });
  assert.equal(rows[0].matched, false);
  assert.match(rows[0].why, /invalid rule/);
  assert.match(rows[0].why, /name must be a string/);
});

test('explain on a malformed target reports the target, not a per-rule mismatch', () => {
  const rows = explain(undefined, { rules: [rule(true, '*', '*', 1)], fallback: 'G' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].matched, false);
  assert.match(rows[0].why, /not evaluated — target must be an object/);
});

// --- serialisation ---------------------------------------------------------------------------

test('rulesToRows/rowsToRules round-trip losslessly, including * and exclude rules', () => {
  const rules = [
    rule(true, 'Portll', 'commitwork', { threshold: 5 }),
    rule(true, '*', 'commitwork', 'any-directory'),
    rule(true, 'Portll', '*', 'any-name'),
    rule(false, '*', '*', null),
    rule(true, 'Portll', 'internal-d', undefined),
  ];
  assert.deepEqual(rowsToRules(rulesToRows(rules)), rules);
  assert.deepEqual(rulesToRows(rowsToRules(rulesToRows(rules))), rulesToRows(rules));
});

test('a round-tripped rule set resolves identically', () => {
  const rules = [rule(true, '*', '*', 'g'), rule(false, 'Portll', 'commitwork', null)];
  assert.deepEqual(
    resolveFor(target, { rules: rowsToRules(rulesToRows(rules)), fallback: 'F' }),
    resolveFor(target, { rules, fallback: 'F' }),
  );
});

test('rows carry exactly the four columns and drop anything else', () => {
  const rows = rulesToRows([{ include: true, directory: 'Portll', name: 'commitwork', value: 1, stray: 'x' }]);
  assert.deepEqual(Object.keys(rows[0]), ['include', 'directory', 'name', 'value']);
  assert.equal('stray' in rows[0], false);
});

test('serialisers tolerate a non-array without throwing', () => {
  assert.deepEqual(rulesToRows(undefined), []);
  assert.deepEqual(rowsToRules(null), []);
});

test('a parsed row round-trips through the serialisers and back through parseRule', () => {
  const parsed = parseRule({ include: false, directory: ' Portll ', name: '*', value: 3 });
  assert.equal(parsed.ok, true);
  const back = parseRule(rowsToRules(rulesToRows([parsed.rule]))[0]);
  assert.equal(back.ok, true);
  assert.deepEqual(back.rule, parsed.rule);
});

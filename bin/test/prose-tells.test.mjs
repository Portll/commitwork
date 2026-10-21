import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tells, formatTells, SURFACES } from '../lib/prose-tells.mjs';

const ids = (text, surface = 'commit') => tells(text, surface).map((t) => t.id);

describe('positive controls: each tell fires on its own example', () => {
  const cases = [
    ['em-dash', 'the gate refuses — nothing is staged'],
    ['em-dash', 'the gate refuses -- nothing is staged'],
    ['em-dash', 'the gate refuses - nothing is staged'],
    ['so-glue', 'HEAD moved, so the land is refused'],
    ['just', 'it is just a wrapper'],
    ['mental-state', 'the file is deliberately empty'],
    ['hedge', 'this may potentially help'],
    ['hedge', 'it works in some cases'],
    ['shout', 'BOTH BLOBS ARE NAMED in the refusal'],
    ['session-name', 'found by commitwork-00 on the same day'],
    ['session-name', 'the sync/cw33 branch'],
    ['banned-word', 'leverage the existing parser'],
    ['land', 'the fix landed on main'],
    ['shape', 'the shape of the data changed'],
    ['meta', 'it is worth noting that the parser is lazy'],
    ['meta', 'which is why the gate reads HEAD'],
    ['not-x-but-y', "it isn't just a treaty, but a rule"],
  ];
  for (const [id, text] of cases) {
    test(`${id}: "${text}"`, () => assert.ok(ids(text).includes(id), `expected ${id}, got ${JSON.stringify(ids(text))}`));
  }
});

describe('negative controls: plain sentences pass', () => {
  const clean = [
    'commit-phase refuses a subject over 72 characters.',
    'The parser reads HEAD. It never reads the working tree.',
    'A landing page is served from docsite/.',
    'so that the ledger stays readable',
    'HEAD and NUL are two acronyms.',
    'the row shape is an actual tensor shape here',
    'Refs: D19 item 5',
  ];
  for (const text of clean) {
    test(`clean: "${text}"`, () => assert.deepEqual(ids(text), [], `false positive: ${JSON.stringify(tells(text, 'commit'))}`));
  }
});

describe('surfaces', () => {
  test('comment surface also refuses dates, history and because', () => {
    assert.ok(ids('measured on 2026-09-06 by the operator', 'comment').includes('date'));
    assert.ok(ids('found by a session last week', 'comment').includes('history'));
    assert.ok(ids('reads HEAD because the tree is dirty', 'comment').includes('because'));
    assert.ok(ids('fact: reads HEAD: the tree is dirty: always', 'comment').includes('explain-colon'));
  });
  test('the old trailer is one finding; its colons and dates do not fire on their own', () => {
    const found = ids('fact: reads HEAD at call time (expiry: never, prev: 2026-01-01 broken)', 'comment');
    assert.deepEqual(found, ['trailer']);
  });
  test('the commit surface allows a dated measurement in the body', () => {
    assert.deepEqual(ids('Measured 2026-09-06: 34 lines, then 40.'), []);
  });
  test('an unknown surface throws rather than scanning with no rules', () => {
    assert.throws(() => tells('x', 'prose'), /unknown surface/);
    assert.deepEqual(SURFACES, ['comment', 'commit']);
  });
});

describe('skips', () => {
  test('footer lines are not scanned on the commit surface', () => {
    assert.deepEqual(ids('feat: x\n\nbody\n\nRefs: landed — just so'), []);
  });
  test('the subject line is scanned even when it looks like a footer', () => {
    assert.ok(ids('fix: it just landed').length > 0);
  });
  test('fenced code is skipped', () => {
    assert.deepEqual(ids('feat: x\n\n```\nthe fix landed — just so\n```\n'), []);
  });
  test('every finding carries a line, a match and a reason, and formats', () => {
    const f = tells('one\ntwo — three', 'commit');
    assert.equal(f[0].line, 2);
    assert.equal(f[0].match, '—');
    assert.match(formatTells(f), /line 2 \[em-dash\]/);
  });
});

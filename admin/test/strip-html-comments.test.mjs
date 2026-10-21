// admin/lib/core.mjs stripHtmlComments — a sanitizer must not emit the token it strips.
// Covers js/bad-tag-filter + js/incomplete-multi-character-sanitization: `--!>` also terminates a
// comment, and a single pass can splice neighbours into a new `<!--`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtmlComments } from '../lib/core.mjs';

const DIRTY = /<!--|--!?>/;

describe('stripHtmlComments reaches a fixed point', () => {
  test('the splice case that manufactured a comment opener', () => {
    // A browser reads "<<!--!--" as text "<" plus a comment to end-of-input — match that, and
    // assert no marker survives rather than merely a shorter string.
    assert.equal(stripHtmlComments('<<!--!--'), '<');
    assert.ok(!DIRTY.test(stripHtmlComments('<<!--!--')));
    assert.ok(!DIRTY.test(stripHtmlComments('<<<!--!--!--')));
  });

  test('comments do not nest — the FIRST terminator closes, as in HTML', () => {
    // Disagreeing with the browser's parse is how a sanitizer passes something the page reads differently.
    assert.equal(stripHtmlComments('<!--a<!--b-->c'), 'c');
    assert.equal(stripHtmlComments('<!--a-->b<!--c-->'), 'b');
  });

  test('--!> terminates a comment as surely as -->', () => {
    assert.equal(stripHtmlComments('<!--x--!>evil'), 'evil');
    assert.equal(stripHtmlComments('<!--x-->evil'), 'evil');
  });

  test('output never contains a comment marker of either spelling', () => {
    const probes = [
      '<<!--!--', '<!--x--!>evil', '<!--<!--x-->', '<!--a-->b<!--c-->', '<!--', '-->', '--!>',
      '<!--<!--<!--', '--!>--!>', '<!--unterminated', 'a<!--b--!>c-->d',
    ];
    for (const p of probes) {
      const out = stripHtmlComments(p);
      assert.ok(!DIRTY.test(out), `${JSON.stringify(p)} -> ${JSON.stringify(out)} still carries a marker`);
    }
  });

  test('it is IDEMPOTENT — running it twice changes nothing', () => {
    // The defect was precisely that one pass was not a fixed point.
    for (const p of ['<<!--!--', 'a<!--b--!>c-->d', '<!--<!--x-->', 'plain']) {
      const once = stripHtmlComments(p);
      assert.equal(stripHtmlComments(once), once, `not idempotent for ${JSON.stringify(p)}`);
    }
  });

  test('ordinary titles are untouched — the strip must not eat real content', () => {
    for (const p of [
      'chore(deps): bump vitest from 2.1.8 to 2.1.9',
      'fix: handle a > b and a < b',
      'Update dependency @scope/pkg to v3',
      '',
    ]) assert.equal(stripHtmlComments(p), p);
  });

  test('null and undefined become the empty string, never the literal "null"', () => {
    assert.equal(stripHtmlComments(null), '');
    assert.equal(stripHtmlComments(undefined), '');
  });

  test('adversarial nesting terminates and leaks no marker', () => {
    // Termination is structural (the index only advances); leftover `-->` runs come back escaped.
    const deep = `${'<!--'.repeat(5000)}x${'-->'.repeat(5000)}`;
    const out = stripHtmlComments(deep);
    assert.ok(!DIRTY.test(out), 'no raw marker may survive');
    assert.ok(out.includes('&gt;'), 'the survivors are escaped, not deleted');
    const ragged = '<'.repeat(2000) + '<!--!--'.repeat(500);
    assert.ok(!DIRTY.test(stripHtmlComments(ragged)));
  });

  test('the final guard escapes rather than returns a marker it could not remove', () => {
    // "Should be unreachable" by construction — but a stray `-->` in ordinary text reaches it today.
    const out = stripHtmlComments('a<!--b--!>c-->d');
    assert.equal(out, 'ac--&gt;d');
    assert.ok(!DIRTY.test(out));
  });
});

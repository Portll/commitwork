// hunk-locate — a session's recorded edits found in the current text by fingerprint, and each diff
// hunk assigned one of FOUR states. The state that must never collapse is `unmatched`: it is not
// theirs and not mine, and stage-mine leaves it alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHunks, locate, assign, applyHunks } from '../lib/hunk-locate.mjs';

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
// Twenty lines, edits at 3 and 17: with -U3 context, edits closer than seven lines apart merge
// into ONE hunk (git joins hunks whose context touches), and this suite needs two.
const BASE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

/** A real `git diff -U3` between two texts, so parseHunks sees git's own output. */
function gitDiff(t, before, after) {
  const d = mkdtempSync(join(tmpdir(), 'cw-hunk-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'a'), before); writeFileSync(join(d, 'b'), after);
  try { return execFileSync('git', ['diff', '--no-index', '-U3', '--', join(d, 'a'), join(d, 'b')], { encoding: 'utf8' }); }
  catch (e) { return e.stdout; }
}

test('parseHunks: git output → hunks with old/new coordinates and the changed new-side range', (t) => {
  const after = BASE.replace('line 3', 'line 3 edited').replace('line 17', 'line 17 edited');
  const hunks = parseHunks(gitDiff(t, BASE, after));
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0].changedNew, [3, 3]);
  assert.deepEqual(hunks[1].changedNew, [17, 17]);
  assert.equal(hunks[0].oldStart, 1);
});

test('locate: an Edit whose new_string carried context lines is found as a window, and assigned to its session', (t) => {
  const after = BASE.replace('line 3', 'line 3 edited').replace('line 17', 'line 17 edited');
  const hunks = parseHunks(gitDiff(t, BASE, after));
  // Session A's Edit replaced "line 2\nline 3\nline 4" with the edited run; B edited line 9 alone.
  const claims = [{ n: fp('line 2\nline 3 edited\nline 4'), s: 'aaaaaaaa' }, { n: fp('line 17 edited'), s: 'bbbbbbbb' }];
  const loc = locate(after, hunks, claims);
  assert.equal(loc.searched, true);
  assert.deepEqual(loc.located.map((l) => [l.s, ...l.range]), [['aaaaaaaa', 2, 4], ['bbbbbbbb', 17, 17]]);
  const a = assign(hunks, loc.located, 'aaaaaaaa');
  assert.deepEqual(a.map((x) => x.state), ['mine', 'theirs']);
  assert.deepEqual(a[1].others, ['bbbbbbbb']);
});

test('a hunk nobody\'s fingerprint covers is UNMATCHED — never theirs, never mine', (t) => {
  const after = BASE.replace('line 3', 'line 3 edited').replace('line 17', 'line 17 edited');
  const hunks = parseHunks(gitDiff(t, BASE, after));
  const loc = locate(after, hunks, [{ n: fp('line 3 edited'), s: 'aaaaaaaa' }]);
  const a = assign(hunks, loc.located, 'aaaaaaaa');
  assert.deepEqual(a.map((x) => x.state), ['mine', 'unmatched']);
});

test('two sessions covering one hunk is SHARED; a Write is located as the whole file', (t) => {
  const after = BASE.replace('line 3', 'line 3 edited');
  const hunks = parseHunks(gitDiff(t, BASE, after));
  const shared = assign(hunks, locate(after, hunks, [{ n: fp('line 3 edited'), s: 'a' }, { n: fp('line 2\nline 3 edited'), s: 'b' }]).located, 'a');
  assert.equal(shared[0].state, 'shared');
  const whole = locate(after, hunks, [{ n: fp(after), s: 'w' }]);
  assert.deepEqual(whole.located[0].range, [1, after.split('\n').length]);
  assert.equal(whole.located[0].whole, true);
});

test('the window cap makes the search say it did not finish rather than return a partial answer as complete', (t) => {
  const after = BASE.replace('line 3', 'line 3 edited');
  const hunks = parseHunks(gitDiff(t, BASE, after));
  const loc = locate(after, hunks, [{ n: 'nope00000000', s: 'a' }], { maxWindows: 3 });
  assert.equal(loc.searched, false);
});

test('applyHunks: applying only MY hunk to HEAD yields HEAD plus my change and none of theirs', (t) => {
  const after = BASE.replace('line 3', 'line 3 edited').replace('line 17', 'line 17 edited');
  const hunks = parseHunks(gitDiff(t, BASE, after));
  const mineOnly = applyHunks(BASE, [hunks[0]]);
  assert.equal(mineOnly, BASE.replace('line 3', 'line 3 edited'));
  assert.equal(applyHunks(BASE, hunks), after, 'all hunks reproduce the working tree exactly');
  assert.equal(applyHunks(BASE, []), BASE);
  // An insertion at the top and a deletion at the bottom, applied together.
  const ins = `line 0\n${BASE}`.replace('line 20\n', '');
  const h2 = parseHunks(gitDiff(t, BASE, ins));
  assert.equal(applyHunks(BASE, h2), ins);
});

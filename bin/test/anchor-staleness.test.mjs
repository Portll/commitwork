// bin/anchor-staleness.mjs — does a finding still point at the code it was written about?
// Classification is tested against SYNTHETIC content, so these assertions stay true as the tree
// keeps moving.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, hashLine, checkQueue, STATES, DRIFTED, HOME_PLACEHOLDER, redactHome, gitShow } from '../anchor-staleness.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const at = (line) => ({ file: 'x.mjs', line });
const doc = (...lines) => lines.join('\n');

test('an untouched line is unchanged — the only state that is safe to schedule', () => {
  const src = doc('const a = 1;', 'const b = 2;', 'const c = 3;');
  const r = classify(at(2), src, src);
  assert.equal(r.state, STATES.UNCHANGED);
  assert.equal(r.nowLine, 2);
  assert.equal(r.anchorHash, hashLine('const b = 2;'));
});

test('indentation-only churn does NOT count as drift', () => {
  // an alarm that fires on formatting is one nobody reads
  const before = doc('a', '  const b = 2;', 'c');
  const after = doc('a', '      const b = 2;', 'c');
  assert.equal(classify(at(2), before, after).state, STATES.UNCHANGED);
});

test('a line that shifted position is MOVED, and reports where it went', () => {
  const before = doc('const a = 1;', 'const target = 42;', 'const c = 3;');
  const after = doc('// a new header comment', 'const a = 1;', 'const target = 42;', 'const c = 3;');
  const r = classify(at(2), before, after);
  assert.equal(r.state, STATES.MOVED);
  assert.equal(r.nowLine, 3);
  assert.equal(r.delta, 1);
  assert.equal(DRIFTED.has(r.state), false, 'a moved anchor is bookkeeping, not a re-read');
});

test('a rewritten line is CHANGED and carries both texts, so a human can judge in one glance', () => {
  const before = doc('a', 'prowler ... || true', 'c');
  const after = doc('a', 'prowler ...; rc=$?', 'c');
  const r = classify(at(2), before, after);
  assert.equal(r.state, STATES.CHANGED);
  assert.match(r.wasText, /\|\| true/);
  assert.match(r.nowText, /rc=\$\?/);
  assert.equal(DRIFTED.has(r.state), true, 'a changed anchor MUST force a re-read');
});

test('a blank line never reports as moved — every blank line matches every other', () => {
  // short lines match promiscuously — "moved to line 97" for a blank line is confident nonsense
  const before = doc('a', '', 'c');
  const after = doc('a', 'x', '', 'c');
  assert.equal(classify(at(2), before, after).state, STATES.CHANGED);
});

test('a truncated file yields anchor-gone, not a false unchanged', () => {
  assert.equal(classify(at(9), doc('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'), doc('a', 'b')).state, STATES.GONE);
});

test('a deleted file and an absent baseline are DIFFERENT states', () => {
  // "no baseline" means written against an untracked tree and never diffable; "deleted" means real drift
  assert.equal(classify(at(1), doc('a'), null).state, STATES.FILE_DELETED);
  assert.equal(classify(at(1), null, doc('a')).state, STATES.NO_BASELINE);
  assert.equal(DRIFTED.has(STATES.FILE_DELETED), true);
  assert.equal(DRIFTED.has(STATES.NO_BASELINE), false, 'un-diffable is not the same as drifted');
});

test('an entry with no usable anchor is reported, never silently skipped', () => {
  assert.equal(classify({ file: null, line: 0 }, doc('a'), doc('a')).state, STATES.NO_ANCHOR);
  assert.equal(classify({ file: 'x', line: NaN }, doc('a'), doc('a')).state, STATES.NO_ANCHOR);
});

test('THE GATE counts only OPEN entries — fixing a finding must not fail its own check', () => {
  // a fixed entry whose line changed is the expected outcome of fixing it
  const q = {
    queue: [
      { id: '1', anchor: 'a.mjs:1', file: 'a.mjs', line: 1, severity: 'high', disposition: 'open', summary: 's' },
      { id: '2', anchor: 'a.mjs:1', file: 'a.mjs', line: 1, severity: 'high', disposition: 'fixed', summary: 's' },
    ],
  };
  // Both anchors are equally drifted (the file does not exist on disk), but only the open one gates.
  const r = checkQueue(q, { baseline: 'HEAD' });
  assert.equal(r.checked, 2);
  assert.equal(r.driftedOpen.length <= 1, true, 'a fixed entry must never appear in the gate');
  for (const d of r.driftedOpen) assert.equal(d.disposition, 'open');
});

test('a pin into another file is judged in that file; the identity file is not read', () => {
  // The code moved: the finding keeps its identity file, its anchor lives in anchorFile.
  const moved = { id: 'm', file: 'no/such/identity.mjs', anchorFile: 'bin/anchor-staleness.mjs', line: 1,
    verifiedAtHead: 'HEAD', severity: 'low', disposition: 'open', summary: 's' };
  const r = checkQueue({ queue: [moved] }, { baseline: 'HEAD' });
  assert.equal(r.results[0].file, 'bin/anchor-staleness.mjs');
  assert.equal(r.results[0].state, STATES.UNCHANGED);
  const unpinned = { ...moved, anchorFile: undefined };
  assert.notEqual(checkQueue({ queue: [unpinned] }, { baseline: 'HEAD' }).results[0].state, STATES.UNCHANGED,
    'without anchorFile the missing identity file must not read as unchanged');
});

test('--only-open narrows what is checked without changing how it is judged', () => {
  const q = {
    queue: [
      { id: '1', anchor: 'a.mjs:1', file: 'a.mjs', line: 1, severity: 'high', disposition: 'open', summary: 's' },
      { id: '2', anchor: 'a.mjs:1', file: 'a.mjs', line: 1, severity: 'low', disposition: 'refuted', summary: 's' },
    ],
  };
  assert.equal(checkQueue(q, { baseline: 'HEAD' }).checked, 2);
  assert.equal(checkQueue(q, { baseline: 'HEAD', onlyOpen: true }).checked, 1);
});

// ── reverify-comment-only ──────────────────────────────────────────────────────────────────────
import { reverifyCommentOnly } from '../anchor-staleness.mjs';

const rev = (queueEntries, oldSrc, newSrc) => {
  const queue = { queue: queueEntries };
  const results = queueEntries.map((e) => ({ id: e.id, state: STATES.CHANGED }));
  const { n } = reverifyCommentOnly(queue, results, 'abc1234', {
    baseline: 'BASE', readCur: () => newSrc, readOld: () => oldSrc,
  });
  return { n, queue };
};

test('reverify: a trailing-comment trim re-verifies to the unique code-identical line', () => {
  const { n, queue } = rev(
    [{ id: 'F1', file: 'x.mjs', line: 2, anchor: 'x.mjs:2' }],
    doc('const a = 1;', 'const b = readStore(p);   // fail closed: only ENOENT is absence, and…', 'const c = 3;'),
    doc('// header', 'const a = 1;', 'const b = readStore(p);   // fail closed', 'const c = 3;'),
  );
  assert.equal(n, 1);
  const e = queue.queue[0];
  assert.equal(e.line, 3);
  assert.equal(e.verifiedAtHead, 'abc1234');
  assert.match(e.reverified.basis, /comment-only/);
  assert.equal(e.reverified.fromLine, 2);
});

test('reverify: genuinely changed code stays flagged — never converted to fine', () => {
  const { n, queue } = rev(
    [{ id: 'F1', file: 'x.mjs', line: 1, anchor: 'x.mjs:1' }],
    doc('const key = `${ref}\\0${file}`; // keyed'),
    doc('const key = `${ref} ${file}`; // keyed'),
  );
  assert.equal(n, 0);
  assert.equal(queue.queue[0].line, 1);
  assert.equal(queue.queue[0].reverified, undefined);
});

test('reverify: an ambiguous match (two code-identical lines) stays flagged', () => {
  const { n } = rev(
    [{ id: 'F1', file: 'x.mjs', line: 1 }],
    doc('emit(rows);   // sorted'),
    doc('emit(rows);', 'emit(rows);'),
  );
  assert.equal(n, 0);
});

test('reverify: near-blank code never matches — a brace is not an identity', () => {
  const { n } = rev(
    [{ id: 'F1', file: 'x.mjs', line: 1 }],
    doc('}   // end of the long story'),
    doc('}', 'x;', '}'),
  );
  assert.equal(n, 0);
});

// ── FourEyes findings: duplicate-blind MOVED, and `//` inside a string ─────────────────────────
test('an edited line whose twin sits elsewhere is CHANGED, not moved to the twin', () => {
  const was = doc('const x = compute(a);', 'noop();', 'const x = compute(a);');
  const now = doc('const x = compute(a);', 'noop();', 'const x = compute(b);');
  const r = classify(at(3), was, now);
  assert.equal(r.state, STATES.CHANGED, 'a duplicate must not absorb an edit as bookkeeping');
  assert.equal(r.ambiguous, true);
});

test('a genuinely unique move is still MOVED', () => {
  const was = doc('a();', 'const unique = veryDistinctThing(q);');
  const now = doc('// added', 'a();', 'const unique = veryDistinctThing(q);');
  assert.equal(classify(at(2), was, now).state, STATES.MOVED);
});

test('reverify: a URL changed after // inside a string is NOT comment-only', () => {
  const { n } = rev(
    [{ id: 'F1', file: 'x.mjs', line: 1 }],
    doc("await fetch('https://good.example/report');   // posts the receipt"),
    doc("await fetch('https://evil.example/report');   // posts the receipt"),
  );
  assert.equal(n, 0, 'the `//` in a URL is not a comment delimiter');
});

test('reverify: a real trailing-comment trim beside a string literal still re-verifies', () => {
  const { n, queue } = rev(
    [{ id: 'F1', file: 'x.mjs', line: 1 }],
    doc("await fetch('https://good.example/x');   // the long story of why this endpoint"),
    doc('// spacer', "await fetch('https://good.example/x');   // posts the receipt"),
  );
  assert.equal(n, 1);
  assert.equal(queue.queue[0].line, 2);
});

// ── per-file dirty scoping ─────────────────────────────────────────────────────────────────────
// Both re-pin operations used to refuse whenever ANY file in the tree was dirty. The hazard is
// real — re-pinning writes verifiedAtHead=HEAD while the new line was read from the working tree —
// but it is per file, and asking the whole-tree question made the operations unrunnable on a repo
// that always has a dozen sessions mid-edit. The queue held 57 re-anchorable entries that the tool
// was forbidden to touch; scoping to the anchored file let 46 through and correctly held 11 back.
//
// The FIRST test is the one that matters: it is the case the old rule got wrong. An entry in a
// clean file must be re-pinned even though a different file is dirty. A test that only checked
// "dirty files are skipped" would pass against a whole-tree refusal too, and prove nothing.
import { reanchor } from '../anchor-staleness.mjs';

const movedQueue = () => ({ queue: [
  { id: 'A', file: 'clean.mjs', line: 10, anchor: 'clean.mjs:10', verifiedAtHead: 'old111' },
  { id: 'B', file: 'dirty.mjs', line: 20, anchor: 'dirty.mjs:20', verifiedAtHead: 'old111' },
] });
const movedResults = [
  { id: 'A', state: STATES.MOVED, nowLine: 14, anchorHash: 'ha', verifiedAtHead: 'old111' },
  { id: 'B', state: STATES.MOVED, nowLine: 24, anchorHash: 'hb', verifiedAtHead: 'old111' },
];

test('an entry in a CLEAN file is re-pinned even while another file is dirty', () => {
  const queue = movedQueue();
  const { n, skipped } = reanchor(queue, movedResults, 'new222', { skipFiles: new Set(['dirty.mjs']) });
  assert.equal(n, 1);
  const a = queue.queue.find((e) => e.id === 'A');
  assert.equal(a.line, 14);
  assert.equal(a.anchor, 'clean.mjs:14');
  // Both halves move together, or the line names one tree and the comparison reads another.
  assert.equal(a.verifiedAtHead, 'new222');
  assert.equal(a.reanchor.delta, 4);
  assert.equal(skipped.length, 1);
});

test('an entry in a DIRTY file is left exactly as it was — and is NAMED, not silently dropped', () => {
  const queue = movedQueue();
  const { skipped } = reanchor(queue, movedResults, 'new222', { skipFiles: new Set(['dirty.mjs']) });
  const b = queue.queue.find((e) => e.id === 'B');
  assert.equal(b.line, 20, 'a skipped entry must keep its old line');
  assert.equal(b.verifiedAtHead, 'old111', 'and its old ref — a half-applied re-pin is worse than none');
  assert.equal(b.reanchor, undefined);
  // A skipped entry stays drifted and will be re-reported, so the operator has to see WHICH.
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /dirty\.mjs:20/);
  assert.match(skipped[0], /\bB\b/);
});

test('no skipFiles means no scoping — --force keeps its old all-in behaviour', () => {
  const queue = movedQueue();
  const { n, skipped } = reanchor(queue, movedResults, 'new222');
  assert.equal(n, 2);
  assert.deepEqual(skipped, []);
});

test('a MOVED entry already at its new line is not counted as work, dirty or not', () => {
  // Guards the idempotence the house invariant asks for: re-running must not churn the queue or
  // inflate the count with entries that did not move.
  const queue = { queue: [{ id: 'A', file: 'clean.mjs', line: 14, anchor: 'clean.mjs:14' }] };
  const { n } = reanchor(queue, [{ id: 'A', state: STATES.MOVED, nowLine: 14 }], 'new222');
  assert.equal(n, 0);
});

// A quoted source line is content: a home directory in it carried a user's name into the generated
// report, past every scrub, because the generator re-emits it on each run (2026-09-09).
test('excerpts normalise a home directory to the placeholder; the anchor hash is over the raw line', () => {
  const before = doc('a', "const CLONES = '/Users/someone/Repositories/x/clones';", 'c');
  const after = doc('a', "const CLONES = process.env.CLONES;", 'c');
  const r = classify(at(2), before, after);
  assert.equal(r.state, STATES.CHANGED);
  assert.equal(r.wasText, `const CLONES = '${HOME_PLACEHOLDER}Repositories/x/clones';`);
  assert.doesNotMatch(r.wasText, /someone/);
  assert.equal(r.anchorHash, hashLine("const CLONES = '/Users/someone/Repositories/x/clones';"), 'identity unchanged by the excerpt');
  assert.equal(redactHome('/Users/a/x and /Users/b-c.d/y'), '/Users/username/x and /Users/username/y');
  assert.equal(redactHome('/Users/'), '/Users/', 'a bare prefix is not a home directory');
});

// A finding re-anchored into a private record names a commit of the sidecar repository behind
// monitor/private, not of this one; asked of the wrong repository it reads as no-baseline, which
// sits outside the drift gate.
test('a monitor/private anchor reads its baseline from the repository the private dir links into', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-anchor-private-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const side = join(d, 'sidecar');
  mkdirSync(join(side, 'records'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: side, encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(side, 'records', 'owner-map.json'), '{\n  "a": 1\n}\n');
  git('add', '.'); git('commit', '-q', '-m', 'seed');
  const sha = git('rev-parse', 'HEAD');
  const root = join(d, 'checkout');
  mkdirSync(join(root, 'monitor'), { recursive: true });
  symlinkSync(join(side, 'records'), join(root, 'monitor', 'private'), 'dir');
  assert.equal(gitShow(sha, 'monitor/private/owner-map.json', root), '{\n  "a": 1\n}\n');
  rmSync(join(side, 'records', 'owner-map.json'));
  assert.equal(gitShow(sha, 'monitor/private/owner-map.json', root), '{\n  "a": 1\n}\n', 'a record deleted since still has its baseline');
  assert.equal(gitShow(sha, 'monitor/other.json', root), null, 'a public path is not looked up in the sidecar');
});

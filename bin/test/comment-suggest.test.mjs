// fact: every case asserts the suggester meets its OWN bar — a draft it produces must not be slop, and a block it cannot fix honestly must say so rather than gut it (expiry: never, prev: not built)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestFile, structured } from '../comment-suggest.mjs';
import { scanFile, FACT_RE, MAX_RUN } from '../comment-schema.mjs';

const src = (lines) => lines.join('\n') + '\nexport const x = 1;\n';
const strip = (arr) => arr.map((l) => l.replace(/^\/\/\s?/, ''));

// Seven lines of flat prose — none carries a counterfactual (no because/so/never/would/…).
const PROSE = [
  '// The widget registry holds one entry per colour in the palette.',
  '// Each entry pairs a label with a hex value and an index.',
  '// The labels are sorted for display in the sidebar panel.',
  '// Sizes are stored in points and converted at render time.',
  '// The index increments as entries are appended to the array.',
  '// Older entries keep their position when the list is redrawn.',
  '// A snapshot is written each time the panel reloads its data.',
];
// A numbered list — collapsing it would reorder or drop items, and the splitter orphans ordinals.
const STEPS = [
  '// Steps to reproduce:',
  '//  1. open the panel',
  '//  2. click the tab',
  '//  3. observe the count',
  '//  4. reload the page',
  '//  5. compare the number',
  '//  6. file the result',
];
// Draftable: at least one sentence carries a counterfactual, and it is not a list.
const CAUSAL = [
  '// The resolver reads the env at call time because a module-load read',
  '// would freeze the value and defeat the override the tests rely on.',
  '// The same rule holds for the baseline path and the clock.',
  '// A const at import is the shape that passes while proving nothing.',
  '// Reading late keeps every override reachable from a test.',
  '// The cost is one function call on a path nobody measures.',
  '// Nothing here caches the value between reads.',
];

test('a block whose sentences carry no counterfactual is a VOID, not a gutted one-liner', () => {
  const s = suggestFile('a.mjs', src(PROSE))[0];
  assert.equal(s.void, true, 'no counterfactual ⇒ no machine draft');
  assert.equal(s.keptCount, 0);
  assert.deepEqual(s.after, [], 'it must not emit a <placeholder> line');
  assert.equal(s.saved, 0, 'a block it cannot fix saves nothing');
  assert.match(s.reason, /counterfactual/);
});

test('a list block is a VOID — the splitter would orphan its ordinals', () => {
  assert.equal(structured(strip(STEPS)), true);
  const s = suggestFile('a.mjs', src(STEPS))[0];
  assert.equal(s.void, true);
  assert.equal(s.saved, 0);
  assert.match(s.reason, /list|mapping/);
});

test('a draftable block produces schema-shaped fact lines and reports what it drops', () => {
  const s = suggestFile('a.mjs', src(CAUSAL))[0];
  assert.equal(s.void, false);
  assert.ok(s.saved > 0);
  for (const line of s.after) {
    assert.ok(FACT_RE.exec(line.replace(/^\s*\/\/\s?/, '')), `not schema-shaped: ${line}`);
  }
});

test('THE SELF-BAR: a raw draft passes the gate it feeds, and carries no placeholder trailer', () => {
  const s = suggestFile('a.mjs', src(CAUSAL))[0];
  assert.deepEqual(scanFile('a.mjs', `${s.after.join('\n')}\n`).violations, []);
  assert.ok(s.after.every((l) => !/expiry:/.test(l)), 'a comment needs no expiry, so the draft does not ask for one');
});

test('a block at the limit is not a suggestion at all', () => {
  const atLimit = Array.from({ length: MAX_RUN }, (_, i) => `// note ${i}`).join('\n');
  assert.equal(suggestFile('a.mjs', `${atLimit}\nexport const x = 1;\n`).length, 0);
});

test('the original is annotated in place: every line reassembles, and each sentence carries its fate', () => {
  const s = suggestFile('a.mjs', src(CAUSAL))[0];
  assert.equal(s.original.length, CAUSAL.length, 'one annotated row per source line, in source order');
  s.original.forEach((l, n) => {
    assert.equal(l.mark, '//');
    assert.equal(l.segs.map((g) => g.t).join(''), CAUSAL[n].replace(/^\/\/\s?/, ''), `line ${n} must reassemble unchanged`);
  });
  const f1 = new Set(s.original.flatMap((l) => l.segs.map((g) => g.f1)).filter(Boolean));
  assert.deepEqual([...f1].sort(), ['dropped', 'kept']);
  assert.equal(s.tally.f1.kept, s.after.length);
  assert.equal(s.tally.f1.dropped, s.droppedCount);
  assert.equal(s.second.lines.length + (s.tally.f2.dropped || 0) - s.droppedCount, s.after.length);
});

test('a void carries no fate — nothing was drafted to be kept or deleted', () => {
  const s = suggestFile('a.mjs', src(PROSE))[0];
  assert.deepEqual(s.second.lines, []);
  assert.deepEqual(s.tally, { f1: {}, f2: {} });
  assert.ok(s.original.every((l) => l.segs.every((g) => g.f1 === null && g.f2 === null)));
});

test('the row key survives the ordinal changing and follows the text', () => {
  const one = suggestFile('a.mjs', src(CAUSAL))[0];
  const moved = suggestFile('a.mjs', `${src(PROSE)}\n${src(CAUSAL)}`)[1];
  assert.notEqual(moved.ordinal, one.ordinal);
  assert.equal(moved.key, one.key);
});

const block = (lines) => src(lines.map((l) => `// ${l}`));

test('STRUCTURE: quoted-state enumerations, term tables, arrow tables and command lists are voids, not prose', () => {
  const shapes = {
    enumeration: ['Returns a typed record because callers must never guess.', "state: 'ok' | 'absent' | 'unreadable' | 'empty'", 'Only ok carries arrays, so a default never reads as clean.', 'Every other state carries null, never an empty list.', 'The caller decides what absence means, never this reader.', 'ENOENT alone is absence, because a parse failure is not.', 'Nothing here re-detects it.'],
    termTable: ['The states, never red:', 'covered          a counting lane ran and read above the floor', 'grey-unread      a lane ran but read below the floor', 'grey-unscanned   capable lanes exist and none ran', 'void-declared    no lane reads this language', 'Each is published beside its reason.', 'A repo is never judged by this lens.'],
    commands: ['usage, never run from a hook:', 'node codegraph/report.mjs              build the store', 'node codegraph/report.mjs about <p>    exports and importers', 'node codegraph/report.mjs dead         unbound exports', 'The store is read by the MCP tools, never rebuilt by them.', 'Build it once because it takes nine seconds.', 'Nothing else writes it.'],
  };
  for (const [name, lines] of Object.entries(shapes)) {
    const s = suggestFile('a.mjs', block(lines))[0];
    assert.equal(s.void, true, `${name} must be handed to a person`);
  }
});

test('STRUCTURE: a ── banner ── is a heading, not a reason to void the prose under it', () => {
  const s = suggestFile('a.mjs', block(['── detection ─────────────────────────────', ...CAUSAL.map((l) => l.replace(/^\/\/ /, ''))]))[0];
  assert.equal(s.void, false);
  assert.ok(s.after.every((l) => !/─/.test(l)), 'the banner never reaches a draft');
});

test('FACTS: a block of existing fact entries is kept one entry per line, trailers intact', () => {
  const s = suggestFile('a.mjs', block([
    'fact: the save body reader is local / the shared reader caps bodies at 64 KB, and real documents exceed it',
    '  (expiry: if the shared reader grows a size argument, prev: broken)',
    'fact: responses that need extra headers write them with respond() / send() silently drops a 4th',
    '  headers argument (expiry: if send() grows one, prev: broken)',
    'fact: the editor never re-reads the file itself / every caller already has the bytes (expiry: never, prev: not built)',
    'fact: snapshots are pooled apart / one person typing produces fewer, more valuable snapshots (expiry: never, prev: not built)',
    'fact: a refused save leaves the file untouched / a half-written document is worse than none (expiry: never, prev: broken)',
  ]))[0];
  assert.equal(s.void, false);
  assert.equal(s.after.length, 5, 'one line per entry, never one glued line');
  assert.ok(s.after.every((l) => /\(expiry: .+, prev: (broken|not built)\)$/.test(l)), 'every trailer survives the second pass untouched too');
  assert.deepEqual(s.second.lines, s.after);
});

test('ANTECEDENT: a kept sentence that opens with a pronoun keeps the sentence it points at, and the second pass joins them', () => {
  const s = suggestFile('a.mjs', block([
    'The two that license a zero become full; the other two split by whether',
    'the gap was measured or could not be established at all.',
    'That split is not cosmetic, because unknown outranks reduced in aggregation.',
    'The sweep writes both states beside the slice.',
    'The panel reads them from there.',
    'A reader of the slice sees which was which.',
    'Nothing here computes a severity.',
  ]))[0];
  assert.equal(s.void, false);
  assert.ok(s.after.some((l) => /other two split/.test(l)), 'the antecedent is carried into the first pass');
  assert.equal(s.second.lines.filter((l) => /That split|that split/.test(l)).length, 1);
  assert.match(s.second.lines.find((l) => /that split/.test(l)), /established at all.*; that split is not cosmetic/);
});

test('SPLIT: a full stop before a lowercase identifier ends a sentence, and a semicolon does not', () => {
  const s = suggestFile('a.mjs', block([
    'The real key function is injected because a stub that disagrees with the code',
    'would keep passing after the lookup broke. persistSessions is counted, never',
    'stubbed to nothing, so a save that never happens fails the test.',
    'The harness reads the env at call time; the override is never frozen.',
    'Each test owns its own directory.',
    'Nothing is shared between them.',
    'The clock is fixed by CW_NOW.',
  ]))[0];
  assert.ok(s.after.some((l) => /fact: persistSessions is counted/.test(l)), 'the lowercase identifier opens its own claim');
  assert.ok(s.after.some((l) => /call time; the override is never frozen/.test(l)), 'a semicolon keeps both halves in one claim');
});

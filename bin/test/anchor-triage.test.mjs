// pins: triage GROUPS, never dispositions - -S proves a line left the tree, not that the defect did.
// git is injected so these never touch the live tree, whose HEAD moves between runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStaleness, commitsTouching, triage, searchFragments } from '../anchor-triage.mjs';

const row = (o) => ({ state: 'anchor-changed', file: 'a.mjs', line: 1, wasText: 'const CLONES = "/srv/clones/x";', summary: 's', ...o });
const doc = (results, baseline = 'base1') => ({ baseline, results });

// git stub: returns the commits named per (text) and pretends nothing survives at HEAD
const gitFor = (map) => (bin, args) => {
  if (args.includes('show')) return '';                       // line absent at HEAD
  const i = args.indexOf('-S');
  const hits = map[args[i + 1]] ?? [];
  return hits.map((h) => `${h.sha}\t${h.subject}`).join('\n');
};

test('findings rewritten by the SAME commit set become one verdict', () => {
  const g = gitFor({ AAAA: [{ sha: 'c1', subject: 'one' }, { sha: 'c2', subject: 'two' }],
    BBBB: [{ sha: 'c2', subject: 'two' }, { sha: 'c1', subject: 'one' }] });
  const out = triage(doc([row({ wasText: 'AAAA-long-enough-x' }), row({ wasText: 'BBBB-long-enough-x', line: 9 })]),
    { git: (b, a) => g(b, a.map((x) => (x === 'AAAA-long-enough-x' ? 'AAAA' : x === 'BBBB-long-enough-x' ? 'BBBB' : x))) });
  assert.equal(out.groups.length, 1, 'same commit set, order-independent, is one verdict');
  assert.equal(out.groups[0].findings.length, 2);
});

test('different commit sets stay separate verdicts', () => {
  // both wasText values must clear MIN_SEARCHABLE or they are skipped before any search
  const A = 'AAAA-long-enough-to-search', B = 'BBBB-long-enough-to-search';
  const g = gitFor({ [A]: [{ sha: 'c1', subject: 'one' }], [B]: [{ sha: 'c9', subject: 'nine' }] });
  const out = triage(doc([row({ wasText: A }), row({ wasText: B, line: 9 })]), { git: g });
  assert.equal(out.groups.length, 2);
});

test('a line still present at HEAD is MOVED, never grouped as removed', () => {
  const git = (bin, args) => (args.includes('show') ? 'const CLONES = "/srv/clones/x"; still here' : 'c1\tone');
  const out = triage(doc([row()]), { git });
  assert.equal(out.groups.length, 0);
  assert.equal(out.skipped.moved.length, 1);
});

test('text too short to be distinctive is skipped, not searched', () => {
  const out = triage(doc([row({ wasText: 'x = 1' })]), { git: () => { throw new Error('must not search'); } });
  assert.equal(out.skipped.unsearchable.length, 1);
  assert.equal(out.groups.length, 0);
});

test('file-deleted and no-baseline are skipped explicitly — ambiguous, never guessed', () => {
  const out = triage(doc([{ state: 'file-deleted', file: 'g.mjs' }, { state: 'no-baseline', file: 'h.mjs' }]), { git: () => '' });
  assert.equal(out.skipped.fileDeleted.length, 1);
  assert.equal(out.skipped.noBaseline.length, 1);
});

test('no commit touching the line yields no group — absence of evidence is its own bucket', () => {
  const out = triage(doc([row()]), { git: (b, a) => (a.includes('show') ? '' : '') });
  assert.equal(out.groups.length, 0);
  assert.equal(out.skipped.noEvidence.length, 1);
});

test('commitsTouching returns null when git cannot be asked, [] when it found nothing', () => {
  assert.equal(commitsTouching('t', 'f', 'b', { git: () => { throw new Error('no git'); } }), null);
  assert.deepEqual(commitsTouching('t', 'f', 'b', { git: () => '' }), []);
});

test('output ordering is deterministic for a fixed input', () => {
  const g = gitFor({ AAAA: [{ sha: 'c1', subject: 'one' }], BBBB: [{ sha: 'c2', subject: 'two' }] });
  const d = doc([row({ wasText: 'BBBB' , line: 9 }), row({ wasText: 'AAAA' })]);
  const a = triage(d, { git: g }), b = triage(d, { git: g });
  assert.deepEqual(a.groups.map((x) => x.key), b.groups.map((x) => x.key));
});

test('a report with no baseline is refused rather than searched against nothing', () => {
  assert.throws(() => triage({ results: [row()] }, { git: () => '' }), /no baseline/);
});

test('readStaleness fails closed: unparseable is an error, not an empty queue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-at-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not json');
    assert.throws(() => readStaleness(p), /unreadable/);
    const q = join(dir, 'shape.json');
    writeFileSync(q, JSON.stringify({ baseline: 'b' }));
    assert.throws(() => readStaleness(q), /no results\[\]/);
    assert.throws(() => readStaleness(join(dir, 'nope.json')), /no anchor-staleness report/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// anchor-staleness normalises home directories to a placeholder git never contains, so the search
// goes by the fragments either side of it — the longest for -S, all of them for "still present".
test('an excerpt carrying the home placeholder is searched by its fragments, never by the placeholder', () => {
  const was = "const CLONES = '/Users/username/Repositories/x/clones';";
  assert.deepEqual(searchFragments(was), ["Repositories/x/clones';", "const CLONES = '"]);
  assert.deepEqual(searchFragments('plain-long-enough-line'), ['plain-long-enough-line'], 'no placeholder: one fragment, unchanged behaviour');
  assert.deepEqual(searchFragments("x = '/Users/username/y';"), [], 'nothing distinctive either side');
  const seen = [];
  const git = (bin, args) => {
    if (args.includes('show')) return "unrelated\n";
    if (!args.includes('-S')) return 'h3ad';          // the HEAD stamp at the end of triage
    seen.push(args[args.indexOf('-S') + 1]);
    return 'c1\tone';
  };
  const out = triage(doc([row({ wasText: was })]), { git });
  assert.equal(out.groups.length, 1);
  assert.deepEqual(seen, ["Repositories/x/clones';"], 'the longest fragment, and no placeholder in what git was asked');
});

test('still present at HEAD means every fragment is present — the real path survives the placeholder', () => {
  const was = "const CLONES = '/Users/username/Repositories/x/clones';";
  const git = (bin, args) => (args.includes('show') ? "const CLONES = '/Users/x/Repositories/x/clones';\n" : 'c1\tone');
  const out = triage(doc([row({ wasText: was })]), { git });
  assert.equal(out.skipped.moved.length, 1);
  assert.equal(out.groups.length, 0);
});

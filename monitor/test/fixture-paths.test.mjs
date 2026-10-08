import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPath, partition, enabled } from '../fixture-paths.mjs';

afterEach(() => { delete process.env.CW_FIXTURE_PATHS; });

describe('fixture-paths — what is a test corpus and what is the software', () => {
  test('the measured case: dependabot spec/fixtures is a fixture path', () => {
    const c = classifyPath('file:///src/npm_and_yarn/spec/fixtures/projects/npm5/subdependency_update/package-lock.json');
    assert.equal(c.fixture, true);
    assert.ok(c.why && c.why.length > 20, 'a classification with no reason is a silent edit of the evidence');
  });

  test('the seven real paths in that same repository are NOT fixtures', () => {
    assert.equal(classifyPath('file:///src/bun/helpers/package-lock.json').fixture, false);
  });

  test('testdata and __fixtures__ are unambiguous anywhere', () => {
    assert.equal(classifyPath('pkg/foo/testdata/go.sum').fixture, true);
    assert.equal(classifyPath('src/__fixtures__/package.json').fixture, true);
    assert.equal(classifyPath('lib/testFixtures/build.gradle').fixture, true);
  });

  test('a bare fixtures/ directory is only a fixture UNDER a test root', () => {
    // A sports app with a real product directory called fixtures must not be blanked.
    assert.equal(classifyPath('src/fixtures/season-2026.json').fixture, false);
    assert.equal(classifyPath('app/fixtures/matches/package.json').fixture, false);
    assert.equal(classifyPath('test/fixtures/vulnerable/package.json').fixture, true);
    assert.equal(classifyPath('spec/fixtures/x/package-lock.json').fixture, true);
    assert.equal(classifyPath('__tests__/fixtures/a/yarn.lock').fixture, true);
  });

  test('a FILE named fixtures is never itself a reason to discount a finding', () => {
    assert.equal(classifyPath('src/fixtures.js').fixture, false);
    assert.equal(classifyPath('src/testdata.json').fixture, false);
    assert.equal(classifyPath('spec/fixtures.rb').fixture, false);
  });

  test('an empty or malformed path classifies as not-a-fixture rather than throwing', () => {
    for (const bad of ['', null, undefined, 0, {}, [], 'file:///']) {
      assert.equal(classifyPath(bad).fixture, false);
    }
  });

  test('CW_FIXTURE_PATHS=off disables classification, and is read at CALL time', () => {
    assert.equal(classifyPath('spec/fixtures/a/package.json').fixture, true);
    process.env.CW_FIXTURE_PATHS = 'off';
    assert.equal(enabled(), false);
    assert.equal(classifyPath('spec/fixtures/a/package.json').fixture, false,
      'the override was captured at module load, so every test that sets it afterwards proves nothing');
  });
});

describe('fixture-paths — partition classifies, and never drops', () => {
  const rows = [
    { file: 'spec/fixtures/a/package-lock.json', rule: 'CVE-2019-10744', sev: 'crit' },
    { file: 'spec/fixtures/b/package-lock.json', rule: 'CVE-2019-10744', sev: 'crit' },
    { file: 'src/bun/helpers/package-lock.json', rule: 'CVE-2021-44906', sev: 'crit' },
    { file: 'testdata/go.sum', rule: 'GO-2026-1', sev: 'high' },
  ];

  test('every row survives — kept plus fixtures equals the input', () => {
    const p = partition(rows);
    assert.equal(p.kept.length + p.fixtures.length, rows.length);
    assert.equal(p.kept.length, 1);
    assert.equal(p.fixtures.length, 3);
  });

  test('a set-aside row keeps its severity and gains the pattern that matched it', () => {
    const p = partition(rows);
    for (const f of p.fixtures) {
      assert.equal(f.fixture, true);
      assert.ok(f.fixturePattern, 'a row was set aside with no pattern naming why');
      assert.ok(f.sev, 'severity was stripped from a set-aside row — it must remain recoverable');
    }
  });

  test('the report states the fraction, so a shrinking count is visible rather than merely true', () => {
    const p = partition(rows);
    assert.equal(p.report.total, 4);
    assert.equal(p.report.inFixtures, 3);
    assert.ok(p.report.note.includes('3 of 4'));
    assert.ok(Object.keys(p.report.byPattern).length >= 1);
  });

  test('with no fixtures the report is silent rather than claiming an exclusion it did not make', () => {
    const p = partition([{ file: 'src/index.js', rule: 'x' }]);
    assert.equal(p.report.inFixtures, 0);
    assert.equal(p.report.note, '');
    assert.deepEqual(p.report.byPattern, {});
  });

  test('an empty input is empty, not an error, and says classification was on', () => {
    const p = partition([]);
    assert.deepEqual(p.kept, []);
    assert.equal(p.report.total, 0);
    assert.equal(p.report.enabled, true);
  });

  test('with the override off, nothing is set aside and the report says so', () => {
    process.env.CW_FIXTURE_PATHS = 'off';
    const p = partition(rows);
    assert.equal(p.fixtures.length, 0);
    assert.equal(p.kept.length, 4);
    assert.equal(p.report.enabled, false);
  });
});

// ── intent: is this input broken ON PURPOSE ─────────────────────────────────────────────────────
// A second axis, folded in 2026-08-25 from bin/lib/scope-of.mjs so the fleet has one fixture
// vocabulary instead of two. It answers a different question from `fixture`, and the two constraints
// below are what keep it from becoming an excuse.
test('a fixture named for its own defect carries the intent, with the segment that said so', () => {
  const a = classifyPath('npm_and_yarn/spec/fixtures/projects/yarn/broken_lockfile/yarn.lock');
  assert.equal(a.fixture, true);
  assert.equal(a.intent, 'broken-on-purpose');
  assert.equal(a.intentBasis, 'broken_lockfile', 'the basis names the evidence, so a reader can disagree with the tag');
  assert.equal(classifyPath('npm_and_yarn/spec/fixtures/projects/yarn/empty_version/yarn.lock').intent, 'broken-on-purpose');
});

test('substrings never match — badge, invalidation and missingno are fixtures and are NOT broken on purpose', () => {
  for (const p of ['spec/fixtures/badge/icon.json', 'spec/fixtures/invalidation/cache.json', 'spec/fixtures/missingno.json', 'spec/fixtures/errorless/x.json']) {
    const r = classifyPath(p);
    assert.equal(r.fixture, true, `${p} is still a fixture`);
    assert.equal(r.intent, null, `${p}: matching "bad" inside "badge" is how a heuristic starts lying`);
  }
});

test('intent requires fixture scope, and is read only BELOW the fixture root', () => {
  assert.equal(classifyPath('src/invalid/parser.js').intent, null, 'a module named invalid is not a broken fixture, and tagging it one would EXCUSE a real finding');
  assert.equal(classifyPath('/work/broken-things/spec/fixtures/valid/ok.json').intent, null, 'a checkout under a broken-named path is not a broken fixture');
});

test('a plain fixture has intent null — absent, not false, and never inferred', () => {
  const r = classifyPath('internal/parser/testdata/go.mod');
  assert.equal(r.fixture, true);
  assert.equal(r.intent, null);
  assert.equal(r.intentBasis, null);
});

test('every negative return carries the intent keys too, so a consumer never sees undefined', () => {
  for (const p of ['src/main.js', '', 'app/fixtures/team-list.json']) {
    const r = classifyPath(p);
    assert.ok('intent' in r && 'intentBasis' in r, `${p}: the shape is the same on every path out`);
  }
});

// ── TWO AXES: SNAPSHOTS ARE DIRECTORIES, GOLDEN MASTERS ARE FILES ───────────────────────────────
// Adding `golden` to the directory segments was declined when the list last grew, and correctly:
// golden path, golden ratio, GoldenLayout, a `golden/` of reference imagery a product ships. The
// term is only unambiguous on the axis the convention actually names — the FILE. Splitting the
// nomenclature that way is what lets both in without either one blanking real code.
test('__snapshots__ is unambiguous anywhere; bare snapshots must sit under a test root', () => {
  assert.equal(classifyPath('src/__snapshots__/App.test.js.snap').fixture, true);
  assert.equal(classifyPath('src/__snapshots__/App.test.js.snap').basis, 'directory');
  assert.equal(classifyPath('test/snapshots/a.json').fixture, true, 'under a test root it is the convention');
  assert.equal(classifyPath('app/snapshots/db.json').fixture, false,
    'a product may legitimately hold database, VM or financial snapshots — blanking those is the '
    + 'false-negative this scoping exists to prevent');
});

test('a golden master is a FILE marker, and a file merely NAMED golden is not one', () => {
  for (const f of ['src/render.golden.json', 'out/a.golden', 'x/b.goldenmaster.txt', 'y/c.d.goldens.txt']) {
    const r = classifyPath(f);
    assert.equal(r.fixture, true, `${f} is a golden master`);
    assert.equal(r.basis, 'file', 'and it fired on the file axis, not the directory one');
  }
  for (const f of ['src/golden.js', 'cfg/golden.json', 'lib/GoldenLayout.js', 'src/goldens.ts']) {
    assert.equal(classifyPath(f).fixture, false,
      `${f}: the marker must be a dot-segment AFTER the base name — a file whose NAME is golden is `
      + 'making a different claim, and one a product is entitled to make');
  }
});

test('basis says WHICH axis discounted the finding — the two are not equally strong', () => {
  // A directory convention speaks for a whole tree; a file marker for one artifact. An operator
  // auditing a suppression is entitled to know which of the two was used on them.
  assert.equal(classifyPath('spec/fixtures/x.json').basis, 'directory');
  assert.equal(classifyPath('src/out.golden').basis, 'file');
  assert.equal(classifyPath('src/main.js').basis, null, 'a clean path claims no basis at all');
});

test('the directory axis wins when both apply, and intent still reads from the directories', () => {
  const r = classifyPath('spec/fixtures/broken_lockfile/out.golden');
  assert.equal(r.basis, 'directory', 'the stronger statement is reported');
  assert.equal(r.intent, 'broken-on-purpose', 'a golden master under a broken_ fixture is still broken on purpose');
});

test('every return carries basis, so a consumer branching on it never reads undefined', () => {
  for (const p of ['src/main.js', '', 'src/a.golden', 'spec/fixtures/x.json', 'app/snapshots/db.json']) {
    assert.ok('basis' in classifyPath(p), `${JSON.stringify(p)}: the shape is the same on every path out`);
  }
});

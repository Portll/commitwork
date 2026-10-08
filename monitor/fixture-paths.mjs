// fixture-paths.mjs — findings that describe a TEST CORPUS rather than the software.
//
// Measured 2026-08-24 on the 100-repository corpus: dependabot/dependabot-core produced 730 of the
// fleet's 800 critical rows, and 723 of those sat under `spec/fixtures/`. Dependabot-core is a
// dependency updater whose test suite is deliberately vulnerable lockfiles, kept so the updater can
// be proven to fix them. Reporting them as the project's criticals is class C3, wrong population
// measured: every number is real and none of them describes the software.
//
// THE RULE THIS FILE OBEYS: classify, never drop. A finding under a fixture path keeps its place in
// the artifact, keeps its severity, and gains `fixture: true` with the pattern that matched. It is
// excluded from HEADLINE totals and counted separately, so a reader sees "730 findings, 723 in test
// fixtures" rather than either 730 (useless) or 7 (a silent edit of the evidence). Silently dropping
// a path is how a real vulnerability that happens to live in one goes unreported — and a scanner
// that quietly edits its own input has no claim on anyone's trust.
//
// Env: CW_FIXTURE_PATHS=off disables classification entirely (everything counts); read at CALL time.

/** A segment must be a whole directory name, so `src/fixtures.js` — a real source file — is NOT a
 *  fixture, while `spec/fixtures/x.json` is. Anchoring on the segment is the whole discrimination. */
export const FIXTURE_SEGMENTS = Object.freeze([
  { seg: 'fixtures', why: 'a fixtures directory holds inputs a test suite asserts against, not shipped code' },
  { seg: 'fixture', why: 'singular form of the same convention' },
  { seg: '__fixtures__', why: 'the Jest and Vitest convention' },
  { seg: 'testdata', why: 'the Go convention: the toolchain itself ignores a testdata directory' },
  { seg: 'test-fixtures', why: 'hyphenated form of the same convention' },
  { seg: 'testFixtures', why: 'the Gradle source-set convention' },
  { seg: '__snapshots__', why: 'the Jest and Vitest snapshot convention — the whole directory is generated test output, never authored source' },
  { seg: 'snapshots', why: 'unhyphenated form of the same convention' },
  { seg: 'snapshot', why: 'singular form of the same convention' },
]);

// GOLDEN MASTERS ARE A FILE AXIS, and that is the whole reason they are here rather than beside the
// directory segments above. A recorded expected output compared byte-for-byte is a golden master;
// the convention names the FILE, not its folder. And `golden` as a DIRECTORY segment is genuinely
// ambiguous — golden path, golden ratio, GoldenLayout, a `golden/` of reference imagery a product
// actually ships — which is why adding it there was declined when the segment list last grew.
//
// The marker must be a dot-segment that is NOT the basename's first segment. `output.golden` and
// `render.golden.json` are golden masters; `golden.js` and `golden.json` are files whose NAME is
// golden, which is a different claim and one a product is entitled to make.
export const GOLDEN_MARKERS = Object.freeze(['golden', 'goldens', 'goldenmaster', 'goldenmasters']);

/** A golden-master FILE, by the dot-segment rule above. Returns the marker that fired, or null. */
export function goldenMarkerOf(file) {
  const parts = String(file || '').split('.');
  if (parts.length < 2) return null;
  // skip [0]: that is the base name, and a file NAMED golden is not a file marked golden
  for (const seg of parts.slice(1)) {
    const m = seg.toLowerCase();
    if (GOLDEN_MARKERS.includes(m)) return m;
  }
  return null;
}

/** Directories that are test roots. Only a fixture-ish segment BENEATH one of these counts, so a
 *  project whose product genuinely lives in `test/` is not silently blanked. */
export const TEST_ROOTS = Object.freeze(['test', 'tests', 'spec', 'specs', '__tests__', 'testing']);

/** Tokens naming a fixture as INVALID BY DESIGN, matched as whole `[/_.-]`-delimited tokens and only
 *  BENEATH an already-established fixture segment. Two constraints, both load-bearing: substring
 *  matching would read `badge/` as "bad", `invalidation/` as "invalid" and `missingno.json` as
 *  "missing"; and requiring fixture scope first means `src/invalid/` stays a module named invalid
 *  rather than an excuse for a real finding. Intent REFINES the fixture verdict, never replaces it. */
export const BROKEN_TOKENS = Object.freeze([
  { tok: 'broken', why: 'the fixture exists to be unparseable' },
  { tok: 'invalid', why: 'asserted against as invalid input' },
  { tok: 'malformed', why: 'structurally wrong on purpose' },
  { tok: 'corrupt', why: 'damaged on purpose' }, { tok: 'corrupted', why: 'damaged on purpose' },
  { tok: 'bad', why: 'the suite\'s name for a negative case' },
  { tok: 'unparseable', why: 'names its own defect' }, { tok: 'unparsable', why: 'names its own defect' },
  { tok: 'empty', why: 'an absent-value case, e.g. empty_version' },
  { tok: 'missing', why: 'an absent-field case' },
  { tok: 'truncated', why: 'cut short on purpose' },
  { tok: 'garbage', why: 'nonsense input by design' },
]);

const norm = (u) => String(u || '')
  .replace(/^file:\/\/\/?/, '')
  .replace(/\\/g, '/')
  .replace(/^\.?\//, '');

export const enabled = () => process.env.CW_FIXTURE_PATHS !== 'off';

/**
 * Classify one path.
 *
 * `intent` is a SECOND axis, added 2026-08-25 and folded in from bin/lib/scope-of.mjs so there is
 * one fixture vocabulary rather than two. It answers a different question from `fixture`: not "is
 * this a test corpus" but "is this input broken ON PURPOSE". dependabot-core ships a yarn.lock
 * whose entire content is `{ something: else` and one with a versionless entry — a scanner
 * refusing those is working, and a coverage report that cannot say so reads as a scanner that
 * could not do its job.
 *
 * @returns {{fixture: boolean, pattern: string|null, why: string|null, intent: 'broken-on-purpose'|null, intentBasis: string|null}}
 */
export function classifyPath(uri) {
  if (!enabled()) return { fixture: false, pattern: null, why: null, intent: null, intentBasis: null, basis: null };
  const parts = norm(uri).split('/').filter(Boolean);
  if (!parts.length) return { fixture: false, pattern: null, why: null, intent: null, intentBasis: null, basis: null };

  // TWO AXES, and `basis` says which one fired, because they are not equally strong. A directory
  // convention is a statement about a whole tree; a file marker is a statement about one artifact.
  // A reader auditing a suppression is entitled to know which of the two discounted their finding.
  //
  // The DIRECTORY axis is first and unchanged: the final element is the file, so a file named
  // fixtures.json is never itself a reason to discount a finding.
  const dirs = parts.slice(0, -1);

  for (const { seg, why } of FIXTURE_SEGMENTS) {
    const i = dirs.indexOf(seg);
    if (i === -1) continue;
    // `testdata` and `__fixtures__` are unambiguous anywhere. The generic `fixtures` / `fixture`
    // must sit under a test root, or a product directory legitimately called `fixtures` — a
    // fixtures service, a fixtures list in a sports application — would be blanked.
    // `__snapshots__` joins the unambiguous set for the same reason `__fixtures__` is in it: the
    // double-underscore form is a tool's own convention and nothing else is spelled that way. Bare
    // `snapshots` / `snapshot` stay test-root-scoped, because a product may legitimately hold
    // database, VM or financial snapshots in a directory of that name.
    const unambiguous = seg === 'testdata' || seg === '__fixtures__' || seg === 'testFixtures' || seg === 'test-fixtures' || seg === '__snapshots__';
    if (unambiguous) return { fixture: true, pattern: seg, why, basis: 'directory', ...intentOf(dirs, i) };
    const underTestRoot = dirs.slice(0, i).some((d) => TEST_ROOTS.includes(d));
    if (underTestRoot) {
      return { fixture: true, pattern: `${dirs.slice(0, i).find((d) => TEST_ROOTS.includes(d))}/…/${seg}`, why, basis: 'directory', ...intentOf(dirs, i) };
    }
  }
  // The FILE axis. A golden master is a recorded expected output compared byte-for-byte, and the
  // convention names the file rather than its folder — which is also why `golden` is admissible
  // here and was declined as a directory segment. Intent is read from the directories as usual: a
  // golden master under `.../broken_lockfile/` is still broken on purpose.
  const gold = goldenMarkerOf(parts[parts.length - 1]);
  if (gold) {
    return {
      fixture: true,
      pattern: `*.${gold}`,
      why: 'a golden master is a recorded expected output compared byte-for-byte — test input by construction, never shipped behaviour',
      basis: 'file',
      ...intentOf(dirs, -1),
    };
  }
  return { fixture: false, pattern: null, why: null, intent: null, intentBasis: null, basis: null };
}

/** Read intent from the segments BELOW the fixture root only: a checkout under ~/broken-things/ is
 *  not a broken fixture. Whole tokens, never substrings. */
function intentOf(dirs, fixtureIdx) {
  for (const seg of dirs.slice(fixtureIdx + 1)) {
    for (const tok of seg.split(/[_.\-\s]+/).filter(Boolean).map((t) => t.toLowerCase())) {
      const hit = BROKEN_TOKENS.find((b) => b.tok === tok);
      if (hit) return { intent: 'broken-on-purpose', intentBasis: seg };
    }
  }
  return { intent: null, intentBasis: null };
}

/**
 * Split a set of rows by fixture classification. Returns BOTH halves plus a report — the caller
 * publishes the report beside the count, and can always recover what was set aside.
 * @param {Array} rows
 * @param {(row:any)=>string} pathOf
 */
export function partition(rows, pathOf = (r) => r.file || r.path || r.uri || '') {
  const kept = []; const fixtures = []; const byPattern = {};
  for (const r of rows || []) {
    const c = classifyPath(pathOf(r));
    if (!c.fixture) { kept.push(r); continue; }
    fixtures.push({ ...r, fixture: true, fixturePattern: c.pattern });
    byPattern[c.pattern] = (byPattern[c.pattern] || 0) + 1;
  }
  return {
    kept,
    fixtures,
    report: {
      enabled: enabled(),
      total: (rows || []).length,
      inFixtures: fixtures.length,
      byPattern,
      note: fixtures.length
        ? `${fixtures.length} of ${(rows || []).length} findings are under a test-fixture path and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries fixture: true with the pattern that matched. Set CW_FIXTURE_PATHS=off to count them.`
        : '',
    },
  };
}

export default { classifyPath, partition, FIXTURE_SEGMENTS, TEST_ROOTS, enabled };

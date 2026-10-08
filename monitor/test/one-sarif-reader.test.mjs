// monitor/test/one-sarif-reader.test.mjs — there is ONE SARIF reader (monitor/sarif-read.mjs) and
// it stays one. Asserts the SHAPE, one-mutex.test.mjs style: the defaulting access patterns that
// convert "no scan happened" into "empty scan" may exist only inside the shared reader.
// Exceptions/deferrals are declared maps with enforced reasons (gate-roster-registry.test.mjs
// discipline), and a declared exception whose line no longer exists fails as stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Forward slashes, always: EXCEPTIONS and ADOPTERS are keyed that way, and `rel` below is normalised
// to match. Before that, relative() returned `bin\commitwork.mjs` on Windows, no exception key ever
// matched, and this test was red there for every declared exception at once — which hid any REAL
// new offender inside a failure everyone had learned to expect (measured 2026-09-23: it hid one).
const OWNER = 'monitor/sarif-read.mjs';   // the one place SARIF-document access may live
const ROOTS = ['bin', 'monitor', 'admin', 'cra', 'mcp', 'map', 'sitemap'];

// Every site that READS a SARIF document through the shared reader. cra/controls.mjs is
// deliberately absent: it consumes reader STATES via rollup's flags and never opens a document.
const ADOPTERS = [
  'bin/commitwork.mjs', 'bin/audit.mjs', 'bin/races.mjs', 'bin/lib/report-parsers/sarif.mjs',
  // The extractors' SARIF reads moved into part modules with the split of monitor/extractors.mjs:
  // _sarifCounts to extractors/sarif.mjs, _malCounts (osv.sarif) to extractors/supply-chain.mjs.
  'monitor/extractors/sarif.mjs', 'monitor/extractors/supply-chain.mjs',
  // The rollup's osv.sarif read moved to monitor/dep-findings.mjs, shared with `commitwork brief`.
  'monitor/dep-findings.mjs', 'monitor/codeql-fleet-data.mjs',
  'monitor/corrected-history.mjs', 'monitor/backfill-docs.mjs', 'monitor/backfill-dimensions.mjs',
  'bin/go-lane-scan.mjs', 'monitor/sarif-ingest.mjs',
];

// Sites deferred from migration, each with a reason — declared debt, never silent. A deferral
// whose file is TRACKED has had its unblock condition fire (see the staleness test below).
const DEFERRED = {};

// Lines matching a banned pattern that are not SARIF-document access: { allow: RegExp, reason }
const EXCEPTIONS = {
  'bin/lane-fixture.mjs': {
    allow: /if \(!Array\.isArray\(doc\?\.runs\)\) return \{ text, pruned: false \};|for \(const r of run\.results \|\| \[\]\)/,
    reason: 'pruneSarif rewrites recorded SARIF TEXT for a fixture, dropping rules no result cites; a runs-less document is returned unchanged, never classified. readSarif takes a path and cannot serve a text input',
  },
  'bin/quality-gates.mjs': {
    allow: /j\.results \|\| \[\]/,
    reason: 'reads races-summary.json (its own aggregate format, {results:[{lang,ran,executed}]}) — not a SARIF document; the races SARIF paths themselves go through the shared reader',
  },
  'bin/memory-layer-migrate-tenant.mjs': {
    allow: /r\.json\?\.memories \|\| r\.json\?\.results \|\| \[\]/,
    reason: 'memory-layer HTTP API response envelope, where results means memory records — no SARIF is anywhere near this tool',
  },
  'bin/lib/report-parsers/supply-chain.mjs': {
    allow: /for \(const r of f\.results \|\| \[\]\)/,
    reason: "trivy's and retire.js's native JSON reports both name a per-target array `results` — not SARIF, and each has its own husk semantics in its parser",
  },
  // _trivyCounts, the line this covers, moved here from monitor/extractors.mjs in the split.
  'monitor/extractors/supply-chain.mjs': {
    allow: /for \(const r of f\.results \|\| \[\]\)/,
    reason: "same trivy native-JSON shape as bin/lib/report-parsers/supply-chain.mjs — `f.results` is a per-target vulnerability list inside j.data, not a SARIF results array",
  },
  'monitor/backfill-dimensions.mjs': {
    allow: /d\.findings \|\| d\.results \|\| d\.violations \|\| \[\]/,
    reason: 'generic best-effort counter over NON-SARIF runtime artifacts (nuclei/bola/tls shapes) in a historical backfill — the .sarif files in the same script go through the shared reader',
  },
  'monitor/artifact-anomaly.mjs': {
    allow: /Array\.isArray\(j\.runs\)|Array\.isArray\(r\.results\)/,
    reason: 'artifactFindingCount shape-sniffs a BUFFER of any artifact kind (SARIF, bare array, JSONL) and returns null — unknown, never zero — for a runs-less object: the same discrimination this test guards, implemented for a non-path input readSarif cannot serve',
  },
  'monitor/rollup.mjs': {
    allow: /artifacts: \{ osv: existsSync\(join\(dir, 'osv\.sarif'\)\)/,
    reason: 'publishes artifact PRESENCE booleans as provenance facts on toolRuns — it gates no read and classifies no absence; the reads themselves go through readSarif',
  },
};

/** Every .mjs under the roots, excluding tests and node_modules. */
function sources(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'test') sources(p, out); continue; }
    if (e.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// The defaulting/coalescing forms only — bare `.runs[0]`/`of r.runs` on a husk THROW rather than
// launder, and cra/soc2.mjs's `cad.runs > 0` cadence count is why the bare name is not matched
const LAUNDERS = [
  { name: 'runs-default', re: /\.runs\s*(\|\||&&|\?\.)/, hint: 'j.runs || [] / d.runs && d.runs[0] / d.runs?.[0] — a runs-less husk reads as an empty scan' },
  { name: 'runs-probe', re: /Array\.isArray\(\s*[^)]*\.runs\s*\)/, hint: 'probing runs[] yourself means reimplementing the never-ran discrimination' },
  { name: 'results-default', re: /\.results\s*(\?\?|\|\|)/, hint: 'the reader returns results:null for every non-ok state ON PURPOSE — defaulting it to [] converts a void back into a clean zero' },
  { name: 'exists-before-read', re: /existsSync\s*\([^)]*sarif/i, hint: "absence is the reader's classification (state 'absent'), not the call site's existsSync — nine sites deciding absence is how the drift started" },
];

test('SARIF-document access lives in monitor/sarif-read.mjs and nowhere else', () => {
  const offenders = [];
  let scanned = 0;
  for (const root of ROOTS) {
    for (const file of sources(join(CW, root))) {
      scanned += 1;
      const rel = relative(CW, file).split(sep).join('/');
      if (rel === OWNER) continue;                 // the owner is allowed to implement the read
      if (rel in DEFERRED) continue;               // declared debt, rendered by the deferral test
      const exception = EXCEPTIONS[rel];
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        const t = line.trimStart();
        if (t.startsWith('//') || t.startsWith('*')) return;
        for (const { name, re, hint } of LAUNDERS) {
          if (!re.test(line)) continue;
          if (exception && exception.allow.test(line)) continue;
          offenders.push(`${rel}:${i + 1} [${name}] ${t.slice(0, 100)}\n      ${hint}`);
        }
      });
    }
  }
  // A renamed root or a permissions error would scan nothing and pass — the denominator
  // is the one number that must never be allowed to reach zero quietly.
  assert.ok(scanned > 50, `only ${scanned} source files scanned — the walk degenerated, so an empty offenders list proves nothing`);
  assert.deepEqual(offenders, [],
    'a SARIF reader is being hand-rolled, or reader output is being laundered. Import readSarif '
    + 'from monitor/sarif-read.mjs — nine copies of this access pattern each read a scanner that '
    + 'never ran as a clean scan, twice with a measured incident attached:\n  ' + offenders.join('\n  '));
});

test('every migrated site imports the shared reader', () => {
  for (const rel of ADOPTERS) {
    if (rel in DEFERRED) continue;
    const src = readFileSync(join(CW, rel), 'utf8');
    // RESOLVED against the importing file, not matched against a fixed spelling: the regex this
    // replaces accepted `../monitor/` (from bin/) and `./` (from monitor/) and so encoded a directory
    // depth. A part module under monitor/extractors/ imports `../sarif-read.mjs`, which is the same
    // reader and read as a missing import. Resolving checks the thing that matters — the target.
    const specs = [...src.matchAll(/from '(\.[^']*sarif-read\.mjs)'/g)].map((m) => m[1]);
    const toOwner = specs.some((s) => join(dirname(rel), s).split(sep).join('/') === OWNER);
    assert.ok(toOwner,
      `${rel} no longer imports monitor/sarif-read.mjs — if it stopped reading SARIF entirely, remove it from ADOPTERS with the commit that removed the read; if it grew its own parse, that is the copy-drift this test exists to refuse`);
  }
});

test('a declared exception or deferral carries a real reason, and exceptions are not stale', () => {
  for (const [rel, why] of Object.entries(DEFERRED)) {
    assert.equal(typeof why, 'string', `${rel} is deferred without a reason`);
    assert.ok(why.length > 20, `${rel}'s deferral reason is too short to be one — say what blocks the migration and what unblocks it`);
    // The unblock condition is testable or the deferral is immortal: EXCEPTIONS get a staleness
    // predicate and DEFERRED did not, so the one entry outlived its own condition unnoticed.
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: CW }).status === 0;
    assert.ok(!tracked,
      `${rel} is deferred as another session's untracked file, but it is TRACKED now — the stated `
      + 'unblock condition has fired: migrate it to the shared reader and delete this entry');
  }
  for (const [rel, { allow, reason }] of Object.entries(EXCEPTIONS)) {
    assert.equal(typeof reason, 'string', `${rel} is excepted without a reason`);
    assert.ok(reason.length > 20, `${rel}'s exception reason is too short to be one`);
    const src = readFileSync(join(CW, rel), 'utf8');
    assert.ok(src.split('\n').some((l) => allow.test(l)),
      `${rel}'s exception matches nothing — the line it permitted is gone, so the exemption is stale and must be removed (a permission slip that outlives its subject will eventually cover something else)`);
  }
});

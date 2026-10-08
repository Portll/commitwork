// The consumer half of lane coverage, and the bounds on it: the lane bound is REJECT-AT-INGEST
// (not truncate-at-render), aggregation is WORST-WINS with unknown > reduced > full, an empty set
// is ABSENT never 'full', and `gate` semantics are unchanged.

import { panelSource } from '../../admin/test/lib/panel-source.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../commitwork.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP_SRC = readFileSync(join(REPO, 'monitor', 'rollup.mjs'), 'utf8');
const MCP_SRC = readFileSync(join(REPO, 'mcp', 'server.mjs'), 'utf8');
// panelSource(): 54dd4bb moved 460K of panel client out of index.html into /static/*.js, so the
// markup alone no longer contains what these assertions are about. The helper returns the markup
// plus the scripts it loads — the seam that refactor created for exactly this.
const PANEL_SRC = panelSource('index.html');

const MANIFEST = (signals) => ({
  repo: 'x', checks: [{ id: 'c1', local: ['true'], report: { file: 'r.json', format: 'json', log: 'r.log' }, coverageSignals: signals }],
});
const errsFor = (signals) => validateManifest(MANIFEST(signals)).errors.join(' | ');

describe('the lane bound is enforced at ingest, so nothing hostile enters the store', () => {
  test('a well-formed lane passes', () => {
    assert.equal(validateManifest(MANIFEST([{ pattern: 'Skipping call analysis', lane: 'Go call analysis' }])).errors.length, 0);
  });

  test('markup in a lane is REJECTED, not escaped-and-kept', () => {
    const e = errsFor([{ pattern: 'x', lane: '<img src=x onerror=alert(1)>' }]);
    assert.match(e, /lane may contain only/,
      'a repo-local manifest is untrusted input; the trust gate covers execution, so this field needs its own bound');
  });

  test('a lane is bounded by LENGTH but rejected rather than truncated', () => {
    assert.match(errsFor([{ pattern: 'x', lane: 'L'.repeat(61) }]), /at most 60 characters/);
    // the property that matters: nothing in the pipeline silently shortens a lane
    assert.doesNotMatch(ROLLUP_SRC, /coverageReason[^\n]*slice\(0,\s*(?:[1-9]|[1-5][0-9])\)/,
      'coverageReason must not be clipped to a tiny width — a truncated lane names nothing');
  });

  test('a pattern that will not compile is rejected at load, not at scan time', () => {
    assert.match(errsFor([{ pattern: '([unclosed', lane: 'x' }]), /not a valid regex/,
      'a typo must fail where it is fixable, not become a permanent silent non-match');
  });

  test('signals declared without a log to read are WARNED, since they can never match', () => {
    const m = { repo: 'x', checks: [{ id: 'c1', local: ['true'], report: { file: 'r.json', format: 'json' }, coverageSignals: [{ pattern: 'x', lane: 'y' }] }] };
    assert.match(validateManifest(m).warnings.join(' | '), /no report\.log to read/);
  });
});

describe('rollup aggregation — worst-wins, and absent when nothing reported', () => {
  test('unknown outranks reduced outranks full', () => {
    assert.match(ROLLUP_SRC, /covUnknown \? 'unknown' : covReduced \? 'reduced' : 'full'/,
      'an unmeasured gap must survive aggregation over a measured one');
  });

  test('a category where NO check reported coverage emits no coverage key at all', () => {
    assert.match(ROLLUP_SRC, /if \(covFull \+ covReduced \+ covUnknown > 0\)/,
      "the empty set must be absent, never 'full' — absence of measurement is not a clean measurement");
  });

  test('coverage is tallied outside the status branches, so a fail can carry it too', () => {
    const loop = ROLLUP_SRC.slice(ROLLUP_SRC.indexOf('let covFull'), ROLLUP_SRC.indexOf('if (!withArtifact.length'));
    // Nesting is checked by INDENTATION rather than by pinning the noscan branch to a one-liner:
    // that branch grew a body (it records the void's reason now), and a shape test that breaks on
    // an unrelated edit inside a sibling block stops guarding and starts nagging. What must hold is
    // that the coverage tally sits at the loop's own level — four spaces — not inside a status arm.
    assert.ok(/\n {4}else if \(c\.status === 'noscan'\)/.test(loop), 'the noscan branch is still a sibling arm at the loop level');
    // 2026-08-26: the tallied VALUE is no longer `c.coverage` directly. A second, artifact-derived
    // source joined it (monitor/codeql-coverage.mjs, read via r.scanners[key].coverage), and the two
    // are merged worst-wins into `cov` before the tally. The property this test guards is unchanged
    // and is about PLACEMENT, not about which expression is read: the tally must sit at the loop's
    // own level so a `fail` row can carry coverage too. Pinned to `cov` rather than to `c.coverage`
    // so it keeps guarding instead of merely recording what the line used to say.
    assert.ok(/\n {4}const cov = worstCoverage\(/.test(loop),
      'the merge of the two coverage sources happens at the loop level, before any status branch');
    assert.ok(/\n {4}if \(cov === 'full'\) covFull\+\+;/.test(loop),
      'gating the tally on a status branch would drop the case the field exists for — found things while half-blind');
    assert.ok(!/\n {6}if \(cov === 'full'\)/.test(loop),
      'the coverage tally must not be indented into a status branch body');
  });

  test('the representative reason follows the winning state', () => {
    assert.match(ROLLUP_SRC, /covUnknown \? unknownReason : covReduced \? reducedReason : null/);
  });
});

describe('MCP — coverage reported, gate untouched', () => {
  test('gate is still computed from failed/blocked only', () => {
    assert.match(MCP_SRC, /const gate = blocked \? 'ERROR' : \(failed\.length \? 'FAIL' : 'PASS'\)/,
      'narrowing PASS silently is the one change that breaks a machine consumer without breaking its parse');
  });

  test('coverage rides as parallel fields', () => {
    assert.match(MCP_SRC, /reducedCoverage/);
    assert.match(MCP_SRC, /unknownCoverage/);
    assert.match(MCP_SRC, /coverageReasons/);
  });

  test('the fields are emitted only when something is degraded, so a clean payload is unchanged', () => {
    assert.match(MCP_SRC, /\.\.\.\(reducedCoverage\.length \? \{ reducedCoverage \} : \{\}\)/,
      'a caller diffing a clean run must see no new keys');
  });

  test('reasons are keyed by check, so a reader learns WHICH capability was lost', () => {
    assert.match(MCP_SRC, /map\(\(c\) => \[c\.check, c\.coverageReason\]\)/);
  });
});

describe('panel — a second axis, escaped, and mapped to the first', () => {
  test('every interpolated coverage field is escaped', () => {
    const fn = PANEL_SRC.slice(PANEL_SRC.indexOf('const laneCovPill='), PANEL_SRC.indexOf('const laneCovPill=') + 700);
    assert.match(fn, /esc\(s\.coverageReason\)/, 'coverageReason originates in a manifest and reaches HTML');
    assert.match(fn, /esc\(counts\)/);
    assert.match(fn, /esc\(m\.label\)/);
    assert.doesNotMatch(fn, /\$\{s\.coverageReason\}/, 'never interpolated raw');
  });

  test('the two coverage vocabularies are mapped, not merely renamed apart', () => {
    assert.match(PANEL_SRC, /TWO THINGS ON THIS PAGE ARE CALLED COVERAGE/);
    assert.match(PANEL_SRC, /unrun means nothing started, unknown means something started/,
      'unrun and unknown are the confusable pair and the difference must be stated where both are read');
  });

  test('a rollup with no coverage key renders exactly as before', () => {
    assert.match(PANEL_SRC, /if\(!s\|\|!s\.coverage\)return '';/,
      'an older rollup must not grow an "unknown" nobody measured');
  });

  test('the lane pill is appended to the state pill, never substituted for it', () => {
    assert.match(PANEL_SRC, /\$\{state\}\$\{lanePill\?` \$\{lanePill\}`:''\}/,
      'a category can be CLEAN and half-blind at once — that pairing is why coverage is a separate axis');
  });
});

describe('determinism — the property that was true by construction and is now pinned', () => {
  test('coverageReason never echoes log CONTENT, only declared or bounded values', () => {
    const CW = readFileSync(join(REPO, 'bin', 'commitwork.mjs'), 'utf8');
    // delimited at the function's own closing brace, never a magic character count
    // laneCoverage adds the per-file reading; laneCoverageBase holds the declared-signal reasons.
    const body = (name) => {
      const start = CW.indexOf(`function ${name}(`);
      assert.ok(start > -1, `${name} not found`);
      const end = CW.indexOf('\n}', start);
      assert.ok(end > start, `could not delimit ${name}`);
      return CW.slice(start, end + 2);
    };
    const fn = `${body('laneCoverage')}\n${body('laneCoverageBase')}`;
    // the matched text itself must never reach the reason — that would put log churn (paths,
    // timestamps, counts) into checks-status.json and break byte-identical re-rolls
    assert.doesNotMatch(fn, /coverageReason:.*\bmatch\b/, 'a matched line must not become the reason');
    assert.doesNotMatch(fn, /coverageReason:.*\btext\b/, 'log text must not become the reason');
    assert.match(fn, /\$\{s\.lane\} did not run/, 'the reason is the DECLARED lane');
  });
});

describe('index.md — the Markdown sink, with its own escaping discipline', () => {
  const CW = readFileSync(join(REPO, 'bin', 'commitwork.mjs'), 'utf8');

  test('the scan path computes coverage, or index.md has nothing to report', () => {
    assert.match(CW, /const \{ coverage, coverageReason \} = laneCoverage\(check, repoDir\);/,
      'the CLI tells the operator to open index.md for coverage; a fact that never reaches it is one they were sent to find and cannot');
    assert.match(CW, /cells\[check\.id\] = withIsolation\(\{ sev, summary, coverage, coverageReason \}, sb\)/);
  });

  test('degraded lanes are their OWN section, not folded into the voids table', () => {
    assert.match(CW, /## Degraded lanes/);
    assert.match(CW, /These are NOT voids/,
      'a void produced nothing; a degraded lane produced something while half-blind — merging them loses the distinction the field exists for');
  });

  test('the Markdown sink escapes pipes, because a filename reaches it unbounded', () => {
    const line = CW.split('\n').find((l) => l.includes('const mdCell ='));
    assert.ok(line, 'no mdCell escaper found');
    assert.ok(line.includes('replace(/\\|/g'),
      'lane is charset-bounded at ingest but coverageReason also interpolates a declared log FILENAME, which is not');
    assert.ok(line.includes('\\r?\\n'), 'a newline in a reason would break the table row too');
    assert.match(CW, /mdCell\(r\.lanes\.join\('; '\)\)/, 'the cell must actually go through it');
  });

  test('the section is omitted entirely when nothing is degraded', () => {
    assert.match(CW, /if \(degradedRows\.length\) \{/,
      'a clean run must not grow an empty section claiming a category of problem it does not have');
  });
});

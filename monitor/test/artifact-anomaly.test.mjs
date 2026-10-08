// node --test monitor/test/ — artifact-anomaly.mjs: the byte-identical-husk detector. Roster
// derived from SCANNER_SPECS; zero-finding byte-identical groups across >= minRepos flag; one
// member with findings clears the group; caps are never silent; deterministic; atomic writes.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artifactRoster, discoverRepoDirs, collectSamples, findAnomalies, findAnomaliesDetailed,
  artifactFindingCount, writeAnomalies, findSilentLanes, chooseBatches,
  sha256Bytes, DEFAULT_MIN_REPOS, DEFAULT_REPO_CAP, DEFAULT_MIN_BYTES,
} from '../artifact-anomaly.mjs';
import { SCANNER_SPECS } from '../extractors.mjs';

const withTmp = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-anomaly-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

describe('artifactRoster — derived from SCANNER_SPECS, never hardcoded', () => {
  test('one roster entry per spec that declares a literal filename', () => {
    const roster = artifactRoster();
    // a spec shape the derivation cannot parse must fail loudly, not silently lose coverage
    assert.equal(roster.length, SCANNER_SPECS.length,
      'every SCANNER_SPECS entry must yield a roster row — a shape this regex cannot parse is a bug in the derivation, not an exemption');
  });

  test('sorted by category — deterministic order', () => {
    const roster = artifactRoster();
    const cats = roster.map((r) => r.category);
    assert.deepEqual(cats, [...cats].sort());
  });

  test('the two lanes landed THIS wave (shellLint, actionsLint) appear with no edit here', () => {
    const roster = artifactRoster();
    const byCat = Object.fromEntries(roster.map((r) => [r.category, r.filename]));
    assert.equal(byCat.shellLint, 'shellcheck.json');
    assert.equal(byCat.actionsLint, 'actionlint.json');
  });

  test('spot-check a handful of known filenames, to prove the parse is reading the real literal', () => {
    const byCat = Object.fromEntries(artifactRoster().map((r) => [r.category, r.filename]));
    assert.equal(byCat.secrets, 'gitleaks.json');
    assert.equal(byCat.supplyChainHeuristic, 'guarddog.sarif');
    assert.equal(byCat.sastSemgrep, 'semgrep.sarif');
    assert.equal(byCat.maliciousPackages, 'osv.sarif');
  });

  test('a fabricated spec with no filename literal is skipped, not guessed', () => {
    const fake = [['fakeCat', 'fake-check', (d) => ({ ran: true, total: 0 })]];
    assert.deepEqual(artifactRoster(fake), []);
  });
});

describe('discoverRepoDirs — a reports dir can be one batch or the whole reports root', () => {
  test('bare repo dirs directly under reportsDir (a single sweep batch)', () => {
    withTmp((root) => {
      mkdirSync(join(root, 'repo-a'));
      mkdirSync(join(root, 'repo-b'));
      writeFileSync(join(root, 'batch-manifest.json'), '{}'); // a file, not a dir — must not appear
      const found = discoverRepoDirs(root);
      assert.deepEqual(found.map((f) => f.repo).sort(), ['repo-a', 'repo-b']);
      assert.ok(found.every((f) => f.batch === ''));
    });
  });

  test('sweep-* batch dirs one level down, repo dirs inside each', () => {
    withTmp((root) => {
      mkdirSync(join(root, 'sweep-20260101000000-x', 'repo-a'), { recursive: true });
      mkdirSync(join(root, 'sweep-20260102000000-y', 'repo-b'), { recursive: true });
      mkdirSync(join(root, 'sweep-20260102000000-y', 'history')); // must be skipped, not read as a repo
      const found = discoverRepoDirs(root);
      assert.deepEqual(found.map((f) => f.repo).sort(), ['repo-a', 'repo-b']);
      assert.ok(found.every((f) => f.batch.startsWith('sweep-')));
    });
  });

  test('dotfiles and non-directories are ignored, never crash the walk', () => {
    withTmp((root) => {
      writeFileSync(join(root, '.reports.lock'), 'x');
      mkdirSync(join(root, '.hidden-dir'));
      const found = discoverRepoDirs(root);
      assert.deepEqual(found, []);
    });
  });

  test('a reportsDir that does not exist yields an empty list, not a throw', () => {
    assert.deepEqual(discoverRepoDirs('/nonexistent/definitely-not-here'), []);
  });
});

// minimal zero-result guarddog SARIF — parses as ran:true, total:0
const cleanGuarddogSarif = JSON.stringify({ runs: [{ tool: { driver: { name: 'guarddog', rules: [{ id: 'r1' }] } }, results: [] }] });
const dirtyGuarddogSarif = JSON.stringify({ runs: [{ tool: { driver: { name: 'guarddog', rules: [
  { id: 'cve-typosquat' },
] } }, results: [{ ruleId: 'cve-typosquat', message: { text: "package 'left-pad@0.0.1' looks typosquatted" } }] }] });

describe('collectSamples — real extractor decides "reports 0 findings", never a re-derived heuristic', () => {
  test('a genuinely clean guarddog.sarif yields total:0', () => {
    withTmp((root) => {
      const repoDir = join(root, 'repo-a'); mkdirSync(repoDir);
      writeFileSync(join(repoDir, 'guarddog.sarif'), cleanGuarddogSarif);
      const roster = [{ category: 'supplyChainHeuristic', checkId: 'supply-chain-guarddog', filename: 'guarddog.sarif' }];
      const samples = collectSamples(root, roster);
      assert.equal(samples.length, 1);
      assert.equal(samples[0].repo, 'repo-a');
      assert.equal(samples[0].category, 'supplyChainHeuristic');
      assert.equal(samples[0].total, 0);
      assert.equal(samples[0].bytes, Buffer.byteLength(cleanGuarddogSarif));
      assert.equal(samples[0].hash, sha256Bytes(Buffer.from(cleanGuarddogSarif)));
    });
  });

  test('a guarddog.sarif with a real finding yields total > 0', () => {
    withTmp((root) => {
      const repoDir = join(root, 'repo-a'); mkdirSync(repoDir);
      writeFileSync(join(repoDir, 'guarddog.sarif'), dirtyGuarddogSarif);
      const roster = [{ category: 'supplyChainHeuristic', checkId: 'supply-chain-guarddog', filename: 'guarddog.sarif' }];
      const samples = collectSamples(root, roster);
      assert.equal(samples[0].total, 1);
    });
  });

  test('a repo missing the artifact contributes no sample for that category', () => {
    withTmp((root) => {
      mkdirSync(join(root, 'repo-a'));
      const roster = [{ category: 'supplyChainHeuristic', checkId: 'supply-chain-guarddog', filename: 'guarddog.sarif' }];
      assert.deepEqual(collectSamples(root, roster), []);
    });
  });

  test('a repo swept twice contributes only its MOST RECENT batch — repeated sweeps do not inflate breadth', () => {
    withTmp((root) => {
      const older = join(root, 'sweep-20260101000000-x', 'repo-a');
      const newer = join(root, 'sweep-20260102000000-x', 'repo-a');
      mkdirSync(older, { recursive: true }); mkdirSync(newer, { recursive: true });
      writeFileSync(join(older, 'guarddog.sarif'), dirtyGuarddogSarif);   // stale: had a finding
      writeFileSync(join(newer, 'guarddog.sarif'), cleanGuarddogSarif);   // current: clean
      const roster = [{ category: 'supplyChainHeuristic', checkId: 'supply-chain-guarddog', filename: 'guarddog.sarif' }];
      const samples = collectSamples(root, roster);
      assert.equal(samples.length, 1, 'exactly one sample per repo per category, never one per batch');
      assert.equal(samples[0].total, 0, 'the LATEST batch wins, not the first one found');
    });
  });
});

// ── the pure computation — the acceptance shapes ────────────────────────────────────────────────
const sample = (category, repo, hash, total, bytes = 47416) => ({ category, repo, hash, bytes, total });
const HUSK_HASH = 'a'.repeat(64);

describe('findAnomalies — the GuardDog husk shape and its near-misses', () => {
  test('acceptance case: >= minRepos byte-identical, zero-finding artifacts -> one anomaly record', () => {
    const samples = Array.from({ length: 7 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 0));
    const anomalies = findAnomalies(samples, { minRepos: 5 });
    assert.equal(anomalies.length, 1);
    const a = anomalies[0];
    assert.equal(a.category, 'supplyChainHeuristic');
    assert.equal(a.hash, HUSK_HASH);
    assert.equal(a.repoCount, 7);
    assert.equal(a.bytes, 47416);
    assert.deepEqual(a.repos, ['repo-0', 'repo-1', 'repo-2', 'repo-3', 'repo-4', 'repo-5', 'repo-6']);
    assert.equal(a.truncated, 0);
  });

  test('identical WITH findings -> no anomaly, even far past the repo threshold', () => {
    const samples = Array.from({ length: 10 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 3));
    assert.deepEqual(findAnomalies(samples, { minRepos: 5 }), []);
  });

  test('one member with a real finding clears the WHOLE group — a shared clean husk is not "mostly clean"', () => {
    const samples = [
      ...Array.from({ length: 6 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 0)),
      sample('supplyChainHeuristic', 'repo-the-honest-one', HUSK_HASH, 2),
    ];
    assert.deepEqual(findAnomalies(samples, { minRepos: 5 }), []);
  });

  test('K-1 repos (one short of the threshold) is coincidence, not a pattern — no anomaly', () => {
    const samples = Array.from({ length: 4 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 0));
    assert.deepEqual(findAnomalies(samples, { minRepos: 5 }), []);
  });

  test('exactly K repos hits the threshold — the boundary is inclusive', () => {
    const samples = Array.from({ length: 5 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 0));
    assert.equal(findAnomalies(samples, { minRepos: 5 }).length, 1);
  });

  test('a repo appearing twice in the input counts ONCE toward repoCount', () => {
    const samples = [
      ...Array.from({ length: 4 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 0)),
      sample('supplyChainHeuristic', 'repo-0', HUSK_HASH, 0), // duplicate of repo-0
    ];
    assert.deepEqual(findAnomalies(samples, { minRepos: 5 }), [], 'four distinct repos plus a duplicate is still four, not five');
  });

  test('a sample whose total is UNKNOWN (null) disqualifies the group — never treated as a confirmed zero', () => {
    const samples = [
      ...Array.from({ length: 6 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 0)),
      sample('supplyChainHeuristic', 'repo-unknown', HUSK_HASH, null),
    ];
    assert.deepEqual(findAnomalies(samples, { minRepos: 5 }), [],
      'an unconfirmed total must not be silently read as a zero — that is the same false-clean class this file exists to refuse');
  });

  test('different categories with the same hash are different groups — hash alone is not identity', () => {
    const samples = [
      ...Array.from({ length: 5 }, (_, i) => sample('supplyChainHeuristic', `repo-${i}`, HUSK_HASH, 0)),
      ...Array.from({ length: 5 }, (_, i) => sample('iac', `repo-${i}`, HUSK_HASH, 0)),
    ];
    const anomalies = findAnomalies(samples, { minRepos: 5 });
    assert.equal(anomalies.length, 2);
    assert.deepEqual(anomalies.map((a) => a.category), ['iac', 'supplyChainHeuristic'].sort());
  });

  test('two different hashes for the same category stay two separate groups', () => {
    const hashB = 'b'.repeat(64);
    const samples = [
      ...Array.from({ length: 5 }, (_, i) => sample('iac', `repoA-${i}`, HUSK_HASH, 0)),
      ...Array.from({ length: 5 }, (_, i) => sample('iac', `repoB-${i}`, hashB, 0)),
    ];
    const anomalies = findAnomalies(samples, { minRepos: 5 });
    assert.equal(anomalies.length, 2);
    assert.deepEqual(anomalies.map((a) => a.hash).sort(), [HUSK_HASH, hashB].sort());
  });

  test('cap truncates the repo list but NEVER the count — truncated states exactly what was dropped', () => {
    const samples = Array.from({ length: 12 }, (_, i) => sample('iac', `repo-${String(i).padStart(2, '0')}`, HUSK_HASH, 0));
    const anomalies = findAnomalies(samples, { minRepos: 5, repoCap: 4 });
    assert.equal(anomalies.length, 1);
    const a = anomalies[0];
    assert.equal(a.repoCount, 12, 'the true breadth is never hidden behind the cap');
    assert.equal(a.repos.length, 4);
    assert.equal(a.truncated, 8, '12 total - 4 shown = 8 dropped, stated exactly');
    assert.deepEqual(a.repos, ['repo-00', 'repo-01', 'repo-02', 'repo-03'], 'capped list is still the SORTED prefix, deterministic');
  });

  test('a non-positive repoCap reads as "no cap", never an emptied list', () => {
    const samples = Array.from({ length: 6 }, (_, i) => sample('iac', `repo-${i}`, HUSK_HASH, 0));
    const anomalies = findAnomalies(samples, { minRepos: 5, repoCap: 0 });
    assert.equal(anomalies[0].repos.length, 6);
    assert.equal(anomalies[0].truncated, 0);
  });

  test('default thresholds are exported and sane', () => {
    assert.equal(DEFAULT_MIN_REPOS, 5);
    assert.ok(DEFAULT_REPO_CAP > 0);
  });

  test('output is deterministic — sorted by category then hash, regardless of input order', () => {
    const hashB = 'b'.repeat(64);
    const shuffled = [
      ...Array.from({ length: 5 }, (_, i) => sample('supplyChainHeuristic', `z${i}`, hashB, 0)),
      ...Array.from({ length: 5 }, (_, i) => sample('iac', `a${i}`, HUSK_HASH, 0)),
    ].reverse();
    const a1 = findAnomalies(shuffled, { minRepos: 5 });
    const a2 = findAnomalies([...shuffled].reverse(), { minRepos: 5 });
    assert.deepEqual(a1, a2, 're-ordering the input must not change the output');
    assert.deepEqual(a1.map((a) => a.category), ['iac', 'supplyChainHeuristic']);
  });

  test('empty input yields an empty (never omitted) result', () => {
    assert.deepEqual(findAnomalies([]), []);
    assert.deepEqual(findAnomalies([], { minRepos: 5 }), []);
  });

  test('malformed samples (missing hash/category/repo) are skipped, not thrown on', () => {
    const samples = [
      { category: 'iac', repo: 'r1' }, // no hash
      { hash: HUSK_HASH, repo: 'r2' }, // no category
      { category: 'iac', hash: HUSK_HASH }, // no repo
      null, undefined, 'garbage',
    ];
    assert.deepEqual(findAnomalies(samples), []);
  });
});

describe('writeAnomalies — crash-safe write, no torn artifact-anomalies.json', () => {
  test('writes via writeAtomic: the final file is the exact JSON, no leftover temp file', () => {
    withTmp((root) => {
      const out = join(root, 'artifact-anomalies.json');
      const anomalies = [{ category: 'iac', hash: HUSK_HASH, repoCount: 5, bytes: 100, repos: ['a', 'b', 'c', 'd', 'e'], truncated: 0 }];
      writeAnomalies(out, anomalies);
      const readBack = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual(readBack, anomalies);
      const leftovers = readdirSync(root).filter((f) => f.includes('.tmp-'));
      assert.deepEqual(leftovers, [], 'writeAtomic must leave no .tmp-<pid> sibling behind');
    });
  });

  test('re-writing overwrites cleanly (idempotent re-runs)', () => {
    withTmp((root) => {
      const out = join(root, 'artifact-anomalies.json');
      writeAnomalies(out, [{ a: 1 }]);
      writeAnomalies(out, [{ a: 2 }]);
      assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), [{ a: 2 }]);
    });
  });
});

// ── the two false positives the live backtest produced ──────────────────────────────────────────
// Pinned as SUPPRESSIONS, not absences: findAnomaliesDetailed still returns them with the reason;
// plain findAnomalies() must not list them (sweep.mjs counts its length as a verdict).

const bigHusk = (n) => 'x'.repeat(n);

describe('the information floor — byte-identity below it is not evidence', () => {
  // `[]` is what gitleaks writes for every genuinely clean repo — 3 bytes cannot evidence a husk
  const tinyClean = Buffer.from('[]\n');   // 3 bytes, exactly as gitleaks writes it
  const tiny = (repo) => ({ category: 'secrets', repo, file: 'gitleaks.json', hash: 'b'.repeat(64), bytes: tinyClean.length, total: 0, artifactTotal: 0 });

  test('a 3-byte identical group across many repos is suppressed, with the reason', () => {
    const samples = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(tiny);
    const { anomalies, suppressed } = findAnomaliesDetailed(samples);
    assert.deepEqual(anomalies, [], 'three bytes cannot discriminate a husk from a clean scan');
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].reason, 'below-information-floor');
    assert.equal(suppressed[0].repoCount, 6, 'the true breadth is still reported, not rounded away');
    assert.equal(suppressed[0].bytes, 3);
  });

  test('findAnomalies() — the array sweep.mjs counts — does not include it', () => {
    assert.deepEqual(findAnomalies(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(tiny)), []);
  });

  test('the floor is a threshold, not a blanket: one byte over and it reports', () => {
    const at = (bytes) => ['r1', 'r2', 'r3', 'r4', 'r5'].map((repo) => ({
      category: 'iac', repo, file: 'x.json', hash: 'c'.repeat(64), bytes, total: 0, artifactTotal: 0,
    }));
    assert.equal(findAnomalies(at(DEFAULT_MIN_BYTES - 1)).length, 0);
    assert.equal(findAnomalies(at(DEFAULT_MIN_BYTES)).length, 1);
  });

  test('and it is overridable — an operator who disagrees is not locked out', () => {
    const samples = ['r1', 'r2', 'r3', 'r4', 'r5'].map(tiny);
    assert.equal(findAnomalies(samples, { minBytes: 0 }).length, 1);
  });
});

describe('a group whose artifact carries real findings is not a husk', () => {
  // maliciousPackages counts only MAL- advisories, so its slice reads 0 while the file is full of CVEs
  const shared = (repo) => ({
    category: 'maliciousPackages', repo, file: 'osv.sarif', hash: 'd'.repeat(64),
    bytes: 261591, total: 0, artifactTotal: 14,
  });

  test('category total 0 + artifact total 14 is suppressed, naming why', () => {
    const { anomalies, suppressed } = findAnomaliesDetailed(['r1', 'r2', 'r3', 'r4', 'r5'].map(shared));
    assert.deepEqual(anomalies, []);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].reason, 'artifact-carries-findings');
  });

  test('a sibling category reading the SAME file with findings also clears the group', () => {
    // two roster categories over one artifact — neither alone knows the file is non-empty
    const quiet = ['r1', 'r2', 'r3', 'r4', 'r5'].map((repo) => ({
      category: 'catA', repo, file: 'shared.sarif', hash: 'e'.repeat(64), bytes: 9000, total: 0, artifactTotal: null,
    }));
    const loud = quiet.map((s) => ({ ...s, category: 'catB', hash: 'f'.repeat(64), total: 3 }));
    const { anomalies, suppressed } = findAnomaliesDetailed([...quiet, ...loud]);
    assert.deepEqual(anomalies, []);
    assert.equal(suppressed[0].reason, 'artifact-carries-findings');
  });

  test('THE REGRESSION GUARD: a real husk still reports — neither fix disabled the check', () => {
    // a real husk: large, byte-identical, genuinely empty — must still report
    const husks = ['r1', 'r2', 'r3', 'r4', 'r5'].map((repo) => ({
      category: 'supplyChainHeuristic', repo, file: 'guarddog.sarif', hash: HUSK_HASH,
      bytes: 47416, total: 0, artifactTotal: 0,
    }));
    const out = findAnomalies(husks);
    assert.equal(out.length, 1);
    assert.equal(out[0].repoCount, 5);
    assert.equal(out[0].bytes, 47416);
  });
});

describe('artifactFindingCount — what the FILE holds, and null when it cannot tell', () => {
  test('SARIF sums results across runs', () => {
    assert.equal(artifactFindingCount(Buffer.from(cleanGuarddogSarif)), 0);
    assert.equal(artifactFindingCount(Buffer.from(dirtyGuarddogSarif)) > 0, true);
  });
  test('a bare JSON array is its length', () => {
    assert.equal(artifactFindingCount(Buffer.from('[]')), 0);
    assert.equal(artifactFindingCount(Buffer.from('[{"a":1},{"b":2}]')), 2);
  });
  test('JSONL counts non-blank lines', () => {
    assert.equal(artifactFindingCount(Buffer.from('{"a":1}\n{"b":2}\n\n')), 2);
  });
  test('an empty file is definitively zero', () => {
    assert.equal(artifactFindingCount(Buffer.from('   \n')), 0);
  });
  test('unparseable or unrecognised is NULL, never 0 — unknown must not clear a group', () => {
    assert.equal(artifactFindingCount(Buffer.from('{not json')), null);
    assert.equal(artifactFindingCount(Buffer.from('<?xml version="1.0"?><x/>')), null);
    assert.equal(artifactFindingCount(Buffer.from('{"some":"object"}')), null, 'a JSON object with no runs[] says nothing about findings');
  });
  test('a group whose artifact total is UNKNOWN is still reported — null does not exempt', () => {
    const unknown = ['r1', 'r2', 'r3', 'r4', 'r5'].map((repo) => ({
      category: 'iac', repo, file: 'weird.xml', hash: 'a'.repeat(64), bytes: 9000, total: 0, artifactTotal: null,
    }));
    assert.equal(findAnomalies(unknown).length, 1);
  });
});

// ── H1a: a lane that STOPPED EMITTING ────────────────────────────────────────────────────────────
// Zero samples cannot form a group, so silence scores like a healthy scan. A lane still emitting
// somewhere is being SCOPED, not going dark; runtime lanes are labelled from RUNTIME_CATEGORIES.

const s = (repo, category) => ({ repo, category });
const many = (n, category, prefix = 'r') => Array.from({ length: n }, (_, i) => s(`${prefix}${i}`, category));

describe('findSilentLanes — a missing question, not a wrong answer', () => {
  test('a lane that emitted last sweep and emits nowhere now is reported', () => {
    const out = findSilentLanes([], many(6, 'supplyChainHeuristic'));
    assert.equal(out.length, 1);
    assert.equal(out[0].category, 'supplyChainHeuristic');
    assert.equal(out[0].repoCount, 6);
    assert.deepEqual(out[0].repos, ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'], 'names the repos, so it is checkable');
  });

  test('THE SCOPING FILTER: a lane still emitting for other repos is not dark', () => {
    // `sweep fast` after `sweep all` is a scope change, not a lane going dark
    const prev = many(7, 'sastSemgrep');
    const now = [s('r6', 'sastSemgrep')];
    assert.deepEqual(findSilentLanes(now, prev), []);
  });

  test('below the breadth floor it is one repo scoped differently, not a fleet event', () => {
    assert.deepEqual(findSilentLanes([], many(4, 'iac')), []);
    assert.equal(findSilentLanes([], many(5, 'iac')).length, 1);
    assert.equal(findSilentLanes([], many(4, 'iac'), { minRepos: 3 }).length, 1, 'and the floor is overridable');
  });

  test('runtime lanes are LABELLED from the declaration, never re-derived', () => {
    for (const cat of ['dast', 'bola', 'tlsHeaders', 'apiFuzz']) {
      const out = findSilentLanes([], many(6, cat));
      assert.equal(out[0].runtime, true, `${cat} needs a live target — quiet is expected, not a defect`);
    }
    const stat = findSilentLanes([], many(6, 'sastSemgrep'));
    assert.equal(stat[0].runtime, false, 'a static lane going dark is a different statement');
  });

  test('a lane that appears for the first time is not "silent" — this is one-directional', () => {
    assert.deepEqual(findSilentLanes(many(6, 'minifiedCode'), []), []);
  });

  test('no previous sweep at all reports nothing, rather than every lane', () => {
    assert.deepEqual(findSilentLanes(many(6, 'iac'), []), []);
    assert.deepEqual(findSilentLanes(many(6, 'iac'), null), []);
  });

  test('deterministic: sorted by category, repos sorted, regardless of input order', () => {
    const prev = [s('z', 'iac'), s('a', 'dast'), s('m', 'iac'), s('b', 'dast'), s('c', 'dast'),
      s('d', 'dast'), s('e', 'dast'), s('n', 'iac'), s('o', 'iac'), s('p', 'iac'), s('q', 'iac')];
    const out = findSilentLanes([], prev);
    assert.deepEqual(out.map((x) => x.category), ['dast', 'iac']);
    assert.deepEqual(out[1].repos, [...out[1].repos].sort());
  });

  test('malformed rows are skipped, never counted as a lost lane', () => {
    assert.deepEqual(findSilentLanes([], [null, {}, { repo: 'a' }, { category: 'x' }]), []);
  });
});

describe('chooseBatches — "what this repo produced last time"', () => {
  const e = (repo, batch) => ({ repo, batch, dir: `/${batch}/${repo}` });

  test('rank 0 is the newest batch per repo, rank 1 the one before', () => {
    const dirs = [e('a', 'sweep-20260101000000-x'), e('a', 'sweep-20260103000000-x'), e('a', 'sweep-20260102000000-x')];
    assert.equal(chooseBatches(dirs, 0)[0].batch, 'sweep-20260103000000-x');
    assert.equal(chooseBatches(dirs, 1)[0].batch, 'sweep-20260102000000-x');
  });

  test('a repo with only one batch has no previous — it is absent from rank 1, not duplicated', () => {
    const dirs = [e('a', 'sweep-20260101000000-x'), e('b', 'sweep-20260101000000-x'), e('b', 'sweep-20260102000000-x')];
    assert.deepEqual(chooseBatches(dirs, 1).map((x) => x.repo), ['b'],
      'repeating rank 0 as rank 1 would make every first-ever sweep look like a lane going dark');
  });

  test('a bare (non-batch) dir sorts oldest, so a real sweep always wins rank 0', () => {
    const dirs = [e('a', ''), e('a', 'sweep-20260101000000-x')];
    assert.equal(chooseBatches(dirs, 0)[0].batch, 'sweep-20260101000000-x');
    assert.equal(chooseBatches(dirs, 1)[0].batch, '');
  });
});

// monitor/scan-scope.mjs — the panel's statement of what the secret scan was NOT allowed to see.
// A scope that cannot be determined must never report as "nothing excluded": every failure path
// yields known:false, and the shipped config is asserted to actually parse.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const loadMod = async () => import(`../scan-scope.mjs?t=${Math.random()}`);
const load = async () => (await loadMod()).scanScope;
const withConfig = async (toml) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-scope-'));
  const p = join(d, 'gitleaks.toml');
  if (toml !== null) writeFileSync(p, toml);
  const prev = process.env.CW_GITLEAKS_CONFIG;
  process.env.CW_GITLEAKS_CONFIG = p;
  try { return (await load())(); } finally {
    if (prev === undefined) delete process.env.CW_GITLEAKS_CONFIG; else process.env.CW_GITLEAKS_CONFIG = prev;
  }
};

describe('scan scope is derived from the file that bounds the scan', () => {
  test('the SHIPPED config parses — a fixture-only test would pass on a dead parser', async () => {
    const s = (await load())();
    assert.equal(s.known, true, `the real manifests/gitleaks.toml must parse: ${JSON.stringify(s)}`);
    assert.ok(s.blocks.length >= 2, 'both the blanket and the rule-scoped block must be seen');
    assert.equal(s.maxTargetMB, 50, 'the size backstop is a real bound and is read from the check command');
    const scoped = s.blocks.filter((b) => b.targetRules);
    // enumerated, not counted — adding a rule-scoped suppression must mean naming it here
    assert.deepEqual(scoped.flatMap((b) => b.paths).sort(),
      ['(^|/)\\.claude/verdicts/', '(^|/)_meta_cache/'],
      'exactly these rule-scoped suppressions ship today');
    for (const b of scoped) assert.deepEqual(b.targetRules, ['generic-api-key'],
      'a scoped block that widens past the catch-all entropy rule is a different decision entirely');
    // the one blanket exclusion covering person-edited content — must stay visible in the disclosure
    assert.ok(s.blocks.some((b) => !b.targetRules && b.paths.includes('(^|/)\\.claude/worktrees/')),
      'per-agent worktrees are excluded wholesale; that cost must remain declared');
  });

  test('a multi-line array with interleaved comments is read in full', async () => {
    const s = await withConfig(`[extend]\nuseDefault = true\n\n[[allowlists]]\ndescription = "d"\npaths = [\n  # a comment between entries\n  '''(^|/)node_modules/''',\n  '''\\.mdb$''',   # trailing comment\n]\n`);
    assert.equal(s.known, true);
    assert.deepEqual(s.blocks[0].paths, ['(^|/)node_modules/', '\\.mdb$'],
      'comments inside the array must not swallow or fabricate an entry');
  });

  test('a blanket block and a rule-scoped block stay DISTINGUISHABLE', async () => {
    // flattening would hide "not scanned" vs "scanned by every rule but one"
    const s = await withConfig(`[[allowlists]]\ndescription = "all"\npaths = ['''(^|/)dist/''']\n\n[[allowlists]]\ndescription = "one rule"\ntargetRules = ["generic-api-key"]\npaths = ['''(^|/)_meta_cache/''']\n`);
    assert.equal(s.blocks.length, 2);
    assert.equal(s.blocks[0].targetRules, null, 'blanket exclusions sort first — the larger claim reads first');
    assert.deepEqual(s.blocks[1].targetRules, ['generic-api-key']);
  });

  test('an ABSENT scope file is unknown, NOT "nothing excluded"', async () => {
    const s = await withConfig(null);
    assert.equal(s.known, false);
    assert.equal(s.reason, 'absent');
    assert.equal(s.blocks, undefined, 'a failure must not hand back an exclusion list of any length');
  });

  // THE READ FAILURE IS CONSTRUCTED PER PLATFORM. `chmod 0o000` does not make a file unreadable on
  // Windows — node's chmod maps only the read-only bit there — so this built a file that was
  // perfectly readable, `load()` parsed it, and the test failed with `true !== false` on every
  // Windows run. Skipping would have been the wrong answer twice over: the property is
  // platform-independent, and it is one of the load-bearing ones (a scope this lane cannot read
  // must not read as "nothing is excluded", which would silently widen every scan).
  //
  // On Windows the config path points at a DIRECTORY instead. `readFileSync` then fails with
  // EISDIR — a genuine read failure that is emphatically not absence, which is the distinction the
  // assertion is about. Same branch, same property, no permission semantics required.
  test('an UNREADABLE scope file is unknown, NOT "nothing excluded"', async (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('SKIPPED (not a silent pass): root ignores mode bits');
    const d = mkdtempSync(join(tmpdir(), 'cw-scope-'));
    const win = process.platform === 'win32';
    const p = join(d, 'gitleaks.toml');
    if (win) {
      mkdirSync(p);                       // a directory where a file is expected -> EISDIR
    } else {
      writeFileSync(p, '[[allowlists]]\npaths = [\'\'\'x\'\'\']\n');
      chmodSync(p, 0o000);
    }
    const prev = process.env.CW_GITLEAKS_CONFIG;
    process.env.CW_GITLEAKS_CONFIG = p;
    try {
      const s = (await load())();
      assert.equal(s.known, false, 'a read failure is not an empty scope');
      assert.equal(s.reason, 'unreadable');
    } finally {
      if (!win) chmodSync(p, 0o600);
      if (prev === undefined) delete process.env.CW_GITLEAKS_CONFIG; else process.env.CW_GITLEAKS_CONFIG = prev;
    }
  });

  test('a config yielding NO recognised block is unknown, not a clean bill of health', async () => {
    // indistinguishable from a broken parser — must not share an answer with "no exclusions configured"
    const s = await withConfig('[extend]\nuseDefault = true\n');
    assert.equal(s.known, false);
    assert.equal(s.reason, 'unparsed');
  });

  test('per-scanner scopes are DERIVED from the shipped check commands — flags in, claims out', async () => {
    const scopes = (await loadMod()).scanScopes();
    // secrets keeps its toml shape, and the overwatch-layer server/data/ exclusion is now visible in it
    assert.equal(scopes.secrets.known, true);
    assert.ok(scopes.secrets.blocks.some((b) => !b.targetRules && b.paths.includes('(^|/)server/data/')),
      'the overwatch-layer server/data/ exclusion must be part of the disclosed scope');
    // semgrep: --exclude reference --exclude reports
    assert.equal(scopes.sastSemgrep.known, true);
    assert.deepEqual(scopes.sastSemgrep.blocks[0].paths, ['reference', 'reports']);
    // trivy config: --skip-dirs reference,reports,fixtures/scan-canary/dirty (one flag,
    // comma-joined). The canary tree deliberately contains vulnerable IaC and belongs to the
    // canary lane, not the production fleet count; the derived disclosure must say so.
    assert.equal(scopes.iac.known, true);
    assert.deepEqual(scopes.iac.blocks[0].paths, ['reference', 'reports', 'fixtures/scan-canary/dirty']);
    // CodeQL Java: language selection + build-mode none arrive as notes, not paths
    assert.ok(scopes.sastCodeqlJava.notes.some((n) => n.includes('java')), 'the language bound must be stated');
    assert.ok(scopes.sastCodeqlJava.notes.some((n) => n.includes('build-mode none')), 'source-only analysis must be stated');
    // GuardDog: docker gate + declared-manifest bound. It reads package.json — pointed at a
    // lockfile it parses nothing, so the file it reads is load-bearing.
    assert.ok(scopes.supplyChainHeuristic.notes.some((n) => n.includes('docker')), 'the docker gate must be stated');
    assert.ok(scopes.supplyChainHeuristic.notes.some((n) => n.includes('package.json')), 'the declared-manifest bound must be stated');
    assert.ok(!scopes.supplyChainHeuristic.notes.some((n) => n.includes('package-lock.json')),
      'guarddog must NOT claim to read the lockfile — it cannot parse one');
    // nuclei: live-target gate
    assert.ok(scopes.dast.notes.some((n) => n.includes('live target')), 'the live-target gate must be stated');
    // gitleaks size backstop stays where it always was
    assert.equal(scopes.secrets.maxTargetMB, 50);
  });

  // notes are additive-on-match, so a changed command does not go wrong — it goes SILENT; a
  // one-word guarddog fix once deleted its published bound
  describe('declared scopeNotes are cross-checked against what the command actually implies', () => {
    const withManifest = async (mutate) => {
      const src = JSON.parse(readFileSync(join(CW_ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
      mutate(src);
      const d = mkdtempSync(join(tmpdir(), 'cw-scope-'));
      const p = join(d, 'baseline.json');
      writeFileSync(p, JSON.stringify(src, null, 2));
      const prev = process.env.CW_BASELINE_MANIFEST;
      process.env.CW_BASELINE_MANIFEST = p;
      try { return (await loadMod()).scanScopes(); } finally {
        if (prev === undefined) delete process.env.CW_BASELINE_MANIFEST; else process.env.CW_BASELINE_MANIFEST = prev;
      }
    };
    const checkById = (m, id) => m.checks.find((c) => c.id === id);

    test('the SHIPPED manifest agrees with itself — every declared bound is actually derived', async () => {
      const scopes = (await loadMod()).scanScopes();
      for (const [key, v] of Object.entries(scopes)) {
        if (key === 'secrets') continue;
        assert.equal(v.known, true, `${key} must not be in scope-drift on the shipped manifest: ${v.detail || ''}`);
      }
    });

    test('a bound that VANISHES from the command is known:false, never a quiet empty list', async () => {
      const scopes = await withManifest((m) => {
        const c = checkById(m, 'supply-chain-guarddog');
        c.local = c.local.map((l) => l.replace('/src/package.json', '/src/package-lock.json'));
      });
      const v = scopes.supplyChainHeuristic;
      assert.equal(v.known, false, 'a disappeared bound must not report as a confident scope');
      assert.equal(v.reason, 'scope-drift');
      assert.match(v.detail, /declared but not derived: package-json/);
      assert.match(v.detail, /derived but not declared: package-lock/);
      assert.equal(v.notes, undefined, 'a drifted scope hands back no notes at all — a partial list is a lie');
    });

    test('a bound that APPEARS undeclared is drift too — nobody signed off on it', async () => {
      const scopes = await withManifest((m) => {
        const c = checkById(m, 'sast');            // declares scopeNotes: [] today
        c.local = c.local.map((l) => `docker run --rm ${l}`);
      });
      assert.equal(scopes.sastSemgrep.known, false);
      assert.match(scopes.sastSemgrep.detail, /derived but not declared: docker/);
    });

    // drift invalidates the NOTES; the path bounds come from flags and the filter file and must
    // survive — a bare {known:false} once discarded the codeql-filters.txt bound
    test('drift keeps the path bounds it still derives — only the notes are withheld', async () => {
      const scopes = await withManifest((m) => {
        const c = checkById(m, 'sast-codeql');
        c.local = c.local.map((l) => l.replace(/--language[ =][^\s"']+ ?/, ''));   // any unrelated command edit
      });
      const v = scopes.sastCodeql;
      assert.equal(v.known, false, 'the alarm must still be loud');
      assert.equal(v.reason, 'scope-drift');
      assert.ok(Array.isArray(v.blocks) && v.blocks.length > 0, 'the derived path bounds must survive the drift');
      assert.ok(v.blocks.some((b) => /codeql-filters\.txt/.test(b.description)),
        'the filter-file bound — ~640 findings in one area — must not vanish behind a stale note');
      assert.equal(v.notes, undefined, 'notes are what drifted, so they are withheld rather than half-listed');
    });

    test('a check with NO scopeNotes is not cross-checked — the mechanism is additive', async () => {
      const scopes = await withManifest((m) => { delete checkById(m, 'supply-chain-guarddog').scopeNotes; });
      assert.equal(scopes.supplyChainHeuristic.known, true, 'an undeclared check keeps deriving as before');
      assert.ok(scopes.supplyChainHeuristic.notes.length > 0);
    });
  });

  test('an unreadable baseline manifest fails EVERY command-derived scope closed — never []', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-scope-'));
    const bad = join(d, 'baseline.json');
    writeFileSync(bad, '{ not json');
    const prevB = process.env.CW_BASELINE_MANIFEST;
    process.env.CW_BASELINE_MANIFEST = bad;
    try {
      const scopes = (await loadMod()).scanScopes();
      assert.equal(scopes.sastSemgrep.known, false, 'a bad manifest is not an unbounded scan');
      assert.equal(scopes.sastSemgrep.reason, 'unparsed');
      assert.equal(scopes.sastSemgrep.blocks, undefined, 'a failure must not hand back a bounds list of any length');
      assert.equal(scopes.dast.known, false);
      assert.equal(scopes.secrets.known, true, 'the toml-derived secrets scope does not depend on the baseline manifest');
    } finally {
      if (prevB === undefined) delete process.env.CW_BASELINE_MANIFEST; else process.env.CW_BASELINE_MANIFEST = prevB;
    }
  });

  test('a check missing from the manifest is undeclared — a different claim from "no bounds"', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-scope-'));
    const p = join(d, 'baseline.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'sast', local: ['semgrep scan --quiet .'] }] }));
    const prevB = process.env.CW_BASELINE_MANIFEST;
    process.env.CW_BASELINE_MANIFEST = p;
    try {
      const scopes = (await loadMod()).scanScopes();
      assert.equal(scopes.iac.known, false, 'no iac-config check declared — the scope is unknowable, not empty');
      assert.equal(scopes.iac.reason, 'undeclared');
      // and a declared check with NO bounding flags is known-with-no-bounds — the honest empty
      assert.equal(scopes.sastSemgrep.known, true);
      assert.deepEqual(scopes.sastSemgrep.blocks, []);
      assert.deepEqual(scopes.sastSemgrep.notes, []);
    } finally {
      if (prevB === undefined) delete process.env.CW_BASELINE_MANIFEST; else process.env.CW_BASELINE_MANIFEST = prevB;
    }
  });

  test('the max-target bound is reported as unknown when the manifest cannot supply it', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-scope-'));
    const bad = join(d, 'baseline.json');
    writeFileSync(bad, '{ not json');
    const prevB = process.env.CW_BASELINE_MANIFEST;
    process.env.CW_BASELINE_MANIFEST = bad;
    try {
      const s = await withConfig(`[[allowlists]]\ndescription = "d"\npaths = ['''(^|/)dist/''']\n`);
      assert.equal(s.known, true, 'the exclusion list is still knowable without the manifest');
      assert.equal(s.maxTargetMB, null, 'but the size bound must read as unknown rather than absent');
      // null is also what a command with no size flag yields — the reason travels separately
      assert.equal(s.maxTargetUnknown, 'unparsed', 'an unreadable manifest must SAY the bound is undetermined');
    } finally {
      if (prevB === undefined) delete process.env.CW_BASELINE_MANIFEST; else process.env.CW_BASELINE_MANIFEST = prevB;
    }
  });
});

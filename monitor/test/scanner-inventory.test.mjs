// The instruments are the one thing this project was not inventorying, and the gap had a price:
// on 2026-08-22 the trufflehog stamp read 3.95.9, the box ran 3.96.0, upstream was 3.97.0, and the
// drift was manufacturing 1,311 of the fleet's 1,314 published CRITICALs.
//
// Every assertion here is a state that must NOT collapse into "fine".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scannerToolchainState, inventory, isUnknown } from '../package-inventory.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-scaninv-'));
const roster = (checks) => {
  const p = join(T, `roster-${Math.abs(checks.length * 7 + JSON.stringify(checks).length)}.json`);
  writeFileSync(p, JSON.stringify({ checks }));
  return p;
};
const withEnv = (vars, fn) => {
  const old = {};
  for (const [k, v] of Object.entries(vars)) { old[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

test('the tool list is DERIVED from the roster — a check cannot require a tool the inventory ignores', () => {
  const p = roster([
    { id: 'a', requires: { tools: ['gitleaks', 'node'] } },
    { id: 'b', requires: { tools: ['trivy'] } },
    { id: 'c' },
  ]);
  const s = withEnv({ CW_SECURITY_BASELINE: p }, () => scannerToolchainState({ brew: { state: 'current', outdated: [] } }));
  const names = s.tools.map((t) => t.name);
  assert.deepEqual(names, ['gitleaks', 'trivy'], 'every declared tool is probed, and `node` is left to toolchainState');
  assert.equal(s.counts.declared, 2);
});

test('an unreadable roster is a FAILED observation, never an empty scanner set', () => {
  const s = withEnv({ CW_SECURITY_BASELINE: join(T, 'does-not-exist.json') },
    () => scannerToolchainState({ brew: { state: 'current', outdated: [] } }));
  assert.equal(s.state, 'failed');
  assert.match(s.reason, /UNKNOWN, not empty/);
  assert.ok(!s.tools, 'no tool list at all is better than an empty one that reads as "nothing missing"');
  assert.ok(isUnknown(s), 'and the panel must be told not to render it as up to date');
});

test('a roster that declares no tools is a manifest defect, not a clean box', () => {
  const s = withEnv({ CW_SECURITY_BASELINE: roster([{ id: 'x' }, { id: 'y' }]) },
    () => scannerToolchainState({ brew: { state: 'current', outdated: [] } }));
  assert.equal(s.state, 'failed');
  assert.match(s.reason, /manifest defect/);
});

test('a missing scanner makes the whole set PARTIAL — the roster claims a coverage that is not there', () => {
  const s = withEnv({ CW_SECURITY_BASELINE: roster([{ id: 'a', requires: { tools: ['definitely-not-a-real-binary-xyz'] } }]) },
    () => scannerToolchainState({ brew: { state: 'current', outdated: [] } }));
  assert.equal(s.state, 'partial');
  assert.equal(s.counts.absent, 1);
  assert.equal(s.tools[0].state, 'unavailable');
  assert.ok(isUnknown(s));
});

// A stub binary, so these assert the PARSING and not the state of this laptop. The first cut of
// the test below asserted against the real govulncheck: it passed while that binary reported
// v0.0.0, then failed the same day when the inventory flagged it behind and it was upgraded to
// v1.7.0. A test that a `brew upgrade` can turn red was measuring the box, not the code.
const stub = (name, out) => {
  const p = join(T, name);
  writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\n`, { mode: 0o755 });
  return p;
};

test('a tool that cannot state its build is `unstated` — counted apart from `behind`, because upgrading does not fix it', () => {
  // The real govulncheck reported `Scanner: govulncheck@v0.0.0` on 2026-08-22 — what a Go binary
  // built without version stamping emits. v0.0.0 is the ABSENCE of a version wearing a version's
  // shape; publishing it would make every reachability finding it produced look attributable to a
  // build when it is not.
  const bin = stub('govulncheck-unstamped', 'Go: go1.26.6\nScanner: govulncheck@v0.0.0\nDB: https://vuln.go.dev');
  const s = withEnv({ CW_SECURITY_BASELINE: roster([{ id: 'a', requires: { tools: ['govulncheck'] } }]), CW_GOVULNCHECK_BIN: bin },
    () => scannerToolchainState({ brew: { state: 'current', outdated: [] } }));
  const t = s.tools[0];
  assert.equal(t.versionState, 'unstated');
  assert.equal(t.version, null, 'v0.0.0 must never be published as a version');
  assert.equal(s.counts.unstatedVersion, 1);
  assert.equal(s.counts.behind, 0, 'unstated is not staleness — upgrading does not fix an unstamped build');
});

test('the tool\'s OWN version is read, not its runtime\'s — first-match-wins picks the wrong one', () => {
  // govulncheck prints `Go: go1.26.6` BEFORE `Scanner: govulncheck@v1.7.0`. A first-number-wins
  // regex reports the Go COMPILER as the scanner's version, which is how this was found.
  const bin = stub('govulncheck-stamped', 'Go: go1.26.6\nScanner: govulncheck@v1.7.0\nDB: https://vuln.go.dev');
  const s = withEnv({ CW_SECURITY_BASELINE: roster([{ id: 'b', requires: { tools: ['govulncheck'] } }]), CW_GOVULNCHECK_BIN: bin },
    () => scannerToolchainState({ brew: { state: 'current', outdated: [] } }));
  assert.equal(s.tools[0].version, '1.7.0');
  assert.notEqual(s.tools[0].version, '1.26.6', 'that is the Go toolchain, not the scanner');
});

test('a version printed to STDERR is still a version — probing stdout alone read nuclei as unversioned', () => {
  const p = join(T, 'stderr-only');
  writeFileSync(p, '#!/bin/sh\necho "Nuclei Engine Version: v3.11.1" >&2\n', { mode: 0o755 });
  const s = withEnv({ CW_SECURITY_BASELINE: roster([{ id: 'c', requires: { tools: ['nuclei'] } }]), CW_NUCLEI_BIN: p },
    () => scannerToolchainState({ brew: { state: 'current', outdated: [] } }));
  assert.equal(s.tools[0].version, '3.11.1');
  assert.equal(s.tools[0].versionState, 'stated');
});

test('brew being unaskable makes currency UNKNOWN, never current', () => {
  const s = withEnv({ CW_SECURITY_BASELINE: roster([{ id: 'a', requires: { tools: ['gitleaks'] } }]) },
    () => scannerToolchainState({ brew: { manager: 'brew', state: 'failed', reason: 'brew timed out' } }));
  const t = s.tools[0];
  if (t.state !== 'present') return;
  assert.equal(t.currency, 'unknown',
    'a formula absent from an unreadable outdated list is not a formula that is up to date');
});

test('a scanner behind upstream is reported on BREW\'s scale, named as such', () => {
  const s = withEnv({ CW_SECURITY_BASELINE: roster([{ id: 'a', requires: { tools: ['gitleaks'] } }]) },
    () => scannerToolchainState({ brew: { state: 'outdated', outdated: [{ name: 'gitleaks', installed: '8.1.0', latest: '9.0.0' }] } }));
  const t = s.tools[0];
  if (t.state !== 'present') return;
  assert.equal(t.currency, 'behind');
  assert.equal(t.brewLatest, '9.0.0');
  assert.ok(!('latest' in t), 'brew\'s number lives under a brew-named key — it is not always the same quantity as `version`');
  assert.equal(s.state, 'outdated');
});

test('the scanner inventory is actually WIRED — inventory() reports it, not just exports it', () => {
  const inv = inventory({ includeSoftwareUpdate: false });
  const m = inv.managers.find((x) => x.manager === 'scanners');
  assert.ok(m, 'a manager nothing calls reports nothing, which renders as nothing wrong');
});

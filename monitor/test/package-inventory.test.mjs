// package-inventory — every one of these tools reports "nothing is outdated" and "I could not run"
// through the SAME channel: empty output and a quiet exit. So the load-bearing assertion in this
// file is that a manager which could not be ASKED never renders as a manager which had NOTHING TO
// SAY. That is the house explicit uncertainty rule at the one place it is easiest to lose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  brewState, npmGlobalState, toolchainState, softwareUpdateState,
  inventory, publishedView, isUnknown, UNKNOWN_STATES, EOL_MAJORS, EOL_DECLARED_AT,
} from '../package-inventory.mjs';

let dir;
const withEnv = (vars, fn) => {
  const before = {};
  for (const [k, v] of Object.entries(vars)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
const fixture = (name, content) => {
  dir ??= mkdtempSync(join(tmpdir(), 'cw-pkg-'));
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
};

test.after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// ── THE ONE THAT MATTERS ───────────────────────────────────────────────────────────────────────
test('a manager that is not installed is UNAVAILABLE, never "current"', () => {
  const r = withEnv({ CW_BREW_BIN: '/nonexistent/brew-does-not-exist', CW_BREW_OUTDATED_JSON: undefined }, () => brewState({ timeoutMs: 5000 }));
  assert.equal(r.state, 'unavailable');
  assert.ok(isUnknown(r), 'an absent manager must be an UNKNOWN state, so no renderer can draw it green');
  assert.equal(r.outdated, undefined, 'an unavailable manager has no outdated list — an empty one would read as "nothing is outdated"');
  assert.match(r.reason, /not installed/);
});

test('a manager whose output does not parse is FAILED, never empty', () => {
  const p = fixture('garbage.json', 'this is not json');
  const r = withEnv({ CW_BREW_OUTDATED_JSON: p }, () => brewState());
  assert.equal(r.state, 'failed');
  assert.ok(isUnknown(r));
  assert.match(r.reason, /UNKNOWN, not empty/);
});

test('every non-green state is in UNKNOWN_STATES — a new one cannot quietly read as clean', () => {
  for (const s of ['unavailable', 'failed', 'not-asked', 'partial']) assert.ok(UNKNOWN_STATES.has(s), `${s} must be unknown`);
  assert.ok(!UNKNOWN_STATES.has('current'));
  assert.ok(!UNKNOWN_STATES.has('outdated'));
});

// ── BREW ───────────────────────────────────────────────────────────────────────────────────────
test('brew: outdated formulae and casks are both counted, and pinned is named not hidden', () => {
  const p = fixture('brew.json', JSON.stringify({
    formulae: [{ name: 'ollama', installed_versions: ['0.32.9'], current_version: '0.32.13', pinned: false }],
    casks: [{ name: 'codeql', installed_versions: ['2.26.1'], current_version: '2.26.3', pinned: true }],
  }));
  const r = withEnv({ CW_BREW_OUTDATED_JSON: p }, () => brewState());
  assert.equal(r.state, 'outdated');
  assert.equal(r.counts.outdated, 2);
  assert.equal(r.counts.formulae, 1);
  assert.equal(r.counts.casks, 1);
  assert.deepEqual(r.pinned, ['codeql'], 'a pinned package is held back ON PURPOSE — named, never silently dropped or nagged about as plain debt');
});

test('brew: an empty result is CURRENT only because it parsed — and it still carries its freshness', () => {
  const p = fixture('brew-empty.json', JSON.stringify({ formulae: [], casks: [] }));
  const r = withEnv({ CW_BREW_OUTDATED_JSON: p }, () => brewState());
  assert.equal(r.state, 'current');
  assert.equal(r.counts.outdated, 0);
  assert.ok('catalogueAgeDays' in r, 'current is a claim about a catalogue, and its age must travel with it');
});

// `brew outdated` compares against the last fetched catalogue, not the internet — the age must travel
test('brew: an unlocatable catalogue is UNKNOWN age, never assumed fresh', () => {
  const p = fixture('brew-empty2.json', JSON.stringify({ formulae: [], casks: [] }));
  const r = withEnv({ CW_BREW_OUTDATED_JSON: p, CW_BREW_CATALOGUE: '/nonexistent/catalogue', CW_BREW_PREFIX: '/nonexistent-prefix', HOME: '/nonexistent-home' }, () => brewState());
  assert.equal(r.catalogueAgeDays, null);
  assert.match(r.note, /UNKNOWN/, 'an unknown catalogue age must say so, not print "0 days"');
});

// the files inside brew's api cache are transient — naming a single file bets on a layout the
// tool is free to change
test('brew: the catalogue age resolves from the cache DIRECTORY when the named files are absent', () => {
  const home = mkdtempSync(join(tmpdir(), 'cw-brewhome-'));
  const api = join(home, 'Library/Caches/Homebrew/api');
  mkdirSync(api, { recursive: true });
  // Deliberately NO formula.jws.json and NO cask.jws.json — the state the real box was in.
  writeFileSync(join(api, 'cask_names.txt'), 'ollama\n');
  const p = fixture('brew-dir.json', JSON.stringify({ formulae: [], casks: [] }));
  try {
    const r = withEnv({ CW_BREW_OUTDATED_JSON: p, CW_BREW_CATALOGUE: undefined, HOME: home }, () => brewState());
    assert.equal(typeof r.catalogueAgeDays, 'number', 'a cache with no .jws.json still has an age');
    assert.ok(r.catalogueSource && r.catalogueSource.startsWith(api), `expected a source under ${api}, got ${r.catalogueSource}`);
    assert.match(r.note, /last fetched/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── NPM ────────────────────────────────────────────────────────────────────────────────────────
// `npm outdated` exits 1 when something IS outdated — treating that as failure is the inverse mistake
test('npm: a non-zero exit that MEANS "outdated" is parsed, not treated as a failure', () => {
  const p = fixture('npm.json', JSON.stringify({
    npm: { current: '11.19.0', wanted: '12.0.2', latest: '12.0.2', location: '/opt/homebrew/lib/node_modules/npm' },
    '@socketsecurity/cli': { current: '1.1.102', wanted: '1.1.157', latest: '1.1.157', location: '/x' },
  }));
  const r = withEnv({ CW_NPM_OUTDATED_JSON: p }, () => npmGlobalState());
  assert.equal(r.state, 'outdated');
  assert.equal(r.counts.outdated, 2);
  assert.equal(r.counts.self, 1, 'npm upgrading ITSELF is worth calling out — it is the tool doing the upgrading');
});

// ── TOOLCHAIN ──────────────────────────────────────────────────────────────────────────────────
test('toolchain: the EOL table is a dated DECLARATION and an unlisted version is unknown, not supported', () => {
  assert.match(EOL_DECLARED_AT, /^\d{4}-\d{2}-\d{2}$/, 'the table must carry the date a human last checked it');
  const r = toolchainState();
  const npmTool = r.tools.find((t) => t.name === 'npm');
  if (npmTool && npmTool.state === 'present') {
    assert.equal(npmTool.eol, 'unknown', 'npm has no declared EOL threshold, so it must be unknown — never assumed supported');
  }
  assert.ok(r.counts.unknown >= 0);
});

test('toolchain: the EOL note describes the THRESHOLD, so it is true beside any version', () => {
  // a note about one version reads wrong beside another — describe the threshold
  for (const [k, v] of Object.entries(EOL_MAJORS)) {
    assert.match(v.note, /at or below/, `${k}'s note must describe the threshold, not one version`);
  }
});

test('toolchain offers no upgrade command — there is no single safe one for a system interpreter', () => {
  assert.equal(toolchainState().command, undefined, 'absent on purpose, not empty');
});

// ── SOFTWAREUPDATE ─────────────────────────────────────────────────────────────────────────────
test('softwareupdate: silence is UNKNOWN — only its own "No new software" line is evidence of clean', () => {
  const quiet = fixture('su-quiet.txt', '\n');
  const r = withEnv({ CW_SOFTWAREUPDATE_LIST: quiet }, () => softwareUpdateState());
  assert.equal(r.state, 'failed');
  assert.match(r.reason, /UNKNOWN, not clean/);

  const clean = fixture('su-clean.txt', 'Software Update Tool\n\nNo new software available.\n');
  assert.equal(withEnv({ CW_SOFTWAREUPDATE_LIST: clean }, () => softwareUpdateState()).state, 'current');

  const pending = fixture('su-pending.txt', 'Software Update Tool\n\n* Label: macOS Sequoia 15.6-24G100\n\tTitle: macOS Sequoia\n');
  const p = withEnv({ CW_SOFTWAREUPDATE_LIST: pending }, () => softwareUpdateState());
  assert.equal(p.state, 'outdated');
  assert.equal(p.counts.outdated, 1);
});

test('softwareupdate is never applyable, and carries the reason on the payload', () => {
  const clean = fixture('su-clean2.txt', 'No new software available.\n');
  const r = withEnv({ CW_SOFTWAREUPDATE_LIST: clean }, () => softwareUpdateState());
  assert.equal(r.applyable, false, 'an OS update can force a reboot — no endpoint may start one');
  assert.match(r.applyableReason, /reboot/);
});

// ── PUBLISHED VIEW ─────────────────────────────────────────────────────────────────────────────
// a full inventory is a machine fingerprint and an attack-surface listing
test('the published view carries counts and states but no package names, versions or paths', () => {
  const p = fixture('brew2.json', JSON.stringify({
    formulae: [{ name: 'trufflehog', installed_versions: ['3.96.0'], current_version: '3.97.0', pinned: false }], casks: [],
  }));
  const inv = withEnv({ CW_BREW_OUTDATED_JSON: p }, () => inventory({ includeSoftwareUpdate: false }));
  const pub = publishedView(inv);
  const s = JSON.stringify(pub);
  assert.ok(!/trufflehog/.test(s), 'a package NAME reached the published payload — that is the fingerprint');
  assert.ok(!/3\.96\.0/.test(s), 'a version reached the published payload');
  assert.ok(!/\/opt\/homebrew/.test(s), 'a filesystem path reached the published payload');
  const brew = pub.managers.find((m) => m.manager === 'brew');
  assert.equal(brew.counts.outdated, 1, 'the count still crosses — the security question is answerable without the names');
  assert.match(brew.withheld, /withheld/, 'and the withholding is STATED, so a redacted list is not mistaken for an empty one');
});

test('a not-asked manager is reported as not-asked, never as up to date', () => {
  const inv = inventory({ includeSoftwareUpdate: false });
  const su = inv.managers.find((m) => m.manager === 'softwareupdate');
  assert.equal(su.state, 'not-asked');
  assert.ok(isUnknown(su));
  assert.match(su.reason, /not the same as up to date/);
});

test('CW_* seams are read at CALL time, not module load', () => {
  const p = fixture('late.json', JSON.stringify({ formulae: [], casks: [] }));
  // if the seam were captured at import, this override would be ignored
  const r = withEnv({ CW_BREW_OUTDATED_JSON: p }, () => brewState());
  assert.equal(r.state, 'current');
});

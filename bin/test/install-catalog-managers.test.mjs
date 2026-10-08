// The catalogue's SHAPE contract, and the defect it exists to stop repeating.
//
// manifests/install-catalog.json has two entry shapes: brew/winget/scoop/pipx/npm carry a PACKAGE
// ID which the manager's install verb wraps, while cargo/gem/composer/go carry a WHOLE COMMAND
// STRING ("cargo install cargo-audit --locked") because the language managers each want their own
// flags. bin/setup.mjs's MANAGERS table implemented only the first shape, so every command-string
// entry was INERT: `toolPlan()`'s `managers.find((m) => spec[m])` could never select one.
//
// cargo-audit, brakeman, bundle-audit, psalm and phpcs-security-audit have NO other installer, so
// all five reported "no installer for this platform" on every platform — including a Windows box
// with cargo already on PATH, where the declared command would simply have worked. An entry no
// manager can act on is worse than a missing entry, because the missing one is a gap somebody can
// see and the inert one looks like coverage.
//
// So the shape is now asserted rather than remembered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, argvFor, absenceKind, KNOWN_MANAGERS, installHintFor, postInstallSteps } from '../setup.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = JSON.parse(readFileSync(join(CW, 'manifests', 'install-catalog.json'), 'utf8'));

const ID_MANAGERS = ['brew', 'winget', 'scoop', 'pipx', 'npm', 'apt', 'dnf'];
const CMD_MANAGERS = ['cargo', 'gem', 'composer', 'go'];

test('EVERY manager key used in the catalogue is one bin/setup.mjs can actually drive', () => {
  // The check that would have caught the original defect the day it was introduced.
  // `steps` is a manual entry's instructions for a person, keyed by the checks that report them.
  const NON_MANAGER = new Set(['why', 'url', 'manual', 'ready', 'requiresAccount', 'requiredBy',
    'postInstall', 'providedBy', 'steps', 'platforms']);
  const unknown = new Map();
  for (const [name, spec] of Object.entries(CATALOG.tools)) {
    for (const key of Object.keys(spec)) {
      if (NON_MANAGER.has(key) || KNOWN_MANAGERS.includes(key)) continue;
      unknown.set(key, [...(unknown.get(key) || []), name]);
    }
  }
  assert.deepEqual([...unknown.entries()], [],
    'a catalogue key no manager implements is INERT — the tool silently reports "no installer" forever');
});

test('an entry is either a bare package id or a command led by its own manager — never a mixture', () => {
  // The shape is DETECTED, not declared, because the catalogue genuinely uses both under one key:
  // psalm.composer is the id "vimeo/psalm:6.x-dev" and phpcs-security-audit.composer is the
  // command "composer global require pheromone/…". What must hold is that every value is
  // unambiguously ONE of the two — a multi-word value NOT led by its manager is neither, and
  // would be wrapped into `composer global require "some words"`.
  for (const [name, spec] of Object.entries(CATALOG.tools)) {
    for (const m of KNOWN_MANAGERS) {
      const v = spec[m];
      if (v === null || v === undefined || m === 'release') continue;
      assert.equal(typeof v, 'string', `${name}.${m} must be a string`);
      const s = v.trim();
      assert.ok(s.length, `${name}.${m} must not be empty`);
      const isCommand = new RegExp(`^${m}\\s`).test(s);
      const isBareId = !/\s/.test(s);
      assert.ok(isCommand || isBareId,
        `${name}.${m} = ${JSON.stringify(v)} is neither a bare package id nor a command beginning with "${m}"`);
      assert.ok(!/["'`$|&;<>]/.test(s),
        `${name}.${m} contains shell metacharacters; these are spawned as an argv array, never through a shell`);
      // An ID-manager entry that is a command would be a real confusion, since those wrappers
      // already supply the verb. None exist; asserted so none appear.
      if (ID_MANAGERS.includes(m)) {
        assert.ok(isBareId, `${name}.${m} must be a bare package id — ${m} supplies its own install verb`);
      }
    }
  }
  assert.ok(CMD_MANAGERS.every((m) => KNOWN_MANAGERS.includes(m)), 'the language managers are all driveable');
});

test('BOTH postInstall shapes are handled, and prose is never executed', () => {
  // The catalogue has one array-of-argv entry (codeql) and SIX prose strings. installOne() and the
  // not-ready report both iterated postInstall and called .join(' ') on each element — with a
  // string that iterates CHARACTERS, and 'n'.join is not a function. A TypeError mid-install for
  // six of forty-six tools, on every platform.
  const codeql = postInstallSteps(CATALOG.tools.codeql);
  assert.equal(codeql.commands.length, 1, 'an array of argv arrays yields commands');
  assert.equal(codeql.commands[0][0], 'codeql');
  assert.deepEqual(codeql.notes, []);

  const brakeman = postInstallSteps(CATALOG.tools.brakeman);
  assert.deepEqual(brakeman.commands, [], 'PROSE IS NEVER A COMMAND — it must not be spawned');
  assert.equal(brakeman.notes.length, 1);
  assert.match(brakeman.notes[0], /Ruby/);

  // Every catalogue entry must survive the reader without throwing, which is the actual bug.
  for (const [name, spec] of Object.entries(CATALOG.tools)) {
    const r = postInstallSteps(spec);
    assert.ok(Array.isArray(r.commands) && Array.isArray(r.notes), `${name} postInstall unreadable`);
    for (const c of r.commands) {
      assert.ok(c.length && c.every((a) => typeof a === 'string'), `${name} produced a bad argv: ${JSON.stringify(c)}`);
    }
  }
  // Unrecognised shapes degrade to a note rather than being spawned.
  assert.deepEqual(postInstallSteps({ postInstall: [{ weird: 1 }] }).commands, []);
  assert.equal(postInstallSteps({ postInstall: [{ weird: 1 }] }).notes.length, 1);
  assert.deepEqual(postInstallSteps({}), { commands: [], notes: [] });
  assert.deepEqual(postInstallSteps(null), { commands: [], notes: [] });
});

test('argvFor honours both shapes', () => {
  assert.deepEqual(argvFor('brew', 'trivy'), ['brew', 'install', 'trivy']);
  assert.deepEqual(argvFor('npm', '@socketsecurity/cli'), ['npm', 'install', '-g', '@socketsecurity/cli']);
  assert.deepEqual(argvFor('pipx', 'semgrep'), ['pipx', 'install', 'semgrep']);
  assert.deepEqual(argvFor('winget', 'zizmor.zizmor').slice(0, 4), ['winget', 'install', '--id', 'zizmor.zizmor']);
  // command strings are SPLIT, not wrapped — wrapping would produce
  // `cargo install "cargo install cargo-audit --locked"`
  assert.deepEqual(argvFor('cargo', 'cargo install cargo-audit --locked'),
    ['cargo', 'install', 'cargo-audit', '--locked']);
  assert.deepEqual(argvFor('gem', 'gem install brakeman'), ['gem', 'install', 'brakeman']);
  assert.deepEqual(argvFor('go', 'go install golang.org/x/vuln/cmd/govulncheck@latest'),
    ['go', 'install', 'golang.org/x/vuln/cmd/govulncheck@latest']);
  // …and a BARE ID under the same manager is wrapped in that manager's verb. Both shapes appear
  // under `composer` in the real catalogue, which is why the shape is detected per value.
  assert.deepEqual(argvFor('composer', 'vimeo/psalm:6.x-dev'),
    ['composer', 'global', 'require', 'vimeo/psalm:6.x-dev']);
  assert.deepEqual(argvFor('composer', 'composer global require pheromone/phpcs-security-audit'),
    ['composer', 'global', 'require', 'pheromone/phpcs-security-audit']);
  assert.deepEqual(argvFor('cargo', 'cargo-audit'), ['cargo', 'install', 'cargo-audit'],
    'a bare id is wrapped, never mistaken for a command because it starts with the letters "cargo"');
  assert.equal(argvFor('nope', 'x'), null, 'an unknown manager yields no argv rather than a guess');
  assert.equal(argvFor('cargo', ''), null);
  assert.equal(argvFor('cargo', null), null);
});

test('every tool the catalogue claims to install RESOLVES to a runnable argv', () => {
  // The end-to-end version of the shape test: not "is the field well-formed" but "does it produce
  // something we could actually spawn". This is the assertion that fails if a fifth shape appears.
  for (const [name, spec] of Object.entries(CATALOG.tools)) {
    for (const m of KNOWN_MANAGERS) {
      if (spec[m] === null || spec[m] === undefined || m === 'release') continue;
      const argv = argvFor(m, spec[m]);
      assert.ok(Array.isArray(argv) && argv.length >= 2 && argv.every((a) => typeof a === 'string' && a.length),
        `${name}.${m} does not produce a runnable argv: ${JSON.stringify(argv)}`);
    }
  }
});

// ── the three absences ─────────────────────────────────────────────────────────────────────────
// One sentence for all of them is what hid the inert managers. 'no installer for this platform'
// was printed for a tool whose installer we had, for a tool that arrives with another tool, and
// for a tool nobody ever wrote an installer for. Only the first is even about the platform.

test('absenceKind separates a platform fact from a gap in our own data', () => {
  assert.equal(absenceKind({ manual: true, url: 'x' }), 'manual');
  assert.equal(absenceKind({ providedBy: 'elixir' }), 'provided-by');
  assert.equal(absenceKind({ gem: 'gem install brakeman' }), 'needs-manager',
    'we HAVE an installer; the manager is missing from this box — one human action');
  assert.equal(absenceKind({ url: 'x' }), 'catalog-gap',
    'nobody ever wrote an installer — OUR gap, and it must not be blamed on the platform');
});

test('the catalogue\'s real gaps are named, and are the only ones', () => {
  const gaps = Object.entries(CATALOG.tools)
    .filter(([, spec]) => absenceKind(spec) === 'catalog-gap')
    .map(([n]) => n).sort();
  // Pinned deliberately: a NEW uninstallable tool should fail this and be a decision, not a drift.
  assert.deepEqual(gaps, ['opengrep', 'sobelow'],
    'a tool with no installer for any manager is a hole in the catalogue — declare it here knowingly');
});

test('providedBy is READ, not just declared — it used to render as "no installer"', () => {
  assert.equal(CATALOG.tools.mix.providedBy, 'elixir', 'fixture assumption');
  assert.match(installHintFor('mix'), /arrives with elixir/,
    'a tool that ships with another tool must say so, not claim it cannot be installed');
  assert.equal(CATALOG.tools['cargo-clippy'].providedBy, 'cargo');
  assert.match(installHintFor('cargo-clippy'), /arrives with cargo/);
});

test('a hint for a tool needing an absent manager NAMES the manager', () => {
  // `brakeman` is gem-only. On a box without gem the old hint was a url; a url is a reading
  // assignment, and the manager name is one action.
  const hint = installHintFor('brakeman');
  assert.ok(/gem/.test(hint), `the hint must name gem: ${hint}`);
});

test('the five tools that were uninstallable everywhere now have a real installer', () => {
  // The regression this whole item is about. Each of these has ONLY a command-string manager, so
  // each was inert; if a future edit drops the command-string support they go back to silent.
  for (const [name, manager] of [
    ['cargo-audit', 'cargo'], ['brakeman', 'gem'], ['bundle-audit', 'gem'],
    ['psalm', 'composer'], ['phpcs-security-audit', 'composer'],
  ]) {
    const spec = CATALOG.tools[name];
    assert.ok(spec[manager], `${name} must still declare a ${manager} installer`);
    assert.ok(KNOWN_MANAGERS.includes(manager), `${manager} must remain a manager setup.mjs drives`);
    assert.ok(argvFor(manager, spec[manager]).length >= 3, `${name} must resolve to a runnable argv`);
    assert.notEqual(absenceKind(spec), 'catalog-gap', `${name} must not read as an uninstallable tool`);
  }
});

test('WINDOWS — every id added in the 2026-09-04 pass is one that was VERIFIED, not guessed', () => {
  // These four were checked on the box: `winget search` returned zizmor.zizmor and
  // GolangCI.golangci-lint; the two `go install` lines were RUN and both binaries resolve on PATH.
  // Pinned so a later edit cannot quietly replace a verified id with a plausible one.
  assert.equal(CATALOG.tools.zizmor.winget, 'zizmor.zizmor');
  assert.equal(CATALOG.tools['golangci-lint'].winget, 'GolangCI.golangci-lint');
  assert.equal(CATALOG.tools.gosec.go, 'go install github.com/securego/gosec/v2/cmd/gosec@latest');
  assert.equal(CATALOG.tools.govulncheck.go, 'go install golang.org/x/vuln/cmd/govulncheck@latest');
  assert.match(loadCatalog().note, /VERIFIED ON THE BOX/,
    'the catalogue note must keep recording that ids are checked rather than copied');
});

test('every release entry pins an upstream repo, a tag and a SHA-256 per platform and architecture', () => {
  const entries = Object.entries(CATALOG.tools).filter(([, spec]) => spec.release);
  assert.ok(entries.length >= 2, 'gitleaks and trufflehog install from a pinned release on Linux');
  for (const [name, { release }] of entries) {
    assert.match(release.repo, /^[\w.-]+\/[\w.-]+$/, `${name}.release.repo`);
    assert.match(release.tag, /^v?\d+\.\d+\.\d+$/, `${name}.release.tag`);
    for (const [plat, arches] of Object.entries(release).filter(([k]) => !['repo', 'tag'].includes(k))) {
      for (const [a, asset] of Object.entries(arches)) {
        assert.match(asset.sha256, /^[0-9a-f]{64}$/, `${name}.release.${plat}.${a}.sha256`);
        assert.ok(asset.asset.endsWith('.tar.gz') && asset.asset.includes(release.tag.replace(/^v/, '')), `${name}.release.${plat}.${a}.asset names the pinned version`);
      }
    }
  }
});

test('a release entry resolves to a download of the pinned asset on Linux and to nothing elsewhere', () => {
  const saved = { p: process.env.CW_SETUP_PLATFORM, a: process.env.CW_SETUP_ARCH };
  try {
    process.env.CW_SETUP_PLATFORM = 'linux'; process.env.CW_SETUP_ARCH = 'x64';
    const argv = argvFor('release', CATALOG.tools.gitleaks.release);
    assert.deepEqual(argv.slice(0, 2), ['download', 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz']);
    process.env.CW_SETUP_PLATFORM = 'darwin';
    assert.equal(argvFor('release', CATALOG.tools.gitleaks.release), null);
  } finally {
    for (const [k, v] of [['CW_SETUP_PLATFORM', saved.p], ['CW_SETUP_ARCH', saved.a]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// commitwork monitor — WHAT IS INSTALLED ON THIS BOX, AND WHAT IS BEHIND.
//
//   node monitor/package-inventory.mjs              readable table
//   node monitor/package-inventory.mjs --json       machine-readable (FULL detail, local only)
//   node monitor/package-inventory.mjs --published  the redacted shape the panel may serve
//
// WHY IT IS ITS OWN OBSERVATION MODULE. Same split as monitor/host-inventory.mjs: /api/config
// assembles the DECLARED configuration from disk, and this is an OBSERVATION — a live look at what
// is actually installed right now. They can disagree, and their disagreeing is the interesting
// part. Folding an observation into a config payload is the conflation host-inventory was written
// to prevent.
//
// DECLARATION SPLIT FROM AUTHORITY. This file is STRICTLY READ-ONLY. It runs `brew outdated`,
// `npm -g outdated`, `--version` probes and `softwareupdate --list`; it installs, upgrades, pins
// and removes NOTHING, and it takes no argument that could be mistaken for an instruction to.
// Applying is a separate, deliberately-gated surface (admin/routes/packages.mjs), and on this
// project applying stays a human act.
//
// fact: every manager here reports "nothing is outdated" and "I could not run" down the SAME channel — empty stdout, exit 0 / `brew outdated --json=v2` with no brew, a broken tap, or a timeout all produce nothing, and nothing parses very naturally into "you are up to date" (expiry: never, prev: broken)
// fact: so every manager returns an explicit `state` and `current` is reachable ONLY from a parsed successful run — unaskable is `unavailable` or `failed`, never an empty list / the panel must render those differently from green (expiry: never, prev: broken)
//
// FRESHNESS IS PART OF THE ANSWER. `brew outdated` compares against the LAST FETCHED tap, not
// against the internet. A tap last updated three weeks ago will confidently report "up to date"
// about a world it has not looked at, which is the same false-clean shape one layer out. So the
// tap's own age travels with the result and the panel shows it.

import { nowISO } from '../lib/clock.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { rethrowIfBug, rethrowIfBugParsing } from '../bin/rethrow.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeToolVersion } from './tool-version.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// Read at CALL time, never at module load (house rule) — a const at import silently defeats the
// override for any test that sets it afterwards, so the test passes while proving nothing. The
// JSON seams let the whole suite run on fixtures without a package manager present.
const env = (k) => process.env[k] || '';

const BREW = () => env('CW_BREW_BIN') || 'brew';
const NPM = () => env('CW_NPM_BIN') || 'npm';
const SOFTWAREUPDATE = () => env('CW_SOFTWAREUPDATE_BIN') || 'softwareupdate';

/** Run a command and classify the OUTCOME, so "no output" can never be confused with "no news". */
function probe(bin, args, { timeoutMs = 45_000, okExit = [0] } = {}) {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (e) {
    rethrowIfBug(e);
    // ENOENT is the ONLY "legitimately absent" — the tool is not installed on this box. Everything
    // else (non-zero exit, timeout, permission) is a FAILED observation, which is a different state
    // and must not read as absence. Several of these tools exit non-zero to MEAN something (npm
    // outdated exits 1 when anything is outdated), so the caller declares its own acceptable codes.
    if (e && e.code === 'ENOENT') return { ok: false, state: 'unavailable', reason: `${bin} is not installed on this box` };
    if (e && (e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM')) {
      return { ok: false, state: 'failed', reason: `${bin} ${args[0] || ''} timed out after ${timeoutMs}ms — the answer is UNKNOWN, not empty` };
    }
    if (e && typeof e.status === 'number' && okExit.includes(e.status)) return { ok: true, out: String(e.stdout || '') };
    const why = (e && (e.stderr || e.message) ? String(e.stderr || e.message).split('\n')[0] : 'unknown error').slice(0, 200);
    return { ok: false, state: 'failed', reason: `${bin} ${args[0] || ''} failed (${why}) — the answer is UNKNOWN, not empty` };
  }
}

/** A fixture seam: when the env names a file, read THAT instead of shelling out. */
function fixtureOr(envKey, run) {
  const p = env(envKey);
  if (!p) return run();
  try { return { ok: true, out: readFileSync(p, 'utf8') }; } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, state: 'unavailable', reason: `fixture ${p} does not exist` };
    return { ok: false, state: 'failed', reason: `fixture ${p} unreadable (${e.code})` };
  }
}

const parsed = (r, label) => {
  if (!r.ok) return r;
  try { return { ok: true, json: JSON.parse(r.out || 'null') }; } catch (e) {
    rethrowIfBugParsing(e);
    // A parse failure is never an empty store (house rule).
    return { ok: false, state: 'failed', reason: `${label} output did not parse as JSON (${e.message.split('\n')[0]}) — UNKNOWN, not empty` };
  }
};

// ── HOMEBREW ────────────────────────────────────────────────────────────────────────────────────
export function brewState({ timeoutMs = 45_000 } = {}) {
  const r = parsed(fixtureOr('CW_BREW_OUTDATED_JSON', () => probe(BREW(), ['outdated', '--json=v2'], { timeoutMs })), 'brew outdated');
  if (!r.ok) return { manager: 'brew', state: r.state, reason: r.reason };
  const j = r.json || {};
  const map = (rows, kind) => (Array.isArray(rows) ? rows : []).map((x) => ({
    kind,
    name: String(x.name || ''),
    installed: Array.isArray(x.installed_versions) ? x.installed_versions.join(', ') : String(x.installed_versions ?? ''),
    latest: String(x.current_version ?? ''),
    pinned: !!x.pinned,
  }));
  const outdated = [...map(j.formulae, 'formula'), ...map(j.casks, 'cask')];

  // THE CATALOGUE'S OWN AGE. `brew outdated` compares against the last fetched catalogue, not
  // against the internet: a stale catalogue reports "up to date" about a world it has not looked
  // at, which is the false-clean shape one layer out. Reported, never silently assumed fresh.
  //
  // fact: naming any single file inside brew's cache is betting on a layout brew is free to change / cut 1 looked for the homebrew-core tap clone, which brew 4+ (API-backed) keeps no copy of, and reported UNKNOWN on a minutes-old catalogue; cut 2 named the .jws.json payloads, which brew downloads and then UNPACKS — observed EXISTS then MISSING one call apart (expiry: never, prev: wrong)
  //
  // So the candidates include the DIRECTORY itself, whose mtime moves whenever brew rewrites the
  // cache, and the newest of whatever is found wins. The source is named in the payload, because
  // "unknown because absent" and "unknown because I looked in the wrong place" are different
  // answers and only one of them is about the machine.
  let catalogueAgeDays = null;
  let catalogueSource = null;
  const apiDir = join(process.env.HOME || '', 'Library/Caches/Homebrew/api');
  const candidates = [
    ...(env('CW_BREW_CATALOGUE') ? [env('CW_BREW_CATALOGUE')] : []),
    apiDir,
    join(apiDir, 'formula_names.txt'),
    join(apiDir, 'cask_names.txt'),
    join(apiDir, 'formula.jws.json'),
    join(apiDir, 'cask.jws.json'),
    '/opt/homebrew/Library/Taps/homebrew/homebrew-core',
  ];
  let newestMs = null;
  for (const p of candidates) {
    try {
      if (!p || !existsSync(p)) continue;
      const ms = statSync(p).mtimeMs;
      if (newestMs === null || ms > newestMs) { newestMs = ms; catalogueSource = p; }
    } catch { /* an unreadable candidate is not an answer; keep looking */ }
  }
  if (newestMs !== null) catalogueAgeDays = Math.floor((Date.parse(nowISO()) - newestMs) / 86_400_000);
  const tapAgeDays = catalogueAgeDays;   // retained name for existing readers

  const pinnedNames = outdated.filter((x) => x.pinned).map((x) => x.name);
  return {
    manager: 'brew',
    state: outdated.length ? 'outdated' : 'current',
    outdated,
    counts: { outdated: outdated.length, formulae: outdated.filter((x) => x.kind === 'formula').length, casks: outdated.filter((x) => x.kind === 'cask').length, pinned: pinnedNames.length },
    pinned: pinnedNames,
    tapAgeDays,
    catalogueAgeDays,
    catalogueSource,
    // Pinned packages are held back ON PURPOSE. Counting them as plain debt would nag forever about
    // a deliberate decision; hiding them would conceal a package that can never update. Named.
    note: catalogueAgeDays === null
      ? 'catalogue age UNKNOWN — no brew catalogue found at any known location, so this comparison may be against a world brew has not looked at recently'
      : `compared against a catalogue last fetched ${catalogueAgeDays} day(s) ago`,
    command: 'brew upgrade',
  };
}

// ── GLOBAL NPM ──────────────────────────────────────────────────────────────────────────────────
export function npmGlobalState({ timeoutMs = 60_000 } = {}) {
  // `npm outdated` exits 1 WHEN SOMETHING IS OUTDATED. Treating that as failure would report the
  // interesting case as unknown — the inverse of the usual mistake, and just as wrong.
  const r = parsed(fixtureOr('CW_NPM_OUTDATED_JSON', () => probe(NPM(), ['-g', 'outdated', '--json'], { timeoutMs, okExit: [0, 1] })), 'npm outdated');
  if (!r.ok) return { manager: 'npm-global', state: r.state, reason: r.reason };
  const j = r.json || {};
  const outdated = Object.entries(j).map(([name, v]) => ({
    kind: 'npm-global',
    name,
    installed: String(v.current ?? ''),
    latest: String(v.latest ?? v.wanted ?? ''),
    location: String(v.location ?? ''),
    // npm upgrading ITSELF is worth calling out: it is the tool doing the upgrading.
    self: name === 'npm',
  }));
  return {
    manager: 'npm-global',
    state: outdated.length ? 'outdated' : 'current',
    outdated,
    counts: { outdated: outdated.length, self: outdated.filter((x) => x.self).length },
    command: 'npm -g update',
  };
}

// ── TOOLCHAIN IN USE ────────────────────────────────────────────────────────────────────────────
// WHICH interpreter the fleet's scripts actually resolve to, not which one is installed somewhere.
// The gates need the Node.js floor package.json declares, and the sweep shells python and ruby.
//
// fact: the EOL table is a DECLARATION refreshed by a human, not a lookup, and a version not in it is `unknown` never `supported` / guessing "probably fine" for an unlisted major is the unsupported-pass move this project refuses, and a table that rots into optimism is worse than none (expiry: on each human refresh of this table, prev: unknown)
// fact: each note describes the THRESHOLD, not the installed version / the first cut printed "ruby 2.6.10 END-OF-LIFE — Ruby 3.0 reached end-of-life 2024-04", which reads as a claim about 3.0 and invites the reader to think 2.6 is the newer of the two (expiry: never, prev: wrong)
export const EOL_MAJORS = {
  // declared 2026-08-14 — refresh against the upstream release schedules, never infer
  node: { eolAtOrBelow: 18, note: 'anything at or below Node 18 is end-of-life (18 ended 2025-04-30)' },
  python: { eolAtOrBelow: 3.9, note: 'anything at or below Python 3.9 is end-of-life (3.9 ended 2025-10)' },
  ruby: { eolAtOrBelow: 3.0, note: 'anything at or below Ruby 3.0 is end-of-life (3.0 ended 2024-04)' },
};
export const EOL_DECLARED_AT = '2026-08-14';

function versionOf(bin, args = ['--version']) {
  const r = probe(bin, args, { timeoutMs: 10_000 });
  if (!r.ok) return { ok: false, state: r.state, reason: r.reason };
  const m = String(r.out).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return { ok: false, state: 'failed', reason: `could not parse a version from ${bin} output — UNKNOWN, not absent` };
  return { ok: true, version: `${m[1]}.${m[2]}.${m[3]}`, major: Number(m[1]), minor: Number(m[2]) };
}

export function toolchainState() {
  const want = [
    ['node', 'node', 'node'],
    ['npm', 'npm', null],
    ['python3', 'python3', 'python'],
    ['ruby', 'ruby', 'ruby'],
  ];
  const tools = [];
  for (const [label, bin, eolKey] of want) {
    const v = versionOf(env(`CW_${label.toUpperCase().replace(/[^A-Z0-9]/g, '')}_BIN`) || bin);
    if (!v.ok) { tools.push({ name: label, state: v.state, reason: v.reason }); continue; }
    let eol = 'unknown';
    if (eolKey && EOL_MAJORS[eolKey]) {
      const threshold = EOL_MAJORS[eolKey].eolAtOrBelow;
      const cmp = eolKey === 'python' ? Number(`${v.major}.${v.minor}`) : v.major;
      eol = cmp <= threshold ? 'end-of-life' : 'supported';
    }
    tools.push({
      name: label,
      state: 'present',
      version: v.version,
      eol,
      eolNote: eol === 'end-of-life' && eolKey ? EOL_MAJORS[eolKey].note : null,
      path: null,   // filled by the caller only for the operator port — it is a filesystem layout
    });
  }
  const eolCount = tools.filter((t) => t.eol === 'end-of-life').length;
  return {
    manager: 'toolchain',
    state: eolCount ? 'end-of-life' : tools.some((t) => t.state !== 'present') ? 'partial' : 'current',
    tools,
    counts: { tools: tools.length, endOfLife: eolCount, unknown: tools.filter((t) => t.eol === 'unknown').length },
    eolDeclaredAt: EOL_DECLARED_AT,
    // No `command`: there is no single safe upgrade for a system interpreter, and offering one
    // would be the page overstepping. Deliberately absent rather than empty.
  };
}

// ── THE INSTRUMENTS THEMSELVES ─────────────────────────────────────────────────────────────────
// fact: toolchainState() inventories the four interpreters this box RUNS code with, not the twenty-six tools this project makes its CLAIMS with (expiry: when the scanners are inventoried too, prev: not built)
// fact: that gap has a measured cost / on 2026-08-22 the trufflehog stamp in manifests/security-baseline.json read 3.95.9, the box ran 3.96.0, upstream 3.97.0, and the drift manufactured 1,311 of the fleet's 1,314 published CRITICALs from one detector already fixed upstream — nothing in the sweep could see it because nothing was watching the watchers (expiry: never, prev: broken)
//
// THE LIST IS DERIVED, NEVER HAND-KEPT. It comes from the roster's own `requires.tools`, so a check
// cannot declare a dependency this inventory does not then probe. A hand-copied list would drift
// from the manifest within a week and would drift SILENTLY, reporting full coverage of a set it had
// stopped matching — the same shape as the panel's 12-of-25 label map.
//
// AN UNPARSEABLE VERSION IS `unknown`, NEVER CURRENT. A tool that answers but whose output carries
// no version is a failed observation, not a fresh install, and the difference decides whether the
// findings it produced can be attributed to a build later.
const SCANNER_ROSTER = () => env('CW_SECURITY_BASELINE')
  || join(dirname(fileURLToPath(import.meta.url)), '..', 'manifests', 'security-baseline.json');
const SCANNER_CATALOG = () => env('CW_INSTALL_CATALOG')
  || join(dirname(fileURLToPath(import.meta.url)), '..', 'manifests', 'install-catalog.json');

// The interpreters and shells toolchainState() already covers, plus the ones that are a RUNTIME for
// a scanner rather than a scanner. Listed so the two inventories do not double-report one binary.
const NOT_A_SCANNER = new Set(['node', 'npm', 'npx', 'bash', 'go', 'java', 'docker', 'deno']);

// The version-parsing rules live in monitor/tool-version.mjs — ONE declaration, because the sweep
// stamps versions onto findings with the same rules and a second copy would let the box's answer
// and the artifact's answer disagree about the same binary.

export function scannerToolchainState({ timeoutMs = 15_000, brew = null } = {}) {
  let roster;
  try { roster = JSON.parse(readFileSync(SCANNER_ROSTER(), 'utf8')); }
  catch (e) {
    // Fail closed: no roster means we cannot say WHICH tools matter, which is not the same as
    // "no tools matter". Never an empty inventory.
    return { manager: 'scanners', state: 'failed',
      reason: `could not read the check roster (${String(e.code || e.message).slice(0, 80)}) — the scanner set is UNKNOWN, not empty` };
  }
  const wanted = new Set();
  for (const c of (roster.checks || [])) for (const t of ((c.requires && c.requires.tools) || [])) {
    if (!NOT_A_SCANNER.has(t)) wanted.add(t);
  }
  if (!wanted.size) {
    return { manager: 'scanners', state: 'failed',
      reason: 'the roster declares no tool requirements at all — that is a manifest defect, not a box with nothing installed' };
  }

  let catalog = {};
  try { catalog = JSON.parse(readFileSync(SCANNER_CATALOG(), 'utf8')); } catch { catalog = {}; }
  const catalogTools = catalog.tools || catalog;

  // brew's outdated set, so "installed" and "installed but behind" are different answers. Passed in
  // by the caller when it already has one — probing brew once per scanner would be 19 subprocesses
  // to answer a question one call already answered.
  const b = brew || brewState({ timeoutMs: 45_000 });
  const behind = new Map();
  for (const o of (b && Array.isArray(b.outdated) ? b.outdated : [])) behind.set(o.name, o);

  const tools = [];
  for (const name of [...wanted].sort()) {
    const r = probeToolVersion(name, { timeoutMs });
    const install = catalogTools[name] || null;
    const hint = install ? (install.brew ? `brew install ${install.brew}` : install.url || null) : null;
    const o = behind.get((install && install.brew) || name);
    // brew's verdict is about the FORMULA and is authoritative on its own terms, whether or not the
    // binary can state a version. It is reported under its own key for that reason: `brewLatest` is
    // brew's scale, `version` is the tool's, and the two are not always the same quantity.
    const brewView = o ? { currency: 'behind', brewInstalled: o.installed, brewLatest: o.latest }
      : (b && b.state === 'current') || (b && b.state === 'outdated') ? { currency: 'current' } : { currency: 'unknown' };
    if (r.state !== 'present') {
      // `unavailable` is the tool genuinely not being here — declared, and the check that needs it
      // will skip visibly. `failed` is an observation we could not make, which is worse and is said
      // so. Neither is ever collapsed into the other.
      tools.push({ name, state: r.state, reason: r.reason, install: hint });
      continue;
    }
    if (r.versionState === 'unstated') {
      tools.push({ name, state: 'present', version: null, ...brewView, versionState: 'unstated', reason: r.reason, install: hint });
      continue;
    }
    tools.push({ name, state: 'present', version: r.version, versionState: 'stated', ...brewView, install: hint });
  }

  const counts = {
    declared: tools.length,
    present: tools.filter((t) => t.state === 'present').length,
    absent: tools.filter((t) => t.state === 'unavailable').length,
    unobservable: tools.filter((t) => t.state === 'failed').length,
    behind: tools.filter((t) => t.currency === 'behind').length,
    // Installed, answering, and unable to say WHICH BUILD it is. Counted separately from `behind`
    // because it is not a staleness problem — it is an attribution one, and it does not go away by
    // upgrading. Every finding such a tool produces is unattributable to a build after the fact.
    unstatedVersion: tools.filter((t) => t.versionState === 'unstated').length,
    currencyUnknown: tools.filter((t) => t.state === 'present' && t.currency === 'unknown').length,
  };
  return {
    manager: 'scanners',
    // `partial` when a declared instrument is missing or unreadable: the roster says the fleet is
    // scanned by N tools and it is not. Only a fully present, fully current set is `current`.
    state: counts.absent || counts.unobservable ? 'partial' : counts.behind ? 'outdated' : 'current',
    tools, counts,
    catalogueAgeDays: (b && b.catalogueAgeDays) ?? null,
    rosterSource: SCANNER_ROSTER().replace(process.env.HOME || '', '~'),
  };
}

// ── macOS SOFTWAREUPDATE — OBSERVATION ONLY, BY DESIGN ──────────────────────────────────────────
// No apply path exists for this manager anywhere in the codebase, and that is a decision rather
// than an omission: a pending OS update can force a REBOOT, which is a different class of act from
// upgrading a formula and is not something a web page should be able to start. The panel shows what
// is pending and prints the command; a human runs it, having decided when to lose the machine.
export function softwareUpdateState({ timeoutMs = 90_000 } = {}) {
  const r = fixtureOr('CW_SOFTWAREUPDATE_LIST', () => probe(SOFTWAREUPDATE(), ['--list'], { timeoutMs }));
  if (!r.ok) return { manager: 'softwareupdate', state: r.state, reason: r.reason, applyable: false };
  const text = String(r.out || '');
  // The tool writes its findings to stderr on some releases and stdout on others, and says
  // "No new software available." when there is nothing. Absence of that sentence AND absence of
  // any parsed row is UNKNOWN, not clean — the sentence is the only positive evidence of clean.
  const none = /No new software available/i.test(text);
  const rows = [...text.matchAll(/^\s*\*\s*Label:\s*(.+)$/gim)].map((m) => ({ kind: 'macos', name: m[1].trim() }));
  if (!rows.length && !none) {
    return {
      manager: 'softwareupdate',
      state: 'failed',
      reason: 'softwareupdate produced neither a pending item nor its "No new software available." line — UNKNOWN, not clean',
      applyable: false,
    };
  }
  return {
    manager: 'softwareupdate',
    state: rows.length ? 'outdated' : 'current',
    outdated: rows,
    counts: { outdated: rows.length },
    // Stated on the payload so the UI cannot offer a button by forgetting, and so a future reader
    // finds the reason next to the flag rather than in a commit message.
    applyable: false,
    applyableReason: 'observation only — an OS update can force a reboot, so applying it is a human act taken at the machine',
    command: 'sudo softwareupdate --install --all',
  };
}

// ── THE WHOLE BOX ───────────────────────────────────────────────────────────────────────────────
export function inventory({ includeSoftwareUpdate = true } = {}) {
  const brew = brewState();
  // The scanner inventory is handed the brew result rather than probing for its own: eighteen
  // scanners each asking `brew outdated` is eighteen subprocesses answering one question. It is
  // also the reason this list is built here and not lazily — a manager that is never called is a
  // manager that reports nothing, which renders as nothing wrong.
  const managers = [brew, npmGlobalState(), toolchainState(), scannerToolchainState({ brew })];
  // softwareupdate talks to Apple and is the slow one; it is opt-out so a panel render never blocks
  // on it, and its absence from a payload is reported as not-asked rather than as clean.
  managers.push(includeSoftwareUpdate
    ? softwareUpdateState()
    : { manager: 'softwareupdate', state: 'not-asked', reason: 'skipped for this render — not asked is not the same as up to date', applyable: false });
  return { at: nowISO(), managers };
}

/** States that mean "we could not find out". Never render these as up to date. */
export const UNKNOWN_STATES = new Set(['unavailable', 'failed', 'not-asked', 'partial']);
export const isUnknown = (m) => UNKNOWN_STATES.has(m && m.state);

/**
 * The shape the PUBLISHED port may serve.
 *
 * A full installed-package inventory is a machine fingerprint and an attack-surface listing: it
 * names every out-of-date component on the operator's laptop, with versions, to anyone who reaches
 * the tunnel. host.mjs already draws this line for listeners; this draws it for packages. Counts
 * and states cross; names, versions and paths do not.
 */
export function publishedView(inv) {
  return {
    at: inv.at,
    published: true,
    managers: (inv.managers || []).map((m) => ({
      manager: m.manager,
      state: m.state,
      reason: m.reason ?? null,
      counts: m.counts ?? null,
      tapAgeDays: m.tapAgeDays ?? null,
      eolDeclaredAt: m.eolDeclaredAt ?? null,
      applyable: m.applyable ?? null,
      // The package NAMES are the fingerprint. Withheld, and the withholding is stated so a reader
      // does not mistake a redacted list for an empty one — the same rule as everything else here.
      withheld: (m.outdated && m.outdated.length) || (m.tools && m.tools.length)
        ? 'package names, versions and paths are withheld on the published port — they are a machine fingerprint; open the panel on the operator port for the detail'
        : null,
    })),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const inv = inventory({ includeSoftwareUpdate: !argv.includes('--no-software-update') });
  if (argv.includes('--json')) { process.stdout.write(`${JSON.stringify(inv, null, 2)}\n`); return 0; }
  if (argv.includes('--published')) { process.stdout.write(`${JSON.stringify(publishedView(inv), null, 2)}\n`); return 0; }
  const lines = [`package inventory — observed ${inv.at} (read-only; nothing here installs or upgrades)`];
  for (const m of inv.managers) {
    const head = `  ${m.manager.padEnd(15)} ${String(m.state).toUpperCase()}`;
    if (isUnknown(m)) { lines.push(`${head}  — ${m.reason || 'no reason recorded'}`); continue; }
    const n = m.counts ? Object.entries(m.counts).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    lines.push(`${head}  ${n}${m.note ? `  · ${m.note}` : ''}`);
    for (const p of (m.outdated || []).slice(0, 8)) {
      lines.push(`      ${p.name.padEnd(28)} ${String(p.installed).padEnd(14)} -> ${p.latest}${p.pinned ? '  (PINNED — held back on purpose)' : ''}`);
    }
    if ((m.outdated || []).length > 8) lines.push(`      … and ${m.outdated.length - 8} more`);
    for (const t of (m.tools || [])) {
      lines.push(`      ${t.name.padEnd(28)} ${String(t.version ?? '?').padEnd(14)} ${t.eol === 'end-of-life' ? `END-OF-LIFE — ${t.eolNote}` : t.eol}`);
    }
    if (m.command) lines.push(`      run: ${m.command}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));

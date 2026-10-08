// monitor/update-vulns.mjs — EVERY UPDATE THIS BOX CAN APPLY, AND WHAT IT FIXES.
//
// monitor/package-inventory.mjs answers "what is behind". This answers the question that follows:
// what would applying it actually FIX, and what would still be true afterwards. Both halves come
// from the SAME matcher run twice — once against the INSTALLED identity, once against the TARGET
// identity — and the answer is the set difference:
//
//   vulnerableNow      = grype matches for the installed identity
//   remainingAfter     = matches that survive the target identity
//   fixedByUpdate      = vulnerableNow − remainingAfter, keyed on (vulnerability id, component)
//   introducedByUpdate = target-only rows; upgrading INTO a vulnerability is rare and real
//
// The key excludes the VERSION deliberately. The version is the one thing the update changes, so a
// version-keyed identity would report every row as fixed and the same row as introduced — the
// line-number defect in CLAUDE.md wearing a version number. Identity is the place: manager+package.
//
// WHAT EACH MANAGER CAN ANSWER, AND WHAT IT CANNOT:
//   macOS   — CPE identity (cpe:2.3:o:apple:macos:<version>) against NVD's vendor-declared ranges.
//             CPE is inference tier under the F-gate, so NO row publishes a severity; the fixed and
//             remaining SETS are still reported, each row `undetermined` with its claim preserved.
//   npm -g  — pkg:npm/<name>@<version> on both sides: an exact ecosystem match, the strongest answer
//             here. The installed TREE is vulnerable surface too, but what the next release bundles
//             is not observable until it is installed, so those rows are unknown, never "fixed".
//   brew    — syft the installed keg, match the SBOM. Only the artifact carrying the formula's OWN
//             version can be rewritten to the target version. Everything else in a keg is an
//             embedded dependency whose post-upgrade version nobody can see from here.
//
// An update that could not be evaluated is NEVER "fixes nothing": every such row carries unknown()
// with a reason. An absent or invalid grype DB makes the vulnerability half unknown('no-reference')
// for everything while the update LIST still reports — "what can be applied" and "what it fixes"
// are two questions, and only one of them needs a vulnerability database.
//
// DECLARATION SPLIT FROM AUTHORITY, like the inventory it extends: this file runs `brew outdated`,
// `npm -g outdated`, `softwareupdate --list`, syft and grype. It installs and upgrades NOTHING and
// takes no argument that could be mistaken for an instruction to.
//
// Env, read at CALL time: CW_UPDATES_OUT, CW_UPDATES_CACHE, CW_NOW, CW_OS_VERSION, CW_OS_BUILD,
// CW_SW_FULL_INSTALLERS, CW_SW_PREFS, CW_BREW_PREFIX, plus package-inventory's own fixture seams
// (CW_BREW_OUTDATED_JSON, CW_NPM_OUTDATED_JSON, CW_SOFTWAREUPDATE_LIST) and app-vuln's
// (CW_APPVULN_KEV, CW_APPVULN_EPSS).
//
//   node monitor/update-vulns.mjs [--json] [--json-out] [--only <manager>] [--limit N] [--no-cache]
//   exit 0 nothing fixable, 1 at least one update fixes a vulnerability, 2 unknown

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { checkGrypeDb, sbomForBundle, classifyMatch, loadKevSet, loadEpss } from './app-vuln.mjs';
import { brewState, npmGlobalState } from './package-inventory.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = (k) => process.env[k] || '';
export const outPath = () => env('CW_UPDATES_OUT') || join(REPO, 'reports', 'updates.json');
const cacheDirFor = () => env('CW_UPDATES_CACHE') || join(REPO, 'reports', 'update-sbom');

// Same shape as app-vuln's runner (not exported there) and the same forced env: a vulnerability-DB
// download is an operator egress decision, never a side effect of asking what is installed.
export const defaultRun = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', timeout: 300_000, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GRYPE_DB_AUTO_UPDATE: 'false', GRYPE_CHECK_FOR_APP_UPDATE: 'false' },
  });
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '', errCode: r.error?.code || null };
};

/** A fixture seam that returns the SAME shape as a run, so the caller cannot tell them apart. */
function textFrom(envKey, produce) {
  const p = env(envKey);
  if (!p) return produce();
  try { return { ok: true, text: readFileSync(p, 'utf8') }; } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, ...unknown('absent', `fixture ${p} does not exist`) };
    return { ok: false, ...unknown('not-permitted', `fixture ${p} is unreadable (${e.code})`) };
  }
}

// ── grype, one entry point for all three lanes ─────────────────────────────────────────────────
// app-vuln.grypeMatches() is the same call for SBOMs alone and drops `fix`. The fix is load-bearing
// here: a row with NO fix recorded cannot be fixed by ANY update, and reporting it inside
// "still vulnerable afterwards" without saying so blames the update for a CVE nothing can close.
export function matchesFrom(doc) {
  return (doc.matches || []).map((m) => {
    const fix = m?.vulnerability?.fix || {};
    return {
      id: m?.vulnerability?.id ?? null,
      severity: m?.vulnerability?.severity ?? null,
      component: m?.artifact?.name ?? null,
      componentVersion: m?.artifact?.version ?? null,
      componentType: m?.artifact?.type ?? null,
      artifactId: m?.artifact?.id ?? null,
      matchTypes: (m?.matchDetails || []).map((d) => d?.type).filter(Boolean),
      fixVersions: Array.isArray(fix.versions) ? fix.versions : [],
      fixState: fix.state ?? null,
    };
  }).filter((m) => m.id && m.component);
}

/** `spec` is grype's own input syntax: cpe:…, purl:<file>, sbom:<file>. */
export function grypeQuery(spec, { run = defaultRun } = {}) {
  const r = run('grype', [spec, '-o', 'json', '-q']);
  if (r.errCode === 'ENOENT') return unknown('tool-failed', 'grype is not installed');
  // A non-zero exit is unknown even when stdout parsed: an error's partial output is not a result.
  if (r.status !== 0) return unknown('tool-failed', `grype exit ${r.status ?? r.errCode} on ${spec}`);
  let doc;
  try { doc = JSON.parse(r.stdout); } catch { return unknown('unparseable', `grype output for ${spec} is not JSON`); }
  if (!Array.isArray(doc.matches)) return unknown('unparseable', 'grype json without matches[] — the format decides the field, and this is not it');
  return { matches: matchesFrom(doc) };
}

// ── the set difference ──────────────────────────────────────────────────────────────────────────
export const rowKey = (m) => `${m.id}|${m.component}`;

export function setDiff(now, after) {
  const afterKeys = new Set(after.map(rowKey));
  const nowKeys = new Set(now.map(rowKey));
  return {
    fixed: now.filter((m) => !afterKeys.has(rowKey(m))),
    remaining: after.filter((m) => nowKeys.has(rowKey(m))),
    introduced: after.filter((m) => !nowKeys.has(rowKey(m))),
  };
}

const bySeverityThenId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : (a.component < b.component ? -1 : a.component > b.component ? 1 : 0));

/** One row as the panel reads it: the F-gate's verdict, the enrichment, and whether a fix exists. */
export function slimRow(m, { kevSet, epss }) {
  const c = classifyMatch(m, { kevSet, epss });
  return {
    id: c.id,
    component: c.component,
    componentVersion: c.componentVersion,
    publish: c.publish,
    ...(c.publish === 'severity' ? { severity: c.severity } : { originalClaim: c.originalClaim }),
    kev: c.kev,
    epss: c.epss,
    // null is "no fix recorded anywhere" — CVE-1999-0590 and friends. Counted separately below.
    fix: m.fixVersions.length ? m.fixVersions.join('|') : null,
  };
}

export function tally(rows) {
  const published = {};
  let undetermined = 0;
  let noFixRecorded = 0;
  const kev = [];
  for (const r of rows) {
    if (r.publish === 'severity') published[r.severity ?? 'Unknown'] = (published[r.severity ?? 'Unknown'] || 0) + 1;
    else undetermined += 1;
    if (r.fix === null) noFixRecorded += 1;
    if (r.kev === true) kev.push(r.id);
  }
  return { count: rows.length, published, undetermined, noFixRecorded, kev: [...new Set(kev)].sort() };
}

/**
 * A side that could not be measured. Used for every component whose target version is not
 * observable from here — `unexaminable` is the declared reason for exactly this: one sample exists
 * and there is nothing to compare it against. It is NOT 'not-run': the scan ran and answered.
 */
const EMPTY = { count: 0, published: {}, undetermined: 0, noFixRecorded: 0, kev: [], rows: [] };
const unmeasured = (detail) => ({ state: 'unknown', ...unknown('unexaminable', detail), ...EMPTY });
const noReference = () => ({ state: 'unknown', ...unknown('no-reference', 'the grype DB is absent or invalid, so nothing was matched — this is not "nothing is vulnerable"'), ...EMPTY });
/** An unknown that arrived as a value (a failed tool, an unreadable SBOM) wearing a side's shape. */
const asSide = (u) => ({ state: 'unknown', ...u, ...EMPTY });
const allSides = (side) => ({ vulnerableNow: side, fixedByUpdate: side, remainingAfter: side, introducedByUpdate: side });

const measured = (rows, ctx) => {
  const slim = rows.map((m) => slimRow(m, ctx)).sort(bySeverityThenId);
  return { state: 'measured', ...tally(slim), rows: slim };
};

// ── version arithmetic ──────────────────────────────────────────────────────────────────────────
/**
 * Brew's own revision suffix is NOT an upstream version. `1.11.1_4` → `1.11.1_5` is a repackaging;
 * it closes no upstream CVE, and feeding `1.11.1_5` to a CVE range comparator that cannot parse it
 * returns ZERO matches — which would render as "this update fixes everything". Both sides are
 * normalised identically so an unparseable version can only ever fail symmetrically.
 * Casks use `,` for the same purpose (`0.4.21,2`).
 */
export const upstreamVersion = (v) => String(v ?? '').replace(/[_,]\d+$/, '');

export function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0; const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

// ── macOS ───────────────────────────────────────────────────────────────────────────────────────
export const macosCpe = (version) => `cpe:2.3:o:apple:macos:${version}:*:*:*:*:*:*:*`;

export function osInstalled({ run = defaultRun } = {}) {
  const v = env('CW_OS_VERSION');
  const b = env('CW_OS_BUILD');
  if (v) return { version: v, build: b || null };
  const pv = run('sw_vers', ['-productVersion']);
  if (pv.errCode || pv.status !== 0) return unknown('unstated', `sw_vers could not state the installed OS version (${pv.status ?? pv.errCode})`);
  const bv = run('sw_vers', ['-buildVersion']);
  return { version: pv.stdout.trim(), build: bv.status === 0 ? bv.stdout.trim() : null };
}

/** `* Title: macOS Tahoe, Version: 26.7, Size: 17951133KiB, Build: 25G229, Deferred: NO` */
export function parseFullInstallers(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*\*\s*Title:\s*(.+?),\s*Version:\s*([^,]+),(?:\s*Size:\s*([^,]+),)?\s*Build:\s*([^,]+)(?:,\s*Deferred:\s*(\w+))?/);
    if (!m) continue;
    rows.push({
      source: 'full-installer',
      title: m[1].trim(),
      version: m[2].trim(),
      build: m[4].trim(),
      deferred: (m[5] || '').toUpperCase() === 'YES',
      beta: /beta|seed/i.test(m[1]),
    });
  }
  if (!rows.length) {
    return /found the following full installers/i.test(text)
      ? unknown('unparseable', 'softwareupdate announced full installers and none of its rows parsed — UNKNOWN, not "no installers"')
      : unknown('unparseable', 'softwareupdate --list-full-installers produced neither its header nor a parseable row — UNKNOWN, not empty');
  }
  return { rows };
}

/**
 * `* Label: macOS 27.2 Beta-26B5086k` followed by an indented
 * `Title: macOS 27.2 Beta, Version: 27.2, Size: …, Recommended: YES, Action: restart,`.
 * Absence of a row AND absence of the "No new software available." sentence is UNKNOWN, never
 * clean: that sentence is the only positive evidence of clean this tool emits.
 */
export function parseUpdateList(text) {
  const lines = String(text).split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].match(/^\s*\*\s*Label:\s*(.+)$/);
    if (!label) continue;
    const detail = (lines[i + 1] || '').match(/Title:\s*(.+?),\s*Version:\s*([^,]+),/);
    const action = (lines[i + 1] || '').match(/Action:\s*(\w+)/);
    const build = label[1].match(/-([A-Za-z0-9]+)\s*$/);
    rows.push({
      source: 'softwareupdate-list',
      label: label[1].trim(),
      title: detail ? detail[1].trim() : label[1].trim(),
      version: detail ? detail[2].trim() : null,
      build: build ? build[1] : null,
      action: action ? action[1] : null,
      beta: /beta|seed/i.test(label[1]),
    });
  }
  if (!rows.length && !/No new software available/i.test(text)) {
    return unknown('unparseable', 'softwareupdate produced neither a pending item nor its "No new software available." line — UNKNOWN, not clean');
  }
  return { rows };
}

/**
 * Minimal XML plist reader — enough for the SoftwareUpdate preferences and nothing more. A parse
 * failure is a void, never an empty dictionary: an empty one reads as "no beta seed, no missed
 * offers", which is the sentence this block exists to be sure about.
 */
export function parsePlistXml(text) {
  const s = String(text);
  let i = 0;
  const dec = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const skip = () => {
    while (i < s.length) {
      if (s.startsWith('<?', i) || s.startsWith('<!', i)) { const e = s.indexOf('>', i); if (e === -1) { i = s.length; return; } i = e + 1; continue; }
      if (/\s/.test(s[i])) { i++; continue; }
      return;
    }
  };
  const readTag = () => { skip(); if (s[i] !== '<') return null; const e = s.indexOf('>', i); if (e === -1) { i = s.length; return null; } const raw = s.slice(i + 1, e); i = e + 1; return raw; };
  const readUntil = (tag) => { const close = `</${tag}>`; const e = s.indexOf(close, i); const v = e === -1 ? s.slice(i) : s.slice(i, e); i = e === -1 ? s.length : e + close.length; return dec(v); };
  function value(depth) {
    if (depth > 32) throw new Error('plist nests deeper than this reader accepts');
    const tag = readTag();
    if (tag === null) return undefined;
    const name = tag.replace(/\/$/, '').split(/\s/)[0];
    if (tag.endsWith('/')) return name === 'true' ? true : name === 'false' ? false : name === 'dict' ? {} : name === 'array' ? [] : null;
    if (name === 'plist') { const v = value(depth + 1); readTag(); return v; }
    if (name === 'dict') {
      const o = {};
      for (;;) {
        skip();
        if (s.startsWith('</dict>', i)) { i += 7; return o; }
        const k = readTag();
        if (k === null) return o;
        if (k.replace(/\/$/, '') !== 'key') throw new Error(`expected <key> in <dict>, found <${k}>`);
        o[readUntil('key')] = value(depth + 1);
      }
    }
    if (name === 'array') {
      const a = [];
      for (;;) {
        skip();
        if (s.startsWith('</array>', i)) { i += 8; return a; }
        const v = value(depth + 1);
        if (v === undefined) return a;
        a.push(v);
      }
    }
    if (name === 'integer' || name === 'real') return Number(readUntil(name));
    return readUntil(name);
  }
  try {
    const v = value(0);
    if (!v || typeof v !== 'object') return unknown('unparseable', 'the plist root is not a dictionary');
    return { plist: v };
  } catch (e) {
    return unknown('unparseable', `plist did not parse (${String(e.message).slice(0, 120)}) — UNKNOWN, not an empty preference file`);
  }
}

/** `MSU_UPDATE_25F84_patch_26.5.2_minor` → what Apple offered, when, and of which kind. */
export function parseOfferId(id) {
  const m = String(id).match(/^MSU_UPDATE_([^_]+)_(patch|full)_([0-9][0-9.]*)_(minor|major)$/);
  return m ? { build: m[1], kind: m[4], version: m[3] } : null;
}

export function softwareUpdatePrefs({ run = defaultRun } = {}) {
  const path = env('CW_SW_PREFS') || '/Library/Preferences/com.apple.SoftwareUpdate.plist';
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return unknown('absent', `${path} does not exist`);
    return unknown('not-permitted', `${path} is unreadable (${e.code}) — seed enrolment is UNKNOWN, not "no seed"`);
  }
  if (text.startsWith('bplist')) {
    // The live file is a binary plist. plutil converts it; a conversion failure is a void, because
    // "could not read the preferences" and "not enrolled in a seed" are opposite answers.
    const r = run('plutil', ['-convert', 'xml1', '-o', '-', path]);
    if (r.errCode === 'ENOENT') return unknown('tool-failed', 'plutil is not installed, so the binary preferences could not be read');
    if (r.status !== 0) return unknown('tool-failed', `plutil exit ${r.status ?? r.errCode} converting ${path}`);
    text = r.stdout;
  }
  const p = parsePlistXml(text);
  if (p.unknown) return p;
  const doc = p.plist;
  const catalogURL = typeof doc.CatalogURL === 'string' ? doc.CatalogURL : null;
  const offers = Object.entries(doc.FirstOfferDateDictionary || {})
    .map(([id, at]) => ({ id, at: typeof at === 'string' ? at : null, ...(parseOfferId(id) || { build: null, kind: null, version: null }) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    path,
    catalogURL,
    // A seed catalogue is the panel's point here: while the box is enrolled, `softwareupdate --list`
    // offers the seed build and STOPS offering the minor security updates of the current major.
    seed: catalogURL === null
      ? { state: 'unknown', reason: 'no CatalogURL in the preferences — Apple\'s default catalogue is the usual meaning, but this is not evidence of it' }
      : { state: /seed|beta/i.test(catalogURL) ? 'beta-seed' : 'default', url: catalogURL },
    offers,
  };
}

/**
 * Which targets to evaluate. Newest per LINE — a line being a major version, taken separately for
 * beta and release, because a beta seed and a release train are different offers and collapsing
 * them hides whichever is older. Everything dropped is returned with the reason; nothing is
 * silently discarded, which is the whole failure mode this panel is about.
 */
export function selectOsTargets(installed, rows) {
  const seen = new Map();
  const older = [];
  for (const r of rows) {
    if (!r.version) { older.push({ ...r, why: 'the row states no version, so it cannot be matched against anything' }); continue; }
    if (cmpVersion(r.version, installed) <= 0) { older.push({ ...r, why: `not newer than the installed ${installed}` }); continue; }
    const k = `${r.version}|${r.build || ''}`;
    if (!seen.has(k)) seen.set(k, r);
    else seen.set(k, { ...seen.get(k), source: `${seen.get(k).source}+${r.source}` });   // the same build offered twice
  }
  const lines = new Map();
  for (const r of seen.values()) {
    const line = `${String(r.version).split('.')[0]}|${r.beta ? 'beta' : 'release'}`;
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line).push(r);
  }
  const targets = [];
  const superseded = [];
  for (const [, group] of lines) {
    const winner = group.reduce((a, b) => (cmpVersion(b.version, a.version) > 0 ? b : a));
    targets.push(winner);
    for (const r of group) if (r !== winner) superseded.push({ ...r, why: `superseded by ${winner.version} on the same line` });
  }
  targets.sort((a, b) => cmpVersion(a.version, b.version));
  return { targets, superseded: [...superseded, ...older].sort((a, b) => ((a.version || '') < (b.version || '') ? -1 : 1)) };
}

export function macosLane({ run = defaultRun, kevSet, epss, dbOk } = {}) {
  const installed = osInstalled({ run });
  if (installed.unknown) return { manager: 'macos', state: 'unknown', ...installed, rows: [] };

  const listR = textFrom('CW_SOFTWAREUPDATE_LIST', () => {
    const r = run('softwareupdate', ['--list']);
    if (r.errCode === 'ENOENT') return { ok: false, ...unknown('tool-failed', 'softwareupdate is not installed — this is not macOS') };
    // The tool writes its findings to stderr on some releases and stdout on others; both are read.
    return { ok: true, text: `${r.stdout}\n${r.stderr}` };
  });
  const fullR = textFrom('CW_SW_FULL_INSTALLERS', () => {
    const r = run('softwareupdate', ['--list-full-installers']);
    if (r.errCode === 'ENOENT') return { ok: false, ...unknown('tool-failed', 'softwareupdate is not installed — this is not macOS') };
    return { ok: true, text: `${r.stdout}\n${r.stderr}` };
  });
  const list = listR.ok ? parseUpdateList(listR.text) : listR;
  const full = fullR.ok ? parseFullInstallers(fullR.text) : fullR;
  const prefs = softwareUpdatePrefs({ run });

  const offered = [...(list.rows || []), ...(full.rows || [])];
  const { targets, superseded } = selectOsTargets(installed.version, offered);

  // Offered once and NOT installed — the identifier carries the version, so an offer newer than
  // what is running is one this box was told about and did not take. Whether it is still on the
  // menu is three separate facts, and collapsing them hides the interesting one: an update Apple
  // stopped offering (because a seed catalogue replaced that line) while a full installer for the
  // same version is still downloadable is NOT the same as an update that is simply pending.
  const key = (r) => `${r.version}|${r.build || ''}`;
  const inList = new Set((list.rows || []).map((r) => r.version));
  const inListBuilds = new Set((list.rows || []).map(key));
  const asFull = new Set((full.rows || []).map((r) => r.version));
  const asFullBuilds = new Set((full.rows || []).map(key));
  const offeredNotInstalled = (prefs.offers || [])
    .filter((o) => o.version && cmpVersion(o.version, installed.version) > 0)
    .map((o) => ({
      ...o,
      stillOffered: {
        updateList: inList.has(o.version),
        fullInstaller: asFull.has(o.version),
        sameBuild: inListBuilds.has(key(o)) || asFullBuilds.has(key(o)),
      },
    }));

  const ctx = { kevSet, epss };
  const installedQuery = dbOk ? grypeQuery(macosCpe(installed.version), { run }) : null;
  const nowMatches = installedQuery && !installedQuery.unknown ? installedQuery.matches : null;
  const nowBlock = !dbOk ? noReference()
    : nowMatches === null ? asSide(installedQuery)
    : measured(nowMatches, ctx);

  const rows = targets.map((t) => {
    const base = {
      key: `macos:${t.version}`,
      manager: 'macos',
      kind: t.beta ? 'os-beta' : 'os',
      name: t.title,
      installed: `${installed.version}${installed.build ? ` (${installed.build})` : ''}`,
      latest: `${t.version}${t.build ? ` (${t.build})` : ''}`,
      offer: { source: t.source, label: t.label ?? null, build: t.build, deferred: t.deferred ?? null, action: t.action ?? null, beta: t.beta },
      identity: {
        basis: 'nvd-cpe',
        installedCpe: macosCpe(installed.version),
        targetCpe: macosCpe(t.version),
        note: 'vendor-declared version ranges in NVD, matched by CPE. CPE is inference tier under the '
          + 'F-gate, so no row here publishes a severity — the fixed and remaining SETS are still '
          + 'reported, and each row keeps the claim it was made under. What remains is a FLOOR, never '
          + 'a ceiling: a vulnerability published after this DB was built cannot appear on either '
          + 'side, and a newer target has had less time to accumulate advisories.',
      },
    };
    if (!dbOk) return { ...base, ...allSides(noReference()) };
    if (nowMatches === null) return { ...base, ...allSides(nowBlock) };
    const q = grypeQuery(macosCpe(t.version), { run });
    if (q.unknown) return { ...base, ...allSides(asSide(q)), vulnerableNow: nowBlock };
    const d = setDiff(nowMatches, q.matches);
    return {
      ...base,
      vulnerableNow: nowBlock,
      fixedByUpdate: measured(d.fixed, ctx),
      remainingAfter: measured(d.remaining, ctx),
      introducedByUpdate: measured(d.introduced, ctx),
    };
  });

  const state = list.unknown && full.unknown ? 'unknown' : rows.length ? 'outdated' : 'current';
  return {
    manager: 'macos',
    state,
    basis: 'nvd-cpe',
    installed,
    seed: prefs.unknown ? { state: 'unknown', reason: prefs.unknownDetail || prefs.unknownReason } : prefs.seed,
    offeredNotInstalled,
    sources: {
      list: list.unknown ? { state: 'unknown', reason: list.unknownDetail || list.unknownReason } : { state: 'read', rows: (list.rows || []).length },
      fullInstallers: full.unknown ? { state: 'unknown', reason: full.unknownDetail || full.unknownReason } : { state: 'read', rows: (full.rows || []).length },
    },
    counts: {
      updates: rows.length,
      superseded: superseded.length,
      offeredNotInstalled: offeredNotInstalled.length,
      noLongerOffered: offeredNotInstalled.filter((o) => !o.stillOffered.updateList).length,
    },
    superseded,
    rows,
    applyable: false,
    applyableReason: 'observation only — an OS update can force a reboot, so applying it is a human act taken at the machine',
    command: 'sudo softwareupdate --install --all',
  };
}

// ── SBOM lanes: one syft per subject, ONE grype per side ────────────────────────────────────────
// 46 kegs is 46 syft runs and would be 92 grype runs. The artifacts carry an id that survives the
// round trip, so every subject's artifacts go into one document per side with their ids prefixed by
// the row key, and grype is invoked twice for the whole manager instead of twice per package.
const ARTIFACT_KEY_SEP = '#';

export function mergeSbom(entries, { installedSide }) {
  let envelope = null;
  const artifacts = [];
  const own = new Map();
  for (const e of entries) {
    let doc;
    try { doc = JSON.parse(readFileSync(e.sbomPath, 'utf8')); } catch { continue; }
    if (!Array.isArray(doc.artifacts)) continue;
    // grype validates the document envelope, so it travels from a real syft run rather than being
    // invented here.
    if (!envelope) envelope = { source: doc.source, distro: doc.distro, descriptor: doc.descriptor, schema: doc.schema };
    const ownIds = [];
    for (const a of doc.artifacts) {
      const id = `${e.key}${ARTIFACT_KEY_SEP}${a.id}`;
      const isOwn = e.ownVersion != null && String(a.version) === String(e.ownVersion);
      if (isOwn) ownIds.push(id);
      artifacts.push(isOwn && !installedSide ? { ...retarget(a, e.ownVersion, e.targetVersion), id } : { ...a, id });
    }
    own.set(e.key, ownIds);
  }
  return { doc: envelope ? { ...envelope, artifacts, artifactRelationships: [] } : null, own };
}

/** The formula's own identity at the version the update would install — purl, CPEs and all. */
export function retarget(artifact, from, to) {
  const purl = typeof artifact.purl === 'string' && artifact.purl
    ? (() => { const [head, tail] = splitOnce(artifact.purl, '?'); return `${head.endsWith(`@${from}`) ? `${head.slice(0, -String(from).length)}${to}` : head}${tail === null ? '' : `?${tail}`}`; })()
    : artifact.purl;
  const cpes = (artifact.cpes || []).map((c) => {
    const s = typeof c === 'string' ? c : c.cpe;
    const parts = String(s).split(':');
    if (parts.length > 5 && parts[5] === String(from)) parts[5] = String(to);
    const rebuilt = parts.join(':');
    return typeof c === 'string' ? rebuilt : { ...c, cpe: rebuilt };
  });
  return { ...artifact, version: String(to), purl, cpes };
}

const splitOnce = (s, sep) => { const i = s.indexOf(sep); return i === -1 ? [s, null] : [s.slice(0, i), s.slice(i + 1)]; };

/** Group a merged run's matches back onto the row that contributed the artifact. */
export function splitByKey(matches) {
  const out = new Map();
  for (const m of matches) {
    const k = String(m.artifactId || '').split(ARTIFACT_KEY_SEP)[0];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(m);
  }
  return out;
}

function sbomSides({ entries, run, cacheDir }) {
  const sides = {};
  for (const [side, installedSide] of [['now', true], ['after', false]]) {
    const merged = mergeSbom(entries, { installedSide });
    if (!merged.doc) { sides[side] = unknown('no-subject', 'no readable SBOM for any subject in this manager'); continue; }
    mkdirSync(cacheDir, { recursive: true });
    const path = join(cacheDir, `merged-${side}.syft.json`);
    writeAtomic(path, JSON.stringify(merged.doc));
    sides[side] = { ...grypeQuery(`sbom:${path}`, { run }), own: merged.own };
  }
  return sides;
}

// ── homebrew ────────────────────────────────────────────────────────────────────────────────────
export function brewPrefix({ run = defaultRun } = {}) {
  if (env('CW_BREW_PREFIX')) return env('CW_BREW_PREFIX');
  const r = run('brew', ['--prefix']);
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : '/opt/homebrew';
}

/**
 * Where the installed copy lives. package-inventory joins multiple installed versions with ", " —
 * and a CASK version can itself contain a comma (`0.4.21,2` is one version, not two), so the split
 * is on comma-SPACE and nothing else. The newest existing directory wins; none existing is a void.
 */
export function kegPath(row, { prefix }) {
  const leaf = String(row.name).split('/').pop();
  const versions = String(row.installed).split(', ').filter(Boolean);
  const root = row.kind === 'cask' ? join(prefix, 'Caskroom', leaf) : join(prefix, 'Cellar', leaf);
  for (const v of [...versions].reverse()) {
    const p = join(root, v);
    if (existsSync(p)) return { path: p, version: v };
  }
  return unknown('no-subject', `no installed directory for ${row.name} under ${root} — nothing to examine, which is not the same as nothing found`);
}

export function brewLane({ run = defaultRun, kevSet, epss, dbOk, limit = Infinity, noCache = false, cacheDir = cacheDirFor() } = {}) {
  const b = brewState();
  if (!Array.isArray(b.outdated)) return { manager: 'brew', state: b.state, reason: b.reason, basis: 'syft-sbom', counts: { updates: 0 }, rows: [] };
  const outdated = b.outdated.slice(0, limit === Infinity ? undefined : limit);
  const prefix = brewPrefix({ run });

  const entries = [];
  const rows = new Map();
  for (const o of outdated) {
    const key = `brew:${o.kind}:${o.name}`;
    const base = {
      key,
      manager: 'brew',
      kind: o.kind,
      name: o.name,
      installed: o.installed,
      latest: o.latest,
      pinned: !!o.pinned,
      identity: { basis: 'syft-sbom' },
    };
    // Without a reference DB there is nothing to match against, so the kegs are not read at all —
    // the LIST is still the answer to "what can be applied", which needs no vulnerability data.
    if (!dbOk) { rows.set(key, { ...base, ...allSides(noReference()) }); continue; }
    const keg = kegPath(o, { prefix });
    if (keg.unknown) { rows.set(key, { ...base, ...allSides(asSide(keg)) }); continue; }
    const sbom = sbomForBundle(keg.path, keg.version, { run, cacheDir, noCache });
    if (sbom.unknown) { rows.set(key, { ...base, ...allSides(asSide(sbom)) }); continue; }
    const ownVersion = upstreamVersion(keg.version);
    const targetVersion = upstreamVersion(o.latest);
    entries.push({ key, sbomPath: sbom.path, ownVersion: keg.version, targetVersion });
    rows.set(key, {
      ...base,
      identity: {
        basis: 'syft-sbom',
        subject: keg.path.replace(process.env.HOME || '', '~'),
        ownVersion: keg.version,
        targetVersion: o.latest,
        // A brew revision bump changes no upstream version, and saying so is the difference between
        // "fixes nothing upstream" and a fabricated clean sweep.
        note: ownVersion === targetVersion && keg.version !== o.latest
          ? `${keg.version} → ${o.latest} is a packaging revision of the same upstream ${ownVersion}; the identity queried is unchanged, so no upstream CVE can be closed by it`
          : null,
      },
    });
  }

  if (!dbOk || !entries.length) return brewBlock(b, rows, outdated.length);

  const sides = sbomSides({ entries, run, cacheDir });
  const ctx = { kevSet, epss };
  const nowByKey = sides.now.unknown ? null : splitByKey(sides.now.matches);
  const afterByKey = sides.after.unknown ? null : splitByKey(sides.after.matches);
  for (const e of entries) {
    const r = rows.get(e.key);
    if (!nowByKey || !afterByKey) { rows.set(e.key, { ...r, ...allSides(asSide(sides.now.unknown ? sides.now : sides.after)) }); continue; }
    const nowAll = nowByKey.get(e.key) || [];
    const afterAll = afterByKey.get(e.key) || [];
    const ownIds = new Set(sides.now.own.get(e.key) || []);
    const isOwn = (m) => ownIds.has(String(m.artifactId));
    const d = setDiff(nowAll.filter(isOwn), afterAll.filter(isOwn));
    const embedded = nowAll.filter((m) => !isOwn(m)).map((m) => slimRow(m, ctx)).sort(bySeverityThenId);
    rows.set(e.key, {
      ...r,
      vulnerableNow: measured(nowAll, ctx),
      // Only the artifact carrying the formula's own version has a target to compare against.
      fixedByUpdate: ownIds.size
        ? measured(d.fixed, ctx)
        : unmeasured(`syft found no artifact in this keg carrying the installed version ${e.ownVersion}, so the formula's own identity is absent from the SBOM and there is nothing to re-query at ${e.targetVersion}`),
      remainingAfter: ownIds.size ? measured(d.remaining, ctx) : unmeasured('no target identity to compare against'),
      introducedByUpdate: ownIds.size ? measured(d.introduced, ctx) : unmeasured('no target identity to compare against'),
      embedded: embedded.length
        ? { ...unmeasured('an embedded dependency\'s post-upgrade version is not observable until the upgrade is installed — these are vulnerable NOW, and whether the update touches them is UNKNOWN, never "no"'), ...tally(embedded), rows: embedded }
        : null,
    });
  }
  return brewBlock(b, rows, outdated.length);
}

function brewBlock(b, rows, updates) {
  const list = [...rows.values()].sort(rowOrder);
  return {
    manager: 'brew',
    state: b.state,
    basis: 'syft-sbom',
    catalogueAgeDays: b.catalogueAgeDays ?? null,
    note: b.note || null,
    counts: {
      updates,
      evaluated: list.filter((r) => r.fixedByUpdate.state === 'measured').length,
      unknown: list.filter((r) => r.fixedByUpdate.state !== 'measured').length,
    },
    rows: list,
    command: 'brew upgrade',
  };
}

// ── global npm ──────────────────────────────────────────────────────────────────────────────────
export const npmPurl = (name, version) => `pkg:npm/${String(name).replace(/^@/, '%40')}@${version}`;

export function npmLane({ run = defaultRun, kevSet, epss, dbOk, limit = Infinity, noCache = false, cacheDir = cacheDirFor(), tree = true } = {}) {
  const n = npmGlobalState();
  if (!Array.isArray(n.outdated)) return { manager: 'npm-global', state: n.state, reason: n.reason, basis: 'purl-ecosystem', counts: { updates: 0 }, rows: [] };
  const outdated = n.outdated.slice(0, limit === Infinity ? undefined : limit);
  const rows = new Map();
  for (const o of outdated) {
    rows.set(`npm-global:${o.name}`, {
      key: `npm-global:${o.name}`,
      manager: 'npm-global',
      kind: 'npm-global',
      name: o.name,
      installed: o.installed,
      latest: o.latest,
      identity: {
        basis: 'purl-ecosystem',
        installedPurl: npmPurl(o.name, o.installed),
        targetPurl: npmPurl(o.name, o.latest),
        note: 'an exact ecosystem match on both sides — the package itself is compared mechanically',
      },
    });
  }

  if (!dbOk) {
    for (const [k, r] of rows) rows.set(k, { ...r, ...allSides(noReference()) });
    return npmBlock(n, rows, outdated.length);
  }
  if (!outdated.length) return npmBlock(n, rows, 0);

  const ctx = { kevSet, epss };
  mkdirSync(cacheDir, { recursive: true });
  const sides = {};
  for (const [side, pick] of [['now', (o) => o.installed], ['after', (o) => o.latest]]) {
    const file = join(cacheDir, `npm-global-${side}.purls`);
    writeAtomic(file, `${outdated.map((o) => npmPurl(o.name, pick(o))).join('\n')}\n`);
    sides[side] = grypeQuery(`purl:${file}`, { run });
  }
  // grype answers per purl, so a row's own matches are the ones naming it. The scoped form arrives
  // back decoded (`@scope/name`), which is the name npm states too.
  const mine = (matches, name) => matches.filter((m) => m.component === name);
  for (const o of outdated) {
    const key = `npm-global:${o.name}`;
    const r = rows.get(key);
    if (sides.now.unknown || sides.after.unknown) { rows.set(key, { ...r, ...allSides(asSide(sides.now.unknown ? sides.now : sides.after)) }); continue; }
    const now = mine(sides.now.matches, o.name);
    const after = mine(sides.after.matches, o.name);
    const d = setDiff(now, after);
    rows.set(key, {
      ...r,
      vulnerableNow: measured(now, ctx),
      fixedByUpdate: measured(d.fixed, ctx),
      remainingAfter: measured(d.remaining, ctx),
      introducedByUpdate: measured(d.introduced, ctx),
    });
  }

  // The installed TREE, when asked for: the package's dependencies are vulnerable surface too, and
  // what the next release bundles is not observable from here — so they are reported as vulnerable
  // NOW with the fixed side unknown.
  if (tree) {
    const entries = [];
    for (const o of outdated) {
      const dir = o.location || null;
      if (!dir || !existsSync(dir)) {
        const key = `npm-global:${o.name}`;
        rows.set(key, { ...rows.get(key), embedded: unmeasured(`no installed directory for ${o.name} to examine`) });
        continue;
      }
      entries.push({ key: `npm-global:${o.name}`, sbomPath: null, dir, installed: o.installed, name: o.name });
    }
    const built = [];
    for (const e of entries) {
      const sbom = sbomForBundle(e.dir, e.installed, { run, cacheDir, noCache });
      if (sbom.unknown) { rows.set(e.key, { ...rows.get(e.key), embedded: asSide(sbom) }); continue; }
      built.push({ ...e, sbomPath: sbom.path, ownVersion: null, targetVersion: null });
    }
    if (built.length) {
      const merged = mergeSbom(built, { installedSide: true });
      if (merged.doc) {
        const path = join(cacheDir, 'npm-global-tree.syft.json');
        writeAtomic(path, JSON.stringify(merged.doc));
        const q = grypeQuery(`sbom:${path}`, { run });
        const perKey = q.unknown ? null : splitByKey(q.matches);
        for (const e of built) {
          const r = rows.get(e.key);
          if (!perKey) { rows.set(e.key, { ...r, embedded: asSide(q) }); continue; }
          // The package's own artifact is already answered, exactly, by the purl pair above.
          const deps = (perKey.get(e.key) || []).filter((m) => m.component !== e.name);
          const slim = deps.map((m) => slimRow(m, ctx)).sort(bySeverityThenId);
          rows.set(e.key, {
            ...r,
            embedded: deps.length
              ? { ...unmeasured('a dependency\'s post-upgrade version is not observable until the release is installed — vulnerable NOW, fixed-by-this-update UNKNOWN'), ...tally(slim), rows: slim }
              : { state: 'measured', ...EMPTY },
          });
        }
      }
    }
  }
  return npmBlock(n, rows, outdated.length);
}

function npmBlock(n, rows, updates) {
  const list = [...rows.values()].sort(rowOrder);
  return {
    manager: 'npm-global',
    state: n.state,
    basis: 'purl-ecosystem',
    counts: {
      updates,
      evaluated: list.filter((r) => r.fixedByUpdate.state === 'measured').length,
      unknown: list.filter((r) => r.fixedByUpdate.state !== 'measured').length,
    },
    rows: list,
    command: 'npm -g update',
  };
}

// ── the whole box ───────────────────────────────────────────────────────────────────────────────
/** KEV first, then the weight of what the update fixes, then the key — stable and deterministic. */
export function rowOrder(a, b) {
  const kev = (r) => (r.fixedByUpdate?.kev?.length || 0) + (r.vulnerableNow?.kev?.length || 0);
  const crit = (r) => (r.fixedByUpdate?.published?.Critical || 0) + (r.fixedByUpdate?.published?.High || 0) + (r.fixedByUpdate?.undetermined || 0);
  if (kev(b) !== kev(a)) return kev(b) - kev(a);
  if (crit(b) !== crit(a)) return crit(b) - crit(a);
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export const MANAGERS = ['macos', 'brew', 'npm-global'];

export function grypeDbState({ run = defaultRun } = {}) {
  const r = run('grype', ['db', 'status']);
  // The verdict stays app-vuln's — one declaration of what "valid" means — while the metadata is
  // read here, because the DB's own build date bounds every answer below it.
  const gate = checkGrypeDb({ run: () => r });
  const built = (r.stdout.match(/^Built:\s*(.+)$/m) || [])[1] || null;
  const schema = (r.stdout.match(/^Schema:\s*(.+)$/m) || [])[1] || null;
  return gate.unknown
    ? { state: 'unknown', ...gate, built: built && built.trim(), schema: schema && schema.trim() }
    : { state: 'valid', built: built && built.trim(), schema: schema && schema.trim() };
}

export function runUpdates({ run = defaultRun, only = null, limit = Infinity, noCache = false, cacheDir = cacheDirFor(), tree = true } = {}) {
  const db = grypeDbState({ run });
  const dbOk = db.state === 'valid';
  const kevSet = loadKevSet();
  const epss = loadEpss();
  const want = (m) => !only || only === m;
  const managers = [];
  if (want('macos')) managers.push(macosLane({ run, kevSet, epss, dbOk }));
  if (want('brew')) managers.push(brewLane({ run, kevSet, epss, dbOk, limit, noCache, cacheDir }));
  if (want('npm-global')) managers.push(npmLane({ run, kevSet, epss, dbOk, limit, noCache, cacheDir, tree }));

  const allRows = managers.flatMap((m) => m.rows || []);
  const fixing = allRows.filter((r) => r.fixedByUpdate?.state === 'measured' && r.fixedByUpdate.count > 0);
  const unknownRows = allRows.filter((r) => r.fixedByUpdate?.state !== 'measured');
  const kev = [...new Set(allRows.flatMap((r) => [...(r.fixedByUpdate?.kev || []), ...(r.vulnerableNow?.kev || [])]))].sort();
  return {
    at: nowISO(),
    generator: 'monitor/update-vulns.mjs',
    grypeDb: db,
    kevChecked: kevSet !== null,
    epssChecked: epss !== null,
    method: 'set difference: the same matcher is run against the installed identity and the target '
      + 'identity, and fixedByUpdate is what only the installed side matched. An update nobody could '
      + 'evaluate carries unknown() with a reason and is never reported as fixing nothing.',
    managers,
    counts: {
      updates: allRows.length,
      fixing: fixing.length,
      unknown: unknownRows.length,
      kev: kev.length,
      fixedTotal: allRows.reduce((n, r) => n + (r.fixedByUpdate?.state === 'measured' ? r.fixedByUpdate.count : 0), 0),
    },
    kev,
    state: !dbOk ? 'unknown'
      : managers.every((m) => m.state === 'unknown') ? 'unknown'
      : fixing.length ? 'findings'
      : 'ok',
  };
}

export function writeUpdates(payload) {
  const p = outPath();
  mkdirSync(dirname(p), { recursive: true });
  writeAtomic(p, `${JSON.stringify(payload, null, 2)}\n`);
  return p;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function lines(r) {
  const out = [`updates — observed ${r.at}  (read-only; nothing here installs or upgrades)`];
  out.push(`  grype DB ${r.grypeDb.state}${r.grypeDb.built ? ` · built ${r.grypeDb.built}` : ''}${r.grypeDb.state !== 'valid' ? ` — ${r.grypeDb.unknownDetail || ''}` : ''}`);
  out.push(`  ${r.counts.updates} update(s) · ${r.counts.fixing} fix something measurable · ${r.counts.unknown} UNKNOWN · ${r.counts.kev} KEV id(s) in play`
    + `${r.kevChecked ? '' : ' · KEV list UNCHECKED'}`);
  for (const m of r.managers) {
    out.push(`  ${m.manager.padEnd(12)} ${String(m.state).toUpperCase()}  basis=${m.basis || '—'}${m.counts ? `  ${Object.entries(m.counts).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}${m.reason ? `  — ${m.reason}` : ''}`);
    if (m.manager === 'macos' && m.installed) {
      out.push(`      installed ${m.installed.version}${m.installed.build ? ` (${m.installed.build})` : ''} · seed ${m.seed?.state || 'unknown'}`);
      for (const o of (m.offeredNotInstalled || [])) {
        out.push(`      OFFERED AND NOT INSTALLED  ${o.version} (${o.build || '?'}) first offered ${o.at || '?'}`
          + ` — ${o.stillOffered.updateList ? 'still in softwareupdate --list' : 'NO LONGER in softwareupdate --list'}`
          + `${o.stillOffered.fullInstaller ? ', full installer available' : ''}`);
      }
    }
    for (const row of (m.rows || []).slice(0, 8)) {
      const f = row.fixedByUpdate;
      const what = f.state === 'measured'
        ? `fixes ${f.count}${f.undetermined ? ` (${f.undetermined} undetermined)` : ''}${f.kev.length ? ` · KEV ${f.kev.join(' ')}` : ''}, ${row.remainingAfter.count} remain`
        : `fixes UNKNOWN (${f.unknownReason}) — ${String(f.unknownDetail || '').slice(0, 90)}`;
      out.push(`      ${String(row.name).padEnd(28)} ${String(row.installed).padEnd(14)} -> ${String(row.latest).padEnd(14)} ${what}`);
    }
    if ((m.rows || []).length > 8) out.push(`      … and ${m.rows.length - 8} more (--json for all)`);
  }
  return out.join('\n');
}

function main(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('node monitor/update-vulns.mjs [--json] [--json-out] [--only macos|brew|npm-global] [--limit N] [--no-cache] [--no-tree]\n'
      + 'Every update this box can apply, and which vulnerabilities it fixes — by set difference between\n'
      + 'the installed identity and the target identity, through the same matcher. Read-only.\n'
      + 'exit 0 nothing fixable, 1 at least one update fixes a vulnerability, 2 unknown\n');
    return 0;
  }
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const only = flag('--only');
  if (only && !MANAGERS.includes(only)) {
    process.stderr.write(`--only ${only} is not a manager here; declared: ${MANAGERS.join(', ')}\n`);
    return 2;
  }
  const r = runUpdates({
    only,
    limit: flag('--limit') ? Number(flag('--limit')) : Infinity,
    noCache: argv.includes('--no-cache'),
    tree: !argv.includes('--no-tree'),
  });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  else process.stdout.write(`${lines(r)}\n`);
  if (argv.includes('--json-out')) {
    const p = writeUpdates(r);
    if (!argv.includes('--json')) process.stdout.write(`  written to ${p}\n`);
  }
  return r.state === 'unknown' ? 2 : r.counts.fixing ? 1 : 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));

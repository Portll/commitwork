// monitor/app-inventory.mjs — tier 1 of the installed-app sweep: what is installed on this box,
// who signed it, where did it come from, and did that set change?
//
// Surfaces (darwin first, per-OS adapter shape like persistence-diff):
//   apps        /Applications, /Applications/Utilities, ~/Applications — every *.app bundle:
//               version from Info.plist (via plutil), signing posture from codesign (signer,
//               team, signed|adhoc|unsigned), quarantine xattr (was it downloaded).
//   brew        formulae + casks, `brew list --versions`.
//   toolchains  npm -g, pipx — the global package surface a supply-chain entry rides in on.
//   extensions  Chrome-family + Firefox browser extensions — the most under-swept real vector.
//
// NOT a vulnerability claim. This lens answers identity and change; matching versions against
// advisories is tier 2 (monitor/app-vuln.mjs), and severity there stays undetermined until
// corroborated (tier 3). Conflating inventory with findings is how consumer scanners get to
// "347 issues found" — the number this project exists to not publish.
//
// Diff discipline is persistence-diff's, literally (its diffPersistence is imported): identity is
// the PLACE (bundle path / package name / profile+extension id), never the version — an upgrade is
// 'changed', not remove+add. The change basis is a hash of the informative fields. A tool that is
// not installed is an absent source (its own quiet state); a tool that fails is unknown; a bundle
// whose plist will not parse is unknown — counted, never skipped, never a finding.
//
// Env (read at call time): CW_APPINV_BASELINE, CW_APPINV_HOME, CW_NOW.
//
//   node monitor/app-inventory.mjs [--json]   diff vs baseline; exit 0 ok, 1 findings, 2 grey
//   node monitor/app-inventory.mjs --accept   pin the currently observed inventory

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { diffPersistence } from './persistence-diff.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = () => process.env.CW_APPINV_BASELINE || join(REPO, '.claude', 'store', 'app-inventory-baseline.json');
const homeDir = () => process.env.CW_APPINV_HOME || homedir();

// One injectable runner for everything: plutil answers on stdout, codesign on STDERR, xattr by
// exit status — execFileSync cannot carry all three, spawnSync can.
const defaultRun = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 });
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '', errCode: r.error?.code || null };
};

const informative = (item) => createHash('sha256')
  .update(JSON.stringify([item.version, item.signer, item.signMode, item.teamId, item.quarantined, item.name, item.bundleId].map((v) => v ?? null)))
  .digest('hex');

// ── apps ────────────────────────────────────────────────────────────────────────────────────────
export function parseCodesign(status, stderr) {
  if (status !== 0) {
    if (/not signed at all/.test(stderr)) return { signMode: 'unsigned', signer: null, teamId: null };
    return { signMode: 'unknown', signer: null, teamId: null };
  }
  const authority = /^Authority=(.+)$/m.exec(stderr)?.[1] ?? null;
  const team = /^TeamIdentifier=(.+)$/m.exec(stderr)?.[1] ?? null;
  const adhoc = /^Signature=adhoc$/m.test(stderr) || /flags=0x[0-9a-f]+\([^)]*adhoc[^)]*\)/.test(stderr);
  return {
    signMode: adhoc ? 'adhoc' : 'signed',
    signer: authority,
    teamId: team && team !== 'not set' ? team : null,
  };
}

export function collectApps({ roots, run }) {
  const items = [];
  const unknowns = [];
  for (const root of roots) {
    let names;
    try { names = readdirSync(root); }
    catch (e) {
      if (e.code === 'ENOENT') continue;
      unknowns.push({ id: root, kind: 'app', ...unknown('not-permitted', e.code) });
      continue;
    }
    for (const name of names.sort()) {
      if (!name.endsWith('.app')) continue;
      const bundle = join(root, name);
      const plist = join(bundle, 'Contents', 'Info.plist');
      const p = run('plutil', ['-convert', 'json', '-o', '-', plist]);
      let info = null;
      if (p.status === 0) { try { info = JSON.parse(p.stdout); } catch { info = null; } }
      if (!info) {
        unknowns.push({ id: bundle, kind: 'app', ...unknown('unparseable', 'Info.plist unreadable') });
        continue;
      }
      const cs = run('codesign', ['-dvv', bundle]);
      const sign = parseCodesign(cs.status, cs.stderr);
      const quarantined = run('xattr', ['-p', 'com.apple.quarantine', bundle]).status === 0;
      const item = {
        id: bundle, kind: 'app',
        name: info.CFBundleName || name.replace(/\.app$/, ''),
        bundleId: info.CFBundleIdentifier ?? null,
        version: info.CFBundleShortVersionString ?? info.CFBundleVersion ?? null,
        ...sign, quarantined,
      };
      items.push({ ...item, sha256: informative(item) });
    }
  }
  return { items, unknowns };
}

// ── brew + toolchains ───────────────────────────────────────────────────────────────────────────
// A missing manager is an ABSENT source (quiet); a failing one is unknown; both differ from empty.
function collectVersionLines({ run }, cmd, args, kind) {
  const r = run(cmd, args);
  if (r.errCode === 'ENOENT') return { items: [], unknowns: [], absent: true };
  if (r.status !== 0) return { items: [], unknowns: [{ id: `${kind}`, kind, ...unknown('tool-failed', `exit ${r.status}`) }] };
  const items = [];
  for (const line of r.stdout.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t.length >= 2) {
      const item = { id: `${kind}:${t[0]}`, kind, name: t[0], version: t.slice(1).join(' ') };
      items.push({ ...item, sha256: informative(item) });
    }
  }
  return { items, unknowns: [] };
}

function collectNpmGlobal({ run }) {
  const r = run('npm', ['ls', '-g', '--depth=0', '--json']);
  if (r.errCode === 'ENOENT') return { items: [], unknowns: [], absent: true };
  let doc = null;
  try { doc = JSON.parse(r.stdout); } catch { doc = null; }   // npm exits non-zero on peer warnings with valid JSON
  if (!doc) return { items: [], unknowns: [{ id: 'npm-global', kind: 'npm-global', ...unknown('unparseable', `exit ${r.status}`) }] };
  const items = Object.entries(doc.dependencies || {}).map(([name, d]) => {
    const item = { id: `npm-global:${name}`, kind: 'npm-global', name, version: d?.version ?? null };
    return { ...item, sha256: informative(item) };
  });
  return { items, unknowns: [] };
}

function collectPipx({ run }) {
  const r = run('pipx', ['list', '--json']);
  if (r.errCode === 'ENOENT') return { items: [], unknowns: [], absent: true };
  let doc = null;
  try { doc = JSON.parse(r.stdout); } catch { doc = null; }
  if (!doc) return { items: [], unknowns: [{ id: 'pipx', kind: 'pipx', ...unknown('unparseable', `exit ${r.status}`) }] };
  const items = Object.entries(doc.venvs || {}).map(([name, v]) => {
    const item = { id: `pipx:${name}`, kind: 'pipx', name, version: v?.metadata?.main_package?.package_version ?? null };
    return { ...item, sha256: informative(item) };
  });
  return { items, unknowns: [] };
}

// ── browser extensions ──────────────────────────────────────────────────────────────────────────
function collectChromeExtensions({ home }) {
  const items = [];
  const unknowns = [];
  const base = join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  let profiles;
  try { profiles = readdirSync(base).filter((n) => n === 'Default' || n.startsWith('Profile ')); }
  catch (e) { if (e.code === 'ENOENT') return { items, unknowns }; unknowns.push({ id: base, kind: 'chrome-extension', ...unknown('not-permitted', e.code) }); return { items, unknowns }; }
  for (const profile of profiles.sort()) {
    const extRoot = join(base, profile, 'Extensions');
    let ids;
    try { ids = readdirSync(extRoot); } catch { continue; }
    for (const extId of ids.sort()) {
      let versions;
      try { versions = readdirSync(join(extRoot, extId)).sort(); } catch { continue; }
      const latest = versions.at(-1);
      if (!latest) continue;
      let name = null;
      let version = latest;
      try {
        const m = JSON.parse(readFileSync(join(extRoot, extId, latest, 'manifest.json'), 'utf8'));
        name = m.name ?? null;           // may be a __MSG_ localisation key — stored raw, still an identity witness
        version = m.version ?? latest;
      } catch {
        unknowns.push({ id: `chrome:${profile}:${extId}`, kind: 'chrome-extension', ...unknown('unparseable', 'manifest unreadable') });
        continue;
      }
      const item = { id: `chrome:${profile}:${extId}`, kind: 'chrome-extension', name, version };
      items.push({ ...item, sha256: informative(item) });
    }
  }
  return { items, unknowns };
}

function collectFirefoxExtensions({ home }) {
  const items = [];
  const unknowns = [];
  const base = join(home, 'Library', 'Application Support', 'Firefox', 'Profiles');
  let profiles;
  try { profiles = readdirSync(base); }
  catch (e) { if (e.code === 'ENOENT') return { items, unknowns }; unknowns.push({ id: base, kind: 'firefox-extension', ...unknown('not-permitted', e.code) }); return { items, unknowns }; }
  for (const profile of profiles.sort()) {
    const file = join(base, profile, 'extensions.json');
    if (!existsSync(file)) continue;
    let doc = null;
    try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { doc = null; }
    if (!doc || !Array.isArray(doc.addons)) {
      unknowns.push({ id: file, kind: 'firefox-extension', ...unknown('unparseable', 'extensions.json unreadable') });
      continue;
    }
    for (const a of doc.addons) {
      if (a?.type !== 'extension' || !a.id) continue;
      const item = { id: `firefox:${profile}:${a.id}`, kind: 'firefox-extension', name: a.defaultLocale?.name ?? null, version: a.version ?? null };
      items.push({ ...item, sha256: informative(item) });
    }
  }
  return { items, unknowns };
}

// ── the surface, assembled ──────────────────────────────────────────────────────────────────────
export function collectInventory({ home = homeDir(), run = defaultRun, roots } = {}) {
  const appRoots = roots || ['/Applications', join('/Applications', 'Utilities'), join(home, 'Applications')];
  const parts = [
    collectApps({ roots: appRoots, run }),
    collectVersionLines({ run }, 'brew', ['list', '--versions'], 'brew-formula'),
    collectVersionLines({ run }, 'brew', ['list', '--cask', '--versions'], 'brew-cask'),
    collectNpmGlobal({ run }),
    collectPipx({ run }),
    collectChromeExtensions({ home }),
    collectFirefoxExtensions({ home }),
  ];
  return {
    items: parts.flatMap((p) => p.items).sort((a, b) => (a.id < b.id ? -1 : 1)),
    unknowns: parts.flatMap((p) => p.unknowns),
    absentSources: parts.map((p, i) => (p.absent ? ['brew-formula', 'brew-cask', 'npm-global', 'pipx'][i - 1] : null)).filter(Boolean),
  };
}

/** ENOENT is "no baseline yet"; anything else THROWS. */
export function readBaseline() {
  let raw;
  try { raw = readFileSync(baselinePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const b = JSON.parse(raw);
  if (!b || !Array.isArray(b.items)) throw new Error('baseline has no items[]');
  return b;
}

export function runLens(opts = {}) {
  const baseline = readBaseline();
  const observed = collectInventory(opts);
  const diff = diffPersistence(observed, baseline);
  // 'changed' rows join the baseline so the CLI can say what the change WAS (version, signer…).
  if (baseline) {
    const base = new Map(baseline.items.map((i) => [i.id, i]));
    for (const c of diff.changed) c.was = base.get(c.id) ?? null;
  }
  return { at: nowISO(), baselineAt: baseline?.at ?? null, items: observed.items.length, absentSources: observed.absentSources, ...diff };
}

export function acceptBaseline(opts = {}) {
  const observed = collectInventory(opts);
  const doc = { at: nowISO(), items: observed.items };
  writeAtomic(baselinePath(), `${JSON.stringify(doc, null, 2)}\n`);
  return { path: baselinePath(), pinned: observed.items.length, unknowns: observed.unknowns };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/app-inventory.mjs [--json]   diff the installed-app surface vs the accepted baseline\n'
      + 'node monitor/app-inventory.mjs --accept   pin the currently observed inventory (the human act)\n'
      + 'exit 0 ok, 1 findings (added/changed/removed), 2 grey (no baseline, or unknowns only)');
    process.exit(0);
  }
  if (process.argv.includes('--accept')) {
    const a = acceptBaseline();
    console.log(`pinned ${a.pinned} item(s) → ${a.path}`);
    for (const u of a.unknowns) console.log(`  NOT pinned (${u.unknownReason}): ${u.id}`);
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`app-inventory: ${r.state}  (${r.items} item(s), baseline ${r.baselineAt ?? 'NONE — run --accept to pin'})`);
    const label = (i) => `${i.kind}  ${i.name ?? i.id}${i.version ? ` ${i.version}` : ''}`;
    for (const i of r.added) console.log(`  ADDED    ${label(i)}${i.signMode ? `  [${i.signMode}${i.quarantined ? ', quarantined' : ''}]` : ''}`);
    for (const i of r.changed) {
      const deltas = [];
      if (i.was && i.was.version !== i.version) deltas.push(`${i.was.version} → ${i.version}`);
      if (i.was && i.was.signer !== i.signer) deltas.push(`signer ${i.was.signer ?? 'none'} → ${i.signer ?? 'none'}`);
      if (i.was && i.was.signMode !== i.signMode) deltas.push(`${i.was.signMode} → ${i.signMode}`);
      console.log(`  CHANGED  ${label(i)}${deltas.length ? `  (${deltas.join('; ')})` : ''}`);
    }
    for (const i of r.removed) console.log(`  REMOVED  ${label(i)}`);
    for (const u of r.unknowns) console.log(`  UNKNOWN  ${u.kind}  ${u.id} (${u.unknownReason})`);
    if (r.absentSources.length) console.log(`  absent sources (not installed): ${r.absentSources.join(', ')}`);
  }
  process.exit(r.state === 'findings' ? 1 : r.state === 'ok' ? 0 : 2);
}

// bin/lib/npm-versions.mjs — how far each direct npm dependency of one project is behind, and which
// of its advisories an upgrade can clear. Pure over (package.json, package-lock.json, registry
// metadata, `npm audit` JSON); the adapter at the bottom is the only part that runs npm.
//
// Update types are measured from the LOCKED version, not the declared range: patch keeps
// major.minor, minor keeps major, major is the rest. Under 0.x a minor bump is breaking by semver,
// so 0.1 → 0.2 is a major, and under 0.0.x every change is.
//
// A release younger than its type's cooldown is held: that is the window in which a compromised
// version is still live and not yet pulled from the registry. Advisory fixes are not held — the
// apply step exempts them, because a known vulnerability outweighs an unknown one.
//
// env, read at call time: CW_NPM (the npm binary), CW_NOW (the clock).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export const UPDATE_TYPES = ['patch', 'minor', 'major'];
export const UPDATE_KINDS = [...UPDATE_TYPES, 'lockfile', 'advisories'];
export const DEP_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
export const AUDIT_LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
export const DEFAULT_COOLDOWN = Object.freeze({ patch: 7, minor: 7, major: 7 });
export const COOLDOWN_WHY = 'a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled';
const DAY_MS = 86_400_000;

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v ?? '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] } : null;
}

function cmpPre(a, b) {
  if (!a.length || !b.length) return (b.length ? 1 : 0) - (a.length ? 1 : 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]);
    const nb = /^\d+$/.test(b[i]);
    if (na && nb && Number(a[i]) !== Number(b[i])) return Number(a[i]) - Number(b[i]);
    if (na !== nb) return na ? -1 : 1;
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Semver precedence; an unparseable version sorts first and is never chosen. */
export function cmpVersion(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch || cmpPre(x.pre, y.pre);
}

export function updateType(locked, candidate) {
  const l = parseVersion(locked);
  const c = parseVersion(candidate);
  if (!l || !c) return null;
  if (c.major !== l.major) return 'major';
  if (l.major === 0 && l.minor === 0) return c.minor === 0 && c.patch === l.patch ? 'patch' : 'major';
  if (c.minor !== l.minor) return l.major === 0 ? 'major' : 'minor';
  return 'patch';
}

// ── advisory ranges ─────────────────────────────────────────────────────────────────────────────
// The ranges `npm audit` prints are comparator sets (`>=2.0.0 <2.1.1 || <=1.4.0`). A partial
// version fills with zeros below and widens above: `<=2` is `<3.0.0`, `>2` is `>=3.0.0`.
const PARTIAL_RE = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[0-9A-Za-z.-]+)?$/;

function partial(s) {
  const m = PARTIAL_RE.exec(s);
  if (!m) return null;
  const num = (x) => (x === undefined || /^[xX*]$/.test(x) ? null : Number(x));
  return { major: Number(m[1]), minor: num(m[2]), patch: num(m[3]), pre: m[4] ? m[4].slice(1).split('.') : [] };
}
const full = (p) => ({ major: p.major, minor: p.minor ?? 0, patch: p.patch ?? 0, pre: p.pre });
const bumpAt = (p) => (p.minor === null ? { major: p.major + 1, minor: 0, patch: 0, pre: [] }
  : p.patch === null ? { major: p.major, minor: p.minor + 1, patch: 0, pre: [] } : null);

function comparators(token) {
  const m = /^(<=|>=|<|>|=|\^|~)?\s*(.+)$/.exec(token);
  const op = m[1] || '=';
  if (/^[xX*]$/.test(m[2])) return [];
  const p = partial(m[2]);
  if (!p) return null;
  const upper = bumpAt(p);
  if (op === '<' || op === '>=') return [[op, full(p)]];
  if (op === '<=') return upper ? [['<', upper]] : [['<=', full(p)]];
  if (op === '>') return upper ? [['>=', upper]] : [['>', full(p)]];
  if (op === '^') {
    const f = full(p);
    const hi = f.major > 0 ? { major: f.major + 1, minor: 0, patch: 0, pre: [] }
      : f.minor > 0 || p.patch === null ? { major: 0, minor: f.minor + 1, patch: 0, pre: [] } : { major: 0, minor: 0, patch: f.patch + 1, pre: [] };
    return [['>=', f], ['<', hi]];
  }
  if (op === '~') {
    const f = full(p);
    return [['>=', f], ['<', p.minor === null ? { major: f.major + 1, minor: 0, patch: 0, pre: [] } : { major: f.major, minor: f.minor + 1, patch: 0, pre: [] }]];
  }
  return upper ? [['>=', full(p)], ['<', upper]] : [['=', full(p)]];
}

/** Does `version` fall in `range`? null when the range cannot be read — never a guess. */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return null;
  const alts = String(range ?? '').split('||').map((s) => s.trim());
  let any = false;
  for (const alt of alts) {
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(alt);
    const tokens = hy ? [`>=${hy[1]}`, `<=${hy[2]}`] : alt === '' ? [] : alt.split(/\s+/);
    const cs = [];
    for (const t of tokens) { const c = comparators(t); if (c === null) return null; cs.push(...c); }
    const ok = cs.every(([op, b]) => {
      const d = cmpVersion(v, b);
      return op === '<' ? d < 0 : op === '<=' ? d <= 0 : op === '>' ? d > 0 : op === '>=' ? d >= 0 : d === 0;
    });
    if (ok) any = true;
  }
  return any;
}

const NON_REGISTRY_RE = /^(file:|link:|git(\+|:|hub:|lab:)|bitbucket:|https?:|npm:|workspace:|portal:|patch:)/;

/** Why a declared spec is not a registry version range, or null when it is one. */
export function nonRegistryReason(spec) {
  const s = String(spec ?? '').trim();
  if (NON_REGISTRY_RE.test(s)) return `declared as ${s.split(':')[0]}: — not a registry version`;
  if (/^[^@\s/]+\/[^\s]+$/.test(s)) return 'declared as a repository shorthand — not a registry version';
  if (/^[a-z][\w-]*$/i.test(s) && !/^x$/i.test(s)) return `declared as the dist-tag "${s}", which npm follows itself`;
  return null;
}

function readJson(path, label) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    return { error: e.code === 'ENOENT' ? `${label} not found` : `${label} could not be read (${e.code || e.message})`, absent: e.code === 'ENOENT' };
  }
  try { return { value: JSON.parse(raw) }; } catch (e) { return { error: `${label} is not JSON (${e.message})` }; }
}

const OTHER_LOCKS = [['yarn.lock', 'yarn'], ['pnpm-lock.yaml', 'pnpm'], ['bun.lockb', 'bun'], ['bun.lock', 'bun']];

/** The project's direct dependencies with their locked versions. Fails closed: an unreadable file is an error, never an empty list. */
export function readProject(dir) {
  const pkg = readJson(join(dir, 'package.json'), 'package.json');
  if (pkg.error) return { error: pkg.error };
  const lock = readJson(join(dir, 'package-lock.json'), 'package-lock.json');
  if (lock.error) {
    if (!lock.absent) return { error: lock.error };
    const other = OTHER_LOCKS.find(([f]) => existsSync(join(dir, f)));
    return other
      ? { error: `not measured: this project is locked by ${other[1]} (${other[0]}), and this audit reads npm's package-lock.json only`, ecosystem: other[1] }
      : { error: 'package-lock.json not found: npm audits and updates the lockfile, so there is nothing to measure without one' };
  }
  const lv = lock.value.lockfileVersion;
  if (!lock.value.packages || !(lv >= 2)) return { error: `package-lock.json is lockfileVersion ${lv ?? 'unknown'}; this reads version 2 or 3 (npm 7 and later)` };
  const direct = [];
  for (const kind of DEP_KINDS) {
    const deps = pkg.value[kind];
    if (deps === undefined) continue;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return { error: `package.json ${kind} is not an object` };
    for (const name of Object.keys(deps).sort()) {
      if (direct.some((d) => d.name === name)) continue;
      const entry = lock.value.packages[`node_modules/${name}`];
      direct.push({ name, kind, spec: String(deps[name]), locked: entry && !entry.link ? entry.version ?? null : null, linked: !!entry?.link });
    }
  }
  return {
    name: pkg.value.name ?? null,
    direct,
    runtimeDependencies: Object.keys(pkg.value.dependencies || {}).length,
    workspaces: Array.isArray(pkg.value.workspaces) ? pkg.value.workspaces : pkg.value.workspaces?.packages ?? null,
    overrides: pkg.value.overrides && typeof pkg.value.overrides === 'object' ? Object.keys(pkg.value.overrides).sort() : [],
    lock: lock.value,
  };
}

/**
 * Registry metadata as `npm view <name>[@<locked>] versions time dist-tags deprecated --json` prints
 * it. With `@<locked>`, `deprecated` is the LOCKED version's; the other fields are the package's.
 */
export function normaliseMeta(raw, { lockedUnpublished = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const versions = Array.isArray(raw.versions) ? raw.versions : typeof raw.versions === 'string' ? [raw.versions] : null;
  if (!versions) return null;
  return { versions, time: raw.time && typeof raw.time === 'object' ? raw.time : {}, latest: raw['dist-tags']?.latest ?? null,
    lockedDeprecated: !lockedUnpublished && typeof raw.deprecated === 'string' && raw.deprecated ? raw.deprecated : null, lockedUnpublished };
}

/** `7`, or `{ patch, minor, major }` with any missing type taking the default. */
export function cooldownOf(c) {
  if (typeof c === 'number') return { patch: c, minor: c, major: c };
  return { ...DEFAULT_COOLDOWN, ...(c && typeof c === 'object' ? c : {}) };
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * One dependency's position: the newest release of each update type outside its cooldown, and the
 * releases the cooldown holds — `too-new`, or `unknown-age` when the registry gives no publish time,
 * because an age nobody recorded cannot be shown to be outside the window.
 */
export function planDependency(dep, meta, { nowMs = Date.now(), cooldown = DEFAULT_COOLDOWN } = {}) {
  const cd = cooldownOf(cooldown);
  const row = { name: dep.name, kind: dep.kind, spec: dep.spec, locked: dep.locked, latest: meta?.latest ?? null,
    lockedPublishedAt: null, latestPublishedAt: null, lockedDeprecated: meta?.lockedDeprecated ?? null,
    lockedUnpublished: !!meta?.lockedUnpublished, updates: [], held: [], skipped: null };
  const why = nonRegistryReason(dep.spec);
  if (why) return { ...row, skipped: why };
  if (dep.linked) return { ...row, skipped: 'linked in the lockfile (a workspace or local package)' };
  if (!dep.locked) return { ...row, skipped: 'not in package-lock.json: run npm install, then measure again' };
  if (!parseVersion(dep.locked)) return { ...row, skipped: `locked at ${dep.locked}, which is not a semver version` };
  if (!meta) return { ...row, skipped: 'the registry metadata could not be read' };
  row.lockedPublishedAt = iso(Date.parse(meta.time[dep.locked]));
  row.latestPublishedAt = row.latest ? iso(Date.parse(meta.time[row.latest])) : null;
  const newest = {};
  for (const v of meta.versions) {
    const p = parseVersion(v);
    if (!p || p.pre.length || cmpVersion(p, dep.locked) <= 0) continue;
    const type = updateType(dep.locked, v);
    const published = Date.parse(meta.time[v]);
    const ageDays = Number.isFinite(published) ? (nowMs - published) / DAY_MS : null;
    if (ageDays === null || ageDays < cd[type]) {
      row.held.push({ version: v, type, publishedAt: iso(published), reason: ageDays === null ? 'unknown-age' : 'too-new',
        releasesIn: ageDays === null ? null : Math.ceil(cd[type] - ageDays) });
      continue;
    }
    if (!newest[type] || cmpVersion(v, newest[type].version) > 0) newest[type] = { type, version: v, publishedAt: iso(published) };
  }
  row.updates = UPDATE_TYPES.filter((t) => newest[t]).map((t) => newest[t]);
  row.held.sort((a, b) => cmpVersion(a.version, b.version));
  return row;
}

/** The highest update among the allowed types, or null. */
export function chooseUpdate(row, types) {
  const allowed = row.updates.filter((u) => types.includes(u.type));
  return allowed.length ? allowed.reduce((a, b) => (cmpVersion(b.version, a.version) > 0 ? b : a)) : null;
}

// ── advisories ──────────────────────────────────────────────────────────────────────────────────
/** prod when any node carrying the package ships in a production install; unknown when a node is not in the lockfile. */
export function exposureOf(nodes, lock) {
  const entries = (nodes || []).map((n) => lock?.packages?.[n]);
  if (!entries.length || entries.some((e) => !e)) return 'unknown';
  return entries.some((e) => !e.dev) ? 'prod' : 'dev';
}

const lockedVersionsOf = (nodes, lock) => (nodes || []).map((n) => lock?.packages?.[n]?.version).filter(Boolean).sort(cmpVersion);

/**
 * The fix state of one advisory row, given the vulnerable package's published versions:
 *   available   npm can fix it within the declared ranges
 *   major       npm can fix it by moving a direct dependency to a new major
 *   blocked     a release outside every affected range exists, and a parent's range excludes it —
 *               an `overrides` entry is the remedy
 *   unpatched   no release outside the affected ranges exists at all
 *   undetermined  the ranges or the registry could not be read
 * npm's raw proposal is kept when it is a DOWNGRADE of a package already locked higher (renovate@21
 * for an advisory deep under renovate@44): that is no fix, and the row says so.
 */
export function fixStateOf(row, lock, versions) {
  const fa = row.fixAvailable;
  let proposal = null;
  if (fa && typeof fa === 'object') {
    const locked = lock?.packages?.[`node_modules/${fa.name}`]?.version;
    proposal = { to: `${fa.name}@${fa.version}`, downgrade: !!(locked && cmpVersion(fa.version, locked) < 0), major: !!fa.isSemVerMajor };
  } else if (fa === true) proposal = { to: null, downgrade: false, major: false };
  const ranges = (row.via || []).filter((x) => x && typeof x === 'object').map((x) => x.range).filter(Boolean);
  // A row vulnerable only through other packages carries their fix, whatever npm claims for it.
  if (!ranges.length) return { state: 'via', to: null, proposal };
  const patched = versions ? patchedVersions(row, lock, versions, ranges) : null;
  // npm's fixAvailable means `npm audit fix` would change something, not that the change clears
  // the advisory: it marked braces fixable while every braces release sits inside the range.
  // The registry is the second witness, and it wins when it shows no release outside the range.
  if (patched && !patched.unreadable && !patched.list.length) return { state: 'unpatched', to: null, proposal };
  if (proposal && !proposal.downgrade) return { state: proposal.major ? 'major' : 'available', to: proposal.to, proposal };
  if (!patched) return { state: 'undetermined', to: null, proposal, reason: 'the registry versions of this package could not be read' };
  if (!patched.list.length) return { state: 'undetermined', to: null, proposal, reason: `an affected range could not be read: ${ranges.join(' | ')}` };
  return { state: 'blocked', to: `${row.name}@${patched.list[0]}`, override: { [row.name]: `^${patched.list[0]}` }, proposal };
}

function patchedVersions(row, lock, versions, ranges) {
  const floor = lockedVersionsOf(row.nodes, lock)[0] ?? null;
  let unreadable = false;
  const list = versions.filter((v) => {
    const p = parseVersion(v);
    if (!p || p.pre.length || (floor && cmpVersion(v, floor) <= 0)) return false;
    const hits = ranges.map((r) => satisfies(v, r));
    if (hits.includes(null)) { unreadable = true; return false; }
    return !hits.includes(true);
  }).sort(cmpVersion);
  return { list, unreadable };
}

/**
 * `npm audit --json` → one row per vulnerable package. `versionsOf(name)` supplies registry
 * versions for the rows npm cannot fix itself. A row that is vulnerable only THROUGH another package
 * takes the state of the packages it names.
 */
export function summariseAudit(audit, lock, versionsOf = () => null) {
  if (!audit || typeof audit !== 'object') return { error: 'npm audit printed no JSON' };
  if (audit.error) return { error: `npm audit failed: ${audit.error.summary || audit.error.code || 'unknown error'}` };
  if (!audit.vulnerabilities || typeof audit.vulnerabilities !== 'object') return { error: 'npm audit JSON has no vulnerabilities map (npm 6 format is not read)' };
  const rows = Object.values(audit.vulnerabilities).map((v) => ({
    name: v.name, severity: v.severity, direct: !!v.isDirect, exposure: exposureOf(v.nodes, lock),
    via: (v.via || []).filter((x) => typeof x === 'string'),
    advisories: (v.via || []).filter((x) => x && typeof x === 'object')
      .map((x) => ({ title: x.title || '', url: x.url || '', range: x.range || '', severity: x.severity || v.severity })),
    fix: fixStateOf(v, lock, versionsOf(v.name)),
  }));
  const byName = new Map(rows.map((r) => [r.name, r]));
  const RANK = ['available', 'major', 'blocked', 'undetermined', 'unpatched'];
  // `path` holds only the current chain, so a package reached twice is not mistaken for a cycle.
  const resolve = (r, path = new Set()) => {
    if (r.fix.state !== 'via') return r.fix.state;
    if (path.has(r.name)) return 'undetermined';
    const next = new Set(path).add(r.name);
    const states = r.via.map((n) => (byName.has(n) ? resolve(byName.get(n), next) : 'undetermined'));
    return states.length ? states.reduce((x, y) => (RANK.indexOf(x) <= RANK.indexOf(y) ? x : y)) : 'undetermined';
  };
  for (const r of rows) if (r.fix.state === 'via') r.fix = { ...r.fix, state: resolve(r), through: r.via };
  rows.sort((a, b) => AUDIT_LEVELS.indexOf(b.severity) - AUDIT_LEVELS.indexOf(a.severity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const counts = Object.fromEntries(AUDIT_LEVELS.map((l) => [l, rows.filter((r) => r.severity === l).length]));
  const prod = Object.fromEntries(AUDIT_LEVELS.map((l) => [l, rows.filter((r) => r.severity === l && r.exposure !== 'dev').length]));
  return { rows, counts, prod };
}

/**
 * The gate: rows at or above `level`, shipped (or of unknown exposure) unless `includeDev`.
 * `actionable` an upgrade or an override clears; `undetermined` nobody could say — the gate reports
 * those as unmeasured, never as clear.
 */
export function gate(summary, { level = 'high', includeDev = false } = {}) {
  if (summary.error) return { verdict: 'unmeasured', reason: summary.error, actionable: [], undetermined: [], unpatched: [] };
  const floor = AUDIT_LEVELS.indexOf(level);
  const inScope = summary.rows.filter((r) => AUDIT_LEVELS.indexOf(r.severity) >= floor && (includeDev || r.exposure !== 'dev'));
  const actionable = inScope.filter((r) => ['available', 'major', 'blocked'].includes(r.fix.state));
  const undetermined = inScope.filter((r) => r.fix.state === 'undetermined');
  const unpatched = inScope.filter((r) => r.fix.state === 'unpatched');
  return { verdict: actionable.length ? 'actionable' : undetermined.length ? 'unmeasured' : 'clear', actionable, undetermined, unpatched, inScope: inScope.length };
}

// ── the npm adapter ─────────────────────────────────────────────────────────────────────────────
export const npmBin = () => process.env.CW_NPM || 'npm';

/** Run npm and collect its output. Resolves; a spawn failure is reported, never thrown. */
export function runNpm(args, { cwd = tmpdir(), timeoutMs = 120_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try { child = spawn(npmBin(), args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: null, out, err, spawnError: e.message }); return; }
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out, err, spawnError: e.code || e.message }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, err }); });
  });
}

const parseOut = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
const npmError = (r, j, what) => j?.error?.summary || j?.error?.code || (r.signal ? `${what} was stopped (${r.signal})` : `${what} exited ${r.code}`);

/** Registry metadata for one package, with the locked version's deprecation. */
export async function npmView(name, { cwd, locked = null } = {}) {
  const fields = ['versions', 'time', 'dist-tags', 'deprecated', '--json'];
  const ask = async (spec) => {
    const r = await runNpm(['view', spec, ...fields], { cwd, timeoutMs: 60_000 });
    if (r.spawnError) return { error: `npm could not be started (${r.spawnError})` };
    const j = parseOut(r.out);
    return r.code === 0 ? { j } : { error: npmError(r, j, 'npm view'), notFound: j?.error?.code === 'E404' || /E404|ETARGET|No match found/i.test(r.out + r.err) };
  };
  let got = locked ? await ask(`${name}@${locked}`) : await ask(name);
  let unpublished = false;
  if (locked && got.notFound) {
    const bare = await ask(name);
    if (bare.error) return { error: bare.error };
    got = bare;
    unpublished = !normaliseMeta(bare.j)?.versions.includes(locked);
  }
  if (got.error) return { error: got.error };
  const meta = normaliseMeta(got.j, { lockedUnpublished: unpublished });
  return meta ? { meta } : { error: 'npm view printed no versions' };
}

export async function npmAudit(dir) {
  const r = await runNpm(['audit', '--package-lock-only', '--json'], { cwd: dir, timeoutMs: 180_000 });
  if (r.spawnError) return { error: `npm could not be started (${r.spawnError})` };
  // npm audit exits 1 when it finds advisories; the JSON decides, not the exit code.
  const j = parseOut(r.out);
  if (j === undefined) return { error: r.signal ? `npm audit was stopped (${r.signal})` : `npm audit exited ${r.code} without JSON` };
  return { audit: j };
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * The whole audit of one project. Registry lookups run outside the project unless `trustRepo`:
 * a repository's own .npmrc chooses where npm sends requests, and that is the scanned tree's choice.
 */
export async function auditProject(dir, { cooldown = DEFAULT_COOLDOWN, nowMs = Date.now(), trustRepo = false, view = npmView, audit = npmAudit } = {}) {
  const project = readProject(dir);
  if (project.error) return { dir, error: project.error, ecosystem: project.ecosystem ?? 'npm' };
  const cwd = trustRepo ? dir : tmpdir();
  const metas = await mapLimit(project.direct, 6, (d) => (nonRegistryReason(d.spec) || !d.locked || d.linked ? null : view(d.name, { cwd, locked: d.locked })));
  const deps = project.direct.map((d, i) => {
    const m = metas[i];
    const row = planDependency(d, m?.meta ?? null, { nowMs, cooldown });
    return m?.error ? { ...row, skipped: `registry lookup failed: ${m.error}` } : row;
  });
  const a = await audit(dir);
  let advisories;
  if (a.error) advisories = { error: a.error };
  else {
    const needVersions = Object.values(a.audit?.vulnerabilities || {})
      .filter((v) => (v.via || []).some((x) => x && typeof x === 'object'))
      .map((v) => v.name);
    const looked = await mapLimit(needVersions, 6, (n) => view(n, { cwd }));
    const versions = new Map(needVersions.map((n, i) => [n, looked[i]?.meta?.versions ?? null]));
    advisories = summariseAudit(a.audit, project.lock, (n) => versions.get(n) ?? null);
  }
  return {
    dir, name: project.name, ecosystem: 'npm', cooldown: cooldownOf(cooldown), generatedAt: new Date(nowMs).toISOString(),
    workspaces: project.workspaces, overrides: project.overrides, runtimeDependencies: project.runtimeDependencies,
    counts: Object.fromEntries(UPDATE_TYPES.map((t) => [t, deps.filter((d) => d.updates.some((u) => u.type === t)).length])),
    held: deps.reduce((n, d) => n + d.held.length, 0),
    unmeasured: deps.filter((d) => d.skipped).length,
    deps, advisories,
  };
}

const FIX_TEXT = {
  available: (f) => `fix: ${f.to || 'npm audit fix'}`,
  major: (f) => `fix: ${f.to} (major)`,
  blocked: (f) => `fix blocked by a parent's range: override to ${f.to}`,
  unpatched: (f) => `no release outside the affected range${f.proposal?.downgrade ? ` (npm offers ${f.proposal.to}, a downgrade)` : ''}`,
  undetermined: (f) => `fix undetermined: ${f.reason || 'unknown'}`,
};

export function renderAuditText(r, { types = ['patch', 'minor'] } = {}) {
  if (r.error) return `npm versions: ${r.error}\n`;
  const cd = r.cooldown;
  const out = [`npm versions · ${r.name || r.dir} · ${r.deps.length} direct dependenc${r.deps.length === 1 ? 'y' : 'ies'}`];
  out.push(`  behind: patch ${r.counts.patch} · minor ${r.counts.minor} · major ${r.counts.major}${r.unmeasured ? ` · not measured ${r.unmeasured}` : ''}`);
  out.push(`  cooldown (days): patch ${cd.patch} · minor ${cd.minor} · major ${cd.major} — ${COOLDOWN_WHY}`, '');
  const w = Math.max(4, ...r.deps.map((d) => d.name.length));
  for (const d of r.deps) {
    const pick = chooseUpdate(d, types);
    const tail = d.skipped ? `not measured: ${d.skipped}`
      : d.updates.length ? d.updates.map((u) => `${u.type} ${u.version}`).join(' · ') + (pick ? `  → ${pick.version}` : '')
        : d.held.length ? 'nothing outside the cooldown' : 'current';
    const newestHeld = d.held[d.held.length - 1];
    const held = newestHeld ? `  (held: ${d.held.length} newer, newest ${newestHeld.version} ${newestHeld.reason === 'too-new' ? `eligible in ${newestHeld.releasesIn}d` : 'with no publish time'})` : '';
    const flags = [d.lockedDeprecated ? `locked version deprecated: ${d.lockedDeprecated}` : '', d.lockedUnpublished ? 'locked version unpublished' : ''].filter(Boolean);
    out.push(`  ${d.name.padEnd(w)}  ${String(d.locked ?? '-').padEnd(10)} ${tail}${held}${flags.length ? `  [${flags.join('; ')}]` : ''}`);
  }
  out.push('');
  if (r.advisories.error) out.push(`  advisories: not measured — ${r.advisories.error}`);
  else {
    const c = r.advisories.counts;
    const p = r.advisories.prod;
    out.push(`  advisories: critical ${c.critical} · high ${c.high} · moderate ${c.moderate} · low ${c.low}  (shipped: critical ${p.critical} · high ${p.high} · moderate ${p.moderate} · low ${p.low})`);
    for (const a of r.advisories.rows) {
      out.push(`    ${a.severity.padEnd(8)} ${a.exposure.padEnd(7)} ${a.name}${a.direct ? ' (direct)' : ''} — ${a.advisories[0]?.title || `via ${a.via.join(', ')}`}  [${(FIX_TEXT[a.fix.state] || (() => a.fix.state))(a.fix)}]`);
    }
  }
  if (r.workspaces) out.push('', '  workspaces: only the root package\'s direct dependencies are listed');
  return `${out.join('\n')}\n`;
}

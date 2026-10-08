// admin/routes/scanners.mjs — one scanner at a time: what it does, what installed it, and the levers
// on it (install, uninstall, reinstall, its configuration), plus the per-repository depth and
// intensity table and the detectors that run outside the lane runner.
//
// ACTIONS AND CONFIG WRITES RUN ONLY ON THE OPERATOR PORT. An install endpoint reachable through the
// tunnel would be remote code execution on this machine, which is the boundary
// admin/routes/packages.mjs already holds. The request names a scanner, a tool and a verb; argv is
// built here from the install catalogue and from what provenance found on disk, so no requested
// byte reaches a spawn.
//
// CONFIGURATION IS THE CHECK AND ITS PERF ENTRY, edited as one JSON document. The check's commands
// run on every sweep, so a write is parsed, validated against the manifest schema, refused on a
// stale base hash, and written canonically so the diff is only what the operator changed.

import { readFileSync, existsSync, realpathSync, statSync, mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../../monitor/lockfile.mjs';
import { setSettings } from '../../monitor/settings.mjs';
import { repoLevels, repoTuningTable } from '../../monitor/repo-tuning.mjs';
import { profilesPath, resetProfileCache, depthPlan, intensityPlan } from '../../monitor/perf-tuning.mjs';
import { versionsForTools } from '../../monitor/tool-version.mjs';
import { resolvePinnedTool, INSTALL_COMMAND } from '../../lib/cobolwork-resolve.mjs';
import { validateAgainstSchema, loadRegistry } from '../../monitor/registry.mjs';
import { resolveRepos } from '../../monitor/discover.mjs';
import { areaSlugOf } from '../../monitor/project-scope.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baselinePath = () => process.env.CW_BASELINE_MANIFEST || join(CW, 'manifests', 'security-baseline.json');
const catalogPath = () => process.env.CW_INSTALL_CATALOG || join(CW, 'manifests', 'install-catalog.json');
const manifestsDir = () => process.env.CW_MANIFESTS_DIR || join(CW, 'manifests');
const actionsDir = () => process.env.CW_SCANNER_ACTIONS_DIR || join(homedir(), '.commitwork', 'scanner-actions');
const MANIFEST_SCHEMA = join(CW, 'schema', 'manifest.schema.json');

export const hashOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
const canonical = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, who: 'operator@loopback', operator: true };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  if (!s || !s.user) return { ok: false };
  return { ok: true, who: sessionWho(s), operator: false };
}

// Fail closed: a file that cannot be read or parsed is an error with its reason, never an empty doc.
function readDoc(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { return { ok: false, error: `${path}: ${e.code || e.message}` }; }
  try { return { ok: true, text, doc: JSON.parse(text) }; } catch (e) { return { ok: false, error: `${path} is not valid JSON: ${e.message}` }; }
}

// ── what each check runs ──────────────────────────────────────────────────────────────────────
const NPX_RE = /\bnpx\s+(?:--yes\s+|-y\s+)*((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@[A-Za-z0-9._-]+)/g;

export function checkParts(check, images = []) {
  const text = (Array.isArray(check.local) ? check.local : []).join('\n');
  const npx = [...new Set([...text.matchAll(NPX_RE)].map((m) => m[1]))];
  return {
    tools: (check.requires && Array.isArray(check.requires.tools)) ? check.requires.tools : [],
    images: images.filter((img) => text.includes(img)),
    npx,
  };
}

export function depthKindOf(entry, costClasses) {
  if (!entry) return null;
  const doc = { costClasses };
  return { depth: depthPlan(entry, doc, 5).kind, intensity: intensityPlan(entry, 3).kind };
}

function catalogue() {
  const sb = readDoc(baselinePath());
  if (!sb.ok) return { ok: false, code: 503, error: `the lane manifest could not be read (${sb.error})` };
  const perf = readDoc(profilesPath());
  if (!perf.ok) return { ok: false, code: 503, error: `the tuning model could not be read (${perf.error})` };
  const pd = perf.doc;
  const images = Array.isArray(sb.doc.images) ? sb.doc.images : [];
  const scanners = sb.doc.checks.map((c) => {
    const entry = pd.scanners && Object.prototype.hasOwnProperty.call(pd.scanners, c.id) ? pd.scanners[c.id] : null;
    return {
      id: c.id,
      description: c.description || null,
      groups: c.groups || [],
      ...checkParts(c, images),
      perf: entry,
      kinds: depthKindOf(entry, pd.costClasses),
      inDepthModel: !!entry,
    };
  });
  const inModel = new Set(scanners.map((s) => s.id));
  const otherManifests = [];
  for (const name of ['runtime.json', 'build-health.json', 'quality-gates.json']) {
    const m = readDoc(join(manifestsDir(), name));
    if (!m.ok) { otherManifests.push({ manifest: name, error: m.error }); continue; }
    for (const c of m.doc.checks || []) {
      if (inModel.has(c.id)) continue;
      otherManifests.push({ manifest: name, id: c.id, description: c.description || null, ...checkParts(c, images) });
    }
  }
  const outsideRunner = Object.entries(pd.outsideRunner || {}).map(([id, o]) => ({
    id, ...o, moduleExists: !!(o.module && existsSync(join(CW, o.module))),
  }));
  return { ok: true, scanners, otherManifests, outsideRunner, costClasses: pd.costClasses, depthLevels: pd.depthLevels, intensityLevels: pd.intensityLevels };
}

// ── where a tool came from ────────────────────────────────────────────────────────────────────
export function which(name, { path = process.env.PATH || '' } = {}) {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    try { const st = statSync(p); if (st.isFile() && (st.mode & 0o111)) return p; } catch { /* next */ }
  }
  return null;
}

/** The package manager a resolved binary path belongs to, read from the path itself. */
export function classifyInstall(real, { home = homedir() } = {}) {
  if (!real) return { manager: null };
  let m;
  if ((m = real.match(/\/Cellar\/([^/]+)\/([^/]+)\//))) return { manager: 'brew', pkg: m[1], version: m[2] };
  if ((m = real.match(/\/Caskroom\/([^/]+)\/([^/]+)\//))) return { manager: 'brew-cask', pkg: m[1], version: m[2] };
  if ((m = real.match(/\/pipx\/venvs\/([^/]+)\//))) return { manager: 'pipx', pkg: m[1] };
  if ((m = real.match(/\/lib\/node_modules\/((?:@[^/]+\/)?[^/]+)\//))) return { manager: 'npm', pkg: m[1] };
  if ((m = real.match(/\/gems\/([A-Za-z0-9_.-]+?)-(\d[^/]*)\//))) return { manager: 'gem', pkg: m[1], version: m[2] };
  if (/\/composer\/vendor\//.test(real)) return { manager: 'composer' };
  if (real.startsWith(join(home, '.cargo', 'bin') + '/')) return { manager: 'cargo' };
  if (/\/go\/bin\/[^/]+$/.test(real)) return { manager: 'go' };
  if (/^\/(usr\/)?s?bin\//.test(real) || real.startsWith('/System/')) return { manager: 'system' };
  if ((m = real.match(/\/Applications\/([^/]+)\.app\//))) return { manager: 'app', pkg: m[1] };
  return { manager: 'manual' };
}

const PKG_RE = /^[@A-Za-z0-9][A-Za-z0-9@._/:+-]{0,199}$/;
// The catalogue holds either a package name or, for cargo/gem/go, a whole command line.
function catalogPkg(manager, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const toks = value.trim().split(/\s+/);
  if (toks.length === 1) return PKG_RE.test(toks[0]) ? toks[0] : null;
  const skip = new Set([manager, 'install', 'global', 'require', 'add', '-g']);
  const t = toks.find((x) => !skip.has(x) && !x.startsWith('-'));
  return t && PKG_RE.test(t) ? t : null;
}

const VERBS = {
  brew: { install: (p) => ['brew', 'install', p], uninstall: (p) => ['brew', 'uninstall', p], reinstall: (p) => ['brew', 'reinstall', p] },
  'brew-cask': { install: (p) => ['brew', 'install', '--cask', p], uninstall: (p) => ['brew', 'uninstall', '--cask', p], reinstall: (p) => ['brew', 'reinstall', '--cask', p] },
  pipx: { install: (p) => ['pipx', 'install', p], uninstall: (p) => ['pipx', 'uninstall', p], reinstall: (p) => ['pipx', 'reinstall', p] },
  npm: { install: (p) => ['npm', 'install', '-g', p], uninstall: (p) => ['npm', 'uninstall', '-g', p], reinstall: (p) => ['npm', 'install', '-g', p] },
  cargo: { install: (p) => ['cargo', 'install', p, '--locked'], uninstall: (p) => ['cargo', 'uninstall', p], reinstall: (p) => ['cargo', 'install', '--force', p, '--locked'] },
  gem: { install: (p) => ['gem', 'install', p], uninstall: (p) => ['gem', 'uninstall', '-x', p] },
  composer: { install: (p) => ['composer', 'global', 'require', p], uninstall: (p) => ['composer', 'global', 'remove', p.split(':')[0]] },
  docker: { install: (p) => ['docker', 'pull', p], uninstall: (p) => ['docker', 'image', 'rm', p], reinstall: (p) => ['docker', 'pull', p] },
};
const INSTALL_ORDER = ['brew', 'pipx', 'npm', 'cargo', 'composer', 'gem'];

/** The verbs available for one tool, each with the exact argv it would run. */
export function toolActions(prov, catalogEntry, { onPath = (b) => !!which(b) } = {}) {
  const out = [];
  const add = (verb, manager, pkg, note) => {
    const f = VERBS[manager] && VERBS[manager][verb];
    if (f && pkg && PKG_RE.test(pkg)) out.push({ verb, manager, argv: f(pkg), ...(note ? { note } : {}) });
  };
  if (prov.present) {
    const pkg = prov.pkg || (catalogEntry ? catalogPkg(prov.manager, catalogEntry[prov.manager]) : null);
    for (const verb of ['reinstall', 'uninstall']) add(verb, prov.manager, pkg);
  } else if (catalogEntry) {
    for (const mgr of INSTALL_ORDER) {
      if (!catalogEntry[mgr] || !onPath(mgr === 'brew-cask' ? 'brew' : mgr)) continue;
      add('install', mgr, catalogPkg(mgr, catalogEntry[mgr]));
    }
  }
  return out;
}

function toolProvenance(name, catalog) {
  // A pinned tool is its verified install (lib/cobolwork-resolve.mjs); what PATH holds is not it.
  const pinned = resolvePinnedTool(name);
  const bin = pinned ? (pinned.ok ? pinned.path : null) : which(name);
  let real = null;
  try { real = bin ? realpathSync(bin) : null; } catch { real = bin; }
  const cls = classifyInstall(real);
  const entry = catalog && Object.prototype.hasOwnProperty.call(catalog, name) ? catalog[name] : null;
  const prov = { tool: name, present: !!bin, path: bin, realPath: real, ...cls };
  prov.version = bin ? versionsForTools([name])[name] : { state: 'unavailable', reason: pinned ? pinned.reason : `${name} is not on PATH` };
  prov.catalog = entry ? { why: entry.why || null, url: entry.url || null, managers: Object.keys(entry).filter((k) => VERBS[k] && entry[k]),
    postInstall: entry.postInstall ?? null, requiresAccount: entry.requiresAccount ? entry.requiresAccount.vendor || true : null } : null;
  prov.actions = pinned ? [] : toolActions(prov, entry);
  if (pinned) prov.noActionsWhy = `pinned in manifests/tool-pins.json: \`${INSTALL_COMMAND}\` installs it, and an upgrade is a commit to the pin`;
  else if (bin && !prov.actions.length) {
    prov.noActionsWhy = cls.manager === 'system' ? 'part of the operating system — not something commitwork installs or removes'
      : cls.manager === 'app' ? `ships inside ${cls.pkg}.app — update or remove the application itself`
      : cls.manager === 'go' ? 'installed with go install — remove the binary by hand; there is no uninstall verb'
        : 'not under any package manager commitwork recognises — installed by hand, so it is removed by hand';
  }
  return prov;
}

function imageProvenance(image) {
  const r = spawnSync('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}|{{.Created}}|{{.Id}}', image], { encoding: 'utf8', timeout: 10_000 });
  const actions = ['reinstall', 'uninstall', 'install'].map((verb) => ({ verb, manager: 'docker', argv: VERBS.docker[verb](image) }));
  if (r.error) return { image, present: null, state: 'unknown', reason: `docker could not be asked (${r.error.code || r.error.message})`, actions: [] };
  if (r.status !== 0) {
    const down = /daemon|connect/i.test(r.stderr || '');
    return { image, present: down ? null : false, state: down ? 'unknown' : 'absent', reason: down ? 'the docker daemon is not answering — presence UNKNOWN' : 'not pulled on this machine', actions: down ? [] : actions.filter((a) => a.verb === 'install') };
  }
  const [digests, created, id] = r.stdout.trim().split('|');
  let repoDigests = [];
  try { repoDigests = JSON.parse(digests) || []; } catch { /* keep empty */ }
  return { image, present: true, state: 'present', manager: 'docker', repoDigests, created, id, actions: actions.filter((a) => a.verb !== 'install') };
}

function provenance(id) {
  const cat = catalogue();
  if (!cat.ok) return cat;
  const s = cat.scanners.find((x) => x.id === id) || cat.otherManifests.find((x) => x.id === id);
  if (!s) return { ok: false, code: 404, error: `no scanner ${JSON.stringify(id)}` };
  const ic = readDoc(catalogPath());
  const catalog = ic.ok ? ic.doc.tools || {} : null;
  return {
    ok: true, id,
    catalogError: ic.ok ? null : ic.error,
    tools: (s.tools || []).map((t) => toolProvenance(t, catalog)),
    images: (s.images || []).map(imageProvenance),
    npx: (s.npx || []).map((spec) => ({ spec, manager: 'npx', note: 'fetched from the npm registry by npx at run time and cached under ~/.npm/_npx — nothing is installed, so there is nothing to uninstall' })),
  };
}

// ── jobs ──────────────────────────────────────────────────────────────────────────────────────
let spawnImpl = spawn;
/** Tests replace the spawner; nothing else may. */
export function _setSpawn(f) { spawnImpl = f || spawn; }

const JOB_RE = /^[0-9]{8}T[0-9]{6}-[a-f0-9]{8}$/;
const jobPath = (jid, ext) => join(actionsDir(), `${jid}.${ext}`);

function writeJob(job) { writeAtomic(jobPath(job.id, 'json'), canonical(job)); }

export function startJob({ scanner, tool, verb, argv, postInstall = [] }) {
  mkdirSync(actionsDir(), { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const id = `${stamp}-${randomBytes(4).toString('hex')}`;
  const job = { id, scanner, tool, verb, argv, postInstall, state: 'running', startedAt: new Date().toISOString(), steps: [] };
  writeJob(job);
  const fd = openSync(jobPath(id, 'log'), 'a', 0o600);
  const queue = [argv, ...postInstall];
  const next = () => {
    const step = queue.shift();
    if (!step) { job.state = 'done'; job.endedAt = new Date().toISOString(); closeSync(fd); writeJob(job); return; }
    writeFileSync(fd, `$ ${step.join(' ')}\n`);
    let child;
    try { child = spawnImpl(step[0], step.slice(1), { stdio: ['ignore', fd, fd], env: process.env }); }
    catch (e) { job.state = 'failed'; job.error = e.message; closeSync(fd); writeJob(job); return; }
    child.on('error', (e) => { job.state = 'failed'; job.error = e.message; job.steps.push({ argv: step, error: e.message }); try { closeSync(fd); } catch { /* closed */ } writeJob(job); });
    child.on('exit', (code, signal) => {
      job.steps.push({ argv: step, code, signal });
      if (code !== 0) { job.state = 'failed'; job.endedAt = new Date().toISOString(); closeSync(fd); writeJob(job); return; }
      writeJob(job);
      next();
    });
  };
  next();
  return job;
}

function readJob(jid) {
  if (!JOB_RE.test(jid)) return { ok: false, code: 400, error: 'not a job id' };
  const j = readDoc(jobPath(jid, 'json'));
  if (!j.ok) return { ok: false, code: 404, error: `no such job (${j.error})` };
  let log = '';
  try { log = readFileSync(jobPath(jid, 'log'), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') log = `(log unreadable: ${e.code})`; }
  return { ok: true, job: j.doc, log: log.length > 20000 ? `…${log.slice(-20000)}` : log };
}

// ── configuration ─────────────────────────────────────────────────────────────────────────────
const PERF_SCHEMA = join(CW, 'schema', 'perf-profiles.schema.json');

function checkLadder(name, l) {
  if (l === undefined) return null;
  if (!Array.isArray(l) || l.length < 2) return `${name} must list at least two levels`;
  for (const e of l) {
    const label = e && typeof e === 'object' ? e.label : e;
    if (typeof label !== 'string' || !label.trim()) return `${name}: every level needs a label`;
  }
  return null;
}

/** Everything wrong with a proposed {check, perf} for scanner `id`; [] when it may be written. */
export function validateConfig(id, proposed, { sbDoc, perfDoc }) {
  const errs = [];
  if (!proposed || typeof proposed !== 'object' || Array.isArray(proposed)) return ['the document must be an object of {check, perf}'];
  for (const k of Object.keys(proposed)) if (k !== 'check' && k !== 'perf') errs.push(`unknown top-level field ${JSON.stringify(k)} — only check and perf`);
  const { check, perf } = proposed;
  if (!check || typeof check !== 'object') errs.push('check must be an object');
  else if (check.id !== id) errs.push(`check.id must stay ${JSON.stringify(id)} — renaming a lane here would orphan its history and its perf entry`);
  if (!perf || typeof perf !== 'object' || Array.isArray(perf)) errs.push('perf must be an object — every lane needs a tuning entry, or the depth model cannot say whether it runs');
  else {
    if (!perfDoc.costClasses || !Object.prototype.hasOwnProperty.call(perfDoc.costClasses, perf.cost)) errs.push(`perf.cost must be one of ${Object.keys(perfDoc.costClasses || {}).join(', ')}`);
    if (perf.minDepth !== undefined && !(Number.isInteger(perf.minDepth) && perf.minDepth >= 1 && perf.minDepth <= 5)) errs.push('perf.minDepth must be an integer 1-5');
    for (const k of ['depthLadder', 'intensityLadder']) { const e = checkLadder(`perf.${k}`, perf[k]); if (e) errs.push(e); }
    if (check && Array.isArray(perf.depthLadder) && !/CW_DEPTH_(RANK|LEVEL)/.test((check.local || []).join('\n'))) errs.push('perf.depthLadder declares levels the check\'s commands never read (no CW_DEPTH_RANK or CW_DEPTH_LEVEL) — every level would run the same thing');
    if (check && Array.isArray(perf.intensityLadder) && !/CW_INTENSITY_(RANK|LEVEL)/.test((check.local || []).join('\n'))) errs.push('perf.intensityLadder declares levels the check\'s commands never read');
  }
  if (!errs.length) {
    const next = { ...sbDoc, checks: sbDoc.checks.map((c) => (c.id === id ? check : c)) };
    for (const e of validateAgainstSchema(next, { path: MANIFEST_SCHEMA }).errors.slice(0, 10)) errs.push(`manifest schema: ${e}`);
    // The same schema the shipped model is gated on, so a misspelt field is refused here rather than
    // silently ignored by the model on the next sweep.
    const nextPerf = { ...perfDoc, scanners: { ...perfDoc.scanners, [id]: perf } };
    for (const e of validateAgainstSchema(nextPerf, { path: PERF_SCHEMA }).errors.slice(0, 10)) errs.push(`perf schema: ${e}`);
  }
  return errs;
}

function readConfig(id) {
  const sb = readDoc(baselinePath());
  if (!sb.ok) return { ok: false, code: 503, error: sb.error };
  const perf = readDoc(profilesPath());
  if (!perf.ok) return { ok: false, code: 503, error: perf.error };
  const check = sb.doc.checks.find((c) => c.id === id);
  if (!check) return { ok: false, code: 404, error: `no check ${JSON.stringify(id)} in the lane manifest` };
  const entry = perf.doc.scanners && perf.doc.scanners[id] ? perf.doc.scanners[id] : null;
  return { ok: true, sb, perf, check, entry, baseHash: hashOf(`${sb.text}\u0000${perf.text}`) };
}

// ── per-repository depth and intensity ─────────────────────────────────────────────────────────
let repoCache = null;
let repoCacheAt = 0;
function knownRepos() {
  if (repoCache && Date.now() - repoCacheAt < 30_000) return repoCache;
  const reg = loadRegistry({ quiet: true });
  const { repos } = resolveRepos(reg, { selfRoot: CW });
  repoCache = repos.map((r) => ({ name: r.name, area: r.area || areaSlugOf(r.name) || null })).sort((a, b) => a.name.localeCompare(b.name));
  repoCacheAt = Date.now();
  return repoCache;
}
export function _resetRepoCache() { repoCache = null; repoCacheAt = 0; }

function reposState() {
  let repos = null;
  let reposError = null;
  try { repos = knownRepos(); } catch (e) { reposError = `the repository list could not be resolved (${e.message}) — overrides are shown, and none can be added`; }
  const fleet = repoLevels(null);
  const table = repoTuningTable();
  const rows = (repos || []).map((r) => {
    const l = repoLevels(r.name);
    return { ...r, depth: l.depth, intensity: l.intensity, overridden: l.overridden };
  });
  const listed = new Set(rows.map((r) => r.name));
  const orphans = Object.keys(table.value || {}).filter((n) => !listed.has(n));
  return { ok: true, fleet: { depth: fleet.depth, intensity: fleet.intensity }, table, repos: rows, reposError, orphans, notes: fleet.notes };
}

// ── routes ────────────────────────────────────────────────────────────────────────────────────
const refuseRemote = (ctx, what) => ctx.send(403, { ok: false, error: `${what} runs only on the operator port (loopback) — through the tunnel it would be remote code execution on this machine` });
const idOf = (ctx) => String(ctx.query.get('id') || '');

export const routes = [
  { method: 'GET', path: '/api/scanners', handle: (ctx) => {
    if (!gate(ctx).ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    const c = catalogue();
    return ctx.send(c.ok ? 200 : c.code, c);
  } },

  { method: 'GET', path: '/api/scanners/provenance', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    const p = provenance(idOf(ctx));
    return ctx.send(p.ok ? 200 : p.code, { ...p, canAct: g.operator });
  } },

  { method: 'POST', path: '/api/scanners/action', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    if (!g.operator) return refuseRemote(ctx, 'installing, removing or reinstalling a scanner');
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const { id, tool, verb } = body || {};
      const p = provenance(String(id || ''));
      if (!p.ok) return ctx.send(p.code, p);
      const target = [...p.tools.map((t) => ({ name: t.tool, ...t })), ...p.images.map((i) => ({ name: i.image, ...i }))].find((t) => t.name === tool);
      if (!target) return ctx.send(400, { ok: false, error: `${JSON.stringify(tool)} is not a tool or image the ${id} lane uses` });
      const act = (target.actions || []).find((a) => a.verb === verb);
      if (!act) return ctx.send(400, { ok: false, error: `${verb} is not available for ${tool} here — available: ${(target.actions || []).map((a) => a.verb).join(', ') || 'none'}${target.noActionsWhy ? ` (${target.noActionsWhy})` : ''}` });
      const post = verb !== 'uninstall' && target.catalog && Array.isArray(target.catalog.postInstall) ? target.catalog.postInstall.filter((a) => Array.isArray(a) && a.every((x) => typeof x === 'string')) : [];
      const job = startJob({ scanner: p.id, tool, verb, argv: act.argv, postInstall: post });
      return ctx.send(202, { ok: true, job });
    });
  } },

  { method: 'GET', path: '/api/scanners/action', handle: (ctx) => {
    if (!gate(ctx).ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    const j = readJob(String(ctx.query.get('job') || ''));
    return ctx.send(j.ok ? 200 : j.code, j);
  } },

  { method: 'GET', path: '/api/scanners/config', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    const r = readConfig(idOf(ctx));
    if (!r.ok) return ctx.send(r.code, r);
    return ctx.send(200, { ok: true, id: r.check.id, text: canonical({ check: r.check, perf: r.entry }), baseHash: r.baseHash, canWrite: g.operator,
      files: ['manifests/security-baseline.json', 'monitor/perf-profiles.json'] });
  } },

  { method: 'POST', path: '/api/scanners/config', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    if (!g.operator) return refuseRemote(ctx, 'changing a lane\'s commands');
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const id = String((body && body.id) || '');
      const r = readConfig(id);
      if (!r.ok) return ctx.send(r.code, r);
      if (typeof body.baseHash !== 'string') return ctx.send(400, { ok: false, error: 'baseHash is required — a write with no base version cannot detect a conflict' });
      if (body.baseHash !== r.baseHash) return ctx.send(409, { ok: false, error: 'the lane manifest or the tuning model changed since this editor opened — nothing was written', currentText: canonical({ check: r.check, perf: r.entry }), currentHash: r.baseHash });
      let proposed;
      try { proposed = JSON.parse(String(body.text)); } catch (e) { return ctx.send(400, { ok: false, error: `not valid JSON, nothing was written: ${e.message}` }); }
      const errors = validateConfig(id, proposed, { sbDoc: r.sb.doc, perfDoc: r.perf.doc });
      if (errors.length) return ctx.send(400, { ok: false, error: errors.join('; '), errors });
      const sbNext = canonical({ ...r.sb.doc, checks: r.sb.doc.checks.map((c) => (c.id === id ? proposed.check : c)) });
      const perfNext = canonical({ ...r.perf.doc, scanners: { ...r.perf.doc.scanners, [id]: proposed.perf } });
      try { writeAtomic(baselinePath(), sbNext); }
      catch (e) { return ctx.send(500, { ok: false, error: `write failed, nothing changed: ${e.message}` }); }
      try { writeAtomic(profilesPath(), perfNext); }
      catch (e) {
        // Two files are not one transaction. Put the first back rather than leave a check whose
        // tuning entry describes a different lane.
        try { writeAtomic(baselinePath(), r.sb.text); } catch { /* reported below */ }
        return ctx.send(500, { ok: false, error: `the tuning model could not be written (${e.message}); the lane manifest was restored` });
      }
      resetProfileCache();
      return ctx.send(200, { ok: true, id, baseHash: hashOf(`${sbNext}\u0000${perfNext}`), by: g.who });
    });
  } },

  { method: 'GET', path: '/api/scanners/repos', handle: (ctx) => {
    if (!gate(ctx).ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, reposState()); }
    catch (e) { return ctx.send(500, { ok: false, error: `the per-repository table could not be read: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/scanners/repos', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const next = body && Object.prototype.hasOwnProperty.call(body, 'repoTuning') ? body.repoTuning : undefined;
      if (next === undefined) return ctx.send(400, { ok: false, error: 'repoTuning is required — null clears every override' });
      const value = next && typeof next === 'object' && !Array.isArray(next) && !Object.keys(next).length ? null : next;
      if (value) {
        let known;
        try { known = new Set(knownRepos().map((r) => r.name)); }
        catch (e) { return ctx.send(503, { ok: false, error: `the repository list could not be resolved (${e.message}) — nothing was written, because a name cannot be checked` }); }
        const current = repoTuningTable().value || {};
        const unknown = Object.keys(value).filter((n) => !known.has(n) && !Object.prototype.hasOwnProperty.call(current, n));
        if (unknown.length) return ctx.send(400, { ok: false, error: `not a repository the sweep resolves: ${unknown.join(', ')} — an override for a name no sweep scans applies to nothing` });
      }
      const r = setSettings({ repoTuning: value }, { who: g.who });
      if (!r.ok) return ctx.send(r.code || 400, { ...r, error: (r.errors || ['the write was refused']).join('; ') });
      return ctx.send(200, { ...reposState(), written: r.written, by: g.who });
    });
  } },
];

export default routes;

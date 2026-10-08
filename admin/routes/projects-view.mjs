// admin/routes/projects-view.mjs — the Projects tab: the designated repository folder, organised
// by its own folder structure, joined against the registry.
//
// TWO SOURCES, ONE JOIN, SAME DIRECTION AS THE SWEEP. The folder walk shows what EXISTS on disk;
// resolveRepos() — the sweep's own resolver, never a reimplementation — says what the fleet would
// actually scan. The join is the product: a repo that exists but resolves to nothing is a coverage
// gap, and a registry entry whose path is missing is a dangling declaration. Both render as their
// own states; neither is ever silently dropped (explicit uncertainty applies to WHICH directories were
// even considered).
//
// THE WALK IS DISPLAY, THE RESOLVER IS TRUTH. This module's walk deliberately shows MORE than
// discovery would take: excluded names render as "excluded" rather than vanishing, non-repo
// folders render as "not a repo", and a git repo the resolver did not return renders as
// "unlisted" with the reason derivable. A management view that applies the discovery filters
// before rendering would show the operator exactly the subset that needs no attention.
//
// THE WRITE PATH REGISTERS, IT DOES NOT INTEGRATE. POST /api/projects/add appends one explicit
// entry to monitor/projects.json (registry ruling: "add X" means DECLARE X). The modified document
// is validated with the SAME two gates loadRegistry() applies — validateRegistry() and
// validateAgainstSchema() — before a byte is written, because the panel refuses to boot on a
// broken registry: a write this route lets through unvalidated could brick the next panel start.
// Write is lock-guarded read-modify-write + tmp+rename, same shape as the annotations store.
//
// Env overrides are read at CALL time, never at module load (CW_PROJECTS_ROOT, CW_REGISTRY), so a
// test that sets them after import still measures something.

import { readdirSync, readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, sep, relative, dirname } from 'node:path';
import { CW, registry, registryStale } from '../lib/core.mjs';
import { resolveRepos, expandHome } from '../../monitor/discover.mjs';
import { NAME_RE, SLUG_RE, isExampleRegistry, validateRegistry, validateAgainstSchema, areaLabel, repoArea } from '../../monitor/registry.mjs';
import { registryPathFor } from '../../monitor/store-paths.mjs';
import { buildRegistry } from '../../bin/init.mjs';
import { acquireLock, forceReleaseLock, writeAtomic } from '../../monitor/lockfile.mjs';

// Resolved at call time, so a test that sets CW_REGISTRY after importing this module hits its
// fixture. Writers never take registryPath()'s fallback: on a clone with no registry it resolves the
// shipped example for READS, and the panel's first add wrote the user's project into that tracked
// file (measured 2026-10-07). A writer targets the real registry, or CW_REGISTRY when one is named.
const writePath = (root) => registryPathFor(root);
const EXAMPLE_REFUSAL = 'the target is the shipped example registry, a template rather than a store — run `commitwork init`, or point CW_REGISTRY at a real registry';

// same structural-noise set discovery uses; these render muted rather than disappearing
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', 'vendor', 'reports']);

const isGitRepo = (dir) => existsSync(join(dir, '.git'));

// ── the designated roots ────────────────────────────────────────────────────────────────────────
// CW_PROJECTS_ROOT (call time) replaces the registry's roots[] wholesale; otherwise every declared
// root is walked. No roots and no override is its own displayed state, never an empty tree.
export function designatedRoots(reg) {
  const env = process.env.CW_PROJECTS_ROOT;
  if (env) return [{ path: resolve(expandHome(env)), declared: env, source: 'env:CW_PROJECTS_ROOT', maxDepth: 2, exclude: [] }];
  return (reg.roots || []).map((r) => ({
    path: resolve(expandHome(r.path)), declared: r.path, source: 'registry:roots[]',
    maxDepth: r.maxDepth || 1, exclude: r.exclude || [],
  }));
}

function listDirs(dir) {
  // non-ENOENT read failures are UNREADABLE, not empty — the caller renders the reason
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
}

// one node of the tree: a directory, classified by joining disk state against the resolver
function classify(dirPath, name, { byPath, excluded, self }) {
  const repo = isGitRepo(dirPath);
  const hit = byPath.get(dirPath);
  if (hit) {
    return {
      kind: 'repo', status: hit.source === 'explicit' ? 'registered' : 'discovered',
      project: hit.name, area: hit.areaSlug, areaLabel: hit.areaLabel, manifest: hit.manifest,
      ...(hit.superseded ? { superseded: true } : {}),
    };
  }
  if (excluded.has(name)) return { kind: repo ? 'repo' : 'dir', status: 'excluded' };
  if (name.startsWith('_') || SKIP_DIRS.has(name)) return { kind: repo ? 'repo' : 'dir', status: 'structural-skip' };
  if (repo) {
    if (self && dirPath === self) return { kind: 'repo', status: 'self' };
    // a git repo the resolver did not return: say why when the reason is derivable
    const reason = !NAME_RE.test(name) ? `name rejected (must match ${NAME_RE})` : 'not resolved by discovery';
    return { kind: 'repo', status: 'unlisted', reason };
  }
  return { kind: 'dir', status: 'not-a-repo' };
}

// ── GET payload ─────────────────────────────────────────────────────────────────────────────────
// -> { ok, roots: [{path, source, state, groups: [{dir, nodes:[…]}]}], outside: […], counts, notes }
// A failed walk of one root fails THAT root (state + reason), not the whole payload.
export function projectsTree({ reg = null, selfRoot = CW } = {}) {
  let live = reg;
  if (!live) {
    try { live = registry(); }
    catch (e) { return { ok: false, reason: `the registry could not be read (${e.message}) — the project tree is UNKNOWN, not empty` }; }
  }

  let resolved;
  try { resolved = resolveRepos(live, { selfRoot }); }
  catch (e) { return { ok: false, reason: `discovery failed (${e.message}) — nothing below can say what the fleet scans` }; }

  const byPath = new Map();
  for (const r of resolved.repos) {
    const slug = repoArea(r, live) || null;
    byPath.set(resolve(r.path), {
      name: r.name, source: r.source === 'explicit' ? 'explicit' : 'root',
      manifest: r.manifest, superseded: !!r.superseded,
      areaSlug: slug, areaLabel: slug ? areaLabel(slug, live) : null,
    });
  }
  const excluded = new Set(live.exclude || []);
  const self = selfRoot ? resolve(selfRoot) : null;
  const counts = { repos: 0, registered: 0, discovered: 0, excluded: 0, unlisted: 0 };
  const tally = (node) => {
    if (node.kind === 'repo') counts.repos++;
    if (node.status === 'registered' || node.status === 'self') counts.registered++;
    else if (node.status === 'discovered') counts.discovered++;
    else if (node.status === 'excluded') counts.excluded++;
    else if (node.status === 'unlisted') counts.unlisted++;
  };

  const roots = [];
  const seenPaths = new Set();
  for (const root of designatedRoots(live)) {
    const out = { path: root.path, declared: root.declared, source: root.source, groups: [] };
    roots.push(out);
    if (!existsSync(root.path)) { out.state = 'absent'; out.reason = 'the designated folder does not exist on this machine'; continue; }
    const rootExclude = new Set([...excluded, ...root.exclude]);
    let top;
    try { top = listDirs(root.path); }
    catch (e) { out.state = 'unreadable'; out.reason = `the designated folder could not be read (${e.code || e.message}) — contents are UNKNOWN, not empty`; continue; }
    out.state = 'walked';

    // folder structure preserved: repos directly under the root group under '' ; each org folder
    // is its own group with its children classified one level down (the roots-walk depth model)
    const rootGroup = { dir: '', nodes: [] };
    for (const name of top.sort()) {
      const p = join(root.path, name);
      seenPaths.add(p);
      const node = { name, rel: name, ...classify(p, name, { byPath: byPath, excluded: rootExclude, self }) };
      if (node.kind === 'repo' || node.status === 'excluded' || node.status === 'structural-skip') {
        rootGroup.nodes.push(node); tally(node);
        continue;
      }
      if (root.maxDepth <= 1) { rootGroup.nodes.push(node); tally(node); continue; }
      // an org folder: classify its children; an unreadable org folder is its own state
      const group = { dir: name, nodes: [] };
      let kids;
      try { kids = listDirs(p); }
      catch (e) { group.state = 'unreadable'; group.reason = `could not be read (${e.code || e.message})`; out.groups.push(group); continue; }
      for (const kid of kids.sort()) {
        const kp = join(p, kid);
        seenPaths.add(kp);
        const knode = { name: kid, rel: relative(root.path, kp).split(sep).join('/'), ...classify(kp, kid, { byPath, excluded: rootExclude, self }) };
        group.nodes.push(knode); tally(knode);
      }
      if (!group.nodes.length) { group.state = 'empty'; }
      out.groups.push(group);
    }
    if (rootGroup.nodes.length) out.groups.unshift(rootGroup);
  }

  // explicit entries whose paths sit OUTSIDE every designated root: still part of the registry's
  // answer, so the tree carries them rather than letting the registry look smaller than it is.
  // A declared path that does not exist is a DANGLING declaration and says so.
  const outside = [];
  for (const p of live.projects || []) {
    const abs = resolve(expandHome(p.path));
    if (seenPaths.has(abs)) continue;
    if (roots.some((r) => abs === r.path || abs.startsWith(r.path + sep))) continue; // inside a root but below the walked depth — the walk already represented its ancestor
    const slug = p.area || null;
    outside.push({
      name: p.name, path: p.path, kind: 'repo', status: existsSync(abs) ? 'registered' : 'dangling',
      ...(existsSync(abs) ? {} : { reason: 'declared path does not exist on this machine' }),
      project: p.name, area: slug, areaLabel: slug ? areaLabel(slug, live) : null, manifest: p.manifest,
    });
    if (existsSync(abs)) counts.registered++; // dangling is deliberately NOT counted as registered
  }

  return { ok: true, roots, outside, counts, notes: resolved.notes || [], registryStale: registryStale() };
}

// ── POST /api/projects/add ──────────────────────────────────────────────────────────────────────
// Registers one explicit entry. Pure function so the tests exercise every refusal without HTTP.
// -> { ok:true, entry, areaCreated, alreadyDiscovered } | { ok:false, code, error, … }
export function addProject(body, { selfRoot = CW, who = 'operator' } = {}) {
  const bad = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
  if (!body || typeof body !== 'object') return bad(400, 'body must be a JSON object');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!NAME_RE.test(name)) return bad(400, `name must match ${NAME_RE}`);
  const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
  if (!rawPath) return bad(400, 'path is required');
  const abs = resolve(expandHome(rawPath));
  let st;
  try { st = statSync(abs); }
  catch (e) {
    if (e.code === 'ENOENT') return bad(400, `path does not exist: ${abs}`);
    return bad(503, `path could not be inspected (${e.code || e.message}) — refusing to register what cannot be seen`);
  }
  if (!st.isDirectory()) return bad(400, 'path is not a directory');
  if (!isGitRepo(abs) && body.force !== true) {
    return bad(400, 'path is not a git repository (no .git). Pass force:true to register it anyway.');
  }

  // fresh raw read, never the cached/augmented registry() — this document goes back to disk
  const target = writePath(selfRoot);
  if (isExampleRegistry(target)) return bad(409, EXAMPLE_REFUSAL);
  // No registry yet is the first add on a fresh clone: start from the one `commitwork init` writes.
  let doc;
  let registryCreated = false;
  try { doc = JSON.parse(readFileSync(target, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') return bad(503, `the registry could not be read (${e.code || e.message}) — refusing to write over what could not be parsed`);
    doc = buildRegistry({ registryPath: target });
    registryCreated = true;
  }

  const projects = Array.isArray(doc.projects) ? doc.projects : [];
  for (const p of projects) {
    if (p.name === name) return bad(409, `an explicit project named '${name}' already exists`);
    const ep = resolve(expandHome(p.path));
    if (ep === abs || abs.startsWith(ep + sep) || ep.startsWith(abs + sep)) {
      return bad(409, `path overlaps the explicit project '${p.name}' (${p.path})`);
    }
  }

  // area is REQUIRED once areas[] is declared (registry rule) — own-name area needs no block
  const area = typeof body.area === 'string' ? body.area.trim() : '';
  let areaCreated = false;
  if (doc.areas !== undefined) {
    if (!SLUG_RE.test(area)) return bad(400, `area must match ${SLUG_RE} (required: this registry declares areas[])`, { areas: (doc.areas || []).map((a) => a.slug) });
    const known = new Set((doc.areas || []).map((a) => a.slug));
    if (!known.has(area) && area !== name) {
      if (body.createArea !== true) {
        return bad(400, `area '${area}' has no areas[] block and is not the project's own name — pass createArea:true to declare it, or pick an existing one`, { areas: [...known].sort() });
      }
      doc.areas.push({ slug: area, label: typeof body.areaLabel === 'string' && body.areaLabel.trim() ? body.areaLabel.trim() : name, out: area, members: [name], note: `declared via the panel by ${who}, ${new Date().toISOString()}` });
      areaCreated = true;
    }
  }

  // was this repo already covered by the ROOTS walk? informational — an explicit entry still
  // WINS (it pins area + manifest), but the response says so rather than implying it was absent
  let alreadyDiscovered = false;
  try {
    const pre = resolveRepos(doc, { selfRoot });
    alreadyDiscovered = pre.repos.some((r) => resolve(r.path) === abs);
  } catch { alreadyDiscovered = false; }

  const entry = {
    name,
    ...(doc.areas !== undefined ? { area } : {}),
    path: rawPath,
    manifest: typeof body.manifest === 'string' && body.manifest.trim() ? body.manifest.trim() : (doc.defaultManifest || 'security-baseline'),
    note: `registered via the panel by ${who}, ${new Date().toISOString()}${typeof body.note === 'string' && body.note.trim() ? ` — ${body.note.trim()}` : ''}`,
  };
  doc.projects = [...projects, entry];

  // the SAME two gates loadRegistry() applies — a document either gate refuses never reaches disk,
  // because the panel refuses to BOOT on a registry it cannot load
  const v = validateRegistry(doc);
  if (v.errors.length) return bad(400, 'the registry would be invalid after this write — refused', { errors: v.errors });
  try {
    const s = validateAgainstSchema(doc);
    if (s && Array.isArray(s.errors) && s.errors.length) return bad(400, 'the registry would fail its schema after this write — refused', { errors: s.errors });
  } catch (e) {
    return bad(503, `schema validation itself failed (${e.message}) — refusing to write what cannot be checked`);
  }

  // lock, RE-read, re-apply, write: the pre-lock read built the answer, but the bytes that go
  // back must be modified from the bytes on disk AT WRITE TIME or a concurrent writer is lost
  if (registryCreated) mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const lock = acquireLock(target + '.lock', { attempts: 25, spinMs: 20, label: 'panel add-project' });
  if (!lock || lock.ok === false) return bad(409, `the registry is locked by ${lock && lock.holder ? JSON.stringify(lock.holder) : 'another writer'} — retry shortly`);
  try {
    let fresh;
    try { fresh = JSON.parse(readFileSync(target, 'utf8')); }
    catch (e) {
      if (!(registryCreated && e.code === 'ENOENT')) return bad(503, `the registry changed and could not be re-read (${e.code || e.message})`);
      fresh = buildRegistry({ registryPath: target });
    }
    if ((fresh.projects || []).some((p) => p.name === name)) return bad(409, `an explicit project named '${name}' was added concurrently`);
    fresh.projects = [...(fresh.projects || []), entry];
    if (areaCreated && !(fresh.areas || []).some((a) => a.slug === area)) fresh.areas.push(doc.areas[doc.areas.length - 1]);
    const fv = validateRegistry(fresh);
    if (fv.errors.length) return bad(409, 'a concurrent edit left the registry in a state this write would break — refused', { errors: fv.errors });
    writeAtomic(target, JSON.stringify(fresh, null, 2) + '\n');
  } finally {
    if (typeof lock.release === 'function') lock.release(); else forceReleaseLock(target + '.lock');
  }
  return { ok: true, entry, areaCreated, alreadyDiscovered, ...(registryCreated ? { registryCreated: target } : {}) };
}

// ── Semgrep Pro allocation ──────────────────────────────────────────────────────────────────────
// Semgrep Pro is licensed for a bounded number of repositories. The bound lives in
// monitor/registry.mjs and is enforced by validateRegistry, so this route does not carry its own
// copy of the number — it writes the proposed list and lets the validator refuse, which is why the
// cap cannot be bypassed by reaching the registry another way.
//
// WHY THE WHOLE LIST AND NOT A SINGLE TOGGLE. A per-checkbox {name, on} call reads the count from
// whatever the browser last rendered, so two operators each ticking their tenth box both believe
// they are at ten and the file ends at eleven. Sending the entire intended set makes the request
// self-describing: the count that is checked is the count that is written.
//
// A REJECTED SAVE MUST LEAVE NOTHING BEHIND. The refusal happens before the lock and again inside
// it, because the set that was legal when the operator ticked the box may not be legal by the time
// the bytes land — another session may have spent the last seat in between.
export function setSemgrepPro(body, { who = 'operator', selfRoot = CW } = {}) {
  const bad = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
  if (!body || typeof body !== 'object') return bad(400, 'body must be a JSON object');
  if (!Array.isArray(body.repos)) return bad(400, 'repos must be an array of project names');
  // de-duplicate here rather than reject: two checkboxes cannot both be ticked for one repo, so a
  // repeat is a transport artefact, not an operator decision. Order is normalised so the file does
  // not churn when the same set arrives from a differently-sorted view.
  const repos = [...new Set(body.repos.map((n) => (typeof n === 'string' ? n.trim() : n)))]
    .filter((n) => n !== '').sort();
  if (repos.some((n) => typeof n !== 'string')) return bad(400, 'repos holds a non-string entry');

  const target = writePath(selfRoot);
  if (isExampleRegistry(target)) return bad(409, EXAMPLE_REFUSAL);
  let doc;
  try { doc = JSON.parse(readFileSync(target, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return bad(409, 'there is no registry yet — add a project or run `commitwork init` first');
    return bad(503, `the registry could not be read (${e.code || e.message}) — refusing to write over what could not be checked`);
  }

  // A SEAT IS SPENT ON A RESOLVED REPO, NOT ON A DECLARED PROJECT. Measured 2026-08-29: 8
  // projects[] entries resolve to 119 scanned repos, 112 of whose names appear in no projects[]
  // entry. Validating against projects[] therefore refuses real repos and accepts group names the
  // sweep never matches — the seat would be spent on nothing, silently, which is the failure this
  // check exists to prevent. resolveRepos() is the same resolution the sweep performs, so the
  // names checked here are exactly the names SEMGREP_PRO.has(r.name) will be asked about.
  if (repos.length) {
    let resolvable;
    try { resolvable = new Set((resolveRepos(doc).repos || []).map((r) => r.name)); }
    catch (e) { return bad(503, `the fleet could not be resolved (${e.message}) — refusing to grant seats that cannot be checked against what is actually scanned`); }
    const unknown = repos.filter((n) => !resolvable.has(n));
    if (unknown.length) {
      return bad(400, `these do not name a repository this fleet scans: ${unknown.join(', ')}. `
        + 'A seat granted to an unscanned name is a seat spent on nothing, and nothing would report it. '
        + 'Group entries expand — allocate the repositories they expand TO, not the group.', { unknown });
    }
  }

  const apply = (base) => {
    const next = { ...base };
    if (repos.length === 0) delete next.semgrepPro;             // an empty allocation is no key, not an empty array
    else next.semgrepPro = { ...(base.semgrepPro || {}), repos };
    return next;
  };

  const check = (cand) => {
    const v = validateRegistry(cand);
    if (v.errors.length) return bad(400, 'the registry would be invalid after this write — refused', { errors: v.errors });
    try {
      const sc = validateAgainstSchema(cand);
      if (sc && Array.isArray(sc.errors) && sc.errors.length) return bad(400, 'the registry would fail its schema after this write — refused', { errors: sc.errors });
    } catch (e) {
      return bad(503, `schema validation itself failed (${e.message}) — refusing to write what cannot be checked`);
    }
    return null;
  };

  const pre = check(apply(doc));
  if (pre) return pre;

  const lock = acquireLock(target + '.lock', { attempts: 25, spinMs: 20, label: 'panel semgrep-pro' });
  if (!lock || lock.ok === false) return bad(409, `the registry is locked by ${lock && lock.holder ? JSON.stringify(lock.holder) : 'another writer'} — retry shortly`);
  try {
    let fresh;
    try { fresh = JSON.parse(readFileSync(target, 'utf8')); }
    catch (e) { return bad(503, `the registry changed and could not be re-read (${e.code || e.message})`); }
    const cand = apply(fresh);
    const post = check(cand);
    if (post) return { ...post, code: 409, error: `a concurrent edit changed the allocation — ${post.error}` };
    writeAtomic(target, JSON.stringify(cand, null, 2) + '\n');
  } finally {
    if (typeof lock.release === 'function') lock.release(); else forceReleaseLock(target + '.lock');
  }
  return { ok: true, repos, count: repos.length, who };
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
// Auth mirrors the panel's own gate: loopback operator OR a signed-in session. The tree names the
// machine's folder layout, which is exactly the class of detail routes/host.mjs keeps off the
// published port — so remote-without-session gets a 401, never a redacted half-answer.
const authed = (ctx) => {
  if (ctx.isLoopbackReq) return { who: 'operator@loopback' };
  const s = ctx.adminSession && ctx.adminSession(ctx.req);
  // Sessions store `user` as the account's email (routes/auth.mjs); an object shape is tolerated.
  if (!s || !s.user) return null;
  return { who: typeof s.user === 'string' ? s.user : (s.user.email || s.user.name || 'session') };
};

export const routes = [
  {
    method: 'GET', path: '/api/projects/tree',
    handle: (ctx) => {
      const a = authed(ctx);
      if (!a) return ctx.send(401, { ok: false, error: 'authentication required' });
      const t = projectsTree({});
      return ctx.send(t.ok ? 200 : 503, t);
    },
  },
  {
    method: 'POST', path: '/api/projects/semgrep-pro',
    handle: (ctx) => {
      const a = authed(ctx);
      if (!a) return ctx.send(401, { ok: false, error: 'authentication required' });
      return ctx.readJsonBody(ctx.req, (body, err) => {
        if (err) return ctx.send(400, { ok: false, error: err });
        const r = setSemgrepPro(body, { who: a.who });
        if (!r.ok) { const { code, ...rest } = r; return ctx.send(code, rest); }
        return ctx.send(200, r);
      });
    },
  },
  {
    method: 'POST', path: '/api/projects/add',
    handle: (ctx) => {
      const a = authed(ctx);
      if (!a) return ctx.send(401, { ok: false, error: 'authentication required' });
      return ctx.readJsonBody(ctx.req, (body, err) => {
        if (err) return ctx.send(400, { ok: false, error: err });
        const r = addProject(body, { who: a.who });
        if (!r.ok) { const { code, ...rest } = r; return ctx.send(code, rest); }
        return ctx.send(200, r);
      });
    },
  },
];

export default routes;

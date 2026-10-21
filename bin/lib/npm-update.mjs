// bin/lib/npm-update.mjs — apply a dependency-update selection to one npm project as a proposal
// branch, and merge it only when the policy permits every change and the repository's own gate
// passes.
//
// Everything happens in a detached git worktree at the project's HEAD, never in the checkout an
// operator is editing. Git runs through scannedGit (the repository's hooks, fsmonitor, drivers and
// transports inert); npm runs with --ignore-scripts and the same neutralised git environment, so
// no step before the merge gate executes the repository's code.
//
// Steps, each attributed to the kind of change it makes:
//   direct      the chosen version of each direct dependency (npm install name@version)
//   lockfile    transitive packages refreshed within their declared ranges (npm update)
//   advisories  npm audit fix, without --force
// The direct and lockfile steps resolve with --before=<now − cooldown>, so a refresh cannot pull a
// release younger than its cooldown in transitively; advisory fixes are exempt. A step whose
// changes the policy does not permit is undone as a whole and named.
//
// A proposal is identified by its base commit, project path and selection: running the same
// selection on the same commit again finds the branch and changes nothing.
//
// The merge gate is a ladder, the first rung that exists decides:
//   1. the repository's commitwork.json `ci` group, through `commitwork run`
//   2. npm ci, then npm test
//   3. nothing — no gate means no merge, recorded as undetermined, never as a pass
// Rungs 1 and 2 execute the repository's code, so --merge needs --trust-repo-manifest.
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scannedGit, scannedGitEnv } from './git-env.mjs';
import { auditProject, runNpm, npmView, npmAudit, chooseUpdate, cmpVersion, updateType, UPDATE_TYPES, AUDIT_LEVELS } from './npm-versions.mjs';
import { POLICY_FILE, parseRepoPolicy, exposureOfKind, allows } from './update-policy.mjs';
import { snapshotOf } from './deps-ledger.mjs';

const CW_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY_MS = 86_400_000;
export const BRANCH_PREFIX = 'commitwork/deps-';
const SAVE_FLAG = { dependencies: '--save-prod', devDependencies: '--save-dev', optionalDependencies: '--save-optional' };
const NPM_QUIET = ['--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'];

const git = (repo, args, opts) => scannedGit(repo, args, opts);
function gitOut(repo, args) {
  const r = git(repo, args);
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`);
  return r.stdout.trim();
}

/** The repository's committed policy at `ref`: { policy } | { absent } | { error }. */
export function readRepoPolicy(top, ref = 'HEAD') {
  const r = git(top, ['show', `${ref}:${POLICY_FILE}`]);
  if (r.status === 0) return parseRepoPolicy(r.stdout, `${POLICY_FILE} at ${ref.slice(0, 12)}`);
  if (/does not exist|exists on disk, but not in|bad revision|unknown revision/i.test(r.stderr || '')) return { absent: true };
  return { error: `${POLICY_FILE} could not be read at ${ref} (${(r.stderr || r.error?.message || '').trim().split('\n')[0]})` };
}

/** Where the project sits: its repository top, path inside it, HEAD and branch. */
export function locate(dir) {
  const top = realpathSync(gitOut(dir, ['rev-parse', '--show-toplevel']));
  const pkgPath = relative(top, realpathSync(dir)) || '.';
  const base = gitOut(top, ['rev-parse', 'HEAD']);
  const b = git(top, ['symbolic-ref', '-q', '--short', 'HEAD']);
  return { top, pkgPath, base, baseBranch: b.status === 0 ? b.stdout.trim() || null : null };
}

const readJsonFile = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lockOf = (dir) => readJsonFile(join(dir, 'package-lock.json'));

/** Every lockfile entry whose version changed, appeared or went. */
export function lockDiff(before, after) {
  const a = before.packages || {};
  const b = after.packages || {};
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!k.startsWith('node_modules/')) continue;
    const from = a[k]?.version ?? null;
    const to = b[k]?.version ?? null;
    if (from === to) continue;
    const name = k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.push({ path: k, name, from, to, exposure: (b[k] || a[k]).dev ? 'dev' : 'prod', type: from && to ? updateType(from, to) : null });
  }
  return out.sort((x, y) => (x.path < y.path ? -1 : 1));
}

export function proposalId({ base, pkgPath, direct, lockfile, advisories }) {
  const sel = [...direct].map((d) => `${d.name}@${d.version}`).sort();
  return createHash('sha256').update(JSON.stringify({ base, pkgPath, sel, lockfile: !!lockfile, advisories: !!advisories })).digest('hex').slice(0, 12);
}

const prefixFlags = (spec) => (/^~/.test(spec) ? ['--save-prefix=~'] : /^=?\s*v?\d/.test(spec) ? ['--save-exact'] : ['--save-prefix=^']);
const beforeFlag = (days, nowMs) => (days > 0 ? [`--before=${new Date(nowMs - days * DAY_MS).toISOString()}`] : []);
const tail = (r) => `${r.err || ''}${r.out || ''}`.trim().split('\n').slice(-4).join(' | ');

/**
 * The selection the policy makes from an audit: per direct dependency, the highest update among
 * the types its exposure allows; lockfile and advisories when either exposure allows them.
 */
export function selectFromAudit(report, policy) {
  const direct = [];
  for (const d of report.deps) {
    if (d.skipped) continue;
    const types = policy.update[exposureOfKind(d.kind)].filter((k) => UPDATE_TYPES.includes(k));
    const pick = chooseUpdate(d, types);
    if (pick) direct.push({ name: d.name, kind: d.kind, spec: d.spec, from: d.locked, version: pick.version, type: pick.type, publishedAt: pick.publishedAt });
  }
  const either = (k) => policy.update.prod.includes(k) || policy.update.dev.includes(k);
  return { direct, lockfile: either('lockfile'), advisories: either('advisories') };
}

function runGate({ wt, wtPkg, npmEnv, run = spawnSync }) {
  const manifest = join(wt, 'commitwork.json');
  if (existsSync(manifest)) {
    let groups = [];
    try { groups = (readJsonFile(manifest).checks || []).flatMap((c) => c.groups || []); } catch (e) { return { rung: 'commitwork-ci', result: 'undetermined', detail: `commitwork.json is not readable (${e.message})` }; }
    if (groups.includes('ci')) {
      const r = run(process.execPath, [join(CW_ROOT, 'bin', 'commitwork.mjs'), 'run', 'ci', '--repo', wt, '--manifest', manifest, '--trust-repo-manifest'], { cwd: wt, encoding: 'utf8', timeout: 3_600_000 });
      return { rung: 'commitwork-ci', result: r.status === 0 ? 'pass' : 'fail', detail: r.status === 0 ? 'commitwork run ci passed' : `commitwork run ci exited ${r.status ?? r.signal}: ${tail({ out: r.stdout, err: r.stderr })}` };
    }
  }
  let pkg;
  try { pkg = readJsonFile(join(wtPkg, 'package.json')); } catch (e) { return { rung: 'none', result: 'undetermined', detail: `package.json is not readable (${e.message})` }; }
  const test = pkg.scripts?.test;
  if (typeof test === 'string' && test.trim() && !/no test specified/.test(test)) {
    const npm = process.env.CW_NPM || 'npm';
    const ci = run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: wtPkg, env: npmEnv, encoding: 'utf8', timeout: 1_800_000 });
    if (ci.status !== 0) return { rung: 'npm-test', result: 'fail', detail: `npm ci exited ${ci.status ?? ci.signal}: ${tail({ out: ci.stdout, err: ci.stderr })}` };
    const t = run(npm, ['test'], { cwd: wtPkg, env: npmEnv, encoding: 'utf8', timeout: 3_600_000 });
    return { rung: 'npm-test', result: t.status === 0 ? 'pass' : 'fail', detail: t.status === 0 ? 'npm test passed' : `npm test exited ${t.status ?? t.signal}: ${tail({ out: t.stdout, err: t.stderr })}` };
  }
  return { rung: 'none', result: 'undetermined', detail: 'no commitwork.json ci group and no npm test script: nothing to merge on' };
}

const shipped = (adv) => (adv && !adv.error ? (adv.prod.critical || 0) + (adv.prod.high || 0) : null);

/** Where `branch` is checked out, if anywhere. */
function checkedOutAt(top, branch) {
  const lines = gitOut(top, ['worktree', 'list', '--porcelain']).split('\n');
  let path = null;
  for (const l of lines) {
    if (l.startsWith('worktree ')) path = l.slice(9);
    else if (l === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

/**
 * Propose (and with `merge`, merge) one project's updates.
 * Returns { state, ... }: planned | nothing | exists | proposed | merged | refused | error.
 */
export async function proposeUpdates({
  dir, policy, selection = null, merge = false, trustRepo = false, dryRun = false, nowMs = Date.now(),
  record = () => {}, view = npmView, audit = npmAudit, npm = runNpm, gate = runGate,
}) {
  let loc;
  try { loc = locate(dir); } catch (e) { return { state: 'error', reason: `${dir} is not inside a git repository with a commit (${e.message})` }; }
  const { top, pkgPath, base, baseBranch } = loc;
  const at = () => new Date(nowMs).toISOString();
  const refuse = (reason, extra = {}) => { record({ at: at(), event: 'refused', repo: top, pkgPath, base, reason }); return { state: 'refused', reason, ...loc, ...extra }; };

  const npmrc = git(top, ['cat-file', '-e', `${base}:${pkgPath === '.' ? '' : `${pkgPath}/`}.npmrc`]);
  if (npmrc.status === 0 && !trustRepo) return refuse('the project ships a .npmrc, which npm install would obey (registry, git binary, scripts); pass --trust-repo-manifest to update it');

  const wt = mkdtempSync(join(tmpdir(), 'cw-deps-'));
  const added = git(top, ['worktree', 'add', '--detach', wt, base]);
  if (added.status !== 0) { rmSync(wt, { recursive: true, force: true }); return { state: 'error', reason: `git worktree add failed: ${(added.stderr || '').trim()}`, ...loc }; }
  const cleanup = () => { git(top, ['worktree', 'remove', '--force', wt]); rmSync(wt, { recursive: true, force: true }); };
  try {
    const wtPkg = join(wt, pkgPath);
    const before = await auditProject(wtPkg, { cooldown: policy.cooldown, nowMs, trustRepo, view, audit });
    if (before.error) return refuse(before.error);
    if (!dryRun) record({ at: at(), event: 'audit', repo: top, pkgPath, commit: base, ...snapshotOf(before) });
    const sel = selection ? resolveSelection(selection, before) : selectFromAudit(before, policy);
    if (sel.error) return { state: 'error', reason: sel.error, ...loc };
    for (const d of sel.direct) {
      const exp = exposureOfKind(d.kind);
      if (!allows(policy, 'update', exp, d.type)) return refuse(`${d.name} ${d.from} → ${d.version} is a ${d.type} update to a ${exp} dependency, which the policy does not permit`);
    }
    const id = proposalId({ base, pkgPath, direct: sel.direct, lockfile: sel.lockfile, advisories: sel.advisories });
    const branch = `${BRANCH_PREFIX}${id}`;
    const plan = { proposal: id, branch, direct: sel.direct, lockfile: sel.lockfile, advisories: sel.advisories, auditBefore: before };
    if (!sel.direct.length && !sel.lockfile && !sel.advisories) return { state: 'nothing', reason: 'the policy selects nothing to update', ...loc, ...plan };
    if (git(top, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]).status === 0) return { state: 'exists', reason: `this selection on ${base.slice(0, 12)} is already proposed`, ...loc, ...plan };
    if (dryRun) return { state: 'planned', ...loc, ...plan };

    const envR = scannedGitEnv(wt);
    if (envR.error) return { state: 'error', reason: envR.error, ...loc };
    const npmEnv = { ...envR.env, npm_config_update_notifier: 'false' };
    const baseLock = lockOf(wtPkg);
    const steps = [];
    const notes = [];
    const runStep = async (name, args, permitted) => {
      const pkgText = readFileSync(join(wtPkg, 'package.json'), 'utf8');
      const lockText = readFileSync(join(wtPkg, 'package-lock.json'), 'utf8');
      const r = await npm(args, { cwd: wtPkg, env: npmEnv, timeoutMs: 900_000 });
      // npm audit fix exits 1 while any advisory remains, so its exit code alone is not a failure.
      if (r.spawnError || (r.code !== 0 && name !== 'advisories')) return { error: `npm ${args[0]} (${name}) failed: ${r.spawnError || tail(r)}` };
      const changes = lockDiff(JSON.parse(lockText), lockOf(wtPkg));
      if (r.code !== 0 && !changes.length) notes.push(`${name} step changed nothing (npm exited ${r.code}: ${tail(r)})`);
      const bad = changes.filter((c) => !permitted(c));
      if (bad.length) {
        writeFileSync(join(wtPkg, 'package.json'), pkgText);
        writeFileSync(join(wtPkg, 'package-lock.json'), lockText);
        notes.push(`${name} step undone: ${bad.length} change(s) the policy does not permit, e.g. ${bad.slice(0, 3).map((c) => `${c.name} ${c.from ?? '∅'} → ${c.to ?? '∅'} (${c.exposure})`).join(', ')}`);
        return { undone: true, changes: [] };
      }
      steps.push({ step: name, changes });
      return { changes };
    };

    // A direct dependency moves only to the version chosen for it; one nobody chose stays put.
    const directNames = new Map(before.deps.map((d) => [d.name, d]));
    const keepDirect = (c) => {
      const d = directNames.get(c.name);
      if (!d || c.path !== `node_modules/${c.name}`) return null;
      const intended = sel.direct.find((x) => x.name === c.name)?.version ?? d.locked;
      return c.to === intended;
    };
    if (sel.direct.length) {
      const groups = new Map();
      for (const d of sel.direct) {
        const flags = [SAVE_FLAG[d.kind], ...prefixFlags(d.spec)];
        const k = flags.join(' ');
        if (!groups.has(k)) groups.set(k, { flags, items: [] });
        groups.get(k).items.push(d);
      }
      const minCd = Math.min(...sel.direct.map((d) => policy.cooldown[d.type]));
      for (const g of groups.values()) {
        // Transitive packages the chosen versions require come with them; --before holds their age.
        const r = await runStep('direct', ['install', ...NPM_QUIET, ...beforeFlag(minCd, nowMs), ...g.flags, ...g.items.map((d) => `${d.name}@${d.version}`)],
          (c) => keepDirect(c) ?? true);
        if (r.error) return { state: 'error', reason: r.error, ...loc, ...plan };
      }
      const lockNow = lockOf(wtPkg);
      const missed = sel.direct.filter((d) => lockNow.packages?.[`node_modules/${d.name}`]?.version !== d.version);
      if (missed.length) return { state: 'error', reason: `npm did not lock ${missed.map((d) => `${d.name}@${d.version}`).join(', ')}`, ...loc, ...plan };
    }
    if (sel.lockfile) {
      // `npm update` with no names also moves direct dependencies within their ranges, past the
      // version the policy chose (or kept). Naming every transitive package leaves the direct ones
      // where the direct step put them.
      const lockNow = lockOf(wtPkg);
      const transitive = [...new Set(Object.keys(lockNow.packages || {}).filter((k) => k.startsWith('node_modules/') && !lockNow.packages[k].link)
        .map((k) => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length)))].filter((n) => !directNames.has(n)).sort();
      if (transitive.length) {
        const cd = Math.max(policy.cooldown.patch, policy.cooldown.minor);
        const r = await runStep('lockfile', ['update', ...NPM_QUIET, ...beforeFlag(cd, nowMs), ...transitive],
          (c) => keepDirect(c) ?? allows(policy, 'update', c.exposure, 'lockfile'));
        if (r.error) return { state: 'error', reason: r.error, ...loc, ...plan };
      }
    }
    if (sel.advisories) {
      const r = await runStep('advisories', ['audit', 'fix', '--package-lock-only', '--ignore-scripts', '--no-fund'],
        (c) => allows(policy, 'update', c.exposure, 'advisories'));
      if (r.error) return { state: 'error', reason: r.error, ...loc, ...plan };
    }

    const changes = lockDiff(baseLock, lockOf(wtPkg));
    if (!changes.length) return { state: 'nothing', reason: notes.length ? notes.join('; ') : 'npm changed nothing', ...loc, ...plan, notes };
    // A package is attributed to the LAST step that moved it: a chosen version an advisory fix then
    // raised (handlebars 4.7.9 → 4.7.10, the fix inside the cooldown) belongs to the fix.
    const stepOf = (c) => [...steps].reverse().find((s) => s.changes.some((x) => x.path === c.path))?.step ?? 'direct';
    for (const c of changes) c.step = stepOf(c);
    const pkgAfter = readJsonFile(join(wtPkg, 'package.json'));
    if (policy.zeroRuntimeDependencies && Object.keys(pkgAfter.dependencies || {}).length) return refuse('the repository declares zeroRuntimeDependencies and this update would add one');

    const after = await auditProject(wtPkg, { cooldown: policy.cooldown, nowMs, trustRepo, view, audit });
    const msg = commitMessage({ id, pkgPath, sel, changes, after, notes });
    const rel = (f) => (pkgPath === '.' ? f : `${pkgPath}/${f}`);
    for (const args of [['checkout', '-q', '-b', branch], ['add', '--', rel('package.json'), rel('package-lock.json')], ['commit', '-q', '-m', msg]]) {
      const r = git(wt, args);
      if (r.status !== 0) return { state: 'error', reason: `git ${args[0]} failed: ${(r.stderr || '').trim()}`, ...loc, ...plan };
    }
    const head = gitOut(wt, ['rev-parse', 'HEAD']);
    const summary = (a) => (a.advisories.error ? { error: a.advisories.error } : { counts: a.advisories.counts, prod: a.advisories.prod });
    record({ at: at(), event: 'proposed', repo: top, pkgPath, base, baseBranch, head, proposal: id, branch,
      changes: changes.map(({ name, path, from, to, type, exposure, step }) => ({ name, path, from, to, type, exposure, step,
        publishedAt: sel.direct.find((d) => d.name === name && path === `node_modules/${name}`)?.publishedAt ?? null })),
      advisoriesBefore: summary(before), advisoriesAfter: summary(after), notes });
    const superseded = supersede({ top, pkgPath, keep: branch, baseBranch });
    for (const s of superseded) record({ at: at(), event: 'superseded', repo: top, pkgPath, proposal: s.proposal, branch: s.branch, by: id });
    const result = { state: 'proposed', ...loc, ...plan, head, changes, auditAfter: after, notes, superseded };
    if (!merge) return result;

    const why = mergeRefusal({ policy, changes, sel, trustRepo, baseBranch, before, after });
    if (why) { record({ at: at(), event: 'refused', repo: top, pkgPath, base, proposal: id, reason: `merge: ${why}` }); return { ...result, mergeRefused: why }; }
    const g = gate({ wt, wtPkg, npmEnv });
    if (g.result !== 'pass') {
      record({ at: at(), event: 'refused', repo: top, pkgPath, base, proposal: id, reason: `merge gate ${g.rung}: ${g.result}`, gate: g });
      return { ...result, gate: g, mergeRefused: `the merge gate (${g.rung}) did not pass: ${g.detail}` };
    }
    const tip = git(top, ['rev-parse', `refs/heads/${baseBranch}`]).stdout.trim();
    if (tip !== base) return { ...result, gate: g, mergeRefused: `${baseBranch} moved from ${base.slice(0, 12)} to ${tip.slice(0, 12)} while this ran` };
    const where = checkedOutAt(top, baseBranch);
    if (where) {
      const dirty = git(where, ['status', '--porcelain', '--untracked-files=no']);
      if (dirty.status !== 0 || dirty.stdout.trim()) return { ...result, gate: g, mergeRefused: `${baseBranch} is checked out at ${where} with uncommitted changes` };
      const m = git(where, ['merge', '--ff-only', '-q', branch]);
      if (m.status !== 0) return { ...result, gate: g, mergeRefused: `git merge --ff-only failed: ${(m.stderr || '').trim()}` };
    } else {
      const u = git(top, ['update-ref', `refs/heads/${baseBranch}`, head, base]);
      if (u.status !== 0) return { ...result, gate: g, mergeRefused: `update-ref refused: ${(u.stderr || '').trim()}` };
    }
    record({ at: at(), event: 'merged', repo: top, pkgPath, proposal: id, branch, into: baseBranch, base, head, gate: g });
    const landed = git(top, ['rev-parse', `refs/heads/${baseBranch}`]).stdout.trim() === head;
    // The second witness reads the merged branch, not this worktree: every recorded change must be
    // what the lockfile on the branch now says.
    let pinned = false;
    try {
      const merged = JSON.parse(git(top, ['show', `refs/heads/${baseBranch}:${rel('package-lock.json')}`]).stdout).packages || {};
      pinned = changes.every((c) => (merged[c.path]?.version ?? null) === c.to);
    } catch { pinned = false; }
    record({ at: at(), event: 'verified', repo: top, pkgPath, proposal: id, head, ok: landed && pinned, landed, pinned, advisories: summary(after) });
    // The proposal branch is still checked out in the scratch worktree, and git will not delete it there.
    if (landed) { git(wt, ['checkout', '-q', '--detach']); git(top, ['branch', '-q', '-D', branch]); }
    return { ...result, state: 'merged', gate: g, verified: { landed, pinned } };
  } finally {
    cleanup();
  }
}

/** An explicit selection (from the picker or flags) checked against what the audit offers. */
export function resolveSelection(selection, report) {
  const direct = [];
  for (const s of selection.direct || []) {
    const d = report.deps.find((x) => x.name === s.name);
    if (!d || d.skipped) return { error: `${s.name} is not a measured direct dependency` };
    const u = d.updates.find((x) => x.version === s.version) || (d.held.find((x) => x.version === s.version) && { type: updateType(d.locked, s.version), version: s.version, publishedAt: null, held: true });
    if (!u) return { error: `${s.name}@${s.version} is not an update the audit found` };
    if (u.held) return { error: `${s.name}@${s.version} is inside its cooldown` };
    direct.push({ name: d.name, kind: d.kind, spec: d.spec, from: d.locked, version: u.version, type: u.type, publishedAt: u.publishedAt });
  }
  return { direct, lockfile: !!selection.lockfile, advisories: !!selection.advisories };
}

function mergeRefusal({ policy, changes, sel, trustRepo, baseBranch, before, after }) {
  if (!baseBranch) return 'HEAD is detached: there is no branch to merge into';
  // A chosen direct update is judged by its type; packages that moved only because it required them
  // ride with it, and the lockfile and advisories steps are judged as those kinds.
  const kindOf = (c) => (c.step === 'direct' ? sel.direct.find((d) => c.path === `node_modules/${d.name}`)?.type ?? null : c.step);
  const not = changes.filter((c) => kindOf(c) !== null && !allows(policy, 'automerge', c.exposure, kindOf(c)));
  if (not.length) return `automerge does not permit ${not.slice(0, 3).map((c) => `${c.name} ${c.from ?? '∅'} → ${c.to ?? '∅'} (${kindOf(c)}, ${c.exposure})`).join(', ')}${not.length > 3 ? ` and ${not.length - 3} more` : ''}`;
  if (!trustRepo) return 'the merge gate runs the repository\'s own code; pass --trust-repo-manifest';
  const b = shipped(before.advisories);
  const a = shipped(after.advisories);
  if (a === null) return 'the advisories after the update could not be measured';
  if (b !== null && a > b) return `shipped critical/high advisories rose from ${b} to ${a}`;
  return null;
}

function supersede({ top, pkgPath, keep, baseBranch }) {
  const r = git(top, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${BRANCH_PREFIX}*`]);
  if (r.status !== 0) return [];
  const out = [];
  for (const b of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    if (b === keep) continue;
    if (baseBranch && git(top, ['merge-base', '--is-ancestor', b, baseBranch]).status === 0) continue;
    const p = git(top, ['log', '-1', '--format=%(trailers:key=Commitwork-Deps-Path,valueonly)', b]).stdout.trim();
    if (p === pkgPath) out.push({ branch: b, proposal: b.slice(BRANCH_PREFIX.length) });
  }
  return out;
}

export function commitMessage({ id, pkgPath, sel, changes, after, notes = [] }) {
  const direct = changes.filter((c) => c.step === 'direct' && sel.direct.some((d) => c.path === `node_modules/${d.name}`));
  const byStep = (s) => changes.filter((c) => c.step === s);
  const lines = [`chore(deps): update ${changes.length} npm package${changes.length === 1 ? '' : 's'}${pkgPath === '.' ? '' : ` in ${pkgPath}`}`, ''];
  for (const c of direct) lines.push(`- ${c.name} ${c.from} → ${c.to} (${sel.direct.find((d) => d.name === c.name).type}, ${c.exposure})`);
  const rest = byStep('direct').length - direct.length;
  if (rest > 0) lines.push(`- ${rest} transitive package${rest === 1 ? '' : 's'} moved with them`);
  if (byStep('lockfile').length) lines.push(`- ${byStep('lockfile').length} transitive package${byStep('lockfile').length === 1 ? '' : 's'} refreshed within declared ranges (lockfile)`);
  if (byStep('advisories').length) lines.push(`- ${byStep('advisories').length} package${byStep('advisories').length === 1 ? '' : 's'} changed by npm audit fix (advisories): ${byStep('advisories').slice(0, 5).map((c) => `${c.name} ${c.from ?? '∅'} → ${c.to ?? '∅'}`).join(', ')}`);
  for (const n of notes) lines.push(`- ${n}`);
  if (!after.advisories.error) {
    const c = after.advisories.counts;
    const p = after.advisories.prod;
    lines.push('', `Advisories after: ${AUDIT_LEVELS.slice().reverse().filter((l) => l !== 'info').map((l) => `${l} ${c[l]}`).join(' · ')} (shipped: critical ${p.critical} · high ${p.high})`);
  }
  lines.push('', `Commitwork-Deps-Proposal: ${id}`, `Commitwork-Deps-Path: ${pkgPath}`);
  return lines.join('\n');
}

export const _internals = { runGate, mergeRefusal, supersede, cmpVersion };

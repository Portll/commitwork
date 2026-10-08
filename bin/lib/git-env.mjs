// The environment for a child git that must act on the repository its -C names. Git reads these
// variables before -C, so a child inherits whichever repository its caller's environment names:
// inside a hook in a linked worktree git exports an absolute GIT_DIR, and every `git -C elsewhere`
// then writes to the hooked repository. The off-host anchor witness was pushed into commitwork
// itself that way, 29 times between 2026-09-18 and 2026-09-26.
import { spawnSync } from 'node:child_process';

// git's own list (`git rev-parse --local-env-vars`, git 2.50), kept so a git that cannot answer
// still has these stripped: an unanswered query must not mean "strip nothing".
const FALLBACK = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];

let cached = null;

/** Every repository-local variable: git's own list, unioned with the fallback. */
export function localEnvVars() {
  if (cached) return cached;
  const r = spawnSync('git', ['rev-parse', '--local-env-vars'], {
    encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '' },
  });
  const listed = r.status === 0 ? r.stdout.split(/\s+/).filter(Boolean) : [];
  cached = [...new Set([...FALLBACK, ...listed])];
  return cached;
}

/** A copy of env without the repository-local variables, for spawning git against another repo. */
export function gitChildEnv(env = process.env) {
  const drop = new Set(localEnvVars());
  return Object.fromEntries(Object.entries(env).filter(([k]) => !drop.has(k) && !/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)));
}

// fact: git run against a scanned tree never executes that tree's config / a repo-local core.fsmonitor runs on every index refresh, so build-health's `git status` ran a scanned repo's command on the host (review 2026-10-07 D6) (expiry: never, prev: broken)
// safe.directory is left to git: it is what refuses a tree another user owns, and `*` would switch that off.
// The rest outrank the repo's own settings: ext:: runs its URL as a command (never is git's default),
// submodule.recurse carries a checkout into submodules whose own config is not neutralised here, and
// an auto-gc or auto-maintenance after a merge would run a repo-set gc.recentObjectsHook.
export const SCANNED_GIT_CONFIG = Object.freeze([
  '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never',
  '-c', 'submodule.recurse=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
]);

// fact: a repo's own config names the commands its filter, diff and merge drivers run, and git has no switch that turns drivers off / each driver the repo configures is overridden by name, which git applies from .gitattributes, info/attributes or core.attributesFile alike (expiry: never, prev: broken)
// Only repo-controlled scopes are neutralised: the operator's global config (git-lfs, a trusted textconv) is not the scanned repo's.
// textconv becomes `cat`, which is --no-textconv's output; an external diff becomes '' so a `diff` that would
// use one fails rather than runs (scannedGit passes --no-ext-diff to its own diffs).
// variable the repo set → every override that variable calls for on that driver
const DRIVER_NEUTRAL = {
  filter: Object.fromEntries(['clean', 'smudge', 'process'].map((v) => [v, { clean: '', smudge: '', process: '', required: 'false' }])),
  diff: { textconv: { textconv: 'cat', cachetextconv: 'false' }, command: { command: '' } },
  merge: { driver: { driver: 'false' } },
};
const KEY_NEUTRAL = {
  'diff.external': ['diff.external', ''],
  'core.sshcommand': ['core.sshCommand', 'ssh'],
  'core.askpass': ['core.askPass', ''],
  'core.editor': ['core.editor', 'false'],
  'sequence.editor': ['sequence.editor', 'false'],
  'gpg.program': ['gpg.program', 'gpg'],
  'gpg.openpgp.program': ['gpg.openpgp.program', 'gpg'],
  'gpg.x509.program': ['gpg.x509.program', 'gpgsm'],
  'gpg.ssh.program': ['gpg.ssh.program', 'ssh-keygen'],
  'gpg.ssh.defaultkeycommand': ['gpg.ssh.defaultKeyCommand', ''],
  'log.showsignature': ['log.showSignature', 'false'],
  'merge.verifysignatures': ['merge.verifySignatures', 'false'],
  'core.alternaterefscommand': ['core.alternateRefsCommand', ''],
};
const TRUSTED_SCOPES = new Set(['global', 'system', 'command']);

/** The overrides that leave a repository's own executable config inert: { pairs, env } from its config, or { error }. */
export function scannedConfigOverrides(repo, env = process.env) {
  const r = spawnSync('git', [...SCANNED_GIT_CONFIG, '-C', repo, 'config', '--show-scope', '--null', '--list'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24, timeout: 60_000, env: { ...gitChildEnv(env), GIT_CONFIG_NOSYSTEM: '1' },
  });
  // An unreadable config is not an empty one: every later git would read it too, so refuse rather than guess.
  if (r.error || (r.status !== 0 && !(r.status === 1 && !r.stdout && !String(r.stderr).trim()))) {
    return { error: `could not read the repository config: ${String(r.error?.message || r.stderr || `exit ${r.status}`).trim().split('\n')[0]}`, cause: r.error };
  }
  const pairs = new Map();
  const extraEnv = {};
  const set = (k, v) => pairs.set(k, v);
  const fields = String(r.stdout).split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i];
    if (TRUSTED_SCOPES.has(scope)) continue;
    const nl = fields[i + 1].indexOf('\n');
    const key = nl < 0 ? fields[i + 1] : fields[i + 1].slice(0, nl);
    const first = key.indexOf('.');
    const last = key.lastIndexOf('.');
    const section = key.slice(0, first).toLowerCase();
    const variable = key.slice(last + 1).toLowerCase();
    const sub = last > first ? key.slice(first + 1, last) : null;
    const driver = sub !== null && Object.hasOwn(DRIVER_NEUTRAL, section) && Object.hasOwn(DRIVER_NEUTRAL[section], variable) && DRIVER_NEUTRAL[section][variable];
    if (driver) for (const [v, val] of Object.entries(driver)) set(`${section}.${sub}.${v}`, val);
    const plain = sub === null ? `${section}.${variable}` : `${section}.${sub.toLowerCase()}.${variable}`;
    if (Object.hasOwn(KEY_NEUTRAL, plain)) set(...KEY_NEUTRAL[plain]);
    if (section === 'credential' && variable === 'helper') set('credential.helper', ''); // '' empties the helper list
    if (section === 'remote' && sub !== null && (variable === 'uploadpack' || variable === 'receivepack')) {
      set('protocol.file.allow', 'never'); // a later -c cannot replace the first uploadpack, so refuse the local transport
    }
    if (section === 'core' && variable === 'gitproxy') extraEnv.GIT_PROXY_COMMAND = ''; // the env var wins, and '' means no proxy
  }
  return { pairs: [...pairs], env: extraEnv };
}

/** env for git, or for a tool that spawns git, against a scanned repo: the static and per-repo overrides ride GIT_CONFIG_COUNT. */
export function scannedGitEnv(repo, env = process.env) {
  const o = scannedConfigOverrides(repo, env);
  if (o.error) return o;
  const all = [];
  for (let i = 0; i < SCANNED_GIT_CONFIG.length; i += 2) {
    const kv = SCANNED_GIT_CONFIG[i + 1];
    const eq = kv.indexOf('=');
    all.push([kv.slice(0, eq), kv.slice(eq + 1)]);
  }
  all.push(...o.pairs);
  const out = { ...gitChildEnv(env), GIT_CONFIG_NOSYSTEM: '1', ...o.env, GIT_CONFIG_COUNT: String(all.length) };
  all.forEach(([k, v], i) => { out[`GIT_CONFIG_KEY_${i}`] = k; out[`GIT_CONFIG_VALUE_${i}`] = v; });
  return { env: out };
}

// status and the diff family recurse into a submodule by running git INSIDE it, where its own drivers
// are not neutralised; an argument outranks every submodule.<name>.ignore, config does not.
const SUBMODULE_RECURSING = new Set(['status', 'diff', 'diff-index', 'diff-files']);

function guardedArgs(args) {
  let i = 0;
  while (i < args.length && String(args[i]).startsWith('-')) i += ['-c', '-C'].includes(args[i]) ? 2 : 1;
  const sub = args[i];
  if (!SUBMODULE_RECURSING.has(sub)) return args;
  const rest = args.slice(i + 1);
  const extra = [];
  if (!rest.some((a) => String(a).startsWith('--ignore-submodules'))) extra.push('--ignore-submodules=dirty');
  if (sub === 'diff' && !rest.includes('--ext-diff')) extra.push('--no-ext-diff');
  return [...args.slice(0, i + 1), ...extra, ...rest];
}

/** scannedGit's argv, for a caller that must spawn asynchronously; pair it with scannedGitEnv(repo).env. */
export const scannedGitArgv = (repo, args) => ['--no-pager', ...SCANNED_GIT_CONFIG, '-C', repo, ...guardedArgs(args)];

/** git against a repository commitwork scans rather than one it owns: hooks, fsmonitor, drivers and transports inert, no system config. */
export function scannedGit(repo, args, opts = {}) {
  const { env = process.env, ...rest } = opts;
  const prepared = scannedGitEnv(repo, env);
  if (prepared.error) {
    // git that cannot be spawned keeps its spawn error, so a caller's "git is not installed" branch still sees it
    const stderr = `scannedGit refused to run: ${prepared.error}\n`;
    return { status: prepared.cause ? null : 128, signal: null, stdout: '', stderr, output: [null, '', stderr], error: prepared.cause, pid: 0 };
  }
  return spawnSync('git', scannedGitArgv(repo, args), {
    encoding: 'utf8', stdio: [rest.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...rest, env: prepared.env,
  });
}

/** scannedGit's stdout, throwing as execFileSync does (err.status, err.stderr) when git fails or cannot run. */
export function scannedGitOut(repo, args, opts = {}) {
  const r = scannedGit(repo, args, opts);
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const e = new Error(`git ${args.join(' ')} exited ${r.status}: ${String(r.stderr || '').trim().split('\n')[0]}`);
    Object.assign(e, { status: r.status, stdout: r.stdout, stderr: r.stderr });
    throw e;
  }
  return r.stdout;
}

#!/usr/bin/env node
// bin/create-pr.mjs — push a repository's HEAD to a commitwork/ branch and open a pull request with
// gh. The PR is a proposal: nothing here merges, and the default branch is never pushed. Spawned by
// the panel's create-pr job (admin/lib/jobs.mjs) and called by monitor/remediation-draft-pr.mjs;
// the credential arrives in GH_TOKEN, never argv. With --upstream the branch goes to the gh
// identity's fork of that repository (made when missing) and the PR is opened against upstream.
//
// usage: node bin/create-pr.mjs --repo <path> --branch commitwork/<name> --title <text> --body-file <path>
//          [--draft] [--upstream <owner/name>]
// exit: 0 opened, or an open PR already exists for the branch · 21 refused, reason printed ·
//       22 a git or gh command failed
// env, read at call time: CW_GH_BIN (the gh to run; a .mjs runs with this node), GH_TOKEN (the
//   credential gh uses; when unset gh's own login is used and the result says so), CW_GIT_HOST_URL

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { isMainModule } from '../lib/is-main.mjs';
import { scannedGit } from './lib/git-env.mjs';
import { ensureFork, repoUrl, isSlug } from './lib/create-pr-fork.mjs';

export const EXIT_REFUSED = 21;
export const EXIT_FAILED = 22;
export const BRANCH_PREFIX = 'commitwork/';
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

const plan = (bin, args) => (/\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args]);
const ghBin = (env) => env.CW_GH_BIN || 'gh';
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// gh answers git's credential prompt from GH_TOKEN when set, else from its own login; the repo's
// own helpers are cleared first so a scanned repository cannot name the program that sees the push.
const credentialHelper = (env) => `!${plan(ghBin(env), []).flat().map(quote).join(' ')} auth git-credential`;
export const credentialConfig = (env) => ['-c', 'credential.helper=', '-c', `credential.helper=${credentialHelper(env)}`];
const LIMITS = { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 };

function settle(r, file) {
  if (r.error) return { ok: false, stdout: '', stderr: `${file} could not be run (${r.error.code || r.error.message})`, status: null };
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

const run = (file, argv, { cwd, env }) => settle(spawnSync(file, argv, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...LIMITS }), file);
/** Run the configured gh. -> { ok, stdout, stderr, status } */
export const runGh = (args, { cwd, env = process.env } = {}) => { const [file, argv] = plan(ghBin(env), args); return run(file, argv, { cwd, env }); };

export function validBranch(branch) {
  const b = String(branch || '');
  if (!b.startsWith(BRANCH_PREFIX)) return `branch must start with ${BRANCH_PREFIX}`;
  if (!BRANCH_RE.test(b) || b.includes('..') || b.endsWith('/') || b.endsWith('.lock')) return 'branch name is not a plain ref name';
  return null;
}

/**
 * @returns {{state:'opened'|'existing'|'refused'|'failed', code:number, reason?:string, url?:string, branch, base?, identity?, draft?, fork?}}
 */
export function createPr({ repo, branch, title, bodyFile, draft = false, upstream = null, env = process.env, log = () => {} }) {
  const git = (args) => settle(scannedGit(repo, [...credentialConfig(env), ...args], { cwd: repo, env, ...LIMITS }), 'git');
  const gh = (args) => runGh(args, { cwd: repo, env });
  const refuse = (reason) => { log(`[create-pr] refused: ${reason}`); return { state: 'refused', code: EXIT_REFUSED, reason, branch }; };
  const fail = (what, r) => { const reason = `${what}: ${(r.stderr || r.stdout || '').trim().slice(0, 600) || `exit ${r.status}`}`; log(`[create-pr] failed — ${reason}`); return { state: 'failed', code: EXIT_FAILED, reason, branch }; };

  const bad = validBranch(branch);
  if (bad) return refuse(bad);
  if (!title || !String(title).trim()) return refuse('a title is required');
  if (!bodyFile || !existsSync(bodyFile)) return refuse('the body file does not exist');
  if (!repo || !existsSync(repo)) return refuse(`repository path does not exist: ${repo}`);
  if (upstream !== null && !isSlug(upstream)) return refuse('upstream must be owner/name');
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') return refuse(`${repo} is not a git working tree${inside.stderr.trim() ? ` (${inside.stderr.trim().split('\n')[0]})` : ''}`);

  const base = defaultBranch(git, gh, upstream);
  if (!base) return refuse('the default branch could not be determined (origin/HEAD is unset and gh could not read the repository)');
  if (base === branch) return refuse('the default branch is never pushed');
  log(`[create-pr] base ${base}, head ${branch}`);

  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (!dirty.ok) return fail('git status', dirty);
  if (dirty.stdout.trim()) return refuse('the working tree has uncommitted changes; a proposal is made of commits, so commit or discard them first');
  const ahead = git(['rev-list', '--count', `origin/${base}..HEAD`]);
  if (!ahead.ok) return fail(`git rev-list origin/${base}..HEAD`, ahead);
  if (Number(ahead.stdout.trim()) === 0) return refuse(`HEAD has no commit that origin/${base} lacks — nothing to propose`);

  const who = gh(['api', 'user', '--jq', '.login']);
  if (!who.ok || !who.stdout.trim()) return refuse(`gh has no identity to open the PR as${who.stderr.trim() ? ` (${who.stderr.trim().split('\n')[0]})` : ''}`);
  const login = who.stdout.trim();
  const identity = `${login} via ${env.GH_TOKEN ? 'the declared GH_TOKEN' : "gh's own login (ambient)"}`;
  log(`[create-pr] opening as ${identity}`);

  let pushTo = 'origin', head = branch, fork;
  const repoArgs = upstream ? ['--repo', upstream] : [];
  if (upstream) {
    if (login.toLowerCase() === upstream.split('/')[0].toLowerCase()) return refuse(`${upstream} belongs to ${login}; push to it directly rather than through a fork`);
    const f = ensureFork(gh, upstream, login);
    if (f.refuse) return refuse(f.refuse);
    if (f.fail) return fail(...f.fail);
    fork = f.slug; pushTo = repoUrl(env, fork); head = `${login}:${branch}`;
    log(`[create-pr] fork ${fork}${f.created ? ' (created)' : ''}`);
  }

  const push = git(['push', pushTo, `HEAD:refs/heads/${branch}`]);
  if (!push.ok) return fail('git push', push);
  log(`[create-pr] pushed HEAD to ${fork || 'origin'}/${branch}`);

  const listed = gh(['pr', 'list', ...repoArgs, '--head', branch, '--state', 'open', '--json', 'number,url,headRepositoryOwner']);
  if (!listed.ok) return fail('gh pr list', listed);
  let open = [];
  try { open = JSON.parse(listed.stdout || '[]'); } catch { return fail('gh pr list returned no JSON', listed); }
  // a same-named branch on someone else's fork is not ours
  const mine = (Array.isArray(open) ? open : []).filter((p) => p?.url && (!upstream || !p.headRepositoryOwner || p.headRepositoryOwner.login === login));
  if (mine.length) {
    log(`[create-pr] existing: ${mine[0].url}`);
    return { state: 'existing', code: 0, url: mine[0].url, branch, base, identity, draft, fork };
  }
  const created = gh(['pr', 'create', ...repoArgs, '--head', head, '--base', base, '--title', String(title), '--body-file', bodyFile, ...(draft ? ['--draft'] : [])]);
  if (!created.ok) return fail('gh pr create', created);
  const url = (created.stdout.trim().split('\n').find((l) => /^https?:\/\//.test(l.trim())) || created.stdout.trim()).trim();
  log(`[create-pr] opened${draft ? ' as a draft' : ''}: ${url}`);
  return { state: 'opened', code: 0, url, branch, base, identity, draft, fork };
}

function defaultBranch(git, gh, upstream) {
  const sym = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (sym.ok && sym.stdout.trim()) return sym.stdout.trim().replace(/^origin\//, '');
  const viewed = gh(['repo', 'view', ...(upstream ? [upstream] : []), '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);
  return viewed.ok && viewed.stdout.trim() ? viewed.stdout.trim() : null;
}

function main() {
  const { values } = parseArgs({ options: { repo: { type: 'string' }, branch: { type: 'string' }, title: { type: 'string' }, 'body-file': { type: 'string' }, draft: { type: 'boolean' }, upstream: { type: 'string' } } });
  const r = createPr({ repo: values.repo, branch: values.branch, title: values.title, bodyFile: values['body-file'], draft: !!values.draft, upstream: values.upstream ?? null, log: (l) => console.log(l) });
  console.log(`[create-pr] result ${JSON.stringify(r)}`);
  process.exitCode = r.code;
}

if (isMainModule(import.meta.url)) main();

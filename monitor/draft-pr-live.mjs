// monitor/draft-pr-live.mjs — the git and gh acts behind remediation-draft-pr: identity, permission,
// labels, the duplicate search, a scratch clone of the default branch, its contribution files, and
// the commit. Each answers null or { ok:false } when it cannot read, never an empty pass.
// env is passed in and read at call time; gh is CW_GH_BIN, the git host is CW_GIT_HOST_URL.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { runGh, credentialConfig } from '../bin/create-pr.mjs';
import { repoUrl } from '../bin/lib/create-pr-fork.mjs';
import { scannedGit, gitChildEnv, SCANNED_GIT_CONFIG } from '../bin/lib/git-env.mjs';
import { rethrowIfBug, rethrowIfBugParsing } from '../bin/rethrow.mjs';

const FILE_CAP = 256 * 1024;
const LIMITS = { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 };
const first = (s) => String(s || '').trim().split('\n')[0];
const json = (s) => { try { return JSON.parse(s); } catch (e) { rethrowIfBugParsing(e); return undefined; } };

export function ghSeams(env) {
  const gh = (args) => runGh(args, { env });
  const list = (kind, slug, term) => {
    const r = gh([kind, 'list', '--repo', slug, '--state', 'open', '--search', `"${term}"`, '--json', 'number,url,title,body', '--limit', '50']);
    const rows = r.ok ? json(r.stdout || '[]') : undefined;
    return Array.isArray(rows) ? rows : null;
  };
  return {
    whoami() { const r = gh(['api', 'user', '--jq', '.login']); return r.ok && r.stdout.trim() ? r.stdout.trim() : null; },
    /** viewerPermission (ADMIN, MAINTAIN, WRITE, TRIAGE, READ) or null when unreadable */
    permission(slug) { const r = gh(['repo', 'view', slug, '--json', 'viewerPermission', '--jq', '.viewerPermission']); return r.ok && r.stdout.trim() ? r.stdout.trim() : null; },
    labels(slug) {
      const r = gh(['label', 'list', '--repo', slug, '--limit', '500', '--json', 'name']);
      const rows = r.ok ? json(r.stdout || '[]') : undefined;
      return Array.isArray(rows) ? rows.map((l) => String(l?.name ?? '')) : null;
    },
    /** open PRs and issues matching any term; null when any search could not be read */
    search(slug, { prTerms, issueTerms }) {
      const prs = [], issues = [];
      for (const t of prTerms) { const rows = list('pr', slug, t); if (!rows) return null; prs.push(...rows); }
      for (const t of issueTerms) { const rows = list('issue', slug, t); if (!rows) return null; issues.push(...rows); }
      return { prs, issues };
    },
    prView(url) {
      const r = gh(['pr', 'view', url, '--json', 'state,mergedAt,closedAt,mergedBy']);
      const v = r.ok ? json(r.stdout) : undefined;
      return v && typeof v.state === 'string' ? { state: v.state, mergedAt: v.mergedAt || null, closedAt: v.closedAt || null, mergedBy: v.mergedBy?.login || null } : null;
    },
  };
}

export function gitSeams(env) {
  const git = (dir, args) => scannedGit(dir, args, { env, ...LIMITS });
  return {
    /** shallow clone of the remote's default branch -> { ok, base, sha } */
    clone(slug, dir) {
      const r = spawnSync('git', [...SCANNED_GIT_CONFIG, ...credentialConfig(env), 'clone', '--quiet', '--depth', '1', '--no-tags', '--single-branch', '--', repoUrl(env, slug), dir],
        { env: gitChildEnv(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...LIMITS });
      if (r.status !== 0) return { ok: false, error: first(r.stderr) || r.error?.code || `git clone exited ${r.status}` };
      const base = git(dir, ['symbolic-ref', '--short', 'HEAD']);
      const sha = git(dir, ['rev-parse', 'HEAD']);
      if (base.status !== 0 || sha.status !== 0 || !base.stdout.trim()) return { ok: false, error: first(base.stderr || sha.stderr) || 'the default branch has no name' };
      const head = git(dir, ['remote', 'set-head', 'origin', base.stdout.trim()]);
      if (head.status !== 0) return { ok: false, error: first(head.stderr) };
      return { ok: true, base: base.stdout.trim(), sha: sha.stdout.trim() };
    },
    /** paths -> text (null when absent) plus .github/workflows; null when anything could not be read */
    readFiles(dir, paths) {
      const root = realpathSync(dir);
      const read = (p) => {
        const full = join(root, p);
        try {
          if (lstatSync(full).isDirectory()) return null;
          const real = realpathSync(full);
          if (!real.startsWith(root + sep)) throw Object.assign(new Error(`${p} points outside the clone`), { code: 'EOUTSIDE' });
          return readFileSync(real, 'utf8').slice(0, FILE_CAP);
        } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      };
      try {
        const files = Object.fromEntries(paths.map((p) => [p, read(p)]));
        let names = [];
        try { names = readdirSync(join(root, '.github', 'workflows')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const workflows = names.filter((n) => /\.ya?ml$/i.test(n)).sort()
          .map((n) => ({ path: `.github/workflows/${n}`, text: read(`.github/workflows/${n}`) || '' }));
        return { files, workflows };
      } catch (e) { rethrowIfBug(e); return null; }
    },
    /** commit go.mod/go.sum changes on a new branch -> { ok, reason? } */
    commit(dir, { branch, message, signoff }) {
      const st = git(dir, ['status', '--porcelain', '--untracked-files=all']);
      if (st.status !== 0) return { ok: false, reason: `git status: ${first(st.stderr)}` };
      const changed = st.stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
      if (!changed.length) return { ok: false, reason: 'the fix changed nothing' };
      const stray = changed.filter((p) => !/(^|\/)go\.(mod|sum)$/.test(p));
      if (stray.length) return { ok: false, reason: `the fix changed more than go.mod and go.sum: ${stray.slice(0, 5).join(', ')}` };
      for (const args of [['checkout', '-q', '-b', branch], ['add', '--', ...changed], ['commit', '-q', ...(signoff ? ['-s'] : []), '-m', message]]) {
        const r = git(dir, args);
        if (r.status !== 0) return { ok: false, reason: `git ${args[0]}: ${first(r.stderr) || `exit ${r.status}`}` };
      }
      return { ok: true };
    },
  };
}

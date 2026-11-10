// bin/lib/create-pr-fork.mjs — the fork side of bin/create-pr.mjs: find or make the gh identity's
// fork of an upstream repository, and name the URL its branch is pushed to.
// env, read at call time: CW_GIT_HOST_URL (the git host repositories are cloned from and forks are pushed to; default https://github.com)

export { isSlug } from '../../monitor/remediation-pr.mjs';

const hostBase = (env) => String(env.CW_GIT_HOST_URL || 'https://github.com').replace(/\/+$/, '');
/** The git URL of owner/name on the configured host. */
export const repoUrl = (env, slug) => `${hostBase(env)}/${slug}.git`;

const NOT_FOUND = /HTTP 404|Not Found/i;
const first = (r) => (r.stderr || r.stdout || '').trim().split('\n')[0];

/**
 * The fork is `<login>/<upstream name>`. One that exists but is not a fork of `upstream` is a
 * refusal; gh never picks another name on our behalf.
 * @returns {{slug:string, created:boolean} | {refuse:string} | {fail:[string, object]}}
 */
export function ensureFork(gh, upstream, login) {
  const slug = `${login}/${upstream.split('/')[1]}`;
  const parentOf = () => gh(['api', `repos/${slug}`, '--jq', '.parent.full_name // ""']);
  let seen = parentOf();
  let created = false;
  if (!seen.ok) {
    if (!NOT_FOUND.test(seen.stderr || '')) return { fail: [`gh api repos/${slug}`, seen] };
    const made = gh(['repo', 'fork', upstream, '--clone=false', '--remote=false']);
    if (!made.ok) return { fail: ['gh repo fork', made] };
    created = true;
    seen = parentOf();
    if (!seen.ok) return { refuse: `the fork ${slug} could not be read after forking (${first(seen)})` };
  }
  const parent = seen.stdout.trim();
  if (parent.toLowerCase() !== upstream.toLowerCase()) {
    return { refuse: `${slug} exists and is not a fork of ${upstream}${parent ? ` (its parent is ${parent})` : ''}` };
  }
  return { slug, created };
}

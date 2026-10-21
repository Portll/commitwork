// admin/routes/pull-request.mjs — POST /api/issue/pr {project, key}: push the group's repository
// HEAD to a deterministic commitwork/ branch and open a pull request through the create-pr job.
// Operator port only. The PR is a proposal and merging stays human (declaration split from
// authority). The body names places and fixes, never evidence: a secrets-lane group is refused
// outright, every other lane's rows reach it as file, rule or package, and the text goes through
// the credential redactor before it is written.
//
// env, read at call time: CW_PR_BODY_DIR (where PR bodies are written, default monitor/private/pull-requests)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CW, resolvedRepos } from '../lib/core.mjs';
import { privateDir } from '../../monitor/store-paths.mjs';
import { feedGroupMembers } from '../../monitor/feed-groups.mjs';
import { readRollup, resolveProject } from './feed.mjs';
import { LOCAL_ONLY } from './issue-detail.mjs';
import { gateFeature } from '../../lib/feature-flags.mjs';
import { resolveInto } from '../../lib/secrets.mjs';
import { redact } from '../../lib/mail.mjs';
import { actionLine } from '../../bin/lib/brief.mjs';
import { BRANCH_PREFIX } from '../../bin/create-pr.mjs';

export const JOB_KIND = 'create-pr';
export const TOKEN_NAME = 'GH_TOKEN';
// A secret's fix is rotation; its evidence is the secret. No PR body is composed for these lanes.
export const SECRETS_LANES = Object.freeze(['secrets', 'secrets-betterleaks', 'secrets-cobol-jcl', 'secrets-gitleaks']);
const bodyDir = () => process.env.CW_PR_BODY_DIR || join(privateDir(CW), 'pull-requests');

/** commitwork/<slug of the group key>-<8 hex of its sha1>: the same group always names the same branch. */
export function branchFor(key) {
  const slug = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'group';
  return `${BRANCH_PREFIX}${slug}-${createHash('sha1').update(String(key)).digest('hex').slice(0, 8)}`;
}

const where = (r) => r.file || r.path || r.resource || r.component || r.name || '';

/** Markdown for the PR: places and fixes only. `line`, `message` and any match text stay out. */
export function composeBody({ project, lane, subject, repo, members }) {
  const lines = [`commitwork proposes this change for **${repo}** (project \`${project}\`).`, '',
    `Finding group: \`${lane}\` · \`${subject}\` · ${members.length} row(s) in the latest rollup.`, '', '## Rows', ''];
  for (const m of members) {
    const r = m.row || {};
    if (r.package) {
      const l = actionLine({ package: r.package, version: r.version || '', fix: r.fixed || r.fix || '', kev: r.kev === true ? 1 : 0, worst: m.sev || 'unknown', epss: typeof r.epss === 'number' ? r.epss : null, findings: [{ id: r.id || r.rule || '', kev: r.kev === true }] });
      lines.push(`- ${l.what}${where(r) ? ` in \`${where(r)}\`` : ''} [${l.tags}]${l.ids ? ` — ${l.ids}` : ''}`);
    } else {
      lines.push(`- \`${r.rule || r.id || subject}\`${where(r) ? ` in \`${where(r)}\`` : ''} (${m.sev || 'unknown'}${r.kev === true ? ', KEV' : ''})`);
    }
  }
  lines.push('', '---', 'Opened from the commitwork panel. Merging is a human decision; finding evidence is not included here.');
  return lines.join('\n') + '\n';
}

export const routes = [
  { method: 'POST', path: '/api/issue/pr', handle: (ctx) => {
    const { send, readJsonBody, isLoopbackReq, trigger } = ctx;
    const off = gateFeature('pull-request');
    if (off) return send(off.status, off.body);
    if (!isLoopbackReq) return send(403, LOCAL_ONLY);
    return new Promise((resolve) => readJsonBody(ctx.req, (body, err) => {
      const done = (code, payload) => resolve(send(code, payload));
      if (err || !body || typeof body !== 'object') return done(400, { ok: false, error: 'a JSON body {project, key} is required' });
      const project = resolveProject(ctx, body.project);
      if (!project) return done(400, { ok: false, error: 'project must name a registered project' });
      const key = typeof body.key === 'string' ? body.key : '';
      if (!key) return done(400, { ok: false, error: 'key is required' });
      let read;
      try { read = readRollup(project); } catch (e) { return done(500, { ok: false, error: e.message }); }
      if (read.absent) return done(409, { ok: false, error: `${project} was never swept — nothing to propose a fix for` });
      const sf = read.rollup.scannerFindings;
      if (!sf || typeof sf !== 'object') return done(500, { ok: false, error: `rollup at ${read.path} carries no scannerFindings` });
      const members = feedGroupMembers(sf, key);
      if (!members.length) return done(404, { ok: false, error: 'no group with that key in the latest rollup' });
      const lane = members[0].lane;
      if (SECRETS_LANES.includes(lane)) return done(403, { ok: false, refused: true, error: `a ${lane} finding is fixed by rotating the credential; its evidence does not leave the box in a pull request body` });
      const repoName = String((members[0].row || {}).repo || '');
      const rr = resolvedRepos().find((x) => x.name === repoName);
      if (!rr || !rr.path || !existsSync(rr.path)) return done(409, { ok: false, error: `repository ${repoName || '(unnamed)'} is not resolvable from the registry on this box; only a registered path is pushed` });
      const subject = String(key).split('\u0000').slice(2).join(' ') || key;
      const branch = branchFor(key);
      const title = `commitwork: ${lane} · ${subject} in ${repoName}`.slice(0, 120);
      let resolved;
      try { resolved = resolveInto([TOKEN_NAME], { env: process.env }); } catch (e) { return done(500, { ok: false, error: `credential refs unreadable: ${e.message}` }); }
      const tokens = resolved.env[TOKEN_NAME] ? [resolved.env[TOKEN_NAME]] : [];
      const text = redact(composeBody({ project, lane, subject, repo: repoName, members }), ...tokens);
      const dir = bodyDir();
      const bodyFile = join(dir, `${branch.slice(BRANCH_PREFIX.length)}.md`);
      try { mkdirSync(dir, { recursive: true }); writeFileSync(bodyFile, text); } catch (e) { return done(500, { ok: false, error: `could not write the PR body: ${e.message}` }); }
      const t = trigger(JOB_KIND, project, { repoPath: rr.path, branch, title, bodyFile, tokens, repo: rr.name, label: `create PR · ${rr.name} · ${subject}` });
      if (!t.started) return done(409, { ok: false, error: t.reason || 'the create-pr job did not start' });
      return done(202, { ok: true, started: true, kind: JOB_KIND, project, repo: rr.name, branch, title,
        identity: tokens.length ? `the declared ${TOKEN_NAME}` : "gh's own login (ambient)",
        note: 'a proposal on a commitwork/ branch; the default branch is never pushed and merging stays human. The create-pr job stream reports the URL.' });
    }));
  } },
];

export default routes;

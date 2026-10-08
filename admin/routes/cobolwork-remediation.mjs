// admin/routes/cobolwork-remediation.mjs — the panel's side of cobolwork remediation: start a draft
// for one finding, watch it, stop it, apply what the gate passed, and verify it held. The pipeline is
// lib/cobolwork-remediation.mjs; docs/COBOLWORK-REMEDIATION.md says what each state means.

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CW, reportsFor, resolvedRepos } from '../lib/core.mjs';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { FINGERPRINT_RE } from '../../lib/cobolwork-bridge.mjs';
import { jobIdFor } from '../../lib/cobolwork-remediation.mjs';
import { resolveLocalModel, lmStudioDrafter, claudeReviewer } from '../../lib/cobolwork-remediation-engines.mjs';
import { draftingAllowed, newJob, readJob, listJobs, runJob, applyJob, verifyJob, clearJob, writeJob } from '../../lib/cobolwork-remediation-jobs.mjs';

const jobsDir = (project) => join(reportsFor(project), 'cobolwork-remediation');
const ACTIVE = new Set();
const CONTROLS = new Map();
const MAX_ATTEMPTS = 5;

const authed = (ctx) => ctx.isLoopbackReq || !!ctx.adminSession(ctx.req);
const resolveProject = (ctx, raw) => {
  const known = ctx.knownProjects();
  return raw && (known.has(raw) || known.has(projectSlug(raw))) ? raw : null;
};
// A repository is named as the registry declares it, never given as a path.
const repoNamed = (name) => {
  const r = resolvedRepos().find((x) => x.name === name);
  return r && r.path && existsSync(r.path) ? r : null;
};
const idOf = (raw) => (/^[a-f0-9]{16}$/.test(String(raw || '')) ? String(raw) : null);

function jobFor(ctx, body) {
  const proj = resolveProject(ctx, body && body.project);
  const id = idOf(body && body.id);
  if (!id) return { code: 400, body: { ok: false, error: 'id must be a 16-hex job id' } };
  const r = readJob(jobsDir(proj), id);
  if (r.unreadable) return { code: 500, body: { ok: false, error: r.unreadable } };
  if (r.missing) return { code: 404, body: { ok: false, error: 'no such job' } };
  const repo = repoNamed(r.job.repo);
  if (!repo) return { code: 409, body: { ok: false, error: `repository ${r.job.repo} is not resolvable on this machine` } };
  return { proj, dir: jobsDir(proj), job: r.job, repo };
}

export const routes = [
  { method: 'GET', path: '/api/cobolwork/remediation', handle: (ctx) => {
    const proj = resolveProject(ctx, ctx.query.get('project'));
    return ctx.send(200, listJobs(jobsDir(proj), ACTIVE));
  } },

  { method: 'GET', path: '/api/cobolwork/remediation/job', handle: (ctx) => {
    const proj = resolveProject(ctx, ctx.query.get('project'));
    const id = idOf(ctx.query.get('id'));
    if (!id) return ctx.send(400, { ok: false, error: 'id must be a 16-hex job id' });
    const r = readJob(jobsDir(proj), id);
    if (r.unreadable) return ctx.send(500, { ok: false, error: r.unreadable });
    if (r.missing) return ctx.send(404, { ok: false, error: 'no such job' });
    const running = ACTIVE.has(id);
    return ctx.send(200, { ok: true, job: { ...r.job, state: r.job.state === 'running' && !running ? 'orphaned' : r.job.state } });
  } },

  // POST /api/cobolwork/remediate {project, repo, fingerprint, attempts?, remote?}
  { method: 'POST', path: '/api/cobolwork/remediate', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, async (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route runs a model and the scanner - sign in, or use the operator port' });
      let allowed;
      try { allowed = draftingAllowed(); } catch (e) { return ctx.send(503, { ok: false, error: e.message }); }
      if (!allowed.ok) return ctx.send(409, { ok: false, error: allowed.error });
      const proj = resolveProject(ctx, body && body.project);
      const repo = repoNamed(String((body && body.repo) || ''));
      if (!repo) return ctx.send(404, { ok: false, error: 'no repository by that name is declared in the registry and present on this machine' });
      const fingerprint = String((body && body.fingerprint) || '');
      if (!FINGERPRINT_RE.test(fingerprint)) return ctx.send(400, { ok: false, error: 'fingerprint must be the 32-hex cobolwork fingerprint' });
      const attempts = Math.min(MAX_ATTEMPTS, Math.max(1, Number((body && body.attempts) || 3) | 0));
      const id = jobIdFor(repo.name, fingerprint);
      if (ACTIVE.has(id)) return ctx.send(409, { ok: false, error: 'a remediation of this finding is already running', id });
      const held = readJob(jobsDir(proj), id);
      if (held.job && held.job.state === 'applied') return ctx.send(409, { ok: false, error: `this finding's draft was applied as ${held.job.applied.commit}; verify it, or clear the job first`, id });
      const local = await resolveLocalModel();
      if (!local.ok) return ctx.send(409, { ok: false, error: local.error });
      const remote = body && body.remote === true;
      const job = newJob({ repo: repo.name, fingerprint, maxAttempts: attempts, remote, project: proj,
        engines: { drafter: { engine: 'lmstudio', model: local.model, pinned: !!local.pinned }, reviewer: remote ? { engine: 'claude-p' } : null } });
      const dir = jobsDir(proj);
      writeJob(dir, job);
      const ctrl = new AbortController();
      ACTIVE.add(id); CONTROLS.set(id, ctrl);
      runJob(dir, job, { repoPath: repo.path, drafter: lmStudioDrafter({ model: local.model }), reviewer: remote ? claudeReviewer() : null, signal: ctrl.signal })
        .catch((e) => { job.state = 'failed'; job.error = e.message; writeJob(dir, job); })
        .finally(() => { ACTIVE.delete(id); CONTROLS.delete(id); });
      return ctx.send(200, { ok: true, id, state: 'running', engines: job.engines, sourceLeavesMachine: remote });
    }) },

  { method: 'POST', path: '/api/cobolwork/remediate/stop', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route stops processes - sign in, or use the operator port' });
      const id = idOf(body && body.id);
      if (!id) return ctx.send(400, { ok: false, error: 'id must be a 16-hex job id' });
      const ctrl = CONTROLS.get(id);
      if (!ctrl) return ctx.send(409, { ok: false, error: 'nothing is running for this job' });
      ctrl.abort();
      return ctx.send(200, { ok: true, stopping: true, id });
    }) },

  // POST /api/cobolwork/remediate/apply {project, id, acknowledgeUndecided?}
  { method: 'POST', path: '/api/cobolwork/remediate/apply', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, async (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route commits code - sign in, or use the operator port' });
      const j = jobFor(ctx, body);
      if (j.code) return ctx.send(j.code, j.body);
      if (ACTIVE.has(j.job.id)) return ctx.send(409, { ok: false, error: 'the job is still running' });
      const r = await applyJob(j.dir, j.job, { repoPath: j.repo.path, acknowledgeUndecided: body.acknowledgeUndecided === true });
      return ctx.send(r.ok ? 200 : r.conflict ? 409 : 422, r);
    }) },

  // POST /api/cobolwork/remediate/verify {project, id}
  { method: 'POST', path: '/api/cobolwork/remediate/verify', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, async (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route runs the scanner - sign in, or use the operator port' });
      const j = jobFor(ctx, body);
      if (j.code) return ctx.send(j.code, j.body);
      const r = await verifyJob(j.dir, j.job, { repoPath: j.repo.path, artifact: relative(CW, join(j.dir, `${j.job.id}.json`)).split('\\').join('/') });
      return ctx.send(r.ok ? 200 : r.conflict ? 409 : 422, r);
    }) },

  // POST /api/cobolwork/remediation/clear {project, id} - a running job is refused, never killed from here
  { method: 'POST', path: '/api/cobolwork/remediation/clear', handle: (ctx) =>
    ctx.readJsonBody(ctx.req, async (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'this route deletes records - sign in, or use the operator port' });
      const proj = resolveProject(ctx, body && body.project);
      const id = idOf(body && body.id);
      if (!id) return ctx.send(400, { ok: false, error: 'id must be a 16-hex job id' });
      if (ACTIVE.has(id)) return ctx.send(409, { ok: false, error: 'the job is running; stop it first' });
      const r = readJob(jobsDir(proj), id);
      if (r.missing) return ctx.send(404, { ok: false, error: 'no such job' });
      if (r.unreadable) return ctx.send(500, { ok: false, error: r.unreadable });
      const repo = repoNamed(r.job.repo);
      const c = await clearJob(jobsDir(proj), r.job, { repoPath: repo ? repo.path : null });
      return ctx.send(c.ok ? 200 : 500, c);
    }) },
];

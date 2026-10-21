// admin/routes/daily.mjs — GET /api/daily: the /daily remediation report for the selected project's
// area (bin/daily-run.mjs writes them to reports/<out>/daily/<batch>.json), filtered to that project,
// with the veld todo each suggestion was filed as. Suggestions carry file paths and change text drawn
// from source, so like the review prompt behind Issues they are served on this machine only.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { areaOf } from '../../monitor/registry.mjs';
import { validateReport } from '../../monitor/daily-validate.mjs';
import { reportsFor, registry } from '../lib/core.mjs';
import { knownProjects } from '../lib/jobs.mjs';

const BATCH = /^sweep-\d{14}$/;
const readIfPresent = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

/**
 * The area whose report a request for `project` reads, and the repository it narrows to. Reports are
 * written per area (bin/daily-run.mjs), so a repository reads its area's report, and an area reads
 * its own unnarrowed (`repo: null`).
 */
export function dailyScope(project, reg) {
  const slug = projectSlug(project);
  const area = (reg.areas || []).find((a) => a.slug === slug || a.label === project);
  if (area) return { area: area.slug, repo: null };
  return { area: areaOf(project, reg) || slug, repo: project };
}

/** The response for `project` at `batch` (newest when null), read from `dailyDir`, narrowed to `repo`. */
export function dailyView(dailyDir, project, batch = null, repo = project) {
  const inScope = (x) => repo === null || x.repo === repo;
  let files;
  try { files = readdirSync(dailyDir); } catch (e) {
    if (e.code === 'ENOENT') return { state: 'no-reports', project, batches: [] };
    throw e;
  }
  const batches = files.map((f) => f.match(/^(sweep-\d{14})\.json$/)?.[1]).filter(Boolean).sort().reverse();
  if (!batches.length) return { state: 'no-reports', project, batches: [] };
  const chosen = batch ?? batches[0];
  if (!batches.includes(chosen)) return { state: 'no-report-for-batch', project, batch: chosen, batches: batches.slice(0, 30) };
  const report = JSON.parse(readFileSync(join(dailyDir, `${chosen}.json`), 'utf8'));
  const errors = validateReport(report);
  if (errors.length) return { state: 'unreadable', project, batch: chosen, batches: batches.slice(0, 30), error: errors.slice(0, 3).join('; ') };
  const ledger = readIfPresent(join(dailyDir, 'ledger.json'));
  const todos = readIfPresent(join(dailyDir, `${chosen}.todos.json`));
  const todoOf = (ids) => [...new Set(ids.map((id) => ledger?.findings?.[id]?.todoId).filter(Boolean))];
  const suggestions = report.suggestions.filter(inScope).map((s) => ({ ...s, todos: todoOf(s.findingIds) }));
  return {
    state: 'ok', project, area: report.area, batch: chosen, previousBatch: report.previousBatch, batches: batches.slice(0, 30),
    generatedAt: report.generatedAt, headline: report.headline, summary: report.summary,
    coverage: report.coverage.filter(inScope),
    notActioned: report.notActioned.length, suggestions,
    run: { model: report.run.model, costUsd: report.run.costUsd, attempts: report.run.attempts },
    todos: todos ? { created: todos.created?.length ?? 0, completed: todos.completed?.length ?? 0, errors: todos.errors ?? [], skipped: !!todos.skipped } : null,
  };
}

export const routes = [
  { method: 'GET', path: '/api/daily', handle: ({ req, send, isLoopbackReq }) => {
    if (isLoopbackReq !== true) return send(403, { localOnly: true, error: 'the daily report carries paths and change text from source, so it is served only on the operator port (http://127.0.0.1:7879 by default, or http://commitwork.local)' });
    try {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      const project = q.get('project');
      const known = knownProjects();
      if (!project || !(known.has(project) || known.has(projectSlug(project)))) return send(400, { error: 'unknown project' });
      const batch = q.get('batch');
      if (batch !== null && !BATCH.test(batch)) return send(400, { error: 'batch must look like sweep-YYYYMMDDHHMMSS' });
      const scope = dailyScope(project, registry());
      return send(200, dailyView(join(reportsFor(scope.area), 'daily'), project, batch, scope.repo));
    } catch (e) { return send(500, { error: e.message }); }
  } },
];

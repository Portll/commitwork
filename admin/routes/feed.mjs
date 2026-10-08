// admin/routes/feed.mjs — GET /api/feed and /api/feed/group: the one findings feed, grouped on
// place over the selected project's latest rollup, joined to the issue store's rulings. Read-only.
// A rollup that is absent is "never swept" and said so; one that cannot be read or parsed is a 500,
// never an empty feed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { reportsFor } from '../lib/core.mjs';
import { knownProjects as jobsKnownProjects } from '../lib/jobs.mjs';
import { loadIssues } from '../../monitor/issue-store.mjs';
import { buildFeedGroups, feedGroupMembers, feedView, issueForDoc } from '../../monitor/feed-groups.mjs';
import { gateFeature } from '../../lib/feature-flags.mjs';

const authed = (ctx) => !!(ctx.isLoopbackReq || (ctx.adminSession(ctx.req) || {}).user);

function resolveProject(ctx) {
  const q = ctx.query.get('project');
  const known = (ctx.knownProjects || jobsKnownProjects)();
  if (!q || !(known.has(q) || known.has(projectSlug(q)))) return null;
  return projectSlug(q) || String(q);
}

/** { rollup } | { absent: true } | throws. Only ENOENT means never swept. */
export function readRollup(project) {
  const path = join(reportsFor(project), 'rollup.json');
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { absent: true, path };
    throw new Error(`rollup unreadable at ${path}: ${e.code || e.message}`);
  }
  try { return { rollup: JSON.parse(text), path }; } catch (e) { throw new Error(`rollup at ${path} is not JSON: ${e.message}`); }
}

function withRollup(ctx, fn) {
  // experimental: off answers as absent and names the flag, before the login gate, as the dispatcher does
  const off = gateFeature('feed');
  if (off) return ctx.send(off.status, off.body);
  if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
  const project = resolveProject(ctx);
  if (!project) return ctx.send(400, { ok: false, error: 'project must name a registered project' });
  let read;
  try { read = readRollup(project); } catch (e) { return ctx.send(500, { ok: false, error: e.message }); }
  if (read.absent) return ctx.send(200, { ok: true, project, state: 'never-swept', groups: [], totals: null });
  const sf = read.rollup.scannerFindings;
  if (!sf || typeof sf !== 'object') return ctx.send(500, { ok: false, error: `rollup at ${read.path} carries no scannerFindings` });
  let issues;
  try { issues = loadIssues(); } catch (e) { return ctx.send(500, { ok: false, error: `issue store unreadable: ${e.message}` }); }
  return fn({ project, rollup: read.rollup, sf, issues });
}

export const routes = [
  { method: 'GET', path: '/api/feed', handle: (ctx) => withRollup(ctx, ({ project, rollup, sf, issues }) => {
    const mode = ctx.query.get('mode') || 'focus';
    if (mode !== 'focus' && mode !== 'all') return ctx.send(400, { ok: false, error: 'mode must be focus or all' });
    const lane = ctx.query.get('lane');
    const limit = Math.min(2000, Math.max(1, Number(ctx.query.get('limit')) || 200));
    const offset = Math.max(0, Number(ctx.query.get('offset')) || 0);
    let built;
    try { built = buildFeedGroups(sf, { issueFor: issueForDoc(issues), lanes: lane ? [lane] : null }); } catch (e) {
      return ctx.send(500, { ok: false, error: `feed could not be grouped: ${e.message}` });
    }
    const view = feedView(built, { mode });
    return ctx.send(200, {
      ok: true, project, state: 'swept', generated: rollup.generated ?? null, sliceId: rollup.sliceId ?? null,
      mode, totals: view.totals, hidden: view.hidden, undeclaredLanes: view.undeclaredLanes,
      groupCount: view.groups.length, offset, groups: view.groups.slice(offset, offset + limit),
    });
  }) },
  { method: 'GET', path: '/api/feed/group', handle: (ctx) => withRollup(ctx, ({ project, sf, issues }) => {
    const key = ctx.query.get('key');
    if (!key) return ctx.send(400, { ok: false, error: 'key is required' });
    const issueFor = issueForDoc(issues);
    const members = feedGroupMembers(sf, key).map((m) => {
      const issue = issueFor(m.lane, m.row, m.subRowKey);
      // updatedAt travels so a bulk lodging can pin the row it read (expectUpdatedAt)
      return { ...m, issue: issue ? { id: issues.byKey[m.subRowKey], state: issue.state, closedAs: issue.closedAs ?? null, updatedAt: issue.updatedAt ?? null } : null };
    });
    if (!members.length) return ctx.send(404, { ok: false, error: 'no group with that key in the latest rollup' });
    return ctx.send(200, { ok: true, project, key, members });
  }) },
];

export default routes;

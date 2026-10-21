// admin/routes/inbox.mjs — GET /api/inbox and POST /api/inbox/mark: what changed in one area since
// its last sweep (monitor/inbox.mjs derives), and the signed-in operator's read/snooze state. An
// absent rollup is "never swept"; an unreadable one, an unreadable issue store or an unreadable
// state file is a stated error, never an empty inbox.

import { reportsFor } from '../lib/core.mjs';
import { readRollup, resolveProject } from './feed.mjs';
import { readInflight } from '../../monitor/liveness.mjs';
import { loadIssues, nowISO } from '../../monitor/issue-store.mjs';
import { deriveInbox, withState, readInboxState, markInbox, INBOX_KINDS } from '../../monitor/inbox.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';
import { gateFeature } from '../../lib/feature-flags.mjs';

const whoOf = (ctx) => {
  const s = (ctx.adminSession(ctx.req) || {});
  if (s.user) return sessionWho(s);
  return ctx.isLoopbackReq ? 'operator@loopback' : '';
};

export const routes = [
  { method: 'GET', path: '/api/inbox', handle: (ctx) => {
    const off = gateFeature('inbox');
    if (off) return ctx.send(off.status, off.body);
    const who = whoOf(ctx);
    if (!who) return ctx.send(401, { ok: false, error: 'authentication required' });
    const project = resolveProject(ctx);
    if (!project) return ctx.send(400, { ok: false, error: 'project must name a registered project' });
    let read;
    try { read = readRollup(project); } catch (e) { return ctx.send(500, { ok: false, error: e.message }); }
    if (read.absent) return ctx.send(200, { ok: true, project, state: 'never-swept', kinds: INBOX_KINDS, items: [], notMeasured: [] });
    let lastIngest = null, ingestError = null;
    try { lastIngest = loadIssues().lastIngest[project] || null; } catch (e) { ingestError = e.message; }
    const derived = deriveInbox({ project, rollup: read.rollup, inflight: readInflight(reportsFor(project)), lastIngest, ingestError });
    let state;
    try { state = readInboxState(); } catch (e) { return ctx.send(500, { ok: false, error: e.message }); }
    const now = nowISO();
    const items = withState(derived.items, state, who, now);
    const live = items.filter((i) => !i.snoozedUntil);
    return ctx.send(200, { ok: true, project, state: 'swept', generated: read.rollup.generated || null, sliceId: derived.sliceId,
      prevSliceId: derived.prevSliceId, who, kinds: INBOX_KINDS, items, notMeasured: derived.notMeasured,
      counts: { priority: live.filter((i) => i.priority).length, other: live.filter((i) => !i.priority).length,
        unread: live.filter((i) => !i.read).length, snoozed: items.length - live.length } });
  } },

  { method: 'POST', path: '/api/inbox/mark', handle: (ctx) => {
    const off = gateFeature('inbox');
    if (off) return ctx.send(off.status, off.body);
    const who = whoOf(ctx);
    if (!who) return ctx.send(401, { ok: false, error: 'authentication required' });
    return new Promise((resolve) => ctx.readJsonBody(ctx.req, (body, err) => {
      if (err || !body || typeof body !== 'object') return resolve(ctx.send(400, { ok: false, error: 'a JSON body {ids, action, days?} is required' }));
      const r = markInbox({ ids: body.ids, action: body.action, days: body.days, who, nowIso: nowISO() });
      return resolve(r.ok ? ctx.send(200, { ok: true, applied: r.applied, action: body.action }) : ctx.send(r.code, { ok: false, error: r.error }));
    }));
  } },
];

export default routes;

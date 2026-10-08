// admin/routes/palette.mjs — GET /api/palette: the command palette's index, and optionally a ranked
// search over it. Read-only. Operator-only actions are flagged, never omitted, so the client can
// say why a control is disabled off the operator port.

import { join } from 'node:path';
import { ADMIN, MANIFEST_DIR } from '../lib/core.mjs';
import { knownProjects as jobsKnownProjects } from '../lib/jobs.mjs';
import { readMenuViews, readChecks, buildPaletteIndex, searchPalette } from '../lib/palette-index.mjs';
import { gateFeature } from '../../lib/feature-flags.mjs';

const authed = (ctx) => !!(ctx.isLoopbackReq || (ctx.adminSession(ctx.req) || {}).user);

export function routesWith({ menusDir = join(ADMIN, 'menus'), mapPath = join(MANIFEST_DIR, 'security-baseline.map.json') } = {}) {
  return [
    { method: 'GET', path: '/api/palette', handle: (ctx) => {
      const off = gateFeature('palette');
      if (off) return ctx.send(off.status, off.body);
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
      const q = ctx.query || new URL(ctx.req.url || '/', 'http://127.0.0.1').searchParams;
      let entries;
      try {
        const projects = [...(ctx.knownProjects || jobsKnownProjects)()];
        entries = buildPaletteIndex({ views: readMenuViews(menusDir), checks: readChecks(mapPath), projects });
      } catch (e) {
        // A missing or unreadable registry is a broken install, not an empty palette.
        return ctx.send(500, { ok: false, error: `the palette index could not be built: ${e.message}` });
      }
      const query = String(q.get('q') || '');
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
      const counts = {};
      for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
      return ctx.send(200, {
        ok: true, operator: !!ctx.isLoopbackReq, counts,
        entries: query ? undefined : entries,
        results: query ? searchPalette(entries, query, { limit }) : undefined,
      });
    } },
  ];
}

export const routes = routesWith();
export default routes;

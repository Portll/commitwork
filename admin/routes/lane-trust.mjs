// admin/routes/lane-trust.mjs — the lane trust and lane capability artifacts, as their producers
// (monitor/lane-trust.mjs and monitor/lane-capability.mjs) last wrote them.
//
//   GET /api/lane-trust   { trust, capability }
//
// Each artifact answers in one of three ways and they never merge:
//   { state: 'ok', generated, data }   the parsed artifact, with the stamp its producer recorded
//   { state: 'absent' }                the file does not exist (ENOENT only)
//   { state: 'unreadable', reason }    any other read error, or content that is not a JSON object
// An unreadable artifact is never reported absent and never as empty data. Read-only; gated like
// the other generated-artifact routes.

import { join } from 'node:path';
import { requireSession } from '../lib/route-auth.mjs';
import { readJSONState } from '../lib/served-projection.mjs';
import { loadRegistry } from '../../monitor/registry.mjs';
import { reportsRootDir } from '../../monitor/area.mjs';

const reportsRoot = () => reportsRootDir(loadRegistry({ quiet: true }));

// The paths the producers write: monitor/lane-trust.mjs honours CW_LANE_TRUST_OUT, and
// monitor/lane-capability.mjs has no override and always writes under the reports root.
function artifactPaths() {
  let root = null;
  let reason = null;
  try { root = reportsRoot(); } catch (e) { reason = (e && e.code) || 'reports-root'; }
  const trust = process.env.CW_LANE_TRUST_OUT || (root && join(root, 'lane-trust.json'));
  return { trust, capability: root && join(root, 'lane-capability.json'), reason };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One artifact in the three states the wire carries. */
export function artifactState(path) {
  const r = readJSONState(path);
  if (r.state === 'absent') return { state: 'absent' };
  if (r.state === 'unreadable') return { state: 'unreadable', reason: r.detail };
  if (!isObject(r.data)) return { state: 'unreadable', reason: 'not-a-json-object' };
  const { generated } = r.data;
  return { state: 'ok', generated: typeof generated === 'string' ? generated : null, data: r.data };
}

export const routes = [{
  method: 'GET',
  path: '/api/lane-trust',
  handle(ctx) {
    if (!requireSession(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
    const p = artifactPaths();
    const unresolved = { state: 'unreadable', reason: p.reason };
    return ctx.send(200, {
      trust: p.trust ? artifactState(p.trust) : unresolved,
      capability: p.capability ? artifactState(p.capability) : unresolved,
    });
  },
}];

export default routes;

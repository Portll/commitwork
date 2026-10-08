// admin/routes/journey.mjs — GET/POST /api/journey: the guided setup. Every step's state is read
// from the record it is about at request time (monitor/journey.mjs derives; this file gathers), and
// an input that cannot be read is reported as unreadable, never as step 0 and never as done. The
// store keeps only acknowledgements and the dismissed flag.

import { existsSync, readFileSync, accessSync, constants as FS } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { userCount } from '../auth.mjs';
import { registryPath, isExampleRegistry, loadRegistry } from '../../monitor/registry.mjs';
import { CW, reportsFor, resolvedRepos } from '../lib/core.mjs';
import { jobStatus } from '../lib/jobs.mjs';
import { readJob } from './rollups.mjs';
import { which } from './scanners.mjs';
import { status as secretStatus } from '../../lib/secrets.mjs';
import { privateDir } from '../../monitor/store-paths.mjs';
import { getSetting, setSettings, readSettingsStore } from '../../monitor/settings.mjs';
import { featureEnabled, gateFeature } from '../../lib/feature-flags.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';
import { deriveJourney, JOURNEY_STEP_IDS, validSetupJourney } from '../../monitor/journey.mjs';

const authed = (ctx) => !!(ctx.isLoopbackReq || (ctx.adminSession(ctx.req) || {}).user);
const whoOf = (ctx) => (ctx.isLoopbackReq && !(ctx.adminSession(ctx.req) || {}).user ? 'operator@loopback' : sessionWho(ctx.adminSession(ctx.req)));

const baselinePath = () => process.env.CW_BASELINE_MANIFEST || join(CW, 'manifests', 'security-baseline.json');
const catalogPath = () => process.env.CW_INSTALL_CATALOG || join(CW, 'manifests', 'install-catalog.json');
const dailyPath = () => process.env.CW_DAILY_CONFIG || join(privateDir(CW), 'daily.json');
// Where a package manager puts a binary before the shell profile adds the directory to PATH.
const installDirs = () => (process.env.CW_JOURNEY_INSTALL_DIRS
  ? process.env.CW_JOURNEY_INSTALL_DIRS.split(':').filter(Boolean)
  : [join(homedir(), '.local', 'bin'), join(homedir(), '.cargo', 'bin'), join(homedir(), 'go', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']);

const readJson = (path) => {
  try { return { doc: JSON.parse(readFileSync(path, 'utf8')) }; } catch (e) { return { error: `${path}: ${e.code || e.message}` }; }
};

function installedOffPath(name) {
  for (const dir of installDirs()) {
    const p = join(dir, name);
    try { accessSync(p, FS.X_OK); return p; } catch { /* not there */ }
  }
  return null;
}

export function gatherScanners() {
  const sb = readJson(baselinePath());
  if (sb.error) return { unreadable: sb.error, tools: [] };
  const cat = readJson(catalogPath());
  const catalog = cat.error ? {} : (cat.doc.tools || {});
  const blocks = new Map();
  for (const c of sb.doc.checks || []) for (const t of (c.requires && c.requires.tools) || []) { if (!blocks.has(t)) blocks.set(t, []); blocks.get(t).push(c.id); }
  const tools = [...blocks.keys()].sort().map((name) => {
    const onPath = which(name);
    let state = 'present', at = onPath || null;
    if (!onPath) { const off = installedOffPath(name); state = off ? 'installed-not-on-path' : 'missing'; at = off; }
    const entry = catalog[name];
    return { name, state, at, blocks: blocks.get(name), requiresAccount: entry && entry.requiresAccount ? entry.requiresAccount : null };
  });
  return { tools, catalogUnreadable: cat.error || null };
}

function gatherCredentials() {
  const sb = readJson(baselinePath());
  const blocks = new Map();
  if (!sb.error) for (const c of sb.doc.checks || []) for (const s of (c.requires && c.requires.secrets) || []) { if (!blocks.has(s)) blocks.set(s, []); blocks.get(s).push(c.id); }
  let rows;
  try { rows = secretStatus({ probe: true }); } catch (e) { return { unreadable: e.code || e.message, rows: [] }; }
  return { rows: rows.map((r) => ({ name: r.name, resolvable: r.resolvable !== false, backend: r.backend, blocks: blocks.get(r.name) || [] })) };
}

export function gatherInputs(ctx) {
  let users = null;
  try { users = userCount(); } catch { users = null; }
  let registry;
  try {
    const path = registryPath();
    const reg = loadRegistry({ path, quiet: true });
    registry = { example: isExampleRegistry(path), unreadable: null, areas: (reg.areas || []).length, projects: (reg.projects || []).length, repos: resolvedRepos().length, areaRows: reg.areas || [] };
  } catch (e) { registry = { example: false, unreadable: e.code || e.message, areas: 0, projects: 0, repos: 0, areaRows: [] }; }
  const areas = registry.areaRows;
  const firstRun = {
    areas: areas.length,
    areasWithRollup: areas.filter((a) => existsSync(join(reportsFor(a.slug), 'rollup.json'))).length,
    sweepRunning: !!((jobStatus('sweep') || {}).running),
    reportDirSet: !!process.env.CW_REPORT_DIR,
  };
  const schedule = { perArea: areas.map((a) => ({ slug: a.slug, state: readJob(`com.portll.commitwork-monitor-${a.slug}`).state, paused: !!a.paused })) };
  let dailyPresent;
  try { dailyPresent = existsSync(dailyPath()); } catch { dailyPresent = null; }
  const st = readSettingsStore();
  const setting = getSetting('setupJourney', { store: st });
  let palette = true;
  try { palette = featureEnabled('palette'); } catch { palette = true; }
  const { areaRows, ...registryOut } = registry;
  return {
    users, registry: registryOut, scanners: gatherScanners(), credentials: gatherCredentials(), firstRun, schedule,
    notifications: { dailyPresent },
    store: { value: setting.value ?? null, error: st.error || null, source: setting.source },
    flags: { palette },
    operator: !!ctx.isLoopbackReq,
  };
}

function respond(ctx, extra = {}) {
  const inputs = gatherInputs(ctx);
  const j = deriveJourney(inputs);
  return ctx.send(200, { ok: true, operator: inputs.operator, storeSource: inputs.store.source, ...j, ...extra });
}

export const routes = [
  { method: 'GET', path: '/api/journey', handle: (ctx) => {
    const off = gateFeature('journey');
    if (off) return ctx.send(off.status, off.body);
    if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
    return respond(ctx);
  } },
  // Body: { acknowledge?: stepId, unacknowledge?: stepId, dismissed?: boolean }. Only optional
  // steps can be acknowledged; the others are done when their record says so.
  { method: 'POST', path: '/api/journey', handle: (ctx) => {
    const off = gateFeature('journey');
    if (off) return ctx.send(off.status, off.body);
    if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      if (!body || typeof body !== 'object') return ctx.send(400, { ok: false, error: 'body must be a JSON object' });
      const st = readSettingsStore();
      if (st.error) return ctx.send(503, { ok: false, error: `the settings store is unreadable (${st.error}); refusing to write over it`, unavailable: true });
      const cur = getSetting('setupJourney', { store: st }).value || {};
      const next = { dismissed: !!cur.dismissed, acknowledged: [...(cur.acknowledged || [])] };
      const ACK = ['personalise', 'palette', 'scanners', 'credentials', 'notifications'];
      let changed = false;
      for (const k of Object.keys(body)) if (!['acknowledge', 'unacknowledge', 'dismissed'].includes(k)) return ctx.send(400, { ok: false, error: `unknown field '${k}'` });
      if (body.acknowledge !== undefined) {
        if (!ACK.includes(body.acknowledge)) return ctx.send(400, { ok: false, error: `only optional steps can be acknowledged (${ACK.join(', ')}); ${JOURNEY_STEP_IDS.includes(body.acknowledge) ? 'that step is done when its record says so' : 'unknown step'}` });
        if (!next.acknowledged.includes(body.acknowledge)) { next.acknowledged.push(body.acknowledge); changed = true; }
      }
      if (body.unacknowledge !== undefined) {
        if (!JOURNEY_STEP_IDS.includes(body.unacknowledge)) return ctx.send(400, { ok: false, error: 'unknown step' });
        const before = next.acknowledged.length;
        next.acknowledged = next.acknowledged.filter((x) => x !== body.unacknowledge);
        changed = changed || next.acknowledged.length !== before;
      }
      if (body.dismissed !== undefined) {
        if (typeof body.dismissed !== 'boolean') return ctx.send(400, { ok: false, error: 'dismissed must be true or false' });
        if (next.dismissed !== body.dismissed) { next.dismissed = body.dismissed; changed = true; }
      }
      const invalid = validSetupJourney(next);
      if (invalid) return ctx.send(400, { ok: false, error: invalid });
      if (!changed) return respond(ctx, { unchanged: true });
      const r = setSettings({ setupJourney: next }, { who: whoOf(ctx) });
      if (!r.ok) { const { code, ...rest } = r; return ctx.send(code || 500, rest); }
      return respond(ctx, { written: true });
    });
  } },
];

export default routes;

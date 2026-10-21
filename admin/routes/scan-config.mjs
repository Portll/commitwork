// admin/routes/scan-config.mjs — the Scanning section on /config: which lanes this box runs, and
// which binaries it has been permitted to execute.
//
// The declaration lives in bin/lib/scan-config.mjs, which the RUNNER reads; this route only shows
// it and writes it. Declaration split from authority holds in the other direction too — the panel
// never executes a scanner, and approving one here is a statement of consent, not a launch.
//
// Presence is resolved by reading PATH, never by running the tool: asking 46 binaries for their
// version on every page load would execute the very things the operator has not yet approved.
// A tool that is approved but absent is shown as both — they are different facts, and a page that
// merged them would tell an operator they had refused something they had merely not installed.

import { requireSession } from '../lib/route-auth.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import {
  readScanConfig, writeScanConfig, configPath, checkEnabled, toolApproved, gateChecks, toolsOf, GATE,
} from '../../bin/lib/scan-config.mjs';
import { readJournal } from '../../bin/lib/verdict-journal-core.mjs';
import { CW } from '../lib/core.mjs';

const baselinePath = () => process.env.CW_BASELINE_MANIFEST || join(CW, 'manifests', 'security-baseline.json');
const catalogPath = () => process.env.CW_INSTALL_CATALOG || join(CW, 'manifests', 'install-catalog.json');

/** ENOENT is absence; anything else throws. A manifest that will not parse is never an empty lane set. */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The bytes the editor was shown, so a second panel cannot clobber the first. */
export function storeHash({ path = configPath() } = {}) {
  try { return createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex').slice(0, 16); }
  catch (e) { if (e.code === 'ENOENT') return 'absent'; throw e; }
}

/** Resolve a bare name on PATH without executing it. An absolute declaration is taken as given. */
export function resolveOnPath(tool, { env = process.env } = {}) {
  if (isAbsolute(tool)) return existsSync(tool) ? tool : null;
  for (const dir of String(env.PATH || '').split(':')) {
    if (!dir) continue;
    const p = join(dir, tool);
    try { if (statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
}

export function scanConfigState({ env = process.env } = {}) {
  const manifest = readJson(baselinePath());
  const cfg = readScanConfig();
  const gate = gateChecks(manifest.checks, cfg);
  const heldBy = new Map(gate.blocked.map((b) => [b.id, b]));

  let catalog = {};
  try { catalog = readJson(catalogPath()).tools || {}; } catch { catalog = {}; }

  const tools = new Map();
  for (const c of manifest.checks) {
    for (const t of toolsOf(c)) {
      if (!tools.has(t)) {
        const path = resolveOnPath(t, { env });
        const rec = cfg.tools?.[t] || {};
        tools.set(t, {
          tool: t,
          approved: toolApproved(cfg, t),
          at: rec.at ?? null,
          actor: rec.actor ?? null,
          present: path !== null,
          path,
          // No install line is not "cannot be installed" — node, npm and bash are ambient runtimes.
          install: catalog[t] ? Object.entries(catalog[t]).filter(([k, v]) => v && k !== 'why' && k !== 'url').map(([k, v]) => ({ via: k, cmd: v })) : [],
          why: catalog[t]?.why ?? null,
          lanes: [],
        });
      }
      tools.get(t).lanes.push(c.id);
    }
  }

  const lanes = manifest.checks.map((c) => ({
    id: c.id,
    description: c.description ?? null,
    egress: c.egress ?? null,
    groups: c.groups || [],
    tools: toolsOf(c),
    enabled: checkEnabled(cfg, c.id),
    held: heldBy.get(c.id)?.reason ?? null,
    heldTools: heldBy.get(c.id)?.tools || [],
    executesRepoCode: c.executesRepoCode === true,
  }));

  return {
    ok: true,
    gated: gate.gated,
    configured: !cfg.absent,
    hash: storeHash(),
    at: cfg.at ?? null,
    path: configPath(),
    groups: manifest.groups || {},
    lanes,
    tools: [...tools.values()],
    counts: {
      lanes: lanes.length,
      enabled: lanes.filter((l) => l.enabled).length,
      runnable: gate.runnable.length,
      held: gate.blocked.length,
      tools: tools.size,
      approved: [...tools.values()].filter((t) => t.approved).length,
      absentTools: [...tools.values()].filter((t) => !t.present).length,
    },
  };
}

/** The journalled history, newest first. An unwritten journal is ABSENT, not an empty history. */
export function scanConfigHistory({ dir, limit = 50 } = {}) {
  const j = readJournal(GATE, { dir });
  const records = (j.records || []).slice(-limit).reverse();
  return { absent: j.absent === true, chain: j.chain ?? null, records };
}

export const routes = [
  { method: 'GET', path: '/api/scan-config', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    try {
      return send(200, { ...scanConfigState(), history: scanConfigHistory() });
    } catch (e) {
      // A configuration that cannot be read is UNKNOWN. Rendering an empty page here would invite
      // the operator to re-approve everything against a store that is still there.
      return send(500, { ok: false, error: `scan configuration could not be read: ${e.message}` });
    }
  } },

  { method: 'POST', path: '/api/scan-config', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const session = requireSession(ctx);
    if (!session) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const baseHash = (body && typeof body.baseHash === 'string') ? body.baseHash : null;
      if (baseHash === null) return send(400, { ok: false, error: 'baseHash is required — a write with no base version cannot detect a conflict' });

      let cfg, current;
      try { cfg = readScanConfig(); current = storeHash(); }
      catch (e) { return send(500, { ok: false, error: `could not read the current configuration: ${e.message}` }); }
      if (baseHash !== current) {
        return send(409, { ok: false, error: 'the configuration changed since this page was loaded — nothing was written', currentHash: current });
      }

      const checks = { ...cfg.checks };
      const tools = { ...cfg.tools };
      const at = process.env.CW_NOW || new Date().toISOString();
      const actor = session.user.email || null;

      for (const [id, on] of Object.entries((body && body.checks) || {})) {
        if (typeof on !== 'boolean') return send(400, { ok: false, error: `checks.${id} must be a boolean` });
        checks[id] = { enabled: on };
      }
      for (const [tool, on] of Object.entries((body && body.tools) || {})) {
        if (typeof on !== 'boolean') return send(400, { ok: false, error: `tools.${tool} must be a boolean` });
        // The approving act is stamped; a withdrawal keeps the record of who withdrew it.
        tools[tool] = { approved: on, at, actor, path: on ? resolveOnPath(tool) : (tools[tool]?.path ?? null) };
      }

      try {
        const r = writeScanConfig({ checks, tools }, { actor, reason: (body && typeof body.reason === 'string') ? body.reason : null });
        return send(200, { ok: true, hash: storeHash(), checksChanged: r.checksChanged, toolsChanged: r.toolsChanged, ...scanConfigState() });
      } catch (e) {
        return send(500, { ok: false, error: `write failed, the configuration is unchanged: ${e.message}` });
      }
    });
  } },
];

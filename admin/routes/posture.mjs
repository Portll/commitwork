// admin/routes/posture.mjs — the posture board: its computation AND its route. The judgement lives
// in monitor/posture.mjs (shared with the CLI); this is the panel's half.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { SCANNER_CHECKS, CHECK_ALIASES } from '../../monitor/scanner-checks.mjs';
import { computePosture, toolInventory, manifestNamesForArea } from '../../monitor/posture.mjs';
import { weaknessClassVoids } from '../../monitor/coverage-manifest.mjs';
import { CW, MANIFEST_DIR, readJSON, registry, reportsFor, manifestFiles } from '../lib/core.mjs';

const TOOL_PROBE_TTL_MS = 5 * 60 * 1000;
let _toolProbe = { at: 0, tools: [] };
function probeTools(manifests, nowMs) {
  if (_toolProbe.at && (nowMs - _toolProbe.at) < TOOL_PROBE_TTL_MS) return _toolProbe;
  const tools = toolInventory(manifests).map((t) => {
    if (t.kind === 'image') {
      const r = spawnSync('docker', ['image', 'inspect', t.tool], { stdio: 'ignore', timeout: 20_000 });
      return { ...t, installed: r.status === 0, version: null, install: `docker pull ${t.tool}` };
    }
    // the tool name reaches argv as $1, never interpolated into a command line
    const found = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', t.tool], { stdio: 'ignore', timeout: 10_000 }).status === 0;
    let version = null;
    if (found) {
      for (const flag of ['--version', '-version', 'version', '-v']) {
        const r = spawnSync(t.tool, [flag], { encoding: 'utf8', timeout: 15_000 });
        const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
        if (r.status === 0 && text) { version = text.split('\n')[0].slice(0, 80); break; }
      }
    }
    return { ...t, installed: found, version, install: null };
  });
  _toolProbe = { at: nowMs, tools };
  return _toolProbe;
}

function posture(project) {
  const nowMs = process.env.CW_NOW ? Date.parse(process.env.CW_NOW) : Date.now();
  const wanted = manifestNamesForArea(project, registry());
  const manifests = manifestFiles().filter((n) => wanted.has(n))
    .map((n) => { const j = readJSON(join(MANIFEST_DIR, `${n}.json`)); return j && { name: n, checks: j.checks || [] }; })
    .filter(Boolean);
  const dir = reportsFor(project);
  const histIdx = readJSON(join(dir, 'history', 'index.json'));
  const probe = probeTools(manifests, nowMs);
  const taxonomy = readJSON(join(CW, 'monitor', 'approach-taxonomy.json')) || {};
  const out = computePosture({
    taxonomy,
    manifests, scannerChecks: SCANNER_CHECKS, aliases: CHECK_ALIASES,
    rollup: readJSON(join(dir, 'rollup.json')),
    historyIndex: Array.isArray(histIdx) ? histIdx : (histIdx && histIdx.rows) || [],
    lifecycle: readJSON(join(dir, 'lifecycle.json')),
    toolchain: probe.tools, nowMs,
  });
  // when the toolchain answer was taken, so a five-minute-old probe cannot pose as this second's
  out.toolchain.probedAt = new Date(probe.at).toISOString();
  // Lane E · the weakness-CLASS void axis. Per-approach weaknessClasses already flow through
  // computePosture; the AGGREGATE "a class nothing looks for" did not. In-scope = the canonical
  // check id of every resolved approach (both boards). weaknessClassVoids FAILS CLOSED (throws on a
  // vocab-less taxonomy); caught to an {error}, never [] — an unreadable axis is not "all covered".
  try {
    const inScope = new Set([...out.approaches, ...out.delivery.approaches].map((a) => a.aliasOf || a.check));
    const voids = weaknessClassVoids(taxonomy, inScope);
    const voidSet = new Set(voids.map((v) => v.class));
    out.classVoids = voids;
    out.classesCovered = Object.entries(taxonomy.weaknessClassVocab || {})
      .filter(([slug, def]) => !(def && def.agnostic) && !voidSet.has(slug))
      .map(([slug, def]) => ({ class: slug, label: (def && def.label) || null }))
      .sort((a, b) => (a.class < b.class ? -1 : 1));
  } catch (e) {
    out.classVoids = { error: `weakness-class axis unavailable (fail-closed, not empty): ${e.message}` };
    out.classesCovered = [];
  }
  return out;
}
// ── routes ──────────────────────────────────────────────────────────────────────────────────────
// THE DISPATCH CONTRACT. Each module exports `routes`: [{method, path, handle}]. `path` matches
// the PATHNAME exactly (query string stripped before matching); the dispatcher stops at the first match.
export const routes = [
  { method: 'GET', path: '/api/posture', handle: ({ send, query, knownProjects }) => {
    const q = query.get('project');
    const known = knownProjects();
    const ok = q && (known.has(q) || known.has(projectSlug(q)));
    return send(200, posture(ok ? q : null));
  } },
];

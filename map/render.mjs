#!/usr/bin/env node
// commitwork map engine — render a project's modernization "trainline" map.
//
//   node map/render.mjs [project]        (default: primary area slug)
//
// Generic engine; per-project inputs in map/data/<project>/ are selected via MAP_ROOT. A project
// with no migration-state.json gets a STUB placeholder instead of a broken run.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { registry, outDirFor, primaryAreaSlug } from '../monitor/area.mjs';
import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { followerScript } from '../lib/theme-follower.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// The placeholder for an area with no map data. It takes the house sheet and follows the panel's
// Appearance choice, as the map does; faces are served, because the page is served at /map/<area>.
export function stubHtml(project, reason) {
  const p = esc(project);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p} — modernization map</title>
${followerScript()}
<style>
${houseCss()}
body{display:grid;place-items:center;min-height:100vh;text-align:center;font-size:.875rem;color:var(--mut)}
.card{max-width:32.5rem;padding:0 1.5rem}
.card h1{font-size:1.125rem;margin:0 0 .625rem}
.card p{margin:.6rem auto}
.card .how{font-size:.75rem;color:var(--dim)}
</style></head>
<body><div class="card"><h1>No modernization map for <code>${p}</code> yet</h1>
 <p>${esc(reason)}</p>
 <p class="how">Provide <code>map/data/${p}/migration-state.json</code> (+ <code>subsystems.raw.json</code>, optional <code>cve-history/</code>) and re-run <code>node map/render.mjs ${p}</code>. The engine is shared; only the per-project data is missing.</p></div></body></html>`;
}

function main() {
  const REG = registry();
  // `project` here is an AREA SLUG — the route/artifact identity (/map/<slug>, map/data/<slug>/).
  const project = process.argv[2] || primaryAreaSlug(REG);
  const dataDir = join(HERE, 'data', project);
  mkdirSync(dataDir, { recursive: true });
  // served LIVE off the admin server (/map/<project>); generate.mjs writes index.html into MAP_ROOT
  const outHtml = join(dataDir, 'index.html');
  // slug→out mapping is a registry declaration — the resolver owns it. `env: false` deliberately:
  // the admin server spawns this once PER PROJECT, and an ambient CW_MONITOR_OUT would cross projects.
  const rollupDir = outDirFor(project, REG, { env: false });

  if (!existsSync(join(dataDir, 'migration-state.json'))) {
    const reason = `no data at map/data/${project}/ — modernization tracking not set up for this project`;
    writeFileSync(outHtml, stubHtml(project, reason));
    console.log(`map: ${project} -> STUB placeholder (${reason}) -> ${outHtml.replace(CW + '/', '')}`);
    process.exit(0);
  }

  // live rollup for the program/security attach layers (optional; skipped if absent)
  const rollup = join(rollupDir, 'rollup.json');
  const env = { ...process.env, MAP_ROOT: dataDir, ...(existsSync(rollup) ? { COMMITWORK_ROLLUP: rollup } : {}) };
  const run = (s) => execFileSync('node', [join(HERE, s)], { stdio: 'inherit', env });

  run('build-data.mjs');
  run('build-tracks.mjs');
  // CVE/security/program overlays need cve-history + a rollup; skip cleanly when a project lacks them
  // Absence is decided above by the cve-history check. Inside it a non-zero exit is a failure, never a
  // missing layer: attach-program exits 1 on purpose rather than keep stale security numbers.
  const failedLayers = [];
  if (existsSync(join(dataDir, 'cve-history'))) {
    for (const s of ['attach-cve.mjs', 'attach-security.mjs', 'attach-program.mjs']) {
      try { run(s); } catch (e) {
        const how = e.status != null ? `exit ${e.status}` : `signal ${e.signal}`;
        failedLayers.push(`${s} (${how})`);
        console.log(`  ${s} FAILED — ${how}; its stderr is above, and the map is rendered without this layer`);
      }
    }
  }
  run('generate.mjs'); // writes index.html into dataDir (= outHtml) via MAP_ROOT
  console.log(`map: ${project} -> ${outHtml.replace(CW + '/', '')} (served live at /map/${project})`);
  if (failedLayers.length) {
    console.error(`map: ${project} is missing ${failedLayers.length} layer(s): ${failedLayers.join(', ')}`);
    process.exit(3);
  }
}

if (isMainModule(import.meta.url)) main();

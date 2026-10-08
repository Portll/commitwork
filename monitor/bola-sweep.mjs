#!/usr/bin/env node
// commitwork monitor — on-demand BOLA/authorization run for ONE declared area (panel POST
// /api/bola/run?project=<slug>, or by hand). Resolves the area's `bola` declaration, refuses
// unless its secrets are configured, runs bin/bola-run.mjs, and persists the result atomically to
// reports/<out>/bola-latest.json. Progress streams to stdout; NO JSON on stdout — the
// machine-readable result goes to the file.
//
// usage: node monitor/bola-sweep.mjs <area-slug> [--base URL]
import { nowISO } from '../lib/clock.mjs';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { registry, outDirFor } from './area.mjs';
import { bolaAreas, readiness, manifestPathFor, evidencePathFor } from './bola-fleet.mjs';
import { run, validateManifest } from '../bin/bola-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const say = (line) => process.stdout.write(`[bola] ${line}\n`);

function die(msg, code = 2) { process.stderr.write(`bola-sweep: ${msg}\n`); process.exit(code); }

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('-'));
  const baseOverride = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : null; })();
  if (!slug) die('usage: node monitor/bola-sweep.mjs <area-slug> [--base URL]');

  const reg = registry();
  const area = bolaAreas(reg).find((a) => a.slug === slug);
  if (!area) die(`area "${slug}" has no bola declaration in monitor/projects.json (areas with one: ${bolaAreas(reg).map((a) => a.slug).join(', ') || 'none'})`);
  const base = baseOverride || area.base;

  // CW_TARGET_URL is how a manifest names the target inside ${ENV:...} (e.g. the Supabase auth origin
  // == base); set it from the resolved base so those references resolve at mint time.
  if (!process.env.CW_TARGET_URL) process.env.CW_TARGET_URL = base;

  const ready = readiness(area);
  if (!ready.ready) {
    say(`BLOCKED — ${ready.reason}`);
    die(`credentials not configured for "${slug}": ${ready.reason}`);
  }

  say(`area ${slug} · manifest ${area.manifest} · base ${base}`);
  let manifest;
  try {
    const rawM = JSON.parse(readFileSync(manifestPathFor(area.manifest), 'utf8'));
    manifest = rawM && rawM.bola && typeof rawM.bola === 'object' && !Array.isArray(rawM.bola) ? rawM.bola : rawM;
  } catch (e) { die(`could not read bundled manifest ${area.manifest}: ${e.message}`); }
  const { errors } = validateManifest(manifest);
  if (errors.length) die(`manifest ${area.manifest} is invalid:\n  - ${errors.join('\n  - ')}`);

  const result = await run(manifest, { base, onProgress: say });

  // Wrap with area + generatedAt for provenance; keep the raw bola-run result intact underneath
  const outDir = outDirFor(slug, reg);
  mkdirSync(outDir, { recursive: true });
  const path = evidencePathFor(slug, reg);
  const persisted = { ...result, area: slug, base, generatedAt: nowISO() };
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(persisted, null, 2)}\n`);
  renameSync(tmp, path);

  const v = (result.summary && result.summary.verdict) || result.reason || 'no verdict';
  say(`done — ${v}`);
  say(`wrote ${path.replace(CW + '/', '')}`);
  // Nonzero exit when the run recorded findings, so a CLI/CI caller can gate on it
  process.exit(result.findings && result.findings.length ? 1 : 0);
}

main().catch((e) => die(`unexpected: ${e && e.stack || e}`, 3));

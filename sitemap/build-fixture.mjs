#!/usr/bin/env node
// commitwork sitemap — S0 fixture wrapper: fixture from REAL services via real parsers, never
// hand-typed toy data.
//
//   node sitemap/build-fixture.mjs <service-dir> [service-dir ...]
//     no default list: which services a client runs is that client's configuration, not this file's
//
// Output: sitemap/data/fixture.sitemap.json — GITIGNORED, never committed: it harvests real client
// source (paths, symbols, hostnames, any secrets sitting in scanned config). No synthetic/redacted
// mode exists — without the fleet checkout this refuses rather than fabricate. Overwrites in
// place; never unlinks.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHarvest } from './harvest.mjs';
import { registryPath } from '../monitor/registry.mjs';

const SERVICES = process.argv.slice(2);
if (!SERVICES.length) { console.error('usage: node sitemap/build-fixture.mjs <service-dir> [service-dir ...]'); process.exit(2); }

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const PROJECTS = JSON.parse(readFileSync(registryPath(), 'utf8'));
const FLEET = (PROJECTS.projects.find((p) => p.name === 'clientA') || {}).path;
const BUILDOUT = (PROJECTS.projects.find((p) => p.name === 'clientA-buildout') || {}).path;
if (!FLEET || !existsSync(FLEET)) { console.error('fixture: clientA fleet path missing from monitor/projects.json'); process.exit(1); }

const h = createHarvest({ buildoutDir: BUILDOUT });
const services = [];
for (const name of SERVICES) {
  const svcDir = join(FLEET, name);
  if (!existsSync(svcDir)) { console.error(`fixture: skip ${name} (not in fleet)`); continue; }
  console.log(`fixture: harvesting ${name} …`);
  services.push(h.service(svcDir, name));
}
const manifest = h.manifest(services, { project: 'clientA', tool: 'sitemap/build-fixture.mjs', fixture: true });

mkdirSync(join(HERE, 'data'), { recursive: true });
const out = join(HERE, 'data', 'fixture.sitemap.json');
writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
const p = manifest.provenance.files;
console.log(`fixture: ${services.length} services · ${p.scanned} files (${p.symbolled} symbolled / ${p.inventoryOnly} inventory / ${p.void} void) · ${manifest.externalLinks.length} links · ${Math.round(statSync(out).size / 1024)}KB -> ${out.replace(CW + '/', '')}`);

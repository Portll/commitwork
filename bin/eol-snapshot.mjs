#!/usr/bin/env node
// bin/eol-snapshot.mjs — refresh manifests/eol-snapshot.json from endoflife.date.
//
// usage: node bin/eol-snapshot.mjs [--check]
// The eol-runtime lane reads the snapshot offline, so a scan needs no network and two scans of the
// same tree agree. Refreshing it is a deliberate, reviewable change to a tracked file.
// exit: 0 written (or current under --check) · 20 --check: the snapshot differs from the source ·
//       21 a product could not be fetched (nothing written)
// env, read at call time: CW_EOL_SNAPSHOT (output path), CW_EOL_API (base URL)
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const snapshotPath = () => process.env.CW_EOL_SNAPSHOT || join(ROOT, 'manifests', 'eol-snapshot.json');
const apiBase = () => process.env.CW_EOL_API || 'https://endoflife.date/api';

// endoflife.date product slugs the lane knows how to find in a repository.
export const PRODUCTS = Object.freeze([
  'nodejs', 'python', 'go', 'ruby', 'php', 'eclipse-temurin', 'dotnet',
  'debian', 'ubuntu', 'alpine-linux', 'postgresql', 'mysql', 'redis', 'nginx',
]);

const dateOrBool = (v) => (typeof v === 'boolean' ? v : (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));

/** The fields the lane reads, one row per cycle, sorted by cycle text so a refresh diffs cleanly. */
export function compact(rows) {
  return rows.map((r) => ({
    cycle: String(r.cycle),
    eol: dateOrBool(r.eol),
    ...(r.codename ? { codename: String(r.codename).toLowerCase() } : {}),
  })).sort((a, b) => (a.cycle < b.cycle ? -1 : a.cycle > b.cycle ? 1 : 0));
}

async function fetchProducts() {
  const products = {};
  for (const p of PRODUCTS) {
    const res = await fetch(`${apiBase()}/${p}.json`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error(`${p}: no cycles in the response`);
    products[p] = compact(rows);
  }
  return products;
}

if (isMainModule(import.meta.url)) {
  const check = process.argv.includes('--check');
  let products;
  try { products = await fetchProducts(); } catch (e) {
    console.error(`eol-snapshot: ${e.message}; nothing written`);
    process.exit(21);
  }
  const prev = existsSync(snapshotPath()) ? JSON.parse(readFileSync(snapshotPath(), 'utf8')) : null;
  const same = prev && JSON.stringify(prev.products) === JSON.stringify(products);
  if (check) {
    console.log(same ? 'eol-snapshot: current' : 'eol-snapshot: differs from endoflife.date — run node bin/eol-snapshot.mjs');
    process.exit(same ? 0 : 20);
  }
  const fetched = same && prev.fetched ? prev.fetched : new Date().toISOString().slice(0, 10);
  const doc = { source: 'https://endoflife.date (MIT licence)', fetched, products };
  writeAtomic(snapshotPath(), `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`eol-snapshot: ${Object.keys(products).length} products, ${Object.values(products).reduce((n, r) => n + r.length, 0)} cycles, fetched ${fetched}`);
}

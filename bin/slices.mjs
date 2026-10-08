#!/usr/bin/env node
// commitwork slices — versioned store of sitemap state, keyed by (slug, db-date). Portable:
// repo-relative paths, runnable from any cwd; no wall clock, so re-runs are deterministic.
//
//   node bin/slices.mjs snapshot <slug> [--date <YYYY-MM-DD>]
//   node bin/slices.mjs list <slug>
//   node bin/slices.mjs --backfill <slug>@<sha> --date <YYYY-MM-DD>   (RESERVED)

import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = join(ROOT, 'sitemap', 'data');
const SLICES = join(DATA, 'slices');
const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s), cy = (s) => c('36', s);

// ── args ──────────────────────────────────────────────────────────────────
const A = process.argv.slice(2);
const opt = (k) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : undefined; };
const flag = (k) => A.includes(k);
const cmd = A.find((a, i) => !a.startsWith('--') && (i === 0 || !A[i - 1].startsWith('--')));

// Load-bearing: must match demo.html's PROJECT sanitiser exactly — do not diverge.
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function die(msg) { console.error(red('slices: ') + msg); process.exit(1); }

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { die(`cannot read ${p}: ${e.message}`); }
}

// ── snapshot ────────────────────────────────────────────────────────────────
function snapshot(rawSlug) {
  if (!rawSlug) die('snapshot needs a <slug>, e.g.  node bin/slices.mjs snapshot clientA');
  const slug = slugify(rawSlug);
  if (!slug) die(`slug "${rawSlug}" sanitises to empty (allowed chars: a-z 0-9 -)`);

  const src = join(DATA, `${slug}.sitemap.json`);
  if (!existsSync(src)) die(`no source sitemap at ${src} — run  node monitor/sitemap-data.mjs  first`);

  const map = readJSON(src);
  const generated = typeof map.generated === 'string' ? map.generated : null;
  const services = Array.isArray(map.services) ? map.services.length : null;

  // db-date: --date wins, else sitemap `generated`; no wall-clock fallback — undatable is an error
  let date = opt('--date');
  if (date) {
    if (!DATE_RE.test(date)) die(`--date must be YYYY-MM-DD, got "${date}"`);
  } else if (generated && DATE_RE.test(generated.slice(0, 10))) {
    date = generated.slice(0, 10);
    console.log(dim(`  no --date given; using sitemap.generated → ${date}`));
  } else {
    die('no --date and sitemap has no usable `generated` date; pass --date YYYY-MM-DD');
  }

  const outDir = join(SLICES, slug);
  mkdirSync(DATA, { recursive: true });    // gitignored slices/ won't exist on a fresh clone
  mkdirSync(outDir, { recursive: true });  // sitemap/data/slices/<slug>/
  const sliceName = `${date}.sitemap.json`;
  const sliceFile = join(outDir, sliceName);
  copyFileSync(src, sliceFile);
  console.log(grn('  snapshot ') + `${slug} @ ${bold(date)}  →  ${dim('slices/' + slug + '/' + sliceName)}`);

  // ── index.json (the store manifest) — upsert by date, keep sorted ──────────
  const indexPath = join(outDir, 'index.json');
  let index = existsSync(indexPath) ? readJSON(indexPath) : [];
  if (!Array.isArray(index)) index = [];
  index = index.filter((r) => r && r.date !== date); // drop any prior row for this date
  index.push({ date, file: sliceName, services, generated });
  index.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  console.log(dim(`  index    → slices/${slug}/index.json  (${index.length} snapshot${index.length === 1 ? '' : 's'})`));

  // ── <slug>.snapshots.json (front-end discovery, flat [{date,file}]) ─────────
  // `file` resolves from the page's data/ base
  const snaps = index.map((r) => ({ date: r.date, file: `slices/${slug}/${r.file}` }));
  const snapsPath = join(DATA, `${slug}.snapshots.json`);
  writeFileSync(snapsPath, JSON.stringify(snaps, null, 2) + '\n');
  console.log(dim(`  discover → data/${slug}.snapshots.json  (window.__CW_SNAPSHOTS__)`));
}

// ── list ─────────────────────────────────────────────────────────────────────
function list(rawSlug) {
  if (!rawSlug) die('list needs a <slug>, e.g.  node bin/slices.mjs list clientA');
  const slug = slugify(rawSlug);
  const indexPath = join(SLICES, slug, 'index.json');
  if (!existsSync(indexPath)) {
    console.log(yel(`no slices yet for "${slug}"`) + dim(` — take one with:  node bin/slices.mjs snapshot ${slug} --date <YYYY-MM-DD>`));
    return;
  }
  const index = readJSON(indexPath);
  console.log(bold(`slices · ${slug}`) + dim(`  (${Array.isArray(index) ? index.length : 0})`));
  for (const r of Array.isArray(index) ? index : []) {
    const svc = r.services == null ? '?' : r.services;
    console.log(`  ${cy(r.date)}  ${dim(String(svc).padStart(3) + ' svc')}  ${r.file}  ${dim(r.generated || '')}`);
  }
}

// ── backfill (RESERVED) ───────────────────────────────────────────────────────
function backfill(spec) {
  console.log(yel('backfill: reserved, not yet implemented'));
  console.log(dim(`  git-historical harvest (materialise a slice from ${spec || '<slug>@<sha>'}) is out of scope for v1.`));
  process.exit(0);
}

// Positionals in order — the slug is found regardless of where --date sits.
const positionals = A.filter((a, i) => !a.startsWith('--') && (i === 0 || !A[i - 1].startsWith('--')));
const slugArg = positionals[1]; // [0] is the verb

// ── dispatch ──────────────────────────────────────────────────────────────────
const bf = opt('--backfill') || (flag('--backfill') ? '' : undefined);
if (bf !== undefined) { backfill(bf); }
else if (cmd === 'snapshot') { snapshot(slugArg); }
else if (cmd === 'list') { list(slugArg); }
else {
  console.log(bold('commitwork slices') + ' — versioned sitemap-state store\n');
  console.log('  node bin/slices.mjs ' + cy('snapshot <slug>') + ' [--date YYYY-MM-DD]   copy current sitemap into the slice store');
  console.log('  node bin/slices.mjs ' + cy('list <slug>') + '                        print available snapshots');
  console.log('  node bin/slices.mjs ' + dim('--backfill <slug>@<sha> --date <d>') + '   ' + dim('RESERVED (not implemented)'));
  process.exit(cmd ? 1 : 0);
}

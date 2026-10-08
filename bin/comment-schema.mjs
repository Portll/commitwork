#!/usr/bin/env node
// usage: comment-schema.mjs [--status] [--json] [--seed [--force]] [--tighten]
// exit: 0 pass · 1 findings · 2 failure (fail closed) · 3 not seeded
// env, read at call time: CW_COMMENT_ROOT, CW_COMMENT_BASELINE, CW_NOW
// schema: fact: <claim> [/ <consequence>] [(expiry: <cond>, prev: <state>)]   — one line
//
// fact: grammar is hard-gated, block length is ratcheted / 525 legacy files would make a hard gate red forever (expiry: when the legacy count reaches zero, prev: unknown)
// fact: key is the path and a COUNT, not a line or a hash / a line drifts, a hash changes when you edit the block you were asked to shorten (expiry: never, prev: wrong)
import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const root = () => process.env.CW_COMMENT_ROOT || REPO;
const baselinePath = () => process.env.CW_COMMENT_BASELINE || join(REPO, 'bin', 'comment-baseline.json');
const now = () => process.env.CW_NOW || new Date().toISOString();

// fact: 6 is the house median longest run, measured over 525 tracked .mjs (expiry: on re-measure, prev: unknown)
export const MAX_RUN = 6;

// fact: prev is a CLOSED set / an open one becomes a free-text field nobody can query (expiry: when a state genuinely missing is added, prev: not built)
export const PREV_STATES = new Set([
  'broken', 'wrong', 'unknown', 'not built', 'drifted', 'missing', 'unscored', 'duplicated', 'slow',
]);

// fact: claim is lazy `.+?` anchored on the trailer at `$` / a `[^(]` claim bars "(silent 404)" and the gate failed its own definition line first (expiry: never, prev: wrong)
// fact: the trailer is optional and checked in full when present / operator ruling 2026-09-26: a comment needs no expiry, and a half-written trailer still fails rather than reading as claim text
export const FACT_RE = /^fact:\s*(?<claim>.+?)\s*(?:\(expiry:\s*(?<expiry>[^,]+?),\s*prev:\s*(?<prev>[^)]+?)\))?\s*$/;

// fact: reference blocks are counted apart, never gated / gating them made the only legal way to clear a usage: block a deletion of reference material that is not verbose (expiry: never, prev: broken)
const REFERENCE = /^(usage|exit codes?|exit:|env|output|options?|flags?|returns?|artifacts?|parses|commands?|arguments?|@param|@returns?|@type|@typedef)\b/i;

// fact: this vocabulary lives HERE and comment-suggest imports it / defined in the suggester, which imports this module, the gate could not reach it without a second copy of REFERENCE (expiry: never, prev: duplicated)
export const strip = (l) => l.replace(/^[/*\s]+/, '').replace(/\s*\*+\/\s*$/, '').trim();

// fact: the FIRST line decides and proportion is only a second path / one header over six flag lines is 14%, so the proportion rule called every reference block in this tree narrative (expiry: never, prev: broken)
export function classify(block) {
  const lines = block.map(strip).filter(Boolean);
  if (!lines.length) return 'narrative';
  if (REFERENCE.test(lines[0])) return 'reference';
  const ref = lines.filter((l) => REFERENCE.test(l)).length;
  return ref / lines.length >= 0.34 ? 'reference' : 'narrative';
}

// fact: the baseline records which basis produced its numbers / narrative counts read against a combined baseline show an improvement nobody made (expiry: never, prev: not built)
export const BASIS = 'narrative';

const SKIP_DIRS = new Set(['node_modules', '.git', 'reports', 'dist', '.claude', 'archive']);
const EXT = /\.(mjs|js|cjs)$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name) && !e.name.includes('pre-lifecycle')) out.push(p);
  }
  return out;
}

// fact: a string containing /* does not open a block / lexing for that needs a parser (expiry: if one is added, prev: unknown)
export function commentLines(src) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (inBlock) {
      out.push(l.replace(/^\*+\s?/, '').replace(/\*\/.*$/, '').trim());
      if (l.includes('*/')) inBlock = false;
      continue;
    }
    if (l.startsWith('/*')) {
      out.push(l.replace(/^\/\*+\s?/, '').replace(/\*\/.*$/, '').trim());
      if (!l.includes('*/')) inBlock = true;
      continue;
    }
    if (l.startsWith('//')) { out.push(l.slice(2).trim()); continue; }
    out.push(null);
  }
  return out;
}

// fact: a blank line ends a run / two stanzas separated by whitespace are two blocks, not one long one (expiry: never, prev: unknown)
export function runs(lines) {
  const found = [];
  let start = -1, len = 0;
  lines.forEach((c, i) => {
    if (c !== null && c !== '') { if (start < 0) start = i; len += 1; return; }
    if (len) found.push({ start, len });
    start = -1; len = 0;
  });
  if (len) found.push({ start, len });
  return found;
}

export function scanFile(rel, src) {
  const lines = commentLines(src);
  const bad = [];
  lines.forEach((c, i) => {
    if (c === null || !/^fact:/.test(c)) return;
    const m = FACT_RE.exec(c);
    if (!m || !m.groups.claim.trim()) { bad.push({ rel, line: i + 1, why: 'does not match the schema', text: c.slice(0, 90) }); return; }
    if (m.groups.expiry === undefined) {
      if (/\((expiry|prev):/i.test(m.groups.claim)) bad.push({ rel, line: i + 1, why: 'malformed trailer — write (expiry: <cond>, prev: <state>) or none', text: c.slice(0, 90) });
      return;
    }
    const prev = m.groups.prev.trim();
    if (!PREV_STATES.has(prev)) {
      bad.push({ rel, line: i + 1, why: `prev "${prev}" is not in the closed set`, text: c.slice(0, 90) });
    }
    const expiry = m.groups.expiry.trim();
    if (!expiry) bad.push({ rel, line: i + 1, why: 'empty expiry', text: c.slice(0, 90) });
    // fact: TODO/FIXME/TBD is the suggester's own placeholder, not a condition / accepting it lets a draft ship an unresolved expiry the gate then blesses as a finished fact (expiry: never, prev: not built)
    else if (/^(todo|fixme|tbd|xxx)$/i.test(expiry)) bad.push({ rel, line: i + 1, why: `unresolved expiry "${expiry}"`, text: c.slice(0, 90) });
  });
  let long = 0, reference = 0;
  for (const r of runs(lines).filter((x) => x.len > MAX_RUN)) {
    if (classify(lines.slice(r.start, r.start + r.len)) === 'reference') reference += 1;
    else long += 1;
  }
  return { violations: bad, long, reference };
}

export function scan(dir) {
  const files = walk(dir);
  const violations = [];
  const counts = {};
  const reference = {};
  for (const p of files) {
    const rel = relative(dir, p);
    let src;
    try { src = readFileSync(p, 'utf8'); } catch (e) { throw new Error(`${rel}: ${e.code}`); }
    const r = scanFile(rel, src);
    violations.push(...r.violations);
    if (r.long) counts[rel] = r.long;
    if (r.reference) reference[rel] = r.reference;
  }
  return { files: files.length, violations, counts, reference };
}

function readBaseline() {
  try { return JSON.parse(readFileSync(baselinePath(), 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`baseline unreadable (${e.code}) — refusing to treat that as "nothing grandfathered"`);
  }
}

function writeBaseline(counts) {
  const body = JSON.stringify({ seededAt: now(), basis: BASIS, maxRun: MAX_RUN, counts }, null, 2) + '\n';
  writeAtomic(baselinePath(), body);
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const { files, violations, counts, reference } = scan(root());
  const refTotal = Object.values(reference).reduce((a, b) => a + b, 0);

  if (has('--seed')) {
    const b = readBaseline();
    if (b && !has('--force')) { process.stderr.write('baseline exists — pass --force to overwrite\n'); process.exit(2); }
    writeBaseline(counts);
    process.stdout.write(`seeded ${Object.keys(counts).length} file(s) with a long narrative run over ${MAX_RUN}`
      + ` · ${refTotal} long reference block(s) excluded from the gate by basis "${BASIS}"\n`);
    process.exit(0);
  }

  const base = readBaseline();
  if (!base) { process.stderr.write('not seeded — run --seed\n'); process.exit(3); }
  // A combined-count baseline read against narrative-only counts shows every reference block as an
  // improvement. Refuse rather than report a gain nobody made.
  if (base.basis !== BASIS) {
    process.stderr.write(`baseline was seeded under basis "${base.basis || 'combined'}" and this gates`
      + ` "${BASIS}" — the counts are not comparable and the difference would read as an improvement.`
      + ` Re-seed with --seed --force.\n`);
    process.exit(3);
  }

  const regressions = [];
  for (const [rel, n] of Object.entries(counts)) {
    const was = base.counts[rel] ?? 0;
    if (n > was) regressions.push({ rel, was, now: n });
  }

  if (has('--tighten')) {
    const tightened = { ...base.counts };
    let banked = 0;
    for (const [rel, was] of Object.entries(base.counts)) {
      const n = counts[rel] ?? 0;
      if (n < was) { banked += was - n; if (n) tightened[rel] = n; else delete tightened[rel]; }
    }
    writeBaseline(tightened);
    process.stdout.write(`tightened: banked ${banked} removed long block(s)\n`);
    process.exit(0);
  }

  if (has('--json')) {
    process.stdout.write(JSON.stringify({
      files, basis: BASIS, violations, regressions,
      longFiles: Object.keys(counts).length,
      longReference: refTotal, longReferenceFiles: Object.keys(reference).length, reference,
    }, null, 2) + '\n');
    process.exit(violations.length || regressions.length ? 1 : 0);
  }

  for (const v of violations) process.stdout.write(`  SCHEMA  ${v.rel}:${v.line} ${v.why}\n          ${v.text}\n`);
  for (const r of regressions) process.stdout.write(`  RATCHET ${r.rel} gained a long comment block (${r.was} -> ${r.now}, max run ${MAX_RUN})\n`);
  // Reported every run, not only under --status: a population the gate deliberately does not count
  // is exactly the thing that becomes invisible, and invisible is how an unverified result starts reading as a pass.
  if (refTotal) {
    process.stdout.write(`  REFERENCE ${refTotal} long block(s) in ${Object.keys(reference).length} file(s)`
      + ` are usage/env/flags material — reported, never gated. Shortening one is a judgement, not a fix.\n`);
  }

  if (has('--status')) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    process.stdout.write(`${files} file(s) · ${Object.keys(counts).length} with a long narrative run over ${MAX_RUN}`
      + ` · ${total} gated block(s) · ${refTotal} reference block(s) not gated · ${violations.length} schema violation(s)\n`);
  }
  process.exit(violations.length || regressions.length ? 1 : 0);
}

if (isMainModule(import.meta.url)) {
  try { main(); } catch (e) { process.stderr.write(`comment-schema: ${e.message}\n`); process.exit(2); }
}

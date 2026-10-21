#!/usr/bin/env node
// bin/memory-sync.mjs — put the harness memory directory into the memory layer ONE RECORD PER FILE,
// addressable by name, and measure what is actually retrievable there afterwards.
//
// Measured 2026-10-11, before this existed: of 41 slugs sampled from the commitwork memory
// directory, 17 came back from /api/recall/tags under their own name and 24 did not. Where a file
// was present it had been stored verbatim, YAML frontmatter and all, so the embedding carried the
// header rather than the fact — and the literal query `name: <slug>` returned four unrelated
// records. Nothing wrote that directory on purpose; those 17 are sessions pasting files in by hand.
//
// The index and the layer answer different questions. MEMORY.md is loaded unconditionally and has a
// hard read limit (24.4KB — it sat at 50.6KB, so half its entries were dropped on every load and
// nobody could see which half). The layer is unbounded but only answers when asked, and it answers
// by meaning, so it cannot be asked for a memory BY NAME. This keeps a named copy on the layer:
// external_id plus a `memory:<slug>` tag, which /api/recall/tags matches exactly.
//
// THE CANARY RUNS FIRST AND A FAILED CANARY REFUSES THE RUN. Coverage is measured through that same
// enumeration endpoint, so a broken path would report every slug ABSENT — indistinguishable from a
// cold store, and the direction that lies to you. The negative control is a tag minted nowhere and
// must return 0 rows; the positive is this tool's own record and must come back under its own tag.
//
// Receipts only: no memory content, no credential, ever reaches stdout.
//
// usage: node bin/memory-sync.mjs --coverage | --dry | --apply [--dir <path>] [--limit N] [--json]
// exit: 0 done · 20 the canary refused the run, or no mode was given · 21 a write failed, stored
//       divergent content, a coverage query could not run, or a file's frontmatter was unreadable
// env, read at call time: CW_HARNESS_MEMORY_DIR (the memory directory, default the harness path for
//       this repo), VELD_API_URL / VELD_API_KEY / VELD_USER_ID (resolved by the client), CW_NOW
// output: receipts on stdout; records are written to the memory layer, nothing to this tree

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { isMainModule } from '../lib/is-main.mjs';
import { upsert, recallByTags, config, tally, VERIFIED, FAILED, STORED_DIVERGENT } from '../lib/memory-layer-client.mjs';

export const USAGE = `memory-sync — sync the harness memory directory to the memory layer, by name

  node bin/memory-sync.mjs --coverage [--json]        read-only: which slugs are retrievable by name
  node bin/memory-sync.mjs --dry [--json]             what a run would write, writing nothing
  node bin/memory-sync.mjs --apply [--limit N] [--json]

  --dir <path>    the memory directory (else CW_HARNESS_MEMORY_DIR, else the harness path for this repo)
  --coverage      enumerate every slug through /api/recall/tags; no writes
  --dry           parse and build every record, call nothing
  --apply         write; each receipt is verified by readback before it counts
  --limit N       first N files, for a bounded first run
  --json          machine output

Exit 0 on success, 20 when the canary refuses the run, 21 when a write failed or stored
divergent content. Node's own exits are 1-13, so verdicts start at 20.
`;

export const CANARY_SLUG = '__memory-sync-canary__';
export const WRITE_TIMEOUT_MS = '30000';
const TAG_PREFIX = 'memory:';

// The harness names a project directory after its working directory with every separator turned
// into a dash. Derived, never hard-coded: a literal path here would be one operator's home.
export const harnessSlug = (root) => String(root).replace(/\//g, '-');

// Env read at CALL time. A module-scope const defeats every test that sets the variable later.
export function harnessMemoryDir({ env = process.env, root = process.cwd(), home = null } = {}) {
  if (env.CW_HARNESS_MEMORY_DIR) return env.CW_HARNESS_MEMORY_DIR;
  return join(home || env.HOME || homedir(), '.claude', 'projects', harnessSlug(root), 'memory');
}

// A file whose frontmatter is unreadable is an ERROR, not a record with empty fields: the
// description is what recall ranks on, and an empty one stores a memory nothing can find.
export function parseMemoryFile(text, { name: fallbackName = null } = {}) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('no frontmatter block');
  const [, head, body] = m;
  const field = (key) => {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- key is the literal name, description or type passed by this function
    const hit = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, 'm').exec(head);
    if (!hit) return null;
    return hit[1].trim().replace(/^["'](.*)["']$/, '$1');
  };
  const name = field('name') || fallbackName;
  const description = field('description');
  const type = field('type') || 'reference';
  if (!name) throw new Error('frontmatter has no name');
  if (!description) throw new Error('frontmatter has no description');
  if (!body.trim()) throw new Error('body is empty');
  return { name, description, type, body: body.trim() };
}

// MEMORY.md's headings are a taxonomy a human assigned; the layer's own clustering is inferred.
// Carrying it as a tag is the one grouping signal the layer cannot derive.
export function groupsFromIndex(indexText) {
  const groups = new Map();
  let heading = null;
  for (const line of String(indexText).split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { heading = h[1]; continue; }
    if (!heading) continue;
    for (const hit of line.matchAll(/\(([A-Za-z0-9._-]+)\.md\)/g)) {
      if (!groups.has(hit[1])) groups.set(hit[1], heading);
    }
  }
  return groups;
}

export const groupTag = (heading) => `memory-group:${String(heading).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export function recordFor(parsed, { project = 'commitwork', group = null } = {}) {
  const tags = [`${TAG_PREFIX}${parsed.name}`, 'harness-memory', `memory-type:${parsed.type}`];
  if (group) tags.push(groupTag(group));
  return {
    external_id: `claude-memory/${project}/${parsed.name}`,
    content: `${parsed.description}\n\n${parsed.body}`,
    tags,
    memory_type: 'Context',
  };
}

export function readMemoryDir(dir, { fs = { readdirSync, readFileSync, statSync } } = {}) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').sort();
  let index = '';
  try { index = fs.readFileSync(join(dir, 'MEMORY.md'), 'utf8'); } catch { index = ''; }
  const groups = groupsFromIndex(index);
  const parsed = [];
  const unreadable = [];
  for (const f of files) {
    const slug = basename(f, '.md');
    try {
      parsed.push({ file: f, group: groups.get(slug) || null, ...parseMemoryFile(fs.readFileSync(join(dir, f), 'utf8'), { name: slug }) });
    } catch (e) {
      unreadable.push({ file: f, reason: e.message });
    }
  }
  return { files, parsed, unreadable, indexed: groups.size };
}

// Rank-1 identity under the record's own tag. `/api/recall/tags` matches exactly; `/api/recall`
// accepts a tags filter and ignores it, which is why coverage never goes through it.
export async function presentByName(slug, { recallImpl = recallByTags, env = process.env, key = null, fetchImpl = fetch } = {}) {
  const res = await recallImpl([`${TAG_PREFIX}${slug}`], { limit: 1, env, key, fetchImpl });
  if (!res.ok) return { ok: false, present: null, reason: res.reason };
  return { ok: true, present: (res.memories || []).length > 0, reason: null };
}

export async function canary({ recallImpl = recallByTags, upsertImpl = upsert, write = false, env = process.env, key = null, fetchImpl = fetch, now = null } = {}) {
  const absentTag = `${TAG_PREFIX}__absent-control-${(now || env.CW_NOW || '0').replace(/[^0-9a-z]/gi, '')}__`;
  const control = await recallImpl([absentTag], { limit: 1, env, key, fetchImpl });
  if (!control.ok) return { ok: false, reason: `negative control could not run: ${control.reason}` };
  if ((control.memories || []).length > 0) {
    return { ok: false, reason: `negative control returned ${control.memories.length} row(s) for a tag minted nowhere — enumeration does not filter, so coverage would be meaningless` };
  }
  if (!write) return { ok: true, reason: null, positive: 'skipped — read-only run' };

  const stamp = now || env.CW_NOW || new Date().toISOString();
  const rec = recordFor({
    name: CANARY_SLUG,
    description: 'memory-sync canary — proves a named record written by this tool comes back under its own tag',
    type: 'reference',
    body: `Written by bin/memory-sync.mjs at ${stamp}. A coverage run that cannot find THIS record is measuring a broken enumeration path, not an empty store.`,
  }, { project: config({ env }).project });
  const receipt = await upsertImpl(rec, { scope: 'claude-code', env, key, fetchImpl });
  if (receipt.state === FAILED) return { ok: false, reason: `canary write failed: ${receipt.reason}` };
  const back = await presentByName(CANARY_SLUG, { recallImpl, env, key, fetchImpl });
  if (!back.ok) return { ok: false, reason: `canary readback could not run: ${back.reason}` };
  if (!back.present) return { ok: false, reason: 'canary was written and does not come back under its own tag — every slug would read ABSENT' };
  return { ok: true, reason: null, positive: receipt.state, id: receipt.id, version: receipt.version };
}

export async function coverage(slugs, { recallImpl = recallByTags, env = process.env, key = null, fetchImpl = fetch } = {}) {
  const present = [];
  const absent = [];
  const unknown = [];
  for (const slug of slugs) {
    const r = await presentByName(slug, { recallImpl, env, key, fetchImpl });
    if (!r.ok) unknown.push({ slug, reason: r.reason });
    else if (r.present) present.push(slug);
    else absent.push(slug);
  }
  return { total: slugs.length, present, absent, unknown };
}

export async function syncAll(parsed, { upsertImpl = upsert, env = process.env, key = null, fetchImpl = fetch, project = null } = {}) {
  const proj = project || config({ env }).project;
  const receipts = [];
  for (const p of parsed) {
    const rec = recordFor(p, { project: proj, group: p.group });
    receipts.push({ slug: p.name, ...(await upsertImpl(rec, { scope: 'claude-code', env, key, fetchImpl })) });
  }
  return receipts;
}

export function parseArgs(argv) {
  const a = { mode: null, json: false, help: false, dir: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--coverage' || t === '--dry' || t === '--apply') a.mode = t.slice(2);
    else if (t === '--dir') a.dir = argv[++i];
    else if (t === '--limit') a.limit = Number(argv[++i]);
    else throw new Error(`unknown argument: ${t}`);
  }
  return a;
}

export async function main(argv = process.argv.slice(2), { env = process.env, out = console.log, deps = {} } = {}) {
  const args = parseArgs(argv);
  if (args.help || !args.mode) { out(USAGE); return args.help ? 0 : 20; }

  const dir = args.dir || harnessMemoryDir({ env });
  const read = deps.readMemoryDir || readMemoryDir;
  const { files, parsed, unreadable, indexed } = read(dir);
  const slugs = parsed.map((p) => p.name);
  const selected = args.limit ? parsed.slice(0, args.limit) : parsed;
  const report = { dir, files: files.length, parsed: parsed.length, unreadable, indexedByMemoryMd: indexed, mode: args.mode };

  if (args.mode === 'dry') {
    report.records = selected.map((p) => ({ slug: p.name, external_id: recordFor(p, { project: config({ env }).project, group: p.group }).external_id, tags: recordFor(p, { project: config({ env }).project, group: p.group }).tags, bytes: p.description.length + p.body.length + 2 }));
    out(args.json ? JSON.stringify(report, null, 2) : `${report.records.length} record(s) would be written to ${dir}'s layer copy; ${unreadable.length} unreadable`);
    return unreadable.length ? 21 : 0;
  }

  const c = await canary({ ...deps, write: args.mode === 'apply', env });
  report.canary = c;
  if (!c.ok) {
    out(args.json ? JSON.stringify(report, null, 2) : `REFUSED — ${c.reason}`);
    return 20;
  }

  if (args.mode === 'coverage') {
    report.coverage = await coverage(slugs, { ...deps, env });
    const { total, present, absent, unknown } = report.coverage;
    out(args.json ? JSON.stringify(report, null, 2)
      : `${present.length}/${total} retrievable by name · ${absent.length} absent · ${unknown.length} unmeasured\n${absent.map((s) => `  absent ${s}`).join('\n')}`);
    return unknown.length ? 21 : 0;
  }

  report.receipts = await syncAll(selected, { ...deps, env });
  report.tally = tally(report.receipts);
  const broken = report.receipts.filter((r) => r.state === FAILED || r.storedForm === STORED_DIVERGENT);
  report.broken = broken.map((r) => ({ slug: r.slug, state: r.state, storedForm: r.storedForm, reason: r.reason || null }));
  const verified = report.receipts.filter((r) => r.state === VERIFIED).length;
  out(args.json ? JSON.stringify(report, null, 2)
    : `${verified}/${report.receipts.length} verified · ${broken.length} failed or divergent · ${unreadable.length} unreadable`);
  return broken.length || unreadable.length ? 21 : 0;
}

if (isMainModule(import.meta.url)) {
  if (!process.env.VELD_TIMEOUT_MS) process.env.VELD_TIMEOUT_MS = WRITE_TIMEOUT_MS;
  main().then((code) => process.exit(code)).catch((e) => { console.error(`memory-sync: ${e.message}`); process.exit(21); });
}

#!/usr/bin/env node
// commitwork — manifest-map: an index into a manifest nobody should read whole.
//
// manifests/security-baseline.json is 2,052 lines / 257K of 68 checks. Every consumer — agent or
// person — wants one of four things from it: what does check X declare, what runs in group Y, what
// needs tool Z, and what fires for language W. Answering any of those by reading the file costs the
// whole file; answering it from this index costs a line number and a bounded read.
//
// THE LINE NUMBER IS THE POINT. Each check records the line its `"id"` sits on, so a reader jumps
// straight to the object (`Read` with offset/limit, or `sed -n`) instead of scanning. That is the
// difference between ~257K and ~1K to answer "what does sast-go-gosec require".
//
// Two outputs, one pass, because the two audiences want different shapes:
//   manifests/<name>.map.json  — machine: byId / byGroup / byTool / byTrigger
//   docs/MANIFEST-MAP.md       — human: group tree, language-trigger table, tool table
//
// Both are GENERATED (docs tier 4): never hand-edit, re-run to refresh. Deterministic by
// construction — keys are sorted, nothing carries a timestamp INSIDE the data, so re-running on an
// unchanged manifest rewrites byte-identical content and the repo's determinism invariant holds.
// The generated-at line lives in the markdown header only, where it is prose rather than data.
//
// usage: node bin/manifest-map.mjs [name|path] [--check]
//        --check  exit 3 if either output is stale (for a gate), write nothing
//
// Zero runtime dependencies.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs'; // the one atomic writer

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// Resolve a manifest the same way the CLI does for its bundled names: a bare name means
// manifests/<name>.json, anything with a separator is a path taken as given.
export function resolveManifest(nameOrPath = 'security-baseline') {
  const raw = String(nameOrPath);
  const p = /[\\/]/.test(raw) ? resolve(process.cwd(), raw) : join(ROOT, 'manifests', `${raw}.json`);
  if (!existsSync(p)) throw new Error(`manifest not found: ${p}`);
  return p;
}

// Line of each check's `"id": "<value>"`, found in the RAW text rather than derived from the parse.
// A JSON.parse loses position entirely, and this index's whole value is position — so the id string
// is located literally, and a check whose id cannot be found is reported as line null rather than
// guessed at. Absence is stated, never approximated (grey stays grey).
export function idLines(text, ids) {
  const lines = text.split('\n');
  const want = new Map(ids.map((id) => [id, null]));
  for (let i = 0; i < lines.length; i++) {
    const m = /"id"\s*:\s*"([^"]+)"/.exec(lines[i]);
    if (!m) continue;
    // First occurrence wins: a nested object may repeat an id string, and the check's own
    // declaration is the earliest one in its block.
    if (want.has(m[1]) && want.get(m[1]) === null) want.set(m[1], i + 1);
  }
  return want;
}

const sortedObj = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));

export function buildMap(manifestPath) {
  const text = readFileSync(manifestPath, 'utf8');
  const m = JSON.parse(text);
  const checks = Array.isArray(m.checks) ? m.checks : [];
  const lineOf = idLines(text, checks.map((c) => c.id));

  const byId = {};
  const byGroup = {};
  const byTool = {};
  const byTrigger = {};

  // GROUP MEMBERSHIP IS THE UNION OF TWO DECLARATIONS, exactly as groupMembers() in
  // bin/commitwork.mjs resolves it: the top-level `groups` map lists ids, and each check may tag
  // itself in `groups`. Indexing only one of them would publish a membership the runner does not
  // agree with — the same drift that made three checks unreachable from every group (see the note
  // in bin/commitwork.mjs).
  const tagged = (id) => checks.find((c) => c.id === id)?.groups || [];
  for (const [group, ids] of Object.entries(m.groups || {})) {
    byGroup[group] = [...new Set([...(Array.isArray(ids) ? ids : [])])];
  }
  for (const c of checks) for (const g of tagged(c.id)) {
    (byGroup[g] ||= []);
    if (!byGroup[g].includes(c.id)) byGroup[g].push(c.id);
  }
  for (const g of Object.keys(byGroup)) byGroup[g].sort();

  for (const c of checks) {
    const tools = c.requires?.tools || [];
    const exists = c.appliesIfExists || [];
    const exts = c.appliesIfSourceExt || [];
    byId[c.id] = {
      line: lineOf.get(c.id) ?? null,
      description: c.description || null,
      groups: [...new Set([...Object.keys(byGroup).filter((g) => byGroup[g].includes(c.id))])].sort(),
      tools: [...tools].sort(),
      docker: !!c.requires?.docker,
      appliesIfExists: [...exists].sort(),
      appliesIfSourceExt: [...exts].sort(),
      appliesIfGit: !!c.appliesIfGit,
      requiresUrl: !!c.requiresUrl,
      report: c.report?.format || null,
      timeoutSec: typeof c.timeoutSec === 'number' ? c.timeoutSec : null,
      // A check with NO applies* gate runs everywhere, which is a different fact from "no gate
      // recorded" — say which, so a reader of the index never has to re-derive it from absence.
      universal: !exists.length && !exts.length,
    };
    for (const t of tools) (byTool[t] ||= []).push(c.id);
    for (const trig of [...exists, ...exts]) (byTrigger[trig] ||= []).push(c.id);
  }
  for (const k of Object.keys(byTool)) byTool[k] = [...new Set(byTool[k])].sort();
  for (const k of Object.keys(byTrigger)) byTrigger[k] = [...new Set(byTrigger[k])].sort();

  return {
    generatedBy: 'bin/manifest-map.mjs',
    manifest: basename(manifestPath).replace(/\.json$/, ''),
    manifestLines: text.split('\n').length,
    checkCount: checks.length,
    byId: sortedObj(byId),
    byGroup: sortedObj(byGroup),
    byTool: sortedObj(byTool),
    byTrigger: sortedObj(byTrigger),
  };
}

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(map, { at = new Date().toISOString() } = {}) {
  const L = [];
  L.push(`# Manifest map — \`${map.manifest}\``);
  L.push('');
  L.push(`<!-- Generated by bin/manifest-map.mjs — do not hand-edit; re-run to refresh. -->`);
  L.push(`Generated ${at} from \`manifests/${map.manifest}.json\` (${map.manifestLines} lines, `
    + `${map.checkCount} checks). Machine-readable twin: \`manifests/${map.manifest}.map.json\`.`);
  L.push('');
  L.push('**Read the manifest by line, not whole.** Every check below carries the line its `"id"`');
  L.push('sits on — jump there (`Read` offset/limit, or `sed -n \'<line>,+40p\'`) instead of opening');
  L.push('257K to answer one question.');
  L.push('');

  // ── group tree ────────────────────────────────────────────────────────────────
  L.push('## Groups → checks');
  L.push('');
  L.push('What `commitwork run <group>` actually runs. Membership is the UNION of the manifest\'s');
  L.push('top-level `groups` map and each check\'s own `groups` tag — the same union `groupMembers()`');
  L.push('resolves, so this table cannot disagree with the runner.');
  L.push('');
  for (const [group, ids] of Object.entries(map.byGroup)) {
    L.push(`- **\`${group}\`** (${ids.length})`);
    for (const id of ids) {
      const c = map.byId[id];
      const line = c?.line ?? '?';
      const gate = !c ? '' : c.universal ? ' · _universal_'
        : ` · ${[...c.appliesIfExists, ...c.appliesIfSourceExt].slice(0, 4).join(' ')}`;
      L.push(`  - \`${id}\` — L${line}${gate}`);
    }
  }
  L.push('');

  // ── language / trigger index ──────────────────────────────────────────────────
  L.push('## Triggers → checks');
  L.push('');
  L.push('Which checks a repo\'s own files switch on (`appliesIfExists` / `appliesIfSourceExt`).');
  L.push('This is the language axis: it answers "what will run against a Go repo" without a scan.');
  L.push('');
  L.push('| Trigger | Checks | Ids |');
  L.push('|---|---|---|');
  for (const [trig, ids] of Object.entries(map.byTrigger)) {
    L.push(`| \`${esc(trig)}\` | ${ids.length} | ${ids.map((i) => `\`${i}\``).join(', ')} |`);
  }
  L.push('');
  const universal = Object.entries(map.byId).filter(([, c]) => c.universal).map(([id]) => id);
  L.push(`**Universal (no file gate — runs on every repo): ${universal.length}** — `
    + `${universal.map((i) => `\`${i}\``).join(', ')}`);
  L.push('');

  // ── tool index ────────────────────────────────────────────────────────────────
  L.push('## Tools → checks');
  L.push('');
  L.push('Which `install-catalog.json` tool each check needs. A missing tool leaves its checks a');
  L.push('blocked void on every repo they match. This is also the "what does installing X buy me" table.');
  L.push('');
  L.push('| Tool | Checks | Ids |');
  L.push('|---|---|---|');
  for (const [tool, ids] of Object.entries(map.byTool)) {
    L.push(`| \`${esc(tool)}\` | ${ids.length} | ${ids.map((i) => `\`${i}\``).join(', ')} |`);
  }
  L.push('');

  // ── the flat per-check table ──────────────────────────────────────────────────
  L.push('## Every check');
  L.push('');
  L.push('| Line | Id | Tools | Gate | Report | Description |');
  L.push('|---|---|---|---|---|---|');
  for (const [id, c] of Object.entries(map.byId).sort((a, b) => (a[1].line ?? 0) - (b[1].line ?? 0))) {
    const gate = c.universal ? '_universal_'
      : esc([...c.appliesIfExists, ...c.appliesIfSourceExt].join(' '));
    const extra = [c.docker ? 'docker' : '', c.requiresUrl ? 'url' : ''].filter(Boolean).join('+');
    L.push(`| ${c.line ?? '?'} | \`${id}\` | ${esc(c.tools.join(' '))}${extra ? ` (+${extra})` : ''} `
      + `| ${gate} | ${esc(c.report || '')} | ${esc((c.description || '').slice(0, 90))} |`);
  }
  L.push('');
  return `${L.join('\n')}\n`;
}

// Compare ignoring the markdown's generated-at line, which is prose and moves every run: a
// timestamp difference is not staleness, and a --check that failed on one would cry wolf daily.
const stripAt = (s) => String(s).replace(/^Generated \d{4}-.*$/m, 'Generated <at>');

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const name = argv.find((a) => !a.startsWith('--')) || 'security-baseline';
  const manifestPath = resolveManifest(name);
  const map = buildMap(manifestPath);

  const jsonPath = join(ROOT, 'manifests', `${map.manifest}.map.json`);
  const mdPath = join(ROOT, 'docs', 'MANIFEST-MAP.md');
  const json = `${JSON.stringify(map, null, 2)}\n`;
  const md = renderMarkdown(map);

  if (checkOnly) {
    const stale = [];
    const cmp = (p, want, strip) => {
      const have = existsSync(p) ? readFileSync(p, 'utf8') : null;
      if (have === null) { stale.push(`${p} (absent)`); return; }
      if ((strip ? stripAt(have) : have) !== (strip ? stripAt(want) : want)) stale.push(p);
    };
    cmp(jsonPath, json, false);
    cmp(mdPath, md, true);
    if (stale.length) {
      console.error(`manifest-map: STALE — ${stale.join(', ')}`);
      console.error('manifest-map: re-run `node bin/manifest-map.mjs` and commit the result.');
      process.exit(3);
    }
    console.log(`manifest-map: current (${map.checkCount} checks)`);
    return;
  }

  mkdirSync(dirname(mdPath), { recursive: true });
  writeAtomic(jsonPath, json);
  writeAtomic(mdPath, md);
  console.log(`manifest-map: ${map.checkCount} checks · ${Object.keys(map.byGroup).length} groups · `
    + `${Object.keys(map.byTool).length} tools · ${Object.keys(map.byTrigger).length} triggers`);
  console.log(`  -> ${jsonPath}`);
  console.log(`  -> ${mdPath}`);
}

if (isMainModule(import.meta.url)) main();

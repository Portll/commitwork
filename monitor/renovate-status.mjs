#!/usr/bin/env node
/**
 * renovate-status — snapshot the Mend Renovate App state for the target repo into
 * reports/<area out>/renovate.json. Sources: gh api (Dependency Dashboard issue + renovate PRs;
 * server-side only — no token reaches client JS), plus the repo's renovate.json config fallback.
 * Every gh failure is recorded verbatim so the panel's empty state can name the failed command.
 *
 * usage:  node monitor/renovate-status.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeJSONAtomic } from '../cra/lib.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { findRepoPath } from './discover.mjs';
import { outDirFor } from './area.mjs'; // THE OUT resolver
import { loadRegistry } from './registry.mjs';

// The area this run describes: --area <slug>, else CW_AREA, else the registry's primary —
// declared, never inferred from the report dir
function argvArea() {
  const i = process.argv.indexOf('--area');
  return (i >= 0 ? process.argv[i + 1] : null) || process.env.CW_AREA || null;
}
function renovateFor(slug) {
  try {
    const reg = loadRegistry();
    const areas = reg.areas || [];
    const a = slug ? areas.find((x) => x.slug === slug) : (areas.find((x) => x.primary) || null);
    return a?.renovate || null;
  } catch { return null; }   // an unreadable registry is an undeclared area, not a licence to guess
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const OUT = join(outDirFor(null), 'renovate.json');
// Which repository this snapshot describes, from the area's own declaration. An area with no
// `renovate` block is a declared VOID — never substituted with another area's repo.
const AREA = argvArea();
const declared = renovateFor(AREA);
const REPO = process.env.CW_RENOVATE_REPO || declared?.repo || null;
const CONFIG_PATH = declared?.config
  ? findRepoPath(declared.config, process.env.CW_RENOVATE_CONFIG)
  : (process.env.CW_RENOVATE_CONFIG || null);

if (!REPO) {
  const where = AREA ? `area '${AREA}'` : 'the active area';
  writeJSONAtomic(OUT, {
    generated: new Date().toISOString(),
    area: AREA ?? null,
    repo: null,
    void: 'undeclared',
    reason: `${where} declares no \`renovate\` block in monitor/projects.json, so there is no repository whose Renovate state describes it. NOT substituted with another area's repo.`,
    dashboard: null, prs: null, errors: [],
  });
  console.log(`[renovate-status] ${where}: VOID — no renovate declaration; wrote the void to ${OUT} rather than another area's numbers`);
  process.exit(0);
}

// --!> is a legacy comment terminator browsers still honour; loop each pass to a fixed point so
// overlapping dashes cannot leave a '<!--'/'-->' pair exposed (CodeQL js/bad-tag-filter)
function stripComments(s) {
  let next;
  while ((next = s.replace(/<!--[\s\S]*?(?:-->|--!>)/g, '')) !== s) s = next;
  while ((next = s.replace(/<!--|-->|--!>/g, '')) !== s) s = next;
  return s;
}

const errors = [];
function gh(args) {
  const cmd = 'gh ' + args.join(' ');
  try { return execFileSync('gh', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { errors.push({ command: cmd, error: String((e.stderr || e.message || e)).trim().slice(0, 300) }); return null; }
}

// 1a — Dependency Dashboard issue (markdown checkboxes → structured items)
let dashboard = null;
const issuesRaw = gh(['issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,body,updatedAt']);
if (issuesRaw != null) {
  let issues = []; try { issues = JSON.parse(issuesRaw); } catch { errors.push({ command: 'gh issue list (parse)', error: 'unparseable JSON' }); }
  const dd = issues.find((i) => /dependency dashboard/i.test(i.title || ''));
  if (dd) {
    const items = []; let section = '';
    for (const line of String(dd.body || '').split('\n')) {
      const h = line.match(/^#{2,3}\s+(.+)/); if (h) { section = h[1].trim(); continue; }
      const m = line.match(/^\s*-\s*\[( |x)\]\s*(.+)/);
      // [\s\S] not . — multiline HTML comments must strip too; this prose lands in
      // renovate.json for the panel and must not carry a live tag to that sink
      if (m) items.push({ checked: m[1] === 'x', section, text: stripComments(m[2]).trim().slice(0, 200) });
    }
    dashboard = { found: true, issueNumber: dd.number, updatedAt: dd.updatedAt, items };
  } else dashboard = { found: false, openIssues: issues.length };
}

// 1b — Renovate PRs (open + recently closed/merged)
let prs = null;
const prsRaw = gh(['pr', 'list', '--repo', REPO, '--author', 'app/renovate', '--state', 'all', '--limit', '100',
  '--json', 'number,title,url,state,createdAt,mergedAt']);
if (prsRaw != null) {
  try { prs = JSON.parse(prsRaw); } catch { errors.push({ command: 'gh pr list (parse)', error: 'unparseable JSON' }); prs = null; }
}

// 2 — config fallback (groups / gated rules), always included
let config = null;
try {
  if (!CONFIG_PATH) throw new Error('no renovate config declared for this area');
  const c = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  config = {
    source: CONFIG_PATH,
    extends: c.extends || [],
    schedule: c.schedule || [],
    prConcurrentLimit: c.prConcurrentLimit ?? null,
    prHourlyLimit: c.prHourlyLimit ?? null,
    vulnerabilityAlerts: !!c.vulnerabilityAlerts,
    groups: (c.packageRules || []).filter((r) => r.groupName).map((r) => ({ group: r.groupName, description: r.description || '', matches: r.matchPackageNames || r.matchDepTypes || [] })),
    gated: (c.packageRules || []).filter((r) => r.enabled === false).map((r) => ({ description: r.description || '', matches: r.matchPackageNames || [] })),
  };
} catch (e) { errors.push({ command: `read ${CONFIG_PATH}`, error: String(e.message).slice(0, 200) }); }

const out = { generated: new Date().toISOString(), repo: REPO, dashboard, prs, config, errors };
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`[renovate-status] ${REPO}: dashboard=${dashboard ? (dashboard.found ? '#' + dashboard.issueNumber + ' (' + dashboard.items.length + ' items)' : 'not opened yet') : 'gh failed'} · prs=${prs ? prs.length : 'gh failed'} · errors=${errors.length} → ${OUT}`);

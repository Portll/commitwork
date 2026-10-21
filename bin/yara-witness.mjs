#!/usr/bin/env node
// usage: yara-witness.mjs [rootDir]   (default '.')
// exit: 0 ran, or wrote a void report saying why it could not · 2 the root is not a readable directory
// env, read at call time: CW_YR_BIN (the yara-x CLI, default `yr` on PATH), CW_YARA_THREADS (default 2),
//   CW_YARA_TIMEOUT_MS (default 900000), CW_YARA_SKIP_DIRS (same shape and default as
//   CW_WEBSHELL_SKIP_DIRS), plus bin/yara-rules.mjs's CW_YARA_RULE_PINS and CW_TOOLS_ROOT
// output: {tool, summary:{findings, byRule, filesScanned, matchedFiles, engine, ruleSets, divergence, ...}, findings[]}
//
// The second witness for bin/webshell-detect.mjs, held to the house rule that a guard needs one that
// cannot share its failure mode: hand-written regexes and community YARA rules fail in different
// places. YARA-X runs php-malware-finder and signature-base's web-shell rules over the same file
// set webshell-detect walks, and the report states where the two disagree, in BOTH directions,
// because a file only one of them flags is either the other's false negative or this one's false
// positive, and the report must not decide which.
//
// signature-base is DRL 1.1: every finding keeps the matching rule's author and the pack's URL.
// Classic YARA is not driven: it is maintenance-only, cannot take a rules directory, and prints text
// that would have to be parsed; yara-x is in homebrew-core and in the install catalogue.
import { readdirSync, lstatSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';
import { loadPins, verifyStore } from './yara-rules.mjs';
import { scanTree as webshellScan } from './webshell-detect.mjs';

export const TOOL = 'yara-witness';
const DEFAULT_SKIP = ['.git', 'node_modules', '.claude/worktrees', 'fixtures/scan-canary/dirty'];
const SAMPLE = 20;
// webshell-detect's placement rules (a double extension, a lock file, a prepend directive) describe
// where a file sits, which no YARA rule reads; only its content rules are comparable.
const CONTENT_RULES = new Set(['encoded-server-payload', 'webshell-eval-decoder', 'webshell-request-exec', 'webshell-banner',
  'decoded-code-writer', 'silenced-unbounded', 'server-code-in-media-file']);

export const skipDirs = () => {
  const raw = process.env.CW_YARA_SKIP_DIRS;
  return raw == null ? DEFAULT_SKIP : raw.split(',').map((s) => s.trim()).filter(Boolean);
};
const threads = () => { const n = Number(process.env.CW_YARA_THREADS); return Number.isInteger(n) && n > 0 ? n : 2; };
const timeoutMs = () => { const n = Number(process.env.CW_YARA_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 900000; };
const yrBin = () => process.env.CW_YR_BIN || 'yr';

export function listFiles(root) {
  const skip = new Set(skipDirs());
  const files = [];
  const skipped = [];
  const unreadable = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { unreadable.push({ path: relative(root, dir) || '.', why: e.code || e.message }); return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split('\\').join('/');
      let st;
      try { st = lstatSync(abs); } catch (err) { unreadable.push({ path: rel, why: err.code || err.message }); continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (skip.has(e.name) || skip.has(rel)) skipped.push(rel); else walk(abs); continue; }
      if (st.isFile()) files.push(abs);
    }
  };
  walk(root);
  return { files, skipped, unreadable };
}

export const metaOf = (meta) => Object.fromEntries((Array.isArray(meta) ? meta : []).filter((m) => Array.isArray(m) && typeof m[0] === 'string').map(([k, v]) => [k, v]));

// '' is undetermined: a pack whose matches were measured to be noise declares defaultSev "" and its
// matches leave the severity buckets for summary.undetermined, with the claim kept.
export function sevFor(set, meta) {
  const score = Number(meta.score);
  if (Number.isFinite(score)) return score >= 80 ? 'high' : score >= 60 ? 'med' : 'low';
  return set.defaultSev ?? 'med';
}

// Lines that are not JSON (a warning yara-x printed to stdout) are counted, never skipped silently.
export function parseNdjson(text) {
  const records = [];
  let unparsed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j && typeof j.path === 'string' && Array.isArray(j.rules)) records.push(j); else unparsed++; } catch { unparsed++; }
  }
  return { records, unparsed };
}

function voidReport(summary, why) {
  return { tool: TOOL, summary: { ...summary, findings: 0, byRule: {}, filesScanned: 0, voidReason: why }, findings: [] };
}

export function scanTree(root) {
  const base = { findings: 0, byRule: {}, filesScanned: 0, matchedFiles: 0, engine: null, ruleSets: [], threads: threads() };
  const ver = spawnSync(yrBin(), ['--version'], { encoding: 'utf8' });
  if (ver.error || ver.status !== 0) {
    return voidReport(base, `yara-x is not installed (${yrBin()}: ${ver.error ? ver.error.code : `exit ${ver.status}`}) — the second witness is NOT measured, which is not a pass; install it with commitwork setup (brew install yara-x)`);
  }
  base.engine = { tool: 'yara-x', version: ver.stdout.trim().replace(/^yara-x-cli\s+/, '') };
  let store;
  try { store = verifyStore(loadPins()); } catch (e) { return voidReport(base, `the rule-pack pins could not be read: ${e.message}`); }
  base.ruleSets = store.sets.map((s) => ({ name: s.name, commit: s.commit, license: s.license, url: s.url }));
  if (!store.ok) return voidReport(base, `rule packs not installed or not matching their pins (${store.problems.slice(0, 3).join('; ')}) — run node bin/yara-rules.mjs --install`);

  const { files, skipped, unreadable } = listFiles(root);
  if (!files.length) return voidReport({ ...base, skippedPaths: skipped }, 'no file in the tree, so nothing was examined; an empty tree is a void, not a clean result');

  const work = mkdtempSync(join(tmpdir(), 'cw-yara-'));
  let out;
  try {
    const list = join(work, 'scan-list.txt');
    writeFileSync(list, `${files.join('\n')}\n`);
    const args = ['scan', '--output-format', 'ndjson', '-m', '-e', '-w', '--scan-list', '-p', String(threads())];
    // global in yara-x, and the stricter parse rejects php-malware-finder's regexes outright
    if (store.sets.some((s) => s.relaxedRegex)) args.push('--relaxed-re-syntax');
    for (const s of store.sets) args.push('--include-dir', s.dir);
    for (const s of store.sets) args.push(`${s.name.replace(/[^A-Za-z0-9_]/g, '_')}:${s.entry ? join(s.dir, s.entry) : s.dir}`);
    args.push(list);
    out = spawnSync(yrBin(), args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: timeoutMs() });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (out.error) return voidReport({ ...base, skippedPaths: skipped }, `yara-x did not finish (${out.error.code || out.error.message})`);
  const { records, unparsed } = parseNdjson(out.stdout || '');
  if (out.status !== 0 && !records.length) {
    const err = String(out.stderr || '').trim().split('\n').find((l) => /error/i.test(l)) || `exit ${out.status}`;
    return voidReport({ ...base, skippedPaths: skipped }, `yara-x failed before reporting anything: ${err.slice(0, 200)}`);
  }

  const bySetName = new Map(store.sets.map((s) => [s.name.replace(/[^A-Za-z0-9_]/g, '_'), s]));
  const findings = [];
  const undetermined = [];
  const matched = new Set();
  for (const rec of records) {
    const abs = isAbsolute(rec.path) ? rec.path : resolve(root, rec.path);
    const path = relative(root, abs).split('\\').join('/');
    for (const r of rec.rules) {
      const set = bySetName.get(r.namespace) || { name: r.namespace, url: '', license: '', defaultSev: 'med' };
      const meta = metaOf(r.meta);
      const author = typeof meta.author === 'string' ? meta.author : '';
      const row = { rule: `${set.name}:${r.identifier}`, path, sev: sevFor(set, meta), cwe: 'CWE-506',
        detail: `${set.name} rule ${r.identifier}${author ? ` by ${author}` : ''} — ${set.license} ${set.url}`.trim() };
      if (!row.sev) { undetermined.push({ ...row, reason: set.undeterminedReason || '' }); continue; }
      matched.add(path);
      findings.push(row);
    }
  }
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));

  const detected = new Set(webshellScan(root).findings.filter((f) => CONTENT_RULES.has(f.rule)).map((f) => f.path));
  const yaraOnly = [...matched].filter((p) => !detected.has(p)).sort();
  const detectOnly = [...detected].filter((p) => !matched.has(p)).sort();

  const summary = {
    ...base, findings: findings.length, byRule: {}, filesScanned: files.length, matchedFiles: matched.size,
    divergence: {
      both: [...matched].filter((p) => detected.has(p)).length,
      yaraOnly: { count: yaraOnly.length, sample: yaraOnly.slice(0, SAMPLE) },
      detectOnly: { count: detectOnly.length, sample: detectOnly.slice(0, SAMPLE) },
      note: 'a file only one witness flags is the other\'s false negative or this one\'s false positive; neither is decided here',
    },
    skippedPaths: skipped, unreadable: unreadable.length, unreadableFiles: unreadable.slice(0, 50),
  };
  if (undetermined.length) {
    const byRule = {};
    for (const u of undetermined) byRule[u.rule] = (byRule[u.rule] || 0) + 1;
    summary.undetermined = {
      count: undetermined.length, files: new Set(undetermined.map((u) => u.path)).size,
      byRule: Object.fromEntries(Object.entries(byRule).sort(([a], [b]) => (a < b ? -1 : 1))),
      reasons: [...new Set(undetermined.map((u) => u.reason).filter(Boolean))],
      sample: undetermined.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : 1)).slice(0, SAMPLE).map((u) => ({ rule: u.rule, path: u.path, detail: u.detail })),
    };
  }
  for (const f of findings) summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1;
  summary.byRule = Object.fromEntries(Object.entries(summary.byRule).sort(([a], [b]) => (a < b ? -1 : 1)));
  const errs = String(out.stderr || '').split('\n').filter((l) => /^error/i.test(l.trim())).length;
  if (unreadable.length || unparsed || errs) {
    summary.partial = true;
    summary.partialReasons = [unreadable.length && `${unreadable.length} path(s) unreadable`, unparsed && `${unparsed} output line(s) not parsed`,
      errs && `${errs} yara-x error line(s)`].filter(Boolean);
  }
  return { tool: TOOL, summary, findings };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`yara-witness: cannot read ${root}: ${e.code || e.message}\n`); process.exit(2); }
  if (!st.isDirectory()) { process.stderr.write(`yara-witness: ${root} is not a directory\n`); process.exit(2); }
  let report;
  try { report = scanTree(root); } catch (e) { process.stderr.write(`yara-witness: could not run: ${e.message}\n`); process.exit(2); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

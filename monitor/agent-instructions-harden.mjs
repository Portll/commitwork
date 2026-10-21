#!/usr/bin/env node
// usage: agent-instructions-harden.mjs [repoDir] [--json]
// env, read at call time: CW_AGENT_INSTR_MAX_BYTES, CW_SCAN_EXCLUDE_DIRS
// exit: 0 a diff was emitted · 2 no instruction files · 3 nothing to change (refused)
// writes: a unified diff to stdout and NOTHING to the target tree — no write, no push, no fork, no PR
//
// fact: a hardener that changes nothing refuses, so an empty diff cannot be applied as evidence of a repair (expiry: never, prev: not built)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { dirExcluder } from '../bin/scan-exclusions.mjs';
import { HIDDEN_TEXT } from '../bin/minify-detect.mjs';
import { isInstructionFile } from '../bin/agent-instructions.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HIDDEN_ALL = new RegExp(HIDDEN_TEXT.source, 'gu');
const maxBytes = () => {
  const n = Number(process.env.CW_AGENT_INSTR_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
};

/** Pure: remove every hidden character minify-detect's HIDDEN_TEXT names. A leading BOM stays. */
export function stripHidden(text) {
  const bom = text.startsWith('\ufeff') ? '\ufeff' : '';
  const removed = new Map();
  const body = text.slice(bom.length).replace(HIDDEN_ALL, (ch) => {
    const cp = ch.codePointAt(0);
    removed.set(cp, (removed.get(cp) || 0) + 1);
    return '';
  });
  const out = {};
  for (const [cp, n] of [...removed.entries()].sort((a, b) => a[0] - b[0])) out[`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`] = n;
  return { text: bom + body, removed: out, count: [...removed.values()].reduce((a, b) => a + b, 0) };
}

const splitLines = (t) => { const eol = t.endsWith('\n'); const a = t.split('\n'); if (eol) a.pop(); return { lines: a, eol }; };

// line-for-line: stripping never adds or removes a newline, so old and new ranges coincide
export function unifiedDiff(rel, before, after) {
  const a = splitLines(before), b = splitLines(after);
  if (a.lines.length !== b.lines.length) throw new Error(`${rel}: line count changed (${a.lines.length} -> ${b.lines.length}); this diff builder only handles in-line edits`);
  const n = a.lines.length;
  const changed = [];
  for (let i = 0; i < n; i++) if (a.lines[i] !== b.lines[i]) changed.push(i);
  if (!changed.length) return '';
  const CTX = 3;
  const hunks = [];
  for (const i of changed) {
    const last = hunks[hunks.length - 1];
    if (last && i - last.end <= 2 * CTX) { last.end = i; last.changed.push(i); }
    else hunks.push({ start: i, end: i, changed: [i] });
  }
  const out = [`diff --git a/${rel} b/${rel}`, `--- a/${rel}`, `+++ b/${rel}`];
  const noEol = (idx) => (!a.eol && idx === n - 1 ? ['\\ No newline at end of file'] : []);
  for (const h of hunks) {
    const from = Math.max(0, h.start - CTX), to = Math.min(n - 1, h.end + CTX);
    out.push(`@@ -${from + 1},${to - from + 1} +${from + 1},${to - from + 1} @@`);
    const set = new Set(h.changed);
    let i = from;
    while (i <= to) {
      if (!set.has(i)) { out.push(` ${a.lines[i]}`, ...noEol(i)); i++; continue; }
      let j = i; while (j <= to && set.has(j)) j++;
      for (let k = i; k < j; k++) out.push(`-${a.lines[k]}`, ...noEol(k));
      for (let k = i; k < j; k++) out.push(`+${b.lines[k]}`, ...(!b.eol && k === n - 1 ? ['\\ No newline at end of file'] : []));
      i = j;
    }
  }
  return `${out.join('\n')}\n`;
}

/** Declare-only: read every instruction file, strip, and return the diff. Never writes the tree. */
export function hardenAgentInstructions({ repoDir = '.' } = {}) {
  const root = resolve(repoDir);
  const skipDir = dirExcluder();
  const cap = maxBytes();
  const files = [];
  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      const p = join(dir, name);
      if (skipDir(relative(root, p))) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      const rel = relative(root, p).split('\\').join('/');
      if (isInstructionFile(rel) && st.size <= cap) files.push(rel);
    }
  };
  walk(root);
  if (!files.length) return { ok: false, code: 2, reason: `no instruction files under ${root} — nothing to harden`, files };
  const changed = [];
  const diffs = [];
  for (const rel of files) {
    let orig; try { orig = readFileSync(join(root, rel), 'utf8'); } catch (e) { changed.push({ file: rel, skipped: e.code || 'unreadable' }); continue; }
    const s = stripHidden(orig);
    if (!s.count) continue;
    changed.push({ file: rel, removed: s.removed, count: s.count });
    diffs.push(unifiedDiff(rel, orig, s.text));
  }
  if (!diffs.length) return { ok: false, code: 3, reason: `nothing to change — ${files.length} instruction file(s) carry no hidden character`, files };
  return { ok: true, code: 0, files, changed, diff: diffs.join(''),
    note: 'DRY RUN by construction — nothing was written; apply the diff with `git apply` after a human has read it' };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = hardenAgentInstructions({ repoDir: args.find((a) => !a.startsWith('--')) || '.' });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else if (out.ok) process.stdout.write(out.diff);
  process.stderr.write(out.ok
    ? `agent-instructions-harden: ${out.changed.length} of ${out.files.length} file(s) would change (dry run, nothing written)\n`
    : `agent-instructions-harden: REFUSED — ${out.reason}\n`);
  process.exit(out.code);
}

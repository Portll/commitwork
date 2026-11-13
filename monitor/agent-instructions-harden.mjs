#!/usr/bin/env node
// usage: agent-instructions-harden.mjs [repoDir] [--json]
// env, read at call time: CW_AGENT_INSTR_MAX_BYTES, CW_SCAN_EXCLUDE_DIRS
// exit: 0 a diff was emitted · 2 no instruction files · 3 nothing to change (refused)
// writes: a unified diff to stdout and NOTHING to the target tree — no write, no push, no fork, no PR
//
// fact: a hardener that changes nothing refuses, so an empty diff cannot be applied as evidence of a repair (expiry: never, prev: not built)
import { readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { linkPolicy } from '../bin/lib/walk-links.mjs';
import { dirExcluder } from '../bin/scan-exclusions.mjs';
import { HIDDEN_TEXT } from '../bin/minify-detect.mjs';
import { isInstructionFile } from '../bin/agent-instructions.mjs';
import { unifiedDiff as sharedUnifiedDiff } from '../lib/unified-diff.mjs';
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
  return sharedUnifiedDiff(rel, before, after);
}

/** Declare-only: read every instruction file, strip, and return the diff. Never writes the tree. */
export function hardenAgentInstructions({ repoDir = '.' } = {}) {
  const root = resolve(repoDir);
  const skipDir = dirExcluder();
  const cap = maxBytes();
  const files = [];
  const links = linkPolicy(root);
  const linksNotFollowed = [];
  const visit = (p, st) => {
    const rel = relative(root, p).split('\\').join('/');
    if (st.isSymbolicLink()) {
      const reason = links.link(p);
      if (reason) linksNotFollowed.push({ path: rel, reason });
      return;
    }
    if (st.isDirectory()) { walk(p); return; }
    if (isInstructionFile(rel) && st.size <= cap && links.first(p)) files.push(rel);
  };
  const walk = (dir) => {
    if (!links.first(dir)) return;
    let entries; try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      const p = join(dir, name);
      if (skipDir(relative(root, p))) continue;
      let st; try { st = lstatSync(p); } catch { continue; }
      visit(p, st);
    }
  };
  walk(root);
  for (const { path: p, target } of links.drain()) {
    if (skipDir(target)) continue;
    let st; try { st = statSync(p); } catch { continue; }
    visit(p, st);
  }
  const linkNote = linksNotFollowed.length ? { linksNotFollowed } : {};
  if (!files.length) return { ok: false, code: 2, reason: `no instruction files under ${root} — nothing to harden`, files, ...linkNote };
  const changed = [];
  const diffs = [];
  for (const rel of files) {
    let orig; try { orig = readFileSync(join(root, rel), 'utf8'); } catch (e) { changed.push({ file: rel, skipped: e.code || 'unreadable' }); continue; }
    const s = stripHidden(orig);
    if (!s.count) continue;
    changed.push({ file: rel, removed: s.removed, count: s.count });
    diffs.push(unifiedDiff(rel, orig, s.text));
  }
  if (!diffs.length) return { ok: false, code: 3, reason: `nothing to change — ${files.length} instruction file(s) carry no hidden character`, files, ...linkNote };
  return { ok: true, code: 0, files, changed, diff: diffs.join(''), ...linkNote,
    note: 'DRY RUN by construction — nothing was written; apply the diff with `git apply` after a human has read it' };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = hardenAgentInstructions({ repoDir: args.find((a) => !a.startsWith('--')) || '.' });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else if (out.ok) process.stdout.write(out.diff);
  for (const { path, reason } of out.linksNotFollowed || []) process.stderr.write(`agent-instructions-harden: warning: ${path} (${reason}) not followed\n`);
  process.stderr.write(out.ok
    ? `agent-instructions-harden: ${out.changed.length} of ${out.files.length} file(s) would change (dry run, nothing written)\n`
    : `agent-instructions-harden: REFUSED — ${out.reason}\n`);
  process.exit(out.code);
}

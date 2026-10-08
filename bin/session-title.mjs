#!/usr/bin/env node
// Resolve a Claude Code session id to the TITLE the client shows for it.
//
// usage:  node bin/session-title.mjs            list every session for this repo
//         node bin/session-title.mjs 3eb08cb8   resolve one (full uuid or short prefix)
//
// custom-title beats ai-title; the LAST of each kind wins (titles are refined over a session).
// Only the title is read out of the transcript — nothing else leaves the file.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { transcriptDir } from './lib/transcript-dir.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export { transcriptDir };

/** { id, title, source, mtime } for every session, newest first; untitled is `title: null`, never a guess. */
export function sessions(cwd = REPO) {
  let dir = transcriptDir(cwd);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    let custom = null, ai = null, mtime = 0;
    try { mtime = statSync(join(dir, f)).mtimeMs; } catch { /* keep 0 */ }
    try {
      // Titles are small and rare; scanning the whole file is fine and avoids assuming position.
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line || (!line.includes('"custom-title"') && !line.includes('"ai-title"'))) continue;
        try {
          const j = JSON.parse(line);
          if (j.type === 'custom-title' && j.customTitle) custom = j.customTitle;   // last wins
          else if (j.type === 'ai-title' && j.aiTitle) ai = j.aiTitle;
        } catch { /* a partial line at the tail of a live session is normal */ }
      }
    } catch { /* unreadable transcript: still list the id, with no title */ }
    out.push({ id, short: id.slice(0, 8), title: custom || ai || null, source: custom ? 'custom' : (ai ? 'ai' : null), mtime });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Title for one id (full or 8-char prefix), or null. */
export function titleFor(id, cwd = REPO) {
  if (!id) return null;
  const want = String(id);
  const s = sessions(cwd).find((x) => x.id === want || x.short === want.slice(0, 8));
  return s ? s.title : null;
}

/** "8b2c1f3a (\"R2 CRA build\")" — for a report line. Falls back to the bare id, never to a guess. */
export function labelFor(id, cwd = REPO) {
  const t = titleFor(id, cwd);
  return t ? `${String(id).slice(0, 8)} ("${t}")` : String(id).slice(0, 8);
}

if (isMainModule(import.meta.url)) {
  const arg = process.argv[2];
  if (arg) { const t = titleFor(arg); process.stdout.write(`${t ?? '(no title recorded)'}\n`); process.exit(t ? 0 : 1); }
  const all = sessions();
  if (!all.length) { process.stderr.write(`no transcripts under ${transcriptDir()}\n`); process.exit(1); }
  for (const s of all) {
    const age = s.mtime ? `${Math.round((Date.now() - s.mtime) / 60000)}m ago` : '?';
    process.stdout.write(`${s.short}  ${String(age).padStart(9)}  ${s.source ? `[${s.source}]` : '[none]  '}  ${s.title ?? '(untitled)'}\n`);
  }
}

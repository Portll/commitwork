// Locate a session's recorded edits in the CURRENT text of a file, by fingerprint — registry WP1
// (a), classes P3 and P12.
//
// The touch ledger records, per Edit, `n` = sha256(new_string)[0:12] and never the text. The
// attribution module's header says a hash cannot be searched for in a file, and taken literally
// that is true; but an Edit's new_string is a CONTIGUOUS run of the file's lines, so it can be
// found by hashing candidate line-windows and comparing. The search is bounded to windows that
// overlap a diff hunk (an edit that is not in the diff is not staging-relevant) and padded by a
// few lines so an Edit that carried context still matches.
//
// THREE STATES PER HUNK, never a confident wrong owner: `mine` (a standing fingerprint of THIS
// session covers it and no other session's does), `theirs` (only other sessions' do), `shared`
// (both), `unmatched` (nothing located it — an edit that started mid-line, a shell write, a peer
// that edits through a path the ledger cannot see). `unmatched` is not "theirs" and not "mine";
// stage-mine leaves it in the working tree and says so.
import { createHash } from 'node:crypto';

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Parse `git diff -U<n> -- <one file>` into hunks. Lines keep their leading ' ', '+', '-'. */
export function parseHunks(diffText) {
  const hunks = [];
  let cur = null;
  for (const line of String(diffText || '').split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      cur = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('\\ No newline')) { cur.noNewline = true; continue; }
    if (/^[ +-]/.test(line)) cur.lines.push(line);
  }
  // The NEW-side range each hunk's changed lines occupy, ignoring pure-context leaders/trailers.
  for (const h of hunks) {
    let n = h.newStart;
    let first = null; let last = null;
    for (const l of h.lines) {
      if (l[0] === '+') { if (first === null) first = n; last = n; n++; }
      else if (l[0] === ' ') n++;
      else if (l[0] === '-') { if (first === null) first = n; last = Math.max(last ?? n - 1, n - 1); }
    }
    h.changedNew = first === null ? [h.newStart, h.newStart - 1] : [first, Math.max(first, last)];
  }
  return hunks;
}

/**
 * Find each claim's `n` fingerprint in `text` as a contiguous line window near a hunk.
 * @param text     current file content
 * @param hunks    from parseHunks
 * @param claims   [{ n, s, t }] — standing fingerprints with their session
 * @param pad      lines of slack either side of a hunk's changed range
 * @param maxWindows hard cap on hashes per file; exceeding it yields `searched:false`
 * @returns { located: [{ n, s, range:[a,b] }], searched: boolean, windows: number }
 */
export function locate(text, hunks, claims, { pad = 12, maxWindows = 250_000 } = {}) {
  const lines = String(text).split('\n');
  const L = lines.length;
  const want = new Map();
  for (const c of claims) if (c && c.n) want.set(c.n, c);
  const located = [];
  if (!want.size) return { located, searched: true, windows: 0 };
  // A Write tool records the WHOLE content: one candidate, the file itself, both with and without
  // its trailing newline.
  for (const cand of [String(text), String(text).replace(/\n$/, '')]) {
    const c = want.get(fp(cand));
    if (c) { located.push({ n: c.n, s: c.s, range: [1, L], whole: true }); want.delete(c.n); }
  }
  let windows = 0;
  const seen = new Set();
  for (const h of hunks) {
    const [cs, ce] = h.changedNew;
    const a0 = Math.max(1, cs - pad); const b1 = Math.min(L, ce + pad);
    for (let a = a0; a <= Math.max(cs, a0); a++) {
      for (let b = Math.max(a, ce); b <= b1; b++) {
        const key = `${a}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (++windows > maxWindows) return { located, searched: false, windows };
        const body = lines.slice(a - 1, b).join('\n');
        for (const cand of [body, `${body}\n`]) {
          const c = want.get(fp(cand));
          if (c) { located.push({ n: c.n, s: c.s, range: [a, b] }); want.delete(c.n); }
        }
        if (!want.size) return { located, searched: true, windows };
      }
    }
  }
  return { located, searched: true, windows };
}

/** Assign each hunk to mine | theirs | shared | unmatched from located ranges. */
export function assign(hunks, located, me) {
  const overlaps = (r, [cs, ce]) => r[0] <= ce && r[1] >= cs;
  return hunks.map((h) => {
    const covering = located.filter((l) => overlaps(l.range, h.changedNew));
    const sessions = new Set(covering.map((l) => l.s).filter(Boolean));
    const mine = sessions.has(me);
    const others = [...sessions].filter((s) => s !== me);
    const state = !sessions.size ? 'unmatched' : mine && others.length ? 'shared' : mine ? 'mine' : 'theirs';
    return { hunk: h, state, sessions: [...sessions], others };
  });
}

/**
 * Apply a subset of hunks to the OLD text (HEAD's content) and return the new text. Hunks carry
 * their own old-side coordinates against that same base, so applying them in order needs no
 * offset arithmetic beyond tracking how much the output has grown.
 */
export function applyHunks(oldText, hunks) {
  const old = String(oldText).split('\n');
  const out = [];
  let cursor = 1; // 1-based line in old
  for (const h of [...hunks].sort((a, b) => a.oldStart - b.oldStart)) {
    const start = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
    while (cursor < start) out.push(old[cursor - 1]), cursor++;
    for (const l of h.lines) {
      if (l[0] === ' ') { out.push(old[cursor - 1]); cursor++; }
      else if (l[0] === '-') cursor++;
      else if (l[0] === '+') out.push(l.slice(1));
    }
  }
  while (cursor <= old.length) out.push(old[cursor - 1]), cursor++;
  return out.join('\n');
}

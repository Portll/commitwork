#!/usr/bin/env node
// usage: comment-suggest.mjs [--json] [--file <rel>]
// exit: 0 always — this proposes, it never decides
//
// fact: suggestions are drafts for a human, never auto-applied / the counterfactual test is a judgement and a wrong deletion loses knowledge with no test to catch it (expiry: never, prev: not built)
// fact: id is path#ordinal, never a line / a line drifts the moment anything above it changes (expiry: never, prev: wrong)
// fact: `before` is carried so accept can refuse a block that moved under it (expiry: never, prev: not built)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { commentLines, runs, MAX_RUN, classify, strip } from './comment-schema.mjs';
import { secondPass } from './comment-second-pass.mjs';

// The gate needs this vocabulary too, so it lives in comment-schema.mjs and is re-exported here for
// the callers that already had it. Two copies of REFERENCE would drift the moment one was tuned.
export { classify };

// fact: these markers are where a counterfactual hides / "because/so/rather than/would" is the sentence saying why NOT the obvious thing (expiry: on a better heuristic, prev: not built)
const CAUSAL = /\b(because|so that|so it|rather than|instead of|otherwise|would have|would be|would 404|which is why|the reason|never|refus|silently|fails? closed|defeat|drift)/i;

// fact: a line that only names the file or restates a signature earns nothing (expiry: never, prev: unknown)
const RESTATES = /^(usage|env|exit|returns?|param|@\w+|[a-z-]+\.mjs\b|[A-Z][a-z]+\.mjs\b)/i;

// fact: a `── heading ──` line is a heading, never a sentence and never a reason to void the block (expiry: never, prev: broken)
export const BANNER = /^[─━═]{2,}.*[─━═]{4,}$/;
const PRONOUN = /^(It|Its|This|That|These|Those|Here|There|Such|They|Their)\b/;

/** A block of existing fact entries is already atomic: one entry per fact, each ending at its trailer. */
export function asFacts(block) {
  const lines = block.map(strip).filter(Boolean);
  if (lines.filter((l) => /^fact:/.test(l)).length < 2 || !/^fact:/.test(lines[0])) return null;
  const entries = [];
  let open = false;
  for (const l of lines) {
    if (/^fact:/.test(l)) { entries.push(l.replace(/^fact:\s*/, '')); open = true; } else if (open) entries[entries.length - 1] += ` ${l}`; else entries.push(l);
    if (/\(expiry:[^)]*\)\s*$/.test(entries[entries.length - 1])) open = false;
  }
  return entries;
}

/** Split a block into sentences, keeping only the ones that carry a counterfactual. */
export function keepers(block) {
  const facts = asFacts(block);
  if (facts) return { sentences: facts, keptAt: facts.map((_, k) => k), kept: facts, dropped: [], facts: true };
  const prose = block.map(strip).filter(Boolean).filter((l) => !RESTATES.test(l) && !BANNER.test(l)).join(' ');
  // fact: a full stop before a lowercase identifier ends a sentence too, and a semicolon never does / "…broke. persistSessions is counted" glued two claims, and splitting at ";" left seven held-out lines as fragments (expiry: never, prev: broken)
  const sentences = prose.split(/(?<=[.:;])\s+(?=[A-Z`])|(?<=[a-z0-9)`'"]\.)\s+(?!(?:e\.g|i\.e|vs|etc|cf)\b)(?=[a-z][\w-]*(?:[A-Z_]|\s—|\s[a-z]+\s))/)
    .map((s) => s.trim()).filter(Boolean);
  const causal = new Set(sentences.flatMap((s, k) => (CAUSAL.test(s) ? [k] : [])));
  // fact: a kept sentence that opens with a pronoun keeps the sentence it points at / without it the second pass can only drop the claim, which emptied four of fifty sampled blocks (expiry: never, prev: broken)
  const keptAt = [...new Set([...causal].flatMap((k) => (k > 0 && PRONOUN.test(sentences[k]) ? [k - 1, k] : [k])))].sort((a, b) => a - b);
  const keptSet = new Set(keptAt);
  return { sentences, keptAt, kept: keptAt.map((k) => sentences[k]), dropped: sentences.filter((_, k) => !keptSet.has(k)) };
}

// fact: a list or mapping block is not collapsible without reordering or dropping items / the sentence splitter orphans list ordinals ("refused. 3") and the draft reads as corrupt (expiry: on a splitter that keeps structure, prev: broken)
const LIST = /^(\d+[.)]\s|[·•]\s?|\*\s|[-–—]\s|.{0,40}?\s→\s)/;
// fact: an enumeration of quoted states, markup, `term — definition` rows, arrow tables and command lines are structure too / drafted as prose they were glued into lines of up to 600 characters (expiry: never, prev: broken)
const SHAPED = [/'[\w-]+'\s*\|\s*'/, /^<\/?[a-z][\w-]*[\s>/]/, /^[A-Za-z_][\w-]*\s+—\s/, /^[^()]*\s->\s/, /^(?:node|npm|git)\s/, /^[a-z][\w-]*\s{3,}\S/];
export function structured(block) {
  const lines = block.map((l) => strip(l)).filter((l) => l && !BANNER.test(l));
  if (lines.filter((l) => LIST.test(l)).length >= 2) return true;
  return lines.some((l) => SHAPED[0].test(l)) || SHAPED.slice(1).some((re) => lines.filter((l) => re.test(l)).length >= 2);
}

/** One suggested replacement for one over-long block — or a VOID when a heuristic cannot collapse it. */
export function draft(block, indent) {
  const { sentences, keptAt, kept, dropped, facts } = keepers(block);
  // fact: a block a heuristic cannot collapse without loss is a VOID, not a one-line draft / a <placeholder> or a gutted line counted as `saved` deletes knowledge and reports it as a fix (expiry: on a suggester trustable unattended, prev: broken)
  if (!facts && (structured(block) || kept.length === 0)) {
    const reason = structured(block)
      ? 'a list or mapping block — collapsing it would reorder or drop items'
      : 'no sentence here carries a counterfactual — the claim must be stated by hand';
    return { lines: [], sentences, used: [], keptCount: kept.length, droppedCount: sentences.length, dropped: sentences, void: true, reason };
  }
  const pad = ' '.repeat(indent);
  const lines = kept.slice(0, MAX_RUN).map((s) => {
    const claim = s.replace(/\s+/g, ' ').replace(/^[-—·]\s*/, '').replace(/[.]$/, '');
    return `${pad}// fact: ${claim}`;
  });
  return { lines, sentences, used: keptAt.slice(0, MAX_RUN), keptCount: kept.length, droppedCount: dropped.length, dropped, void: false, reason: '' };
}

/** Each sentence's [first-pass, second-pass] fate. A void has no draft, so no fate. */
export function fates(d, second) {
  const rank = new Map(d.used.map((k, n) => [k, n]));
  return d.sentences.map((_, k) => (d.void ? [null, null]
    : rank.has(k) ? ['kept', second.fate[rank.get(k)]] : ['dropped', 'dropped']));
}

export function tally(fate) {
  const count = (n) => fate.reduce((acc, f) => (f[n] ? { ...acc, [f[n]]: (acc[f[n]] || 0) + 1 } : acc), {});
  return { f1: count(0), f2: count(1) };
}

/** The original block, line by line, cut at sentence boundaries, each piece carrying its fates. */
export function annotate(raw, block, d, fate) {
  const fateOf = (k) => fate[k];
  const texts = block.map((l) => strip(l ?? ''));
  const inProse = texts.map((t) => !!t && !RESTATES.test(t) && !BANNER.test(t));
  let prose = '';
  const at = texts.map((t, li) => {
    if (!inProse[li]) return -1;
    if (prose) prose += ' ';
    prose += t;
    return prose.length - t.length;
  });
  let cursor = 0;
  const spans = d.sentences.map((s) => {
    const a = prose.indexOf(s, cursor);
    cursor = a < 0 ? cursor : a + s.length;
    return [a, a + s.length];
  });
  return raw.map((line, li) => {
    const mark = (/^\s*(\/\/+|\/\*+|\*\/|\*)/.exec(line) || ['', ''])[1];
    const t = texts[li];
    if (at[li] < 0) {
      const [f1, f2] = d.void ? [null, null] : ['dropped', 'dropped'];
      return { mark, segs: t ? [{ t, f1, f2 }] : [] };
    }
    const lo = at[li], hi = lo + t.length;
    const segs = [];
    let pos = lo;
    spans.forEach(([a, b], k) => {
      if (a < 0 || b <= lo || a >= hi) return;
      const from = Math.max(a, lo), to = Math.min(b, hi);
      if (from > pos) segs.push({ t: t.slice(pos - lo, from - lo), f1: null, f2: null });
      const [f1, f2] = fateOf(k);
      segs.push({ t: t.slice(from - lo, to - lo), f1, f2 });
      pos = to;
    });
    if (pos < hi) segs.push({ t: t.slice(pos - lo), f1: null, f2: null });
    return { mark, segs };
  });
}

/** Unified-diff text for one suggestion. Rendered, never applied. */
export function unified(file, startLine, before, after) {
  const head = `--- a/${file}\n+++ b/${file}\n@@ -${startLine},${before.length} +${startLine},${after.length} @@`;
  return [head, ...before.map((l) => `-${l}`), ...after.map((l) => `+${l}`)].join('\n');
}

export function suggestFile(file, src) {
  const raw = src.split('\n');
  const lines = commentLines(src);
  const out = [];
  runs(lines).filter((r) => r.len > MAX_RUN).forEach((r, ordinal) => {
    const before = raw.slice(r.start, r.start + r.len);
    const indent = (before[0].match(/^\s*/) || [''])[0].length;
    const block = before.map((l, i) => lines[r.start + i] ?? '');
    const d = draft(block, indent);
    const second = secondPass(d.lines, { file, used: d.used, src });
    const fate = fates(d, second);
    const kind = classify(block);
    out.push({
      id: `${file}#${ordinal}`,
      // fact: the panel keys its per-row state on the block's text, never its ordinal / saving one block renumbers every later block in the file (expiry: never, prev: not built)
      key: createHash('sha256').update(`${file}\0${before.join('\n')}`).digest('hex').slice(0, 16),
      file,
      ordinal,
      kind,
      // fact: confidence is a function of what the draft DROPS, and a void has none / labelling a draft that deletes twelve sentences "medium" is the green tick that let the loss through (expiry: never, prev: broken)
      confidence: d.void ? 'none' : (d.droppedCount === 0 ? 'medium' : 'low'),
      startLine: r.start + 1,
      lines: r.len,
      before,
      after: d.lines,
      saved: d.void ? 0 : before.length - d.lines.length,
      keptCount: d.keptCount,
      droppedCount: d.droppedCount,
      dropped: d.dropped,
      void: d.void,
      reason: d.reason,
      diff: unified(file, r.start + 1, before, d.lines),
      second: { lines: second.lines, fired: second.fired },
      original: annotate(before, block, d, fate),
      tally: tally(fate),
    });
  });
  return out;
}

/**
 * Apply one suggestion to a file's text. Refuses if `before` no longer sits where it claimed —
 * the block moved or changed, and applying by position would overwrite something else.
 */
export function applyTo(src, sug, replacement) {
  const raw = src.split('\n');
  const at = sug.startLine - 1;
  const found = raw.slice(at, at + sug.before.length);
  if (found.join('\n') !== sug.before.join('\n')) {
    return { ok: false, error: `${sug.id}: the block at line ${sug.startLine} is not the one this suggestion was drafted from — re-read before accepting` };
  }
  const after = (replacement ?? sug.after.join('\n')).split('\n');
  return { ok: true, text: [...raw.slice(0, at), ...after, ...raw.slice(at + sug.before.length)].join('\n') };
}

export function suggestAll(root, files) {
  const out = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(`${root}/${f}`, 'utf8'); } catch { continue; }
    out.push(...suggestFile(f, src));
  }
  return out;
}

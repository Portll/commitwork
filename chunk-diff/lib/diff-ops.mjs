// diff-ops.mjs — word-level LCS diff, ported from an internal project's editor.html (tokenize()/diffOps(),
// editor.html:1097-1113). Zero dependencies. Pure functions only — no fs/process.
//
// The DP table is O(n*m) time and space. This module never guards against that itself (it stays a
// pure primitive); callers must bound token counts before calling diffOps() — see boundedWordDiff()
// below, which is the one entry point generate.mjs should use.

export function tokenize(text) {
  return String(text).match(/\s+|\S+/g) || [];
}

/** Per-token ops between two token arrays: {t:'='|'-'|'+', s}. */
export function diffOps(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0, j = 0;
  const ops = [];
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: '=', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', s: a[i] }); i++; }
    else { ops.push({ t: '+', s: b[j] }); j++; }
  }
  while (i < n) { ops.push({ t: '-', s: a[i] }); i++; }
  while (j < m) { ops.push({ t: '+', s: b[j] }); j++; }
  return ops;
}

/** Adjacent same-type ops merged into runs, for rendering. */
export function groupOps(ops) {
  const g = [];
  for (const o of ops) {
    const last = g[g.length - 1];
    if (last && last.t === o.t) last.s += o.s;
    else g.push({ t: o.t, s: o.s });
  }
  return g;
}

/** Token-overlap similarity ratio in [0,1], symmetric (Dice coefficient over matched tokens). */
export function similarity(aSrc, bSrc) {
  const a = tokenize(aSrc), b = tokenize(bSrc);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const matched = diffOps(a, b).filter((o) => o.t === '=').length;
  return (2 * matched) / (a.length + b.length);
}

// Env read at call time, never cached — CLAUDE.md's CW_* contract ("every input path is
// env-overridable, read at call time").
export const maxDiffTokens = () => {
  const raw = Number(process.env.CW_DIFF_MAX_WORDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20000;
};

/**
 * Word-level diff of two texts, capped. Returns {ops, capped}. When either side's token count
 * exceeds the cap, the DP table is never built (a stated refusal, not a silent truncation fed into
 * diffOps) — the caller renders a chunk-only fallback (no inline word highlighting) instead of a
 * partial word diff, and must say so visibly per commitwork's no-silent-caps convention.
 */
export function boundedWordDiff(oldText, newText, cap = maxDiffTokens()) {
  const a = tokenize(oldText), b = tokenize(newText);
  if (a.length > cap || b.length > cap) return { ops: null, capped: true };
  return { ops: groupOps(diffOps(a, b)), capped: false };
}

// Unified diffs in the shape `git apply` reads: build, parse and in-memory apply. Line-level and
// deterministic; a line's trailing-newline state is part of its identity, as in git.

const NO_NEWLINE = '\\ No newline at end of file';

/** Split into lines plus whether the text lacks a final newline. An empty text is zero lines. */
function splitForDiff(text) {
  if (text === '') return { lines: [], noNewline: false };
  const lines = text.split('\n');
  const noNewline = !text.endsWith('\n');
  if (!noNewline) lines.pop();
  return { lines, noNewline };
}

// A line carries a trailing newline unless it is the last line of a text that lacks one; two
// lines match only when their newline state matches too.
const endsWithNewline = (side, i) => i < side.lines.length - 1 || !side.noNewline;

/** The `+`/`-` body of a one-sided diff, with the no-newline marker after a last line that has none. */
function oneSidedHunk(lines, noNewline, sign) {
  const out = [];
  for (let k = 0; k < lines.length; k++) {
    out.push(sign + lines[k]);
    if (k === lines.length - 1 && noNewline) out.push(NO_NEWLINE);
  }
  return out;
}

/** A creation or deletion is a header plus the one hunk that writes or removes the whole file. */
function creationDiff(path, after) {
  const b = splitForDiff(String(after));
  const out = [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`];
  if (b.lines.length) {
    out.push(`@@ -0,0 +1,${b.lines.length} @@`, ...oneSidedHunk(b.lines, b.noNewline, '+'));
  }
  return `${out.join('\n')}\n`;
}

function deletionDiff(path, before) {
  const a = splitForDiff(String(before));
  const out = [`diff --git a/${path} b/${path}`, 'deleted file mode 100644', `--- a/${path}`, '+++ /dev/null'];
  if (a.lines.length) {
    out.push(`@@ -1,${a.lines.length} +0,0 @@`, ...oneSidedHunk(a.lines, a.noNewline, '-'));
  }
  return `${out.join('\n')}\n`;
}

/**
 * A unified diff `git apply` accepts: `diff --git` header, line-level LCS with up to `context`
 * lines of context, deletions before insertions inside a changed run, ranges always `start,len`,
 * and `\ No newline at end of file` after a side's last line when that side lacks a final
 * newline. Identical texts produce ''. A `null` side means the file does not exist: `null` before
 * is a creation, `null` after is a deletion, and both at once is a TypeError. `''` is still an
 * existing empty file.
 */
export function unifiedDiff(path, before, after, { context = 3 } = {}) {
  if (before === null && after === null) throw new TypeError('unified diff: a file cannot be created and deleted at once');
  if (before === null) return creationDiff(path, after);
  if (after === null) return deletionDiff(path, before);
  if (before === after) return '';
  const a = splitForDiff(String(before));
  const b = splitForDiff(String(after));
  const A = a.lines;
  const B = b.lines;
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = A[i] === B[j] && endsWithNewline(a, i) === endsWithNewline(b, j)
        ? L[i + 1][j + 1] + 1
        : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j] && endsWithNewline(a, i) === endsWithNewline(b, j) && L[i][j] === L[i + 1][j + 1] + 1) {
      ops.push({ t: ' ', oi: i, ni: j, line: A[i] }); i++; j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push({ t: '-', oi: i, ni: j, line: A[i] }); i++; }
    else { ops.push({ t: '+', oi: i, ni: j, line: B[j] }); j++; }
  }
  while (i < n) ops.push({ t: '-', oi: i, ni: j, line: A[i++] });
  while (j < m) ops.push({ t: '+', oi: i, ni: j, line: B[j++] });
  for (let k = 0; k < ops.length;) {
    if (ops[k].t === ' ') { k++; continue; }
    let e = k;
    while (e < ops.length && ops[e].t !== ' ') e++;
    const run = ops.slice(k, e);
    ops.splice(k, e - k, ...run.filter((o) => o.t === '-'), ...run.filter((o) => o.t === '+'));
    k = e;
  }
  const groups = [];
  for (const k of ops.keys()) {
    if (ops[k].t === ' ') continue;
    const g = groups[groups.length - 1];
    if (g && k - g.last - 1 <= 2 * context) g.last = k;
    else groups.push({ first: k, last: k });
  }
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const g of groups) {
    const from = Math.max(0, g.first - context);
    const to = Math.min(ops.length - 1, g.last + context);
    const slice = ops.slice(from, to + 1);
    const oldLines = slice.filter((o) => o.t !== '+').length;
    const newLines = slice.filter((o) => o.t !== '-').length;
    const oldStart = oldLines === 0 ? slice[0].oi : slice[0].oi + 1;
    const newStart = newLines === 0 ? slice[0].ni : slice[0].ni + 1;
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`);
    for (const o of slice) {
      out.push(o.t + o.line);
      const oldLast = o.t !== '+' && o.oi === n - 1 && a.noNewline;
      const newLast = o.t !== '-' && o.ni === m - 1 && b.noNewline;
      if (oldLast || newLast) out.push(NO_NEWLINE);
    }
  }
  return `${out.join('\n')}\n`;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_RE = /^diff --git a\/(.*) b\/(.*)$/;

const unquote = (p) => (p.length > 1 && p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);
const stripTab = (p) => p.replace(/\t+$/, '');
const oldPathOf = (p) => { p = unquote(stripTab(p)); return p === '/dev/null' ? null : p.startsWith('a/') ? p.slice(2) : p; };
const newPathOf = (p) => { p = unquote(stripTab(p)); return p === '/dev/null' ? null : p.startsWith('b/') ? p.slice(2) : p; };

/**
 * Parse one or more files' worth of unified diff into
 * `[{ oldPath, newPath, hunks: [{ oldStart, oldLines, newStart, newLines, lines,
 * oldNoNewline, newNoNewline }], created, deleted }]`. `lines` keep their leading ' ', '-' or '+';
 * `created` and `deleted` come from the `new file mode` and `deleted file mode` lines. With or
 * without `diff --git` lines; a range without `,len` means 1. Throws when a hunk's body disagrees
 * with the counts in its header, or when hunk content appears before any file header.
 */
export function parseUnifiedDiff(text) {
  const lines = String(text ?? '').split('\n');
  const files = [];
  let file = null;
  let sawHeader = false;
  let hunk = null;
  let needOld = 0;
  let needNew = 0;
  let lastBody = null; // { hunk, kind } of the most recent body line, for no-newline markers
  const newFile = (oldPath, newPath) => {
    file = { oldPath, newPath, hunks: [], created: false, deleted: false };
    sawHeader = false;
    lastBody = null;
    files.push(file);
  };
  const take = (kind, line) => {
    hunk.lines.push(line);
    if (kind !== '+') { if (needOld === 0) throw new Error('unified diff: more hunk lines than the header declares on the old side'); needOld--; }
    if (kind !== '-') { if (needNew === 0) throw new Error('unified diff: more hunk lines than the header declares on the new side'); needNew--; }
    lastBody = { hunk, kind };
    if (needOld === 0 && needNew === 0) hunk = null;
  };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (hunk) {
      if (line.startsWith(' ')) take(' ', line);
      else if (line.startsWith('+')) take('+', line);
      else if (line.startsWith('-')) take('-', line);
      else if (line === NO_NEWLINE) {
        if (!lastBody || lastBody.hunk !== hunk) throw new Error('unified diff: no-newline marker before any hunk line');
        if (lastBody.kind === '+') lastBody.hunk.newNoNewline = true;
        else { lastBody.hunk.oldNoNewline = true; if (lastBody.kind === ' ') lastBody.hunk.newNoNewline = true; }
      } else throw new Error(`unified diff: hunk body ends early — ${needOld} old and ${needNew} new line(s) still owed`);
      continue;
    }
    const hm = HUNK_RE.exec(line);
    if (hm) {
      if (!file) throw new Error('unified diff: hunk header before any file header');
      hunk = {
        oldStart: +hm[1], oldLines: hm[2] === undefined ? 1 : +hm[2],
        newStart: +hm[3], newLines: hm[4] === undefined ? 1 : +hm[4],
        lines: [], oldNoNewline: false, newNoNewline: false,
      };
      file.hunks.push(hunk);
      needOld = hunk.oldLines;
      needNew = hunk.newLines;
      if (needOld === 0 && needNew === 0) hunk = null;
      continue;
    }
    const gm = GIT_RE.exec(line);
    if (gm) { newFile(oldPathOf(gm[1]), newPathOf(gm[2])); continue; }
    if (line.startsWith('new file mode')) { if (file) file.created = true; continue; }
    if (line.startsWith('deleted file mode')) { if (file) file.deleted = true; continue; }
    if (line.startsWith('--- ') && lines[k + 1] !== undefined && lines[k + 1].startsWith('+++ ')) {
      const op = oldPathOf(line.slice(4));
      const np = newPathOf(lines[k + 1].slice(4));
      if (file && !sawHeader && !file.hunks.length) { file.oldPath = op; file.newPath = np; }
      else newFile(op, np);
      sawHeader = true;
      k++;
      continue;
    }
    if (line === NO_NEWLINE) {
      if (!lastBody) throw new Error('unified diff: no-newline marker outside a hunk');
      if (lastBody.kind === '+') lastBody.hunk.newNoNewline = true;
      else { lastBody.hunk.oldNoNewline = true; if (lastBody.kind === ' ') lastBody.hunk.newNoNewline = true; }
      continue;
    }
    if (/^[ +-]/.test(line)) {
      if (!file) throw new Error('unified diff: hunk line before any file header');
      throw new Error('unified diff: more hunk lines than the header declares');
    }
  }
  if (hunk) throw new Error(`unified diff: hunk body ends early — ${needOld} old and ${needNew} new line(s) still owed`);
  return files;
}

/**
 * Apply one parsed file diff to its old text and return the new text. A creation takes `null` as
 * its base and returns the new text; a deletion returns `null` and requires the text to match the
 * removed lines exactly. Throws when a context or deleted line does not match the text at its
 * position, when a no-newline marker disagrees with the text, or when a side is null where the
 * diff expects text (and vice versa); both markers decide the result's own final newline.
 */
export function applyUnifiedDiff(text, fileDiff) {
  const created = fileDiff?.created === true || fileDiff?.oldPath === null;
  const deleted = fileDiff?.deleted === true || fileDiff?.newPath === null;
  if (created && deleted) throw new Error('unified diff: a file cannot be created and deleted at once');
  if (created) {
    if (text !== null) throw new Error('unified diff: a file creation must be applied to null');
  } else if (deleted) {
    if (text === null) throw new Error('unified diff: a file deletion must be applied to text');
  } else if (text === null) {
    throw new Error('unified diff: an in-place change cannot be applied to null');
  }
  const hunks = [...((fileDiff && fileDiff.hunks) || [])].sort((x, y) => x.oldStart - y.oldStart);
  const old = splitForDiff(created ? '' : String(text));
  const out = [];
  let cursor = 0; // 0-based old index; every line before it is consumed
  for (const h of hunks) {
    const oldCount = h.lines.filter((l) => l[0] !== '+').length;
    const newCount = h.lines.filter((l) => l[0] !== '-').length;
    if (oldCount !== h.oldLines || newCount !== h.newLines) throw new Error('unified diff: hunk body does not match the counts in its header');
    const start = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
    if (start < cursor || start > old.lines.length) throw new Error(`unified diff: hunk at -${h.oldStart},${h.oldLines} does not fit the text`);
    while (cursor < start) out.push(old.lines[cursor++]);
    let oi = start;
    for (const l of h.lines) {
      if (l[0] === '+') { out.push(l.slice(1)); continue; }
      if (oi >= old.lines.length || old.lines[oi] !== l.slice(1)) throw new Error(`unified diff: ${l[0] === ' ' ? 'context' : 'deleted'} line does not match the text at line ${oi + 1}`);
      if (l[0] === ' ') out.push(old.lines[oi]);
      oi++; cursor++;
    }
    const touchesEnd = oi === old.lines.length && oldCount > 0;
    if (h.oldNoNewline !== (touchesEnd && old.noNewline)) throw new Error('unified diff: the old side\'s no-newline marker does not match the text');
  }
  while (cursor < old.lines.length) out.push(old.lines[cursor++]);
  if (deleted) {
    if (out.length) throw new Error('unified diff: the text does not match the deleted lines exactly');
    return null;
  }
  if (!out.length) return '';
  const anyNew = hunks.some((h) => h.newNoNewline);
  const anyOld = hunks.some((h) => h.oldNoNewline);
  const endsWithNewline = anyNew ? false : anyOld ? true : !old.noNewline;
  return `${out.join('\n')}${endsWithNewline ? '\n' : ''}`;
}

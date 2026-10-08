// chunk-split.mjs — splits Markdown into blocks on blank-line boundaries, keeping fenced code
// blocks (``` or ~~~) intact. Ported from an internal project's editor.html splitBlocks() (editor.html:526-551).
// Zero dependencies.
//
// Returns {src} per block ONLY — never a position/offset — per commitwork's "never key an identity
// on a line number" invariant. A block's identity is a content fingerprint, computed by the caller
// from `src` (see chunk-identity.mjs), never from this module's array order.

export function splitBlocks(source) {
  const src = String(source);
  const lines = src.split('\n');
  const blocks = [];
  let cur = null;
  let fence = null;

  const lineStart = (idx) => {
    let o = 0;
    for (let k = 0; k < idx; k++) o += lines[k].length + 1;
    return o;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fence) {
      if (fenceMatch && line.trim().startsWith(fence)) fence = null;
      cur.end = lineStart(i) + line.length;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      if (!cur) { cur = { start: lineStart(i), end: 0 }; blocks.push(cur); }
      cur.end = lineStart(i) + line.length;
      continue;
    }
    if (line.trim() === '') { cur = null; continue; }
    if (!cur) { cur = { start: lineStart(i), end: 0 }; blocks.push(cur); }
    cur.end = lineStart(i) + line.length;
  }

  return blocks.map((b) => ({ src: src.slice(b.start, b.end) }));
}

// splitSections — coarser granularity than splitBlocks: one chunk per Markdown heading (any
// level, `#` through `######`), running through to the next heading line or EOF, fences kept
// intact. Content before the first heading is its own leading chunk. Useful for comparing
// documents whose meaningful unit is "a phase" or "a section", not "a paragraph" — a chunk-list
// row then corresponds to a whole heading section instead of one blank-line block within it.
//
// LIMITATION, stated rather than silently accepted: this only recognises literal `#`-prefixed
// heading lines. A document that marks its sections with bold-prefixed prose instead of real
// headings (`**Phase 0 — Risk Triage**: ...` as the start of an ordinary paragraph, not a heading
// line on its own) produces no section boundaries at all here and collapses to one chunk — this
// function does not attempt to infer structure from typography it wasn't given.
export function splitSections(source) {
  const src = String(source);
  const lines = src.split('\n');
  const sections = [];
  let cur = null;
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fence) {
      if (fenceMatch && line.trim().startsWith(fence)) fence = null;
      if (!cur) { cur = []; sections.push(cur); }
      cur.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      if (!cur) { cur = []; sections.push(cur); }
      cur.push(line);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      cur = [line];
      sections.push(cur);
      continue;
    }
    if (!cur) { cur = []; sections.push(cur); }
    cur.push(line);
  }

  return sections
    .map((ls) => ({ src: ls.join('\n').trim() }))
    .filter((s) => s.src.length > 0);
}

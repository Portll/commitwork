// lib/md-view.mjs — Markdown parsed to a self-contained HTML page with its design values drawn:
// colours as swatches, CSS custom properties resolved from the document's own token tables,
// contrast ratios graded, and shadows, font stacks, type sizes, weights, tracking, radii, padding,
// spacing steps, durations, opacities, line heights and measures rendered as what they describe.
// Pure — no fs, no process; bin/md-view.mjs does the I/O and passes callbacks in.
//
// Its own block parser rather than lib/render-markdown.mjs: that one ends a list item at its first
// wrapped line and emits no heading anchors, and it is served verbatim to the docsite editor and
// held to parity by bin/test/docsite-parity.test.mjs, so widening it would move the docsite too.
// Only its esc() and stripComments() are shared — esc() stays the one escaping boundary.
//
// Every value that reaches CSS matches a strict grammar and is emitted as a generated class rule
// inside the single hashed <style>, never as a style="" attribute, so the page runs under a CSP
// with no 'unsafe-inline'.

import { createHash } from 'node:crypto';
import { esc, stripComments } from './render-markdown.mjs';
import { LIGHT, DARK, SEAL_SVG, SEAL_FAVICON, KEY_FAVICON, MARK_URI } from './brand-tokens.mjs';
import { houseTokens, houseBase } from './house-css.mjs';
import { FOLLOWER_JS, TOGGLE_JS } from './theme-follower.mjs';

// ── values ──────────────────────────────────────────────────────────────────────────────────────

const HEX_SRC = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_])';
const NUM_SRC = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)%?';
const FN_SRC = `(?:rgba?|hsla?)\\(\\s*${NUM_SRC}(?:\\s*[,/]?\\s*${NUM_SRC}){2,3}\\s*\\)`;
const COLOR_SRC = `${HEX_SRC}|${FN_SRC}`;
const TOKEN_SRC = '--[A-Za-z][\\w-]*';
const LEN_SRC = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:px|rem|em|ch|%|vh|vw)?';
const SH_LEN = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:px|rem|em)?';
const SH_PART = `(?:inset\\s+)?${SH_LEN}(?:\\s+${SH_LEN}){1,3}\\s+(?:${COLOR_SRC}|var\\(${TOKEN_SRC}\\))`;

const COLOR_EXACT = new RegExp(`^(?:${COLOR_SRC})$`);
const TOKEN_EXACT = new RegExp(`^${TOKEN_SRC}$`);
const SHADOW_EXACT = new RegExp(`^${SH_PART}(?:\\s*,\\s*${SH_PART})*$`);
const LEN_EXACT = new RegExp(`^${LEN_SRC}$`);
const FONT_EXACT = /^\s*(?:"[\w .-]+"|'[\w .-]+'|[\w-]+(?: [\w-]+)*)(?:\s*,\s*(?:"[\w .-]+"|'[\w .-]+'|[\w-]+(?: [\w-]+)*))+\s*$/;
const FONT_GENERIC = /(?:sans-serif|serif|monospace|system-ui|ui-monospace|ui-sans-serif|ui-serif|apple-system)/;
const EASING = /\b(linear|ease-in-out|ease-in|ease-out|ease)\b/;

// U+2212 is how prose writes a negative number; CSS only reads the hyphen-minus.
const norm = (s) => String(s).replace(/\u2212/g, '-');

export function parseColor(css) {
  const s = norm(css).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (k) => parseInt(h.slice(k, k + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^(rgba?|hsla?)\((.*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const val = (p, max) => (p.endsWith('%') ? (parseFloat(p) / 100) * max : parseFloat(p));
  const a = parts[3] === undefined ? 1 : val(parts[3], 1);
  let rgb;
  if (m[1].startsWith('rgb')) rgb = [val(parts[0], 255), val(parts[1], 255), val(parts[2], 255)];
  else {
    const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
    const sat = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const k = (n) => (n + h / 30) % 12;
    const f = (n) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    rgb = [f(0) * 255, f(8) * 255, f(4) * 255];
  }
  const out = [...rgb.map((v) => Math.min(255, Math.max(0, v))), Math.min(1, Math.max(0, a))];
  return out.some(Number.isNaN) ? null : out;
}

const canon = ([r, g, b, a]) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;
const lum = (rgb) => {
  const c = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(rgb[0]) + 0.7152 * c(rgb[1]) + 0.0722 * c(rgb[2]);
};

// An alpha colour is measured as it actually paints: composited over the ground first.
export function contrastRatio(fg, bg) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;
  const painted = [0, 1, 2].map((k) => f[k] * f[3] + b[k] * (1 - f[3]));
  const [x, y] = [lum(painted), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Graded on the unrounded ratio: 4.496 displays as 4.50 and still fails AA.
export const grade = (r) => (r >= 7 ? 'aaa' : r >= 4.5 ? 'aa' : r >= 3 ? 'large' : 'fail');
const GRADE_LABEL = { aaa: 'AAA', aa: 'AA', large: 'AA large', fail: 'fail' };
const GRADE_TITLE = {
  aaa: 'passes WCAG AAA for body text (7:1 or more)',
  aa: 'passes WCAG AA for body text (4.5:1 or more)',
  large: 'passes AA for large text only (3:1 or more), fails for body text',
  fail: 'fails WCAG AA even for large text (under 3:1)',
};

// ── block parser ────────────────────────────────────────────────────────────────────────────────

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?/;
const CALLOUT_RE = /^:::\s*([\w-]*)\s*$/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const MARKER_RE = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;

const isBlank = (l) => /^\s*$/.test(l);
const indentOf = (l) => /^ */.exec(l)[0].length;
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- n is a numeric indent width computed by this module
const stripIndent = (l, n) => l.replace(new RegExp(`^ {0,${n}}`), '');

function listMarker(line) {
  const m = MARKER_RE.exec(line);
  if (!m || HR_RE.test(line)) return null;
  const [, ind, mark, gap, rest] = m;
  const ordered = /\d/.test(mark);
  const pad = !rest || gap.length > 4 ? 1 : gap.length;
  return {
    ordered,
    bullet: ordered ? mark.slice(-1) : mark,
    start: ordered ? parseInt(mark, 10) : 1,
    col: ind.length + mark.length + pad,
    rest,
  };
}

// A pipe inside a code span or escaped as \| belongs to the cell, not to the row.
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let open = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '`') {
      let run = 1;
      while (s[k + run] === '`') run++;
      if (!open) open = run; else if (open === run) open = 0;
      cur += s.slice(k, k + run);
      k += run - 1;
      continue;
    }
    if (ch === '|' && !open) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function tableAt(lines, i) {
  if (i + 1 >= lines.length || !lines[i].includes('|') || !DELIM_RE.test(lines[i + 1])) return null;
  const head = splitRow(lines[i]);
  const delim = splitRow(lines[i + 1]);
  if (head.length !== delim.length) return null;
  const align = delim.map((d) => {
    const l = d.startsWith(':');
    const r = d.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
  });
  return { head, align };
}

const startsBlock = (lines, i) => {
  const l = lines[i];
  return FENCE_RE.test(l) || ATX_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l)
    || CALLOUT_RE.test(l) || Boolean(listMarker(l)) || Boolean(tableAt(lines, i));
};

function parseList(lines, i, out) {
  const first = listMarker(lines[i]);
  const list = { t: 'list', ordered: first.ordered, start: first.start, tight: true, items: [] };
  while (i < lines.length) {
    const mk = listMarker(lines[i]);
    if (!mk || mk.ordered !== first.ordered || mk.bullet !== first.bullet) break;
    const body = [mk.rest];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= mk.col) {
          while (i < j) { body.push(''); i++; }
          list.tight = false;
          continue;
        }
        break;
      }
      if (indentOf(l) >= mk.col) { body.push(l.slice(mk.col)); i++; continue; }
      // Lazy continuation: a wrapped line that starts no block of its own belongs to the item.
      if (!isBlank(body[body.length - 1]) && !startsBlock(lines, i)) { body.push(l.trim()); i++; continue; }
      break;
    }
    const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    list.items.push({ task: task ? task[1] !== ' ' : null, children: parseBlocks(body) });
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j++;
    const next = j < lines.length ? listMarker(lines[j]) : null;
    if (!next || next.ordered !== first.ordered || next.bullet !== first.bullet) break;
    if (j > i) list.tight = false;
    i = j;
  }
  out.push(list);
  return i;
}

function parseBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    let m = FENCE_RE.exec(line);
    if (m) {
      const [, ind, fence, lang] = m;
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- only the fence length (a count) and a fixed fence character are interpolated
      const closes = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      const body = [];
      i++;
      while (i < lines.length && !closes.test(lines[i])) body.push(stripIndent(lines[i++], ind.length));
      i++;
      out.push({ t: 'code', lang: lang.toLowerCase(), text: body.join('\n') });
      continue;
    }
    if ((m = ATX_RE.exec(line))) { out.push({ t: 'h', level: m[1].length, text: (m[2] || '').trim() }); i++; continue; }
    if (HR_RE.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (QUOTE_RE.test(line)) {
      const body = [];
      while (i < lines.length && !isBlank(lines[i]) && (QUOTE_RE.test(lines[i]) || !startsBlock(lines, i))) {
        body.push(lines[i++].replace(QUOTE_RE, ''));
      }
      out.push({ t: 'quote', children: parseBlocks(body) });
      continue;
    }
    if ((m = CALLOUT_RE.exec(line))) {
      const body = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ t: 'callout', kind: m[1] || 'note', children: parseBlocks(body) });
      continue;
    }
    const tbl = tableAt(lines, i);
    if (tbl) {
      i += 2;
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const r = splitRow(lines[i++]);
        rows.push(tbl.head.map((_, k) => r[k] ?? ''));
      }
      out.push({ t: 'table', head: tbl.head, align: tbl.align, rows });
      continue;
    }
    if (listMarker(line)) { i = parseList(lines, i, out); continue; }
    const para = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i])) {
      const s = SETEXT_RE.exec(lines[i]);
      if (s) { i++; out.push({ t: 'h', level: s[1][0] === '=' ? 1 : 2, text: para.join(' ') }); para.length = 0; break; }
      if (startsBlock(lines, i)) break;
      para.push(lines[i++].trim());
    }
    if (para.length) out.push({ t: 'p', text: para.join('\n') });
  }
  return out;
}

export function parseMarkdown(md) {
  const lines = stripComments(String(md)).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return parseBlocks(lines);
}

// ── tokens the document defines ─────────────────────────────────────────────────────────────────

const codeSpans = (cell) => [...String(cell).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const firstColor = (cell) => {
  const m = new RegExp(COLOR_SRC).exec(norm(cell));
  return m && parseColor(m[0]) ? m[0] : null;
};

// A table whose first column names custom properties and whose Dark/Light (or Value) columns carry
// colour literals is the document declaring its palette; every `--token` elsewhere resolves to it.
export function collectTokens(blocks) {
  const tokens = new Map();
  const aliases = [];
  const visit = (list) => {
    for (const b of list) {
      if (b.t === 'table') {
        const heads = b.head.map((h) => plain(h).toLowerCase());
        const dk = heads.findIndex((h) => /\bdark\b/.test(h) && !/contrast/.test(h));
        const lt = heads.findIndex((h) => /\blight\b/.test(h) && !/contrast/.test(h));
        const one = heads.findIndex((h) => /^(value|hex|colou?r)$/.test(h));
        if (dk < 0 && lt < 0 && one < 0) continue;
        for (const row of b.rows) {
          const names = codeSpans(row[0]).filter((c) => TOKEN_EXACT.test(c.trim())).map((c) => c.trim());
          if (!names.length) continue;
          const pick = (k) => (k < 0 ? null : firstColor(row[k]));
          const dark = pick(dk) ?? pick(one);
          const light = pick(lt) ?? pick(one);
          for (const name of names) {
            if (tokens.has(name)) continue;
            if (dark || light) tokens.set(name, { dark: dark ?? light, light: light ?? dark });
            else {
              const ref = codeSpans(row[dk >= 0 ? dk : lt >= 0 ? lt : one] || '').find((c) => TOKEN_EXACT.test(c.trim()));
              if (ref) aliases.push([name, ref.trim()]);
            }
          }
        }
      }
      if (b.children) visit(b.children);
      if (b.items) for (const it of b.items) visit(it.children);
    }
  };
  visit(blocks);
  for (const [name, ref] of aliases) if (!tokens.has(name) && tokens.has(ref)) tokens.set(name, tokens.get(ref));
  return tokens;
}

// ── inline ──────────────────────────────────────────────────────────────────────────────────────

const plain = (s) => String(s)
  .replace(/`([^`]*)`/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__|~~|\*|_)/g, '')
  .trim();

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Placeholders are private-use characters, never digits, so the number-matching visualisers that
// run over escaped text cannot match inside one.
const SLOT = '\uE000';
const SLOT_RE = /\uE000([\uE100-\uF8FF])/g;

function inline(src, ctx) {
  const slots = [];
  const hold = (html) => { slots.push(html); return SLOT + String.fromCharCode(0xE100 + slots.length - 1); };
  let s = String(src).replace(/[\uE000-\uF8FF]/g, '');
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => hold(codeHtml(code.replace(/\n/g, ' ').replace(/^ (.*\S.*) $/, '$1'), ctx)));
  s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, (_, u) => hold(`<a href="${esc(u)}">${esc(u)}</a>`));
  s = s.replace(/\\([!-/:-@[-`{-~])/g, (_, c) => hold(esc(c)));
  s = esc(s);
  s = textVisuals(s, ctx, hold);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[\s\S]*?&quot;)?\)/g, (_, alt, href) => hold(ctx.st.image(unesc(alt), unesc(href))));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]*)(?:\s+&quot;([\s\S]*?)&quot;)?\)/g, (_, text, href, title) => {
    const h = ctx.st.href(unesc(href));
    return hold(`<a href="${esc(h)}"${title ? ` title="${title}"` : ''}>`) + text + hold('</a>');
  });
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/ {2,}\n/g, () => hold('<br>'));
  return s.replace(SLOT_RE, (_, c) => slots[c.charCodeAt(0) - 0xE100]);
}

// ── visualisers ─────────────────────────────────────────────────────────────────────────────────

function swatchTitle(literal, rgba) {
  const c = canon(rgba);
  const d = contrastRatio(c, DARK.bg);
  const l = contrastRatio(c, LIGHT.bg);
  return `${literal} · ${d.toFixed(2)}:1 on ${DARK.bg} · ${l.toFixed(2)}:1 on ${LIGHT.bg}`;
}

function swatch(literal, ctx) {
  const rgba = parseColor(literal);
  if (!rgba) return '';
  ctx.st.colours.add(canon(rgba));
  return `<span class="sw ${ctx.st.sheet.cls(`--c:${canon(rgba)}`)}" title="${esc(swatchTitle(literal, rgba))}"></span>`;
}

function tokenSwatch(name, t, ctx) {
  const d = parseColor(t.dark);
  const l = parseColor(t.light);
  if (!d || !l) return '';
  const title = t.dark === t.light ? `${name} · ${t.dark}` : `${name} · dark ${t.dark} · light ${t.light}`;
  return `<span class="tk ${ctx.st.sheet.cls(`--d:${canon(d)};--l:${canon(l)}`)}" title="${esc(title)}"></span>`;
}

function groundChip(literal, ground, ctx) {
  const rgba = parseColor(literal);
  if (!rgba) return '';
  ctx.st.colours.add(canon(rgba));
  const bg = ground === 'dark' ? DARK.bg : LIGHT.bg;
  const r = contrastRatio(canon(rgba), bg);
  return `<span class="gnd gnd-${ground} ${ctx.st.sheet.cls(`--c:${canon(rgba)}`)}" title="${esc(`${literal} on the ${ground} ground ${bg}: ${r.toFixed(2)}:1 (${GRADE_LABEL[grade(r)]})`)}"><span class="sw"></span><b>Aa</b></span>`;
}

function badge(ratio) {
  const g = grade(ratio);
  return `<span class="cr cr-${g}" title="${GRADE_TITLE[g]}">${GRADE_LABEL[g]}</span>`;
}

const isFontStack = (s) => FONT_EXACT.test(s) && FONT_GENERIC.test(s);
const FONT_SAMPLE = 'Aa Gg Qq 0123456789 {}[] — The quick brown fox';

function codeHtml(raw, ctx) {
  const n = norm(raw).trim();
  if (TOKEN_EXACT.test(n)) {
    const t = ctx.st.tokens.get(n);
    return (t ? tokenSwatch(n, t, ctx) : '') + `<code>${esc(raw)}</code>`;
  }
  if (ctx.ground && COLOR_EXACT.test(n)) return groundChip(n, ctx.ground, ctx) + `<code>${esc(raw)}</code>`;
  let after = '';
  if (SHADOW_EXACT.test(n)) {
    after = `<span class="shd ${ctx.st.sheet.cls(`box-shadow:${n}`)}" title="box-shadow: ${esc(n)}"></span>`;
  } else if (isFontStack(n)) {
    after = `<span class="fsmp ${ctx.st.sheet.cls(`font-family:${n}`)}">${FONT_SAMPLE}</span>`;
  } else if (/\b(step|spacing)/.test(ctx.section)) {
    after = ladder(n, ctx);
  }
  return `<code>${inlineSwatches(raw, ctx)}</code>${after}`;
}

// Swatches inside code, each placed before the literal it draws.
function inlineSwatches(raw, ctx) {
  const re = new RegExp(`${COLOR_SRC}|var\\((${TOKEN_SRC})\\)`, 'g');
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(re)) {
    out += esc(raw.slice(last, m.index));
    if (m[1]) { const t = ctx.st.tokens.get(m[1]); if (t) out += tokenSwatch(m[1], t, ctx); } else out += swatch(m[0], ctx);
    out += esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(raw.slice(last));
}

// Only a span that is nothing but a run of numbers and one trailing unit is a scale of steps;
// `padding:0 1.25rem 5rem` has three numbers too and is not one.
const STEPS_EXACT = /^(?:(?:\d+\.?\d*|\.\d+)\s*[·,]?\s*){3,40}(px|rem|em)?$/;

function ladder(n, ctx) {
  const m = STEPS_EXACT.exec(n);
  if (!m) return '';
  const unit = m[1] || 'rem';
  const steps = [...n.matchAll(/\d+\.?\d*|\.\d+/g)].map((x) => x[0]).filter((v) => parseFloat(v) <= (unit === 'px' ? 320 : 20));
  return '<span class="ladder">' + steps.map((v) => `<span class="st"><i class="${ctx.st.sheet.cls(`width:${v}${unit}`)}"></i><b>${esc(v)}</b></span>`).join('') + '</span>';
}

const CONTRAST_COL = /contrast|^white$|dark ink|^dark$|^light$/;

const FAMILY_FALLBACK = {
  'IBM Plex Sans': 'var(--sans)', 'IBM Plex Mono': 'var(--mono)', Quicksand: 'sans-serif', Inter: 'sans-serif',
  'Libre Franklin': 'sans-serif', 'Akzidenz-Grotesk': 'sans-serif', 'Segoe UI': 'sans-serif', Helvetica: 'sans-serif',
  Roboto: 'sans-serif', Arial: 'sans-serif', Georgia: 'serif', Charter: 'serif', 'Iowan Old Style': 'serif',
  'SF Mono': 'monospace', Menlo: 'monospace', Consolas: 'monospace',
};
const FAMILY_RE = new RegExp(`(?<![\\w-])(${Object.keys(FAMILY_FALLBACK).sort((a, b) => b.length - a.length).join('|')})(?![\\w-])`, 'g');

// A family named in prose is set in that family. One the page does not embed renders only if this
// machine has it installed, and says so, because a silent fallback would show the wrong face.
function familyNames(s, st, hold) {
  return s.replace(FAMILY_RE, (name) => {
    const note = st.families.has(name) ? '' : ` title="${esc(`${name} is not embedded; shown only if installed here`)}"`;
    return hold(`<span class="ff ${st.sheet.cls(`font-family:"${name}",${FAMILY_FALLBACK[name]}`)}"${note}>${name}</span>`);
  });
}

// Visualisers over escaped cell and paragraph text. Each is gated on the column header or section
// heading that says what the numbers in that cell mean; a bare 400 means nothing without one.
function textVisuals(s, ctx, hold) {
  const { st, col, section, colIndex } = ctx;
  const cls = (d) => st.sheet.cls(d);
  s = familyNames(s, st, hold);
  s = s.replace(/(\d{1,2}(?:\.\d{1,2})?):1(?!\d|\.\d)/g, (w, n) => (+n >= 1 && +n <= 21 ? w + hold(badge(+n)) : w));
  if (CONTRAST_COL.test(col)) {
    s = s.replace(/(^|[\s,(])(\d{1,2}\.\d{2})(?![\d:])/g, (w, pre, n) => (+n >= 1 && +n <= 21 ? pre + n + hold(badge(+n)) : w));
  }
  if (colIndex < 0 || ctx.specimen) return s;
  if (/radi/.test(col) || (/radi/.test(section) && colIndex === 0)) {
    s = s.replace(new RegExp(`^\\s*(${LEN_SRC})`), (w, v) => hold(`<span class="rbox ${cls(`border-radius:${v}`)}"></span>`) + w);
  }
  if (col === 'rem' || /font-size|^size$/.test(col)) {
    s = s.replace(/^\s*((?:\d+\.?\d*|\.\d+)(?:rem|px|em)?)\s*$/, (w, v) => {
      const len = /[a-z]$/.test(v) ? v : `${v}rem`;
      return w + hold(`<span class="tsz ${cls(`font-size:${len}`)}">Ag</span>`);
    });
  }
  if (/weight/.test(col) || (/weight/.test(section) && colIndex > 0)) {
    const family = ctx.rowFont ? `font-family:${ctx.rowFont};` : '';
    s = s.replace(/\b([1-9]00)(\s+italic)?\b/g, (w, wt, it) => w + hold(`<span class="wsmp ${cls(`${family}font-weight:${wt};font-style:${it ? 'italic' : 'normal'}`)}">Ag</span>`));
  }
  if (/tracking|letter-spacing/.test(col) || (/tracking/.test(section) && colIndex > 0)) {
    s = s.replace(/([\u2212+-]?(?:\d+\.?\d*|\.\d+))em\b/g, (w, v) => w + hold(`<span class="trk ${cls(`letter-spacing:${norm(v)}em`)}">LABEL</span>`));
  }
  if (/padding/.test(col)) {
    s = s.replace(new RegExp(`^\\s*((?:${LEN_SRC})(?:\\s+${LEN_SRC}){0,3})(?=\\s|$|;|,)`), (w, v) => (
      v.split(/\s+/).every((x) => LEN_EXACT.test(x)) ? hold(`<span class="pbox ${cls(`padding:${v}`)}"><span>Aa</span></span>`) + w : w));
  }
  if (/opacity/.test(col)) {
    s = s.replace(/^\s*(0?\.\d+|1(?:\.0+)?)\b/, (w, v) => hold(`<span class="osmp ${cls(`opacity:${v}`)}">Row</span>`) + w);
  }
  if (/timing|duration|transition/.test(col) || (/motion/.test(section) && colIndex > 0)) {
    const ease = EASING.exec(s);
    s = s.replace(/^\s*(\d*\.?\d+)(ms|s)\b/, (w, v, u) => hold(`<span class="mv ${cls(`--dur:${v}${u};--ease:${ease ? ease[1] : 'ease'}`)}" title="hover the row to play ${esc(v + u)}"></span>`) + w);
  }
  if (/line.?height/.test(col)) {
    s = s.replace(/^\s*(\d?\.\d+|\d(?:\.\d+)?)\b/, (w, v) => hold(`<span class="lh ${cls(`line-height:${v}`)}">Two lines of sample text at this height</span>`) + w);
  }
  if (/measure/.test(col)) {
    s = s.replace(/^\s*(\d{1,3})ch\b/, (w, v) => hold(`<span class="mbar ${cls(`width:${v}ch`)}"></span>`) + w);
  }
  if (/breakpoint/.test(section) && /width/.test(col)) {
    const m = /(\d{2,4})(px|em)\b/.exec(s);
    if (m) {
      const px = m[2] === 'em' ? +m[1] * 16 : +m[1];
      s = hold(`<span class="bpbar ${cls(`width:${Math.min(10, (px / 1600) * 10).toFixed(2)}rem`)}" title="${px}px of a 1600px window"></span>`) + s;
    }
  }
  return s;
}

// ── blocks → HTML ───────────────────────────────────────────────────────────────────────────────

function slugify(text, ids) {
  const base = plain(text).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-') || 'section';
  const n = ids.get(base) || 0;
  ids.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

// ── lockups ─────────────────────────────────────────────────────────────────────────────────────
// A ```lockup fence holds panel markup. It is drawn twice, in a dark and a light container, each
// styled by the panel's own stylesheets scoped under that container (scopeCss below), so a lockup
// shows the component as the panel paints it rather than a copy of its rules. The markup passes an
// allowlist first: no scripts, no style attributes, no event handlers, no outside URLs.

const LK_TAGS = new Set(('div span p a button label input select option textarea ul ol li table thead tbody tfoot tr th '
  + 'td caption code pre kbd b i em strong small sub sup br hr h1 h2 h3 h4 h5 h6 section article header footer nav aside '
  + 'main details summary img figure figcaption dl dt dd abbr time mark s u del ins progress meter fieldset legend output').split(' '));
const LK_VOID = new Set(['input', 'br', 'hr', 'img']);
const LK_DROP = /^(script|style|template|iframe|object|embed|noscript|svg|math|title)$/;
const LK_ATTR = /^(class|id|role|title|type|value|checked|disabled|hidden|open|for|name|placeholder|alt|colspan|rowspan|tabindex|selected|readonly|datetime|min|max|step|aria-[\w-]+|data-[\w-]+|href|src)$/;
const LK_TAG_RE = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const LK_ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const textOf = (t) => esc(unesc(t).replace(/&nbsp;/g, ' '));

export function sanitizeLockup(html) {
  let out = '';
  let last = 0;
  let skip = null;
  for (const m of String(html).matchAll(LK_TAG_RE)) {
    const text = html.slice(last, m.index);
    last = m.index + m[0].length;
    const tag = (m[1] || '').toLowerCase();
    const closing = m[0].startsWith('</');
    if (skip) { if (closing && tag === skip) skip = null; continue; }
    out += textOf(text);
    if (m[0].startsWith('<!--')) continue;
    // <cw-seal> is the panel's inline seal, taken from lib/brand-tokens.mjs, so the light sheet can
    // recolour it to the default mark exactly as it does in the panel.
    if (tag === 'cw-seal') { if (!closing) out += SEAL_SVG; continue; }
    if (!LK_TAGS.has(tag)) { if (!closing && LK_DROP.test(tag)) skip = tag; continue; }
    if (closing) { if (!LK_VOID.has(tag)) out += `</${tag}>`; continue; }
    const attrs = [];
    for (const a of (m[2] || '').matchAll(LK_ATTR_RE)) {
      const name = a[1].toLowerCase();
      if (!LK_ATTR.test(name)) continue;
      let v = a[2] ?? a[3] ?? a[4];
      v = v === undefined ? null : unesc(v);
      if (name === 'href' && !(v && v.startsWith('#'))) continue;
      if (name === 'src') {
        if (CW_MARKS[v]) v = CW_MARKS[v];
        else if (!/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v || '')) continue;
      }
      attrs.push(v === null ? name : `${name}="${esc(v)}"`);
    }
    out += `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  }
  if (!skip) out += textOf(html.slice(last));
  return out;
}

function lockupHtml(text, ctx) {
  ctx.st.lockups += 1;
  const inner = sanitizeLockup(text);
  return `<div class="lockup"><div class="lk lk-dark"><span class="lk-cap">Dark</span>${inner}</div>`
    + `<div class="lk lk-light"><span class="lk-cap">Light</span>${inner}</div></div>`;
}

// Split on a separator at bracket depth zero, so `:is(a,b)` stays one selector.
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function cssBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).split(';').pop().trim();
    let depth = 1;
    let j = open + 1;
    let quote = null;
    for (; j < css.length && depth; j++) {
      const ch = css[j];
      if (quote) { if (ch === quote && css[j - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    out.push({ prelude, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

// :root, html, body and .workspace-shell become the lockup container itself; .cw-light (the
// decision controls' light surface) becomes a .cw-surface wrapper inside the light container.
function scopeSelector(sel, base) {
  const s = sel.trim().replace(/\.cw-light(?![\w-])/g, '.lk-light .cw-surface');
  if (s.startsWith('.lk-light')) return s;
  const root = /^(:root|html|body|\.workspace-shell)(?![\w-])/.exec(s);
  if (!root) return `${base} ${s}`;
  // Every other selector gains one class from the prefix; a class-level root keeps its own class
  // weight too, by repeating the container class, so the sheets still cascade in their own order.
  return (root[1] === '.workspace-shell' ? base + base : base) + s.slice(root[0].length);
}

export function scopeCss(css, base) {
  return cssBlocks(String(css).replace(/\/\*[\s\S]*?\*\//g, '')).map(({ prelude, body }) => {
    if (/^@(media|supports)/i.test(prelude)) return `${prelude}{${scopeCss(body, base)}}`;
    if (/^@(-webkit-)?keyframes/i.test(prelude)) return `${prelude}{${body}}`;
    if (prelude.startsWith('@') || !prelude) return '';
    return `${splitTop(prelude, ',').map((x) => scopeSelector(x, base)).join(',')}{${body}}`;
  }).filter(Boolean).join('\n');
}

// The page's own element rules would otherwise reach into a lockup; these put the browser
// defaults back first, so the panel's scoped rules decide what a lockup looks like.
const LOCKUP_RESET = `.lk :is(h1,h2,h3,h4,h5,h6){border:0;padding:0;margin:0;font-family:inherit;font-size:revert;scroll-margin-top:0}
.lk p{margin:0;max-width:none}.lk a{color:inherit;text-decoration:none}
.lk :is(code,kbd,samp){background:none;padding:0;border-radius:0;font:inherit;color:inherit;overflow-wrap:normal}
.lk pre{padding:0;overflow:visible;background:none;border:0;border-radius:0;font:revert}
.lk :is(ul,ol){margin:0;padding-left:2.5rem}.lk li{margin:0}.lk .tw{margin:0}.lk .pill{font-family:inherit;line-height:inherit}`;
// Fixed and sticky parts of the panel are drawn in place inside their lockup.
const LOCKUP_CONTAIN = `.lk .bar{position:relative;top:auto;margin-bottom:0}.lk .pop{position:static;min-width:0}
.lk .lane-toasts{position:static;max-width:none;pointer-events:auto}.lk .cw-scrim{display:none}
.lk .cw-dialog{position:relative;left:auto;top:auto;transform:none;width:auto;max-width:34rem;margin:0}
.lk #workspace-rail{position:relative;top:auto;bottom:auto;left:auto}.lk .skip-link{display:none}
.lk #sw-prog{width:62%}.lk .tw table{min-width:0}.lk .seal img{display:block;width:100%;height:100%}.lk .lk-zoom{zoom:2}`;

export function lockupCss({ base = [], light = [] } = {}) {
  return [LOCKUP_RESET, ...base.map((c) => scopeCss(c, '.lk')), ...light.map((c) => scopeCss(c, '.lk-light')), LOCKUP_CONTAIN].join('\n');
}

function codeBlock(b, ctx) {
  if (b.lang === 'lockup') return lockupHtml(b.text, ctx);
  if (b.lang === 'svg' && /^\s*<svg[\s>]/.test(b.text)) {
    const svg = /<svg[^>]*\sxmlns=/.test(b.text) ? b.text : b.text.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return `<figure class="svgfig"><img alt="figure" src="data:image/svg+xml;base64,${Buffer.from(svg.trim(), 'utf8').toString('base64')}"></figure>`;
  }
  return `<pre class="cb"${b.lang ? ` data-lang="${esc(b.lang)}"` : ''}><code>${inlineSwatches(b.text, ctx)}</code></pre>`;
}

// ── specimens ───────────────────────────────────────────────────────────────────────────────────
// A table with a Specimen column is a type sheet: each row's Face, Size, Weight, Tracking, Line
// height, Case, Colour, Opacity, Style, Marker and Indent cells style that row's specimen, and its
// Element cell (h1…h6, p, div, div p, ul li, ul li li, ol li, ol li li) decides the markup it is
// set in. Headings are drawn as styled blocks, not <h1>…<h6>, so a specimen never enters the
// document outline or the contents rail.

const SPEC_FIELDS = [
  [/^(face|font|family|typeface)$/, 'face'], [/^size$/, 'size'], [/^weight$/, 'weight'],
  [/^(tracking|letter-spacing)$/, 'tracking'], [/^(line height|line-height|leading)$/, 'lh'], [/^case$/, 'case'],
  [/^colou?r$/, 'colour'], [/^opacity$/, 'opacity'], [/^style$/, 'style'], [/^marker$/, 'marker'],
  [/^indent$/, 'indent'], [/^(element|tag)$/, 'element'], [/^ground$/, 'ground'],
];
const PAGE_VARS = new Set(['bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim', 'acc', 'acc2', 'live', 'crit', 'sev']);
const MARKERS = /^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|none)$/;

function faceOf(cell) {
  for (const c of codeSpans(cell).map((x) => x.trim())) {
    if (c === '--sans' || c === '--mono') return `var(${c})`;
    if (isFontStack(c)) return c;
  }
  const p = plain(cell);
  const name = Object.keys(FAMILY_FALLBACK).find((n) => p.includes(n));
  if (name === 'IBM Plex Sans' || name === 'IBM Plex Mono') return FAMILY_FALLBACK[name];
  return name ? `"${name}",${FAMILY_FALLBACK[name]}` : null;
}

function specimenStyle(row, heads, st) {
  const f = {};
  heads.forEach((h, k) => { const hit = SPEC_FIELDS.find(([re]) => re.test(h)); if (hit) f[hit[1]] = norm(row[k] || ''); });
  const decl = [];
  const extra = [];
  let m;
  const face = f.face && faceOf(f.face);
  if (face) decl.push(`font-family:${face}`);
  if (f.size && (m = /(\d*\.?\d+)(rem|px|em)\b/.exec(f.size))) decl.push(`font-size:${m[1]}${m[2]}`);
  if (f.weight && (m = /\b([1-9]00|bold|normal)\b/.exec(f.weight))) decl.push(`font-weight:${m[1]}`);
  if (/\bitalic\b/.test(`${f.weight || ''} ${f.style || ''} ${f.face || ''}`)) decl.push('font-style:italic');
  if (f.tracking && (m = /([+-]?(?:\d+\.?\d*|\.\d+))em\b/.exec(f.tracking))) decl.push(`letter-spacing:${m[1]}em`);
  else if (f.tracking && /^\s*(normal|0)\s*$/.test(plain(f.tracking))) decl.push('letter-spacing:normal');
  if (f.lh && (m = /^\s*(\d*\.?\d+)(rem|px|em)?\b/.exec(plain(f.lh)))) decl.push(`line-height:${m[1]}${m[2] || ''}`);
  if (f.case && (m = /\b(uppercase|lowercase|capitali[sz]e|none)\b/.exec(f.case))) decl.push(`text-transform:${m[1].replace('capitalise', 'capitalize')}`);
  if (f.opacity && (m = /(?:^|\s)(0?\.\d+|1(?:\.0+)?)\b/.exec(plain(f.opacity)))) decl.push(`opacity:${m[1]}`);
  if (f.colour) {
    const token = codeSpans(f.colour).map((c) => c.trim()).find((c) => TOKEN_EXACT.test(c));
    const literal = new RegExp(COLOR_SRC).exec(f.colour);
    if (token && PAGE_VARS.has(token.slice(2))) decl.push(`color:var(${token})`);
    else if (token && st.tokens.has(token)) {
      const t = st.tokens.get(token);
      decl.push(`--sl:${canon(parseColor(t.light))};--sd:${canon(parseColor(t.dark))}`);
      extra.push('spec-tc');
    } else if (literal && parseColor(literal[0])) decl.push(`color:${canon(parseColor(literal[0]))}`);
  }
  // A Ground cell paints the specimen cell, so a mark drawn for one ground is shown on it.
  let ground = null;
  if (f.ground) {
    const token = codeSpans(f.ground).map((c) => c.trim()).find((c) => TOKEN_EXACT.test(c));
    const literal = new RegExp(COLOR_SRC).exec(f.ground);
    if (/\bdark\b/i.test(plain(f.ground))) ground = DARK.bg;
    else if (/\blight\b/i.test(plain(f.ground))) ground = LIGHT.bg;
    else if (token && PAGE_VARS.has(token.slice(2))) ground = `var(${token})`;
    else if (literal && parseColor(literal[0])) ground = canon(parseColor(literal[0]));
  }
  const list = [];
  if (f.marker && MARKERS.test(plain(f.marker))) list.push(`list-style-type:${plain(f.marker)}`);
  if (f.indent && (m = /(\d*\.?\d+)(rem|px|em)\b/.exec(f.indent))) list.push(`padding-left:${m[1]}${m[2]}`);
  return {
    element: plain(f.element || '').toLowerCase().replace(/\s+/g, ' '),
    cls: [decl.length ? st.sheet.cls(decl.join(';')) : '', ...extra].filter(Boolean).join(' '),
    listCls: list.length ? st.sheet.cls(list.join(';')) : '',
    cellCls: ground ? st.sheet.cls(`background:${ground}`) : '',
    height: f.size && (m = /(\d*\.?\d+)(rem|px|em)\b/.exec(f.size)) ? `${m[1]}${m[2]}` : null,
  };
}

function specimenHtml(cell, spec, ctx) {
  const inner = inline(cell, { ...ctx, col: 'specimen', colIndex: -1 });
  if (/<img /.test(inner)) {
    const size = spec.height ? ` ${ctx.st.sheet.cls(`height:${spec.height}`)}` : '';
    return inner.replace(/<img /g, `<img class="spec-img${size}" `);
  }
  const c = `spec ${spec.cls}`.trim();
  const lc = `spec-list ${spec.listCls}`.trim();
  const el = spec.element;
  if (/^h[1-6]$/.test(el)) return `<span class="${c} spec-block">${inner}</span>`;
  if (el === 'p') return `<p class="${c}">${inner}</p>`;
  if (el === 'div') return `<div class="${c}">${inner}</div>`;
  if (el === 'div p') return `<div class="spec-div"><p class="${c}">${inner}</p></div>`;
  const list = /^(ul|ol) li( li)?$/.exec(el);
  if (list) {
    const tag = list[1];
    if (!list[2]) return `<${tag} class="${lc}"><li class="${c}">${inner}</li><li class="${c}">${inner}</li></${tag}>`;
    return `<${tag} class="spec-list"><li class="${c}">First level<${tag} class="${lc}"><li class="${c}">${inner}</li><li class="${c}">${inner}</li></${tag}></li></${tag}>`;
  }
  return `<span class="${c} spec-inline">${inner}</span>`;
}

function tableHtml(b, ctx) {
  const heads = b.head.map((h) => plain(h).toLowerCase());
  const specCol = heads.indexOf('specimen');
  const al = (k) => (b.align[k] ? ` class="al-${b.align[k]}"` : '');
  let html = `<div class="tw${specCol >= 0 ? ' tw-spec' : ''}"><table><thead><tr>`
    + b.head.map((h, k) => `<th${al(k)}>${inline(h, { ...ctx, col: '', colIndex: -1 })}</th>`).join('')
    + '</tr></thead><tbody>';
  for (const row of b.rows) {
    const rowFont = row.flatMap(codeSpans).map((c) => c.trim()).find(isFontStack) || null;
    const spec = specCol >= 0 ? specimenStyle(row, heads, ctx.st) : null;
    html += '<tr>' + row.map((c, k) => {
      if (k === specCol) return `<td class="${`spec-cell ${spec.cellCls}`.trim()}">${specimenHtml(c, spec, ctx)}</td>`;
      const ground = heads[k] === 'dark' ? 'dark' : heads[k] === 'light' ? 'light' : null;
      const cellCls = [b.align[k] ? `al-${b.align[k]}` : '', spec && plain(c).length > 28 ? 'prose' : ''].filter(Boolean).join(' ');
      return `<td${cellCls ? ` class="${cellCls}"` : ''}>${inline(c, { ...ctx, col: heads[k], colIndex: k, rowFont, ground, specimen: Boolean(spec) })}</td>`;
    }).join('') + '</tr>';
  }
  return html + '</tbody></table></div>';
}

function paletteHtml(st) {
  if (!st.tokens.size) return '';
  const chip = (literal, ground) => {
    const rgba = parseColor(literal);
    const bg = ground === 'dark' ? DARK.bg : LIGHT.bg;
    const r = contrastRatio(canon(rgba), bg);
    return `<span class="pchip gnd-${ground} ${st.sheet.cls(`--c:${canon(rgba)}`)}" title="${esc(`${r.toFixed(2)}:1 on ${bg} (${GRADE_LABEL[grade(r)]})`)}"><span class="sw"></span><b>Aa</b><code>${esc(literal)}</code></span>`;
  };
  const rows = [...st.tokens].map(([name, t]) => `<div class="prow"><code>${esc(name)}</code>${chip(t.dark, 'dark')}${chip(t.light, 'light')}</div>`).join('');
  return `<details class="palette" open><summary>Colour tokens defined in this document (${st.tokens.size}) — dark ground, then light ground</summary><div class="pgrid">${rows}</div></details>`;
}

function renderBlocks(blocks, ctx, top = false) {
  const { st } = ctx;
  let html = '';
  for (const b of blocks) {
    const c = { ...ctx, section: `${st.h2} ${st.h3}`.toLowerCase(), col: '', colIndex: -1, ground: null, rowFont: null };
    switch (b.t) {
      case 'h': {
        if (top && b.level === 2 && !st.paletteDone) { html += paletteHtml(st); st.paletteDone = true; }
        if (b.level === 1 && !st.title) st.title = plain(b.text);
        if (b.level === 2) { st.h2 = plain(b.text); st.h3 = ''; }
        if (b.level === 3) st.h3 = plain(b.text);
        const id = slugify(b.text, st.ids);
        if (b.level === 2 || b.level === 3) st.toc.push({ level: b.level, id, text: plain(b.text) });
        const hc = { ...c, section: `${st.h2} ${st.h3}`.toLowerCase() };
        html += `<h${b.level} id="${esc(id)}">${inline(b.text, hc)}<a class="anchor" href="#${esc(id)}" aria-label="Link to this section">#</a></h${b.level}>`;
        break;
      }
      case 'p': html += `<p>${inline(b.text, c)}</p>`; break;
      case 'code': html += codeBlock(b, c); break;
      case 'hr': html += '<hr>'; break;
      case 'quote': html += `<blockquote>${renderBlocks(b.children, c)}</blockquote>`; break;
      case 'callout': html += `<div class="callout callout-${esc(b.kind)}">${renderBlocks(b.children, c)}</div>`; break;
      case 'table': html += tableHtml(b, c); break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        html += `<${tag}${start}${b.tight ? ' class="tight"' : ''}>` + b.items.map((it) => {
          const box = it.task === null ? '' : `<span class="task-box" aria-hidden="true">${it.task ? '☑' : '☐'}</span>`;
          return `<li${it.task === null ? '' : ' class="task"'}>${box}${renderBlocks(it.children, c)}</li>`;
        }).join('') + `</${tag}>`;
        break;
      }
      default: break;
    }
  }
  if (top && !st.paletteDone) { html = paletteHtml(st) + html; st.paletteDone = true; }
  return html;
}

function makeSheet() {
  const rules = new Map();
  return {
    cls(decl) {
      if (!rules.has(decl)) rules.set(decl, `v${rules.size.toString(36)}`);
      return rules.get(decl);
    },
    css: () => [...rules].map(([d, c]) => `.${c}{${d}}`).join('\n'),
  };
}

const SAFE_HREF = /^(https?:|mailto:|#)/i;
const defaultHref = (h) => (SAFE_HREF.test(h) || !/^[a-zA-Z][\w+.-]*:/.test(h) ? h : '#');

// The house marks, drawn from lib/brand-tokens.mjs rather than copied into a document where a
// second copy could drift: `![mark](cw:mark)`, `![seal](cw:seal)` and `![key](cw:key)`.
const CW_MARKS = { 'cw:mark': MARK_URI, 'cw:seal': SEAL_FAVICON, 'cw:key': KEY_FAVICON };

export function renderBody(md, { resolveHref = defaultHref, readImage = () => null, families = [] } = {}) {
  const blocks = parseMarkdown(md);
  const st = {
    sheet: makeSheet(),
    tokens: collectTokens(blocks),
    families: new Set(families),
    colours: new Set(),
    ids: new Map(),
    toc: [],
    title: '',
    h2: '',
    h3: '',
    paletteDone: false,
    lockups: 0,
    href: (h) => {
      if (/^(https?:|mailto:|#)/i.test(h)) return h;
      if (/^[a-zA-Z][\w+.-]*:/.test(h)) return '#';
      const r = resolveHref(h);
      return SAFE_HREF.test(r) || /^file:/i.test(r) || !/^[a-zA-Z][\w+.-]*:/.test(r) ? r : '#';
    },
    image: (alt, src) => {
      if (CW_MARKS[src]) return `<img alt="${esc(alt)}" src="${CW_MARKS[src]}">`;
      if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src)) return `<img alt="${esc(alt)}" src="${esc(src)}">`;
      const data = /^[a-zA-Z][\w+.-]*:/.test(src) ? null : readImage(src);
      if (data) return `<img alt="${esc(alt)}" src="${esc(data)}">`;
      return `<span class="missing" title="${esc(src)}">[image not embedded: ${esc(alt || src)}]</span>`;
    },
  };
  const body = renderBlocks(blocks, { st }, true);
  return { body, st };
}

// ── page ────────────────────────────────────────────────────────────────────────────────────────

const STAMP_RE = /<!--\s*verified-against:\s*(\d{4}-\d{2}-\d{2})(?:\s+([0-9a-f]{7,40}))?\s*-->/;
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

function pageCss(fonts, generated) {
  const faces = fonts.map((f) => {
    const format = f.format === 'truetype' ? 'truetype' : 'woff2';
    return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(data:font/${format === 'truetype' ? 'ttf' : 'woff2'};base64,${f.data}) format("${format}")}`;
  }).join('\n');
  return `${faces}
${houseTokens()}
:root{--checker:conic-gradient(#cfccc4 25%,#fff 0 50%,#cfccc4 0 75%,#fff 0) 0 0/8px 8px}
${houseBase()}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;padding:.7rem 1.25rem;background:var(--bg);background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .mark{display:inline-flex;align-items:center;gap:.31rem}
.top img.seal{width:1.5rem;height:1.5rem;display:block}
.top img.seal-d,html[data-mode=dark] .top img.seal-l{display:none}
html[data-mode=dark] .top img.seal-d{display:block}
@media (prefers-color-scheme:dark){html:not([data-mode]) .top img.seal-l{display:none}html:not([data-mode]) .top img.seal-d{display:block}}
.wm{font:700 .78rem var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--ink)}
.ttl{font-weight:600;color:var(--head)}
.src,.stamp{font:.75rem var(--mono);color:var(--mut)}
.stamp{border:1px solid var(--line2);border-radius:999px;padding:.05rem .5rem}
#theme{margin-left:auto;font:1rem var(--sans);background:var(--panel);color:var(--ink);border:1px solid var(--line2);border-radius:3px;padding:.25rem .6rem;cursor:pointer}
#theme:hover{border-color:var(--acc)}
.layout{display:grid;grid-template-columns:15rem minmax(0,1fr);gap:2.5rem;max-width:86rem;margin:0 auto;padding:1.5rem 1.25rem 5rem}
.toc{position:sticky;top:4.25rem;align-self:start;max-height:calc(100vh - 5rem);overflow:auto;font-size:.8125rem;line-height:1.45}
.toc a{display:block;color:var(--mut);text-decoration:none;padding:.2rem .5rem;border-left:2px solid var(--line)}
.toc a:hover{color:var(--ink);border-left-color:var(--acc)}
.toc a.l3{padding-left:1.25rem;font-size:.75rem}
.doc{min-width:0;max-width:64rem}
h2{font-size:1.35rem;padding-bottom:.4rem;border-bottom:1px solid var(--line)}
h3{font-size:1.05rem}
h5,h6{font-size:.9375rem}
h1,h2,h3,h4,h5,h6{scroll-margin-top:4.5rem}
.anchor{margin-left:.4rem;color:var(--dim);text-decoration:none;opacity:0}
:is(h1,h2,h3,h4,h5,h6):hover .anchor{opacity:1}
code{font:.86em var(--mono);overflow-wrap:anywhere}
pre code{overflow-wrap:normal}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:.625rem;background:var(--panel);margin:.9rem 0}
table{width:100%}
tbody tr:last-child td{border-bottom:0}
.al-center{text-align:center}.al-right{text-align:right}.al-left{text-align:left}
li>p{margin:.35rem 0}
.tight>li>p{margin:0}
li.task{list-style:none;margin-left:-1.3rem}
.task-box{margin-right:.4rem;color:var(--acc)}
.callout{border:1px solid var(--line2);border-left:3px solid var(--acc);border-radius:.5rem;padding:.3rem 1rem;margin:.9rem 0;background:var(--panel)}
figure{margin:1rem 0}
img{max-width:100%}
.missing{color:var(--crit);font:.8rem var(--mono)}
.foot{max-width:86rem;margin:0 auto;padding:1rem 1.25rem 2rem;border-top:1px solid var(--line);color:var(--dim);font:.75rem var(--mono)}
.sw,.tk{display:inline-block;width:.95em;height:.95em;border-radius:3px;vertical-align:-.14em;margin-right:.3em;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 28%,transparent)}
.sw{background:linear-gradient(var(--c),var(--c)),var(--checker)}
.tk{background:linear-gradient(135deg,var(--d) 0 50%,var(--l) 50% 100%),var(--checker);width:1.15em}
.gnd,.pchip{display:inline-flex;align-items:center;gap:.3em;padding:.1em .45em;border-radius:4px;margin-right:.35em;vertical-align:middle;font:600 .8em var(--sans);white-space:nowrap}
.gnd b,.pchip b{color:var(--c)}
.gnd .sw,.pchip .sw{margin:0}
.gnd-dark{background:${DARK.bg};box-shadow:inset 0 0 0 1px ${DARK.line2}}
.gnd-light{background:${LIGHT.bg};box-shadow:inset 0 0 0 1px ${LIGHT.line2}}
.pchip code{background:none;padding:0;font-weight:400;color:${DARK.mut}}
.gnd-light.pchip code{color:${LIGHT.mut}}
.cr{display:inline-block;font:600 .625rem/1.5 var(--mono);letter-spacing:.02em;padding:0 .35rem;border:1px solid transparent;border-radius:999px;margin-left:.3em;vertical-align:.08em;white-space:nowrap}
.cr-aaa,.cr-aa{color:var(--live);background:color-mix(in srgb,var(--live) 12%,transparent);border-color:color-mix(in srgb,var(--live) 28%,transparent)}
.cr-large{color:var(--part);background:color-mix(in srgb,var(--part) 12%,transparent);border-color:color-mix(in srgb,var(--part) 28%,transparent)}
.cr-fail{color:var(--crit);background:color-mix(in srgb,var(--crit) 12%,transparent);border-color:color-mix(in srgb,var(--crit) 28%,transparent)}
.shd{display:inline-block;width:2.6rem;height:1.5rem;border-radius:6px;background:var(--panel);margin:.4rem .6rem .4rem .5rem;vertical-align:middle}
.fsmp{display:block;margin-top:.3rem;font-size:1.05rem;line-height:1.35;color:var(--head)}
.tsz{margin-left:.6rem;font-family:var(--sans);font-weight:600;color:var(--head);line-height:1}
.wsmp{margin-left:.3rem;margin-right:.4rem;font-size:1.1rem;color:var(--head);font-family:var(--sans)}
.trk{margin:0 .5rem 0 .35rem;font:600 .625rem var(--sans);text-transform:uppercase;color:var(--mut);white-space:nowrap}
.rbox{display:inline-block;width:1.8rem;height:1.15rem;border:1.5px solid var(--acc);background:var(--wash);vertical-align:middle;margin-right:.55rem}
.pbox{display:inline-block;outline:1px dashed var(--acc);background:var(--wash);margin:.15rem .55rem .15rem 0;vertical-align:middle;line-height:1}
.pbox>span{display:block;background:var(--panel2);font:600 .75rem var(--sans);color:var(--head);padding:0 .15rem}
.osmp{display:inline-block;margin-right:.5rem;padding:0 .4rem;border:1px solid var(--line2);border-radius:3px;font-weight:600}
.mv{display:inline-block;position:relative;width:3.2rem;height:.55rem;border-radius:999px;background:var(--panel2);vertical-align:middle;margin-right:.55rem;box-shadow:inset 0 0 0 1px var(--line)}
.mv::after{content:"";position:absolute;left:0;top:0;width:.55rem;height:.55rem;border-radius:50%;background:var(--acc);transition:transform var(--dur) var(--ease)}
tr:hover .mv::after,.mv:hover::after{transform:translateX(2.65rem)}
.lh{display:inline-block;width:7.5rem;font-size:.66rem;background:var(--wash);vertical-align:middle;margin-right:.55rem;color:var(--mut)}
.mbar,.bpbar{display:inline-block;height:.4rem;background:var(--acc);border-radius:2px;vertical-align:middle;margin-right:.5rem}
.mbar{font-size:.25rem}
.bpbar{display:block;margin:.2rem 0 .35rem}
td:has(.bpbar){min-width:11rem}
.ladder{display:grid;gap:.2rem;margin:.6rem 0 .2rem;font:.7rem var(--mono);color:var(--mut)}
.ladder .st{display:flex;align-items:center;gap:.5rem}
.ladder i{display:block;height:.45rem;background:var(--acc);border-radius:1px;flex:none}
.palette{border:1px solid var(--line);border-radius:.625rem;background:var(--panel);padding:.6rem 1rem;margin:1.25rem 0}
.palette summary{cursor:pointer;font:600 .8125rem var(--sans);color:var(--head)}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(27rem,1fr));gap:.35rem 1.25rem;margin-top:.7rem}
.prow{display:grid;grid-template-columns:9.5rem auto auto;gap:.4rem;align-items:center;justify-content:start}
.prow>code{background:none;padding:0}
.ff{font-weight:inherit}
.tw-spec td{vertical-align:middle}
.tw-spec td:not(.spec-cell){white-space:nowrap}
.tw-spec td.prose{white-space:normal;min-width:12rem}
.spec-cell{min-width:16rem;max-width:26rem}
.spec{margin:0;max-width:36rem}
.spec-block{display:block}
.spec-inline{display:inline-block}
.spec-div{margin:0}
.spec-list{margin:0;padding-left:1.4rem}
.spec-list .spec-list{margin-top:.15rem}
.spec-img{display:block;width:auto;max-width:100%}
.lockup{display:grid;grid-template-columns:repeat(auto-fit,minmax(24rem,1fr));gap:.75rem;margin:1rem 0}
.lk{position:relative;border:1px solid var(--line);border-radius:.625rem;padding:1.6rem 1.1rem 1.1rem;overflow:auto;min-width:0}
.lk-cap{position:absolute;top:.45rem;right:.7rem;font:600 .625rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.lk>*+*:not(.lk-cap),.lk .cw-surface>*+*{margin-top:.75rem}
.spec-tc{color:var(--sl)}
html[data-mode=dark] .spec-tc{color:var(--sd)}
@media (prefers-color-scheme:dark){html:not([data-mode]) .spec-tc{color:var(--sd)}}
@media (max-width:900px){.layout{grid-template-columns:1fr}.toc{position:static;max-height:none}}
@media (prefers-reduced-motion:reduce){.mv::after{transition:none}}
@media print{.top,.toc{display:none}.layout{display:block}}
${generated}`;
}

export function renderPage({ md, source = '', fonts = [], resolveHref, readImage, lockupSheets = null } = {}) {
  const text = String(md);
  const stamp = STAMP_RE.exec(text);
  const { body, st } = renderBody(text, { resolveHref, readImage, families: fonts.map((f) => f.family) });
  const title = st.title || source.split('/').pop() || 'Markdown';
  const lockups = st.lockups && lockupSheets ? `\n${lockupCss(lockupSheets)}` : '';
  const css = pageCss(fonts, st.sheet.css() + lockups);
  const csp = [
    "default-src 'none'",
    "img-src data:",
    "font-src data:",
    `style-src 'sha256-${sha256b64(css)}'`,
    `script-src 'sha256-${sha256b64(FOLLOWER_JS)}' 'sha256-${sha256b64(TOGGLE_JS)}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const toc = st.toc.map((h) => `<a class="l${h.level}" href="#${esc(h.id)}">${esc(h.text)}</a>`).join('');
  const digest = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(title)}</title>
<script>${FOLLOWER_JS}</script>
<style>${css}</style>
</head><body>
<header class="top"><span class="mark"><img class="seal seal-l" alt="" src="${MARK_URI}"><img class="seal seal-d" alt="" src="${SEAL_FAVICON}"><span class="wm">commitwork</span></span><span class="ttl">${esc(title)}</span>${source ? `<span class="src">${esc(source)}</span>` : ''}${stamp ? `<span class="stamp" title="verified-against stamp">verified ${esc(stamp[1])}${stamp[2] ? ` · ${esc(stamp[2])}` : ''}</span>` : ''}<button id="theme" type="button"></button></header>
<div class="layout"><nav class="toc" aria-label="Contents">${toc}</nav><main class="doc">${body}</main></div>
<footer class="foot">${esc(source || 'markdown')} · sha256 ${digest} · ${st.tokens.size} tokens · ${st.colours.size} colours · rendered by bin/md-view.mjs</footer>
<script>${TOGGLE_JS}</script>
</body></html>
`;
  return { html, stats: { title, tokens: st.tokens.size, colours: st.colours.size, headings: st.toc.length } };
}

#!/usr/bin/env node
// Renders a costing/evaluation markdown doc to a self-contained HTML page.
// Self-contained by house rule: data inlined, file:// safe, no CDN.
//   node bin/costing-html.mjs [srcMd] [outHtml]
//
// env, read at CALL time: CW_COSTING_SRC · CW_COSTING_OUT · CW_COSTING_TILES · CW_NOW
//
// The summary tiles are an INPUT, not a constant. The figures they carry are a costing record, so
// they live with the document in the private store and arrive through CW_COSTING_TILES; a run
// without them renders the page without a tile row.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { MARK_ICON } from '../lib/brand-tokens.mjs';
import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';

const envStr = (n) => (typeof process.env[n] === 'string' && process.env[n] !== '' ? process.env[n] : null);
export const srcPath = (argv = process.argv) =>
  envStr('CW_COSTING_SRC') || argv[2] || 'evaluations/costing-scale-tiers.md';
export const outPath = (argv = process.argv) =>
  envStr('CW_COSTING_OUT') || argv[3] || 'reports/costing-scale-tiers.html';
export const stampNow = () => envStr('CW_NOW') || new Date().toISOString().slice(0, 10);

// the source deliberately carries literal <br> inside table cells — keep those
const keepBr = s => s.replace(/&lt;br\s*\/?&gt;/g, '<br>');

// NUL sentinel, written as an escape: a bare-digit placeholder would collide with ordinary
// prose (" 2 " occurs 404 times in the source doc) and silently swap text for a code span.
const SEN = "\u0000";
function inline(raw) {
  const code = [];
  let s = raw.replace(/`([^`]+)`/g, (_, c) => SEN + (code.push(c) - 1) + SEN);
  s = keepBr(esc(s));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(code[+i])}</code>`);
}

const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function render(md) {
  const lines = md.split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  const flushPara = buf => { if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`); buf.length = 0; };
  const para = [];

  while (i < lines.length) {
    const ln = lines[i];

    if (ln.startsWith('```')) {                                   // fenced code
      flushPara(para);
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(ln);
    if (h) {
      flushPara(para);
      const lvl = h[1].length, txt = h[2], id = slug(txt);
      if (lvl === 2) toc.push({ id, txt });
      out.push(`<h${lvl} id="${id}">${inline(txt)}</h${lvl}>`);
      i++; continue;
    }
    if (/^---+\s*$/.test(ln)) { flushPara(para); out.push('<hr>'); i++; continue; }

    if (ln.startsWith('|')) {                                     // table
      flushPara(para);
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const align = rows[1] && /^[\s|:-]+$/.test(rows[1])
        ? cells(rows[1]).map(c => c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : 'left')
        : null;
      const head = align ? rows.shift() : null;
      if (align) rows.shift();
      const at = n => align && align[n] ? ` style="text-align:${align[n]}"` : '';
      out.push('<table>');
      if (head) out.push('<thead><tr>' + cells(head).map((c, n) => `<th${at(n)}>${inline(c)}</th>`).join('') + '</tr></thead>');
      out.push('<tbody>' + rows.map(r => {
        const cs = cells(r);
        const blank = cs.every(c => c === '');
        return blank ? '' : '<tr>' + cs.map((c, n) => `<td${at(n)}>${inline(c)}</td>`).join('') + '</tr>';
      }).join('') + '</tbody></table>');
      continue;
    }
    if (ln.startsWith('> ')) {                                    // blockquote
      flushPara(para);
      const body = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) body.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(ln);
    if (li) {                                                     // list (flat; continuation lines fold in)
      flushPara(para);
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[3]); i++; }
        else if (/^\s+\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; }
        else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(t => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }
    if (ln.trim() === '') { flushPara(para); i++; continue; }
    para.push(ln.trim()); i++;
  }
  flushPara(para);
  return { html: out.join('\n'), toc };
}

const CSS = `${houseCss({ fonts: 'none' })}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:16px/1.65 var(--sans);
margin:0;padding:2.5rem 1.5rem 6rem;max-width:60rem;margin-inline:auto}
h1{font-size:2rem;line-height:1.2;margin:.2em 0 .1em;letter-spacing:-.02em}
h1+p{color:var(--mut);font-size:1.05rem}
h2{font-size:1.35rem;margin-top:2.4em;padding-top:.6em;border-top:1px solid var(--line);letter-spacing:-.01em;scroll-margin-top:1rem}
h3{font-size:1.08rem;margin-top:1.8em;color:var(--acc)}
h4{font-size:1rem;margin-top:1.4em}
a{color:var(--acc)}
code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:.08em .35em;font-size:.87em;
font-family:var(--mono)}
pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:1rem;overflow-x:auto}
pre code{background:none;border:0;padding:0;font-size:.84em;line-height:1.5}
table{border-collapse:collapse;width:100%;margin:1.2rem 0;font-size:.88rem}
th,td{border-bottom:1px solid var(--line);padding:.55rem .6rem;text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
td{font-variant-numeric:tabular-nums}
tbody tr:hover{background:var(--panel)}
blockquote{margin:1.2rem 0;padding:.2rem 0 .2rem 1.1rem;border-left:3px solid var(--acc);color:var(--mut)}
blockquote strong{color:var(--ink)}
hr{border:0;border-top:1px solid var(--line);margin:2.5rem 0}
ul,ol{padding-left:1.3rem}li{margin:.3em 0}
del{color:var(--mut)}
.meta{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem 1.2rem;margin:1.5rem 0;
font-size:.88rem;color:var(--mut)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.8rem;margin:1.5rem 0 2rem}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.9rem 1rem}
.tile b{display:block;font-size:1.5rem;line-height:1.15;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tile span{display:block;color:var(--mut);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;margin-top:.3rem}
.tile.hi{border-color:var(--acc)}.tile.hi b{color:var(--acc)}
nav.toc{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.9rem 1.2rem;margin:0 0 2rem;
font-size:.9rem;columns:2;column-gap:2rem}
nav.toc a{display:block;padding:.15rem 0;text-decoration:none;break-inside:avoid}
nav.toc a:hover{text-decoration:underline}
@media(max-width:640px){nav.toc{columns:1}body{padding:1.5rem 1rem 4rem}}
@media print{body{max-width:none;padding:0;color:#000;background:#fff}
h2{page-break-after:avoid}table{page-break-inside:avoid}nav.toc{display:none}}`;

/** A named tiles file must exist and parse. Absent name means no tiles; it is not a quiet empty. */
export function loadTiles(file) {
  if (!file) return [];
  const raw = readFileSync(resolve(file), 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`costing-html: ${file} does not parse (${e.message})`); }
  if (!Array.isArray(parsed)) throw new Error(`costing-html: ${file} must hold an array of tiles`);
  return parsed.map((t, n) => {
    if (!t || typeof t.value !== 'string' || typeof t.label !== 'string') {
      throw new Error(`costing-html: tile ${n} in ${file} needs a string value and label`);
    }
    return { value: t.value, label: t.label, emphasis: t.emphasis === true };
  });
}

export function buildPage({ md, title, stamp, src, tiles = [] }) {
  const { html, toc } = render(md);
  const tileRow = tiles.length
    ? `<div class="tiles">${tiles.map((t) =>
        `<div class="tile${t.emphasis ? ' hi' : ''}"><b>${esc(t.value)}</b><span>${esc(t.label)}</span></div>`).join('')}</div>`
    : '';
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">${MARK_ICON}
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<main>
${tileRow}
<nav class="toc">${toc.map(t => `<a href="#${t.id}">${inline(t.txt)}</a>`).join('')}</nav>
${html}
<div class="meta">Generated by <code>bin/costing-html.mjs</code> from <code>${esc(src)}</code> on ${stamp}.
Self-contained: no CDN, no external assets, safe over <code>file://</code>. Regenerate rather than hand-edit.</div>
</main></body></html>`;
  return { page, sections: toc.length };
}

export function main(argv = process.argv) {
  const src = srcPath(argv);
  const out = outPath(argv);
  const md = readFileSync(resolve(src), 'utf8');
  const title = (/^#\s+(.*)$/m.exec(md) || [, basename(src)])[1];
  const { page, sections } = buildPage({
    md, title, src, stamp: stampNow(), tiles: loadTiles(envStr('CW_COSTING_TILES')),
  });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), page);
  console.log(`${out}  ${(page.length / 1024).toFixed(1)} KB  ${sections} sections`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main();

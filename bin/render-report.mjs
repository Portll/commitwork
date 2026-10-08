#!/usr/bin/env node
/*
 * render-report.mjs — zero-dependency Markdown → self-contained HTML (Claude design language,
 * all CSS inlined, opens anywhere, prints cleanly to PDF).
 *
 *   node bin/render-report.mjs <in.md> <out.html> ["Document Title"]
 */
import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [, , inPath, outPath, titleArg] = process.argv;
if (!inPath || !outPath) { console.error('usage: render-report.mjs <in.md> <out.html> ["Title"]'); process.exit(1); }
// Strip HTML comments so they don't render as text. Looped to a fixed point to survive --!> and
// overlapping dashes (CodeQL js/bad-tag-filter); cosmetic only — esc() is the security boundary.
function stripComments(s) {
  let next;
  while ((next = s.replace(/<!--[\s\S]*?(?:-->|--!>)/g, '')) !== s) s = next;
  while ((next = s.replace(/<!--|-->|--!>/g, '')) !== s) s = next;
  return s;
}
const md = stripComments(readFileSync(inPath, 'utf8'));

// Quotes included — esc() is also used inside double-quoted attributes.

// ---- inline: code first (so its content isn't further processed), then links, bold, italic ----
function inline(s) {
  const code = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { code.push(c); return `\0${code.length - 1}\0`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${esc(h)}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\0(\d+)\0/g, (_, i) => `<code>${esc(code[+i])}</code>`);
  return s;
}

const lines = md.split(/\r?\n/);   // CRLF: see renderMarkdown() below — `(.*)$` cannot cross a `\r`
let html = '', i = 0;
const listStack = []; // {type:'ul'|'ol', indent}

function closeLists(toIndent = -1) {
  while (listStack.length && listStack[listStack.length - 1].indent >= toIndent) {
    html += `</li></${listStack.pop().type}>`;
  }
}

while (i < lines.length) {
  let line = lines[i];

  // fenced code block
  if (/^```/.test(line)) {
    closeLists(); const lang = line.slice(3).trim(); const buf = []; i++;
    while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
    i++;
    html += `<pre class="cb"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`;
    continue;
  }
  // ::: fenced callout (:::ins ... :::)
  if (/^:::/.test(line)) {
    closeLists(); const kind = line.slice(3).trim() || 'note'; const buf = []; i++;
    while (i < lines.length && !/^:::\s*$/.test(lines[i])) buf.push(lines[i++]);
    i++;
    html += `<div class="callout ${esc(kind)}">${renderBlock(buf.join('\n'))}</div>`;
    continue;
  }
  // table (header row followed by a |---| separator)
  if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
    closeLists();
    const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const head = cells(line); i += 2; const rows = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
    html += '<div class="tw"><table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
    continue;
  }
  // heading
  let m = line.match(/^(#{1,6})\s+(.*)$/);
  if (m) { closeLists(); const l = m[1].length; html += `<h${l}>${inline(m[2])}</h${l}>`; i++; continue; }
  // hr
  if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }
  // blockquote
  if (/^\s*>\s?/.test(line)) {
    closeLists(); const buf = [];
    while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
    html += `<blockquote>${renderBlock(buf.join('\n'))}</blockquote>`; continue;
  }
  // list item (- or 1.)
  m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
  if (m) {
    const indent = m[1].length; const type = /\d/.test(m[2]) ? 'ol' : 'ul';
    const top = listStack[listStack.length - 1];
    if (!top || indent > top.indent) { html += `<${type}>`; listStack.push({ type, indent }); }
    else { closeLists(indent); html += '</li>'; }
    html += `<li>${inline(m[3])}`; i++; continue;
  }
  // blank line
  if (/^\s*$/.test(line)) { closeLists(); i++; continue; }
  // paragraph (gather until blank)
  closeLists(); const para = [line]; i++;
  while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|:::|\s*>|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i]) && !/^\s*(---|\*\*\*)\s*$/.test(lines[i])) para.push(lines[i++]);
  html += `<p>${inline(para.join(' '))}</p>`;
}
closeLists();

// recursive helper for nested block content (callouts/blockquotes)
function renderBlock(text) {
  const saveH = html, saveS = listStack.slice(), saveL = lines.slice(), saveI = i;
  // simple re-entrancy via a fresh child render
  return renderChild(text);
}
function renderChild(text) {
  // minimal re-render for nested content: reuse a fresh pass
  const child = renderMarkdown(text);
  return child;
}
function renderMarkdown(text) {
  // full pass (shares inline()); avoids infinite recursion because callouts rarely nest callouts
  // split(/\r?\n/) — see lib/render-markdown.mjs for the measurement. `(.*)$` cannot cross a `\r`,
  // so on a CRLF checkout every heading and list item fell through to the paragraph branch and the
  // rendered report had no heading structure whatsoever.
  const L = text.split(/\r?\n/); let H = '', j = 0; const ls = [];
  const close = (to = -1) => { while (ls.length && ls[ls.length - 1].indent >= to) H += `</li></${ls.pop().type}>`; };
  while (j < L.length) {
    let ln = L[j];
    if (/^```/.test(ln)) { close(); const b = []; j++; while (j < L.length && !/^```/.test(L[j])) b.push(L[j++]); j++; H += `<pre class="cb"><code>${esc(b.join('\n'))}</code></pre>`; continue; }
    if (/^\s*\|.*\|\s*$/.test(ln) && j + 1 < L.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(L[j + 1]) && L[j + 1].includes('-')) {
      close(); const cc = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const hd = cc(ln); j += 2; const rs = []; while (j < L.length && /^\s*\|.*\|\s*$/.test(L[j])) rs.push(cc(L[j++]));
      H += '<div class="tw"><table><thead><tr>' + hd.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' + rs.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>'; continue;
    }
    let mm = ln.match(/^(#{1,6})\s+(.*)$/); if (mm) { close(); H += `<h${mm[1].length}>${inline(mm[2])}</h${mm[1].length}>`; j++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(ln)) { close(); H += '<hr>'; j++; continue; }
    mm = ln.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (mm) { const ind = mm[1].length, ty = /\d/.test(mm[2]) ? 'ol' : 'ul'; const t = ls[ls.length - 1]; if (!t || ind > t.indent) { H += `<${ty}>`; ls.push({ type: ty, indent: ind }); } else { close(ind); H += '</li>'; } H += `<li>${inline(mm[3])}`; j++; continue; }
    if (/^\s*$/.test(ln)) { close(); j++; continue; }
    close(); const p = [ln]; j++; while (j < L.length && !/^\s*$/.test(L[j]) && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s|\s*\|)/.test(L[j])) p.push(L[j++]); H += `<p>${inline(p.join(' '))}</p>`;
  }
  close(); return H;
}

const title = titleArg || (md.match(/^#\s+(.*)$/m) || [])[1] || basename(inPath);

const css = () => `
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
body{font-size:1rem;line-height:1.65;font-feature-settings:"kern","liga"}
.wrap{max-width:51.25rem;margin:0 auto;padding:4rem 1.75rem 7.5rem}
h1,h2,h3,h4{line-height:1.2}
h1{font-size:2.1rem;margin:0 0 .3em;letter-spacing:-.01em}
h2{font-size:1.5rem;margin:2.2em 0 .5em;padding-bottom:.25em;border-bottom:1px solid var(--line)}
h3{font-size:1.18rem;margin:1.8em 0 .4em}
h4{font-size:1rem;margin:1.4em 0 .3em}
p{margin:.7em 0}
pre.cb{font-size:.84rem;line-height:1.5}
.tw{overflow-x:auto;margin:1.1em 0}
table{font-size:.92rem}
.callout{margin:1.2em 0;padding:2px 1.125rem;border-radius:.5625rem;border:1px solid var(--line);background:var(--panel)}
.callout.ins{background:color-mix(in srgb,var(--live) 8%,var(--panel));border-color:color-mix(in srgb,var(--live) 35%,transparent)}
.callout.ins>*:first-child{margin-top:.7em}
.callout.ins strong:first-child,.callout.ins p:first-child strong{color:var(--live)}
.masthead{margin:0 0 2.4em;padding-bottom:1.4em;border-bottom:2px solid var(--acc)}
.masthead .kicker{font-size:.74rem;text-transform:uppercase;letter-spacing:.14em;color:var(--acc);font-weight:600}
.masthead .meta{color:var(--mut);font-size:.86rem;margin-top:.4em}
@media print{body{background:#fff}.wrap{padding:0 0 2.5rem}a{text-decoration:none;color:inherit}h2{border-color:#ccc}.callout{break-inside:avoid}}
@media(max-width:640px){.wrap{padding:2.25rem 1.125rem 5rem}h1{font-size:1.7rem}}
`;

const out = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${css()}</style></head>
<body><main class="wrap">${html}</main></body></html>`;

writeFileSync(outPath, out);
console.log(`rendered ${basename(inPath)} -> ${basename(outPath)} (${(out.length / 1024).toFixed(0)} KB)`);

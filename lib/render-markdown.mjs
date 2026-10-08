// render-markdown.mjs — zero-dependency Markdown -> HTML, ported from bin/render-report.mjs's
// parser (headings, lists, tables, fenced code, blockquotes, ::: callouts, inline code/bold/
// italic/links, plus strikethrough ~~x~~, underline __x__, superscript ^x^ and subscript ~x~,
// added for the docsite editor's formatting toolbar — bin/render-report.mjs does not carry these,
// staying a deliberate fork rather than growing in lockstep). esc() is the security boundary —
// every text/attribute path goes through it before reaching the DOM. Kept as a deliberate PORT,
// not a shared import from render-report.mjs:
// that file is a tested CLI tool with its own passing suite, and generate.mjs's chunk content may
// be untrusted (arbitrary diffed Markdown) in a way render-report.mjs's inputs never were — this
// module exists so a change here can't silently perturb that tool, and vice versa.
//
// Pure functions only (no fs/process). Originally generate-time-only (Node-side, embedding
// already-rendered HTML into a static artifact); now also served verbatim to the browser as the
// docsite editor's live-preview parser, so esc()'s escaping must hold under that second, more
// adversarial calling context too — untrusted content authored interactively, not just diffed.

import { esc } from './html-escape.mjs';

export { esc };

// code first (so its content isn't further processed), then links, bold, strike, underline, sup,
// sub, italic. href is escaped via esc() same as any other attribute value — this is the exact
// boundary breakers' pass flagged for re-verification before reuse on untrusted diff content;
// confirmed here, and re-confirmed for each mark added since (every replacement below inserts a
// FIXED tag name, never text from the match, around content this function already esc()'d).
//
// Strike (~~) runs before underline/sub so a stray single ~ next to a real ~~...~~ pair can't be
// misread as a subscript delimiter — sub's own pattern only ever sees what strike left behind.
export function inline(s) {
  const code = [];
  let out = String(s).replace(/`([^`]+)`/g, (_, c) => { code.push(c); return `\0${code.length - 1}\0`; });
  out = esc(out);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${esc(h)}">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  out = out.replace(/__([^_]+)__/g, '<u>$1</u>');
  out = out.replace(/\^([^^\s]+)\^/g, '<sup>$1</sup>');
  out = out.replace(/~([^~\s]+)~/g, '<sub>$1</sub>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\0(\d+)\0/g, (_, i) => `<code>${esc(code[+i])}</code>`);
  return out;
}

// Strip HTML comments so they don't render as text. Looped to a fixed point to survive `--!>` and
// overlapping dashes (CodeQL js/bad-tag-filter); cosmetic only — esc() is the actual security
// boundary. Run this before renderMarkdown() on any untrusted input.
export function stripComments(s) {
  let next;
  let out = String(s);
  while ((next = out.replace(/<!--[\s\S]*?(?:-->|--!>)/g, '')) !== out) out = next;
  while ((next = out.replace(/<!--|-->|--!>/g, '')) !== out) out = next;
  return out;
}

export function renderMarkdown(text) {
  // `split(/\r?\n/)`. Under a CRLF checkout every line ended `\r`, and this renderer's block
  // matchers are anchored `(.*)$` — `.` does not match `\r`, `$` without `m` matches only the end
  // of the string, so NO heading and NO list item ever matched. They fell through to the paragraph
  // branch. Measured by rendering this repo's own README on Windows: 25 paragraphs beginning with
  // a literal `#`, and zero h1/h2/h3 in the entire document. Every generated HTML report produced
  // on Windows had no heading structure at all — which is also its navigation and its outline.
  // Markdown input is normalised rather than preserved: the output is HTML, so the input's line
  // ending carries no meaning past this point.
  const lines = String(text).split(/\r?\n/);
  let html = '';
  let i = 0;
  const listStack = []; // {type:'ul'|'ol', indent}

  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent >= toIndent) {
      html += `</li></${listStack.pop().type}>`;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      closeLists();
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<pre class="cb"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    if (/^:::/.test(line)) {
      closeLists();
      const kind = line.slice(3).trim() || 'note';
      const buf = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<div class="callout ${esc(kind)}">${renderMarkdown(buf.join('\n'))}</div>`;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length
      && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      closeLists();
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      html += '<div class="tw"><table><thead><tr>'
        + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table></div>';
      continue;
    }
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) { closeLists(); const l = m[1].length; html += `<h${l}>${inline(m[2])}</h${l}>`; i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`;
      continue;
    }
    m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (m) {
      const indent = m[1].length;
      const type = /\d/.test(m[2]) ? 'ol' : 'ul';
      const top = listStack[listStack.length - 1];
      if (!top || indent > top.indent) { html += `<${type}>`; listStack.push({ type, indent }); }
      else {
        // A sibling closes only the lists DEEPER than itself. Closing its own level too ended the
        // list after every item, so alternate items nested inside their predecessor.
        closeLists(indent + 1);
        const cur = listStack[listStack.length - 1];
        if (cur && cur.indent === indent && cur.type === type) html += '</li>';
        else {
          if (cur && cur.indent === indent) html += `</li></${listStack.pop().type}>`;
          html += `<${type}>`;
          listStack.push({ type, indent });
        }
      }
      html += `<li>${inline(m[3])}`;
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) { closeLists(); i++; continue; }
    closeLists();
    const para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i])
      && !/^(#{1,6}\s|```|:::|\s*>|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i])
      && !/^\s*(---|\*\*\*)\s*$/.test(lines[i])) para.push(lines[i++]);
    html += `<p>${inline(para.join(' '))}</p>`;
  }
  closeLists();
  return html;
}

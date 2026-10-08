#!/usr/bin/env node
// Render docs/TOP-100.md to a self-contained HTML page.
//
// The markdown stays the source of truth and the spare: this writes a GENERATED artifact and never
// edits the .md. Regenerate rather than hand-edit the output.
//
// Self-contained by house rule — data inlined, no CDN, no webfont, opens over file://. The palette
// is the one bin/projectstatus.mjs already renders with, so the two artifacts read as one system.
//
// The one thing this does beyond formatting: it COLOURS the Evidence verdicts. The document's whole
// claim is about which evidence was actually checked, and a wall of monochrome prose is the worst
// possible carrier for that. Provable reads green, Provable (uninstalled) amber, Indicative violet,
// Unobservable grey — so a reader sees the coverage shape before reading a word of it.
//
// usage: node bin/top100-html.mjs [--in docs/TOP-100.md] [--out reports/top-100.html] [--stdout]

import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };

const IN = resolve(CW, arg('--in', 'docs/TOP-100.md'));
const OUT = resolve(CW, arg('--out', 'reports/top-100.html'));
// Determinism: honour CW_NOW so a pinned run is byte-identical.
const NOW = process.env.CW_NOW ? new Date(process.env.CW_NOW) : new Date();


// ── inline ──────────────────────────────────────────────────────────────────────────────────────
// Code spans are lifted out first so nothing formats inside them, then restored last.
function inline(src) {
  const code = [];
  let s = String(src).replace(/`([^`]+)`/g, (_, c) => `\0${code.push(c) - 1}\0`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\0(\d+)\0/g, (_, i) => `<code>${esc(code[Number(i)])}</code>`);
}

// ── block ───────────────────────────────────────────────────────────────────────────────────────
let seenTitle = false;   // module-scoped: render() recurses for blockquotes and must not reset it

function render(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');
  const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => inline(c.trim()));

  while (i < lines.length) {
    const l = lines[i];

    if (/^<!--/.test(l)) { i++; continue; }                       // the verified-against stamp
    if (!l.trim()) { i++; continue; }

    if (/^#{1,4}\s/.test(l)) {
      let n = l.match(/^#+/)[0].length;
      const text = l.replace(/^#+\s*/, '');
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      // The source uses `#` for the title AND for every domain, which is correct markdown outline
      // structure but renders as twenty competing page titles. Demote every h1 after the first so
      // the document has one title and the domains read as its sections.
      if (n === 1) { if (seenTitle) n = 2; else seenTitle = true; }
      out.push(`<h${n} id="${id}">${inline(text)}</h${n}>`);
      i++; continue;
    }

    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }

    // pipe table
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l); i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { body.push(cells(lines[i])); i++; }
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`
        + body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>');
      continue;
    }

    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // indented code block (4 spaces), used for the sandbox flag listing
    if (/^ {4}\S/.test(l)) {
      const buf = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) {
        if (!lines[i].trim() && !(i + 1 < lines.length && /^ {4}/.test(lines[i + 1]))) break;
        buf.push(lines[i].replace(/^ {4}/, '')); i++;
      }
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s/.test(l)) {
      const ordered = /^\s*\d+\.\s/.test(l);
      const items = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^\s*([-*]|\d+\.)\s/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();          // wrapped continuation
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    // paragraph: join wrapped lines
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|---+\s*$|\s*([-*]|\d+\.)\s)/.test(lines[i])
           && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
    else i++;
  }
  return out.join('\n');
}

// ── the point of the document, made visible ─────────────────────────────────────────────────────
// Longest first: "Provable (uninstalled)" must not be eaten by the "Provable" rule.
const VERDICTS = [
  ['Provable (uninstalled)', 'amber'],
  ['Provable (deep)', 'amber'],
  ['Provable', 'green'],
  ['Indicative', 'violet'],
  ['Unobservable', 'grey'],
  ['Partial', 'amber'],
];
function colourVerdicts(html) {
  let s = html;
  for (const [word, cls] of VERDICTS) {
    s = s.split(`<strong>${word}</strong>`).join(`<span class="v v-${cls}"><i></i>${word}</span>`);
  }
  return s;
}

// Counted from the source, never hardcoded — the document's own discipline.
//
// Count each row's PRIMARY verdict, i.e. the first one on its metadata line. Six entries carry a
// context-dependent pair ("Provable for the platform · Unobservable for first-party flows"), and
// tallying every mention instead of the first double-counts them: the first draft of this function
// reported 36 Unobservable against the document's own table of 32, and 0 uninstalled because the
// parenthetical never matched. A footer that disagrees with the table above it is exactly the
// defect this document exists to prevent, so the two must be computed the same way.
export function tally(md) {
  const rows = md.split('\n').filter((l) => /^`(Flaw|Gap|Process)`/.test(l));
  const bucket = { classes: rows.length, provable: 0, uninstalled: 0, indicative: 0, unobservable: 0, partial: 0 };
  const KEY = {
    'Provable (uninstalled)': 'uninstalled', 'Provable (deep)': 'uninstalled',
    Provable: 'provable', Indicative: 'indicative', Unobservable: 'unobservable', Partial: 'partial',
  };
  for (const row of rows) {
    // longest-first, lowest index wins — "Provable (uninstalled)" must not resolve to "Provable"
    let best = null, bestAt = Infinity;
    for (const [word, key] of Object.entries(KEY)) {
      const at = row.indexOf(`**${word}**`);
      if (at > -1 && (at < bestAt || (at === bestAt && word.length > best.word.length))) {
        best = { word, key }; bestAt = at;
      }
    }
    if (best) bucket[best.key]++;
  }
  return bucket;
}

// Guarded: the test imports tally(), and an unguarded import rendered and overwrote reports/top-100.html.
if (isMainModule(import.meta.url)) main();

function main() {
const md = readFileSync(IN, 'utf8');
const stamp = (md.match(/verified-against:\s*([0-9-]+)\s+([0-9a-f]+)/) || [])[1] || 'unstamped';
const t = tally(md);
const body = colourVerdicts(render(md));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The commitwork Top 100 — vulnerability classes</title>
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
body{font-size:1rem;line-height:1.65;padding:2.5rem 1.5rem 6rem;max-width:56rem;margin-inline:auto}
h1{font-size:2rem;line-height:1.2;margin:.2em 0 .1em;letter-spacing:-.02em}
h1+p{color:var(--mut);font-size:1.05rem}
h2{font-size:1.35rem;margin-top:2.4em;padding-top:.6em;border-top:1px solid var(--line);letter-spacing:-.01em}
h3{font-size:1.08rem;margin-top:1.8em}
h4{font-size:1rem;margin-top:1.4em}
code{font-size:.87em}
pre code{font-size:.84em;line-height:1.5}
table{margin:1.2rem 0;font-size:.9rem}
blockquote{margin:1.2rem 0;padding:.2rem 0 .2rem 1.1rem;border-left:3px solid var(--acc2);color:var(--mut)}
blockquote strong{color:var(--ink)}
hr{border:0;border-top:1px solid var(--line);margin:2.5rem 0}
ul,ol{padding-left:1.3rem}li{margin:.3em 0}
del{color:var(--mut)}
.v{display:inline-block;white-space:nowrap;font-size:.83em;font-weight:600;padding:.1em .5em .1em .45em;
border-radius:999px;border:1px solid var(--line);background:var(--panel)}
.v i{display:inline-block;width:.55em;height:.55em;border-radius:50%;margin-right:.4em;vertical-align:baseline}
.v-green i{background:var(--live)}.v-amber i{background:var(--part)}.v-grey i{background:var(--plan)}
/* Indicative is weaker evidence than a proof, so it is a greyed green. Not --sev: that violet is
   reserved for "actively exploited" (docs/THEME.md §3.4). */
.v-violet i{background:color-mix(in srgb,var(--live) 45%,var(--plan))}
.meta{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem 1.2rem;margin:1.5rem 0;
font-size:.88rem;color:var(--mut)}
.tally{display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;margin:.6rem 0 0;padding:0;list-style:none}
.tally li{margin:0;font-variant-numeric:tabular-nums}
.tally b{color:var(--ink);font-size:1.15em}
@media print{body{max-width:none;padding:0;color:#000;background:#fff}h2{page-break-after:avoid}table{page-break-inside:avoid}}
</style></head><body>
${body}
<div class="meta">
<b>Generated by</b> <code>node bin/top100-html.mjs</code> from <code>docs/TOP-100.md</code>, which
remains the source and the spare — regenerate this page, never hand-edit it.
Source stamped <code>verified-against ${esc(stamp)}</code>; rendered ${esc(NOW.toISOString().slice(0, 10))}.
<ul class="tally">
<li><b>${t.classes}</b> classes</li>
<li><span class="v v-green"><i></i>Provable</span> <b>${t.provable}</b></li>
<li><span class="v v-amber"><i></i>Uninstalled</span> <b>${t.uninstalled}</b></li>
<li><span class="v v-violet"><i></i>Indicative</span> <b>${t.indicative}</b></li>
<li><span class="v v-grey"><i></i>Unobservable</span> <b>${t.unobservable}</b></li>
</ul>
</div>
</body></html>
`;

if (process.argv.includes('--stdout')) { process.stdout.write(html); }
else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeAtomic(OUT, html);
  console.log(`top100-html: wrote ${OUT.replace(CW + '/', '')} · ${t.classes} classes · `
    + `${t.provable} provable · ${t.uninstalled} uninstalled · ${t.indicative} indicative · ${t.unobservable} unobservable`);
}
}

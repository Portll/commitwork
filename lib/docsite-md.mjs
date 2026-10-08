// docsite-md.mjs — the docsite's Markdown dialect: render-markdown.mjs plus two docsite-specific
// passes. Pure functions, browser-safe (this file and ./render-markdown.mjs are served verbatim to
// the authed editor as /edit-assets/*, so the live preview and the published page render through
// byte-identical code — bin/test/docsite-parity.test.mjs holds that equivalence).
//
// fact: ```svg fences become <img src="data:image/svg+xml;base64,..."> rather than inline SVG /
//   an image context executes no scripts, runs no foreignObject, fires no event handlers, so the
//   figure needs no sanitizer to be inert — a hand-rolled SVG sanitizer would be a weaker gate
//   pretending to be a stronger one (expiry: when a reviewed sanitizer replaces it, if richer
//   figures are ever needed)
// fact: hrefs with a scheme outside https/http/mailto are disarmed after render / esc() escapes
//   an href's characters but leaves its scheme live, so [x](javascript:...) would survive it;
//   authors are authenticated operators, making this defense in depth, not the primary gate
//   (expiry: never)

import { esc, stripComments, renderMarkdown } from './render-markdown.mjs';

const b64utf8 = (s) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

// Allow schemeless (relative, #fragment, /path) and https/http/mailto; disarm everything else.
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_SCHEMES = /^(https?|mailto):/i;
export function guardHrefs(html) {
  return html.replace(/href="([^"]*)"/g, (whole, v) => {
    if (!SCHEME_RE.test(v) || SAFE_SCHEMES.test(v)) return whole;
    return 'href="#" data-blocked-scheme=""';
  });
}

// References: `[^key]` cites, `[^key]: Title | URL | Description` defines (Description optional).
// Definitions are pulled out of the line stream wherever they appear — like the svg fences below,
// they never render as paragraph text — and the citations they satisfy render as a numbered,
// linked superscript in ORDER OF FIRST CITATION (auto-renumbered: the key is a stable label the
// author picks, the displayed number is purely positional). A generated References section is
// appended at the bottom of the document, one entry per key that was actually cited, in that same
// number order — a defined-but-never-cited entry has no number to receive and is omitted, the same
// way an unused footnote definition is in every footnote convention this is modelled on.
//
// A citation to an undeclared key renders as its own visible, grey state rather than vanishing or
// silently becoming plain text — the explicit uncertainty rule applied to markup, not findings.
//
// Known limitation, not a security one: this substitutes citation markers on the RAW markdown text
// (same stage as the svg-fence extraction below), so `` `[^key]` `` written to show the syntax
// literally inside inline code still gets substituted — esc()/guardHrefs() still make the result
// safe either way, this is a display nit, not a hole.
const REF_DEF_RE = /^\[\^([A-Za-z0-9_-]+)\]:\s*(.+)$/;
const REF_CITE_RE = /\[\^([A-Za-z0-9_-]+)\]/g;

function parseRefDef(rest) {
  const parts = rest.split('|').map((p) => p.trim());
  const [title, url, ...descParts] = parts;
  return { title: title || '', url: url || '', description: descParts.join('|').trim() };
}

// ```svg fences: pre-extract (so the parser doesn't render them as code), embed as inert images.
// The placeholder is alphanumeric so it passes esc()/inline() untouched.
export function renderDocBody(md) {
  const svgs = [];
  const refDefs = new Map(); // key -> {title, url, description}
  const lines = stripComments(String(md)).split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^```svg\s*$/.test(lines[i])) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      const src = buf.join('\n').trim();
      if (/^<svg[\s>]/.test(src)) {
        kept.push('', `CWSVGFIG${svgs.length}TOKEN`, '');
        svgs.push(src);
      } else {
        // Not an <svg> root: refuse to embed, keep it visible as a code block — a figure that
        // cannot be trusted renders as its source, never silently vanishes.
        kept.push('```', ...buf, '```');
      }
      continue;
    }
    const refDef = REF_DEF_RE.exec(lines[i]);
    if (refDef) { refDefs.set(refDef[1], parseRefDef(refDef[2])); continue; } // pulled out, not kept
    kept.push(lines[i]);
  }

  // Number by first citation order, BEFORE renderMarkdown touches the text — inline()'s own
  // regexes never match `[^key]` (no `(...)` follows, and it has only one caret, not the two the
  // new sup/sub marks require), so citation markers survive rendering completely untouched and
  // are safe to substitute afterward with a straightforward string-level pass.
  const order = [];
  for (const m of kept.join('\n').matchAll(REF_CITE_RE)) if (!order.includes(m[1])) order.push(m[1]);
  const numberOf = new Map(order.map((k, i) => [k, i + 1]));

  let html = renderMarkdown(kept.join('\n'));
  html = html.replace(/<p>CWSVGFIG(\d+)TOKEN<\/p>/g, (_, i) => {
    const src = svgs[+i];
    if (src === undefined) return '';
    return `<figure class="svgfig"><img alt="figure" src="data:image/svg+xml;base64,${b64utf8(src)}"></figure>`;
  });
  html = html.replace(REF_CITE_RE, (_, key) => {
    const n = numberOf.get(key);
    if (refDefs.has(key)) return `<sup class="ref-cite"><a href="#ref-${esc(key)}" id="cite-${esc(key)}">[${n}]</a></sup>`;
    return `<sup class="ref-cite ref-undefined" title="undefined reference: ${esc(key)}">[${esc(key)}?]</sup>`;
  });
  const cited = order.filter((k) => refDefs.has(k));
  if (cited.length) {
    const items = cited.map((key) => {
      const r = refDefs.get(key);
      const linkOut = r.url ? ` <a class="ref-link" href="${esc(r.url)}" target="_blank" rel="noopener" aria-label="Open source">↗</a>` : '';
      return `<li id="ref-${esc(key)}"><a href="#cite-${esc(key)}" class="ref-back">[${numberOf.get(key)}]</a> `
        + `<span class="ref-title">${esc(r.title)}</span>${linkOut}`
        + (r.description ? `<p class="ref-desc">${esc(r.description)}</p>` : '')
        + `</li>`;
    }).join('');
    html += `<section class="references"><h2>References</h2><ol class="reflist">${items}</ol></section>`;
  }
  return guardHrefs(html);
}

export { esc, stripComments };

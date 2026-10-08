#!/usr/bin/env node
// usage: taxonomy-web.mjs [--out <path>] [--check] [--quiet]
// env, read at call time: CW_TAXONOMY_JSON, CW_TAXONOMY_EDITIONS, CW_NOW
//
// fact: this renders the ARGUMENT plus the edition history / taxonomy-render.mjs renders the class reference (expiry: if the two merge, prev: not built)
// fact: refuses to publish a lineage that does not account for exactly the registry's classes / a version history that cannot add up is the M7 this taxonomy files against itself (expiry: never, prev: not built)
// fact: a class no edition claims renders in its own block, never folded into the newest (expiry: never, prev: wrong)
// fact: brand tokens and nav are READ from lib/docsite-page.mjs and docsite/manifest.json / this
//   page ships inside the docsite as imported/taxonomy.html (a draft, in the private root), so it carries the docsite's
//   own palette and cross-links rather than a second, independent brand kit that only this one
//   page would use (expiry: never, prev: pointed at a sibling commitwork-web checkout that was
//   never built — the palette/shell/wordmark it wanted never existed under that path)
import { esc } from '../lib/html-escape.mjs';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { validateAgainstSchema } from '../monitor/registry.mjs'; // the one schema validator
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { CSS as DOCSITE_CSS } from '../lib/docsite-page.mjs';
import { MARK_IMG } from '../lib/brand-tokens.mjs';
import { snapshotBeforeWrite } from '../lib/docsite-versions.mjs';
import { privateRoot, docsiteRoot } from '../lib/docsite-roots.mjs';
import { redactForPublish } from '../lib/publish-redactions.mjs';
import { redactScannersForPublish } from '../lib/publish-scanner-redactions.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
};
const registryPath = () => process.env.CW_TAXONOMY_JSON || resolve(REPO, 'monitor', 'failure-taxonomy.json');
const editionsPath = () => process.env.CW_TAXONOMY_EDITIONS || resolve(REPO, 'monitor', 'taxonomy-editions.json');
const manifestPath = () => process.env.CW_DOCSITE_MANIFEST || resolve(REPO, 'docsite', 'manifest.json');
const nowStamp = () => process.env.CW_NOW || new Date().toISOString().slice(0, 10);

function readOrDie(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`${what} unreadable at ${path}: ${e.code || e.message}. This input is required; rendering without it would publish a page that silently is not the site's.`);
  }
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- reconciliation

const CLASS_CHANGE = 'classes';

// fact: errors make the page a lie, unattributed makes it incomplete / the page states which classes and why (expiry: never, prev: not built)
export function reconcile(registry, lineage) {
  const errors = [];
  const ids = registry.classes.map((c) => c.id);
  const known = new Set(ids);
  const byClass = new Map();
  const claimedTwice = [];

  const editions = [...lineage.editions].sort((a, b) => a.version - b.version);
  let running = 0;
  for (const ed of editions) {
    let added = 0;
    for (const ch of ed.changes || []) {
      if (ch.kind !== CLASS_CHANGE) continue;
      for (const id of ch.ids || []) {
        if (byClass.has(id)) claimedTwice.push(`${id} (v${byClass.get(id)} and v${ed.version})`);
        else byClass.set(id, ed.version);
        if (!known.has(id) && !ch.retired) {
          errors.push(`v${ed.version} claims to introduce ${id}, which the registry does not hold. Either the class was renamed or removed without the lineage moving, or the id is wrong; both are claim drift in the document whose subject is claim drift.`);
        }
        added += 1;
      }
    }
    running += added;
    ed.computedAfter = running;
    ed.addedCount = added;
    if (typeof ed.countAfter === 'number' && ed.countAfter !== running) {
      errors.push(`v${ed.version} declares countAfter ${ed.countAfter}; the ids across every edition up to it sum to ${running}. A version history that does not add up cannot be checked by the reader it is for.`);
    }
  }
  if (claimedTwice.length) errors.push(`Classes claimed by more than one edition: ${claimedTwice.join(', ')}. Each class enters the catalogue once.`);

  const unattributed = ids.filter((id) => !byClass.has(id));
  return { editions, byClass, unattributed, errors };
}

// ---------------------------------------------------------------- html helpers

const attr = (s) => esc(s).replace(/"/g, '&quot;');
// fact: <wbr> not U+200B / a zero-width space lands in the copy buffer and in every plain-text search (expiry: never, prev: wrong)
const wrapId = (s) => esc(s).replace(/([._])/g, '$1<wbr>');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// fact: the bound is read from scaleBounds / it was hardcoded in four places and one gated on >= 5 against a 0-4 scale (expiry: never, prev: broken)
function dial(value, max, kind, label) {
  const C = 2 * Math.PI * 5;
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const on = (frac * C).toFixed(2);
  const off = (C - frac * C).toFixed(2);
  const stroke = kind === 'closure' ? (value >= max ? 'var(--ok)' : 'var(--acc2)') : 'var(--mut)';
  const title = `${kind}: ${value} of ${max} — ${label}`;
  return `<svg class="dial" viewBox="0 0 14 14" width="14" height="14" role="img" aria-label="${attr(title)}"><title>${esc(title)}</title>`
    + `<circle cx="7" cy="7" r="5" fill="none" stroke="var(--line)" stroke-width="2"/>`
    + (frac > 0 ? `<circle cx="7" cy="7" r="5" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="butt" stroke-dasharray="${on} ${off}" transform="rotate(-90 7 7)"/>` : '')
    + `</svg>`;
}

const CLOSURE_WORDS = ['nothing stands between us and this class', 'barely', 'part-solved', 'largely solved', 'fixed and pinned by a test or canary'];
const GAIN_WORDS = ['nothing further on the table', 'small', 'moderate', 'large', 'the largest remaining win'];
const word = (list, v) => list[Math.max(0, Math.min(list.length - 1, v))];
// fact: every step shown, not the endpoints / 0 and 4 alone leave the reader guessing thirds or quarters (expiry: never, prev: unknown)
const scaleStrip = (max, kind, words) =>
  `<span class="scale">${Array.from({ length: max + 1 }, (_, i) => `${dial(i, max, kind, word(words, i))}<i>${i}</i>`).join('')}</span>`;

// ---------------------------------------------------------------- page

// fact: the nav is built from docsite/manifest.json's published docs, never a hand-kept second
//   list / a manifest already exists as the one place "what's published" is decided, and a second
//   list here is the thing that stops matching it (expiry: never, prev: not built)
function docsiteNav(manifest, currentUrlPath) {
  const links = manifest.docs
    .filter((d) => d.state === 'published')
    .map((d) => `<a href="/${esc(d.urlPath)}/"${d.urlPath === currentUrlPath ? ' aria-current="page"' : ''}>${esc(d.title)}</a>`)
    .join('');
  return `<header class="site"><a class="brand" href="/">${MARK_IMG}commitwork docs</a><nav>${links}</nav></header>`;
}

function renderPage({ registry, lineage, joined, nav, generatedAt, sources }) {
  const B = registry.scaleBounds;
  if (!B || typeof B.closureMax !== 'number' || typeof B.gainMax !== 'number') {
    throw new Error('registry has no usable scaleBounds — the dials size themselves from it, and a guessed bound is how a guard stops guarding.');
  }
  const famOf = Object.fromEntries(registry.families.map((f) => [f.prefix, f]));
  const byFamily = new Map(registry.families.map((f) => [f.prefix, []]));
  for (const c of registry.classes) {
    if (!byFamily.has(c.id[0])) throw new Error(`${c.id}: no family declares prefix ${c.id[0]}`);
    byFamily.get(c.id[0]).push(c);
  }
  for (const list of byFamily.values()) list.sort((a, b) => +a.id.slice(1) - +b.id.slice(1));

  const V = registry.stpaVocabulary;
  const editionOf = joined.byClass;
  const total = registry.classes.length;

  // ---- edition timeline
  const kindLabel = { classes: 'classes', axis: 'axis', field: 'field', section: 'section', family: 'family', form: 'form', instrument: 'instrument', projection: 'projection', binding: 'binding' };
  const editionCard = (ed, i, prev) => {
    const chips = [];
    for (const ch of ed.changes || []) {
      if (ch.kind === CLASS_CHANGE) {
        chips.push(`<div class="chg chg-classes">
          <div class="chg-h"><span class="chg-k">+${ch.ids.length} ${ch.ids.length === 1 ? 'class' : 'classes'}</span>${ch.date && ch.date !== ed.date ? `<span class="chg-d">${esc(ch.date)}</span>` : ''}${ch.commit ? `<code class="sha">${esc(ch.commit)}</code>` : ''}</div>
          <div class="ids">${ch.ids.map((id) => `<a class="idchip" href="#${slug(id)}" data-id="${attr(id)}">${esc(id)}</a>`).join('')}</div>
          ${ch.note ? `<p class="chg-n">${esc(ch.note)}</p>` : ''}
        </div>`);
      } else {
        chips.push(`<div class="chg">
          <div class="chg-h"><span class="chg-k k-${esc(ch.kind)}">${esc(kindLabel[ch.kind] || ch.kind)}</span><b>${esc(ch.label || '')}</b>${ch.date && ch.date !== ed.date ? `<span class="chg-d">${esc(ch.date)}</span>` : ''}${ch.commit ? `<code class="sha">${esc(ch.commit)}</code>` : ''}</div>
          ${ch.note ? `<p class="chg-n">${esc(ch.note)}</p>` : ''}
        </div>`);
      }
    }
    const delta = ed.addedCount > 0 ? `<span class="delta"><span class="was">${prev}</span> → <b>${ed.computedAfter}</b> classes</span>` : `<span class="delta same">${ed.computedAfter} classes, unchanged</span>`;
    const w = ed.countWitness;
    return `<article class="ed" id="ed-v${ed.version}" data-version="${attr(String(ed.version))}">
      <div class="ed-rail"><span class="vbadge">v${esc(String(ed.version))}</span></div>
      <div class="ed-body">
        <div class="ed-top">
          <h3>${esc(ed.label)}</h3>
          <span class="ed-date">${esc(ed.date)}</span>
          ${delta}
        </div>
        ${''/* nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -- only esc()-escaped text and numeric counts are interpolated */}<p class="ed-head">${esc(ed.headline)}</p>
        <p class="ed-text">${esc(ed.body)}</p>
        <div class="chgs">${chips.join('')}</div>
        ${ed.versionDrift ? `<p class="ed-drift"><span class="warn-k">version drift</span>${esc(ed.versionDrift)}</p>` : ''}
        <p class="ed-prov">
          <span class="form">${esc(ed.form)}</span>
          <code>${esc(ed.artifact)}</code>
          ${ed.tracked ? '' : '<span class="untracked">untracked</span>'}
          ${ed.commit ? `<code class="sha">${esc(ed.commit)}</code>` : ''}
          ${w ? `<span class="witness" title="${attr(w.claim)}">count witnessed by ${esc(w.basis)}: ${esc(w.source)}</span>` : '<span class="witness none">count has no independent witness</span>'}
        </p>
        ${ed.commitNote ? `<p class="ed-note">${esc(ed.commitNote)}</p>` : ''}
      </div>
    </article>`;
  };
  let prev = 0;
  const editionCards = joined.editions.map((ed, i) => { const html = editionCard(ed, i, prev); prev = ed.computedAfter; return html; }).join('\n');

  // ---- class cards
  const stpaRow = (e) => {
    const L = V?.loops?.[e.loop], U = V?.uca?.[e.uca], C = V?.cause?.[e.cause];
    const ucaClass = e.uca === 'none' ? 'uca-none' : 'uca-live';
    return `<div class="stpa-row">
      <span class="loop" title="${attr(L ? `${L.controller} controls ${L.controls}` : e.loop)}">${esc(e.loop)}</span>
      <span class="uca ${ucaClass}" title="${attr(U?.test || '')}">${esc(e.uca === 'none' ? 'no unsafe control action in this loop' : e.uca)}</span>
      <span class="cause" title="${attr(C?.test || '')}">${esc(e.cause)}</span>
    </div>`;
  };
  const classCard = (c) => {
    const ev = editionOf.get(c.id);
    const stpa = Array.isArray(c.stpa) ? c.stpa : [];
    const primary = stpa[0];
    return `<article class="cls" id="${slug(c.id)}"
        data-id="${attr(c.id)}" data-fam="${attr(c.id[0])}" data-layer="${attr(c.layer)}"
        data-closure="${attr(String(c.closure))}" data-gain="${attr(String(c.gain))}"
        data-ed="${attr(ev === undefined ? 'none' : String(ev))}"
        data-uca="${attr(primary?.uca || 'unclassified')}" data-loop="${attr(primary?.loop || 'unclassified')}"
        data-text="${attr(`${c.id} ${c.name} ${c.machine} ${c.description} ${c.example} ${c.analogy || ''}`.toLowerCase())}">
      <header>
        <span class="cid">${esc(c.id)}</span>
        <h4>${esc(c.name)}</h4>
        <span class="tag l-${esc(c.layer)}" title="${attr(c.layer === 'CTRL' ? 'controller: decides what runs, on what, in what order, and what the result means' : c.layer === 'IMPL' ? 'implementation: does the work' : 'both layers')}">${esc(c.layer)}</span>
        <span class="edtag" title="${attr(ev === undefined ? 'no edition of the lineage claims this class' : `introduced in edition v${ev}`)}">${ev === undefined ? 'unattributed' : `v${ev}`}</span>
      </header>
      <p class="desc">${esc(c.description)}</p>
      ${c.analogy ? `<p class="analogy">${esc(c.analogy)}</p>` : ''}
      <p class="example"><span class="lbl">observed</span>${esc(c.example)}</p>
      <div class="foot">
        <span class="dials">
          ${dial(c.closure, B.closureMax, 'closure', word(CLOSURE_WORDS, c.closure))}<span class="dlbl">closure ${c.closure}/${B.closureMax}</span>
          ${dial(c.gain, B.gainMax, 'gain', word(GAIN_WORDS, c.gain))}<span class="dlbl">gain ${c.gain}/${B.gainMax}</span>
        </span>
        <code class="machine">${wrapId(c.machine)}</code>
      </div>
      ${c.scoreBasis ? `<p class="basis"><span class="lbl">score basis</span>${esc(c.scoreBasis)}</p>` : ''}
      ${stpa.length ? `<div class="stpa">${stpa.map(stpaRow).join('')}</div>` : '<div class="stpa none">not classified against the control axis</div>'}
    </article>`;
  };

  const familySections = registry.families.map((f) => {
    const list = byFamily.get(f.prefix) || [];
    return `<section class="fam" id="fam-${esc(f.key)}" data-fam="${attr(f.prefix)}">
      <h3><span class="roman">${esc(f.roman)}</span>${esc(f.name)}<span class="range">${esc(list.length ? `${list[0].id}–${list[list.length - 1].id}` : 'empty')}</span></h3>
      <p class="prop">The false proposition: <i>${esc(f.proposition)}</i></p>
      <div class="grid">${list.map(classCard).join('\n')}</div>
    </section>`;
  }).join('\n');

  // Remediations and the attribution surfaces MOVED OUT 2026-08-29 to their own page
  // (bin/remediation-web.mjs -> <private docsite>/imported/<urlPath of the manifest's taxonomy-remediation
  // entry>.html, manifest state `hidden`). They were rendered here without their `status` field, so an item could read
  // DONE in monitor/failure-taxonomy.json while the defect it named was still firing and no
  // reader of this page could see either. The register is not a subsection of the taxonomy;
  // it is a worklist with its own lifecycle, and it needed a page that shows state.

  const cycleRows = (registry.cycleLog || []).map((c) => {
    const bits = [];
    if (c.found !== undefined) bits.push(`${Array.isArray(c.found) ? c.found.length : c.found} found`);
    if (c.applied !== undefined) bits.push(`${c.applied} applied`);
    if (c.blockers !== undefined) bits.push(`${c.blockers} blockers`);
    const lists = ['closed', 'open', 'found'].filter((k) => Array.isArray(c[k]) && c[k].length)
      .map((k) => `<div class="cl"><span class="lbl">${k}</span><ul>${c[k].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
    return `<tr><td><b>${esc(c.cycle)}</b>${bits.length ? `<br><span class="muted">${esc(bits.join(' · '))}</span>` : ''}${c.artifact ? `<br><code class="sha">${esc(c.artifact)}</code>` : ''}</td>
      <td>${lists}${c.scored ? `<div class="cl"><span class="lbl">scored</span><ul>${Object.entries(c.scored).map(([k, v]) => `<li>${esc(k)}: ${esc(String(v))}</li>`).join('')}</ul></div>` : ''}${c.note ? `<p class="rnote">${esc(c.note)}</p>` : ''}</td></tr>`;
  }).join('\n');

  // ---- the honest-state block
  const unattributedBlock = joined.unattributed.length
    ? `<div class="alert grey">
        <b>${joined.unattributed.length} ${joined.unattributed.length === 1 ? 'class is' : 'classes are'} not attributed to any edition.</b>
        ${joined.unattributed.map((id) => `<a class="idchip" href="#${slug(id)}">${esc(id)}</a>`).join('')}
        <p>The registry holds them and the lineage does not account for them. They are shown here rather than folded into the newest edition, because a version history that silently adopts whatever it finds cannot tell you when anything arrived.</p>
      </div>`
    : `<div class="alert ok"><b>The lineage accounts for every class the registry holds.</b><p>${total} classes claimed across ${joined.editions.length} editions, each claimed exactly once, and every edition's declared total agrees with the ids beneath it.</p></div>`;

  const stpaP = registry.stpaProvenance;
  const famCounts = registry.families.map((f) => `${f.roman}&nbsp;${(byFamily.get(f.prefix) || []).length}`).join(' · ');
  const ucaCounts = (() => {
    const m = new Map();
    for (const c of registry.classes) { const u = Array.isArray(c.stpa) && c.stpa[0] ? c.stpa[0].uca : 'unclassified'; m.set(u, (m.get(u) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const editionFilterOptions = joined.editions.map((ed) => `<option value="${attr(String(ed.version))}">v${esc(String(ed.version))} — ${esc(ed.label)} (+${ed.addedCount})</option>`).join('');
  const famFilterOptions = registry.families.map((f) => `<option value="${attr(f.prefix)}">${esc(f.roman)} ${esc(f.name)}</option>`).join('');
  const ucaFilterOptions = ucaCounts.map(([u, n]) => `<option value="${attr(u)}">${esc(u)} (${n})</option>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The failure taxonomy — commitwork</title>
<meta name="description" content="Every way an oversight system can be wrong while reporting: ${total} classes across ${registry.families.length} families, with the edition history that shows what each version added.">
<style>
${DOCSITE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;scroll-padding-top:16px}
  body{background:var(--bg);color:var(--ink);font:16px/1.62 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  main{max-width:1120px;margin:0 auto;padding:0 20px 90px}
  a{color:var(--acc);text-decoration:none}
  a:hover{text-decoration:underline}
  code{font-family:var(--mono);font-size:.88em}
  header.site{max-width:1120px;margin:0 auto;padding:22px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
  header.site .brand{color:var(--head,var(--ink));font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:.31rem}
  header.site .brand .seal{width:1.35rem;height:1.35rem;flex:none}
  header.site nav{display:flex;gap:18px;font-size:14.5px;flex-wrap:wrap}
  header.site nav a{color:var(--mut)}
  header.site nav a:hover{color:var(--acc)}
  header.site nav a[aria-current="page"]{color:var(--acc);font-weight:600}
  /* The site nav says where you are in the site; this says where you are in the page. Kept
     separate so the shared shell stays byte-identical to every other page's. */
  .pagenav{max-width:1120px;margin:0 auto;padding:0 20px 4px;display:flex;gap:16px;flex-wrap:wrap;font-size:13.5px}
  .pagenav a{color:var(--dim)} .pagenav a:hover{color:var(--acc)}
  .lede{color:var(--mut);font-size:18px;margin-top:14px;max-width:66ch}
  h1{font-size:clamp(28px,4.4vw,42px);line-height:1.12;letter-spacing:-.018em;max-width:20ch}
  h2{font-size:22px;letter-spacing:-.012em}
  h3{font-size:17px;letter-spacing:-.008em}
  .hero{padding:44px 0 6px}
  .strip{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
  .stat{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:9px 15px;font-size:14px;color:var(--mut)}
  .stat b{color:var(--ink);font-variant-numeric:tabular-nums}
  section.blk{margin-top:56px}
  p.sub{color:var(--dim);font-size:13.5px;margin-top:4px;max-width:78ch}
  .prose p{margin-top:12px;max-width:74ch;color:var(--mut)}
  .prose p b,.prose p strong{color:var(--ink)}
  .qbox{margin-top:18px;border-left:3px solid var(--acc2);background:var(--panel2);padding:14px 18px;border-radius:0 10px 10px 0}
  .qbox p{max-width:70ch}
  /* legend */
  .legend{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));margin-top:18px}
  .lg{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:16px 18px}
  .lg h4{font-size:14px;margin-bottom:8px}
  .lg p{font-size:13.5px;color:var(--mut);margin-top:6px}
  .scale{display:inline-flex;gap:2px;align-items:center;vertical-align:-3px;margin-left:4px}
  .scale i{font-style:normal;font-size:11px;color:var(--dim);margin-right:8px;font-variant-numeric:tabular-nums}
  .tag{font-size:11px;font-weight:700;letter-spacing:.04em;border-radius:999px;padding:2px 9px;border:1px solid var(--line2);white-space:nowrap}
  .l-CTRL{background:var(--panel2);color:var(--acc);border-color:var(--acc2)}
  .l-IMPL{background:var(--panel2);color:var(--mut)}
  .l-BOTH{background:var(--panel2);color:var(--mut);border-style:dashed}
  /* editions */
  .eds{margin-top:22px;position:relative}
  .ed{display:grid;grid-template-columns:64px 1fr;gap:18px;padding:22px 0;border-top:1px solid var(--line)}
  .ed:first-child{border-top:none}
  .ed-rail{position:relative}
  .vbadge{position:sticky;top:16px;display:inline-block;font-weight:700;font-size:15px;color:var(--acc);background:var(--panel2);border:1px solid var(--acc2);border-radius:999px;padding:4px 12px;font-variant-numeric:tabular-nums}
  .ed-top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
  .ed-date{color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}
  .delta{margin-left:auto;font-size:13px;color:var(--mut);background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:3px 12px;font-variant-numeric:tabular-nums}
  .delta .was{color:var(--dim)}
  .delta.same{color:var(--dim)}
  .ed-head{margin-top:8px;font-size:16.5px;max-width:70ch}
  .ed-text{margin-top:10px;color:var(--mut);font-size:14.8px;max-width:76ch}
  .chgs{display:grid;gap:10px;margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(290px,1fr))}
  .chg{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:12px 14px}
  .chg-classes{grid-column:1/-1}
  .chg-h{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:14px}
  .chg-k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--dim)}
  .chg-classes .chg-k{color:var(--acc)}
  .chg-d{color:var(--dim);font-size:12.5px;font-variant-numeric:tabular-nums}
  .sha{color:var(--dim);font-size:12px}
  .chg-n{font-size:13.5px;color:var(--mut);margin-top:7px;max-width:74ch}
  .ids{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
  .idchip{font-family:var(--mono);font-size:12px;font-weight:600;border:1px solid var(--line2);background:var(--panel2);border-radius:6px;padding:2px 7px;color:var(--mut)}
  .idchip:hover{border-color:var(--acc2);color:var(--acc);text-decoration:none}
  .idchip.good{border-color:var(--ok);color:var(--ok)}
  .idchip.bad{border-color:var(--crit);color:var(--crit)}
  .ed-prov{margin-top:14px;font-size:12.5px;color:var(--dim);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .ed-prov .form{text-transform:uppercase;letter-spacing:.05em;font-size:11px;font-weight:700}
  .ed-prov .untracked{color:var(--crit);border:1px solid var(--crit);border-radius:999px;padding:0 8px;font-size:11px}
  .witness.none{color:var(--crit)}
  .ed-note{margin-top:8px;font-size:12.8px;color:var(--dim);max-width:76ch}
  .ed-drift{margin-top:14px;font-size:13.5px;color:var(--mut);background:var(--panel2);border:1px dashed var(--line);border-radius:8px;padding:10px 13px;max-width:80ch}
  .warn-k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--acc);margin-right:9px}
  /* alerts */
  .alert{margin-top:18px;border-radius:12px;padding:14px 18px;font-size:14.5px;border:1px solid var(--line2);background:var(--panel)}
  .alert p{margin-top:8px;color:var(--mut);font-size:13.8px;max-width:78ch}
  .alert.grey{border-style:dashed;border-color:var(--dim)}
  .alert.ok{border-color:var(--ok);background:linear-gradient(0deg,var(--panel),var(--panel))}
  .alert .idchip{margin:6px 4px 0 0}
  /* controls */
  .controls{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 0;margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .controls input[type=search],.controls select{font:inherit;font-size:14px;background:var(--panel);border:1px solid var(--line2);border-radius:9px;padding:8px 12px;color:var(--ink)}
  .controls input[type=search]{min-width:230px;flex:1 1 230px}
  .controls label{font-size:12.5px;color:var(--dim)}
  .controls button{font:inherit;font-size:13.5px;background:var(--panel);border:1px solid var(--line2);border-radius:9px;padding:8px 13px;cursor:pointer;color:var(--mut)}
  .controls button:hover{border-color:var(--acc2);color:var(--acc)}
  .count{font-size:13.5px;color:var(--mut);font-variant-numeric:tabular-nums;margin-left:auto}
  /* classes */
  .fam{margin-top:40px}
  .fam h3{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .roman{font-family:var(--mono);color:var(--acc);font-size:14px;border:1px solid var(--acc2);border-radius:6px;padding:1px 8px}
  .range{font-family:var(--mono);font-size:12.5px;color:var(--dim);font-weight:400}
  .prop{color:var(--mut);font-size:14px;margin-top:5px}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));margin-top:14px}
  .cls{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:15px 17px;scroll-margin-top:74px}
  .cls:target{border-color:var(--acc2);box-shadow:0 0 0 3px var(--panel2)}
  .cls header{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .cid{font-family:var(--mono);font-weight:700;font-size:13.5px;color:var(--acc);background:var(--panel2);border-radius:6px;padding:1px 8px}
  .cls h4{font-size:15px;flex:1 1 auto;letter-spacing:-.005em}
  .edtag{font-size:11px;font-weight:700;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
  .cls .desc{margin-top:10px;font-size:14.3px}
  .cls .analogy{margin-top:9px;font-size:13.8px;color:var(--mut);border-left:2px solid var(--line);padding-left:11px;font-style:italic}
  .cls .example{margin-top:10px;font-size:13.3px;color:var(--mut)}
  .lbl{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-right:8px}
  .cls .foot{margin-top:12px;padding-top:10px;border-top:1px solid var(--line);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .dials{display:flex;align-items:center;gap:6px}
  .dial{vertical-align:-2px}
  .dlbl{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums;margin-right:6px}
  .machine{margin-left:auto;color:var(--acc2);font-size:11.5px;word-break:break-word;text-align:right}
  .basis{margin-top:9px;font-size:12.5px;color:var(--dim)}
  .stpa{margin-top:11px;display:grid;gap:5px}
  .stpa.none{font-size:12.5px;color:var(--dim);border:1px dashed var(--line);border-radius:8px;padding:7px 10px}
  .stpa-row{display:flex;gap:6px;flex-wrap:wrap;font-size:11.5px}
  .stpa-row span{border-radius:6px;padding:1px 8px;border:1px solid var(--line);background:var(--panel2);color:var(--mut)}
  .stpa-row .loop{font-weight:700;color:var(--ink)}
  .stpa-row .uca-live{border-color:var(--acc2);color:var(--acc)}
  .stpa-row .uca-none{color:var(--dim)}
  /* tables */
  .tblwrap{overflow-x:auto;margin-top:16px}
  table{border-collapse:collapse;width:100%;font-size:14px;background:var(--panel);border:1px solid var(--line2);border-radius:12px;overflow:hidden}
  th{font-weight:600;text-align:left;color:var(--mut);border-bottom:1px solid var(--line);padding:11px 13px;background:var(--panel2);font-size:13px}
  td{border-bottom:1px solid var(--line);padding:11px 13px;vertical-align:top}
  tr:last-child td{border-bottom:none}
  td.rank{font-variant-numeric:tabular-nums;font-weight:700;color:var(--acc);width:3%}
  .act{margin-top:6px;color:var(--mut);font-size:13.2px}
  .rnote{margin-top:6px;color:var(--dim);font-size:12.6px}
  .ids-cell{white-space:normal;width:9%}
  .ids-cell .idchip{margin:0 4px 4px 0}
  .eff{white-space:nowrap;font-size:13px;width:7%}
  .risk{font-size:12.8px;color:var(--mut);width:19%}
  table.rem td:nth-child(2){width:44%}
  .muted{color:var(--dim)}
  .cl{margin-bottom:8px}
  .cl ul{margin:4px 0 0 18px;font-size:13px;color:var(--mut)}
  /* footer */
  .foot-note{margin-top:70px;border-top:1px solid var(--line);padding-top:18px;font-size:12.8px;color:var(--dim)}
  .foot-note code{color:var(--mut)}
  .foot-note p{margin-top:7px;max-width:88ch}
  .hidden{display:none !important}
  @media (max-width:720px){
    .ed{grid-template-columns:1fr;gap:10px}
    .machine{margin-left:0;text-align:left;width:100%}
    .controls{position:static}
  }
  @media print{
    header.site nav,.controls{display:none}
    body{background:#fff;font-size:11pt}
    .cls,.chg,.stat,table{break-inside:avoid}
    .ed{break-inside:avoid}
    a{color:var(--ink)}
  }
</style>
</head>
<body>
${nav}
<nav class="pagenav" aria-label="On this page">
  <a href="#classes">Classes</a>
  <a href="#limits">Limits</a>
</nav>
<main>

<div class="hero">
  <h1>Every way an oversight system can be wrong while reporting.</h1>
  <p class="lede">commitwork's failure taxonomy is the catalogue of defects found in commitwork
  itself: ${total} classes across ${registry.families.length} families, each one a mechanism by which a
  scanner, a gate, a report or an agent produced a claim that survived review and was false. It is
  kept because a tool whose entire product is reporting has to know the ways its own reporting
  fails, and because most of them do not look like misses.</p>
  <div class="strip">
    <span class="stat"><b>${total}</b> classes</span>
    <span class="stat"><b>${registry.families.length}</b> families</span>
    <span class="stat"><b>${joined.editions.length}</b> editions, v${joined.editions[0].version}–v${joined.editions[joined.editions.length - 1].version}</span>
    <span class="stat">registry <b>v${esc(String(registry.version))}</b></span>
    <span class="stat">${famCounts}</span>
  </div>
</div>

<section class="blk prose" id="what">
  <h2>The organising question</h2>
  <div class="qbox"><p><b>Which proposition did the oversight system believe that was false?</b></p></div>
  <p>Mechanism is the class level; the believed-false proposition is the family level. It is the only
  axis on which the families do not overlap — organising by pipeline stage would put <i>wrong
  population measured</i> beside <i>the instrument lies</i> while separating failures that share a
  single fix.</p>
  <p>Family I is a <b>miss</b>: the system said nothing was wrong and something was. Every other
  family is a <b>hit that failed anyway</b> — the alarm fired, correctly, and then named the wrong
  cause, the wrong owner, a repair that never happened, or a number that meant something else. Those
  stayed invisible for months, because every test that asks only <i>did the alarm fire?</i> passes
  them.</p>
  <p>Two rules run underneath the whole catalogue, and they are mirrors. <b>explicit uncertainty</b>: an
  unknown must never be published as a pass. <b>unsupported findings</b>: an unknown must never be
  published as a finding, because for a tool whose claim is reporting that survives scrutiny, a
  fabricated critical costs more than a missed one — it is the number a reader can check.</p>
</section>

<section class="blk" id="how-to-read">
  <h2>How to read a class</h2>
  <p class="sub">Every class carries the same six things, and the two dials are one rater's reading rather than a measurement.</p>
  <div class="legend">
    <div class="lg"><h4>Layer</h4>
      <p><span class="tag l-CTRL">CTRL</span> the controller: what runs, on what, in what order, and what the result means. Its failures are in a policy, an ordering, a scope or an authority, and the fix is never an edit to the code that failed.</p>
      <p><span class="tag l-IMPL">IMPL</span> the implementation: scanners, parsers, comparators, renderers. <span class="tag l-BOTH">BOTH</span> both.</p></div>
    <div class="lg"><h4>Closure and gain</h4>
      <p><b>closure</b> ${scaleStrip(B.closureMax, 'closure', CLOSURE_WORDS)}<br>${esc(registry.scales?.closure || '')}</p>
      <p><b>gain</b> ${scaleStrip(B.gainMax, 'gain', GAIN_WORDS)}<br>${esc(registry.scales?.gain || '')}</p></div>
    <div class="lg"><h4>The control axis</h4>
      <p>Each class states the control loop it belongs to, how the control action went wrong, and why. <i>No unsafe control action in this loop</i> is a judgement, not a blank — ${ucaCounts.find((u) => u[0] === 'none')?.[1] ?? 0} of ${total} classes carry it as their primary reading.</p>
      <p class="sub">${stpaP ? `Machine-rated ${esc(stpaP.date)} — <a href="#limits">what that does not establish</a>.` : 'No provenance recorded, which is itself the reading: these values have no witness.'}</p></div>
    <div class="lg"><h4>Edition</h4>
      <p>The version that introduced the class. Click any id in the timeline to jump to it, or filter the catalogue by the edition it arrived in.</p></div>
  </div>
</section>

<section class="blk hidden" id="editions" aria-hidden="true">
  <h2>The editions — what each version added</h2>
  <p class="sub">${esc(lineage.note)}</p>
  ${unattributedBlock}
  <div class="eds">
${editionCards}
  </div>
  <p class="sub" style="margin-top:18px">${esc(lineage.measurement)}</p>
</section>

<section class="blk" id="classes">
  <h2>The ${total} classes</h2>
  <p class="sub">Filters are cumulative and act on the cards below; the count is live. For every
  class in one flat list — no argument, no filters, the form suited to a print or a search — see
  <a href="/taxonomy-reference/">the class reference</a>.</p>
  <div class="controls">
    <label for="q" class="hidden">Search</label>
    <input type="search" id="q" placeholder="Search id, name, description, example…" autocomplete="off">
    <label for="f-fam" class="hidden">Family</label>
    <select id="f-fam"><option value="">All families</option>${famFilterOptions}</select>
    <label for="f-layer" class="hidden">Layer</label>
    <select id="f-layer"><option value="">Both layers</option><option value="CTRL">CTRL only</option><option value="IMPL">IMPL only</option><option value="BOTH">BOTH</option></select>
    <label for="f-ed" class="hidden">Edition</label>
    <select id="f-ed"><option value="">Any edition</option>${editionFilterOptions}${joined.unattributed.length ? '<option value="none">unattributed</option>' : ''}</select>
    <label for="f-uca" class="hidden">Unsafe control action</label>
    <select id="f-uca"><option value="">Any control action</option>${ucaFilterOptions}</select>
    <label for="f-open" class="hidden">Closure</label>
    <select id="f-open"><option value="">Any closure</option><option value="open">not closed (&lt; ${B.fullyClosed})</option><option value="closed">closed (${B.fullyClosed})</option></select>
    <button type="button" id="reset">Reset</button>
    <span class="count" id="count" aria-live="polite" role="status">${total} of ${total}</span>
  </div>
${familySections}
</section>

<section class="blk" id="cycles">
  <h2>Review cycles — what each pass found in the catalogue itself</h2>
  <p class="sub">The taxonomy is reviewed with the same instruments it describes, and the record of those cycles lives inside the registry rather than beside it.</p>
  <div class="tblwrap"><table>
    <thead><tr><th>Cycle</th><th>Outcome</th></tr></thead>
    <tbody>
${cycleRows}
    </tbody>
  </table></div>
</section>

<section class="blk prose" id="limits">
  <h2>What this page does not claim</h2>
  <p><b>The scores are one reading, not a measurement.</b> ${esc(registry.scoreProvenance || '')}</p>
  ${stpaP ? `<p><b>The control axis is machine-rated on one edition.</b> ${esc(stpaP.caveat)}</p>
  <p class="sub"><span class="lbl">rated by</span>${esc(stpaP.rater)}</p>
  <p class="sub"><span class="lbl">method</span>${esc(stpaP.method)}</p>` : ''}
  <p><b>No class names a defect in what the operator decided.</b> The control axis has an
  <code>operator</code> loop and no class uses it as its primary reading: the catalogue can name what
  the machinery did with a decision, and has no name for the decision. The cross-cut made the hole
  visible and does not fill it.</p>
  <p><b>Two editions survive only as gitignored renders.</b> v4 and v5 were never committed as
  registry states — the registry ran untracked for eleven days and landed at v6. Their class counts
  are measured from HTML under <code>reports/</code>, hashed in the lineage file, and that hash dies
  with the file.</p>
  <p><b>An absence of rows is not an absence of instances.</b> It is the first thing this catalogue
  teaches, and the catalogue has already had to learn it about itself.</p>
</section>

<div class="foot-note">
  <p>Generated ${esc(generatedAt)} by <code>bin/taxonomy-web.mjs</code> — do not hand-edit; regenerate with <code>node bin/taxonomy-web.mjs</code>.</p>
  <p>Sources: <code>${esc(sources.registry.path)}</code> v${esc(String(registry.version))}, sha256 <code>${esc(sources.registry.sha.slice(0, 12))}</code>, verified against <code>${esc(registry.verifiedAgainst || 'unstated')}</code> · <code>${esc(sources.lineage.path)}</code> sha256 <code>${esc(sources.lineage.sha.slice(0, 12))}</code>, verified against <code>${esc(lineage.verifiedAgainst || 'unstated')}</code>.</p>
  <p>The class reference for a reader who wants the row rather than the argument is <code>bin/taxonomy-render.mjs</code>; the same registry projected into sqlite, for a reader that is a program, is <code>bin/taxonomy-db.mjs</code>.</p>
</div>
</main>
<script>
(function(){
  var cards = Array.prototype.slice.call(document.querySelectorAll('.cls'));
  var q = document.getElementById('q'), fam = document.getElementById('f-fam'),
      layer = document.getElementById('f-layer'), ed = document.getElementById('f-ed'),
      uca = document.getElementById('f-uca'), open = document.getElementById('f-open'),
      count = document.getElementById('count'), reset = document.getElementById('reset');
  var CLOSED = ${JSON.stringify(B.fullyClosed)};
  function apply(){
    var text = q.value.trim().toLowerCase(), n = 0;
    cards.forEach(function(c){
      var ok = (!text || c.dataset.text.indexOf(text) !== -1)
        && (!fam.value || c.dataset.fam === fam.value)
        && (!layer.value || c.dataset.layer === layer.value)
        && (!ed.value || c.dataset.ed === ed.value)
        && (!uca.value || c.dataset.uca === uca.value)
        && (!open.value || (open.value === 'closed' ? +c.dataset.closure >= CLOSED : +c.dataset.closure < CLOSED));
      c.classList.toggle('hidden', !ok);
      if (ok) n++;
    });
    document.querySelectorAll('section.fam').forEach(function(s){
      s.classList.toggle('hidden', s.querySelectorAll('.cls:not(.hidden)').length === 0);
    });
    count.textContent = n + ' of ' + cards.length;
  }
  [q, fam, layer, ed, uca, open].forEach(function(el){
    el.addEventListener('input', apply); el.addEventListener('change', apply);
  });
  reset.addEventListener('click', function(){
    q.value = ''; fam.value = ''; layer.value = ''; ed.value = ''; uca.value = ''; open.value = ''; apply();
  });
  // An id chip in the timeline scrolls to the class; it must also clear any filter that would
  // hide the target, or the link lands on nothing and reads as a broken anchor.
  document.querySelectorAll('.idchip[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(){
      var id = a.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el && el.classList.contains('hidden')) {
        q.value = ''; fam.value = ''; layer.value = ''; ed.value = ''; uca.value = ''; open.value = ''; apply();
      }
    });
  });
  apply();
})();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- main

async function main() {
  const rPath = registryPath(), ePath = editionsPath(), mPath = manifestPath();
  const rRaw = readOrDie(rPath, 'failure taxonomy registry');
  const eRaw = readOrDie(ePath, 'taxonomy edition lineage');
  const mRaw = readOrDie(mPath, 'docsite manifest');
  // schema/taxonomy-editions.schema.json had zero importers until 2026-08-26. Validated here, at the
  // load, because this document is the LINEAGE — which edition superseded which — and a malformed
  // one does not fail loudly downstream, it renders a history with a gap in it.
  {
    let eDoc; try { eDoc = JSON.parse(eRaw); } catch (e) { throw new Error(`${ePath}: ${e.message}`); }
    const { errors } = validateAgainstSchema(eDoc, { path: resolve(REPO, 'schema', 'taxonomy-editions.schema.json') });
    if (errors.length) throw new Error(`${ePath} does not satisfy schema/taxonomy-editions.schema.json:\n  ${errors.slice(0, 6).join('\n  ')}`);
  }
  let manifest;
  try { manifest = JSON.parse(mRaw); } catch (e) { throw new Error(`manifest ${mPath} is not parseable JSON: ${e.message}`); }
  if (!Array.isArray(manifest.docs)) throw new Error(`manifest ${mPath} has no docs array`);

  let registry, lineage;
  try { registry = JSON.parse(rRaw); } catch (e) { throw new Error(`registry ${rPath} is not parseable JSON: ${e.message}`); }
  try { lineage = JSON.parse(eRaw); } catch (e) { throw new Error(`lineage ${ePath} is not parseable JSON: ${e.message}`); }
  if (!Array.isArray(registry.classes) || !Array.isArray(registry.families)) throw new Error('registry has no classes/families array');
  if (!Array.isArray(lineage.editions) || lineage.editions.length === 0) throw new Error('lineage has no editions');

  // Scanner names leave the register intact and are removed HERE, on the way to the page —
  // record-scoped, so a catalogue that exists to name tools keeps naming them. Throws rather
  // than silently no-opping if a redaction stopped matching its record.
  registry = redactScannersForPublish(registry);
  const joined = reconcile(registry, lineage);
  if (joined.errors.length) {
    for (const e of joined.errors) process.stderr.write(`taxonomy-web: ${e}\n`);
    process.stderr.write(`taxonomy-web: ${joined.errors.length} reconciliation error(s); nothing written.\n`);
    process.exit(2);
  }
  const quiet = process.argv.includes('--quiet');
  if (joined.unattributed.length && !quiet) {
    process.stderr.write(`taxonomy-web: ${joined.unattributed.length} class(es) attributed to no edition: ${joined.unattributed.join(', ')} — rendered as their own state, not folded into the newest edition.\n`);
  }

  if (process.argv.includes('--check')) {
    const line = `lineage OK — ${registry.classes.length} classes across ${joined.editions.length} editions (${joined.editions.map((e) => `v${e.version}+${e.addedCount}`).join(' ')})`;
    process.stdout.write(line + '\n');
    process.exit(joined.unattributed.length ? 1 : 0);
  }

  const nav = docsiteNav(manifest, 'taxonomy');
  const html = renderPage({
    registry, lineage, joined, nav,
    generatedAt: nowStamp(),
    sources: {
      registry: { path: relative(REPO, rPath) || rPath, sha: sha256(rRaw) },
      lineage: { path: relative(REPO, ePath) || ePath, sha: sha256(eRaw) },
    },
  });

  // Versioned only at the real default location: a custom --out (every test run uses one, to a
  // sandbox) is an explicit redirect away from the live artifact, and snapshotting there would
  // either miss the real file entirely or, worse, write test output into the real repo's
  // docsite/.versions/ on every test run.
  // The taxonomy page is a DRAFT document, so by default it is written into the private docsite root
  // (lib/docsite-roots.mjs; monitor/private/docsite/imported/taxonomy.html). The source registry is
  // public (D22.3); the page's state is a separate ruling. A public checkout writes the same path,
  // which is gitignored and listed in no manifest there. With CW_DOCSITE_ROOT set and no
  // CW_DOCSITE_PRIVATE (a fixture), the default stays inside that root.
  const pageRoot = privateRoot() || docsiteRoot();
  const defaultOut = resolve(pageRoot, 'imported', 'taxonomy.html');
  const out = argOf('--out', defaultOut);
  // resolve() BOTH sides. `--out docsite/imported/taxonomy.html` names the live file and does
  // not string-equal the absolute default, so the raw compare skipped the snapshot while the
  // write below still replaced the real page — versioning off, overwrite on. writeAtomic
  // resolves against cwd exactly as this does, so guard and write now agree on the target.
  if (resolve(out) === defaultOut) {
    let previous = null;
    try { previous = readFileSync(out, 'utf8'); } catch { /* first write */ }
    snapshotBeforeWrite('taxonomy', 'generated', previous, { root: pageRoot });
  }
  // Redact at the boundary: the register names real repositories on purpose, the docsite must not.
  const published = redactForPublish(html);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeAtomic(out, published);
  if (!quiet) process.stdout.write(`taxonomy-web: ${out} — ${registry.classes.length} classes, ${joined.editions.length} editions, ${(published.length / 1024).toFixed(0)} KB\n`);
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`taxonomy-web: ${e.message}\n`); process.exit(2); });
}

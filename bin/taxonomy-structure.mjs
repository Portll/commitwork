#!/usr/bin/env node
/**
 * taxonomy-structure.mjs — how the failure classes relate to each other, measured three ways that
 * cannot share a failure mode, drawn on one self-contained page.
 *
 *   1. LEXICAL   TF-IDF cosine over each class's name, predicate and description. A heatmap ordered
 *                by family and by average-linkage cluster, with the family bands drawn, and a
 *                permutation test of within-family against between-family similarity that says
 *                whether the families are clusters or filing conventions.
 *   2. STRUCTURAL The STPA primary triple (loop, uca, cause) is a closed code; classes sharing one
 *                are listed with their lexical similarity. Close on both is the operational form of
 *                G14 — no separating observation.
 *   3. DECLARED  The rca edges, as an arc diagram over the family axis, with undeclared high-
 *                similarity pairs drawn faint underneath: similar-but-unlinked is a candidate
 *                duplicate, linked-but-dissimilar is an edge claimed on something other than words.
 *
 * Two companions share the data: an EVIDENCE STRIP (which of sha, path, date, count, cited actor,
 * evidence-matcher and reporter count each class carries — a class with none is derived, not
 * measured) and the inter-rater agreement between the registry's two scoring passes, read from the
 * RE-RATED sentences, as quadratically weighted kappa.
 *
 * No model, no CDN, no dependency: every number here is computable from the registry alone, and the
 * page inlines its data so it renders from file://. The entailment and concept-lattice analyses
 * that need an inference or encoding pass are deliberately NOT here — they need a second rater
 * before they say anything binding, and a page that mixed computed and inferred relations would
 * dress the second as the first.
 *
 * Usage: taxonomy-structure.mjs [--json <registry>] [--out <html>] [--perms <n>]
 * Env, read at call time: CW_TAXONOMY_JSON. Deterministic: the permutation test uses a fixed seed.
 */
import { isMainModule } from '../lib/is-main.mjs';
import { esc } from '../lib/html-escape.mjs';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { LIGHT as PAPER } from '../lib/brand-tokens.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (flag, dflt) => { const i = process.argv.indexOf(flag); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt; };

// ── 1. lexical ──────────────────────────────────────────────────────────────────────────────
const STOP = new Set(('a an the and or of to in on for with by from as is are was were be been being it its this that these those ' +
  'at into than then so no not nor if but which who whom whose what when where how any all each every some such only also more most ' +
  'one two same other another between over under after before while during without within here there where never ever ' +
  'has have had having does do did done can cannot could would should may might must will shall ' +
  'class classes instance record records their there they them itself own once twice per').split(/\s+/));
const stem = (w) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const tokenize = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);

/** TF-IDF unit vectors over documents (arrays of tokens). Returns { vectors: Map[]  , vocab } */
export function tfidf(docs) {
  const df = new Map();
  const tfs = docs.map((tokens) => {
    const tf = new Map();
    for (const w of tokens) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    return tf;
  });
  const N = docs.length;
  return tfs.map((tf, i) => {
    const v = new Map();
    let norm = 0;
    for (const [w, c] of tf) { const x = (c / docs[i].length) * Math.log((N + 1) / (df.get(w) + 1)); v.set(w, x); norm += x * x; }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  });
}
export const cosine = (a, b) => { let s = 0; const [small, big] = a.size < b.size ? [a, b] : [b, a]; for (const [w, x] of small) { const y = big.get(w); if (y) s += x * y; } return s; };
export function similarityMatrix(vectors) {
  const n = vectors.length;
  const S = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) { S[i][i] = 1; for (let j = i + 1; j < n; j++) { const s = cosine(vectors[i], vectors[j]); S[i][j] = s; S[j][i] = s; } }
  return S;
}

/** Average-linkage agglomerative order: a leaf permutation that puts similar items adjacent. Deterministic. */
export function clusterOrder(S) {
  const n = S.length;
  let clusters = Array.from({ length: n }, (_, i) => [i]);
  const link = (A, B) => { let s = 0; for (const a of A) for (const b of B) s += S[a][b]; return s / (A.length * B.length); };
  while (clusters.length > 1) {
    let best = -Infinity, bi = 0, bj = 1;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const l = link(clusters[i], clusters[j]);
      if (l > best) { best = l; bi = i; bj = j; }
    }
    const merged = clusters[bi].concat(clusters[bj]);
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
  return clusters[0];
}

// mulberry32 — a seeded PRNG so two runs over one registry give one p-value.
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/**
 * Within-family minus between-family mean similarity, and the fraction of label permutations that
 * reach it. p is (count + 1) / (perms + 1): a permutation test never reports zero.
 */
export function permutationTest(S, labels, perms = 1000, seed = 42) {
  const n = S.length;
  const stat = (lab) => {
    let wi = 0, wn = 0, bi = 0, bn = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (lab[i] === lab[j]) { wi += S[i][j]; wn++; } else { bi += S[i][j]; bn++; }
    }
    return { within: wn ? wi / wn : 0, between: bn ? bi / bn : 0, diff: (wn ? wi / wn : 0) - (bn ? bi / bn : 0) };
  };
  const observed = stat(labels);
  const rand = rng(seed);
  let count = 0;
  const lab = labels.slice();
  for (let p = 0; p < perms; p++) {
    for (let i = lab.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [lab[i], lab[j]] = [lab[j], lab[i]]; }
    if (stat(lab).diff >= observed.diff) count++;
  }
  return { ...observed, perms, p: (count + 1) / (perms + 1) };
}

// ── evidence dimensions ─────────────────────────────────────────────────────────────────────
const DIM = {
  sha: /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/,
  path: /(?:^|[\s(`'"])(?:bin|lib|monitor|admin|cra|mcp|flow|schema|docs|evaluations|src|\.claude|\.githooks)\/[\w./-]+/,
  date: /\b20\d\d-\d\d-\d\d\b/,
  count: /\b\d+ (?:of|\/) ?\d+\b|\b\d{2,}\b/,
  actor: /\breporter #\d+\b/,
};
export function evidenceDims(c, matchers) {
  const text = `${c.example || ''} ${c.scoreBasis || ''}`;
  const dims = Object.fromEntries(Object.entries(DIM).map(([k, re]) => [k, re.test(text)]));
  dims.matcher = matchers.some((re) => re.test(c.example || ''));
  // `reporter #n` is the public citation; the sidecar maps each n to the transcript it stands for.
  const reporters = new Set([...text.matchAll(/\breporter #(\d+)\b/g)].map((m) => m[1]));
  dims.reporters = reporters.size;
  dims.derived = /\b(derived|INFERRED|unplantable|no instance and no instrument)\b/.test(text);
  dims.score = ['sha', 'path', 'date', 'count', 'actor'].filter((k) => dims[k]).length;
  return dims;
}

// ── inter-rater agreement from the RE-RATED sentences ──────────────────────────────────────
/** Quadratically weighted kappa over ordinal 0..k. */
export function weightedKappa(a, b, k = 4) {
  const n = a.length; if (!n) return null;
  const O = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
  const ra = new Array(k + 1).fill(0), rb = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) { O[a[i]][b[i]]++; ra[a[i]]++; rb[b[i]]++; }
  let num = 0, den = 0;
  for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) {
    const w = ((i - j) ** 2) / (k ** 2);
    num += w * O[i][j];
    den += w * (ra[i] * rb[j]) / n;
  }
  return den === 0 ? 1 : 1 - num / den;
}
export function firstPassScores(c) {
  // The FIRST re-rate sentence's "from" values are the first pass; the current values are the last.
  const m = /RE-RATED [^:]*: closure (\d)→\d, gain (\d)→\d/.exec(c.scoreBasis || '');
  return m ? { closure: Number(m[1]), gain: Number(m[2]) } : { closure: c.closure, gain: c.gain };
}

// ── analysis ───────────────────────────────────────────────────────────────────────────────
export function analyse(doc, { perms = 1000 } = {}) {
  const classes = doc.classes;
  const n = classes.length;
  const docs = classes.map((c) => tokenize(`${c.name} ${c.predicate} ${c.description}`));
  const S = similarityMatrix(tfidf(docs));
  const fam = classes.map((c) => c.id[0]);
  const perm = permutationTest(S, fam, perms);
  const order = clusterOrder(S);

  // Nearest neighbour per class, with the two other witnesses beside it.
  const triple = (c) => c.stpa && c.stpa[0] ? `${c.stpa[0].loop}|${c.stpa[0].uca}|${c.stpa[0].cause}` : '';
  const declared = new Set();
  const edges = [];
  classes.forEach((c, i) => { for (const e of c.rca || []) if (e.to) { const j = classes.findIndex((x) => x.id === e.to); if (j >= 0) { edges.push({ from: i, to: j, relation: e.relation, sim: S[i][j] }); declared.add(`${i}|${j}`); declared.add(`${j}|${i}`); } } });
  const nearest = classes.map((c, i) => {
    let bj = -1, bs = -1;
    for (let j = 0; j < n; j++) if (j !== i && S[i][j] > bs) { bs = S[i][j]; bj = j; }
    return { id: c.id, nn: classes[bj].id, sim: bs, offFamily: fam[i] !== fam[bj], sameTriple: triple(c) === triple(classes[bj]), declared: declared.has(`${i}|${bj}`) };
  });
  const offFamily = nearest.filter((x) => x.offFamily).sort((a, b) => b.sim - a.sim);

  // Shared STPA triples.
  const byTriple = new Map();
  classes.forEach((c, i) => { const t = triple(c); if (!byTriple.has(t)) byTriple.set(t, []); byTriple.get(t).push(i); });
  const sharedTriples = [...byTriple.entries()].filter(([, ids]) => ids.length > 1)
    .map(([t, ids]) => ({ triple: t, pairs: ids.flatMap((a, x) => ids.slice(x + 1).map((b) => ({ a: classes[a].id, b: classes[b].id, sim: S[a][b], declared: declared.has(`${a}|${b}`) }))) }))
    .map((g) => ({ ...g, max: Math.max(...g.pairs.map((p) => p.sim)) })).sort((a, b) => b.max - a.max);

  // Undeclared high-similarity pairs for the arc overlay: the top 60 not carrying a declared edge.
  const undeclared = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!declared.has(`${i}|${j}`)) undeclared.push({ from: i, to: j, sim: S[i][j] });
  undeclared.sort((a, b) => b.sim - a.sim);
  const undeclaredTop = undeclared.slice(0, 60);

  // Per-family similarity: within, and the nearest other family.
  const families = doc.families.map((f) => f.prefix);
  const famStats = families.map((p) => {
    const idx = classes.map((c, i) => (fam[i] === p ? i : -1)).filter((i) => i >= 0);
    const meanOver = (idxA, idxB, excludeSelf) => { let s = 0, k = 0; for (const a of idxA) for (const b of idxB) { if (excludeSelf && a === b) continue; s += S[a][b]; k++; } return k ? s / k : 0; };
    const within = meanOver(idx, idx, true);
    const others = families.filter((q) => q !== p).map((q) => ({ q, m: meanOver(idx, classes.map((c, i) => (fam[i] === q ? i : -1)).filter((i) => i >= 0), false) })).sort((a, b) => b.m - a.m);
    return { prefix: p, n: idx.length, within, nearest: others[0] };
  });

  // Evidence.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- matchers come from the bundled taxonomy document's evidencePredicate, not scanned input
  const matchers = (doc.evidencePredicate?.matchers || []).map((s) => new RegExp(s, 'i'));
  const evidence = classes.map((c) => ({ id: c.id, ...evidenceDims(c, matchers) }));

  // Inter-rater.
  const first = classes.map(firstPassScores);
  const kappa = { closure: weightedKappa(first.map((x) => x.closure), classes.map((c) => c.closure), doc.scaleBounds.closureMax), gain: weightedKappa(first.map((x) => x.gain), classes.map((c) => c.gain), doc.scaleBounds.gainMax), changed: classes.filter((c, i) => first[i].closure !== c.closure || first[i].gain !== c.gain).length };

  return { n, S, order, fam, families: doc.families, perm, nearest, offFamily, sharedTriples, edges, undeclaredTop, famStats, evidence, kappa, ids: classes.map((c) => c.id), names: classes.map((c) => c.name), triples: classes.map(triple) };
}

// ── page ───────────────────────────────────────────────────────────────────────────────────
const f3 = (x) => x.toFixed(3);
// Series colours from the documented reference palette (validated adjacent, light mode, this
// surface: worst CVD dE 9.1, normal 19.6; four slots sit below 3:1 so every use carries a label).
const REL_C = { 'same-defect-as': '#2a78d6', 'mechanism-of': '#eb6834', enables: '#1baf7a', masks: '#eda100', awaits: '#e87ba4' };
// Sequential blue for the heatmap (continuous magnitude; the light end recedes toward the surface by design).
const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export function renderPage(doc, A) {
  const fam = doc.families;
  const famOf = (id) => fam.find((f) => f.prefix === id[0]);
  const famColour = (prefix) => `hsl(${(fam.findIndex((f) => f.prefix === prefix) * 360) / fam.length} 35% 45%)`;
  const N = A.n;
  // Compact data for the canvas: similarity as 0..255 bytes, row-major, in registry order.
  const bytes = []; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) bytes.push(Math.round(A.S[i][j] * 255));
  // "By family" is family-then-number, NOT registry order: later editions append classes at the
  // end of the array (A23, C28–C34, M20+, K12+, L8+), so registry order splits every family band.
  const famIndex = Object.fromEntries(fam.map((f, i) => [f.prefix, i]));
  const famOrder = A.ids.map((_, i) => i).sort((a, b) => (famIndex[A.fam[a]] - famIndex[A.fam[b]]) || (Number(/\d+/.exec(A.ids[a])[0]) - Number(/\d+/.exec(A.ids[b])[0])));
  const data = { n: N, ids: A.ids, names: A.names, fam: A.fam, triples: A.triples, order: A.order, famOrder, sim: bytes, edges: A.edges.map((e) => [e.from, e.to, e.relation]), seq: SEQ };

  const arcW = 1400, arcAxisY = 250, tick = (arcW - 80) / N;
  const x = (i) => 40 + i * tick + tick / 2;
  const arc = (a, b, colour, width, title, dash) => { const [i, j] = a < b ? [a, b] : [b, a]; const r = (x(j) - x(i)) / 2; return `<path d="M${x(i).toFixed(1)},${arcAxisY} A${r.toFixed(1)},${(Math.min(r, 230)).toFixed(1)} 0 0 1 ${x(j).toFixed(1)},${arcAxisY}" fill="none" stroke="${colour}" stroke-width="${width}"${dash ? ' stroke-dasharray="3 3"' : ''} opacity="${dash ? 0.45 : 0.85}"><title>${esc(title)}</title></path>`; };
  const bands = fam.map((f) => { const idx = A.fam.map((p, i) => (p === f.prefix ? i : -1)).filter((i) => i >= 0); return { f, x0: x(idx[0]) - tick / 2, x1: x(idx[idx.length - 1]) + tick / 2 }; });
  const arcs = [
    ...A.undeclaredTop.map((u) => arc(u.from, u.to, PAPER.line2, 1, `undeclared — ${A.ids[u.from]} ↔ ${A.ids[u.to]} lexical ${f3(u.sim)}`, true)),
    ...A.edges.map((e) => arc(e.from, e.to, REL_C[e.relation] || PAPER.mut, 2, `${e.relation}: ${A.ids[e.from]} → ${A.ids[e.to]} · lexical ${f3(e.sim)}`)),
  ].join('');
  const arcSvg = `<svg viewBox="0 0 ${arcW} ${arcAxisY + 60}" width="100%" role="img" aria-label="Arc diagram of declared causal edges over the family axis, with the sixty strongest undeclared lexical pairs drawn dashed">
    ${bands.map((b) => `<rect x="${b.x0.toFixed(1)}" y="${arcAxisY + 4}" width="${(b.x1 - b.x0).toFixed(1)}" height="8" fill="${famColour(b.f.prefix)}" opacity=".55"><title>${esc(b.f.roman + ' ' + b.f.name)}</title></rect><text x="${((b.x0 + b.x1) / 2).toFixed(1)}" y="${arcAxisY + 30}" text-anchor="middle" font-size="11" fill="${PAPER.mut}">${esc(b.f.roman)}</text>`).join('')}
    ${arcs}
    ${A.ids.map((id, i) => `<rect x="${(x(i) - tick / 2).toFixed(1)}" y="${arcAxisY - 2}" width="${tick.toFixed(1)}" height="4" fill="${PAPER.line2}"><title>${esc(id + ' ' + A.names[i])}</title></rect>`).join('')}
  </svg>`;

  const evRows = [...A.evidence].sort((a, b) => a.score - b.score || a.reporters - b.reporters);
  const evCols = ['sha', 'path', 'date', 'count', 'actor', 'matcher'];
  const cell = 9;
  const evSvg = `<svg viewBox="0 0 ${evCols.length * (cell + 2) + 220} ${evRows.length * (cell + 1) + 20}" width="${evCols.length * (cell + 2) + 220}" role="img" aria-label="Evidence dimensions per class, weakest first">
    ${evCols.map((k, j) => `<text x="${60 + j * (cell + 2) + cell / 2}" y="10" font-size="7" text-anchor="middle" fill="${PAPER.mut}">${k}</text>`).join('')}
    ${evRows.map((r, i) => { const y = 16 + i * (cell + 1); return `<text x="56" y="${y + cell - 1}" font-size="7" text-anchor="end" fill="${r.score === 0 ? PAPER.crit : PAPER.ink}" font-family="Menlo,monospace">${esc(r.id)}</text>` + evCols.map((k, j) => `<rect x="${60 + j * (cell + 2)}" y="${y}" width="${cell}" height="${cell}" rx="1" fill="${r[k] ? SEQ[4] : SEQ[0]}"><title>${esc(r.id)} ${k}: ${r[k] ? 'present' : 'absent'}</title></rect>`).join('') + `<text x="${60 + evCols.length * (cell + 2) + 4}" y="${y + cell - 1}" font-size="7" fill="${PAPER.mut}">${r.reporters} reporter${r.reporters === 1 ? '' : 's'}${r.derived ? ' · marked derived' : ''}</text>`; }).join('')}
  </svg>`;
  const zeroEvidence = A.evidence.filter((e) => e.score === 0).map((e) => e.id);
  const derived = A.evidence.filter((e) => e.derived).map((e) => e.id);

  const offRows = A.offFamily.slice(0, 40).map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(famOf(r.id).roman)}</td><td>${esc(r.nn)}</td><td>${esc(famOf(r.nn).roman)}</td><td class="num">${f3(r.sim)}</td><td>${r.sameTriple ? '<b>same</b>' : '—'}</td><td>${r.declared ? 'declared' : '<span class="warn">none</span>'}</td></tr>`).join('');
  const tripleRows = A.sharedTriples.slice(0, 25).map((g) => `<tr><td><code>${esc(g.triple.replace(/\|/g, ' · '))}</code></td><td>${g.pairs.map((p) => `${esc(p.a)}↔${esc(p.b)} <span class="num">${f3(p.sim)}</span>${p.declared ? '' : ' <span class="warn">undeclared</span>'}`).join('<br>')}</td></tr>`).join('');
  const famRows = A.famStats.map((s) => `<tr><td>${esc(fam.find((f) => f.prefix === s.prefix).roman)} ${esc(fam.find((f) => f.prefix === s.prefix).name)}</td><td class="num">${s.n}</td><td class="num">${f3(s.within)}</td><td>${esc(fam.find((f) => f.prefix === s.nearest.q).roman)} <span class="num">${f3(s.nearest.m)}</span></td><td>${s.within > s.nearest.m ? 'holds' : '<span class="warn">closer to another family</span>'}</td></tr>`).join('');
  const dissimilarEdges = A.edges.filter((e) => e.sim < 0.08).map((e) => `${e.relation} ${A.ids[e.from]}→${A.ids[e.to]} (${f3(e.sim)})`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Failure taxonomy v${esc(doc.version)} — structure</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:${PAPER.bg};--panel:${PAPER.panel};--panel2:${PAPER.panel2};--line:${PAPER.line};--line2:${PAPER.line2};--ink:${PAPER.ink};--mut:${PAPER.mut};--dim:${PAPER.dim};--acc:${PAPER.acc};--crit:${PAPER.crit}}
body{margin:0;padding:1.5rem 2rem 4rem;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1{font-size:1.6rem;margin:0 0 .2rem}h2{font-size:1.1rem;margin:2rem 0 .4rem}p{max-width:80ch}
.kicker{font:600 11px/1 sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:.6rem}
.tiles{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}.tile{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:.6rem .9rem;min-width:9rem}
.tile .l{font-size:11px;color:var(--dim)}.tile .v{font:600 22px/1.2 -apple-system,sans-serif}.tile .d{font-size:11px;color:var(--mut)}
table{border-collapse:collapse;font-size:12px;margin:.5rem 0}th,td{border-bottom:1px solid var(--line);padding:.3em .6em;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600}
td.num,span.num{font-family:Menlo,monospace;font-size:11px}.warn{color:var(--crit)}code{font:11px Menlo,monospace}
.heat{display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap}canvas{border:1px solid var(--line);background:#fff}
.ctl button{font:12px sans-serif;padding:.3em .7em;border:1px solid var(--line2);background:var(--panel);border-radius:4px;cursor:pointer}.ctl button[aria-pressed=true]{background:var(--acc);color:#fff;border-color:var(--acc)}
#tip{position:fixed;pointer-events:none;background:var(--panel);border:1px solid var(--line2);border-radius:4px;padding:.4em .6em;font-size:12px;max-width:34ch;display:none;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.legend span{display:inline-block;margin-right:1em;font-size:12px}.legend i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:.3em}
.ramp{display:inline-block;height:10px;width:140px;vertical-align:middle;background:linear-gradient(to right,${SEQ.join(',')})}
.note{color:var(--mut);font-size:12px;max-width:80ch}
@media print{.ctl,#tip{display:none}}
</style></head><body>
<div class="kicker">commitwork · failure taxonomy v${esc(doc.version)} · structure, measured three ways</div>
<h1>How the ${N} classes relate</h1>
<p>Three witnesses that cannot share a failure mode: the <b>words</b> (TF-IDF cosine over name, predicate and description), the <b>STPA code</b> each class carries (loop · unsafe action · cause), and the <b>causal edges</b> the register declares. Where the words say two classes are close and neither the code nor an edge separates them, that is a class without a separating observation (G14). Where an edge is declared between classes the words do not connect, the edge rests on something other than wording, which is either the register's best content or its weakest. No model was consulted: every number is computed from <code>monitor/failure-taxonomy.json</code> at generation, and the page carries its own data.</p>

<div class="tiles">
  <div class="tile"><div class="l">within-family similarity</div><div class="v">${f3(A.perm.within)}</div><div class="d">mean cosine, same family</div></div>
  <div class="tile"><div class="l">between-family similarity</div><div class="v">${f3(A.perm.between)}</div><div class="d">mean cosine, different family</div></div>
  <div class="tile"><div class="l">permutation p</div><div class="v">${A.perm.p < 0.001 ? '&lt; 0.001' : A.perm.p.toFixed(3)}</div><div class="d">${A.perm.perms} label shuffles, seed 42</div></div>
  <div class="tile"><div class="l">declared edges</div><div class="v">${A.edges.length}</div><div class="d">over ${new Set(A.edges.map((e) => e.to)).size} targets</div></div>
  <div class="tile"><div class="l">off-family nearest neighbours</div><div class="v">${A.offFamily.length}</div><div class="d">of ${N} classes</div></div>
  <div class="tile"><div class="l">zero-evidence classes</div><div class="v">${zeroEvidence.length}</div><div class="d">no sha, path, date, count or actor</div></div>
  <div class="tile"><div class="l">rater agreement, closure</div><div class="v">${A.kappa.closure === null ? '—' : A.kappa.closure.toFixed(2)}</div><div class="d">weighted κ, pass 1 vs pass 2</div></div>
  <div class="tile"><div class="l">rater agreement, gain</div><div class="v">${A.kappa.gain === null ? '—' : A.kappa.gain.toFixed(2)}</div><div class="d">${A.kappa.changed} of ${N} scores moved</div></div>
</div>
<p class="note">The permutation test asks whether families are lexical clusters: if shuffling the family labels reaches the observed within-minus-between gap in fewer than one shuffle in a thousand, the families are real groupings of wording, not filing conventions. It says nothing about whether the classes are <i>correct</i>. Kappa compares the registry's first scoring pass with today's second pass on the same rater's rubric; both passes are one person, so it measures self-consistency, not inter-rater reliability.</p>

<h2>1 · Lexical similarity, ${N} × ${N}</h2>
<div class="heat">
  <div>
    <div class="ctl" role="group" aria-label="Order"><button id="byFam" aria-pressed="true">by family</button> <button id="byCluster" aria-pressed="false">by cluster</button> &nbsp; <span class="ramp" aria-hidden="true"></span> <span class="note">0 → 1 cosine · hover a cell</span></div>
    <canvas id="heat" width="${N * 4}" height="${N * 4}" style="width:${Math.min(N * 4, 800)}px;height:${Math.min(N * 4, 800)}px"></canvas>
    <div id="axis" class="note"></div>
  </div>
  <div style="max-width:46rem">
    <h3 style="margin:.2rem 0">Families as clusters</h3>
    <table><thead><tr><th>family</th><th>n</th><th>within</th><th>nearest other family</th><th></th></tr></thead><tbody>${famRows}</tbody></table>
    <h3>Nearest neighbour in another family (${A.offFamily.length}; top 40 by similarity)</h3>
    <p class="note">A class whose closest wording sits in a different family is either misfiled, or the families cut across the mechanism deliberately. <b>same</b> in the STPA column means the two carry the same primary triple; <b>none</b> in the last column means no causal edge is declared between them — close on words, same code, no edge is the G14 signature.</p>
    <table><thead><tr><th>class</th><th>fam</th><th>nearest</th><th>fam</th><th>cosine</th><th>STPA triple</th><th>rca edge</th></tr></thead><tbody>${offRows}</tbody></table>
  </div>
</div>

<h2>2 · Shared STPA triples (${A.sharedTriples.length} triples held by more than one class)</h2>
<p class="note">The same loop, unsafe action and cause: structurally these classes claim the same shape of control failure. A pair that is also lexically close and carries no declared edge is the first place to look for a duplicate.</p>
<table><thead><tr><th>triple</th><th>pairs · cosine · declared?</th></tr></thead><tbody>${tripleRows}</tbody></table>

<h2>3 · Declared causal edges over the family axis, with undeclared similarity underneath</h2>
<div class="legend">${Object.entries(REL_C).map(([k, c]) => `<span><i style="background:${c}"></i>${esc(k)}</span>`).join('')}<span><i style="background:${PAPER.line2};height:1px;border-top:2px dashed ${PAPER.line2}"></i>undeclared, top 60 by cosine</span></div>
${arcSvg}
<p class="note">Solid arcs are the register's ${A.edges.length} declared relations; dashed arcs are the sixty most similar pairs with no edge between them. Hover an arc for the pair and its cosine. Declared edges whose wording barely overlaps (cosine below 0.08): ${dissimilarEdges.length ? esc(dissimilarEdges.join('; ')) : 'none'} — each of those is an edge argued on mechanism rather than words, which is what the basis quote on the edge is for.</p>

<h2>4 · Evidence dimensions, weakest classes first</h2>
<p class="note">For each class, whether its example and basis carry a sha, a path, a date, a count, a cited actor, and whether its example fires the registry's own evidence matcher; the reporter count is distinct session ids and refs cited. A class with none of the five is derived rather than measured: ${zeroEvidence.length ? esc(zeroEvidence.join(', ')) : 'none'}. Classes whose basis marks itself derived or inferred: ${derived.length ? esc(derived.join(', ')) : 'none'}. This is a proxy for measurement, not for truth — a wrong sha is still a sha.</p>
<div style="overflow-x:auto">${evSvg}</div>

<p class="note">Generated by <code>bin/taxonomy-structure.mjs</code> from <code>monitor/failure-taxonomy.json</code> (registry version ${esc(doc.version)}, verified against ${esc(doc.verifiedAgainst)}). Deterministic; regenerate rather than edit.</p>
<div id="tip" role="tooltip"></div>
<script id="data" type="application/json">${JSON.stringify(data)}</script>
<script>
(function(){
  const D = JSON.parse(document.getElementById('data').textContent);
  const n = D.n, cv = document.getElementById('heat'), ctx = cv.getContext('2d'), tip = document.getElementById('tip'), axis = document.getElementById('axis');
  const seq = D.seq.map(h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]);
  const colour = (v) => { const t = Math.min(1, v / 0.6) * (seq.length - 1); const i = Math.floor(t), f = t - i; const a = seq[i], b = seq[Math.min(i + 1, seq.length - 1)]; return 'rgb(' + [0,1,2].map(k => Math.round(a[k] + (b[k] - a[k]) * f)).join(',') + ')'; };
  let order = D.famOrder.slice();
  function draw() {
    const px = cv.width / n;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const v = D.sim[order[r] * n + order[c]] / 255; ctx.fillStyle = colour(v); ctx.fillRect(c * px, r * px, px, px); }
    // family bands: a hairline where the family changes along the current order
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
    for (let k = 1; k < n; k++) if (D.fam[order[k]] !== D.fam[order[k - 1]]) { ctx.beginPath(); ctx.moveTo(k * px, 0); ctx.lineTo(k * px, cv.height); ctx.moveTo(0, k * px); ctx.lineTo(cv.width, k * px); ctx.stroke(); }
    const runs = []; let start = 0; for (let k = 1; k <= n; k++) if (k === n || D.fam[order[k]] !== D.fam[order[k - 1]]) { runs.push(D.fam[order[start]] + (k - start > 1 ? '×' + (k - start) : '')); start = k; }
    axis.textContent = 'order: ' + runs.join(' ');
  }
  document.getElementById('byFam').onclick = () => { order = D.famOrder.slice(); press('byFam'); draw(); };
  document.getElementById('byCluster').onclick = () => { order = D.order.slice(); press('byCluster'); draw(); };
  function press(id) { for (const b of ['byFam', 'byCluster']) document.getElementById(b).setAttribute('aria-pressed', String(b === id)); }
  cv.addEventListener('mousemove', (e) => {
    const rect = cv.getBoundingClientRect(); const c = Math.floor((e.clientX - rect.left) / rect.width * n), r = Math.floor((e.clientY - rect.top) / rect.height * n);
    if (c < 0 || r < 0 || c >= n || r >= n) { tip.style.display = 'none'; return; }
    const i = order[r], j = order[c]; const v = D.sim[i * n + j] / 255;
    const edge = D.edges.find(x => (x[0] === i && x[1] === j) || (x[0] === j && x[1] === i));
    tip.innerHTML = '<b>' + D.ids[i] + '</b> ' + D.names[i] + '<br><b>' + D.ids[j] + '</b> ' + D.names[j] + '<br>cosine ' + v.toFixed(3) + (D.fam[i] === D.fam[j] ? ' · same family' : ' · different families') + (D.triples[i] === D.triples[j] ? ' · <b>same STPA triple</b>' : '') + (edge ? ' · edge: ' + edge[2] : ' · no declared edge');
    tip.style.display = 'block'; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  });
  cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  draw();
})();
</script>
</body></html>`;
}

function main() {
  const jsonPath = argOf('--json', process.env.CW_TAXONOMY_JSON || resolve(REPO, 'monitor', 'failure-taxonomy.json'));
  const perms = Number(argOf('--perms', 1000));
  const doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const out = argOf('--out', resolve(REPO, 'reports', `taxonomy-structure-v${doc.version}.html`));
  const A = analyse(doc, { perms });
  writeAtomic(out, renderPage(doc, A));
  console.log(`wrote ${out} — ${A.n} classes; within ${f3(A.perm.within)} between ${f3(A.perm.between)} p ${A.perm.p.toFixed(3)}; ${A.offFamily.length} off-family nearest; ${A.sharedTriples.length} shared triples; ${A.edges.length} edges; ${A.evidence.filter((e) => e.score === 0).length} zero-evidence; kappa closure ${A.kappa.closure?.toFixed(2)} gain ${A.kappa.gain?.toFixed(2)}`);
}
const isMain = isMainModule(import.meta.url);
if (isMain) main();

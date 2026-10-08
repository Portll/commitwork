// release-scope.mjs — the release name scope and the one matcher both release-name gates use.
//
// SCOPE is the union of three private documents in the sidecar: the release manifest's `names`,
// the publish map's keys, and every scope=all name and alias in the identity register. Explicit
// exclusions (the manifest's `outOfScope` keys, the register's `notInScope`) are subtracted, EXCEPT
// a form the register itself lists as scope=all. Operator ruling D22.1 (2026-09-30) put every name
// the maps cover in scope with no per-name exceptions, so a disagreement between the two documents
// resolves toward redaction and is counted in `overridden` rather than dropped without a word.
//
// MATCHING is case-insensitive and separator-normalised, because one repository is written
// acme-labs, acme_labs, AcmeLabs and a-c-m-e-l-a-b-s, and a literal substring check sees only one.
//   - A name of more than SHORT_KEY letters and digits matches with at most one separator (one
//     space, or any other non-alphanumeric character but a tab or newline) between any two of its
//     characters, inside a larger identifier or not: CW_ACMELABS, acmeLabsDir and Acme Labs count.
//   - A name of SHORT_KEY or fewer must stand as its own word or camelCase segment. As a bare
//     substring, a three-letter key matched dozens of advisory ids and lockfile hashes in this
//     tree and not one use of the name.
//   - A name ending in a separator is a PREFIX: every token that starts with it counts, bare or
//     completed, so a whole class of service names is caught without listing each one.
//
// Results carry the source document and the location, never the matched text. These messages
// reach logs, and a gate that printed the names it guards would publish them.

import { createHash } from 'node:crypto';

export const SHORT_KEY = 5;
export const SOURCES = ['release-manifest', 'publish-map', 'identity-register'];

export const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const isPrefixForm = (s) => /[^A-Za-z0-9]$/.test(s) && normKey(s).length > 0;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = '(?:[^A-Za-z0-9\\s]| )?';

function need(cond, msg) {
  if (!cond) throw new Error(`release-scope: ${msg} — refusing to build a scope that would report clean over names it never loaded`);
}

/**
 * Build the scope from the three parsed documents. Throws on a malformed document: a scope that
 * silently lost a source is the one way this gate passes without looking.
 */
export function buildScope({ release, publish, identities }) {
  need(release && Array.isArray(release.names) && release.names.length, 'the release manifest has no names[]');
  need(publish && publish.map && typeof publish.map === 'object' && !Array.isArray(publish.map), 'the publish map has no map{}');
  need(identities && Array.isArray(identities.identities), 'the identity register has no identities[]');

  const ruledOut = new Set();
  for (const k of Object.keys(release.outOfScope || {})) ruledOut.add(normKey(k));
  for (const n of identities.notInScope || []) if (n && n.name) ruledOut.add(normKey(n.name));

  const registerAll = new Set();
  const forms = [];
  const add = (form, source, extra = {}) => { if (typeof form === 'string' && normKey(form)) forms.push({ form, source, ...extra }); };
  for (const n of release.names) {
    const prose = n.scope === 'prose';
    add(n.name, 'release-manifest', prose ? { exempt: [...(n.exempt || []), ...(n.undetermined || [])] } : {});
  }
  for (const k of Object.keys(publish.map)) add(k, 'publish-map');
  for (const i of identities.identities) {
    if (!i || i.scope !== 'all') continue;
    for (const a of [i.repo_name, ...(i.repo_aliases || [])]) {
      if (typeof a !== 'string' || !normKey(a)) continue;
      registerAll.add(normKey(a));
      add(a, 'identity-register');
    }
  }

  const words = new Map();
  const prefixes = new Map();
  let overridden = 0;
  const seenOverride = new Set();
  for (const f of forms) {
    const key = normKey(f.form);
    if (ruledOut.has(key)) {
      if (!registerAll.has(key)) continue;
      if (!seenOverride.has(key)) { seenOverride.add(key); overridden++; }
    }
    const bucket = isPrefixForm(f.form) ? prefixes : words;
    const prev = bucket.get(key);
    if (!prev) bucket.set(key, { key, sources: new Set([f.source]), exempt: [...(f.exempt || [])], all: !f.exempt });
    else { prev.sources.add(f.source); prev.exempt.push(...(f.exempt || [])); prev.all ||= !f.exempt; }
  }
  // A prose entry's exemptions never reach a form another document scopes as `all`.
  const list = (m) => [...m.values()].map((w) => ({ key: w.key, source: SOURCES.find((s) => w.sources.has(s)), exempt: w.all ? [] : [...new Set(w.exempt)] }));
  const undetermined = release.names.filter((n) => n.scope === 'prose')
    .flatMap((n) => (n.undetermined || []).map((form) => ({ form, source: 'release-manifest' })));
  const loaded = Object.fromEntries(SOURCES.map((s) => [s, forms.filter((f) => f.source === s).length]));
  return compile({ words: list(words), prefixes: list(prefixes), overridden, undetermined, loaded });
}

function compile(scope) {
  const words = scope.words.map((w) => ({
    ...w,
    short: w.key.length <= SHORT_KEY,
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- every key and prefix goes through esc() before it is joined
    re: new RegExp(w.key.length <= SHORT_KEY ? esc(w.key) : [...w.key].map(esc).join(SEP), 'gi'),
  }));
  const prefixRe = scope.prefixes.length
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- every key and prefix goes through esc() before it is joined
    ? new RegExp(`(?<![A-Za-z0-9])(?:${scope.prefixes.map((p) => esc(p.key)).join('|')})[-_]`, 'gi')
    : null;
  // Equality for caches only; a digest, so it never carries a name.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([scope.words.map((w) => [w.key, w.source, w.exempt]), scope.prefixes.map((p) => p.key)]))
    .digest('hex').slice(0, 16);
  return { ...scope, words, prefixRe, fingerprint };
}

/** `scope` without `forms`, as names and as prefixes: a repository's own name is not a leak in it. */
export function withoutNames(scope, forms) {
  const drop = new Set(forms.map(normKey).filter(Boolean));
  const keep = (x) => !drop.has(x.key);
  return compile({ ...scope, words: scope.words.filter(keep), prefixes: scope.prefixes.filter(keep) });
}

const alnum = (c) => c !== undefined && /[A-Za-z0-9]/.test(c);
const lower = (c) => c !== undefined && /[a-z]/.test(c);
const upper = (c) => c !== undefined && /[A-Z]/.test(c);
// A word edge: the text ends, a non-alphanumeric sits there, or a camelCase hump starts there.
const edgeBefore = (t, i) => !alnum(t[i - 1]) || (lower(t[i - 1]) && upper(t[i]));
const edgeAfter = (t, j) => !alnum(t[j]) || (lower(t[j - 1]) && upper(t[j]));

function covered(lowerText, start, end, exempt) {
  for (const e of exempt) {
    const needle = e.toLowerCase();
    let j = lowerText.indexOf(needle);
    while (j !== -1) {
      if (start >= j && end <= j + needle.length) return true;
      j = lowerText.indexOf(needle, j + 1);
    }
  }
  return false;
}

/**
 * Every occurrence of a scoped name in `text`, as { start, end, source, kind }, overlapping spans
 * merged. `kind` is 'name' or 'prefix'.
 */
export function findNames(text, scope) {
  if (typeof text !== 'string' || !text) return [];
  const flat = normKey(text);
  const lowerText = text.toLowerCase();
  const spans = [];
  for (const w of scope.words) {
    if (!flat.includes(w.key)) continue;           // cheap exclusion before the regex runs
    w.re.lastIndex = 0;
    for (const m of text.matchAll(w.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (w.short && !(edgeBefore(text, start) && edgeAfter(text, end))) continue;
      if (w.exempt.length && covered(lowerText, start, end, w.exempt)) continue;
      spans.push({ start, end, source: w.source, kind: 'name' });
    }
  }
  if (scope.prefixRe) {
    scope.prefixRe.lastIndex = 0;
    for (const m of text.matchAll(scope.prefixRe)) {
      const stem = normKey(m[0]);
      const p = scope.prefixes.find((x) => x.key === stem);
      spans.push({ start: m.index, end: m.index + m[0].length, source: p ? p.source : 'identity-register', kind: 'prefix' });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) { last.end = Math.max(last.end, s.end); continue; }
    merged.push({ ...s });
  }
  return merged;
}

/** 1-based line of each hit, with its source. Never the matched text. */
export function locate(text, hits) {
  const out = [];
  let line = 1;
  let at = 0;
  for (const h of hits) {
    for (; at < h.start; at++) if (text.charCodeAt(at) === 10) line++;
    out.push({ line, source: h.source, kind: h.kind });
  }
  return out;
}

/** One row per file, line and source, for a failure message: `path:line (source, kind)` plus a count. */
/** One row per path, line and source. The path is masked: a file named after an identity would
 *  otherwise print that identity in the very report that flags it. */
export function offenderRows(content, scope) {
  const rows = new Map();
  for (const { path, hits } of content) {
    const shown = mask(path, findNames(path, scope));
    for (const h of hits) {
      const k = `${shown}:${h.line} (${h.source}, ${h.kind})`;
      rows.set(k, (rows.get(k) || 0) + 1);
    }
  }
  return [...rows].map(([k, n]) => (n > 1 ? `${k} x${n}` : k));
}

/** `text` with each hit replaced by its source in angle quotes, for messages that must name a path. */
export function mask(text, hits) {
  let out = '';
  let at = 0;
  for (const h of hits) { out += `${text.slice(at, h.start)}‹${h.source}›`; at = h.end; }
  return out + text.slice(at);
}

/** Undetermined forms: counted and reported by the caller, never failed on. */
export function undeterminedCount(text, scope) {
  const hay = String(text).toLowerCase();
  return scope.undetermined.filter((u) => hay.includes(u.form.toLowerCase())).length;
}

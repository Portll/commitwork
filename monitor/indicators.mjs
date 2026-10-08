#!/usr/bin/env node
// monitor/indicators.mjs — indicators IN. The missing half of monitor/ingest-external.mjs.
//
// WHAT THIS IS COPYING. The Mobile Verification Toolkit that Amnesty International shipped
// alongside the Pegasus forensic methodology has one structural idea worth more than its entire
// indicator list: the MATCHER and the INDICATORS are separate artifacts, and the indicators arrive
// in a standard format (STIX 2). Nobody has to modify MVT to hunt a different actor. You hand it a
// different bundle.
//
// commitwork has the return path already — monitor/ingest-external.mjs is the single spine through
// which an external JUDGEMENT (false-positive, remediated, not-applicable) reaches the issue store.
// It has no path for an external CLAIM. Every detection this fleet performs is compiled into a
// scanner lane, which means aiming it at a newly published compromise — an npm account takeover, a
// malicious release, a domain list — is a code change and a deploy, not an input.
//
// This module makes indicators an input. It fits the house rule about declaration and authority
// exactly: an indicator is a DECLARATION, matching is a TOOL, and deciding what a match means
// stays a human act. Nothing here writes to the issue store, and nothing here is a finding.
//
// fact: this parser understands a deliberately small subset of STIX's pattern language, and every UNPARSED pattern is retained, counted and carried into the match result / an implementation that skips what it cannot parse makes a bundle of 500 indicators, 400 of them unsupported, report "no matches" indistinguishably from one fully applied and clean (expiry: as the supported subset grows, prev: broken)
// fact: `appliedFraction` is published beside every count, so a zero at appliedFraction 0.2 is not a zero at all / Amnesty stated the same limit about their own data — 1,748 subdomains, "less than 7%" of known installation domains — and it is why their zero-findings cases were never written up as clean (expiry: never, prev: missing)
//
// usage: node monitor/indicators.mjs <bundle.json> [--json]
//        node monitor/indicators.mjs <bundle.json> --match <observables.json>

import { readFileSync } from 'node:fs';
import { unknown } from './unknown.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const isMain = isMainModule(import.meta.url);

/**
 * The observable types this fleet can actually produce a corpus for. An indicator of a type not on
 * this list is retained as `unsupported` rather than dropped — the bundle is not wrong, we simply
 * have nothing to compare it against, and that is a coverage void with a name.
 */
export const OBSERVABLE = Object.freeze({
  DOMAIN: 'domain',
  URL: 'url',
  IPV4: 'ipv4',
  IPV6: 'ipv6',
  SHA256: 'sha256',
  SHA512: 'sha512',
  SHA1: 'sha1',
  MD5: 'md5',
  EMAIL: 'email',
  PROCESS: 'process',
  PACKAGE: 'package',
});

/** STIX object-path → our observable type. The quoted-hash forms are the ones real bundles use. */
const STIX_PATHS = new Map(Object.entries({
  'domain-name:value': OBSERVABLE.DOMAIN,
  'url:value': OBSERVABLE.URL,
  'ipv4-addr:value': OBSERVABLE.IPV4,
  'ipv6-addr:value': OBSERVABLE.IPV6,
  "file:hashes.'SHA-256'": OBSERVABLE.SHA256,
  'file:hashes.SHA-256': OBSERVABLE.SHA256,
  "file:hashes.'SHA-512'": OBSERVABLE.SHA512,
  'file:hashes.SHA-512': OBSERVABLE.SHA512,
  "file:hashes.'SHA-1'": OBSERVABLE.SHA1,
  'file:hashes.MD5': OBSERVABLE.MD5,
  "file:hashes.'MD5'": OBSERVABLE.MD5,
  'email-addr:value': OBSERVABLE.EMAIL,
  'process:name': OBSERVABLE.PROCESS,
  'process:command_line': OBSERVABLE.PROCESS,
  'software:name': OBSERVABLE.PACKAGE,
}));

// The subset of the pattern language this parser claims: one or more `path = 'value'` comparisons
// joined by OR, inside a single observation expression. Everything else — MATCHES, LIKE, IN, AND
// across object types, qualifiers such as WITHIN/REPEATS, multiple observation expressions — is
// declared unsupported by name so a reader can tell "we did not look" from "we looked and it was
// not there".
const COMPARISON = /([a-z0-9_-]+:[a-zA-Z0-9_.]+(?:'[^']*')?|[a-z0-9_-]+:hashes\.'[^']+')\s*=\s*'([^']*)'/g;
const UNSUPPORTED_OPS = /\b(MATCHES|LIKE|ISSUBSET|ISSUPERSET|REPEATS|WITHIN|START|STOP)\b|\bIN\s*\(/;

/**
 * Parse one STIX pattern into comparisons. Returns `{ok, terms}` or an unknown carrying WHY, which
 * is the whole point: a caller must be able to report the count of patterns it could not read.
 */
export function parsePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) return unknown('unstated', 'empty pattern');
  if (UNSUPPORTED_OPS.test(pattern)) {
    return unknown('unexaminable', `pattern uses an operator this parser does not implement: ${pattern.slice(0, 120)}`);
  }
  // A single observation expression only. Two bracketed groups mean a temporal/compound pattern.
  if ((pattern.match(/\[/g) || []).length !== 1) {
    return unknown('unexaminable', `pattern is not a single observation expression: ${pattern.slice(0, 120)}`);
  }
  if (/\bAND\b/.test(pattern)) {
    return unknown('unexaminable', `pattern conjoins terms with AND, which this parser cannot evaluate: ${pattern.slice(0, 120)}`);
  }

  const terms = [];
  const unsupportedPaths = [];
  COMPARISON.lastIndex = 0;
  let m;
  while ((m = COMPARISON.exec(pattern)) !== null) {
    const [, path, value] = m;
    const type = STIX_PATHS.get(path);
    if (!type) { unsupportedPaths.push(path); continue; }
    terms.push({ type, value });
  }
  if (!terms.length) {
    return unknown('unexaminable', unsupportedPaths.length
      ? `no supported object path in the pattern (saw ${[...new Set(unsupportedPaths)].join(', ')})`
      : `no comparison this parser recognises: ${pattern.slice(0, 120)}`);
  }
  return { ok: true, terms, unsupportedPaths: [...new Set(unsupportedPaths)] };
}

/**
 * Parse a STIX 2.x bundle. Never throws on a malformed object — a bad object joins `rejected` with
 * a reason. A bundle that is not JSON at all is the caller's problem and does throw, because there
 * is nothing partial to report.
 */
export function parseStixBundle(bundle, { source = null } = {}) {
  const objects = Array.isArray(bundle && bundle.objects) ? bundle.objects
    : Array.isArray(bundle) ? bundle : null;
  if (!objects) {
    return {
      source, indicators: [], rejected: [],
      ...unknown('unparseable', 'not a STIX bundle: no objects[] array'),
    };
  }

  const indicators = [];
  const rejected = [];
  for (const o of objects) {
    if (!o || o.type !== 'indicator') continue;
    const parsed = parsePattern(o.pattern);
    if (parsed.unknown) {
      rejected.push({
        id: o.id ?? null, name: o.name ?? null, pattern: o.pattern ?? null,
        unknownReason: parsed.unknownReason, unknownDetail: parsed.unknownDetail ?? null,
      });
      continue;
    }
    for (const t of parsed.terms) {
      indicators.push({
        id: o.id ?? null, name: o.name ?? null, created: o.created ?? null,
        type: t.type, value: normalise(t.type, t.value), source,
      });
    }
  }
  return { source, indicators, rejected };
}

/**
 * MVT and most published lists also ship as plain text, one value per line. Supported because the
 * point of the module is that indicators are an INPUT — refusing everything but STIX would put the
 * common case back behind a conversion step.
 */
export function parsePlainList(text, type, { source = null } = {}) {
  if (!Object.values(OBSERVABLE).includes(type)) {
    throw new Error(`indicators: '${type}' is not a declared observable type. Declared: ${Object.values(OBSERVABLE).join(', ')}`);
  }
  const indicators = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    indicators.push({ id: null, name: null, created: null, type, value: normalise(type, line), source });
  }
  return { source, indicators, rejected: [] };
}

/** Case and separator handling, per type. Hex digests and hostnames are case-insensitive; a
 *  process name and a package name are not, and folding them would manufacture matches. */
function normalise(type, value) {
  const v = String(value).trim();
  switch (type) {
    case OBSERVABLE.DOMAIN:
    case OBSERVABLE.EMAIL:
      return v.toLowerCase().replace(/\.$/, '');
    case OBSERVABLE.SHA256:
    case OBSERVABLE.SHA512:
    case OBSERVABLE.SHA1:
    case OBSERVABLE.MD5:
      return v.toLowerCase();
    default:
      return v;
  }
}

// ── matching ────────────────────────────────────────────────────────────────────────────────────

/**
 * A domain indicator matches its SUBDOMAINS. This is not a convenience: Amnesty's 23 primary
 * infection domains accounted for 1,748 observed subdomains, and an exact-match-only checker would
 * have found none of them. The suffix boundary is a dot, so `notevil.com` never matches
 * `evil.com`.
 */
export function domainMatches(indicatorDomain, observed) {
  const i = indicatorDomain.toLowerCase();
  const o = String(observed).toLowerCase().replace(/\.$/, '');
  return o === i || o.endsWith(`.${i}`);
}

/** A URL indicator matches a URL exactly; a DOMAIN indicator also matches a URL whose host it
 *  covers, because that is how an installation domain shows up in a repo's fetched-from list. */
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/**
 * Match a corpus of observables against a set of indicators.
 *
 * `observables` are `{type, value, where}` — `where` being whatever locates it for a human
 * (repo/file/lockfile entry). `where` is carried through untouched and is never part of identity:
 * per the house rule, an indicator match is keyed on (indicator, type, value), so the same match
 * reappearing in a different file is the SAME match having moved.
 */
export function matchIndicators(indicatorSets, observables, { cap = 200 } = {}) {
  const indicators = indicatorSets.flatMap((s) => s.indicators || []);
  const rejected = indicatorSets.flatMap((s) => (s.rejected || []).map((r) => ({ ...r, source: s.source ?? null })));
  const unreadableSets = indicatorSets.filter((s) => s.unknown)
    .map((s) => ({ source: s.source ?? null, unknownReason: s.unknownReason, unknownDetail: s.unknownDetail ?? null }));

  const byType = new Map();
  for (const ind of indicators) {
    if (!byType.has(ind.type)) byType.set(ind.type, []);
    byType.get(ind.type).push(ind);
  }

  const hits = new Map();
  for (const obs of observables) {
    const candidates = [
      ...(byType.get(obs.type) || []),
      // A domain indicator is also applicable to an observed URL.
      ...(obs.type === OBSERVABLE.URL ? (byType.get(OBSERVABLE.DOMAIN) || []) : []),
    ];
    for (const ind of candidates) {
      if (!applies(ind, obs)) continue;
      const key = `${ind.type}|${ind.value}|${ind.id ?? ind.source ?? ''}`;
      if (!hits.has(key)) {
        hits.set(key, {
          indicator: { id: ind.id, name: ind.name, type: ind.type, value: ind.value, source: ind.source },
          observedType: obs.type, occurrences: 0, where: [],
        });
      }
      const h = hits.get(key);
      h.occurrences += 1;
      if (h.where.length < 20 && obs.where != null) h.where.push(obs.where);
    }
  }

  const matches = [...hits.values()].sort((a, b) => b.occurrences - a.occurrences
    || (a.indicator.value < b.indicator.value ? -1 : 1));

  const applied = indicators.length;
  const total = applied + rejected.length;

  return {
    // The count nobody may publish alone.
    matches: matches.slice(0, cap),
    matchCount: matches.length,
    truncated: Math.max(0, matches.length - cap),
    observablesChecked: observables.length,
    indicatorsApplied: applied,
    indicatorsRejected: rejected.length,
    indicatorSetsUnreadable: unreadableSets.length,
    // A zero matchCount with appliedFraction below 1 is not a zero. Rendered by every caller.
    appliedFraction: total ? round4(applied / total) : null,
    complete: rejected.length === 0 && unreadableSets.length === 0,
    rejected: rejected.slice(0, cap),
    unreadableSets,
  };
}

function applies(ind, obs) {
  if (ind.type === OBSERVABLE.DOMAIN) {
    const observedHost = obs.type === OBSERVABLE.URL ? hostOf(obs.value) : obs.value;
    return observedHost != null && domainMatches(ind.value, observedHost);
  }
  return normalise(ind.type, obs.value) === ind.value;
}

const round4 = (n) => Math.round(n * 10000) / 10000;

/** The one sentence a caller must print beside any count derived from this module. */
export function coverageSentence(result) {
  if (result.complete) return `all ${result.indicatorsApplied} indicator(s) were applied`;
  const pct = result.appliedFraction == null ? 'an unknown fraction' : `${(result.appliedFraction * 100).toFixed(1)}%`;
  return `${result.indicatorsApplied} of ${result.indicatorsApplied + result.indicatorsRejected} indicator(s) applied (${pct})`
    + `${result.indicatorSetsUnreadable ? `, and ${result.indicatorSetsUnreadable} whole set(s) were unreadable` : ''}`
    + ' — a zero here is a floor, not a clean result';
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const bundlePath = argv.find((a) => !a.startsWith('--'));
  if (!bundlePath) {
    console.error('usage: node monitor/indicators.mjs <bundle.json> [--match <observables.json>] [--json]');
    process.exitCode = 2;
    return;
  }
  const set = parseStixBundle(JSON.parse(readFileSync(bundlePath, 'utf8')), { source: bundlePath });

  const matchIdx = argv.indexOf('--match');
  if (matchIdx < 0) {
    const byType = {};
    for (const i of set.indicators) byType[i.type] = (byType[i.type] || 0) + 1;
    const out = { source: bundlePath, parsed: set.indicators.length, rejected: set.rejected.length, byType, rejectedDetail: set.rejected };
    if (argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); return; }
    console.log(`indicators: ${set.indicators.length} parsed, ${set.rejected.length} REJECTED from ${bundlePath}`);
    for (const [t, n] of Object.entries(byType).sort()) console.log(`  ${t.padEnd(10)} ${n}`);
    for (const r of set.rejected.slice(0, 20)) console.log(`  REJECTED ${r.id ?? r.name ?? '?'} — ${r.unknownReason}: ${r.unknownDetail}`);
    if (set.rejected.length) {
      console.log('indicators: a rejected indicator is one this fleet CANNOT look for. It is not absent from the corpus; it was never asked.');
    }
    return;
  }

  const observables = JSON.parse(readFileSync(argv[matchIdx + 1], 'utf8'));
  const result = matchIndicators([set], observables);
  if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`indicators: ${result.matchCount} match(es) over ${result.observablesChecked} observable(s)`);
  for (const m of result.matches.slice(0, 25)) {
    console.log(`  MATCH  ${m.indicator.type} ${m.indicator.value}  ×${m.occurrences}  ${m.where.slice(0, 3).join(', ')}`);
  }
  console.log(`indicators: ${coverageSentence(result)}`);
}

if (isMain) main();

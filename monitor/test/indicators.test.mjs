// node --test monitor/test/ — indicators.mjs: STIX2 in. An unparsed pattern is RETAINED and
// counted, never skipped; a domain indicator covers its subdomains and no lookalike; a zero match
// count carries its applied fraction; nothing here is a finding.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBSERVABLE, parsePattern, parseStixBundle, parsePlainList,
  domainMatches, matchIndicators, coverageSentence,
} from '../indicators.mjs';

const ind = (pattern, extra = {}) => ({ type: 'indicator', id: `indicator--${pattern.length}`, pattern, ...extra });
const bundle = (...objects) => ({ type: 'bundle', objects });

describe('parsePattern — the supported subset, and a NAMED refusal outside it', () => {
  test('a single equality comparison', () => {
    const r = parsePattern("[domain-name:value = 'evil.example']");
    assert.equal(r.ok, true);
    assert.deepEqual(r.terms, [{ type: OBSERVABLE.DOMAIN, value: 'evil.example' }]);
  });

  test('OR-joined comparisons all become terms', () => {
    const r = parsePattern("[domain-name:value = 'a.test' OR domain-name:value = 'b.test']");
    assert.equal(r.terms.length, 2);
  });

  test("file:hashes.'SHA-256' — the quoted-hash form real bundles use", () => {
    const r = parsePattern("[file:hashes.'SHA-256' = 'ABCD']");
    assert.deepEqual(r.terms, [{ type: OBSERVABLE.SHA256, value: 'ABCD' }]);
  });

  test('MATCHES is REFUSED BY NAME, not silently ignored', () => {
    const r = parsePattern("[url:value MATCHES '.*evil.*']");
    assert.equal(r.unknown, true);
    assert.equal(r.unknownReason, 'unexaminable');
    assert.match(r.unknownDetail, /operator this parser does not implement/);
  });

  test('AND is refused — a conjunction this parser cannot evaluate must not be half-evaluated', () => {
    const r = parsePattern("[domain-name:value = 'a.test' AND file:hashes.MD5 = 'x']");
    assert.equal(r.unknown, true);
  });

  test('a compound observation expression is refused', () => {
    const r = parsePattern("[domain-name:value = 'a.test'] FOLLOWEDBY [process:name = 'bh']");
    assert.equal(r.unknown, true);
  });

  test('a supported syntax over an UNSUPPORTED object path is refused, naming the path', () => {
    const r = parsePattern("[windows-registry-key:key = 'HKLM\\\\x']");
    assert.equal(r.unknown, true);
    assert.match(r.unknownDetail, /windows-registry-key:key/);
  });

  test('an empty pattern is unstated, distinct from unreadable', () => {
    assert.equal(parsePattern('').unknownReason, 'unstated');
    assert.equal(parsePattern(undefined).unknownReason, 'unstated');
  });
});

describe('parseStixBundle — rejected indicators are RETAINED', () => {
  test('the rejected list is the whole point: 1 applied, 2 rejected, and all three counted', () => {
    const b = bundle(
      ind("[domain-name:value = 'good.test']"),
      ind("[url:value MATCHES '.*']"),
      ind("[windows-registry-key:key = 'x']"),
      { type: 'malware', id: 'malware--1' },
    );
    const r = parseStixBundle(b, { source: 'test' });
    assert.equal(r.indicators.length, 1);
    assert.equal(r.rejected.length, 2, 'an unparseable indicator must never be silently dropped');
    assert.ok(r.rejected.every((x) => x.unknownReason && x.pattern), 'each rejection carries its reason and its pattern');
  });

  test('a non-bundle is unparseable, not empty', () => {
    const r = parseStixBundle({ nope: true });
    assert.equal(r.unknown, true);
    assert.equal(r.unknownReason, 'unparseable');
    assert.deepEqual(r.indicators, []);
  });

  test('domains and hashes are case-folded; process and package names are NOT', () => {
    const r = parseStixBundle(bundle(
      ind("[domain-name:value = 'EVIL.Example.']"),
      ind("[file:hashes.'SHA-256' = 'AABBCC']"),
      ind("[process:name = 'roleAboutd']"),
      ind("[software:name = 'React-Native']"),
    ));
    const v = Object.fromEntries(r.indicators.map((i) => [i.type, i.value]));
    assert.equal(v[OBSERVABLE.DOMAIN], 'evil.example', 'host case and the trailing dot are noise');
    assert.equal(v[OBSERVABLE.SHA256], 'aabbcc');
    assert.equal(v[OBSERVABLE.PROCESS], 'roleAboutd', 'folding a process name manufactures matches');
    assert.equal(v[OBSERVABLE.PACKAGE], 'React-Native');
  });
});

describe('parsePlainList — the common shipped form', () => {
  test('comments and blanks are skipped, values are normalised', () => {
    const r = parsePlainList('# header\nEvil.Test\n\n  other.test  # trailing\n', OBSERVABLE.DOMAIN);
    assert.deepEqual(r.indicators.map((i) => i.value), ['evil.test', 'other.test']);
  });

  test('an undeclared type throws rather than coining one', () => {
    assert.throws(() => parsePlainList('x', 'registry-key'), /not a declared observable type/);
  });
});

describe('domainMatches — subdomain coverage with a hard boundary', () => {
  test('the primary domain matches itself and its subdomains', () => {
    assert.equal(domainMatches('evil.test', 'evil.test'), true);
    assert.equal(domainMatches('evil.test', 'bun54l2b67.evil.test'), true);
    assert.equal(domainMatches('evil.test', 'a.b.c.evil.test'), true);
  });

  test('a LOOKALIKE suffix never matches — the boundary is a dot, not a substring', () => {
    assert.equal(domainMatches('evil.test', 'notevil.test'), false);
    assert.equal(domainMatches('evil.test', 'evil.test.attacker.com'), false);
  });

  test('exact-match-only would have found none of Amnesty\'s 1,748 subdomains', () => {
    const observed = ['bun54l2b67.evil.test', 'x9.evil.test', 'q.evil.test'];
    assert.equal(observed.filter((o) => domainMatches('evil.test', o)).length, 3);
    assert.equal(observed.filter((o) => o === 'evil.test').length, 0);
  });
});

describe('matchIndicators', () => {
  const set = parseStixBundle(bundle(
    ind("[domain-name:value = 'evil.test']"),
    ind("[software:name = 'left-pad-evil']"),
  ), { source: 'bundle-a' });

  test('a domain indicator fires on a subdomain observable', () => {
    const r = matchIndicators([set], [{ type: OBSERVABLE.DOMAIN, value: 'cdn.evil.test', where: 'repo/a' }]);
    assert.equal(r.matchCount, 1);
    assert.equal(r.matches[0].indicator.value, 'evil.test');
  });

  test('a domain indicator fires on a URL observable whose HOST it covers', () => {
    const r = matchIndicators([set], [{ type: OBSERVABLE.URL, value: 'https://x.evil.test:30495/szev4hz', where: 'repo/b' }]);
    assert.equal(r.matchCount, 1);
  });

  test('occurrences accumulate and `where` collects, but identity excludes location', () => {
    const r = matchIndicators([set], [
      { type: OBSERVABLE.DOMAIN, value: 'a.evil.test', where: 'repo/a' },
      { type: OBSERVABLE.DOMAIN, value: 'b.evil.test', where: 'repo/b' },
    ]);
    assert.equal(r.matchCount, 1, 'one indicator matched, in two places — not two matches');
    assert.equal(r.matches[0].occurrences, 2);
    assert.deepEqual(r.matches[0].where, ['repo/a', 'repo/b']);
  });

  test('a package indicator does not fire on a same-named domain — types are not interchangeable', () => {
    const r = matchIndicators([set], [{ type: OBSERVABLE.DOMAIN, value: 'left-pad-evil', where: 'x' }]);
    assert.equal(r.matchCount, 0);
  });

  test('no match over a clean corpus, and the run is COMPLETE', () => {
    const r = matchIndicators([set], [{ type: OBSERVABLE.DOMAIN, value: 'good.test', where: 'x' }]);
    assert.equal(r.matchCount, 0);
    assert.equal(r.complete, true);
    assert.equal(r.appliedFraction, 1);
  });
});

describe('a zero that is not a zero', () => {
  const partial = parseStixBundle(bundle(
    ind("[domain-name:value = 'evil.test']"),
    ind("[url:value MATCHES '.*evil.*']"),
    ind("[url:value LIKE '%evil%']"),
    ind("[windows-registry-key:key = 'x']"),
  ), { source: 'partial-bundle' });

  test('appliedFraction rides with every count', () => {
    const r = matchIndicators([partial], [{ type: OBSERVABLE.DOMAIN, value: 'good.test' }]);
    assert.equal(r.matchCount, 0);
    assert.equal(r.indicatorsApplied, 1);
    assert.equal(r.indicatorsRejected, 3);
    assert.equal(r.appliedFraction, 0.25);
    assert.equal(r.complete, false, 'a bundle three-quarters unread has not found nothing');
  });

  test('the coverage sentence refuses to let the zero stand alone', () => {
    const r = matchIndicators([partial], []);
    const s = coverageSentence(r);
    assert.match(s, /1 of 4/);
    assert.match(s, /floor, not a clean result/);
  });

  test('an UNREADABLE set is counted separately from a rejected indicator', () => {
    const broken = parseStixBundle({ nope: 1 }, { source: 'broken' });
    const r = matchIndicators([broken], [{ type: OBSERVABLE.DOMAIN, value: 'x.test' }]);
    assert.equal(r.indicatorSetsUnreadable, 1);
    assert.equal(r.complete, false);
    assert.match(coverageSentence(r), /1 whole set\(s\) were unreadable/);
  });

  test('a fully applied bundle says so plainly', () => {
    const clean = parseStixBundle(bundle(ind("[domain-name:value = 'evil.test']")));
    assert.match(coverageSentence(matchIndicators([clean], [])), /all 1 indicator\(s\) were applied/);
  });
});

describe('caps are counted', () => {
  test('the match list is capped and the remainder stated', () => {
    const many = { source: 'many', rejected: [], indicators: Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: null, type: OBSERVABLE.PACKAGE, value: `pkg-${i}`, source: 'many' })) };
    const obs = Array.from({ length: 30 }, (_, i) => ({ type: OBSERVABLE.PACKAGE, value: `pkg-${i}`, where: 'x' }));
    const r = matchIndicators([many], obs, { cap: 10 });
    assert.equal(r.matchCount, 30);
    assert.equal(r.matches.length, 10);
    assert.equal(r.truncated, 20);
  });
});

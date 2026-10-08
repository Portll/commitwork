// A blind repo is never ranked or coloured as a safe one: noscan means UNKNOWN, which outranks
// clean and still loses to real findings — both directions are asserted, because a one-way test
// passes for the inverted defect too. The maps are LIFTED FROM SOURCE, not restated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CW_SRC = readFileSync(join(REPO, 'bin', 'commitwork.mjs'), 'utf8');
const ROLLUP_SRC = readFileSync(join(REPO, 'monitor', 'rollup.mjs'), 'utf8');

const liftObject = (src, decl, label) => {
  const i = src.indexOf(decl);
  assert.ok(i > -1, `${label}: could not find \`${decl}\` in source`);
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  assert.ok(open > -1 && close > open, `${label}: could not delimit the object literal`);
  return JSON.parse(src.slice(open, close + 1).replace(/([a-zA-Z_]\w*)\s*:/g, '"$1":'));
};

const SEV_RANK = liftObject(CW_SRC, 'const SEV_RANK =', 'bin/commitwork.mjs SEV_RANK');
// the dashboard declares several consts on one line; RANK is the last of them
const RANK = liftObject(ROLLUP_SRC, 'RANK=', 'monitor/rollup.mjs dashboard RANK');

// writeIndex's ordering key, mirrored: worst severity, then void count, then slug.
const worstOf = (cells) => Math.max(...Object.values(cells).map((c) => SEV_RANK[c.sev] || 0));
const voidsOf = (cells) => Object.values(cells).filter((c) => c.sev === 'noscan').length;
const rankRepos = (repos) => [...repos].sort((a, b) =>
  worstOf(b.cells) - worstOf(a.cells) || voidsOf(b.cells) - voidsOf(a.cells) || a.slug.localeCompare(b.slug));

const cells = (...sevs) => Object.fromEntries(sevs.map((s, i) => [`check${i}`, { sev: s }]));

describe('bin/commitwork.mjs — writeIndex ranks a blind repo above a clean one', () => {
  test('unknown outranks clean: noscan sits above ok', () => {
    assert.ok(SEV_RANK.noscan > SEV_RANK.ok,
      `noscan (${SEV_RANK.noscan}) must outrank ok (${SEV_RANK.ok}) — a check that produced nothing trustworthy is worse news than one that came back clean`);
  });

  test('AND unknown still loses to a real finding — the direction a one-way test would miss', () => {
    assert.ok(SEV_RANK.noscan < SEV_RANK.med,
      `noscan (${SEV_RANK.noscan}) must rank below med (${SEV_RANK.med}) — pushing voids above real findings buries them, which is worse than the bug being fixed`);
    assert.ok(SEV_RANK.noscan < SEV_RANK.high, 'noscan must rank below high');
  });

  test('a fully-blind repo sorts ABOVE a genuinely clean one', () => {
    const order = rankRepos([
      { slug: 'clean-repo', cells: cells('ok', 'ok', 'ok') },
      { slug: 'blind-repo', cells: cells('noscan', 'noscan', 'noscan') },
    ]).map((r) => r.slug);
    assert.deepEqual(order, ['blind-repo', 'clean-repo'],
      'the table is headed "worst first" and an unscanned repo is not the safest thing in it');
  });

  test('a repo with real findings still sorts above a fully-blind one', () => {
    const order = rankRepos([
      { slug: 'blind-repo', cells: cells('noscan', 'noscan') },
      { slug: 'findings-repo', cells: cells('med', 'ok') },
      { slug: 'high-repo', cells: cells('high', 'noscan') },
    ]).map((r) => r.slug);
    assert.deepEqual(order, ['high-repo', 'findings-repo', 'blind-repo'],
      'severity decides before blindness does — voids must never displace real findings');
  });

  test('at equal severity, the repo carrying voids is surfaced first', () => {
    const order = rankRepos([
      { slug: 'aaa-all-clean', cells: cells('ok', 'ok') },
      { slug: 'zzz-partly-blind', cells: cells('ok', 'noscan') },
    ]).map((r) => r.slug);
    assert.equal(order[0], 'zzz-partly-blind',
      'the void tiebreak must beat the alphabetical one, or a partly-blind repo hides behind a clean neighbour');
  });

  test('skip still ranks below everything — n/a is not a void', () => {
    assert.ok(SEV_RANK.skip < SEV_RANK.ok,
      'a check that legitimately does not apply here is not evidence of anything and must not be promoted');
    assert.ok(SEV_RANK.skip < SEV_RANK.noscan, 'skip (nothing to scan) ranks below noscan (scanned, no output)');
  });

  test('the label thresholds that read this map are unaffected by the reorder', () => {
    // cmdScan renders `worst >= 3 ? HIGH : worst === 2 ? findings : nVoid ? voids : clean`.
    // 1.5 must satisfy neither numeric branch, so a blind repo still reaches the `voids` label.
    const blind = worstOf(cells('noscan', 'noscan'));
    assert.ok(!(blind >= 3) && blind !== 2,
      `a blind repo's worst (${blind}) must not trip the HIGH or findings thresholds`);
    assert.equal(worstOf(cells('high', 'ok')), 3, 'a high repo still trips the HIGH threshold');
    assert.equal(worstOf(cells('med', 'ok')), 2, 'a med repo still trips the findings threshold');
  });
});

describe('monitor/rollup.mjs — the dashboard row is neither green nor level with clean', () => {
  test('noscan is ranked, and ranked between clean and a real finding', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(RANK, 'noscan'),
      'the dashboard RANK map must carry noscan — absent, sevOfRepo collapses it to ok');
    assert.ok(RANK.noscan > RANK.ok, `noscan (${RANK.noscan}) must outrank ok (${RANK.ok})`);
    assert.ok(RANK.noscan > RANK.low, `noscan (${RANK.noscan}) must outrank low (${RANK.low}) — an unknown lane is worse than a known-minor finding`);
    assert.ok(RANK.noscan < RANK.med, `noscan (${RANK.noscan}) must rank below med (${RANK.med})`);
    assert.ok(RANK.noscan < RANK.high && RANK.noscan < RANK.crit, 'noscan must rank below high and crit');
  });

  test("sevOfRepo carries 'noscan' through instead of collapsing it to 'ok'", () => {
    const fn = ROLLUP_SRC.split('\n').find((l) => l.startsWith('function sevOfRepo('));
    assert.ok(fn, 'sevOfRepo not found in monitor/rollup.mjs');
    assert.match(fn, /==='noscan'\?'noscan'/,
      "sevOfRepo's ternary chain must map noscan to itself; ending the chain at :'ok' is the defect");
  });

  test('the row class it emits has its own border colour, and it is not the clean green', () => {
    // sevOfRepo's return value becomes `<tr class="...">`, so an unstyled class silently inherits
    // the transparent default — better than green, but still not a stated colour.
    const css = ROLLUP_SRC.split('\n').find((l) => l.includes('tr.ok{border-left-color'));
    assert.ok(css, 'the row-border CSS block was not found');
    assert.match(css, /tr\.noscan\{border-left-color:var\(--[a-z-]+\)\}/,
      'tr.noscan needs its own border colour');
    const noscanVar = /tr\.noscan\{border-left-color:var\((--[a-z-]+)\)\}/.exec(css)[1];
    const okVar = /tr\.ok\{border-left-color:var\((--[a-z-]+)\)\}/.exec(css)[1];
    assert.notEqual(noscanVar, okVar,
      `a blind repo must not paint the same colour as a clean one (both were ${okVar})`);
  });
});

// content.evidence: every claim-bearing number on a tracked docsite page is linked to the
// measurement that produced it. The link is BOTH directions and they are asserted separately,
// because only one of them lies to you: a registry alone reads clean forever while the page drifts
// around it, so the second test walks the page's own prose and fails on a numeral nothing computes.
//
// Both directions carry a positive control. A guard nobody has watched fail is a streak, not a
// property: the planted-numeral and planted-drift fixtures below make "this test can fail" a fact.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { figures, unregistered, lexicon, prose, readSource, figuresRoot, GUIDE, NOT_A_FIGURE, PAGES } from '../lib/docsite-figures.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCES = ['monitor/failure-taxonomy.json', 'monitor/data/cwe-graph.json', 'monitor/data/capec-graph.json'];

/** A throwaway root holding only the files the registry reads, so a fixture can corrupt one. */
function fixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-dfig-'));
  for (const rel of [...SOURCES, GUIDE]) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(dir, rel));
  }
  return dir;
}

describe('content.evidence — the figures reproduce', () => {
  test('every registered figure is computed from a tracked source, with nothing undetermined', () => {
    const r = figures({ root: REPO });
    assert.deepEqual(r.undetermined, [], 'a source the registry could not read is not a pass');
    assert.ok(r.figures.length >= 20, `only ${r.figures.length} figures registered`);
    for (const f of r.figures) {
      assert.ok(f.source && f.how, `${f.id} has no source or no expression`);
      assert.notEqual(f.measured, null, `${f.id} measured nothing`);
    }
  });

  test('every measured figure is stated on the page', () => {
    const { figures: fs } = figures({ root: REPO });
    const body = prose(readFileSync(join(REPO, GUIDE), 'utf8'));
    const stated = new Set((body.match(/(?<![\w.#-])\d+(?:[.,]\d+)*(?![\w-])/g) || []));
    for (const f of fs) {
      for (const part of String(f.measured).split('/')) {
        assert.ok(stated.has(part), `${f.id} measures ${f.measured} (${f.how}) but the page states no ${part}`);
      }
    }
  });

  test('the guide-word lexicon counts come from the table, not from the heading', () => {
    const lex = lexicon({ root: REPO });
    assert.ok(!lex.error, lex.error);
    assert.deepEqual(lex.counts, { core: 10, extension: 2, proposed: 2 });
  });
});

describe('content.evidence — nothing on the page is unsourced', () => {
  test('no claim-bearing numeral in the page is outside the registry', () => {
    const r = unregistered({ root: REPO });
    assert.ok(!r.error, r.error);
    assert.deepEqual(r.unregistered.map((u) => `${u.value} :: ${u.context}`), [],
      'a numeral on the page that no computation produces — register it, date it, or remove it');
    assert.ok(r.covered.length >= 30, `only ${r.covered.length} numerals seen; the prose stripper may be eating the page`);
  });

  test('every exemption names a reason, and none of them matches a plain measurement', () => {
    for (const x of NOT_A_FIGURE) {
      assert.ok(x.why && x.why.length > 20, `exemption ${x.re} has no stated reason`);
      // An exemption that swallows ordinary counts would make any page read as fully sourced.
      for (const n of ['6', '26', '27', '449', '558', '969', '4.1', '65.3']) {
        assert.ok(!x.re.test(n), `exemption ${x.re} (${x.why}) also exempts the measurement ${n}`);
      }
    }
  });

  test('no exemption is dead — one that fires on nothing reads as coverage', () => {
    const fired = new Set(unregistered({ root: REPO }).covered.filter((c) => c.exempt).map((c) => c.exempt));
    const dead = NOT_A_FIGURE.filter((x) => !fired.has(x.why)).map((x) => String(x.re));
    assert.deepEqual(dead, [], 'this exemption matches nothing on the page — remove it, or it will cover a figure that lands on that shape later');
  });

  test('POSITIVE CONTROL: a numeral planted in the page is reported', () => {
    const dir = fixtureRoot();
    const page = join(dir, GUIDE);
    writeFileSync(page, readFileSync(page, 'utf8') + '\n\nThe fleet runs 4812 checks a night.\n');
    const r = unregistered({ root: dir });
    assert.deepEqual(r.unregistered.map((u) => u.value), ['4812'], 'the planted unsourced figure was not reported');
  });

  test('POSITIVE CONTROL: a figure that stops reproducing is reported', () => {
    const dir = fixtureRoot();
    const rel = 'monitor/data/capec-graph.json';
    const g = JSON.parse(readFileSync(join(dir, rel), 'utf8'));
    delete g.patterns[Object.keys(g.patterns)[0]];
    g.count = Object.keys(g.patterns).length;
    writeFileSync(join(dir, rel), JSON.stringify(g));
    const live = figures({ root: dir }).figures.find((f) => f.id === 'capec.live');
    assert.equal(live.measured, 557, 'the fixture did not take');
    const body = prose(readFileSync(join(dir, GUIDE), 'utf8'));
    assert.ok(!new RegExp(`(?<![\\w.#-])557(?![\\w-])`).test(body),
      'the page would still have to state 557 for the drift to be invisible');
  });
});

describe('content.evidence — fail closed', () => {
  test('an unreadable source is undetermined, never a reproduced figure', () => {
    const dir = fixtureRoot();
    writeFileSync(join(dir, 'monitor/data/cwe-graph.json'), '{ not json');
    const r = figures({ root: dir });
    const ids = r.undetermined.map((u) => u.id);
    assert.ok(ids.includes('cwe.count'), `expected cwe.count undetermined, got ${JSON.stringify(ids)}`);
    assert.equal(r.figures.find((f) => f.id === 'cwe.count'), undefined, 'a corrupt source produced a figure');
    assert.equal(r.figures.find((f) => f.id === 'cwe.noCapec'), undefined, 'a figure derived from a corrupt source was still reported');
    // The readable sources still measure: one bad input does not empty the registry.
    assert.ok(r.figures.find((f) => f.id === 'capec.live'), 'a single bad source emptied the whole result');
  });

  test('ENOENT is absent; a parse failure is an error — and the two are distinguishable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-dfig-empty-'));
    const gone = readSource(dir, 'monitor/data/cwe-graph.json');
    assert.equal(gone.ok, false);
    assert.equal(gone.absent, true);
    mkdirSync(join(dir, 'monitor/data'), { recursive: true });
    writeFileSync(join(dir, 'monitor/data/cwe-graph.json'), 'nope');
    const bad = readSource(dir, 'monitor/data/cwe-graph.json');
    assert.equal(bad.ok, false);
    assert.equal(bad.absent, false, 'a parse failure read as "legitimately absent"');
  });

  test('a page the registry cannot read is an error, not zero unsourced numerals', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-dfig-nopage-'));
    for (const rel of SOURCES) { mkdirSync(join(dir, dirname(rel)), { recursive: true }); cpSync(join(REPO, rel), join(dir, rel)); }
    const r = unregistered({ root: dir });
    assert.ok(r.error, 'a missing page came back as a clean page');
    assert.deepEqual(r.unregistered, []);
  });
});

describe('content.evidence — the scope is the whole of docsite/, not one page', () => {
  // HEAD, not the working tree: the tree is always mid-edit here, and a page another session has
  // written but not committed is not yet something a reader can be served.
  const tracked = execFileSync('git', ['-C', REPO, 'ls-files', '-z', 'docsite'], { encoding: 'utf8' })
    .split('\0').filter(Boolean).filter((p) => !p.startsWith('docsite/pages/'));

  test('every tracked docsite source carries a declared disposition', () => {
    const declared = new Set(PAGES.map((p) => p.path));
    const missing = tracked.filter((p) => !declared.has(p));
    assert.deepEqual(missing, [], 'a tracked docsite source with no row in PAGES — nobody has inventoried its numbers');
    const stale = PAGES.map((p) => p.path).filter((p) => !tracked.includes(p));
    assert.deepEqual(stale, [], 'PAGES names a file the repository no longer tracks');
  });

  test('a page declared no-figures states no numeral at all', () => {
    for (const p of PAGES.filter((x) => x.how === 'no-figures')) {
      const body = prose(readFileSync(join(REPO, p.path), 'utf8'));
      const hits = body.match(/(?<![\w.#-])\d+(?:[.,]\d+)*(?![\w-])/g) || [];
      assert.deepEqual(hits, [], `${p.path} is declared no-figures but states ${hits.join(', ')}`);
    }
  });

  test('a page declared generated is produced by a generator that exists', () => {
    for (const p of PAGES.filter((x) => x.how === 'generated')) {
      assert.ok(p.by, `${p.path} is declared generated with no generator`);
      assert.doesNotThrow(() => readFileSync(join(REPO, p.by)), `${p.path} names generator ${p.by}, which is not in the tree`);
    }
  });

  test('a dated snapshot states its date on the page, and every source it cites still exists', () => {
    for (const p of PAGES.filter((x) => x.how === 'dated-snapshot')) {
      const raw = readFileSync(join(REPO, p.path), 'utf8');
      assert.ok(raw.includes(p.asOf), `${p.path} is declared as of ${p.asOf}, which the page does not state`);
      for (const c of p.cites || []) {
        assert.ok(raw.includes(c), `${p.path} is declared to cite ${c} and does not`);
        assert.doesNotThrow(() => readFileSync(join(REPO, c)), `${p.path} cites ${c}, which is not in the tree — a dangling citation reads as sourced`);
      }
    }
  });
});

test('CW_DF_ROOT is read at call time, so a test that sets it is not reading the real tree', () => {
  const before = figuresRoot();
  const dir = mkdtempSync(join(tmpdir(), 'cw-dfig-env-'));
  const prev = process.env.CW_DF_ROOT;
  process.env.CW_DF_ROOT = dir;
  try { assert.equal(figuresRoot(), resolve(dir)); }
  finally { if (prev === undefined) delete process.env.CW_DF_ROOT; else process.env.CW_DF_ROOT = prev; }
  assert.equal(figuresRoot(), before);
});

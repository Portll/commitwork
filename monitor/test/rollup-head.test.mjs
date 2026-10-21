import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, renameSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRollupHead, resetRollupHeadCache, rollupHeadCacheSize, BODY_KEYS } from '../rollup-head.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = () => mkdtempSync(join(tmpdir(), 'cw-rollup-head-'));
const rollup = (sliceId, extra = {}) => ({
  sliceId, generated: '2026-10-08T00:00:00Z', totals: { crit: 1 }, coverage: { resolved: 2, swept: 2 },
  scannerFindings: { semgrep: [{ rule: 'x' }] }, repos: [{ name: 'a' }], allKeys: ['k'], ...extra,
});

describe('readRollupHead', () => {
  beforeEach(() => resetRollupHeadCache());

  test('returns every field except the bodies', () => {
    const p = join(dir(), 'rollup.json');
    writeFileSync(p, JSON.stringify(rollup('sweep-1', { freshness: { generated: 'g' } })));
    const r = readRollupHead(p);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.head).sort(), ['coverage', 'freshness', 'generated', 'sliceId', 'totals']);
    for (const k of BODY_KEYS) assert.equal(k in r.head, false);
  });

  test('an unchanged file is served from memory, the same object', () => {
    const p = join(dir(), 'rollup.json');
    writeFileSync(p, JSON.stringify(rollup('sweep-1')));
    assert.equal(readRollupHead(p).head, readRollupHead(p).head);
  });

  test('a rollup renamed into place is re-read', () => {
    const d = dir();
    const p = join(d, 'rollup.json');
    writeFileSync(p, JSON.stringify(rollup('sweep-1')));
    assert.equal(readRollupHead(p).head.sliceId, 'sweep-1');
    writeFileSync(join(d, 'rollup.json.tmp'), JSON.stringify(rollup('sweep-2')));
    renameSync(join(d, 'rollup.json.tmp'), p);
    assert.equal(readRollupHead(p).head.sliceId, 'sweep-2');
  });

  test('an in-place rewrite of a different size is re-read', () => {
    const p = join(dir(), 'rollup.json');
    writeFileSync(p, JSON.stringify(rollup('sweep-1')));
    readRollupHead(p);
    writeFileSync(p, JSON.stringify(rollup('sweep-10')));
    assert.equal(readRollupHead(p).head.sliceId, 'sweep-10');
  });

  test('failures keep the original error: ENOENT, EISDIR, SyntaxError', () => {
    const d = dir();
    const missing = readRollupHead(join(d, 'nope.json'));
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 'ENOENT');
    mkdirSync(join(d, 'adir'));
    assert.equal(readRollupHead(join(d, 'adir')).error.code, 'EISDIR');
    writeFileSync(join(d, 'bad.json'), '{"sliceId":');
    assert.ok(readRollupHead(join(d, 'bad.json')).error instanceof SyntaxError);
  });

  test('the shared head is frozen: a mutation throws instead of reaching the next caller', () => {
    const p = join(dir(), 'rollup.json');
    writeFileSync(p, JSON.stringify(rollup('sweep-1')));
    const { head } = readRollupHead(p);
    assert.throws(() => { head.sliceId = 'x'; }, TypeError);
    assert.throws(() => { head.totals.crit = 9; }, TypeError);
  });

  test('the memo is bounded', () => {
    const d = dir();
    for (let i = 0; i < 300; i++) {
      const p = join(d, `r${i}.json`);
      writeFileSync(p, JSON.stringify(rollup(`s${i}`)));
      readRollupHead(p);
    }
    assert.ok(rollupHeadCacheSize() <= 256);
  });
});

describe('head readers never ask for a body', () => {
  // These hold a head, not a rollup: a body key read through them is undefined, silently.
  const READERS = [
    ['monitor/liveness.mjs', /\brollup\??\.(\w+)/g],
    ['admin/routes/fleet-overview.mjs', /\b(?:j|read\.rollup)\??\.(\w+)/g],
    ['admin/lib/state-view.mjs', /\broll\??\.(\w+)/g],
    ['admin/routes/issues.mjs', /\brollup\??\.(\w+)/g],
  ];
  for (const [rel, re] of READERS) {
    test(rel, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const fields = new Set([...src.matchAll(re)].map((m) => m[1]));
      assert.ok(fields.size > 0, `no head field reads found in ${rel} — the pattern no longer matches the reader`);
      assert.deepEqual(BODY_KEYS.filter((k) => fields.has(k)), []);
    });
  }
});

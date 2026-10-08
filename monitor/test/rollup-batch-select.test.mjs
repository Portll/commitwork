// WHICH batch an area rolls, when the caller names none.
//
// commitwork-admin has five members and its published rollup covered ONE. Two `--repo`-narrowed
// sweeps landed after the last whole-area batch and `covers[0]` took the newest, so three repos of
// the area whose posture is P0 were absent from its own headline — a false clean produced by batch
// SELECTION, with every scanner behaving correctly.
//
// IMPORTS batch-select.mjs, NOT rollup.mjs. rollup.mjs self-executes: the first version of this
// file reached pickBatch through it and therefore PUBLISHED A REAL SLICE over a real area on every
// run — while reporting 8/8 green. A test whose side effect is the thing it guards against is
// worse than no test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickBatch } from '../batch-select.mjs';

const root = mkdtempSync(join(tmpdir(), 'cw-batchsel-'));
/** A batch dir with a manifest. `only` set = narrowed to one repo, which is what sweep.mjs writes. */
const batch = (name, { only = null, repos = 4, manifest = true } = {}) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (manifest) {
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({
      area: 'a', group: 'all', only,
      scope: { repos: Array.from({ length: only ? 1 : repos }, (_, i) => ({ name: `r${i}` })) },
    }));
  }
  return { dir };
};
// covers arrives NEWEST FIRST from batchesForArea.
const NEWEST_NARROW = [batch('n3', { only: 'r0' }), batch('n2', { only: 'r1' }), batch('n1')];
// onRefuse is injected so a refusal is observable rather than an exit(4) that kills the runner.
const dies = () => { throw new Error('unexpected refusal'); };
const opts = { onRefuse: dies, log: () => {} };

describe('newest — the default, unchanged', () => {
  test('takes the newest batch whatever its scope', () => {
    assert.equal(pickBatch(NEWEST_NARROW, 'newest', opts), NEWEST_NARROW[0].dir);
  });

  test('an area that declares nothing behaves exactly as before', () => {
    assert.equal(pickBatch(NEWEST_NARROW, undefined, opts), NEWEST_NARROW[0].dir);
  });
});

describe('newest-full — skip the narrowed ones', () => {
  test('THE DEFECT: it picks the whole-area batch, not the newest single-repo sweep', () => {
    const got = pickBatch(NEWEST_NARROW, 'newest-full', opts);
    assert.equal(got, NEWEST_NARROW[2].dir, 'a single-repo sweep was published as the area\'s whole state');
    assert.notEqual(got, NEWEST_NARROW[0].dir);
  });

  test('when the newest IS full it takes the newest — no needless reaching back', () => {
    const c = [batch('f2'), batch('f1')];
    assert.equal(pickBatch(c, 'newest-full', opts), c[0].dir);
  });

  test('FAILS CLOSED when nothing swept the whole area', () => {
    // The fallback that would "just work" is the defect: it publishes part of the area as all of it.
    const c = [batch('x2', { only: 'r0' }), batch('x1', { only: 'r1' })];
    let code = null;
    pickBatch(c, 'newest-full', { onRefuse: (n) => { code = n; return null; }, log: () => {} });
    assert.equal(code, 4, 'no full batch must refuse, never fall back to a narrowed one');
  });

  test('an unreadable manifest is not a whole-area sweep', () => {
    // Fail closed: absence of evidence that a batch was full is not evidence that it was.
    const c = [batch('u2', { manifest: false }), batch('u1')];
    assert.equal(pickBatch(c, 'newest-full', opts), c[1].dir);
  });

  test('a manifest with only:null is full — the field is absent OR null on a whole-area sweep', () => {
    const c = [batch('z1', { only: null })];
    assert.equal(pickBatch(c, 'newest-full', opts), c[0].dir);
  });
});

test('non-vacuity: the fixture really does put a narrowed batch first', () => {
  const m = JSON.parse(readFileSync(join(NEWEST_NARROW[0].dir, 'batch-manifest.json'), 'utf8'));
  assert.equal(m.only, 'r0', 'the newest fixture is not narrowed — every test above is trivially true');
  assert.equal(m.scope.repos.length, 1);
});

// node --test monitor/test/ — lookalike.mjs: names built to survive a skim. Direction comes from
// the DECLARED set and is never inferred; two legitimate near-neighbours are not a finding; an
// empty declared set is no-reference, not clean; the finding count never renders without coverage.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOKALIKE, foldConfusables, foldSeparators, foldScope, editDistance,
  maxDistanceFor, classify, sweepLookalikes,
} from '../lookalike.mjs';
import { isUnknown } from '../unknown.mjs';

const S = (...names) => new Set(names);

describe('editDistance — transposition is ONE edit', () => {
  test('a keyboard slip is distance 1, not 2', () => {
    assert.equal(editDistance('reqeusts', 'requests'), 1);
  });
  test('substitution, insertion and deletion each cost 1', () => {
    assert.equal(editDistance('lodash', 'lodasg'), 1);
    assert.equal(editDistance('lodash', 'lodashh'), 1);
    assert.equal(editDistance('lodash', 'lodsh'), 1);
  });
  test('identity is 0 and an empty side is the other\'s length', () => {
    assert.equal(editDistance('a', 'a'), 0);
    assert.equal(editDistance('', 'abc'), 3);
    assert.equal(editDistance('abc', ''), 3);
  });
});

describe('folding', () => {
  test('confusables fold digits, rn/m and Cyrillic lookalikes', () => {
    assert.equal(foldConfusables('c0l0rs'), foldConfusables('colors'));
    assert.equal(foldConfusables('rnoment'), foldConfusables('moment'));
    assert.equal(foldConfusables('re\u0430ct'), foldConfusables('react')); // Cyrillic small a, U+0430
  });
  test('separators fold to nothing', () => {
    assert.equal(foldSeparators('node-fetch'), foldSeparators('node_fetch'));
    assert.equal(foldSeparators('node.fetch'), foldSeparators('nodefetch'));
  });
  test('scope folding reconciles @scope/name with scope-name', () => {
    assert.equal(foldScope('@babel/core'), foldScope('babel-core'));
    assert.equal(foldScope('@babel/core'), foldScope('babel_core'));
  });
  test('folding does NOT collapse genuinely different names', () => {
    assert.notEqual(foldConfusables('express'), foldConfusables('fastify'));
    assert.notEqual(foldScope('@babel/core'), foldScope('@babel/types'));
  });
});

describe('maxDistanceFor scales with length', () => {
  test('short names admit one edit; long names admit two', () => {
    assert.equal(maxDistanceFor('cli'), 1);
    assert.equal(maxDistanceFor('lodash'), 1);
    assert.equal(maxDistanceFor('webpack-dev-server'), 2);
  });
  test('the scope prefix does not inflate the length', () => {
    assert.equal(maxDistanceFor('@a-very-long-scope/cli'), 1);
  });
});

describe('direction comes from the declared set', () => {
  const legit = S('requests', 'lodash', 'node-fetch', '@babel/core');

  test('a near-miss of a DECLARED name is a finding, and names the legitimate side', () => {
    const r = classify('reqeusts', legit);
    assert.equal(r.length, 1);
    assert.equal(r[0].class, LOOKALIKE.TYPO);
    assert.equal(r[0].legitimate, 'requests');
    assert.equal(r[0].candidate, 'reqeusts');
  });

  test('a DECLARED name is never an impostor, however near another declared name', () => {
    const both = S('lodash.get', 'lodash.set');
    assert.deepEqual(classify('lodash.get', both), [], 'two real packages one edit apart are two real packages');
    assert.deepEqual(classify('lodash.set', both), []);
  });

  test('an EMPTY declared set is no-reference — compared against nothing, not found clean', () => {
    const r = classify('anything', S());
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'no-reference');
  });

  test('`legit` must be a Set — passing the observed corpus back is made awkward on purpose', () => {
    assert.throws(() => classify('x', ['requests']), /must be a Set of DECLARED names/);
  });

  test('a name far from everything declared yields nothing, and that is not a verdict about it', () => {
    assert.deepEqual(classify('totally-unrelated-thing', legit), []);
  });
});

describe('the four mechanisms are each reachable and distinguished', () => {
  test('HOMOGLYPH — identical once confusables fold', () => {
    const r = classify('c0lors', S('colors'));
    assert.equal(r[0].class, LOOKALIKE.HOMOGLYPH);
  });
  test('SEPARATOR — identical once -, _ and . fold', () => {
    const r = classify('node_fetch', S('node-fetch'));
    assert.equal(r[0].class, LOOKALIKE.SEPARATOR);
  });
  test('SCOPE — @babel/core against babel-core', () => {
    const r = classify('babel-core', S('@babel/core'));
    assert.equal(r[0].class, LOOKALIKE.SCOPE);
  });
  test('TYPO — within the length-scaled distance', () => {
    const r = classify('expres', S('express'));
    assert.equal(r[0].class, LOOKALIKE.TYPO);
  });
  test('beyond the scaled distance is NOT a lookalike — two edits on a short name is two names', () => {
    assert.deepEqual(classify('expr', S('express')), []);
  });
});

describe('the Pegasus process-table shape', () => {
  const daemons = S('xpcroleaccountd', 'gatekeeperd', 'softwareupdateservicesd');

  test('a daemon-shaped impostor one edit from a real one surfaces', () => {
    // `roleaboutd` is not within two edits of `xpcroleaccountd`, and honestly reporting that is
    // the point: this technique catches near-misses, not every disguised name. A detector that
    // claimed both would be claiming more than edit distance can support.
    const r = classify('gatekeeprd', daemons);
    assert.equal(r.length, 1);
    assert.equal(r[0].legitimate, 'gatekeeperd');
  });

  test('a name merely SHAPED like a daemon is not a finding — the mechanism has a limit', () => {
    assert.deepEqual(classify('roleaboutd', daemons), [],
      'edit distance does not detect plausible-sounding invention, and must not pretend to');
  });
});

describe('sweepLookalikes', () => {
  const legit = S('requests', 'lodash', 'node-fetch');

  test('identity excludes location — the same squat in two lockfiles is one finding that spread', () => {
    const r = sweepLookalikes([
      { name: 'reqeusts', where: 'repo-a/package-lock.json' },
      { name: 'reqeusts', where: 'repo-b/package-lock.json' },
    ], legit);
    assert.equal(r.findingCount, 1);
    assert.equal(r.findings[0].occurrences, 2);
    assert.deepEqual(r.findings[0].where, ['repo-a/package-lock.json', 'repo-b/package-lock.json']);
  });

  test('declared names are counted, never flagged', () => {
    const r = sweepLookalikes([{ name: 'lodash' }, { name: 'requests' }], legit);
    assert.equal(r.findingCount, 0);
    assert.equal(r.declaredLegitimate, 2);
  });

  test('noDeclaredNeighbour counts what the declared set cannot speak about — and CAN be non-zero', () => {
    const r = sweepLookalikes([{ name: 'lodash' }, { name: 'something-else-entirely' }], legit);
    assert.equal(r.noDeclaredNeighbour, 1, 'a field that can never be non-zero is a field wired to nothing');
  });

  test('the finding count arrives inside a coverage claim, never bare', () => {
    const r = sweepLookalikes([{ name: 'reqeusts' }, { name: 'unrelated' }], legit);
    assert.equal(r.coverage.count, r.findingCount);
    assert.equal(r.coverage.population, 2);
    assert.equal(r.coverage.complete, false, 'only 0 of the 2 observed names were themselves declared');
  });

  test('a corpus entirely of declared names is complete coverage', () => {
    const r = sweepLookalikes([{ name: 'lodash' }, { name: 'requests' }], legit);
    assert.equal(r.coverage.complete, true);
    assert.equal(r.coverage.zeroIsPopulationZero, true);
  });

  test('caps are counted', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `lodas${String.fromCharCode(97 + i % 26)}` }));
    const r = sweepLookalikes(many, S('lodash'), { cap: 5 });
    assert.ok(r.findingCount > 5);
    assert.equal(r.findings.length, 5);
    assert.equal(r.truncated, r.findingCount - 5);
  });

  test('deterministic ordering — nearest first, stable tie-break', () => {
    const obs = [{ name: 'expres' }, { name: 'lodas' }, { name: 'requsts' }];
    const set = S('express', 'lodash', 'requests');
    const a = sweepLookalikes(obs, set).findings.map((f) => f.candidate);
    const b = sweepLookalikes(obs.slice().reverse(), set).findings.map((f) => f.candidate);
    assert.deepEqual(a, b);
  });
});

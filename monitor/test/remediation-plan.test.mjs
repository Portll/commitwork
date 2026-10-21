// End-to-end wiring: a slice in, a declare-only plan out. Proves the three modules compose and that
// the two load-bearing behaviours survive composition: no checkout -> undetermined (never a guessed
// PR), and a probe that says 'already fixed upstream' -> skip (the gitleaks lesson, end to end).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFromSlice } from '../remediation-plan.mjs';

const slice = {
  scanned: ['r1', 'r2'],
  scannerFindings: {
    depsGo: [
      { repo: 'r_live', id: 'GO-2026-6061', package: 'google.golang.org/grpc', reachability: 'reachable' },
      { repo: 'r_fixed', id: 'GO-2025-3922', package: 'github.com/ulikunitz/xz', reachability: 'reachable' },
    ],
  },
};

const seams = {
  osvFixed: (id) => ({ 'GO-2026-6061': '1.82.1', 'GO-2025-3922': '0.5.15' })[id] || '',
  slugFor: (repo) => ({ r_live: 'trufflesecurity/trufflehog', r_fixed: 'gitleaks/gitleaks' })[repo] || null,
};

test('no upstream checkout -> every advisory is undetermined, zero proposed (fail closed)', () => {
  const out = planFromSlice(slice, { ...seams, checkoutDirFor: () => null });
  assert.equal(out.plan.counts.proposed, 0);
  assert.equal(out.plan.counts.undetermined, 2);
});

test('with checkouts: live -> propose, already-fixed-upstream -> skip (gitleaks lesson end to end)', () => {
  const out = planFromSlice(slice, {
    ...seams,
    checkoutDirFor: (slug) => `/co/${slug}`,
    // fake probe: grpc still live, xz already fixed on master
    probe: (adv) => adv.id === 'GO-2026-6061' ? { fixed: false, sha: 'live1' } : { fixed: true, sha: 'fix1' },
  });
  assert.equal(out.plan.counts.proposed, 1);
  assert.equal(out.plan.counts.skipped, 1);
  const prop = out.plan.proposed[0];
  assert.equal(prop.id, 'GO-2026-6061');
  assert.equal(prop.probedSha, 'live1');
  assert.equal(out.plan.skipped[0].reason, 'upstream-already-fixed');
});

test('coverage is carried through the pipeline', () => {
  const out = planFromSlice(slice, { ...seams, checkoutDirFor: () => null });
  assert.equal(out.coverage.goRows, 2);
  assert.equal(out.coverage.emitted, 2);
});

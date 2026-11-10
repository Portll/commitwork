// Renders a human-readable summary of introduced advisories (bin/lib/introduced-run.mjs renderIntroduced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIntroduced } from '../lib/introduced-run.mjs';

test('renders ecosystem name when provided', () => {
  const v = {
    scope: { includeDev: true, blocking: ['high', 'critical'] },
    ecosystem: 'npm',
    state: 'clear',
    counts: { blocking: 0, introduced: 0, resolved: 0, persisting: 0, looked: 0 },
    reasons: [],
    introduced: [],
    unmeasured: []
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high, critical\n  verdict: clear \u2014 no advisory introduced at a blocking severity\n  introduced 0 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 0\n");
});

test('renders unknown ecosystem when ecosystem is empty string', () => {
  const v = {
    scope: { includeDev: false, blocking: ['critical'] },
    ecosystem: '',
    state: 'clear',
    counts: { blocking: 0, introduced: 0, resolved: 0, persisting: 0, looked: 0 },
    reasons: [],
    introduced: [],
    unmeasured: []
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 unknown ecosystem \u00b7 devDependencies excluded \u00b7 blocking: critical\n  verdict: clear \u2014 no advisory introduced at a blocking severity\n  introduced 0 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 0\n");
});

test('renders singular advisory count for one blocking advisory', () => {
  const v = {
    scope: { includeDev: true, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'introduces',
    counts: { blocking: 1, introduced: 1, resolved: 0, persisting: 0, looked: 1 },
    reasons: ['reason one'],
    introduced: [{ severity: 'high', advisory: 'GHSA-1', package: 'pkg', versions: ['1.0.0'], exposure: 'direct', blocking: true, paths: [] }],
    unmeasured: []
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high\n  verdict: introduces 1 advisory at a blocking severity\n  reason one\n    high     GHSA-1  pkg@1.0.0 (direct)\n  introduced 1 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 1\n");
});

test('renders plural advisory count for two blocking advisories', () => {
  const v = {
    scope: { includeDev: false, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'introduces',
    counts: { blocking: 2, introduced: 2, resolved: 0, persisting: 0, looked: 2 },
    reasons: [],
    introduced: [
      { severity: 'high', advisory: 'GHSA-1', package: 'a', versions: ['1.0.0'], exposure: 'direct', blocking: true, paths: [] },
      { severity: 'high', advisory: 'GHSA-2', package: 'b', versions: ['2.0.0'], exposure: 'direct', blocking: true, paths: [] }
    ],
    unmeasured: []
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies excluded \u00b7 blocking: high\n  verdict: introduces 2 advisories at a blocking severity\n    high     GHSA-1  a@1.0.0 (direct)\n    high     GHSA-2  b@2.0.0 (direct)\n  introduced 2 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 2\n");
});

test('renders path line when first path exists', () => {
  const v = {
    scope: { includeDev: true, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'introduces',
    counts: { blocking: 1, introduced: 1, resolved: 0, persisting: 0, looked: 1 },
    reasons: [],
    introduced: [{ severity: 'high', advisory: 'GHSA-1', package: 'pkg', versions: ['1.0.0'], exposure: 'direct', blocking: true, paths: [['root', 'pkg']] }],
    unmeasured: []
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high\n  verdict: introduces 1 advisory at a blocking severity\n    high     GHSA-1  pkg@1.0.0 (direct)\n             via root \u203a pkg\n  introduced 1 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 1\n");
});

test('omits path line when paths array is empty', () => {
  const v = {
    scope: { includeDev: true, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'introduces',
    counts: { blocking: 1, introduced: 1, resolved: 0, persisting: 0, looked: 1 },
    reasons: [],
    introduced: [{ severity: 'high', advisory: 'GHSA-1', package: 'pkg', versions: ['1.0.0'], exposure: 'direct', blocking: true, paths: [] }],
    unmeasured: []
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high\n  verdict: introduces 1 advisory at a blocking severity\n    high     GHSA-1  pkg@1.0.0 (direct)\n  introduced 1 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 1\n");
});

test('renders first unmeasured entry with package and version', () => {
  const v = {
    scope: { includeDev: true, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'unmeasured',
    counts: { blocking: 0, introduced: 0, resolved: 0, persisting: 0, looked: 0 },
    reasons: [],
    introduced: [],
    unmeasured: [{ package: 'pkg', version: '1.0.0', side: 'prod', reason: 'no lockfile' }]
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high\n  verdict: not measured \u2014 this is not a pass\n    not measured: pkg@1.0.0 (prod) \u2014 no lockfile\n  introduced 0 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 0\n");
});

test('renders unmeasured entry with location when package is absent', () => {
  const v = {
    scope: { includeDev: true, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'unmeasured',
    counts: { blocking: 0, introduced: 0, resolved: 0, persisting: 0, looked: 0 },
    reasons: [],
    introduced: [],
    unmeasured: [{ location: 'file.mjs', side: 'prod', reason: 'no lockfile' }]
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high\n  verdict: not measured \u2014 this is not a pass\n    not measured: file.mjs (prod) \u2014 no lockfile\n  introduced 0 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 0\n");
});

test('renders more-not-measured line when unmeasured exceeds twenty', () => {
  const unmeasured = Array.from({ length: 21 }, (_, i) => ({ package: `p${i}`, version: '1.0.0', side: 'prod', reason: 'r' }));
  const v = {
    scope: { includeDev: true, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'unmeasured',
    counts: { blocking: 0, introduced: 0, resolved: 0, persisting: 0, looked: 0 },
    reasons: [],
    introduced: [],
    unmeasured
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high\n  verdict: not measured \u2014 this is not a pass\n    not measured: p0@1.0.0 (prod) \u2014 r\n    not measured: p1@1.0.0 (prod) \u2014 r\n    not measured: p2@1.0.0 (prod) \u2014 r\n    not measured: p3@1.0.0 (prod) \u2014 r\n    not measured: p4@1.0.0 (prod) \u2014 r\n    not measured: p5@1.0.0 (prod) \u2014 r\n    not measured: p6@1.0.0 (prod) \u2014 r\n    not measured: p7@1.0.0 (prod) \u2014 r\n    not measured: p8@1.0.0 (prod) \u2014 r\n    not measured: p9@1.0.0 (prod) \u2014 r\n    not measured: p10@1.0.0 (prod) \u2014 r\n    not measured: p11@1.0.0 (prod) \u2014 r\n    not measured: p12@1.0.0 (prod) \u2014 r\n    not measured: p13@1.0.0 (prod) \u2014 r\n    not measured: p14@1.0.0 (prod) \u2014 r\n    not measured: p15@1.0.0 (prod) \u2014 r\n    not measured: p16@1.0.0 (prod) \u2014 r\n    not measured: p17@1.0.0 (prod) \u2014 r\n    not measured: p18@1.0.0 (prod) \u2014 r\n    not measured: p19@1.0.0 (prod) \u2014 r\n    and 1 more not measured\n  introduced 0 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 0\n");
});

test('omits more-not-measured line when unmeasured is exactly twenty', () => {
  const unmeasured = Array.from({ length: 20 }, (_, i) => ({ package: `p${i}`, version: '1.0.0', side: 'prod', reason: 'r' }));
  const v = {
    scope: { includeDev: true, blocking: ['high'] },
    ecosystem: 'npm',
    state: 'unmeasured',
    counts: { blocking: 0, introduced: 0, resolved: 0, persisting: 0, looked: 0 },
    reasons: [],
    introduced: [],
    unmeasured
  };
  assert.equal(renderIntroduced(v), "introduced advisories \u00b7 npm \u00b7 devDependencies included \u00b7 blocking: high\n  verdict: not measured \u2014 this is not a pass\n    not measured: p0@1.0.0 (prod) \u2014 r\n    not measured: p1@1.0.0 (prod) \u2014 r\n    not measured: p2@1.0.0 (prod) \u2014 r\n    not measured: p3@1.0.0 (prod) \u2014 r\n    not measured: p4@1.0.0 (prod) \u2014 r\n    not measured: p5@1.0.0 (prod) \u2014 r\n    not measured: p6@1.0.0 (prod) \u2014 r\n    not measured: p7@1.0.0 (prod) \u2014 r\n    not measured: p8@1.0.0 (prod) \u2014 r\n    not measured: p9@1.0.0 (prod) \u2014 r\n    not measured: p10@1.0.0 (prod) \u2014 r\n    not measured: p11@1.0.0 (prod) \u2014 r\n    not measured: p12@1.0.0 (prod) \u2014 r\n    not measured: p13@1.0.0 (prod) \u2014 r\n    not measured: p14@1.0.0 (prod) \u2014 r\n    not measured: p15@1.0.0 (prod) \u2014 r\n    not measured: p16@1.0.0 (prod) \u2014 r\n    not measured: p17@1.0.0 (prod) \u2014 r\n    not measured: p18@1.0.0 (prod) \u2014 r\n    not measured: p19@1.0.0 (prod) \u2014 r\n  introduced 0 \u00b7 resolved 0 \u00b7 persisting 0 \u00b7 looked up 0\n");
});

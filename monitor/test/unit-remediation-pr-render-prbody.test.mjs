// Renders the PR body markdown for a vulnerability advisory (monitor/remediation-pr.mjs renderPRBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPRBody } from '../remediation-pr.mjs';

test('renders description with bump module and from version', () => {
  const adv = { id: 'GO-2024-0001', package: 'github.com/foo/bar', currentVersion: '1.0.0', bump: { module: 'github.com/foo/bar', from: '1.0.0', to: '1.1.0' }, fixed: '1.1.0' };
  const r = renderPRBody(adv);
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0001](https://pkg.go.dev/vuln/GO-2024-0001) reachable through `github.com/foo/bar@1.0.0`.\n\nThe module is pulled transitively via `github.com/foo/bar`. Bumping `github.com/foo/bar` 1.0.0 \u2192 1.1.0 pulls the patched `github.com/foo/bar` (1.1.0), which removes the advisory from the graph.\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n_Prepared by commitwork remediation-pr (declare-only; a human submits)._");
});

test('renders description with bump module and no from version', () => {
  const adv = { id: 'GO-2024-0002', package: 'github.com/baz/qux', currentVersion: '2.0.0', bump: { module: 'github.com/baz/qux', to: '2.1.0' }, fixed: '2.1.0' };
  const r = renderPRBody(adv);
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0002](https://pkg.go.dev/vuln/GO-2024-0002) reachable through `github.com/baz/qux@2.0.0`.\n\nThe module is pulled transitively via `github.com/baz/qux`. Bumping `github.com/baz/qux` 2.1.0 pulls the patched `github.com/baz/qux` (2.1.0), which removes the advisory from the graph.\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n_Prepared by commitwork remediation-pr (declare-only; a human submits)._");
});

test('renders description without bump module', () => {
  const adv = { id: 'GO-2024-0003', package: 'github.com/dep/thing', currentVersion: '0.5.0', fixed: '0.6.0' };
  const r = renderPRBody(adv);
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0003](https://pkg.go.dev/vuln/GO-2024-0003) reachable through `github.com/dep/thing@0.5.0`.\n\nBump `github.com/dep/thing` to `0.6.0` (the patched floor).\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n_Prepared by commitwork remediation-pr (declare-only; a human submits)._");
});

test('renders with spec and CW_NOW set', () => {
  process.env.CW_NOW = '2024-01-15T10:00:00Z';
  const adv = { id: 'GO-2024-0004', package: 'github.com/x/y', currentVersion: '1.0.0', fixed: '1.0.1' };
  const r = renderPRBody(adv, { spec: 'github.com/x/y@v1.0.1' });
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0004](https://pkg.go.dev/vuln/GO-2024-0004) reachable through `github.com/x/y@1.0.0`.\n\nBump `github.com/x/y` to `1.0.1` (the patched floor).\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n```\ngo get github.com/x/y@v1.0.1\ngo mod tidy\n```\n\n_Prepared 2024-01-15T10:00:00Z by commitwork remediation-pr (declare-only; a human submits)._");
});

test('renders without spec and without CW_NOW', () => {
  delete process.env.CW_NOW;
  const adv = { id: 'GO-2024-0005', package: 'github.com/a/b', currentVersion: '3.0.0', fixed: '3.1.0' };
  const r = renderPRBody(adv);
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0005](https://pkg.go.dev/vuln/GO-2024-0005) reachable through `github.com/a/b@3.0.0`.\n\nBump `github.com/a/b` to `3.1.0` (the patched floor).\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n_Prepared by commitwork remediation-pr (declare-only; a human submits)._");
});

test('renders with spec but no CW_NOW', () => {
  delete process.env.CW_NOW;
  const adv = { id: 'GO-2024-0006', package: 'github.com/c/d', currentVersion: '2.0.0', fixed: '2.0.1' };
  const r = renderPRBody(adv, { spec: 'github.com/c/d@v2.0.1' });
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0006](https://pkg.go.dev/vuln/GO-2024-0006) reachable through `github.com/c/d@2.0.0`.\n\nBump `github.com/c/d` to `2.0.1` (the patched floor).\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n```\ngo get github.com/c/d@v2.0.1\ngo mod tidy\n```\n\n_Prepared by commitwork remediation-pr (declare-only; a human submits)._");
});

test('renders with currentVersion undefined', () => {
  const adv = { id: 'GO-2024-0007', package: 'github.com/e/f', fixed: '1.0.0' };
  const r = renderPRBody(adv);
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0007](https://pkg.go.dev/vuln/GO-2024-0007) reachable through `github.com/e/f@?`.\n\nBump `github.com/e/f` to `1.0.0` (the patched floor).\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n_Prepared by commitwork remediation-pr (declare-only; a human submits)._");
});

test('renders with bump module and spec and CW_NOW', () => {
  process.env.CW_NOW = '2024-06-01T00:00:00Z';
  const adv = { id: 'GO-2024-0008', package: 'github.com/g/h', currentVersion: '4.0.0', bump: { module: 'github.com/g/h', from: '4.0.0', to: '4.1.0' }, fixed: '4.1.0' };
  const r = renderPRBody(adv, { spec: 'github.com/g/h@v4.1.0' });
  assert.equal(r, "### Description\n\n`govulncheck` (symbol level) reports [GO-2024-0008](https://pkg.go.dev/vuln/GO-2024-0008) reachable through `github.com/g/h@4.0.0`.\n\nThe module is pulled transitively via `github.com/g/h`. Bumping `github.com/g/h` 4.0.0 \u2192 4.1.0 pulls the patched `github.com/g/h` (4.1.0), which removes the advisory from the graph.\n\n### Verification\n\n- [ ] `go build ./...` passes\n- [ ] `govulncheck ./...` no longer reports this advisory\n\n```\ngo get github.com/g/h@v4.1.0\ngo mod tidy\n```\n\n_Prepared 2024-06-01T00:00:00Z by commitwork remediation-pr (declare-only; a human submits)._");
});

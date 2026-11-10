// Renders a draft PR body for a vulnerability remediation (monitor/draft-pr-body.mjs renderDraftPrBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDraftPrBody } from '../draft-pr-body.mjs';

test('summary uses bump module when present and package differs', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GO-2024-0001', package: 'example.com/lib', bump: { module: 'example.com/lib/v2', to: 'v2.1.0' } },
    probe: { base: 'main', sha: 'abc123', trace: [], reason: 'reachable' },
    versions: [], steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib/v2` to `v2.1.0` to clear [GO-2024-0001](https://pkg.go.dev/vuln/GO-2024-0001), which reaches this repository through `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `abc123`.\n\n### Head probe\n\nBefore this change, `main` at `abc123` still reported GO-2024-0001 (reachable).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('summary uses package when no bump module and target equals package', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GHSA-1234-5678-9012', package: 'example.com/lib', fixed: 'v1.2.3' },
    probe: { base: 'main', sha: 'def456', trace: [], reason: 'reachable' },
    versions: [], steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.2.3` to clear [GHSA-1234-5678-9012](https://github.com/advisories/GHSA-1234-5678-9012) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `def456`.\n\n### Head probe\n\nBefore this change, `main` at `def456` still reported GHSA-1234-5678-9012 (reachable).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('summary uses bump to when present instead of fixed', () => {
  const r = renderDraftPrBody({
    adv: { id: 'CVE-2024-0001', package: 'example.com/lib', fixed: 'v1.0.0', bump: { to: 'v1.1.0' } },
    probe: { base: 'main', sha: 'abc', trace: [], reason: 'ok' },
    versions: [], steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.1.0` to clear [CVE-2024-0001](https://osv.dev/vulnerability/CVE-2024-0001) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `abc`.\n\n### Head probe\n\nBefore this change, `main` at `abc` still reported CVE-2024-0001 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('summary uses fixed when no bump to', () => {
  const r = renderDraftPrBody({
    adv: { id: 'CVE-2024-0002', package: 'example.com/lib', fixed: 'v2.0.0' },
    probe: { base: 'main', sha: 'abc', trace: [], reason: 'ok' },
    versions: [], steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v2.0.0` to clear [CVE-2024-0002](https://osv.dev/vulnerability/CVE-2024-0002) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `abc`.\n\n### Head probe\n\nBefore this change, `main` at `abc` still reported CVE-2024-0002 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('reachability section includes trace entries when present', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GO-2024-0002', package: 'example.com/lib', bump: { module: 'example.com/lib', to: 'v1.0.0' } },
    probe: { base: 'main', sha: 'abc', trace: ['main.go:10', 'lib.go:20'], reason: 'ok' },
    versions: [], steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.0.0` to clear [GO-2024-0002](https://pkg.go.dev/vuln/GO-2024-0002) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `abc`.\n\nCall path, entry first:\n\n- `main.go:10`\n- `lib.go:20`\n\n### Head probe\n\nBefore this change, `main` at `abc` still reported GO-2024-0002 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('versions table shows not in the build for empty before', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GO-2024-0003', package: 'example.com/lib', bump: { module: 'example.com/lib', to: 'v1.0.0' } },
    probe: { base: 'main', sha: 'abc', trace: [], reason: 'ok' },
    versions: [{ module: 'example.com/lib', before: '', after: 'v1.0.0' }],
    steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.0.0` to clear [GO-2024-0003](https://pkg.go.dev/vuln/GO-2024-0003) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `abc`.\n\n### Versions\n\n| Module | Before | After |\n| --- | --- | --- |\n| `example.com/lib` | not in the build | v1.0.0 |\n\n### Head probe\n\nBefore this change, `main` at `abc` still reported GO-2024-0003 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('versions table shows not in the build for empty after', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GO-2024-0004', package: 'example.com/lib', bump: { module: 'example.com/lib', to: 'v1.0.0' } },
    probe: { base: 'main', sha: 'abc', trace: [], reason: 'ok' },
    versions: [{ module: 'example.com/lib', before: 'v0.9.0', after: '' }],
    steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.0.0` to clear [GO-2024-0004](https://pkg.go.dev/vuln/GO-2024-0004) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `abc`.\n\n### Versions\n\n| Module | Before | After |\n| --- | --- | --- |\n| `example.com/lib` | v0.9.0 | not in the build |\n\n### Head probe\n\nBefore this change, `main` at `abc` still reported GO-2024-0004 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('head probe uses unknown when sha is missing', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GO-2024-0005', package: 'example.com/lib', bump: { module: 'example.com/lib', to: 'v1.0.0' } },
    probe: { base: 'main', trace: [], reason: 'ok' },
    versions: [], steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.0.0` to clear [GO-2024-0005](https://pkg.go.dev/vuln/GO-2024-0005) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `unknown`.\n\n### Head probe\n\nBefore this change, `main` at `unknown` still reported GO-2024-0005 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('head probe uses provided sha when present', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GO-2024-0006', package: 'example.com/lib', bump: { module: 'example.com/lib', to: 'v1.0.0' } },
    probe: { base: 'main', sha: 'deadbeef', trace: [], reason: 'ok' },
    versions: [], steps: [], asks: [], dcoWhy: null, now: null
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.0.0` to clear [GO-2024-0006](https://pkg.go.dev/vuln/GO-2024-0006) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `deadbeef`.\n\n### Head probe\n\nBefore this change, `main` at `deadbeef` still reported GO-2024-0006 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\n---\n\nPrepared by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

test('dcoWhy and asks sections appear when provided', () => {
  const r = renderDraftPrBody({
    adv: { id: 'GO-2024-0007', package: 'example.com/lib', bump: { module: 'example.com/lib', to: 'v1.0.0' } },
    probe: { base: 'main', sha: 'abc', trace: [], reason: 'ok' },
    versions: [], steps: [], asks: ['review needed'], dcoWhy: 'policy', now: '2024-01-01'
  });
  assert.equal(r, "### Summary\n\nThis pull request moves `example.com/lib` to `v1.0.0` to clear [GO-2024-0007](https://pkg.go.dev/vuln/GO-2024-0007) in `example.com/lib`.\n\n### Reachability\n\n`govulncheck` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on `main` at `abc`.\n\n### Head probe\n\nBefore this change, `main` at `abc` still reported GO-2024-0007 (ok).\n\n### Verification\n\nRun in a fresh clone of `main` with this change applied:\n\n| Command | Exit | Result |\n| --- | --- | --- |\n\nThe commit carries a `Signed-off-by` line for its author, as `policy` asks.\n\n### Before this leaves draft\n\n- [ ] review needed\n\n---\n\nPrepared 2024-01-01 by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.\n");
});

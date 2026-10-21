// monitor/test/remediation-pr-units.test.mjs — case tests for bumpSpec, renderCommands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bumpSpec, renderCommands } from '../remediation-pr.mjs';

test('bumpSpec returns module@to when bump is provided', () => {
  const adv = {
    id: 'GO-2025-3922',
    package: 'ulikunitz/xz',
    ecosystem: 'go',
    currentVersion: 'v0.5.14',
    fixed: 'v0.5.15',
    reachable: true,
    bump: { module: 'mholt/archives', from: 'v0.1.4', to: 'v0.1.5' },
    upstream: { repo: 'gitleaks/gitleaks', defaultBranch: 'master' }
  };
  assert.equal(bumpSpec(adv), 'mholt/archives@v0.1.5');
});

test('bumpSpec returns package@fixed when no bump is provided', () => {
  const adv = {
    id: 'CVE-2024-1234',
    package: 'example.com/pkg',
    ecosystem: 'go',
    currentVersion: 'v1.0.0',
    fixed: 'v1.1.0',
    reachable: true,
    upstream: { repo: 'example/repo', defaultBranch: 'main' }
  };
  assert.equal(bumpSpec(adv), 'example.com/pkg@v1.1.0');
});

test('bumpSpec returns empty string when no bump and no fixed', () => {
  const adv = {
    id: 'GO-2025-0001',
    package: 'example.com/pkg',
    ecosystem: 'go',
    currentVersion: 'v1.0.0',
    reachable: true,
    upstream: { repo: 'example/repo', defaultBranch: 'main' }
  };
  assert.equal(bumpSpec(adv), '');
});

test('bumpSpec returns empty string when adv is null', () => {
  assert.equal(bumpSpec(null), '');
});

test('bumpSpec returns empty string when adv is undefined', () => {
  assert.equal(bumpSpec(undefined), '');
});

test('bumpSpec prefers bump over package/fixed even if both exist', () => {
  const adv = {
    id: 'GHSA-abc123',
    package: 'github.com/foo/bar',
    ecosystem: 'go',
    currentVersion: 'v2.0.0',
    fixed: 'v2.1.0',
    reachable: true,
    bump: { module: 'github.com/baz/qux', from: 'v1.0.0', to: 'v1.2.0' },
    upstream: { repo: 'foo/bar', defaultBranch: 'main' }
  };
  assert.equal(bumpSpec(adv), 'github.com/baz/qux@v1.2.0');
});

test('renders 8 commands for a valid advisory with bump', () => {
  const adv = {
    id: 'GO-2025-3922',
    package: 'ulikunitz/xz',
    ecosystem: 'go',
    currentVersion: 'v0.5.14',
    fixed: 'v0.5.15',
    reachable: true,
    bump: { module: 'mholt/archives', from: 'v0.1.4', to: 'v0.1.5' },
    upstream: { repo: 'gitleaks/gitleaks', defaultBranch: 'master' }
  };
  const cmds = renderCommands(adv, { branch: 'deps/go-2025-3922', spec: 'mholt/archives@v0.1.5' });
  assert.equal(cmds.length, 8);
  assert.equal(cmds[0], 'gh repo fork gitleaks/gitleaks --clone=false');
  assert.equal(cmds[1], 'git clone --filter=blob:none https://github.com/<you>/gitleaks /tmp/rem && cd /tmp/rem');
  assert.equal(cmds[2], 'git remote add upstream https://github.com/gitleaks/gitleaks && git fetch --depth 1 upstream master');
  assert.equal(cmds[3], 'git checkout -b deps/go-2025-3922 upstream/master');
  assert.equal(cmds[4], 'go get mholt/archives@v0.1.5 && go mod tidy');
  assert.equal(cmds[5], 'go build ./... && govulncheck ./...');
  assert.equal(cmds[6], 'git commit -am "deps: clear GO-2025-3922" && git push origin deps/go-2025-3922');
  assert.equal(cmds[7], 'gh pr create --repo gitleaks/gitleaks --draft --head <you>:deps/go-2025-3922 --title "deps: clear GO-2025-3922" --body-file body.md');
});

test('uses placeholder when no spec provided', () => {
  const adv = {
    id: 'CVE-2024-1234',
    package: 'example/pkg',
    ecosystem: 'go',
    currentVersion: 'v1.0.0',
    fixed: 'v1.0.1',
    reachable: true,
    upstream: { repo: 'owner/repo', defaultBranch: 'main' }
  };
  const cmds = renderCommands(adv, { branch: 'deps/cve-2024-1234', spec: '' });
  assert.equal(cmds[4], '# apply the fix');
});

test('uses defaults for missing upstream fields', () => {
  const adv = {
    id: 'GHSA-abc123',
    package: 'some/module',
    ecosystem: 'go',
    currentVersion: 'v2.0.0',
    fixed: 'v2.0.1',
    reachable: true,
    upstream: {}
  };
  const cmds = renderCommands(adv, { branch: 'deps/ghsa-abc123', spec: 'some/module@v2.0.1' });
  assert.equal(cmds[0], 'gh repo fork <owner/repo> --clone=false');
  assert.equal(cmds[2], 'git remote add upstream https://github.com/<owner/repo> && git fetch --depth 1 upstream main');
  assert.equal(cmds[3], 'git checkout -b deps/ghsa-abc123 upstream/main');
});

test('handles advisory id with special characters in JSON stringification', () => {
  const adv = {
    id: 'GO-2025-9999',
    package: 'test/pkg',
    ecosystem: 'go',
    currentVersion: 'v0.1.0',
    fixed: 'v0.1.1',
    reachable: true,
    upstream: { repo: 'a/b', defaultBranch: 'dev' }
  };
  const cmds = renderCommands(adv, { branch: 'deps/go-2025-9999', spec: 'test/pkg@v0.1.1' });
  assert.equal(cmds[6], 'git commit -am "deps: clear GO-2025-9999" && git push origin deps/go-2025-9999');
  assert.equal(cmds[7], 'gh pr create --repo a/b --draft --head <you>:deps/go-2025-9999 --title "deps: clear GO-2025-9999" --body-file body.md');
});

test('returns 8 commands even with minimal advisory', () => {
  const adv = {
    id: 'X-1',
    package: 'p',
    ecosystem: 'go',
    currentVersion: 'v1',
    fixed: 'v2',
    reachable: true,
    upstream: { repo: 'o/r', defaultBranch: 'b' }
  };
  const cmds = renderCommands(adv, { branch: 'deps/x-1', spec: 'p@v2' });
  assert.equal(cmds.length, 8);
  assert.equal(cmds[3], 'git checkout -b deps/x-1 upstream/b');
});

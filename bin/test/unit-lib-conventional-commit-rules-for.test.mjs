// Resolves a rule-set name to its scope and tell options (bin/lib/conventional-commit.mjs rulesFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rulesFor } from '../lib/conventional-commit.mjs';

test('returns the commitwork rule set when the name is undefined', () => {
  assert.deepEqual(rulesFor(undefined), { ok: true, name: "commitwork", opts: { allowedScopes: { admin: ["admin/"], bin: ["bin/"], cra: ["cra/"], docs: ["docs/", "README.md", "CLAUDE.md"], docsite: ["docsite/"], lib: ["lib/"], manifests: ["manifests/"], mcp: ["mcp/"], monitor: ["monitor/"], schema: ["schema/"], sitemap: ["sitemap/"], map: ["map/"], flow: ["flow/"], fixtures: ["fixtures/"], design: ["design/"], ci: [".github/", "ci/", "workflows/"], joern: ["joernwork/"], "chunk-diff": ["chunk-diff/"], provenance: ["provenance/"], "commit-phase": ["bin/commit-phase", "bin/format-phase", "bin/lib/conventional-commit", "bin/lib/prose-tells", "bin/test/commit-phase", "bin/test/conventional-commit", "bin/test/prose-tells", "bin/commit-msg", "bin/install-commit-msg", "bin/lib/commit-msg-hook", "bin/lib/imperative-verbs", "bin/test/commit-msg"], comments: ["bin/comment-", "bin/test/comment-", "admin/routes/comments", "admin/static/comments", "admin/test/comments"], taxonomy: ["monitor/taxonomy", "bin/taxonomy", "bin/test/taxonomy", "docsite/"], attribution: ["bin/lib/touch-", "bin/touch-", "bin/test/touch-", "bin/test/commit-phase-attribution"], redactions: ["lib/publish-", "bin/pre-publish", "bin/test/publish-", "schema/publish-", "schema/release-redactions", "monitor/publish-"], licensing: ["LICENSING.md", "LICENSE", "docs/AGPL-SCOPE.md", "docs/stack/"], stack: ["docs/stack/"], readme: ["README.md"], gates: ["bin/gate-", "bin/lib/gate-", "bin/test/gate-"], roster: ["bin/session-roster", "bin/test/session-roster"], release: ["bin/release", "bin/lib/release", "bin/test/release"], deps: ["package.json", "package-lock.json"] }, skipTells: [] } });
});

test('returns the commitwork rule set when the name is an empty string', () => {
  assert.deepEqual(rulesFor(''), { ok: true, name: "commitwork", opts: { allowedScopes: { admin: ["admin/"], bin: ["bin/"], cra: ["cra/"], docs: ["docs/", "README.md", "CLAUDE.md"], docsite: ["docsite/"], lib: ["lib/"], manifests: ["manifests/"], mcp: ["mcp/"], monitor: ["monitor/"], schema: ["schema/"], sitemap: ["sitemap/"], map: ["map/"], flow: ["flow/"], fixtures: ["fixtures/"], design: ["design/"], ci: [".github/", "ci/", "workflows/"], joern: ["joernwork/"], "chunk-diff": ["chunk-diff/"], provenance: ["provenance/"], "commit-phase": ["bin/commit-phase", "bin/format-phase", "bin/lib/conventional-commit", "bin/lib/prose-tells", "bin/test/commit-phase", "bin/test/conventional-commit", "bin/test/prose-tells", "bin/commit-msg", "bin/install-commit-msg", "bin/lib/commit-msg-hook", "bin/lib/imperative-verbs", "bin/test/commit-msg"], comments: ["bin/comment-", "bin/test/comment-", "admin/routes/comments", "admin/static/comments", "admin/test/comments"], taxonomy: ["monitor/taxonomy", "bin/taxonomy", "bin/test/taxonomy", "docsite/"], attribution: ["bin/lib/touch-", "bin/touch-", "bin/test/touch-", "bin/test/commit-phase-attribution"], redactions: ["lib/publish-", "bin/pre-publish", "bin/test/publish-", "schema/publish-", "schema/release-redactions", "monitor/publish-"], licensing: ["LICENSING.md", "LICENSE", "docs/AGPL-SCOPE.md", "docs/stack/"], stack: ["docs/stack/"], readme: ["README.md"], gates: ["bin/gate-", "bin/lib/gate-", "bin/test/gate-"], roster: ["bin/session-roster", "bin/test/session-roster"], release: ["bin/release", "bin/lib/release", "bin/test/release"], deps: ["package.json", "package-lock.json"] }, skipTells: [] } });
});

test('returns the cobolwork rule set when the name is cobolwork', () => {
  assert.deepEqual(rulesFor('cobolwork'), { ok: true, name: "cobolwork", opts: { allowedScopes: null, skipTells: ["shout"] } });
});

test('returns the spine rule set when the name is spine', () => {
  assert.deepEqual(rulesFor('spine'), { ok: true, name: "spine", opts: { allowedScopes: null, skipTells: [] } });
});

test('returns an error when the name is not a known rule set', () => {
  assert.deepEqual(rulesFor('nope'), { ok: false, why: "commitwork.rules names 'nope', and the rule sets are commitwork, cobolwork, ironwork, cobolwork-web, spine" });
});

test('returns an error when the name is a long unknown rule set', () => {
  assert.deepEqual(rulesFor('x'.repeat(64)), { ok: false, why: "commitwork.rules names 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', and the rule sets are commitwork, cobolwork, ironwork, cobolwork-web, spine" });
});

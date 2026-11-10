// Which identity fields name the subject a lane groups by (monitor/feed-groups.mjs subjectFieldsFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectFieldsFor } from '../feed-groups.mjs';

const PACKAGE_SIDE = ['package', 'component', 'ecosystem'];
const SUBJECTS = ['rule', 'control', 'criterion', 'marker', 'detector', 'kind', 'issue', 'probe', 'operation'];

const BASES = [
  'dep', 'dependency', 'dependency-audit', 'dependency-vulnerabilities', 'dependency-vulns', 'dependency-health',
  'dependencies', 'sca', 'vuln', 'vulnerability', 'vulnerabilities', 'cve', 'advisory', 'advisories', 'audit',
  'npm-audit', 'osv', 'outdated', 'freshness', 'license', 'licence', 'licensing', 'sbom', 'supply-chain',
  'package', 'malware', 'typosquat', 'provenance', 'sast', 'semgrep', 'codeql', 'lint', 'eslint', 'code',
  'code-quality', 'quality', 'complexity', 'duplication', 'coverage', 'test', 'dead-code', 'unused', 'hygiene',
  'debt', 'tech-debt', 'marker', 'todo', 'fixme', 'comment', 'types', 'typecheck', 'format', 'secret',
  'gitleaks', 'trufflehog', 'credential', 'leak', 'entropy', 'iac', 'infra', 'infrastructure', 'terraform',
  'checkov', 'container', 'docker', 'dockerfile', 'image', 'trivy', 'grype', 'k8s', 'kubernetes', 'helm',
  'cloud', 'aws', 'misconfig', 'misconfiguration', 'config', 'configuration', 'drift', 'ci', 'cicd', 'pipeline',
  'workflow', 'github-actions', 'actions', 'compliance', 'control', 'soc2', 'iso27001', 'nist', 'cis', 'gdpr',
  'hipaa', 'pci', 'policy', 'governance', 'privacy', 'pii', 'data', 'a11y', 'accessibility', 'wcag', 'axe',
  'seo', 'performance', 'perf', 'lighthouse', 'web-vitals', 'bundle', 'ux', 'i18n', 'sitemap', 'link',
  'broken-links', 'web', 'dast', 'zap', 'nuclei', 'probe', 'runtime', 'network', 'tls', 'ssl', 'dns', 'headers',
  'port', 'surface', 'attack-surface', 'endpoint', 'api', 'openapi', 'graphql', 'contract', 'operation',
  'schema', 'auth', 'authz', 'crypto', 'cryptography', 'mobile', 'ai', 'llm', 'prompt-injection', 'agent',
  'mcp', 'model', 'docs', 'documentation', 'git', 'commit', 'repo', 'repository', 'security', 'reliability',
  'observability', 'logging', 'migration', 'database', 'sql', 'db', 'binary', 'threat', 'threat-model',
  'review', 'architecture',
];

const SHAPES = [
  (b) => b,
  (b) => `${b}s`,
  (b) => `${b}-scan`,
  (b) => `${b}-scanner`,
  (b) => `${b}-check`,
  (b) => `${b}-checks`,
  (b) => `scan-${b}`,
  (b) => `security-${b}`,
  (b) => `security.${b}`,
  (b) => `security/${b}`,
  (b) => `security:${b}`,
  (b) => b.replaceAll('-', '_'),
];

const CANDIDATE_LANES = [...new Set(BASES.flatMap((b) => SHAPES.map((shape) => shape(b))))];
const sweep = () => CANDIDATE_LANES.map((lane) => ({ lane, ...subjectFieldsFor(lane) }));
const lanesOf = (rows) => rows.map((r) => r.lane);

test('a lane name with no schema has null fields and is not declared', () => {
  assert.deepEqual(subjectFieldsFor('no-such-lane'), { fields: null, declared: false });
});

test('an empty object passed as the lane has null fields and is not declared', () => {
  assert.deepEqual(subjectFieldsFor({}), { fields: null, declared: false });
});

test('an object shaped like a finding is not read as a lane', () => {
  assert.deepEqual(subjectFieldsFor({ package: 'lodash', ecosystem: 'npm' }), { fields: null, declared: false });
});

test('a candidate lane name is declared exactly when it has fields', () => {
  const inconsistent = sweep().filter((r) => r.declared !== (r.fields !== null));
  assert.deepEqual(lanesOf(inconsistent), []);
});

test('a candidate lane grouped by package is declared and holds only package, component and ecosystem', () => {
  const rows = sweep().filter((r) => r.fields?.some((f) => f === 'package' || f === 'component'));
  assert.deepEqual(lanesOf(rows.filter((r) => r.declared !== true)), []);
  assert.deepEqual(lanesOf(rows.filter((r) => r.fields.some((f) => !PACKAGE_SIDE.includes(f)))), []);
});

test('a candidate lane grouped by a subject field is declared and holds exactly that one field', () => {
  const rows = sweep().filter((r) => r.fields?.some((f) => SUBJECTS.includes(f)));
  assert.deepEqual(lanesOf(rows.filter((r) => r.declared !== true)), []);
  assert.deepEqual(lanesOf(rows.filter((r) => r.fields.length !== 1)), []);
});

test('no candidate lane returns an undefined field', () => {
  assert.deepEqual(lanesOf(sweep().filter((r) => r.fields?.includes(undefined))), []);
});

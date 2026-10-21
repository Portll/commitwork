// A provider-shaped token in a tracked file blocks the push that publishes it, real or not.
// Everything builds its tokens at run time. .github/secret_scanning.yml declares the planted
// fixtures, which exempts them from secret-scanning ALERTS and NOT from push protection.
//
// THIS LIST IS A LOWER BOUND, NOT A MODEL OF GITHUB'S DETECTORS. The real gate also blocks an
// unquoted bare AKIA id, a 40-char entropy run, and an `sk_live_` prefix even under a declared
// paths-ignore. A loose regex for the first two is deliberately NOT added: `[A-Za-z0-9/+]{40}`
// matches git SHAs and pinned action digests, and a bare `AKIA[0-9A-Z]{16}` matches the AWS leak
// verifier naming its own pattern. A guard that fails on that much correct code gets deleted in a
// week. The authority is the push. Treat a green run here as "no KNOWN shape", never as "the push
// will be accepted".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// High-confidence formats GitHub push protection blocks on.
export const SHAPES = [
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/],
  ['github-fine-grained', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ['stripe-live', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['slack-token', /\bxox[abpors]-[0-9]{6,}-[0-9]{6,}-[0-9A-Za-z]{24}\b/],
  ['sendgrid', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['anthropic-key', /\bsk-ant-api03-[A-Za-z0-9_-]{20,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/]{40,}/],
  ['azure-storage-key', /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/],
  ['azure-sas', /[?&]sv=\d{4}-\d{2}-\d{2}&(?:.*&)?sig=[A-Za-z0-9%+/=]{20,}/],
  ['twilio-api-key', /\bSK[0-9a-f]{32}\b/],
  ['aws-key-pair', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b.*[^A-Za-z0-9/+][A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/],
  // A bare AWS key id DOES block a push. Quoted-literal only, and AWS's own documented example
  // excluded: tracked lines use AKIAIOSFODNN7EXAMPLE and GitHub allowlists it.
  ['aws-key-id-literal', /['"](?!AKIAIOSFODNN7EXAMPLE)(?:AKIA|ASIA)[0-9A-Z]{16}['"]/],
];

export function ignoredGlobs(text) {
  const out = [];
  let inList = false;
  for (const line of text.split('\n')) {
    if (/^paths-ignore:\s*$/.test(line)) { inList = true; continue; }
    if (inList && /^\S/.test(line)) inList = false;
    const m = inList && line.match(/^\s+-\s+["']?([^"']+)["']?\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal or escaped value defined in the test
export const globRe = (g) => new RegExp(`^${g.split('**').map((p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('.*')}$`);

export function offenders(files, read, globs) {
  const ignored = globs.map(globRe);
  const rows = [];
  for (const f of files) {
    if (ignored.some((re) => re.test(f))) continue;
    const text = read(f);
    if (text === null || text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      for (const [name, re] of SHAPES) if (re.test(line)) rows.push(`${f}:${i + 1} ${name}`);
    });
  }
  return rows;
}

const tracked = () => execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
const readTracked = (f) => { try { return readFileSync(join(REPO, f), 'utf8'); } catch { return null; } };
const globs = () => ignoredGlobs(readFileSync(join(REPO, '.github', 'secret_scanning.yml'), 'utf8'));

test('no tracked file outside the declared fixtures carries a push-protected token shape', () => {
  assert.deepEqual(offenders(tracked(), readTracked, globs()), [],
    'build the token at run time, or keep it under the length its detector needs. Declaring the path'
    + ' in .github/secret_scanning.yml does NOT help: that exempts alerts, not push protection, and a'
    + ' declared fixture is still rejected with GH013.');
});

test('every declared path matches a tracked file, so no entry ignores more than it names', () => {
  const files = tracked();
  const g = globs();
  assert.ok(g.length > 0, 'the ignore list parsed as empty');
  assert.deepEqual(g.filter((x) => !files.some((f) => globRe(x).test(f))), []);
});

test('each shape fires on a token of its own format, so a silent guard is not a clean one', () => {
  const tail = (n) => Array.from({ length: n }, (_, i) => 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC'[i % 32]).join('');
  const samples = {
    'github-token': `ghp_${tail(36)}`,
    'github-fine-grained': `github_pat_${tail(40)}`,
    'stripe-live': `sk_live_${tail(24)}`,
    'slack-token': `${'xo'}xb-${'1234567890'}-${'1234567890123'}-${tail(24)}`,
    'sendgrid': `SG.${tail(22)}.${tail(43)}`,
    'npm-token': `npm_${tail(36)}`,
    'anthropic-key': `sk-ant-api03-${tail(40)}`,
    'google-api-key': `AIza${tail(35)}`,
    'private-key-block': `-----BEGIN PRIVATE KEY-----\\n${tail(64)}`,
    'azure-storage-key': `Account${'Key'}=${tail(86)}==`,
    'azure-sas': `https://x.blob.core.windows.net/c?sv=2021-06-08&${'sig'}=${tail(40)}`,
    'twilio-api-key': `S${'K'}${'0123456789abcdef'.repeat(2)}`,
    'aws-key-pair': `"AKIA${'ABCDEFGHIJKLMNOP'}", "SecretKey": "${tail(40)}"`,
    // Not AKIAIOSFODNN7EXAMPLE: that one is excluded by the shape, so it would not fire here either.
    'aws-key-id-literal': `"AKIA${'ABCDEFGHIJKLMNOP'}"`,
  };
  for (const [name, re] of SHAPES) assert.ok(re.test(samples[name]), `${name} did not fire on its own format`);
  const files = ['src/a.mjs', 'fixtures/scan-canary/dirty/x.mjs'];
  const read = () => `const k = '${samples['stripe-live']}';\n`;
  assert.deepEqual(offenders(files, read, ['fixtures/scan-canary/dirty/**']), ['src/a.mjs:1 stripe-live']);
});

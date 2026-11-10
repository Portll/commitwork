// Classifies a leak finding as a test fixture by checking the path and the matched value (admin/routes/leaks-verify.mjs verifyTestFixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTestFixture } from '../routes/leaks-verify.mjs';

test('returns strong when the path is a test directory and the value is a known published example', () => {
  const out = verifyTestFixture({ file: 'tests/fixtures/aws.json', matched: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  assert.equal(out.tier, 'strong');
  assert.equal(out.verdict, 'supports');
  assert.equal(out.detail, 'test path and a published example value (aws-docs-secret-key)');
  assert.equal(out.checks.length, 2);
  assert.equal(out.checks[0].name, 'test-path');
  assert.equal(out.checks[0].result, 'pass');
  assert.equal(out.checks[1].name, 'published-example');
  assert.equal(out.checks[1].result, 'pass');
});

test('returns medium when the path is a test directory but the value is a default-allowlisted example', () => {
  const out = verifyTestFixture({ file: 'src/__tests__/config.js', matched: 'AKIAIOSFODNN7EXAMPLE' });
  assert.equal(out.tier, 'medium');
  assert.equal(out.verdict, 'supports');
  assert.equal(out.detail, 'test path; the only value match is aws-docs-access-key-id, which gitleaks allowlists by default and which corroborates little');
  assert.equal(out.checks[0].result, 'pass');
  assert.equal(out.checks[1].result, 'pass');
});

test('returns medium when the path is a test directory and the value matches no published example', () => {
  const out = verifyTestFixture({ file: 'fixtures/data.json', matched: 'super-secret-value-12345' });
  assert.equal(out.tier, 'medium');
  assert.equal(out.verdict, 'supports');
  assert.equal(out.detail, 'test path; the value matches no published example');
  assert.equal(out.checks[0].result, 'pass');
  assert.equal(out.checks[1].result, 'fail');
});

test('returns medium when the value is a known published example but the path is not a test directory', () => {
  const out = verifyTestFixture({ file: 'src/config.js', matched: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  assert.equal(out.tier, 'medium');
  assert.equal(out.verdict, 'supports');
  assert.equal(out.detail, 'published example value (aws-docs-secret-key), but the path is not a test directory');
  assert.equal(out.checks[0].result, 'fail');
  assert.equal(out.checks[1].result, 'pass');
});

test('returns weak when neither the path nor the value corroborates a fixture', () => {
  const out = verifyTestFixture({ file: 'src/app.js', matched: 'some-random-string' });
  assert.equal(out.tier, 'weak');
  assert.equal(out.verdict, 'none');
  assert.equal(out.detail, 'neither the path nor the value corroborates a fixture');
  assert.equal(out.checks[0].result, 'fail');
  assert.equal(out.checks[1].result, 'fail');
});

test('treats a path with a test segment in the middle as a test path', () => {
  const out = verifyTestFixture({ file: 'src/test/utils.js', matched: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  assert.equal(out.tier, 'strong');
  assert.equal(out.checks[0].result, 'pass');
});

test('treats a path with a test segment in the filename as a test path', () => {
  const out = verifyTestFixture({ file: 'src/config.test.js', matched: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  assert.equal(out.tier, 'strong');
  assert.equal(out.checks[0].result, 'pass');
});

test('treats a path with a spec segment in the filename as a test path', () => {
  const out = verifyTestFixture({ file: 'src/config.spec.js', matched: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  assert.equal(out.tier, 'strong');
  assert.equal(out.checks[0].result, 'pass');
});

test('treats a path with a fixtures segment in the filename as a test path', () => {
  const out = verifyTestFixture({ file: 'src/data.fixtures.json', matched: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  assert.equal(out.tier, 'strong');
  assert.equal(out.checks[0].result, 'pass');
});

test('does not treat a path with a non-test segment as a test path', () => {
  const out = verifyTestFixture({ file: 'src/prod/config.js', matched: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  assert.equal(out.tier, 'medium');
  assert.equal(out.checks[0].result, 'fail');
});

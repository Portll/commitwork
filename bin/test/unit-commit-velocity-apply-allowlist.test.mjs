// applyAllowlist filters findings by active allowlist entries, returning kept findings and counts of suppressed and expired entries. (bin/commit-velocity.mjs applyAllowlist)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAllowlist } from '../commit-velocity.mjs';

test('returns empty kept findings and zero counts when no entries and no findings', () => {
  const findings = [];
  const entries = [];
  const options = { repo: 'myrepo', selfScan: false, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [], suppressed: 0, expired: 0 });
});

test('suppresses finding when active entry matches rule and author', () => {
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'author@example.com', repo: 'myrepo', expires: '2099-01-01T00:00:00Z' }];
  const options = { repo: 'myrepo', selfScan: false, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [], suppressed: 1, expired: 0 });
});

test('keeps finding when active entry rule matches but author does not', () => {
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'other@example.com', repo: 'myrepo', expires: '2099-01-01T00:00:00Z' }];
  const options = { repo: 'myrepo', selfScan: false, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [{ rule: 'R1', path: 'Author <author@example.com>' }], suppressed: 0, expired: 0 });
});

test('expired entry increments expired count and does not suppress finding', () => {
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'author@example.com', repo: 'myrepo', expires: '2000-01-01T00:00:00Z' }];
  const options = { repo: 'myrepo', selfScan: false, now: 10000000000000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [{ rule: 'R1', path: 'Author <author@example.com>' }], suppressed: 0, expired: 1 });
});

test('entry with exp equal to now is not expired and suppresses finding', () => {
  const now = 1000;
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'author@example.com', repo: 'myrepo', expires: new Date(now).toISOString() }];
  const options = { repo: 'myrepo', selfScan: false, now };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [], suppressed: 1, expired: 0 });
});

test('entry with non-finite exp is not active and does not suppress finding', () => {
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'author@example.com', repo: 'myrepo', expires: 'invalid' }];
  const options = { repo: 'myrepo', selfScan: false, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [{ rule: 'R1', path: 'Author <author@example.com>' }], suppressed: 0, expired: 0 });
});

test('entry with non-matching repo and selfScan false is not active', () => {
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'author@example.com', repo: 'otherrepo', expires: '2099-01-01T00:00:00Z' }];
  const options = { repo: 'myrepo', selfScan: false, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [{ rule: 'R1', path: 'Author <author@example.com>' }], suppressed: 0, expired: 0 });
});

test('entry without repo applies when selfScan true', () => {
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'author@example.com', expires: '2099-01-01T00:00:00Z' }];
  const options = { repo: 'myrepo', selfScan: true, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [], suppressed: 1, expired: 0 });
});

test('entry with repo commitwork applies when selfScan true', () => {
  const findings = [{ rule: 'R1', path: 'Author <author@example.com>' }];
  const entries = [{ rule: 'R1', author: 'author@example.com', repo: 'commitwork', expires: '2099-01-01T00:00:00Z' }];
  const options = { repo: 'myrepo', selfScan: true, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, { findings: [], suppressed: 1, expired: 0 });
});

test('multiple findings and entries produce correct suppressed and kept counts', () => {
  const findings = [
    { rule: 'R1', path: 'A <a@ex.com>' },
    { rule: 'R2', path: 'B <b@ex.com>' },
    { rule: 'R1', path: 'C <c@ex.com>' }
  ];
  const entries = [
    { rule: 'R1', author: 'a@ex.com', repo: 'myrepo', expires: '2099-01-01T00:00:00Z' },
    { rule: 'R2', author: 'x@ex.com', repo: 'myrepo', expires: '2099-01-01T00:00:00Z' }
  ];
  const options = { repo: 'myrepo', selfScan: false, now: 1000 };
  const result = applyAllowlist(findings, entries, options);
  assert.deepEqual(result, {
    findings: [
      { rule: 'R2', path: 'B <b@ex.com>' },
      { rule: 'R1', path: 'C <c@ex.com>' }
    ],
    suppressed: 1,
    expired: 0
  });
});

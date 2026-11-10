// runtime findings aggregation (bin/parse-runtime.mjs parseRuntime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRuntime } from '../parse-runtime.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'parseRuntime-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns empty result for non-existent directory', () => {
  const result = parseRuntime('/does/not/exist');
  assert.deepEqual(result, { findings: [], probes: [], categories: {}, blockers: [], ran: false });
});

test('detects ran flag when only authz files are present', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'authz.json'), JSON.stringify({ findings: [] }));
    const result = parseRuntime(dir);
    assert.equal(result.ran, true);
    assert.equal(result.findings.length, 0);
    assert.equal(result.probes.length, 0);
  });
});

test('parses a simple nuclei record and categorises it as disclosure', () => {
  withTempDir((dir) => {
    const rec = {
      info: { severity: 'high', classification: { 'cwe-id': ['CWE-79'] }, tags: ['disclosure'], name: 'missing-security-headers', description: 'desc', impact: 'imp', remediation: 'fix', reference: ['http://example.com'] },
      type: 'http',
      matched_at: 'http://example.com',
      'template-id': 'missing-security-headers',
      response: 'HTTP/1.1 200 OK\r\n\r\n<html></html>',
    };
    writeFileSync(join(dir, 'nuclei.jsonl'), JSON.stringify(rec) + '\n');
    const { findings, categories, blockers, ran } = parseRuntime(dir);
    assert.equal(ran, true);
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.tool, 'nuclei');
    assert.equal(f.id, 'missing-security-headers');
    assert.equal(f.severity, 'high');
    assert.equal(f.category, 'disclosure');
    assert.equal(f.confirmed, true);
    assert.equal(categories.disclosure.count, 1);
    assert.equal(categories.disclosure.worst, 'high');
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].blockerReason, 'high-severity runtime exposure');
  });
});

test('dedupes identical findings from nuclei and authz', () => {
  withTempDir((dir) => {
    const nuc = {
      info: { severity: 'low', tags: [], name: 'test', description: '' },
      type: 'http',
      matched_at: 'http://a',
      'template-id': 'test-id',
      response: '',
    };
    writeFileSync(join(dir, 'nuclei.json'), JSON.stringify([nuc]));
    const authz = { findings: [{ type: 'bola', path: 'http://a', severity: 'low' }] };
    writeFileSync(join(dir, 'authz-bola.json'), JSON.stringify(authz));
    const { findings } = parseRuntime(dir);
    assert.equal(findings.length, 2);
    writeFileSync(join(dir, 'nuclei.jsonl'), JSON.stringify(nuc) + '\n');
    const { findings: f2 } = parseRuntime(dir);
    assert.equal(f2.length, 2);
    const keys = new Set(f2.map((x) => `${x.tool}|${x.id}|${x.location}|${x.severity}`));
    assert.equal(keys.size, 2);
  });
});

test('leaksSecrets true when location matches secret pattern', () => {
  withTempDir((dir) => {
    const rec = {
      info: { severity: 'low', tags: [], name: 'test', description: '' },
      type: 'http',
      matched_at: 'http://service/env',
      'template-id': 'test-id',
      response: '',
    };
    writeFileSync(join(dir, 'nuclei.json'), JSON.stringify([rec]));
    const { findings } = parseRuntime(dir);
    const f = findings[0];
    assert.equal(f.leaksSecrets, true);
    assert.equal(f.blocker, true);
    assert.equal(f.blockerReason, 'leaks secrets (env / config / memory)');
  });
});

test('isBlocker respects confirmed flag (false does not become blocker)', () => {
  withTempDir((dir) => {
    const rec = {
      info: { severity: 'high', tags: [], name: 'test', description: '' },
      type: 'http',
      matched_at: 'http://service',
      'template-id': 'test-id',
      response: 'HTTP/1.1 404 Not Found\r\n\r\n',
    };
    writeFileSync(join(dir, 'nuclei.json'), JSON.stringify([rec]));
    const { findings, blockers, categories } = parseRuntime(dir);
    const f = findings[0];
    assert.equal(f.confirmed, false);
    assert.equal(f.blocker, undefined);
    assert.equal(blockers.length, 0);
    assert.equal(categories.disclosure.unconfirmed, 0);
    assert.equal(categories.disclosure.worst, 'none');
  });
});

test('categories start with blocker false and count zero', () => {
  withTempDir((dir) => {
    const { categories } = parseRuntime(dir);
    for (const cid of Object.keys(categories)) {
      assert.equal(categories[cid].blocker, false);
      assert.equal(categories[cid].count, 0);
    }
  });
});

test('dedupes identical nuclei findings within same file', () => {
  withTempDir((dir) => {
    const rec = {
      info: { severity: 'low', tags: [], name: 'test', description: '' },
      type: 'http',
      matched_at: 'http://a',
      'template-id': 'test-id',
      response: '',
    };
    const lines = Array.from({ length: 3 }, () => JSON.stringify(rec)).join('\n');
    writeFileSync(join(dir, 'nuclei.jsonl'), lines + '\n');
    const { findings } = parseRuntime(dir);
    assert.equal(findings.length, 1);
  });
});

test('unconfirmed findings do not affect worst severity', () => {
  withTempDir((dir) => {
    const rec = {
      info: { severity: 'critical', tags: [], name: 'test', description: '' },
      type: 'http',
      matched_at: 'http://a',
      'template-id': 'test-id',
      response: 'HTTP/1.1 500 Internal Server Error\r\n\r\n',
    };
    writeFileSync(join(dir, 'nuclei.jsonl'), JSON.stringify(rec) + '\n');
    const { categories } = parseRuntime(dir);
    assert.equal(categories.disclosure.worst, 'none');
    assert.equal(categories.disclosure.unconfirmed, 0);
    assert.equal(categories.disclosure.confirmed, 0);
  });
});

test('blocker findings set category blocker to true', () => {
  withTempDir((dir) => {
    const rec = {
      info: { severity: 'high', tags: [], name: 'test', description: '' },
      type: 'http',
      matched_at: 'http://a',
      'template-id': 'test-id',
      response: 'HTTP/1.1 200 OK\r\n\r\n',
    };
    writeFileSync(join(dir, 'nuclei.jsonl'), JSON.stringify(rec) + '\n');
    const { categories, blockers } = parseRuntime(dir);
    assert.equal(categories.disclosure.blocker, false);
    assert.equal(blockers.length, 1);
  });
});

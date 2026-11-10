// The parsed and validated job store document, or null when the file is absent (mcp/jobs.mjs readJobStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJobStore } from '../jobs.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCHEMA_MSG = 'not a commitwork.mcp-jobs/1 document';
const MALFORMED_MSG = 'malformed: owner, issued, savedAt or jobs is missing or of the wrong type';

const valid = () => ({
  schema: 'commitwork.mcp-jobs/1',
  owner: { pid: 1, prefix: 'p' },
  issued: 1,
  jobs: [],
  savedAt: '2024-01-01T00:00:00Z'
});

function withFile(name, content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readJobStore-'));
  try {
    const f = join(dir, name);
    if (content !== undefined) writeFileSync(f, JSON.stringify(content));
    fn(f);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns null when the file does not exist', () => {
  withFile('missing.json', undefined, (f) => {
    assert.equal(readJobStore(f), null);
  });
});

test('returns the parsed document when every field is valid and the owner pid is one', () => {
  withFile('valid.json', valid(), (f) => {
    assert.deepEqual(readJobStore(f), valid());
  });
});

test('returns the parsed document when the owner pid is two', () => {
  const doc = { ...valid(), owner: { pid: 2, prefix: 'job-' }, issued: 7, jobs: [{ id: 'a' }] };
  withFile('pid-two.json', doc, (f) => {
    assert.deepEqual(readJobStore(f), doc);
  });
});

test('throws the schema error when the schema string is wrong but other fields are valid', () => {
  withFile('bad-schema.json', { ...valid(), schema: 'commitwork.mcp-jobs/2' }, (f) => {
    assert.throws(() => readJobStore(f), { name: 'Error', message: SCHEMA_MSG });
  });
});

test('throws the schema error when the document is an array', () => {
  withFile('array.json', [1, 2], (f) => {
    assert.throws(() => readJobStore(f), { name: 'Error', message: SCHEMA_MSG });
  });
});

test('throws the malformed error when the owner pid is zero', () => {
  withFile('pid-zero.json', { ...valid(), owner: { pid: 0, prefix: 'p' } }, (f) => {
    assert.throws(() => readJobStore(f), { name: 'Error', message: MALFORMED_MSG });
  });
});

test('throws the malformed error when the owner prefix is a number', () => {
  withFile('bad-prefix.json', { ...valid(), owner: { pid: 1, prefix: 123 } }, (f) => {
    assert.throws(() => readJobStore(f), { name: 'Error', message: MALFORMED_MSG });
  });
});

test('throws the malformed error when issued is not an integer', () => {
  withFile('bad-issued.json', { ...valid(), issued: 1.5 }, (f) => {
    assert.throws(() => readJobStore(f), { name: 'Error', message: MALFORMED_MSG });
  });
});

test('throws the malformed error when jobs is a string instead of an array', () => {
  withFile('bad-jobs.json', { ...valid(), jobs: 'nope' }, (f) => {
    assert.throws(() => readJobStore(f), { name: 'Error', message: MALFORMED_MSG });
  });
});

test('throws the malformed error when savedAt is not a parseable date', () => {
  withFile('bad-savedat.json', { ...valid(), savedAt: 'not-a-date' }, (f) => {
    assert.throws(() => readJobStore(f), { name: 'Error', message: MALFORMED_MSG });
  });
});

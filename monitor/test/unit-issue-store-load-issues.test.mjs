// the validated issue store document, or an empty one when absent (monitor/issue-store.mjs loadIssues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIssues } from '../issue-store.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const NOTE = 'commitwork issue tracker \u2014 append-only events[] (hash-chained evidence trail); '
  + 'issues{} is derived current state. Never edit by hand; linear git history only. '
  + 'Verify: node bin/issue.mjs verify';

const emptyDoc = (organisation) => ({
  note: NOTE,
  version: 1,
  organisation,
  nextOrdinal: 0,
  byKey: {},
  lastIngest: {},
  events: [],
  issues: {},
});

function withDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'loadIssues-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withOrg(value, run) {
  const saved = process.env.CW_ISSUE_ORG;
  if (value === undefined) delete process.env.CW_ISSUE_ORG;
  else process.env.CW_ISSUE_ORG = value;
  try {
    run();
  } finally {
    if (saved === undefined) delete process.env.CW_ISSUE_ORG;
    else process.env.CW_ISSUE_ORG = saved;
  }
}

test('a missing store file returns the empty document with a null organisation when none is declared', () => {
  withDir((dir) => {
    const path = join(dir, 'missing.json');
    withOrg(undefined, () => assert.deepEqual(loadIssues({ path }), emptyDoc(null)));
    withOrg('', () => assert.deepEqual(loadIssues({ path }), emptyDoc(null)));
  });
});

test('a missing store file takes its organisation from CW_ISSUE_ORG', () => {
  withDir((dir) => {
    const path = join(dir, 'missing.json');
    withOrg('acme', () => assert.deepEqual(loadIssues({ path }), emptyDoc('acme')));
  });
});

test('a directory at the store path is refused as unreadable instead of treated as empty', () => {
  withDir((dir) => {
    assert.throws(() => loadIssues({ path: dir }), {
      name: 'Error',
      message: `issue store at ${dir} is unreadable (EISDIR); refusing to treat it as empty`,
    });
  });
});

test('malformed JSON is refused with the parser message', () => {
  withDir((dir) => {
    const path = join(dir, 'badjson.json');
    writeFileSync(path, '{ invalid json ', 'utf8');
    assert.throws(() => loadIssues({ path }), {
      name: 'Error',
      message: `issue store at ${path} is not valid JSON (Expected property name or '}' in JSON at position 2 (line 1 column 3)); refusing to treat it as empty`,
    });
  });
});

test('a zero byte file is refused as invalid JSON instead of treated as empty', () => {
  withDir((dir) => {
    const path = join(dir, 'blank.json');
    writeFileSync(path, '', 'utf8');
    assert.throws(() => loadIssues({ path }), {
      name: 'Error',
      message: `issue store at ${path} is not valid JSON (Unexpected end of JSON input); refusing to treat it as empty`,
    });
  });
});

test('a JSON null is refused as not an object', () => {
  withDir((dir) => {
    const path = join(dir, 'null.json');
    writeFileSync(path, 'null', 'utf8');
    assert.throws(() => loadIssues({ path }), {
      name: 'Error',
      message: `issue store at ${path} is not an object`,
    });
  });
});

test('empty and non-empty JSON arrays are refused as not an object', () => {
  withDir((dir) => {
    const path = join(dir, 'array.json');
    for (const raw of ['[]', '[{"version":1}]']) {
      writeFileSync(path, raw, 'utf8');
      assert.throws(() => loadIssues({ path }), {
        name: 'Error',
        message: `issue store at ${path} is not an object`,
      });
    }
  });
});

test('truthy and falsy JSON primitives are refused as not an object', () => {
  withDir((dir) => {
    const path = join(dir, 'primitive.json');
    for (const raw of ['5', '0', '"text"', '""', 'true', 'false']) {
      writeFileSync(path, raw, 'utf8');
      assert.throws(() => loadIssues({ path }), {
        name: 'Error',
        message: `issue store at ${path} is not an object`,
      });
    }
  });
});

test('a document that passes the schema is returned as parsed from the file', () => {
  withDir((dir) => {
    const path = join(dir, 'valid.json');
    const doc = {
      note: '',
      version: 1,
      organisation: null,
      nextOrdinal: 0,
      byKey: {},
      lastIngest: {},
      events: [],
      issues: {},
    };
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.deepEqual(loadIssues({ path }), {
      note: '',
      version: 1,
      organisation: null,
      nextOrdinal: 0,
      byKey: {},
      lastIngest: {},
      events: [],
      issues: {},
    });
  });
});

test('an object that fails the schema is refused and the errors are listed', () => {
  withDir((dir) => {
    const path = join(dir, 'invalid-fields.json');
    const doc = { version: 'one', nextOrdinal: 'zero', byKey: [], events: 'none', issues: [] };
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => loadIssues({ path }), {
      name: 'Error',
      message: /^issue store invalid \(.+invalid-fields\.json\):\n  - /,
    });
  });
});

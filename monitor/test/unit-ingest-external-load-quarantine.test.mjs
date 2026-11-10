// Quarantine ledger read from disk, failing closed on anything but absence (monitor/ingest-external.mjs loadQuarantine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuarantine } from '../ingest-external.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EMPTY_DOC = {
  note: 'commitwork external-ingest QUARANTINE \u2014 every judgement the return path refused, with '
      + 'the raw payload kept as an opaque STRING. Never re-applied, never parsed back into the '
      + 'issue store. Written by monitor/ingest-external.mjs; never edit by hand.',
  version: 1,
  dropped: 0,
  entries: [],
};

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadQuarantine-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertNotDocument(path, text) {
  writeFileSync(path, text);
  assert.throws(() => loadQuarantine({ path }), {
    name: 'Error',
    message: `ingest quarantine at ${path} is not a quarantine document`,
  });
}

test('A missing file yields the empty quarantine document', () => {
  withDir((dir) => {
    assert.deepEqual(loadQuarantine({ path: join(dir, 'missing.json') }), EMPTY_DOC);
  });
});

test('Read failures other than absence are refused with their error code', () => {
  withDir((dir) => {
    assert.throws(() => loadQuarantine({ path: dir }), {
      name: 'Error',
      message: `ingest quarantine at ${dir} is unreadable (EISDIR); refusing to treat it as empty`,
    });
    const file = join(dir, 'plain.json');
    writeFileSync(file, '{"entries":[]}');
    const child = join(file, 'child.json');
    assert.throws(() => loadQuarantine({ path: child }), {
      name: 'Error',
      message: `ingest quarantine at ${child} is unreadable (ENOTDIR); refusing to treat it as empty`,
    });
  });
});

test('Malformed JSON is refused with the parser message', () => {
  withDir((dir) => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    assert.throws(() => loadQuarantine({ path: p }), {
      name: 'Error',
      message: `ingest quarantine at ${p} is not valid JSON (Unexpected token 'o', "not json" is not valid JSON); refusing to treat it as empty`,
    });
  });
});

test('An empty file is refused as invalid JSON rather than treated as absent', () => {
  withDir((dir) => {
    const p = join(dir, 'empty.json');
    writeFileSync(p, '');
    assert.throws(() => loadQuarantine({ path: p }), {
      name: 'Error',
      message: `ingest quarantine at ${p} is not valid JSON (Unexpected end of JSON input); refusing to treat it as empty`,
    });
  });
});

test('JSON null is refused as not a quarantine document', () => {
  withDir((dir) => {
    assertNotDocument(join(dir, 'null.json'), 'null');
  });
});

test('Truthy and falsy JSON primitives are refused as not a quarantine document', () => {
  withDir((dir) => {
    const p = join(dir, 'primitive.json');
    for (const text of ['"hello"', '""', '7', '0', 'true', 'false']) {
      assertNotDocument(p, text);
    }
  });
});

test('JSON arrays are refused as not a quarantine document', () => {
  withDir((dir) => {
    const p = join(dir, 'array.json');
    for (const text of ['[]', '[1,2,3]', '[{"entries":[]}]']) {
      assertNotDocument(p, text);
    }
  });
});

test('Objects whose entries is missing or not an array are refused', () => {
  withDir((dir) => {
    const p = join(dir, 'object.json');
    for (const text of ['{}', '{"version":1}', '{"entries":null}', '{"entries":"x"}', '{"entries":{"length":0}}']) {
      assertNotDocument(p, text);
    }
  });
});

test('A valid document is returned as parsed with nothing added or removed', () => {
  withDir((dir) => {
    const p = join(dir, 'good.json');
    writeFileSync(p, '{"note":"kept","version":3,"dropped":2,"entries":[{"id":"a","payload":"{}"}],"extra":true}');
    assert.deepEqual(loadQuarantine({ path: p }), {
      note: 'kept',
      version: 3,
      dropped: 2,
      entries: [{ id: 'a', payload: '{}' }],
      extra: true,
    });
    writeFileSync(p, '{"entries":[]}');
    assert.deepEqual(loadQuarantine({ path: p }), { entries: [] });
  });
});

test('Without a path it reads the file named by CW_INGEST_QUARANTINE', () => {
  withDir((dir) => {
    const p = join(dir, 'from-env.json');
    writeFileSync(p, '{"version":9,"entries":["e"]}');
    const saved = process.env.CW_INGEST_QUARANTINE;
    process.env.CW_INGEST_QUARANTINE = p;
    try {
      assert.deepEqual(loadQuarantine(), { version: 9, entries: ['e'] });
    } finally {
      if (saved === undefined) delete process.env.CW_INGEST_QUARANTINE;
      else process.env.CW_INGEST_QUARANTINE = saved;
    }
  });
});

// Parses the scanner roster JSON and rejects it when schema validation reports errors (monitor/scanner-binary.mjs readRoster).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoster } from '../scanner-binary.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withRoster(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readRoster-'));
  const saved = process.env.CW_SCANNER_ROSTER;
  try {
    const file = join(dir, 'roster.json');
    if (content !== undefined) writeFileSync(file, content);
    process.env.CW_SCANNER_ROSTER = file;
    fn(file);
  } finally {
    if (saved === undefined) delete process.env.CW_SCANNER_ROSTER;
    else process.env.CW_SCANNER_ROSTER = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('A roster with an empty tools array throws a minimum items error line', () => {
  withRoster(JSON.stringify({ tools: [] }), (file) => {
    assert.throws(() => readRoster(), {
      name: 'Error',
      message: `scanner roster invalid (${file}):\n  - schema: tools: needs at least 1 item(s), has 0`,
    });
  });
});

test('A roster missing the tools key throws with one schema error line', () => {
  withRoster(JSON.stringify({}), (file) => {
    assert.throws(() => readRoster(), {
      name: 'Error',
      message: `scanner roster invalid (${file}):\n  - schema: (root): required key 'tools' is missing`,
    });
  });
});

test('A roster with an empty tools array and an unknown key throws both error lines', () => {
  withRoster(JSON.stringify({ tools: [], a: 1 }), (file) => {
    assert.throws(() => readRoster(), {
      name: 'Error',
      message: `scanner roster invalid (${file}):\n  - schema: tools: needs at least 1 item(s), has 0\n  - schema: (root): unknown key 'a' (additionalProperties: false)`,
    });
  });
});

test('Several schema errors are joined one per indented line', () => {
  withRoster(JSON.stringify({ a: 1, b: 2 }), (file) => {
    assert.throws(() => readRoster(), {
      name: 'Error',
      message: `scanner roster invalid (${file}):\n  - schema: (root): required key 'tools' is missing\n  - schema: (root): unknown key 'a' (additionalProperties: false)\n  - schema: (root): unknown key 'b' (additionalProperties: false)`,
    });
  });
});

test('A roster whose tools value is a string throws a type error line', () => {
  withRoster(JSON.stringify({ tools: 'x' }), (file) => {
    assert.throws(() => readRoster(), {
      name: 'Error',
      message: `scanner roster invalid (${file}):\n  - schema: tools: expected array, got string`,
    });
  });
});

test('A missing roster file throws the read error', () => {
  withRoster(undefined, (file) => {
    assert.throws(() => readRoster(), {
      name: 'Error',
      message: `ENOENT: no such file or directory, open '${file}'`,
    });
  });
});

test('A roster file that is not valid JSON throws a SyntaxError', () => {
  withRoster('{bad', () => {
    assert.throws(() => readRoster(), { name: 'SyntaxError', message: "Expected property name or '}' in JSON at position 1 (line 1 column 2)" });
  });
});

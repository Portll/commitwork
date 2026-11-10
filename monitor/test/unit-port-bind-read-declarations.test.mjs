// Schema-validated bind declarations parsed from JSON (monitor/port-bind.mjs readDeclarations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDeclarations } from '../port-bind.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shipped = () => JSON.parse(readFileSync(new URL('../bind-declarations.json', import.meta.url), 'utf8'));

const invalid = (path, ...errors) =>
  `bind declarations invalid (${path}):\n${errors.map((e) => `  - schema: (root): ${e}`).join('\n')}`;

function withDeclarations(text, check) {
  const dir = mkdtempSync(join(tmpdir(), 'readDeclarations-'));
  const saved = process.env.CW_BIND_DECLARATIONS;
  try {
    const path = join(dir, 'decl.json');
    if (text !== undefined) writeFileSync(path, text);
    process.env.CW_BIND_DECLARATIONS = path;
    check(path);
  } finally {
    if (saved === undefined) delete process.env.CW_BIND_DECLARATIONS;
    else process.env.CW_BIND_DECLARATIONS = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the parsed declarations when the file satisfies the schema', () => {
  const declarations = shipped();
  withDeclarations(JSON.stringify(declarations, null, 2), () => {
    assert.deepEqual(readDeclarations(), declarations);
  });
});

test('throws the ENOENT read error when the declarations file does not exist', () => {
  withDeclarations(undefined, (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: `ENOENT: no such file or directory, open '${path}'`,
    });
  });
});

test('throws a SyntaxError when the file does not hold JSON', () => {
  withDeclarations('not json', () => {
    assert.throws(() => readDeclarations(), {
      name: 'SyntaxError',
      message: `Unexpected token 'o', "not json" is not valid JSON`,
    });
  });
});

test('lists both required keys when the root object is empty', () => {
  withDeclarations('{}', (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: invalid(path, "required key 'binds' is missing", "required key 'stdio' is missing"),
    });
  });
});

test('joins every schema error on its own line when keys are missing and unknown', () => {
  withDeclarations(JSON.stringify({ ports: [] }), (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: invalid(
        path,
        "required key 'binds' is missing",
        "required key 'stdio' is missing",
        "unknown key 'ports' (additionalProperties: false)",
      ),
    });
  });
});

test('reports a single error when valid declarations gain an unknown key', () => {
  withDeclarations(JSON.stringify({ ...shipped(), ports: [] }), (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: invalid(path, "unknown key 'ports' (additionalProperties: false)"),
    });
  });
});

test('reports a single error when valid declarations lose the stdio key', () => {
  const declarations = shipped();
  delete declarations.stdio;
  withDeclarations(JSON.stringify(declarations), (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: invalid(path, "required key 'stdio' is missing"),
    });
  });
});

test('rejects a null root value', () => {
  withDeclarations('null', (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: invalid(path, 'expected object, got null'),
    });
  });
});

test('rejects a number root value', () => {
  withDeclarations('42', (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: invalid(path, 'expected object, got number'),
    });
  });
});

test('rejects a string root value', () => {
  withDeclarations('"hello"', (path) => {
    assert.throws(() => readDeclarations(), {
      name: 'Error',
      message: invalid(path, 'expected object, got string'),
    });
  });
});

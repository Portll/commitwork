// Reads, validates and returns the registry file as an object (monitor/registry.mjs loadRegistry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../registry.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRE_REAL = 'CW_REGISTRY_REQUIRE_REAL';
const EXAMPLE = fileURLToPath(new URL('../projects.example.json', import.meta.url));
const VALID = { reportsRoot: '/tmp/reports', projects: [{ name: 'a', path: '/x', manifest: 'package.json' }] };
const ANNOUNCEMENT = [
  'registry: monitor/projects.json is ABSENT \u2014 loaded monitor/projects.example.json instead.',
  'registry: this is a DEMONSTRATION fleet. Nothing it declares describes a real repository,',
  'registry: and any count taken from it is a count of the example, not of this machine.',
];
const REFUSAL = 'registry: refusing to run on the EXAMPLE fleet. CW_REGISTRY_REQUIRE_REAL=1 is set, which declares '
  + 'this a scheduled (non-interactive) caller, and monitor/projects.json is absent at '
  + `${EXAMPLE}. A sweep on the example would complete, publish counts for two demonstration `
  + 'repos, and report success \u2014 absence rendered as a clean result. Restore the registry, or '
  + 'point CW_REGISTRY at it, or unset CW_REGISTRY_REQUIRE_REAL if a human is genuinely watching.';

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadRegistry-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function writeDoc(dir, name, doc) {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(doc));
  return p;
}

function withEnv(name, value, fn) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { fn(); } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

function captureWarn(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (line) => { lines.push(line); };
  try { fn(); } finally { console.warn = original; }
  return lines;
}

test('returns the parsed registry and prints nothing for a valid file that is not the example', () => {
  inTemp((dir) => {
    const p = writeDoc(dir, 'reg.json', VALID);
    let result;
    const lines = captureWarn(() => { result = loadRegistry({ path: p }); });
    assert.deepEqual(result, VALID);
    assert.deepEqual(lines, []);
  });
});

test('throws naming the path when the registry file is missing', () => {
  inTemp((dir) => {
    const p = join(dir, 'missing.json');
    assert.throws(() => loadRegistry({ path: p, quiet: true }), {
      name: 'Error',
      message: `registry unreadable at ${p}: ENOENT: no such file or directory, open '${p}'`,
    });
  });
});

test('throws naming the path when the registry file is not valid JSON', () => {
  inTemp((dir) => {
    const text = '{ not json';
    const p = join(dir, 'bad.json');
    writeFileSync(p, text);
    let parseMessage;
    try { JSON.parse(text); } catch (e) { parseMessage = e.message; }
    assert.throws(() => loadRegistry({ path: p, quiet: true }), {
      name: 'Error',
      message: `registry is not valid JSON (${p}): ${parseMessage}`,
    });
  });
});

test('lists validator errors before schema errors when both reject the registry', () => {
  inTemp((dir) => {
    const p = writeDoc(dir, 'invalid.json', { projects: [{ name: 'a', path: '/x' }] });
    assert.throws(() => loadRegistry({ path: p, quiet: true }), {
      name: 'Error',
      message: `registry invalid (${p}):\n`
        + '  - projects[0] (a): manifest must be a string or array of strings\n'
        + "  - schema: (root): required key 'reportsRoot' is missing\n"
        + "  - schema: projects[0]: required key 'manifest' is missing",
    });
  });
});

test('treats a schema error as fatal when the structural validator has no complaint', () => {
  inTemp((dir) => {
    const p = writeDoc(dir, 'no-root.json', { projects: VALID.projects });
    assert.throws(() => loadRegistry({ path: p, quiet: true }), {
      name: 'Error',
      message: `registry invalid (${p}):\n  - schema: (root): required key 'reportsRoot' is missing`,
    });
  });
});

test('refuses the example fleet for a scheduled caller, quiet or not, without announcing it', () => {
  withEnv(REQUIRE_REAL, '1', () => {
    for (const quiet of [false, true]) {
      const lines = captureWarn(() => {
        assert.throws(() => loadRegistry({ path: EXAMPLE, quiet }), { name: 'Error', message: REFUSAL });
      });
      assert.deepEqual(lines, []);
    }
  });
});

test('loads a real registry for a scheduled caller', () => {
  inTemp((dir) => {
    const p = writeDoc(dir, 'real.json', VALID);
    withEnv(REQUIRE_REAL, '1', () => {
      assert.deepEqual(loadRegistry({ path: p, quiet: true }), VALID);
    });
  });
});

test('announces the example fleet by default and stays silent when quiet', () => {
  const parsed = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  for (const value of [undefined, '0']) {
    withEnv(REQUIRE_REAL, value, () => {
      let loud;
      const loudLines = captureWarn(() => { loud = loadRegistry({ path: EXAMPLE }); });
      assert.deepEqual(loudLines.slice(0, 3), ANNOUNCEMENT);
      assert.deepEqual(loud, parsed);
      let silent;
      const silentLines = captureWarn(() => { silent = loadRegistry({ path: EXAMPLE, quiet: true }); });
      assert.deepEqual(silentLines, []);
      assert.deepEqual(silent, parsed);
    });
  }
});

test('prints validation warnings before refusing an invalid registry, unless quiet', () => {
  inTemp((dir) => {
    const p = writeDoc(dir, 'warned.json', { extra: 1, projects: [{ name: 'a', path: '/x' }] });
    const invalid = {
      name: 'Error',
      message: /^registry invalid \(.*warned\.json\):\n {2}- projects\[0\] \(a\): manifest must be a string or array of strings\n/,
    };
    const loud = captureWarn(() => assert.throws(() => loadRegistry({ path: p }), invalid));
    assert.deepEqual(loud, ['registry: unknown top-level key: extra']);
    const silent = captureWarn(() => assert.throws(() => loadRegistry({ path: p, quiet: true }), invalid));
    assert.deepEqual(silent, []);
  });
});

test('uses the file named by CW_REGISTRY when no path is given and never falls back from it', () => {
  inTemp((dir) => {
    const p = writeDoc(dir, 'named.json', VALID);
    withEnv('CW_REGISTRY', p, () => {
      assert.deepEqual(loadRegistry({ quiet: true }), VALID);
    });
    const absent = join(dir, 'absent.json');
    withEnv('CW_REGISTRY', absent, () => {
      assert.throws(() => loadRegistry({ quiet: true }), {
        name: 'Error',
        message: `registry unreadable at ${absent}: ENOENT: no such file or directory, open '${absent}'`,
      });
    });
  });
});

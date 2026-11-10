// The launchlist spec read from a JSON file, schema-checked and cross-checked (lib/launchlist.mjs loadSpec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSpec } from '../launchlist.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = join(REPO, 'schema', 'launchlist.schema.json');
const base = () => JSON.parse(readFileSync(join(REPO, 'manifests', 'launchlist.json'), 'utf8'));
const firstOf = (spec) => {
  const it = spec.items[0];
  return { id: it.id, sec: it.section, prof: [].concat(it.profile)[0] };
};
const errorOf = (fn) => {
  try { fn(); } catch (e) { return e.message; }
  return null;
};
const put = (dir, name, body) => {
  const p = join(dir, name);
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return p;
};
function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadSpec-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a path with no file behind it throws spec missing', () => {
  inDir((dir) => {
    const p = join(dir, 'missing.json');
    assert.throws(() => loadSpec(p), { name: 'Error', message: `launchlist: spec missing at ${p}` });
  });
});

test('a file holding JSON null throws spec missing', () => {
  inDir((dir) => {
    const p = put(dir, 'null.json', 'null');
    assert.throws(() => loadSpec(p), { name: 'Error', message: `launchlist: spec missing at ${p}` });
  });
});

test('a directory path throws cannot read with the fs error text', () => {
  inDir((dir) => {
    const why = errorOf(() => readFileSync(dir, 'utf8'));
    assert.throws(() => loadSpec(dir), { name: 'Error', message: `launchlist: cannot read ${dir}: ${why}` });
  });
});

test('malformed JSON throws not valid JSON with the parse error text', () => {
  inDir((dir) => {
    const p = put(dir, 'bad.json', '{not json');
    const why = errorOf(() => JSON.parse('{not json'));
    assert.throws(() => loadSpec(p), { name: 'Error', message: `launchlist: ${p} is not valid JSON: ${why}` });
  });
});

test('an empty object is rejected by the launchlist schema with its first error', () => {
  inDir((dir) => {
    const p = put(dir, 'empty.json', {});
    const head = `launchlist: spec rejected by ${SCHEMA}: `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.throws(() => loadSpec(p), { name: 'Error', message: new RegExp(`^${head}(?!undefined$)[\\s\\S]+$`) });
  });
});

test('the repository manifest written to a temp file comes back parsed and unchanged', () => {
  inDir((dir) => {
    const p = put(dir, 'spec.json', base());
    assert.deepEqual(loadSpec(p), base());
  });
});

test('a second item reusing the first item id throws duplicate item id', () => {
  inDir((dir) => {
    const s = base();
    const { id } = firstOf(s);
    s.items[1] = { ...s.items[1], id };
    const p = put(dir, 'dup.json', s);
    assert.throws(() => loadSpec(p), { name: 'Error', message: `launchlist: duplicate item id ${id}` });
  });
});

test('an item whose section was removed from sections throws unknown section', () => {
  inDir((dir) => {
    const s = base();
    const { id, sec } = firstOf(s);
    delete s.sections[sec];
    const p = put(dir, 'nosec.json', s);
    assert.throws(() => loadSpec(p), { name: 'Error', message: `launchlist: ${id} names unknown section ${sec}` });
  });
});

test('an item whose profile was removed from profiles throws unknown profile', () => {
  inDir((dir) => {
    const s = base();
    const { id, prof } = firstOf(s);
    delete s.profiles[prof];
    const p = put(dir, 'noprof.json', s);
    assert.throws(() => loadSpec(p), { name: 'Error', message: `launchlist: ${id} names unknown profile ${prof}` });
  });
});

test('an item whose section is dropped from its profile sections throws not in profile', () => {
  inDir((dir) => {
    const s = base();
    const { id, sec, prof } = firstOf(s);
    s.profiles[prof].sections = s.profiles[prof].sections.filter((x) => x !== sec);
    const p = put(dir, 'outside.json', s);
    assert.throws(() => loadSpec(p), { name: 'Error', message: `launchlist: ${id} section ${sec} is not in profile ${prof}` });
  });
});

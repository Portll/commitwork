// safe-parse.test.mjs — the artifact parser must refuse an adversarial SHAPE: a __proto__ key, a nesting
// bomb, an oversized blob, a path that escapes its root — never parse it silently into a polluted object.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { safeParse, containPath } from '../safe-parse.mjs';

describe('safeParse — refuses hostile shapes', () => {
  test('a __proto__ key is refused (prototype-pollution shape)', () => {
    assert.throws(() => safeParse('{"__proto__":{"polluted":true}}'), /forbidden key/);
    assert.throws(() => safeParse('{"a":{"constructor":{"prototype":{}}}}'), /forbidden key/);
  });

  test('normal JSON parses into a NULL-PROTO object (nothing downstream can pollute through it)', () => {
    const o = safeParse('{"findings":[{"id":"x","classification":"real"}],"n":2}');
    assert.equal(Object.getPrototypeOf(o), null);
    assert.equal(o.n, 2);
    assert.equal(o.findings[0].id, 'x');
  });

  test('a nesting bomb is refused before JSON.parse', () => {
    assert.throws(() => safeParse('['.repeat(500) + ']'.repeat(500), { maxDepth: 200 }), /nesting depth/);
  });

  test('an oversized blob is refused', () => {
    assert.throws(() => safeParse('"' + 'a'.repeat(50) + '"', { maxBytes: 10 }), /exceeds/);
  });

  test('valid nested JSON within bounds still parses', () => {
    assert.deepEqual(safeParse('{"a":{"b":[1,2,3]}}').a.b, [1, 2, 3]);
  });
});

describe('containPath — a finding path never escapes its root', () => {
  test('a ../ escape is refused, never resolved', () => {
    assert.equal(containPath('../../etc/passwd', '/repo/x').ok, false);
    assert.equal(containPath('/etc/passwd', '/repo/x').ok, false);
  });
  test('an in-root path is contained', () => {
    const r = containPath('src/app.js', '/repo/x');
    assert.equal(r.ok, true);
    assert.equal(r.rel, 'src/app.js');
  });
});

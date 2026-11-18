// lib/test/unit-update-contract-bytes-semver.test.mjs — direct cases for canonicalJson, signedBytes
// and parseSemver in lib/update/contract.mjs. The contract's own test vector and the end-to-end
// verification live in update-contract.test.mjs; these cases pin the three functions on their own.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, signedBytes, parseSemver } from '../update/contract.mjs';

const utf8 = (s) => Buffer.from(s, 'utf8');

describe('canonicalJson', () => {
  test('objects with the same keys in a different insertion order give the identical string', () => {
    // Arrange
    const one = { b: 1, c: 2, a: 3 };
    const other = { c: 2, a: 3, b: 1 };
    // Act
    const s = canonicalJson(one);
    // Assert
    assert.equal(s, '{"a":3,"b":1,"c":2}');
    assert.equal(canonicalJson(other), s);
  });

  test('nested objects are sorted at every depth', () => {
    // Arrange
    const v = { z: { b: 1, a: 2 }, a: { y: { d: 4, c: 3 } } };
    // Act
    const s = canonicalJson(v);
    // Assert
    assert.equal(s, '{"a":{"y":{"c":3,"d":4}},"z":{"a":2,"b":1}}');
  });

  test('array order is preserved', () => {
    // Arrange
    const v = [2, 1, 3];
    // Act
    const s = canonicalJson(v);
    // Assert
    assert.equal(s, '[2,1,3]');
    assert.equal(canonicalJson([{ b: 1, a: 2 }, 'x']), '[{"a":2,"b":1},"x"]');
  });

  test('carries no whitespace around separators or colons', () => {
    // Arrange
    const v = { b: [1, 2], a: { c: true } };
    // Act
    const s = canonicalJson(v);
    // Assert
    assert.equal(s, '{"a":{"c":true},"b":[1,2]}');
    assert.equal(/\s/.test(s), false);
  });

  test('escapes quotes, backslashes, control characters and keeps unicode as written', () => {
    // Arrange
    const v = 'a"b\\c\u0001\u001f\n\té😀';
    // Act
    const s = canonicalJson(v);
    // Assert
    assert.equal(s, '"a\\"b\\\\c\\u0001\\u001f\\n\\té😀"');
  });

  test('escapes a key the same way it escapes a string value', () => {
    // Arrange
    const v = { 'a"b': 1 };
    // Act
    const s = canonicalJson(v);
    // Assert
    assert.equal(s, '{"a\\"b":1}');
  });

  test('writes null as null, at the top level and inside an object', () => {
    // Arrange / Act
    const top = canonicalJson(null);
    const inner = canonicalJson({ a: null });
    // Assert
    assert.equal(top, 'null');
    assert.equal(inner, '{"a":null}');
  });

  test('writes negative and fractional numbers unquoted, in JSON number form', () => {
    // Arrange / Act
    const negative = canonicalJson(-1.5);
    const big = canonicalJson(1e21);
    // Assert
    assert.equal(negative, '-1.5');
    assert.equal(big, '1e+21');
    assert.equal(typeof big, 'string');
  });

  test('writes zero and negative zero as 0', () => {
    // Arrange / Act
    const zero = canonicalJson(0);
    const negZero = canonicalJson(-0);
    // Assert
    assert.equal(zero, '0');
    assert.equal(negZero, '0');
  });

  test('refuses NaN and the infinities, naming the reason', () => {
    // Arrange
    const bad = [NaN, Infinity, -Infinity];
    // Act / Assert
    for (const v of bad) {
      assert.throws(() => canonicalJson(v), { name: 'TypeError', message: 'a non-finite number has no canonical JSON' });
      assert.throws(() => canonicalJson({ v }), { name: 'TypeError', message: 'a non-finite number has no canonical JSON' });
    }
  });

  test('refuses undefined, a function, a symbol and a bigint, naming each type', () => {
    // Arrange
    const bad = [[undefined, 'undefined'], [() => 1, 'function'], [Symbol('s'), 'symbol'], [1n, 'bigint']];
    // Act / Assert
    for (const [v, type] of bad) {
      assert.throws(() => canonicalJson(v), { name: 'TypeError', message: `a ${type} has no canonical JSON` });
    }
  });

  test('refuses a cycle instead of returning a string', () => {
    // Arrange
    const v = { a: 1 };
    v.self = v;
    // Act / Assert
    assert.throws(() => canonicalJson(v), { name: 'RangeError', message: /call stack/i });
  });
});

describe('signedBytes', () => {
  test('returns a Buffer of the manifest canonical form with the signature field removed', () => {
    // Arrange
    const m = { b: 2, signature: { alg: 'ed25519', keyId: 'k', sig: 'AAAA' }, a: 1 };
    // Act
    const bytes = signedBytes(m);
    // Assert
    assert.ok(Buffer.isBuffer(bytes));
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual(bytes, utf8('{"a":1,"b":2}'));
  });

  test('manifests differing only in the signature give identical bytes', () => {
    // Arrange
    const base = { product: 'commitwork', version: '1.2.3' };
    const one = { ...base, signature: { alg: 'ed25519', keyId: 'k', sig: 'AAAA' } };
    const other = { ...base, signature: { alg: 'ed25519', keyId: 'k2', sig: 'BBBB' } };
    // Act
    const a = signedBytes(one);
    const b = signedBytes(other);
    // Assert
    assert.deepEqual(a, b);
    assert.deepEqual(a, utf8('{"product":"commitwork","version":"1.2.3"}'));
  });

  test('a manifest differing in any other field gives different bytes', () => {
    // Arrange
    const base = { product: 'commitwork', version: '1.2.3', signature: { alg: 'ed25519' } };
    // Act
    const a = signedBytes(base);
    const version = signedBytes({ ...base, version: '1.2.4' });
    const product = signedBytes({ ...base, product: 'other' });
    // Assert
    assert.notEqual(Buffer.compare(a, version), 0);
    assert.notEqual(Buffer.compare(a, product), 0);
  });

  test('insertion order of the manifest keys does not change the bytes', () => {
    // Arrange
    const signature = { alg: 'ed25519' };
    // Act
    const a = signedBytes({ b: 2, a: { y: 1, x: 0 }, signature });
    const b = signedBytes({ signature, a: { x: 0, y: 1 }, b: 2 });
    // Assert
    assert.deepEqual(a, b);
  });

  test('the input manifest keeps its signature field and its shape', () => {
    // Arrange
    const m = { a: 1, signature: { alg: 'ed25519', keyId: 'k', sig: 'AAAA' }, artifacts: [{ name: 'x.tgz' }] };
    const before = structuredClone(m);
    // Act
    signedBytes(m);
    // Assert
    assert.deepEqual(m, before);
    assert.equal(Object.hasOwn(m, 'signature'), true);
    assert.deepEqual(m.signature, { alg: 'ed25519', keyId: 'k', sig: 'AAAA' });
  });

  test('a manifest without a signature field gains none', () => {
    // Arrange
    const m = { a: 1 };
    // Act
    signedBytes(m);
    // Assert
    assert.deepEqual(Object.keys(m), ['a']);
  });

  test('encodes the canonical text as UTF-8, so a non-ASCII character is more than one byte', () => {
    // Arrange
    const m = { notes: 'é', signature: { alg: 'ed25519' } };
    // Act
    const bytes = signedBytes(m);
    // Assert
    assert.deepEqual(bytes, utf8('{"notes":"é"}'));
    assert.equal(bytes.length, 14);
  });
});

describe('parseSemver', () => {
  test('parses 1.2.3 into exact components with no prerelease', () => {
    // Arrange / Act
    const r = parseSemver('1.2.3');
    // Assert
    assert.deepEqual(r, { major: 1, minor: 2, patch: 3, pre: [] });
    assert.deepEqual(parseSemver('0.0.0'), { major: 0, minor: 0, patch: 0, pre: [] });
  });

  test('rejects a leading v', () => {
    // Arrange / Act / Assert
    assert.equal(parseSemver('v1.2.3'), null);
    assert.equal(parseSemver('V1.2.3'), null);
  });

  test('splits a prerelease into its identifiers, keeping numeric ones as strings', () => {
    // Arrange / Act
    const beta = parseSemver('1.2.3-beta.1');
    const numeric = parseSemver('1.2.3-0.3.7');
    // Assert
    assert.deepEqual(beta, { major: 1, minor: 2, patch: 3, pre: ['beta', '1'] });
    assert.deepEqual(numeric.pre, ['0', '3', '7']);
  });

  test('drops build metadata, with or without a prerelease', () => {
    // Arrange / Act
    const plain = parseSemver('1.2.3+build.5');
    const pre = parseSemver('1.2.3-beta.1+build.5');
    // Assert
    assert.deepEqual(plain, { major: 1, minor: 2, patch: 3, pre: [] });
    assert.deepEqual(pre, { major: 1, minor: 2, patch: 3, pre: ['beta', '1'] });
    assert.deepEqual(Object.keys(plain), ['major', 'minor', 'patch', 'pre']);
  });

  test('rejects two-part, four-part, empty and dangling-separator strings', () => {
    // Arrange
    const bad = ['1.2', '1.2.3.4', '', '1', '.1.2.3', '1.2.', '1.2.3-', '1.2.3+'];
    // Act / Assert
    for (const v of bad) assert.equal(parseSemver(v), null, v);
  });

  test('rejects a non-string even when it stringifies to a version', () => {
    // Arrange
    const bad = [['1.2.3'], { toString: () => '1.2.3' }, new String('1.2.3'), 7, null, undefined];
    // Act / Assert
    for (const v of bad) assert.equal(parseSemver(v), null, String(v));
  });

  test('rejects leading zeros in the numeric parts', () => {
    // Arrange
    const bad = ['01.2.3', '1.02.3', '1.2.03', '1.2.3-01', '1.2.3-alpha.01'];
    // Act / Assert
    for (const v of bad) assert.equal(parseSemver(v), null, v);
  });
});

// lib/update/contract.mjs: the contract's test vector byte for byte, its two required refusals, the
// shape check, check order, and semver precedence.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson, signedBytes, parseSemver, compareSemver, manifestErrors, publicKeyFromRaw,
  verifySignature, checkManifest, pickArtifact,
} from '../update/contract.mjs';
import { TRUSTED_KEYS } from '../update/keys.mjs';
import { VECTOR, makeKey, manifestFor, resign } from './lib/update-rig.mjs';

const vectorKeys = { [VECTOR.keyId]: VECTOR.publicKeyBase64 };
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('the test vector', () => {
  test('canonical JSON of the vector manifest is the signed text, byte for byte', () => {
    // Arrange
    const m = VECTOR.manifest;
    // Act
    const bytes = signedBytes(m);
    // Assert
    assert.equal(bytes.toString('utf8'), VECTOR.canonical);
  });

  test('the vector verifies under its key', () => {
    // Arrange
    const m = VECTOR.manifest;
    // Act
    const r = verifySignature(m, vectorKeys);
    // Assert
    assert.deepEqual(r, { ok: true, keyId: 'test-2026-11', reason: null });
  });

  test('one byte of notes changed is refused', () => {
    // Arrange
    const m = clone(VECTOR.manifest);
    m.notes = 'test vectos';
    // Act
    const r = verifySignature(m, vectorKeys);
    // Assert
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not verify under test-2026-11/);
  });

  test('an unknown keyId is refused', () => {
    // Arrange
    const m = clone(VECTOR.manifest);
    m.signature.keyId = 'someone-else';
    // Act
    const r = verifySignature(m, vectorKeys);
    // Assert
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown keyId "someone-else"/);
  });

  test('the shipped trust list does not hold the test key', () => {
    // Arrange
    const ids = Object.keys(TRUSTED_KEYS);
    // Act
    const hasTest = ids.includes('test-2026-11') || Object.values(TRUSTED_KEYS).includes(VECTOR.publicKeyBase64);
    // Assert
    assert.equal(hasTest, false);
  });

  test('a signature of the wrong length is refused before verification', () => {
    // Arrange
    const m = clone(VECTOR.manifest);
    m.signature.sig = Buffer.alloc(10).toString('base64');
    // Act
    const r = verifySignature(m, vectorKeys);
    // Assert
    assert.equal(r.reason, 'the signature is not 64 bytes');
  });
});

describe('canonicalJson', () => {
  test('sorts keys recursively, keeps array order and writes no whitespace', () => {
    // Arrange
    const v = { b: [3, { z: 1, a: 'x' }], a: { d: null, c: true }, e: 'é"' };
    // Act
    const s = canonicalJson(v);
    // Assert
    assert.equal(s, '{"a":{"c":true,"d":null},"b":[3,{"a":"x","z":1}],"e":"é\\""}');
  });

  test('refuses values JSON cannot carry', () => {
    // Arrange
    const bad = [Infinity, NaN, undefined, () => 1, Symbol('s'), 1n];
    // Act
    const thrown = bad.map((v) => { try { canonicalJson({ v }); return false; } catch (e) { return e instanceof TypeError; } });
    // Assert
    assert.deepEqual(thrown, bad.map(() => true));
  });
});

describe('semver', () => {
  test('parses release and prerelease versions and refuses others', () => {
    // Arrange
    const inputs = ['1.2.3', '1.2.3-beta.1+build', '01.2.3', '1.2', 'v1.2.3', 7];
    // Act
    const out = inputs.map(parseSemver);
    // Assert
    assert.deepEqual(out[0], { major: 1, minor: 2, patch: 3, pre: [] });
    assert.deepEqual(out[1].pre, ['beta', '1']);
    assert.deepEqual(out.slice(2), [null, null, null, null]);
  });

  test('orders by semver 2.0.0 precedence', () => {
    // Arrange
    const ordered = ['0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    // Act
    const pairs = ordered.slice(1).map((v, i) => [compareSemver(ordered[i], v), compareSemver(v, ordered[i])]);
    // Assert
    for (const [lo, hi] of pairs) { assert.equal(lo, -1); assert.equal(hi, 1); }
    assert.equal(compareSemver('1.0.0+a', '1.0.0+b'), 0);
    assert.equal(compareSemver('1.0.0-x.1', '1.0.0-x.1'), 0);
  });

  test('throws on a version that is not semver', () => {
    // Arrange
    const bad = () => compareSemver('1.0.0', 'latest');
    // Act / Assert
    assert.throws(bad, /not a semver version: "latest"/);
  });
});

describe('manifestErrors', () => {
  test('the vector manifest conforms', () => {
    // Arrange
    const m = VECTOR.manifest;
    // Act
    const errs = manifestErrors(m);
    // Assert
    assert.deepEqual(errs, []);
  });

  test('names every departure from the shape', () => {
    // Arrange
    const m = {
      schema: 'portll-update@2', product: '', channel: 'nightly', version: 'x', published: 'soon', notes: 3,
      artifacts: [null, { name: '../x', platform: '', size: 0, sha256: 'ABC', url: 'http://x', github: { repo: 'nope' } }],
      signature: { alg: 'rsa' },
    };
    // Act
    const errs = manifestErrors(m).join('\n');
    // Assert
    for (const re of [/schema/, /product/, /channel/, /version/, /published/, /notes/, /artifacts\[0\] is not an object/,
      /artifacts\[1\]\.name/, /artifacts\[1\]\.platform/, /artifacts\[1\]\.size/, /artifacts\[1\]\.sha256/, /artifacts\[1\]\.url/,
      /artifacts\[1\]\.github/, /signature/]) assert.match(errs, re);
  });

  test('refuses a non-object and an empty artifact list', () => {
    // Arrange
    const empty = { ...clone(VECTOR.manifest), artifacts: [] };
    // Act
    const a = manifestErrors([]), b = manifestErrors(empty);
    // Assert
    assert.deepEqual(a, ['the manifest is not a JSON object']);
    assert.deepEqual(b, ['artifacts is not a non-empty array']);
  });
});

describe('checkManifest, in the contract order', () => {
  const key = makeKey();

  test('schema is checked first', () => {
    // Arrange
    const m = { ...manifestFor({ key }), schema: 'other' };
    // Act
    const r = checkManifest(m, { product: 'commitwork', keys: key.keys, installed: '0.0.1' });
    // Assert
    assert.equal(r.step, 'schema');
  });

  test('then product', () => {
    // Arrange
    const m = manifestFor({ key, product: 'megablast' });
    // Act
    const r = checkManifest(m, { product: 'commitwork', keys: key.keys, installed: '0.0.1' });
    // Assert
    assert.equal(r.step, 'product');
  });

  test('then signature, naming the keyId', () => {
    // Arrange
    const other = makeKey('other');
    const m = manifestFor({ key: other });
    // Act
    const r = checkManifest(m, { product: 'commitwork', keys: key.keys, installed: '0.0.1' });
    // Assert
    assert.equal(r.step, 'signature');
    assert.equal(r.keyId, 'other');
  });

  test('then version: equal and older are not newer', () => {
    // Arrange
    const m = manifestFor({ key, version: '1.2.3' });
    // Act
    const same = checkManifest(m, { product: 'commitwork', keys: key.keys, installed: '1.2.3' });
    const older = checkManifest(m, { product: 'commitwork', keys: key.keys, installed: '1.3.0' });
    // Assert
    assert.equal(same.step, 'version');
    assert.equal(same.newer, false);
    assert.equal(older.step, 'version');
  });

  test('a newer signed manifest passes; with no installed version the check stops at the signature', () => {
    // Arrange
    const m = manifestFor({ key, version: '1.2.4' });
    // Act
    const newer = checkManifest(m, { product: 'commitwork', keys: key.keys, installed: '1.2.3' });
    const ranked = checkManifest(m, { product: 'commitwork', keys: key.keys });
    // Assert
    assert.deepEqual(newer, { ok: true, step: null, reason: null, keyId: 'rig-key', newer: true });
    assert.equal(ranked.newer, null);
    assert.equal(ranked.ok, true);
  });

  test('a manifest edited after signing fails at the signature step', () => {
    // Arrange
    const m = { ...manifestFor({ key, version: '1.2.4' }), version: '1.2.5' };
    // Act
    const r = checkManifest(m, { product: 'commitwork', keys: key.keys, installed: '1.2.3' });
    // Assert
    assert.equal(r.step, 'signature');
  });
});

describe('pickArtifact and keys', () => {
  test('takes the first any-platform or matching artifact with the suffix', () => {
    // Arrange
    const key = makeKey();
    const m = manifestFor({ key });
    const two = resign({ ...m, artifacts: [{ ...m.artifacts[0], name: 'x.zip' }, { ...m.artifacts[0], platform: 'darwin-aarch64' }] }, key);
    // Act
    const tgz = pickArtifact(m, { suffix: '.tgz' });
    const mac = pickArtifact(two, { platform: 'darwin-aarch64', suffix: '.tgz' });
    const none = pickArtifact(two, { platform: 'linux-x86_64', suffix: '.tgz' });
    const noArtifacts = pickArtifact({});
    // Assert
    assert.equal(tgz.name, 'commitwork-9.9.9.tgz');
    assert.equal(mac.platform, 'darwin-aarch64');
    assert.equal(none, null);
    assert.equal(noArtifacts, null);
  });

  test('a public key that is not 32 bytes is refused', () => {
    // Arrange
    const short = Buffer.alloc(31).toString('base64');
    // Act / Assert
    assert.throws(() => publicKeyFromRaw(short), /32 bytes, not 31/);
  });

  test('verifySignature with no key table refuses', () => {
    // Arrange
    const m = VECTOR.manifest;
    // Act
    const r = verifySignature(m, undefined);
    // Assert
    assert.equal(r.ok, false);
  });
});

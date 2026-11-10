// Builds a compiled release scope from manifest, publish map, and identity register (bin/lib/release-scope.mjs buildScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScope } from '../lib/release-scope.mjs';

test('rejects a release manifest whose names array is empty', () => {
  assert.throws(() => buildScope({ release: { names: [] }, publish: { map: {} }, identities: { identities: [] } }), { name: 'Error', message: 'release-scope: the release manifest has no names[] \u2014 refusing to build a scope that would report clean over names it never loaded' });
});

test('rejects a publish map whose map is an array', () => {
  assert.throws(() => buildScope({ release: { names: [{ name: 'a' }] }, publish: { map: [1] }, identities: { identities: [] } }), { name: 'Error', message: 'release-scope: the publish map has no map{} \u2014 refusing to build a scope that would report clean over names it never loaded' });
});

test('rejects an identity register missing the identities array', () => {
  assert.throws(() => buildScope({ release: { names: [{ name: 'a' }] }, publish: { map: {} }, identities: {} }), { name: 'Error', message: 'release-scope: the identity register has no identities[] \u2014 refusing to build a scope that would report clean over names it never loaded' });
});

test('drops a release name ruled out by outOfScope unless the register scopes it all', () => {
  assert.deepEqual(buildScope({ release: { names: [{ name: 'alpha' }], outOfScope: { alpha: true } }, publish: { map: {} }, identities: { identities: [] } }), { words: [], prefixes: [], overridden: 0, undetermined: [], loaded: { "release-manifest": 1, "publish-map": 0, "identity-register": 0 }, prefixRe: null, fingerprint: "643d5437104296e2" });
});

test('keeps a release name ruled out when the identity register scopes it all', () => {
  assert.deepEqual(buildScope({ release: { names: [{ name: 'alpha' }], outOfScope: { alpha: true } }, publish: { map: {} }, identities: { identities: [{ scope: 'all', repo_name: 'alpha' }] } }), { words: [{ key: "alpha", source: "release-manifest", exempt: [], short: true, re: /alpha/gi }], prefixes: [], overridden: 1, undetermined: [], loaded: { "release-manifest": 1, "publish-map": 0, "identity-register": 1 }, prefixRe: null, fingerprint: "f7664c647a13c7fb" });
});

test('counts each ruled-out key as overridden only once across duplicate forms', () => {
  assert.deepEqual(buildScope({ release: { names: [{ name: 'alpha' }, { name: 'alpha' }], outOfScope: { alpha: true } }, publish: { map: { alpha: 1 } }, identities: { identities: [{ scope: 'all', repo_name: 'alpha' }] } }), { words: [{ key: "alpha", source: "release-manifest", exempt: [], short: true, re: /alpha/gi }], prefixes: [], overridden: 1, undetermined: [], loaded: { "release-manifest": 2, "publish-map": 1, "identity-register": 1 }, prefixRe: null, fingerprint: "f7664c647a13c7fb" });
});

test('merges duplicate forms from different sources into one entry', () => {
  assert.deepEqual(buildScope({ release: { names: [{ name: 'beta' }] }, publish: { map: { beta: 1 } }, identities: { identities: [] } }), { words: [{ key: "beta", source: "release-manifest", exempt: [], short: true, re: /beta/gi }], prefixes: [], overridden: 0, undetermined: [], loaded: { "release-manifest": 1, "publish-map": 1, "identity-register": 0 }, prefixRe: null, fingerprint: "ed3fe1dc8ab4a14f" });
});

test('marks a prose entry as not all and collects its exemptions', () => {
  assert.deepEqual(buildScope({ release: { names: [{ name: 'gamma', scope: 'prose', exempt: ['x'], undetermined: ['y'] }] }, publish: { map: {} }, identities: { identities: [] } }), { words: [{ key: "gamma", source: "release-manifest", exempt: ["x", "y"], short: true, re: /gamma/gi }], prefixes: [], overridden: 0, undetermined: [{ form: "y", source: "release-manifest" }], loaded: { "release-manifest": 1, "publish-map": 0, "identity-register": 0 }, prefixRe: null, fingerprint: "19ab8d2c8fd761f7" });
});

test('collects undetermined forms from prose entries only', () => {
  assert.deepEqual(buildScope({ release: { names: [{ name: 'delta', scope: 'prose', undetermined: ['z'] }, { name: 'eps' }] }, publish: { map: {} }, identities: { identities: [] } }), { words: [{ key: "delta", source: "release-manifest", exempt: ["z"], short: true, re: /delta/gi }, { key: "eps", source: "release-manifest", exempt: [], short: true, re: /eps/gi }], prefixes: [], overridden: 0, undetermined: [{ form: "z", source: "release-manifest" }], loaded: { "release-manifest": 2, "publish-map": 0, "identity-register": 0 }, prefixRe: null, fingerprint: "33e2f9f81b1cec6f" });
});

test('skips identity entries whose scope is not all', () => {
  assert.deepEqual(buildScope({ release: { names: [{ name: 'a' }] }, publish: { map: {} }, identities: { identities: [{ scope: 'partial', repo_name: 'beta' }] } }), { words: [{ key: "a", source: "release-manifest", exempt: [], short: true, re: /a/gi }], prefixes: [], overridden: 0, undetermined: [], loaded: { "release-manifest": 1, "publish-map": 0, "identity-register": 0 }, prefixRe: null, fingerprint: "1449f4699f3fccf8" });
});

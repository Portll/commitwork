// The one parser for osv-scanner's `Package '<name>@<version>'` message. The split is at the LAST
// `@` inside the quotes, so an npm scope keeps its leading `@`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageFromOsvMessage } from '../osv-message.mjs';

const parse = (text) => packageFromOsvMessage(text);

test('a plain npm name splits at the @', () => {
  assert.deepEqual(parse("Package 'lodash@4.17.20'"), { name: 'lodash', version: '4.17.20' });
});

test('a scoped npm name keeps its leading @', () => {
  assert.deepEqual(parse("Package '@babel/core@7.24.0'"), { name: '@babel/core', version: '7.24.0' });
});

test('a Maven group:artifact keeps the colon', () => {
  assert.deepEqual(parse("Package 'org.apache.logging.log4j:log4j-core@2.17.1'"), {
    name: 'org.apache.logging.log4j:log4j-core', version: '2.17.1',
  });
});

test('a PyPI name with . and - is preserved', () => {
  assert.deepEqual(parse("Package 'zope.interface-6@5.4.0'"), { name: 'zope.interface-6', version: '5.4.0' });
});

test('a Go module path with / is preserved', () => {
  assert.deepEqual(parse("Package 'github.com/gin-gonic/gin@v1.9.1'"), {
    name: 'github.com/gin-gonic/gin', version: 'v1.9.1',
  });
});

test('a Debian version keeps its epoch', () => {
  assert.deepEqual(parse("Package 'libssl1.1@1:2.3-4'"), {
    name: 'libssl1.1', version: '1:2.3-4',
  });
});

test('a version with +build is preserved whole', () => {
  assert.deepEqual(parse("Package 'golang.org/x/text@v0.3.8+incompatible'"), {
    name: 'golang.org/x/text', version: 'v0.3.8+incompatible',
  });
});

test('the split is at the LAST @ in the quoted text', () => {
  assert.deepEqual(parse("Package 'pkg@nested@1.2.3'"), { name: 'pkg@nested', version: '1.2.3' });
});

test('no Package segment returns null', () => {
  assert.equal(parse('a vulnerability with no package'), null);
});

test('Package with no @ returns null', () => {
  assert.equal(parse("Package 'noversion'"), null);
});

test('a lone scoped name returns null', () => {
  assert.equal(parse("Package '@scope'"), null);
});

test('a quoted string beginning with @ has no @ after its first character', () => {
  assert.equal(parse("Package '@1.0'"), null);
});

test('an empty name or version returns null', () => {
  assert.equal(parse("Package '@scope@'"), null);
  assert.equal(parse("Package 'pkg@'"), null);
});

test('an empty string returns null', () => {
  assert.equal(parse(''), null);
});

test('undefined returns null', () => {
  assert.equal(parse(undefined), null);
});

test('a number returns null', () => {
  assert.equal(parse(42), null);
});

test('a non-string whose string form holds a package segment still returns null', () => {
  assert.equal(parse(["Package 'a@1'"]), null);
  assert.equal(parse({ toString: () => "Package 'a@1'" }), null);
});

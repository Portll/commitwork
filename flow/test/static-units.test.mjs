// flow/test/static-units.test.mjs — case tests for argRoles, bindingName, freshnessNear, isTestModule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { argRoles, bindingName, freshnessNear, isTestModule } from '../static.mjs';

test('empty string returns empty Map', () => {
  const result = argRoles('');
  assert.equal(result instanceof Map, true);
  assert.equal(result.size, 0);
});

test('readFileSync with identifier maps to reads', () => {
  const result = argRoles('readFileSync(P, "utf8")');
  assert.equal(result.size, 1);
  assert.ok(result.has('P'));
  assert.deepEqual([...result.get('P')], ['reads']);
});

test('writeFileSync with identifier maps to writes', () => {
  const result = argRoles('writeFileSync(Q, data)');
  assert.equal(result.size, 1);
  assert.ok(result.has('Q'));
  assert.deepEqual([...result.get('Q')], ['writes']);
});

test('spawnSync is not a read or write verb', () => {
  const result = argRoles('spawnSync(cmd, args)');
  assert.equal(result.size, 0);
});

test('multiple roles for same identifier', () => {
  const result = argRoles('readFileSync(P, "utf8"); writeFileSync(P, data)');
  assert.equal(result.size, 1);
  assert.ok(result.has('P'));
  const roles = [...result.get('P')].sort();
  assert.deepEqual(roles, ['reads', 'writes']);
});

test('non-verb function call is ignored', () => {
  const result = argRoles('foo(bar, baz)');
  assert.equal(result.size, 0);
});

test('identifier with dollar sign', () => {
  const result = argRoles('readFileSync($P, "utf8")');
  assert.equal(result.size, 1);
  assert.ok(result.has('$P'));
  assert.deepEqual([...result.get('$P')], ['reads']);
});

test('returns the identifier for a simple const binding', () => {
  const src = "const foo = 'bar';";
  const masked = "const foo = 'bar';";
  const at = src.indexOf("'bar'");
  assert.equal(bindingName(src, masked, at), 'foo');
});

test('returns the identifier for a let binding', () => {
  const src = "let x = 'val';";
  const masked = "let x = 'val';";
  const at = src.indexOf("'val'");
  assert.equal(bindingName(src, masked, at), 'x');
});

test('returns the identifier for a var binding', () => {
  const src = "var y = 'test';";
  const masked = "var y = 'test';";
  const at = src.indexOf("'test'");
  assert.equal(bindingName(src, masked, at), 'y');
});

test('returns the identifier for an exported const binding', () => {
  const src = "export const z = 'data';";
  const masked = "export const z = 'data';";
  const at = src.indexOf("'data'");
  assert.equal(bindingName(src, masked, at), 'z');
});

test('returns null when no binding is found on the line', () => {
  const src = "foo('bar');";
  const masked = "foo('bar');";
  const at = src.indexOf("'bar'");
  assert.equal(bindingName(src, masked, at), null);
});

test('returns null when the line has no assignment', () => {
  const src = "console.log('hello');";
  const masked = "console.log('hello');";
  const at = src.indexOf("'hello'");
  assert.equal(bindingName(src, masked, at), null);
});

test('handles multiple statements on the same line', () => {
  const src = "const a = 1; const b = 'path';";
  const masked = "const a = 1; const b = 'path';";
  const at = src.indexOf("'path'");
  assert.equal(bindingName(src, masked, at), 'b');
});

test('returns null for a function call argument without binding', () => {
  const src = "readFileSync('file.txt');";
  const masked = "readFileSync('file.txt');";
  const at = src.indexOf("'file.txt'");
  assert.equal(bindingName(src, masked, at), null);
});

test('returns null when no freshness markers are present', () => {
  const masked = 'const x = readFileSync("data.json");';
  const at = masked.indexOf('data.json');
  assert.equal(freshnessNear(masked, at), null);
});

test('detects mtime marker', () => {
  const masked = 'if (fs.statSync(p).mtime > Date.now() - 3600000) {';
  const at = masked.indexOf('p');
  const result = freshnessNear(masked, at);
  assert.equal(result.checks, true);
  assert.equal(result.marker, 'mtime');
});

test('detects maxAge marker', () => {
  const masked = 'const opts = { maxAge: 60000 };';
  const at = masked.indexOf('opts');
  const result = freshnessNear(masked, at);
  assert.equal(result.checks, true);
  assert.equal(result.marker, 'maxAge');
});

test('detects ttl marker', () => {
  const masked = 'const ttl = 300;';
  const at = masked.indexOf('ttl');
  const result = freshnessNear(masked, at);
  assert.equal(result.checks, true);
  assert.equal(result.marker, 'ttl');
});

test('detects Date.now() subtraction pattern', () => {
  const masked = 'const age = Date.now() - fileTime;';
  const at = masked.indexOf('fileTime');
  const result = freshnessNear(masked, at);
  assert.equal(result.checks, true);
  assert.equal(result.marker, 'Date.now() -');
});

test('returns null when marker is outside the search window', () => {
  const masked = 'x'.repeat(300) + 'mtime' + 'x'.repeat(300);
  const at = 150;
  assert.equal(freshnessNear(masked, at), null);
});

test('returns true for a path containing /test/', () => {
  assert.equal(isTestModule('src/test/foo.mjs'), true);
});

test('returns true for a path starting with test/', () => {
  assert.equal(isTestModule('test/foo.mjs'), true);
});

test('returns true for a .test.js file', () => {
  assert.equal(isTestModule('src/foo.test.js'), true);
});

test('returns true for a .test.mjs file', () => {
  assert.equal(isTestModule('src/foo.test.mjs'), true);
});

test('returns true for a .test.cjs file', () => {
  assert.equal(isTestModule('src/foo.test.cjs'), true);
});

test('returns true for a path containing /fixtures/', () => {
  assert.equal(isTestModule('src/fixtures/data.json'), true);
});

test('returns false for a normal source file', () => {
  assert.equal(isTestModule('src/foo.mjs'), false);
});

test('returns false for a file named test.mjs without /test/ dir or .test. suffix', () => {
  assert.equal(isTestModule('src/test.mjs'), false);
});

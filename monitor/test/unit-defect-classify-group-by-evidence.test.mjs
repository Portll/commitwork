// Groups closure records by trimmed evidence text, collecting issue ids and sorting by group size (monitor/defect-classify.mjs groupByEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByEvidence } from '../defect-classify.mjs';

test('returns an empty array when the input is null', () => {
  assert.deepEqual(groupByEvidence(null), []);
});

test('returns an empty array when the input is undefined', () => {
  assert.deepEqual(groupByEvidence(undefined), []);
});

test('returns an empty array when the input is an empty array', () => {
  assert.deepEqual(groupByEvidence([]), []);
});

test('groups a single closure with a valid sha evidence into one group', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 'abc1234', issueId: 'i1' }]), [{ evidence: "abc1234", issueIds: ["i1"], unusable: false, sha: "abc1234" }]);
});

test('merges closures that share the same evidence into one group with both issue ids', () => {
  assert.deepEqual(groupByEvidence([
    { evidence: 'abc1234', issueId: 'i1' },
    { evidence: 'abc1234', issueId: 'i2' }
  ]), [{ evidence: "abc1234", issueIds: ["i1", "i2"], unusable: false, sha: "abc1234" }]);
});

test('keeps distinct evidence strings as separate groups sorted by issue count descending', () => {
  assert.deepEqual(groupByEvidence([
    { evidence: 'aaa1111', issueId: 'i1' },
    { evidence: 'bbb2222', issueId: 'i2' },
    { evidence: 'bbb2222', issueId: 'i3' },
    { evidence: 'ccc3333', issueId: 'i4' }
  ]), [{ evidence: "bbb2222", issueIds: ["i2", "i3"], unusable: false, sha: "bbb2222" }, { evidence: "aaa1111", issueIds: ["i1"], unusable: false, sha: "aaa1111" }, { evidence: "ccc3333", issueIds: ["i4"], unusable: false, sha: "ccc3333" }]);
});

test('treats null evidence as an unusable empty group', () => {
  assert.deepEqual(groupByEvidence([{ evidence: null, issueId: 'i1' }]), [{ evidence: "", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('treats a string object evidence as unusable and groups it under the stringified key', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new String('  '), issueId: 'i1' }]), [{ evidence: "", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('treats a zero-length evidence string as unusable', () => {
  assert.deepEqual(groupByEvidence([{ evidence: '', issueId: 'i1' }]), [{ evidence: "", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('treats the literal string undefined as unusable', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 'undefined', issueId: 'i1' }]), [{ evidence: "undefined", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('treats the literal string null as unusable', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 'null', issueId: 'i1' }]), [{ evidence: "null", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('treats the literal string object placeholder as unusable', () => {
  assert.deepEqual(groupByEvidence([{ evidence: '[object Object]', issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('trims surrounding whitespace from evidence before grouping and extracting the sha', () => {
  assert.deepEqual(groupByEvidence([
    { evidence: '  abc1234  ', issueId: 'i1' },
    { evidence: 'abc1234', issueId: 'i2' }
  ]), [{ evidence: "abc1234", issueIds: ["i1", "i2"], unusable: false, sha: "abc1234" }]);
});

test('extracts a 40-character sha from evidence text', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(groupByEvidence([{ evidence: sha, issueId: 'i1' }]), [{ evidence: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issueIds: ["i1"], unusable: false, sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]);
});

test('extracts a 7-character sha from evidence text', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 'deadbee', issueId: 'i1' }]), [{ evidence: "deadbee", issueIds: ["i1"], unusable: false, sha: "deadbee" }]);
});

test('leaves sha null when evidence contains no hex token of sufficient length', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 'no sha here', issueId: 'i1' }]), [{ evidence: "no sha here", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure with no evidence property as an unusable empty group', () => {
  assert.deepEqual(groupByEvidence([{ issueId: 'i1' }]), [{ evidence: "", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a number by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 12345, issueId: 'i1' }]), [{ evidence: "12345", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a boolean false by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: false, issueId: 'i1' }]), [{ evidence: "false", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a boolean true by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: true, issueId: 'i1' }]), [{ evidence: "true", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is zero by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 0, issueId: 'i1' }]), [{ evidence: "0", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is an empty object by stringifying it to the placeholder', () => {
  assert.deepEqual(groupByEvidence([{ evidence: {}, issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a nested object by stringifying it to the placeholder', () => {
  assert.deepEqual(groupByEvidence([{ evidence: { a: 1 }, issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a function by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: function () {}, issueId: 'i1' }]), [{ evidence: "function () {}", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a symbol by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: Symbol('s'), issueId: 'i1' }]), [{ evidence: "Symbol(s)", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a bigint by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: 12345n, issueId: 'i1' }]), [{ evidence: "12345", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a date by stringifying it', () => {
  const evidence = new Date(0);
  assert.deepEqual(groupByEvidence([{ evidence, issueId: 'i1' }]), [{ evidence: String(evidence), issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a regex by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: /abc/, issueId: 'i1' }]), [{ evidence: "/abc/", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is an array by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: [1, 2], issueId: 'i1' }]), [{ evidence: "1,2", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a buffer by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: Buffer.from('abc1234'), issueId: 'i1' }]), [{ evidence: "abc1234", issueIds: ["i1"], unusable: false, sha: "abc1234" }]);
});

test('handles a closure whose evidence is a typed array by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new Uint8Array([1, 2]), issueId: 'i1' }]), [{ evidence: "1,2", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a map by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new Map(), issueId: 'i1' }]), [{ evidence: "[object Map]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a set by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new Set(), issueId: 'i1' }]), [{ evidence: "[object Set]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a promise by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: Promise.resolve(), issueId: 'i1' }]), [{ evidence: "[object Promise]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a proxy by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new Proxy({}, {}), issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a weakmap by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new WeakMap(), issueId: 'i1' }]), [{ evidence: "[object WeakMap]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a weakset by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new WeakSet(), issueId: 'i1' }]), [{ evidence: "[object WeakSet]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a weakref by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new WeakRef({}), issueId: 'i1' }]), [{ evidence: "[object WeakRef]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a finalization registry by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new FinalizationRegistry(() => {}), issueId: 'i1' }]), [{ evidence: "[object FinalizationRegistry]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a shared array buffer by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new SharedArrayBuffer(8), issueId: 'i1' }]), [{ evidence: "[object SharedArrayBuffer]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is an atomics object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: Atomics, issueId: 'i1' }]), [{ evidence: "[object Atomics]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a json object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: JSON, issueId: 'i1' }]), [{ evidence: "[object JSON]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a math object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: Math, issueId: 'i1' }]), [{ evidence: "[object Math]", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a date object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: Date, issueId: 'i1' }]), [{ evidence: "function Date() { [native code] }", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a regexp object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: RegExp, issueId: 'i1' }]), [{ evidence: "function RegExp() { [native code] }", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is an error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new Error('e'), issueId: 'i1' }]), [{ evidence: "Error: e", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a type error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new TypeError('t'), issueId: 'i1' }]), [{ evidence: "TypeError: t", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a range error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new RangeError('r'), issueId: 'i1' }]), [{ evidence: "RangeError: r", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a syntax error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new SyntaxError('s'), issueId: 'i1' }]), [{ evidence: "SyntaxError: s", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a reference error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new ReferenceError('r'), issueId: 'i1' }]), [{ evidence: "ReferenceError: r", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a uri error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new URIError('u'), issueId: 'i1' }]), [{ evidence: "URIError: u", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is an eval error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new EvalError('e'), issueId: 'i1' }]), [{ evidence: "EvalError: e", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is an aggregate error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new AggregateError([], 'a'), issueId: 'i1' }]), [{ evidence: "AggregateError: a", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a system error object by stringifying it', () => {
  assert.deepEqual(groupByEvidence([{ evidence: new Error('s'), issueId: 'i1' }]), [{ evidence: "Error: s", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a custom error class instance by stringifying it', () => {
  class CustomError extends Error { constructor() { super('c'); } }
  assert.deepEqual(groupByEvidence([{ evidence: new CustomError(), issueId: 'i1' }]), [{ evidence: "Error: c", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance by stringifying it', () => {
  class Foo { toString() { return 'foo'; } }
  assert.deepEqual(groupByEvidence([{ evidence: new Foo(), issueId: 'i1' }]), [{ evidence: "foo", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance with no custom toString by stringifying it', () => {
  class Bar {}
  assert.deepEqual(groupByEvidence([{ evidence: new Bar(), issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a symbol toString by stringifying it', () => {
  class Baz { [Symbol.toPrimitive]() { return 'baz'; } }
  assert.deepEqual(groupByEvidence([{ evidence: new Baz(), issueId: 'i1' }]), [{ evidence: "baz", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a valueOf by stringifying it', () => {
  class Qux { valueOf() { return 42; } }
  assert.deepEqual(groupByEvidence([{ evidence: new Qux(), issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a class instance with both toString and valueOf by stringifying it', () => {
  class Quux { toString() { return 'ts'; } valueOf() { return 42; } }
  assert.deepEqual(groupByEvidence([{ evidence: new Quux(), issueId: 'i1' }]), [{ evidence: "ts", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing toString by stringifying it', () => {
  class Corge { toString() { throw new Error('boom'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Corge(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing valueOf by stringifying it', () => {
  class Grault { valueOf() { throw new Error('boom'); } }
  assert.deepStrictEqual(groupByEvidence([{ evidence: new Grault(), issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive by stringifying it', () => {
  class Garply { [Symbol.toPrimitive]() { throw new Error('boom'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Garply(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive and no other methods by stringifying it', () => {
  class Waldo { [Symbol.toPrimitive]() { throw new Error('boom'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Waldo(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing toString and valueOf by stringifying it', () => {
  class Fred { toString() { throw new Error('boom'); } valueOf() { throw new Error('boom2'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Fred(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing valueOf and no toString by stringifying it', () => {
  class Plugh { valueOf() { throw new Error('boom'); } }
  assert.deepStrictEqual(groupByEvidence([{ evidence: new Plugh(), issueId: 'i1' }]), [{ evidence: "[object Object]", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing toString and no valueOf by stringifying it', () => {
  class Xyzzy { toString() { throw new Error('boom'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Xyzzy(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive and toString by stringifying it', () => {
  class Thud { [Symbol.toPrimitive]() { throw new Error('boom'); } toString() { return 'ts'; } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive and valueOf by stringifying it', () => {
  class Thud2 { [Symbol.toPrimitive]() { throw new Error('boom'); } valueOf() { return 42; } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud2(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf by stringifying it', () => {
  class Thud3 { [Symbol.toPrimitive]() { throw new Error('boom'); } toString() { return 'ts'; } valueOf() { return 42; } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud3(), issueId: 'i1' }]), { name: 'Error', message: 'boom' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where toString throws first by stringifying it', () => {
  class Thud4 { [Symbol.toPrimitive]() { throw new Error('boom1'); } toString() { throw new Error('boom2'); } valueOf() { return 42; } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud4(), issueId: 'i1' }]), { name: 'Error', message: 'boom1' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where valueOf throws first by stringifying it', () => {
  class Thud5 { [Symbol.toPrimitive]() { throw new Error('boom1'); } toString() { return 'ts'; } valueOf() { throw new Error('boom2'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud5(), issueId: 'i1' }]), { name: 'Error', message: 'boom1' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where both toString and valueOf throw by stringifying it', () => {
  class Thud6 { [Symbol.toPrimitive]() { throw new Error('boom1'); } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud6(), issueId: 'i1' }]), { name: 'Error', message: 'boom1' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive does not throw by stringifying it', () => {
  class Thud7 { [Symbol.toPrimitive]() { return 'sp'; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.deepEqual(groupByEvidence([{ evidence: new Thud7(), issueId: 'i1' }]), [{ evidence: "sp", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns a number by stringifying it', () => {
  class Thud8 { [Symbol.toPrimitive]() { return 42; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.deepEqual(groupByEvidence([{ evidence: new Thud8(), issueId: 'i1' }]), [{ evidence: "42", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns a boolean by stringifying it', () => {
  class Thud9 { [Symbol.toPrimitive]() { return true; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.deepEqual(groupByEvidence([{ evidence: new Thud9(), issueId: 'i1' }]), [{ evidence: "true", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns a bigint by stringifying it', () => {
  class Thud10 { [Symbol.toPrimitive]() { return 42n; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.deepEqual(groupByEvidence([{ evidence: new Thud10(), issueId: 'i1' }]), [{ evidence: "42", issueIds: ["i1"], unusable: false, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns a symbol by stringifying it', () => {
  class Thud11 { [Symbol.toPrimitive]() { return Symbol('s'); } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud11(), issueId: 'i1' }]), { name: 'TypeError', message: 'Cannot convert a Symbol value to a string' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns an object by stringifying it', () => {
  class Thud12 { [Symbol.toPrimitive]() { return {}; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud12(), issueId: 'i1' }]), { name: 'TypeError', message: 'Cannot convert object to primitive value' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns null by stringifying it', () => {
  class Thud13 { [Symbol.toPrimitive]() { return null; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.deepStrictEqual(groupByEvidence([{ evidence: new Thud13(), issueId: 'i1' }]), [{ evidence: "null", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns undefined by stringifying it', () => {
  class Thud14 { [Symbol.toPrimitive]() { return undefined; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.deepStrictEqual(groupByEvidence([{ evidence: new Thud14(), issueId: 'i1' }]), [{ evidence: "undefined", issueIds: ["i1"], unusable: true, sha: null }]);
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns a function by stringifying it', () => {
  class Thud15 { [Symbol.toPrimitive]() { return () => {}; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud15(), issueId: 'i1' }]), { name: 'TypeError', message: 'Cannot convert object to primitive value' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns an array by stringifying it', () => {
  class Thud16 { [Symbol.toPrimitive]() { return [1, 2]; } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud16(), issueId: 'i1' }]), { name: 'TypeError', message: 'Cannot convert object to primitive value' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns a map by stringifying it', () => {
  class Thud17 { [Symbol.toPrimitive]() { return new Map(); } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud17(), issueId: 'i1' }]), { name: 'TypeError', message: 'Cannot convert object to primitive value' });
});

test('handles a closure whose evidence is a class instance with a throwing symbol to primitive, toString, and valueOf where symbol to primitive returns a set by stringifying it', () => {
  class Thud18 { [Symbol.toPrimitive]() { return new Set(); } toString() { throw new Error('boom2'); } valueOf() { throw new Error('boom3'); } }
  assert.throws(() => groupByEvidence([{ evidence: new Thud18(), issueId: 'i1' }]), { name: 'TypeError', message: 'Cannot convert object to primitive value' });
});

// Builds an unmeasured error envelope with a fixed schema and remedy (lib/stack-client.mjs unmeasured).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unmeasured } from '../stack-client.mjs';

test('returns ok false and schemaVersion 1 for a basic unmeasured call', () => {
  const r = unmeasured('route-a', 'cause-a', 'msg-a');
  assert.deepEqual(r, { ok: false, route: "route-a", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-a", message: "msg-a", detail: null, remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});

test('uses the default remedy when the options object is omitted', () => {
  const r = unmeasured('route-b', 'cause-b', 'msg-b');
  assert.deepEqual(r, { ok: false, route: "route-b", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-b", message: "msg-b", detail: null, remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});

test('uses the provided remedy when options include a custom remedy', () => {
  const r = unmeasured('route-c', 'cause-c', 'msg-c', { remedy: 'custom-remedy' });
  assert.deepEqual(r, { ok: false, route: "route-c", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-c", message: "msg-c", detail: null, remedy: "custom-remedy" }, partial: null });
});

test('includes the provided detail in the error object', () => {
  const r = unmeasured('route-d', 'cause-d', 'msg-d', { detail: { key: 'value' } });
  assert.deepEqual(r, { ok: false, route: "route-d", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-d", message: "msg-d", detail: { key: "value" }, remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});

test('sets detail to null when options are empty', () => {
  const r = unmeasured('route-e', 'cause-e', 'msg-e', {});
  assert.deepEqual(r, { ok: false, route: "route-e", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-e", message: "msg-e", detail: null, remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});

test('sets detail to null when options include only remedy', () => {
  const r = unmeasured('route-f', 'cause-f', 'msg-f', { remedy: 'r' });
  assert.deepEqual(r, { ok: false, route: "route-f", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-f", message: "msg-f", detail: null, remedy: "r" }, partial: null });
});

test('sets detail to null when options include only detail', () => {
  const r = unmeasured('route-g', 'cause-g', 'msg-g', { detail: 'd' });
  assert.deepEqual(r, { ok: false, route: "route-g", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-g", message: "msg-g", detail: "d", remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});

test('handles long route and message strings without truncation', () => {
  const route = 'x'.repeat(100);
  const message = 'y'.repeat(100);
  const r = unmeasured(route, 'cause-h', message);
  assert.deepEqual(r, { ok: false, route: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "cause-h", message: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", detail: null, remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});

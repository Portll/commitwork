// Creates a CDP page session with console/error capture, evaluation, and navigation helpers (lib/cdp.mjs newPage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPage } from '../cdp.mjs';

const mkConn = (handlers) => {
  const listeners = [];
  const conn = {
    send: async (method, params, sessionId) => {
      for (const h of handlers) {
        const r = h(method, params, sessionId);
        if (r !== undefined) return r;
      }
      return {};
    },
    on: (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    emit: (m) => { for (const fn of [...listeners]) fn(m); }
  };
  return conn;
};

test('attachToTarget uses flatten true', async () => {
  const conn = mkConn([
    (m, p) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m, p) => m === 'Target.attachToTarget' ? (p.flatten === true ? { sessionId: 's1' } : { sessionId: 'sX' }) : undefined,
    (m, p, s) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p, s) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined
  ]);
  const result = await newPage(conn);
  assert.equal(result.sessionId, 's1');
});

test('console lines capture args with values', async () => {
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined
  ]);
  const result = await newPage(conn);
  conn.emit({ sessionId: 's1', method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ value: 'hello' }, { value: 'world' }] } });
  assert.deepEqual(result.consoleLines, [{ type: 'log', text: 'hello world' }]);
});

test('console lines handle missing args array', async () => {
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined
  ]);
  const result = await newPage(conn);
  conn.emit({ sessionId: 's1', method: 'Runtime.consoleAPICalled', params: { type: 'log' } });
  assert.deepEqual(result.consoleLines, [{ type: 'log', text: '' }]);
});

test('errors capture exception description', async () => {
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined
  ]);
  const result = await newPage(conn);
  conn.emit({ sessionId: 's1', method: 'Runtime.exceptionThrown', params: { exceptionDetails: { exception: { description: 'boom' } } } });
  assert.deepEqual(result.errors, ['boom']);
});

test('errors fall back to uncaught exception when no description', async () => {
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined
  ]);
  const result = await newPage(conn);
  conn.emit({ sessionId: 's1', method: 'Runtime.exceptionThrown', params: { exceptionDetails: { exception: {} } } });
  assert.deepEqual(result.errors, ['uncaught exception']);
});

test('selfWitness passes when evaluate returns the token', async () => {
  const extractToken = (expr) => {
    const m = expr.match(/^\(\"(.*)\"\)$/);
    return m ? m[1] : null;
  };
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => {
      if (m === 'Runtime.evaluate') {
        const token = extractToken(p.expression);
        if (token) return { result: { value: token } };
        return { result: { value: p.expression } };
      }
      return undefined;
    }
  ]);
  const result = await newPage(conn);
  const ok = await result.selfWitness();
  assert.equal(ok, true);
});

test('setCookie throws when success is false', async () => {
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined,
    (m, p) => m === 'Network.setCookie' ? { success: false } : undefined
  ]);
  const result = await newPage(conn);
  await assert.rejects(() => result.setCookie({ name: 'x' }), { name: 'Error', message: 'cdp: Network.setCookie refused x' });
});

test('setViewport sends mobile false by default', async () => {
  let captured;
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined,
    (m, p) => { if (m === 'Emulation.setDeviceMetricsOverride') captured = p; return {}; }
  ]);
  const result = await newPage(conn);
  await result.setViewport({ width: 100, height: 200 });
  assert.deepEqual(captured, { width: 100, height: 200, deviceScaleFactor: 1, mobile: false });
});

test('goto resolves loaded true when loadEventFired fires', async () => {
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: p.expression } } : undefined,
    (m) => m === 'Page.navigate' ? {} : undefined
  ]);
  const result = await newPage(conn);
  const p = result.goto('http://x', { waitMs: 100 });
  conn.emit({ sessionId: 's1', method: 'Page.loadEventFired' });
  const r = await p;
  assert.deepEqual(r, { loaded: true });
});

test('click returns true when element exists', async () => {
  const conn = mkConn([
    (m) => m === 'Target.createTarget' ? { targetId: 't1' } : undefined,
    (m) => m === 'Target.attachToTarget' ? { sessionId: 's1' } : undefined,
    (m) => (m === 'Page.enable' || m === 'Runtime.enable' || m === 'Network.enable') ? {} : undefined,
    (m, p) => m === 'Runtime.evaluate' ? { result: { value: true } } : undefined
  ]);
  const result = await newPage(conn);
  const r = await result.click('#btn');
  assert.equal(r, true);
});

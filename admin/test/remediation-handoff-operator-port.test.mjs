// POST /api/remediation/handoff with engine 'claude' starts an agent in the repository (a runner
// dispatch or a Terminal `claude`). Review 2026-10-07 D9: it was gated only by session and CSRF, while
// /api/issue/claude, which starts the same session, is operator-port only. Driven through the handler:
// nothing here can launch anything, because every refusal and the control both stop before the ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../routes/remediation.mjs';

const route = routes.find((r) => r.method === 'POST' && r.path === '/api/remediation/handoff');

const call = (body, { loopback }) => new Promise((resolve) => {
  route.handle({
    req: {}, isLoopbackReq: loopback, knownProjects: () => new Set(),
    readJsonBody: (_req, cb) => cb(body, null),
    send: (status, payload) => resolve({ status, body: payload }),
  });
});

test('off the operator port, starting a Claude session is a 403 that names the operator port', async () => {
  const saved = process.env.CW_ADMIN_LOCAL_PORT;
  process.env.CW_ADMIN_LOCAL_PORT = '17879';
  try {
    for (const loopback of [false, undefined]) {
      const r = await call({ check: 'secrets-gitleaks', project: 'Alpha', engine: 'claude' }, { loopback });
      assert.equal(r.status, 403, `isLoopbackReq=${loopback} was let through`);
      assert.equal(r.body.localOnly, true);
      assert.match(r.body.error, /operator port, http:\/\/127\.0\.0\.1:17879/);
    }
  } finally { if (saved === undefined) delete process.env.CW_ADMIN_LOCAL_PORT; else process.env.CW_ADMIN_LOCAL_PORT = saved; }
});

test('NOT VACUOUS: on the operator port the same request passes the gate and meets the next check', async () => {
  const r = await call({ check: 'secrets-gitleaks', project: 'not-a-project', engine: 'claude' }, { loopback: true });
  assert.notEqual(r.status, 403);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /handoff is filed under its project's reports/);
});

test('a local-model triage starts no agent, so the published port is not refused by this gate', async () => {
  const r = await call({ check: 'secrets-gitleaks', project: 'not-a-project', engine: 'not-an-engine' }, { loopback: false });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /engine must be one of/);
});

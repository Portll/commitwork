// admin/routes/remediation-policy.mjs — direct-handler tests (no server spawn). Session-gated
// read/write of the policy store, same 400/409/503 ladder as the products wizard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/remediation-policy.mjs';

const route = (method, p) => routes.find((r) => r.method === method && r.path === p);
function invoke(r, { session = null, body = undefined } = {}) {
  let out;
  r.handle({
    req: {}, adminSession: () => session,
    send: (code, b) => { out = { code, body: b }; },
    readJsonBody: (req, cb) => cb(body, null),
  });
  return out;
}
const SESSION = { user: 'op@example.test' };
const TMP = mkdtempSync(join(tmpdir(), 'cw-rempol-route-'));
const POLICY = join(TMP, 'policy.json');
process.env.CW_REMEDIATION_POLICY = POLICY;
// the real reports/ witness may be fresh on this box; these tests decide their own
const WITNESS = join(TMP, 'corpus-live.json');
process.env.CW_STPA_ENVELOPE_WITNESS = WITNESS;

test('both routes refuse without a session (401)', () => {
  assert.equal(invoke(route('GET', '/api/remediation-policy'), { session: null }).code, 401);
  assert.equal(invoke(route('POST', '/api/remediation-policy'), { session: null, body: { policy: {} } }).code, 401);
});

test('GET returns the effective policy (defaults when no file) + the enum lists', () => {
  rmSync(POLICY, { force: true });
  const out = invoke(route('GET', '/api/remediation-policy'), { session: SESSION });
  assert.equal(out.code, 200);
  assert.equal(out.body.policy.mode, 'report');
  assert.equal(out.body.hash, null);
  assert.ok(out.body.enums.mode.includes('full-agentic'));
  assert.ok(out.body.enums.cadence.includes('quarterly'));
});

test('POST: create → 200 + hash; GET round-trips; 409 stale · 400 invalid · 503 corrupt', () => {
  rmSync(POLICY, { force: true });
  const good = { mode: 'hitl-item', verification: 'single', learning: 'on', cadence: 'weekly', remediationBudgetPctOfCompute: 10 };
  const created = invoke(route('POST', '/api/remediation-policy'), { session: SESSION, body: { policy: good, baseHash: null } });
  assert.equal(created.code, 200, JSON.stringify(created.body));
  assert.match(created.body.hash, /^[0-9a-f]{64}$/);

  const got = invoke(route('GET', '/api/remediation-policy'), { session: SESSION });
  assert.equal(got.body.policy.mode, 'hitl-item');
  assert.equal(got.body.policy.learning, 'on');
  assert.equal(got.body.hash, created.body.hash);

  assert.equal(invoke(route('POST', '/api/remediation-policy'), { session: SESSION, body: { policy: good, baseHash: 'stale' } }).code, 409);
  assert.equal(invoke(route('POST', '/api/remediation-policy'), { session: SESSION, body: { policy: { mode: 'yolo' }, baseHash: created.body.hash } }).code, 400);

  writeFileSync(POLICY, '{ nope');
  assert.equal(invoke(route('POST', '/api/remediation-policy'), { session: SESSION, body: { policy: good, baseHash: null } }).code, 503);
});

// ── authority: what this route may NOT set ────────────────────────────────────────────────────
// A session cookie is not an authority step — escalation stays a deliberate human edit of the file.
test('POST refuses to ESCALATE the mode over the API (403), and says where to do it instead', () => {
  rmSync(POLICY, { force: true });
  for (const mode of ['hitl-agentic', 'full-agentic']) {
    const r = invoke(route('POST', '/api/remediation-policy'), { session: SESSION, body: { policy: { mode }, baseHash: null } });
    assert.equal(r.code, 403, `${mode} must not be settable over the API: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, /monitor\/remediation-policy\.json/, 'the refusal must name where the change belongs');
    assert.deepEqual(r.body.settableModes, ['report', 'hitl-item']);
  }
});

test('POST refuses m3.autoMerge=true over the API (403) — authoring is not merging', () => {
  rmSync(POLICY, { force: true });
  const r = invoke(route('POST', '/api/remediation-policy'), {
    session: SESSION,
    body: { policy: { mode: 'hitl-item', m3: { autoMerge: true } }, baseHash: null },
  });
  assert.equal(r.code, 403, JSON.stringify(r.body));
});

test('a mode that is not a mode is MALFORMED (400), not forbidden (403)', () => {
  // 403 says the value was recognised and declined on authority grounds; `yolo` was never a mode.
  rmSync(POLICY, { force: true });
  const r = invoke(route('POST', '/api/remediation-policy'), { session: SESSION, body: { policy: { mode: 'yolo' }, baseHash: null } });
  assert.equal(r.code, 400, JSON.stringify(r.body));
});

test('DE-escalation is always allowed — reducing authority needs no ceremony', () => {
  rmSync(POLICY, { force: true });
  writeFileSync(POLICY, JSON.stringify({ mode: 'full-agentic' }));  // however it got there
  const { code, body } = invoke(route('GET', '/api/remediation-policy'), { session: SESSION });
  assert.equal(code, 200);
  const down = invoke(route('POST', '/api/remediation-policy'), {
    session: SESSION, body: { policy: { mode: 'report' }, baseHash: body.hash },
  });
  assert.equal(down.code, 200, JSON.stringify(down.body));
  assert.equal(invoke(route('GET', '/api/remediation-policy'), { session: SESSION }).body.policy.mode, 'report');
});

// ── the corpus-replay witness: the agentic modes' precondition for THIS run ──────────────────
test('GET on a file declaring an agentic mode still answers 200 (so it can be de-escalated) and reports the witness refusal', () => {
  rmSync(POLICY, { force: true }); rmSync(WITNESS, { force: true });
  writeFileSync(POLICY, JSON.stringify({ mode: 'full-agentic' }));
  const { code, body } = invoke(route('GET', '/api/remediation-policy'), { session: SESSION });
  assert.equal(code, 200);
  assert.equal(body.policy.mode, 'full-agentic', 'the declared mode is shown, not silently demoted');
  assert.equal(body.agentic.ok, false);
  assert.equal(body.agentic.witness.state, 'absent');
  assert.match(body.agentic.errors[0], /mode=full-agentic is refused: .*absent/);
  writeFileSync(WITNESS, JSON.stringify({ pass: true, at: new Date().toISOString() }));
  const ok = invoke(route('GET', '/api/remediation-policy'), { session: SESSION }).body.agentic;
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.witness.state, 'fresh');
});

test('the escalation 403 carries the witness reason for this run alongside the authority refusal', () => {
  rmSync(POLICY, { force: true }); rmSync(WITNESS, { force: true });
  const r = invoke(route('POST', '/api/remediation-policy'), { session: SESSION, body: { policy: { mode: 'hitl-agentic' }, baseHash: null } });
  assert.equal(r.code, 403);
  assert.equal(r.body.agentic.ok, false);
  assert.equal(r.body.agentic.witness.state, 'absent');
  assert.match(r.body.error, /refused for this run: mode=hitl-agentic is refused: .*absent/);
});

test('the stored mode cannot smuggle an escalation — the ASKED-FOR state is what is judged', () => {
  // A file already above the line must not license another over-the-line write.
  rmSync(POLICY, { force: true });
  writeFileSync(POLICY, JSON.stringify({ mode: 'full-agentic' }));
  const { body } = invoke(route('GET', '/api/remediation-policy'), { session: SESSION });
  const r = invoke(route('POST', '/api/remediation-policy'), {
    session: SESSION, body: { policy: { mode: 'hitl-agentic' }, baseHash: body.hash },
  });
  assert.equal(r.code, 403, JSON.stringify(r.body));
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));

// The Packages section's endpoints — the load-bearing assertion is the gate: apply off the
// operator port is refused and names where the action IS available. Routes driven through their
// exported `handle` with a fake `send` (fetch silently drops a set Host header; wire tests need node:http).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes, APPLY, NOT_APPLYABLE, startApply } from '../routes/packages.mjs';

const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const capture = () => {
  const out = {};
  return { out, send: (status, body) => { out.status = status; out.body = body; return out; } };
};
const call = async (r, ctx = {}) => {
  const c = capture();
  await r.handle({ send: c.send, url: new URL('http://x/api/packages'), readJsonBody: async () => ({}), ...ctx });
  return c.out;
};

test('the three routes are registered at the paths the page expects', () => {
  assert.ok(route('GET', '/api/packages'));
  assert.ok(route('POST', '/api/packages/apply'));
  assert.ok(route('GET', '/api/packages/jobs'));
  assert.equal(routes.length, 3, 'a fourth route is a new surface — decide its gate deliberately');
});

// ── THE GATE ───────────────────────────────────────────────────────────────────────────────────
test('apply REFUSES off the operator port, and names where it is available', async () => {
  const r = await call(route('POST', '/api/packages/apply'), { isLoopbackReq: false, readJsonBody: async () => ({ manager: 'brew' }) });
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /operator port/, 'a 403 that does not say where the action IS available reads as broken');
  assert.match(r.body.error, /127\.0\.0\.1/);
  assert.match(r.body.error, /external even when you are sitting at the box/,
    'the published port is external even from the operator chair — the message must not imply otherwise');
});

// A 403 that misdirects is worse than one that says nothing — it must name a port this server binds.
test('the refusal names the operator port this server actually has', async () => {
  const before = { p: process.env.CW_ADMIN_PORT, l: process.env.CW_ADMIN_LOCAL_PORT };
  try {
    delete process.env.CW_ADMIN_LOCAL_PORT;
    process.env.CW_ADMIN_PORT = '7890';
    let r = await call(route('POST', '/api/packages/apply'), { isLoopbackReq: false, readJsonBody: async () => ({ manager: 'brew' }) });
    assert.match(r.body.error, /127\.0\.0\.1:7891/, 'the default operator port is PORT + 1, mirroring serve.mjs');
    assert.doesNotMatch(r.body.error, /7879/, 'a port this server never binds must never be advertised');

    process.env.CW_ADMIN_LOCAL_PORT = '9999';
    r = await call(route('POST', '/api/packages/apply'), { isLoopbackReq: false, readJsonBody: async () => ({ manager: 'brew' }) });
    assert.match(r.body.error, /127\.0\.0\.1:9999/, 'an explicit CW_ADMIN_LOCAL_PORT must win, and be read at CALL time');
  } finally {
    if (before.p === undefined) delete process.env.CW_ADMIN_PORT; else process.env.CW_ADMIN_PORT = before.p;
    if (before.l === undefined) delete process.env.CW_ADMIN_LOCAL_PORT; else process.env.CW_ADMIN_LOCAL_PORT = before.l;
  }
});

test('job logs are operator-port only — they are the output of commands run on this machine', async () => {
  const r = await call(route('GET', '/api/packages/jobs'), { isLoopbackReq: false });
  assert.equal(r.status, 403);
});

test('the inventory IS available off the operator port, in the published shape', async () => {
  const r = await call(route('GET', '/api/packages'), { isLoopbackReq: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.published, true, 'the published port must get the redacted shape, not the full one');
  assert.equal(r.body.applyable, undefined, 'the published payload must not advertise apply targets');
  assert.equal(r.body.jobs, undefined, 'nor job state');
});

test('the operator port gets the full shape, the apply list, and the unknown managers named', async () => {
  const r = await call(route('GET', '/api/packages'), { isLoopbackReq: true });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.published, true);
  assert.deepEqual(r.body.applyable, Object.keys(APPLY));
  assert.ok(Array.isArray(r.body.unknownManagers),
    'managers that could not be asked are named so the page can render them as UNKNOWN rather than green');
  assert.ok(Array.isArray(r.body.jobs));
});

// ── WHAT MAY BE APPLIED ────────────────────────────────────────────────────────────────────────
test('softwareupdate has NO apply path, and says why rather than 404ing', () => {
  assert.equal(APPLY.softwareupdate, undefined);
  assert.match(NOT_APPLYABLE.softwareupdate, /reboot/);
  const r = startApply('softwareupdate');
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /reboot/, 'the refusal must carry the reason, not just decline');
});

test('the toolchain has no apply path either — no single safe upgrade for a system interpreter', () => {
  assert.equal(APPLY.toolchain, undefined);
  assert.match(NOT_APPLYABLE.toolchain, /system interpreter/);
  assert.equal(startApply('toolchain').ok, false);
});

test('an unknown manager runs nothing', () => {
  for (const bad of ['', 'rm', '../../etc', 'brew; rm -rf /']) {
    const r = startApply(bad);
    assert.equal(r.ok, false, `startApply(${JSON.stringify(bad)}) must refuse`);
    assert.match(r.error, /nothing was run|unknown manager/);
  }
});

// The request names a MANAGER and nothing else — no caller input reaches a command line.
test('apply commands are a fixed allowlist of argv arrays — no shell, no caller-supplied string', () => {
  for (const [name, spec] of Object.entries(APPLY)) {
    assert.ok(Array.isArray(spec.args), `${name} must carry argv as an array, never a command string`);
    assert.match(spec.bin, /^[a-z][a-z0-9-]*$/, `${name}'s binary must be a bare name, not a path or an expression`);
    for (const a of spec.args) {
      assert.match(a, /^[a-z0-9@/._-]+$/i, `${name} arg ${JSON.stringify(a)} must be a literal, not an interpolation`);
    }
  }
});

test('a malformed body is refused before anything runs', async () => {
  const r = await call(route('POST', '/api/packages/apply'), {
    isLoopbackReq: true,
    readJsonBody: async () => { throw new Error('bad json'); },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /nothing was run/);
});

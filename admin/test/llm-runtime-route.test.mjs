// fact: turning a runner on is an escalation and the response names it / three of seven declared hosts bind 0.0.0.0 by default and four fetch models on demand, so "enabled localai" and "enabled llama.cpp" are different acts (expiry: never, prev: not built)

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/llm-runtime.mjs';
import { loadLlmHosts } from '../../monitor/llm-hosts.mjs';

const decl = loadLlmHosts();
const GET = routes.find((r) => r.method === 'GET');
const PUT = routes.find((r) => r.method === 'PUT');

let TMP, saved;

// A minimal ctx: the route only needs a session, a body reader and a send sink.
function ctx({ session = { user: 'op' }, body = null } = {}) {
  const out = {};
  return {
    ctx: {
      req: {},
      adminSession: () => session,
      readJsonBody: async () => { if (body === 'BAD') throw new Error('nope'); return body; },
      send: (status, payload) => { out.status = status; out.payload = payload; return out; },
    },
    out,
  };
}

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cw-llm-runtime-route-'));
  saved = process.env.CW_LLM_RUNTIME;
  process.env.CW_LLM_RUNTIME = join(TMP, 'llm-runtime.json');
});
after(() => {
  if (saved === undefined) delete process.env.CW_LLM_RUNTIME; else process.env.CW_LLM_RUNTIME = saved;
  rmSync(TMP, { recursive: true, force: true });
});

describe('GET /api/llm/runtime', () => {
  test('unauthenticated is 401 — the catalogue names ports and exposure', async () => {
    const { ctx: c, out } = ctx({ session: null });
    await GET.handle(c);
    assert.equal(out.status, 401);
  });

  test('with no store: reports DISABLED, and every host carries the facts to decide by', async () => {
    const { ctx: c, out } = ctx();
    await GET.handle(c);
    assert.equal(out.status, 200);
    assert.equal(out.payload.posture.enabled, false, 'default off — operator ruling 2026-08-27');
    assert.equal(out.payload.state.state, 'disabled');
    assert.equal(out.payload.hash, null, 'no store yet, so nothing to compare against');

    for (const h of out.payload.hosts) {
      assert.equal(typeof h.bindsAllInterfacesByDefault, 'boolean', `${h.id} must state its bind posture`);
      assert.equal(typeof h.fetchesModelsOnDemand, 'boolean', `${h.id} must state whether a request can cause egress`);
      assert.ok(h.reach, `${h.id} must carry its LIVE reach, not a declared one`);
    }
    assert.deepEqual(out.payload.reachOrder, ['local', 'lan', 'hosted']);
  });

  test('a corrupt store is 503, never a silent all-off default', async () => {
    writeFileSync(process.env.CW_LLM_RUNTIME, '{ broken');
    const { ctx: c, out } = ctx();
    await GET.handle(c);
    assert.equal(out.status, 503);
    assert.match(out.payload.error, /unreadable|refusing/);
    rmSync(process.env.CW_LLM_RUNTIME);
  });
});

describe('PUT /api/llm/runtime', () => {
  test('an invalid posture is 400 and nothing is written', async () => {
    const { ctx: c, out } = ctx({ body: { enabled: true, hosts: { ghost: { enabled: true } }, hash: null } });
    await PUT.handle(c);
    assert.equal(out.status, 400);
    assert.match(out.payload.error, /not a declared host/);
    assert.equal(existsSync(process.env.CW_LLM_RUNTIME), false, 'a refused write leaves no store');
  });

  test('enabling a 0.0.0.0-binding, model-fetching host is ACCEPTED and NAMED', async () => {
    // The point of the route. The operator asked for per-host selection, so this is not refused —
    // but "you enabled localai" and "you enabled llama.cpp" are different acts and the response
    // says which one happened. Silence here would make the exposure invisible at the only moment
    // anybody is looking at it.
    const exposed = decl.hosts.find((h) => h.bindsAllInterfacesByDefault && h.fetchesModelsOnDemand);
    assert.ok(exposed, 'the declaration must still contain an exposed host for this to test anything');

    const { ctx: c, out } = ctx({
      body: { enabled: true, hosts: { [exposed.id]: { enabled: true, model: 'm' } }, roles: {}, hash: null },
    });
    await PUT.handle(c);
    assert.equal(out.status, 200);
    assert.ok(out.payload.warnings.length >= 2, 'both the bind and the fetch exposure are named');
    assert.ok(out.payload.warnings.some((w) => /all interfaces/.test(w)));
    assert.ok(out.payload.warnings.some((w) => /fetches models on demand/.test(w)));
    assert.ok(out.payload.hash, 'a written store has a hash to compare-and-swap against');
  });

  test('enabling a loopback-only host that does not fetch produces NO warning — the signal is not noise', async () => {
    const quiet = decl.hosts.find((h) => !h.bindsAllInterfacesByDefault && !h.fetchesModelsOnDemand);
    assert.ok(quiet, 'at least one host must be quiet, or the warning means nothing');
    const cur = readFileSync(process.env.CW_LLM_RUNTIME, 'utf8');
    const { sha256 } = await import('../../cra/lib.mjs');

    const { ctx: c, out } = ctx({
      body: { enabled: true, hosts: { [quiet.id]: { enabled: true, model: 'm' } }, roles: {}, hash: sha256(cur) },
    });
    await PUT.handle(c);
    assert.equal(out.status, 200);
    assert.deepEqual(out.payload.warnings, [], `${quiet.id} is loopback-only and fetches nothing`);
  });

  test('a stale hash is 409 — two panels cannot clobber each other', async () => {
    const { ctx: c, out } = ctx({
      body: { enabled: true, hosts: {}, roles: {}, hash: 'a-hash-from-some-earlier-read' },
    });
    await PUT.handle(c);
    assert.equal(out.status, 409);
    assert.match(out.payload.error, /changed since you read it/);
    assert.ok(out.payload.hash, 'the current hash comes back so the client can reload and retry');
  });

  test('disabling needs no ceremony and clears every role', async () => {
    const { sha256 } = await import('../../cra/lib.mjs');
    const cur = readFileSync(process.env.CW_LLM_RUNTIME, 'utf8');
    const { ctx: c, out } = ctx({ body: { enabled: false, hosts: {}, roles: {}, hash: sha256(cur) } });
    await PUT.handle(c);
    assert.equal(out.status, 200);
    assert.equal(out.payload.state.state, 'disabled');
    assert.deepEqual(out.payload.warnings, [], 'de-escalation warns about nothing');
    for (const r of ['a', 'b', 'adjudicator']) {
      assert.equal(out.payload.roles[r], null, 'the master switch outranks any per-host enable');
    }
  });
});

describe('loopback enforcement', () => {
  test('enabling an off-loopback host is REFUSED at the door, and the refusal is actionable', async () => {
    const prev = process.env.CW_LLM_URL_VLLM;
    process.env.CW_LLM_URL_VLLM = 'http://192.168.1.50:8000';
    try {
      const { sha256 } = await import('../../cra/lib.mjs');
      const cur = existsSync(process.env.CW_LLM_RUNTIME) ? readFileSync(process.env.CW_LLM_RUNTIME, 'utf8') : null;
      const { ctx: c, out } = ctx({
        body: { enabled: true, hosts: { vllm: { enabled: true, model: 'm' } }, roles: {}, hash: cur ? sha256(cur) : null },
      });
      await PUT.handle(c);
      assert.equal(out.status, 400, 'not stored-then-ignored — refused');
      assert.match(out.payload.error, /has not been allowed off loopback/);
      // Actionable: the client is handed the exact URL to allow, resolved SERVER-side, so consent
      // and enforcement are talking about the same address.
      assert.equal(out.payload.allowable[0].id, 'vllm');
      assert.equal(out.payload.allowable[0].url, 'http://192.168.1.50:8000');
    } finally {
      if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
    }
  });

  test('with the exact address allowed it is accepted, and the egress is NAMED', async () => {
    const prev = process.env.CW_LLM_URL_VLLM;
    process.env.CW_LLM_URL_VLLM = 'http://192.168.1.50:8000';
    try {
      const { sha256 } = await import('../../cra/lib.mjs');
      const cur = existsSync(process.env.CW_LLM_RUNTIME) ? readFileSync(process.env.CW_LLM_RUNTIME, 'utf8') : null;
      const { ctx: c, out } = ctx({
        body: {
          enabled: true,
          hosts: { vllm: { enabled: true, model: 'm' } },
          roles: {},
          allowNonLoopback: { vllm: 'http://192.168.1.50:8000' },
          hash: cur ? sha256(cur) : null,
        },
      });
      await PUT.handle(c);
      assert.equal(out.status, 200);
      assert.ok(out.payload.warnings.some((w) => /allowed OFF LOOPBACK/.test(w)),
        'traffic leaving the machine is the loudest thing on the response');
      assert.equal(out.payload.state.state, 'enabled');
    } finally {
      if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
    }
  });

  test('an allow for a DIFFERENT address does not carry over', async () => {
    const prev = process.env.CW_LLM_URL_VLLM;
    process.env.CW_LLM_URL_VLLM = 'https://vllm.example.com';
    try {
      const { sha256 } = await import('../../cra/lib.mjs');
      const cur = readFileSync(process.env.CW_LLM_RUNTIME, 'utf8');
      const { ctx: c, out } = ctx({
        body: {
          enabled: true,
          hosts: { vllm: { enabled: true, model: 'm' } },
          roles: {},
          allowNonLoopback: { vllm: 'http://192.168.1.50:8000' },
          hash: sha256(cur),
        },
      });
      await PUT.handle(c);
      assert.equal(out.status, 400, 'consent for the LAN box is not consent for the internet');
      assert.match(out.payload.error, /consent for one address is not consent for another/);
    } finally {
      if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
    }
  });
});

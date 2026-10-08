// fact: DISABLED is its own state, and it is the one a default-off design gets wrong / a runner that is switched off must never render as "no local LLM detected" — absence of evidence and a measured negative, the distinction this repo refuses to collapse anywhere else (expiry: never, prev: not built)

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  loadPosture,
  validatePosture,
  postureOf,
  activeHosts,
  defaultForRole,
  resolveRoles,
  reachOf,
  DEFAULT_POSTURE,
  ROLES,
} from '../../monitor/llm-runtime.mjs';
import { loadLlmHosts } from '../../monitor/llm-hosts.mjs';

const decl = loadLlmHosts();

function withPosture(doc, fn) {
  const dir = mkdtempSync(resolve(tmpdir(), 'cw-llm-runtime-'));
  const path = resolve(dir, 'llm-runtime.json');
  writeFileSync(path, typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  const prev = process.env.CW_LLM_RUNTIME;
  process.env.CW_LLM_RUNTIME = path;
  try { return fn(path); } finally {
    if (prev === undefined) delete process.env.CW_LLM_RUNTIME;
    else process.env.CW_LLM_RUNTIME = prev;
  }
}

// ── the security default ───────────────────────────────────────────────────────────────────────

test('with no store at all, every runner is OFF', () => {
  const prev = process.env.CW_LLM_RUNTIME;
  process.env.CW_LLM_RUNTIME = resolve(tmpdir(), 'cw-llm-runtime-absent.json');
  try {
    const p = loadPosture();
    assert.equal(p.enabled, false, 'the baseline is off — operator ruling 2026-08-27, security-first');
    assert.deepEqual(activeHosts(p, decl), []);
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_RUNTIME; else process.env.CW_LLM_RUNTIME = prev;
  }
});

test('DISABLED and NONE-ENABLED are different states, and neither is "not detected"', () => {
  // The whole point. A panel that renders all three the same way tells an operator who switched
  // everything off that their machine has no models on it.
  const off = postureOf(DEFAULT_POSTURE, decl);
  assert.equal(off.state, 'disabled');
  assert.match(off.why, /switched off/);

  withPosture({ enabled: true, hosts: {}, roles: {} }, () => {
    const none = postureOf(loadPosture(), decl);
    assert.equal(none.state, 'none-enabled', 'allowed-but-nothing-on is its own state');
    assert.notEqual(none.state, off.state, 'a disabled runner and an unconfigured one are not the same fact');
  });
});

test('the declaration says runners are off by default, and the code agrees with it', () => {
  // Two places could disagree; this is the one that would let them.
  assert.equal(decl.enabledByDefault, false);
  assert.equal(DEFAULT_POSTURE.enabled, decl.enabledByDefault);
});

test('the exposure facts that justify default-off are present and non-trivial', () => {
  // If every host were loopback-only and none fetched models, "off by default" would be caution
  // rather than an argument. This asserts the argument still has evidence behind it.
  const exposed = decl.hosts.filter((h) => h.bindsAllInterfacesByDefault);
  const fetchers = decl.hosts.filter((h) => h.fetchesModelsOnDemand);
  assert.ok(exposed.length >= 1, 'at least one declared host binds every interface out of the box');
  assert.ok(fetchers.length >= 1, 'at least one declared host turns a request into an egress event');
  for (const h of exposed) {
    assert.ok(h.exposureNote && h.exposureNote.length > 40, `${h.id} binds 0.0.0.0 and must say what that costs`);
  }
});

// ── fail closed ────────────────────────────────────────────────────────────────────────────────

test('a corrupt store THROWS rather than degrading to the all-off baseline', () => {
  // The subtle one: the safe baseline IS all-off, so degrading to it on a parse error looks exactly
  // like a working configuration that happens to be off. The operator would see their config
  // silently unapplied with nothing to indicate a problem.
  withPosture('{ not json', () => {
    assert.throws(() => loadPosture(), /unreadable|refusing to fall back/);
  });
});

test('a posture naming an undeclared host is refused, not ignored', () => {
  withPosture({ enabled: true, hosts: { 'not-a-host': { enabled: true, model: 'x' } }, roles: {} }, () => {
    assert.throws(() => loadPosture(), /not a declared host/);
  });
});

test('a role pinned to an undeclared host, or with no model, is refused', () => {
  const { errors: e1 } = validatePosture({ enabled: true, hosts: {}, roles: { a: { host: 'ghost', model: 'm' } } }, decl);
  assert.ok(e1.some((e) => /not a declared host/.test(e)));
  const { errors: e2 } = validatePosture({ enabled: true, hosts: {}, roles: { a: { host: 'lmstudio', model: '' } } }, decl);
  assert.ok(e2.some((e) => /non-empty string/.test(e)));
  const { errors: e3 } = validatePosture({ enabled: true, hosts: {}, roles: { referee: { host: 'lmstudio', model: 'm' } } }, decl);
  assert.ok(e3.some((e) => /is not a role/.test(e)));
});

// ── reach: local first, LAN second, hosted third ───────────────────────────────────────────────

test('reach is classified from the URL, covering the cases that actually appear', () => {
  for (const [url, want] of [
    ['http://127.0.0.1:8080', 'local'],
    ['http://localhost:1234', 'local'],
    ['http://[::1]:8080', 'local'],
    ['http://192.168.1.50:8080', 'lan'],
    ['http://10.0.0.4:8000', 'lan'],
    ['http://172.16.5.9:8080', 'lan'],
    ['http://172.32.5.9:8080', 'hosted'], // just outside the private range — the off-by-one that matters
    ['http://box.local:8080', 'lan'],
    ['https://api.example.com', 'hosted'],
  ]) {
    assert.equal(reachOf(url), want, url);
  }
});

test('an unparseable URL is null — not silently sorted as the least-preferred known thing', () => {
  assert.equal(reachOf('not a url'), null);
});

test('role defaults prefer local, then LAN, then hosted', () => {
  const local = decl.hosts.find((h) => h.id === 'lmstudio');
  const other = decl.hosts.find((h) => h.id === 'vllm');
  const prevA = process.env[`CW_LLM_URL_${other.id.toUpperCase()}`];
  process.env[`CW_LLM_URL_${other.id.toUpperCase()}`] = 'http://192.168.1.50:8000'; // LAN
  try {
    withPosture({
      enabled: true,
      hosts: { [local.id]: { enabled: true, model: 'local-model' }, [other.id]: { enabled: true, model: 'lan-model' } },
      roles: {},
      // The LAN host must be ALLOWED off loopback, or it is blocked and never becomes a candidate —
      // and then "local wins" would pass because it was the only entrant. A one-horse race is not
      // evidence of ordering.
      allowNonLoopback: { [other.id]: 'http://192.168.1.50:8000' },
    }, () => {
      const pick = defaultForRole(loadPosture(), decl);
      assert.equal(pick.reach, 'local', 'a LAN host must never outrank a loopback one');
      assert.equal(pick.host, local.id);
    });
  } finally {
    if (prevA === undefined) delete process.env[`CW_LLM_URL_${other.id.toUpperCase()}`];
    else process.env[`CW_LLM_URL_${other.id.toUpperCase()}`] = prevA;
  }
});

test('a host with no model pinned is not a candidate — the default never reaches for something unconfigured', () => {
  withPosture({ enabled: true, hosts: { lmstudio: { enabled: true, model: null } }, roles: {} }, () => {
    assert.equal(defaultForRole(loadPosture(), decl), null, 'enabled but unpinned is not usable');
  });
});

test('every role resolves, a pin beats the default, and the source is stated', () => {
  withPosture({
    enabled: true,
    hosts: { lmstudio: { enabled: true, model: 'default-model' }, 'llama.cpp': { enabled: true, model: 'pinned-model' } },
    roles: { adjudicator: { host: 'llama.cpp', model: 'pinned-model' } },
  }, () => {
    const roles = resolveRoles(loadPosture(), decl);
    assert.deepEqual(Object.keys(roles).sort(), [...ROLES].sort());
    assert.equal(roles.adjudicator.host, 'llama.cpp');
    assert.equal(roles.adjudicator.source, 'pinned');
    assert.equal(roles.a.source, 'default', 'an unpinned role falls back, and says that it did');
    assert.ok(roles.a.reach, 'a resolved role always carries its reach — the operator can see the hop');
  });
});

test('with the master switch off, no role resolves — an off runner cannot be a default', () => {
  withPosture({ enabled: false, hosts: { lmstudio: { enabled: true, model: 'm' } }, roles: {} }, () => {
    const roles = resolveRoles(loadPosture(), decl);
    assert.ok(ROLES.every((r) => roles[r] === null), 'the master switch outranks a per-host enable');
  });
});

// ── loopback unless specifically allowed ───────────────────────────────────────────────────────

test('a non-loopback host is REFUSED even when switched on', () => {
  const prev = process.env.CW_LLM_URL_VLLM;
  process.env.CW_LLM_URL_VLLM = 'http://192.168.1.50:8000';
  try {
    withPosture({ enabled: true, hosts: { vllm: { enabled: true, model: 'm' } }, roles: {} }, () => {
      const p = loadPosture();
      assert.deepEqual(activeHosts(p, decl), [], 'a LAN address is not usable without consent');
      const st = postureOf(p, decl);
      assert.equal(st.state, 'all-blocked', 'switched on and refused is NOT "none enabled"');
      assert.match(st.why, /has not been allowed off loopback/);
      assert.equal(st.blocked[0].id, 'vllm', 'the refusal names the host and its address');
    });
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
  }
});

test('an explicit allow for THAT address lets it through', () => {
  const prev = process.env.CW_LLM_URL_VLLM;
  process.env.CW_LLM_URL_VLLM = 'http://192.168.1.50:8000';
  try {
    withPosture({
      enabled: true,
      hosts: { vllm: { enabled: true, model: 'm' } },
      roles: {},
      allowNonLoopback: { vllm: 'http://192.168.1.50:8000' },
    }, () => {
      const active = activeHosts(loadPosture(), decl);
      assert.equal(active.length, 1);
      assert.equal(active[0].reach, 'lan');
    });
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
  }
});

test('consent is pinned to the ADDRESS — moving the host revokes it', () => {
  // The case a per-host boolean would have missed, and the reason this stores a URL. Consent given
  // for a machine on your desk must not follow the host id to one on the internet.
  const prev = process.env.CW_LLM_URL_VLLM;
  try {
    process.env.CW_LLM_URL_VLLM = 'https://vllm.example.com';
    withPosture({
      enabled: true,
      hosts: { vllm: { enabled: true, model: 'm' } },
      roles: {},
      allowNonLoopback: { vllm: 'http://192.168.1.50:8000' }, // allowed for the LAN box, not this
    }, () => {
      const st = postureOf(loadPosture(), decl);
      assert.equal(st.state, 'all-blocked');
      assert.match(st.why, /consent for one address is not consent for another/);
    });
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
  }
});

test('a partially-refused set does not look like a whole one', () => {
  const prev = process.env.CW_LLM_URL_VLLM;
  process.env.CW_LLM_URL_VLLM = 'http://192.168.1.50:8000';
  try {
    withPosture({
      enabled: true,
      hosts: { lmstudio: { enabled: true, model: 'm' }, vllm: { enabled: true, model: 'm' } },
      roles: {},
    }, () => {
      const st = postureOf(loadPosture(), decl);
      assert.equal(st.state, 'enabled', 'one host works, so the state is enabled');
      assert.equal(st.hosts.length, 1);
      assert.equal(st.blocked.length, 1, 'and the refused one is still reported, not silently dropped');
      assert.equal(st.blocked[0].id, 'vllm');
    });
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
  }
});

test('an allow must be a URL, not a boolean — the shape that would lose the pinning', () => {
  const { errors } = validatePosture(
    { enabled: true, hosts: {}, roles: {}, allowNonLoopback: { vllm: true } }, decl);
  assert.ok(errors.some((e) => /must be the exact URL that was allowed/.test(e)));
});

test('a blocked host cannot fill a role', () => {
  const prev = process.env.CW_LLM_URL_VLLM;
  process.env.CW_LLM_URL_VLLM = 'http://192.168.1.50:8000';
  try {
    withPosture({ enabled: true, hosts: { vllm: { enabled: true, model: 'm' } }, roles: {} }, () => {
      assert.equal(defaultForRole(loadPosture(), decl), null, 'refused hosts are not candidates');
    });
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_URL_VLLM; else process.env.CW_LLM_URL_VLLM = prev;
  }
});

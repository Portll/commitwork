// fact: the declaration is applied, not merely present / 8 hardcoded base URLs across 3 repos became one row-per-host file, and the loader REFUSES a corrupted copy rather than degrading to an empty host list (expiry: never, prev: not built)
//
// The inventory claims `binding: "validator"` for manifests/llm-hosts.json. That claim is only
// bankable if the guard is proven to REFUSE bad input, which is this repo's stated bar for raising
// the applied-schema floor. Every refusal below was watched failing before it was written down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadLlmHosts,
  hostsInProbeOrder,
  hostsWith,
  identifyByPort,
  baseUrlFor,
  urlEnvVar,
} from '../../monitor/llm-hosts.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE = resolve(REPO, 'manifests', 'llm-hosts.json');

/** Run `fn` against a mutated copy of the live declaration. */
function withMutated(mutate, fn) {
  const dir = mkdtempSync(resolve(tmpdir(), 'cw-llm-hosts-'));
  const path = resolve(dir, 'llm-hosts.json');
  const doc = JSON.parse(readFileSync(LIVE, 'utf8'));
  mutate(doc);
  writeFileSync(path, JSON.stringify(doc, null, 2));
  const prev = process.env.CW_LLM_HOSTS;
  process.env.CW_LLM_HOSTS = path;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_HOSTS;
    else process.env.CW_LLM_HOSTS = prev;
  }
}

test('the LIVE declaration loads and validates', () => {
  const d = loadLlmHosts({ force: true });
  assert.ok(d.hosts.length >= 2);
  assert.equal(d.default, 'llama.cpp', 'the documented default is the MIT one, per the 2026-08-27 ruling');
  assert.ok(
    d.hosts.every((h) => h.api === 'openai'),
    'a host needing another request shape does not belong in this file'
  );
});

test('ollama is RECORDED as removed, not merely absent', () => {
  const d = loadLlmHosts({ force: true });
  const gone = (d.removed || []).find((r) => r.id === 'ollama');
  assert.ok(gone, 'a silent absence reads as an oversight; the removal needs a date and a reason');
  assert.match(gone.removedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!d.hosts.some((h) => h.id === 'ollama'), 'removed means removed from hosts');
});

// --- the refusals. Each was watched failing before it was written down. -------------------------

test('an unreadable declaration THROWS — it never becomes an empty host list', () => {
  const prev = process.env.CW_LLM_HOSTS;
  process.env.CW_LLM_HOSTS = resolve(tmpdir(), 'cw-llm-hosts-does-not-exist.json');
  try {
    assert.throws(() => loadLlmHosts({ force: true }), /could not be read/);
  } finally {
    if (prev === undefined) delete process.env.CW_LLM_HOSTS;
    else process.env.CW_LLM_HOSTS = prev;
  }
});

test('a schema violation is refused — a host without a licence cannot be declared', () => {
  withMutated(
    (d) => {
      delete d.hosts[0].licence;
    },
    () => {
      assert.throws(() => loadLlmHosts({ force: true }), /does not satisfy its schema/);
    }
  );
});

test('a default naming no declared host is refused', () => {
  withMutated(
    (d) => {
      d.default = 'a-host-that-does-not-exist';
    },
    () => {
      assert.throws(() => loadLlmHosts({ force: true }), /is not a declared host/);
    }
  );
});

test('a probeOrder entry naming nothing is refused — it silently shortens detection', () => {
  withMutated(
    (d) => {
      d.probeOrder.push('ghost');
    },
    () => {
      assert.throws(() => loadLlmHosts({ force: true }), /which no host declares/);
    }
  );
});

test('portIsShared is CHECKED against the ports, not trusted', () => {
  // The field decides whether a probe may name a host. A hand-edited `false` on a shared port is
  // exactly how a consumer starts reporting "llama.cpp" for a server it cannot distinguish.
  withMutated(
    (d) => {
      const shared = d.hosts.find((h) => h.portIsShared);
      shared.portIsShared = false;
    },
    () => {
      assert.throws(() => loadLlmHosts({ force: true }), /declares portIsShared=false but port/);
    }
  );
});

// --- the property the whole file exists for --------------------------------------------------

test('a shared port is reported as UNIDENTIFIED, never as the first match', () => {
  const d = loadLlmHosts({ force: true });
  const shared = d.hosts.filter((h) => h.portIsShared);
  assert.ok(shared.length >= 2, 'the 8080 collision is the case this rule exists for');

  const port = new URL(shared[0].baseUrl).port;
  const got = identifyByPort(port, d);
  assert.equal(got.id, null, `:${port} is claimed by ${shared.length} hosts and cannot be named`);
  assert.equal(got.certain, false);
  assert.ok(got.candidates.length >= 2, 'the candidates are still reported — unknown, not silent');

  // And the unshared case still resolves, so the rule is not just "never identify anything".
  const solo = d.hosts.find((h) => !h.portIsShared);
  const soloGot = identifyByPort(new URL(solo.baseUrl).port, d);
  assert.equal(soloGot.id, solo.id);
  assert.equal(soloGot.certain, true);
});

test('an unknown port is unknown, not the default host', () => {
  const got = identifyByPort(65500, loadLlmHosts({ force: true }));
  assert.equal(got.id, null);
  assert.equal(got.certain, false);
});

test('capabilities are declared narrow — nothing assumes /v1/embeddings everywhere', () => {
  const d = loadLlmHosts({ force: true });
  const embedders = hostsWith('embeddings', d).map((h) => h.id);
  const chatters = hostsWith('chat', d).map((h) => h.id);
  assert.ok(chatters.length > embedders.length, 'at least one host serves chat and not embeddings');
  assert.ok(!embedders.includes('mlx-lm'), 'mlx_lm.server has no /v1/embeddings — a caller gets 404');
});

test('probe order is unambiguous-first: the head is a host nobody shares a port with', () => {
  const d = loadLlmHosts({ force: true });
  const first = hostsInProbeOrder(d)[0];
  assert.equal(
    first.portIsShared,
    false,
    'the first probe should be the one whose hit means something definite'
  );
});

test('a base URL is overridable, and the override is read at CALL time', () => {
  const d = loadLlmHosts({ force: true });
  const id = d.hosts[0].id;
  const key = urlEnvVar(id);
  const prev = process.env[key];
  try {
    assert.equal(baseUrlFor(id, d), d.hosts[0].baseUrl);
    process.env[key] = 'http://127.0.0.1:9999';
    assert.equal(baseUrlFor(id, d), 'http://127.0.0.1:9999', 'set AFTER load must still take effect');
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

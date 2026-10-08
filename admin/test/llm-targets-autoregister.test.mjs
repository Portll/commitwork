// G1.1 autoregister — llmTargets() derives the selectable model set from the LIVE probe of every
// declared chat host, with no hardcoded model list. In-process (not via the server) so it doubles as
// the witness that the CW_LLM_URL_<ID> overrides are read at CALL time: the stubs below are set
// AFTER this module imports remediation.mjs, so a module-load read would ignore them and probe real
// localhost — nondeterministic and wrong. explicit uncertainty: a down host stays present as up:false.
//
// Rewritten 2026-08-27 when ollama was removed. It used to stub two engines speaking two different
// protocols (`/api/tags` and `/v1/models`) and pin the pair by name. Hosts now come from
// manifests/llm-hosts.json and all of them speak `/v1/models`, so the test stubs two DECLARED hosts
// and asserts the properties that actually matter — order, presence-when-down, derivation — rather
// than a hardcoded pair it would have to keep in step by hand.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { llmTargets } from '../routes/remediation.mjs';
import { loadLlmHosts, hostsInProbeOrder, urlEnvVar } from '../../monitor/llm-hosts.mjs';
import { writeFileSync as writePosture, mkdtempSync as mkPostureDir } from 'node:fs';
import { tmpdir } from 'node:os';

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// The first two DISTINCT-PORT chat hosts in probe order. Taken from the declaration rather than
// named here, so adding or reordering hosts does not silently leave this test asserting about a
// host nobody probes any more.
const decl = loadLlmHosts();
const chatHosts = hostsInProbeOrder(decl).filter((h) => h.capabilities.includes('chat'));
const seenPorts = new Set();
const DISTINCT = chatHosts.filter((h) => {
  const p = new URL(h.baseUrl).port;
  if (seenPorts.has(p)) return false;
  seenPorts.add(p);
  return true;
});
const [HOST_A, HOST_B] = DISTINCT;

let serverA, portA, serverB, portB, deadPort, deadPort2, savedPosture;
const MODELS_A = ['qwen/qwen3.8-27b', 'text-embedding-nomic-v1.5', 'phi-4'];
const MODELS_B = ['gemma-3-27b', 'qwen3-8b', 'llama-3.2'];

// Every declared host gets an override pointing at a dead port by default, so that a host this test
// does not stub can never reach a real server on the developer's machine and make the run
// nondeterministic. That was a live hazard the moment the host list grew past two.
const saved = new Map();
const setUrl = (id, url) => { process.env[urlEnvVar(id)] = url; };

const openAiStub = (models) => http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
    return;
  }
  res.statusCode = 404; res.end('{}');
});

before(async () => {
  for (const h of chatHosts) saved.set(h.id, process.env[urlEnvVar(h.id)]);

  // Runners are OFF by default now (security-first, 2026-08-27), so this suite opts in explicitly.
  // That IS the behaviour under test elsewhere; here it is setup, and writing it out makes the
  // opt-in visible rather than something the suite inherits from the developer's machine.
  const pdir = mkPostureDir(join(tmpdir(), 'cw-autoreg-posture-'));
  const ppath = join(pdir, 'llm-runtime.json');
  writePosture(ppath, JSON.stringify({
    enabled: true,
    hosts: Object.fromEntries(chatHosts.map((h) => [h.id, { enabled: true, model: null }])),
    roles: {},
  }));
  savedPosture = process.env.CW_LLM_RUNTIME;
  process.env.CW_LLM_RUNTIME = ppath;

  portA = await freePort();
  serverA = openAiStub(MODELS_A);
  await new Promise((r) => serverA.listen(portA, '127.0.0.1', r));

  portB = await freePort();
  serverB = openAiStub(MODELS_B);
  await new Promise((r) => serverB.listen(portB, '127.0.0.1', r));

  // a port bound then released — connecting refuses immediately, standing in for a down host
  deadPort = await freePort();
  deadPort2 = await freePort();
});

after(() => {
  serverA?.close(); serverB?.close();
  if (savedPosture === undefined) delete process.env.CW_LLM_RUNTIME; else process.env.CW_LLM_RUNTIME = savedPosture;
  for (const [id, v] of saved) {
    if (v === undefined) delete process.env[urlEnvVar(id)];
    else process.env[urlEnvVar(id)] = v;
  }
});

/** Point every declared chat host at the dead port, then apply the given overrides. */
const pointAll = (overrides = {}) => {
  for (const h of chatHosts) setUrl(h.id, `http://127.0.0.1:${deadPort}`);
  for (const [id, url] of Object.entries(overrides)) setUrl(id, url);
};

describe('G1.1 — llmTargets autoregisters installed models from the live probe', () => {
  test('two hosts up: EVERY installed model auto-registers, probe order preserved, nothing hardcoded', async () => {
    pointAll({ [HOST_A.id]: `http://127.0.0.1:${portA}`, [HOST_B.id]: `http://127.0.0.1:${portB}` });
    const t = await llmTargets();
    assert.equal(t.ok, true);

    const byName = Object.fromEntries(t.engines.map((e) => [e.name, e]));
    assert.equal(byName[HOST_A.id].up, true);
    assert.equal(byName[HOST_B.id].up, true);

    // The declaration's probe order is preserved — the order the panel renders and auto-selects.
    const order = t.engines.map((e) => e.name);
    assert.ok(
      order.indexOf(HOST_A.id) < order.indexOf(HOST_B.id),
      `probe order from the declaration must survive into the response, got ${order.join(',')}`
    );

    // ALL models from BOTH hosts appear, in the order the server reported them — derived, not pinned
    assert.deepEqual(byName[HOST_A.id].models, MODELS_A);
    assert.deepEqual(byName[HOST_B.id].models, MODELS_B);
    const selectable = t.engines.flatMap((e) => e.models);
    assert.deepEqual(selectable.sort(), [...MODELS_A, ...MODELS_B].sort());
  });

  test('one host down: up:false with empty models[], NEVER omitted; the live host still registers', async () => {
    pointAll({ [HOST_A.id]: `http://127.0.0.1:${portA}` }); // B stays dead
    const t = await llmTargets();
    const byName = Object.fromEntries(t.engines.map((e) => [e.name, e]));

    // explicit uncertainty: the down host is its own state, present in the list, not a silent drop
    assert.ok(byName[HOST_B.id], 'a down host must never be omitted from the engine list');
    assert.equal(byName[HOST_B.id].up, false);
    assert.deepEqual(byName[HOST_B.id].models, [], 'a down host carries an explicit empty models[]');

    assert.equal(byName[HOST_A.id].up, true);
    assert.deepEqual(byName[HOST_A.id].models, MODELS_A);
  });

  test('everything down: every row present and up:false — a fabricated model is never invented', async () => {
    // Two DISTINCT dead ports on purpose. Pointing every host at one dead port would correctly
    // collapse to a single row (that is the dedupe working), which would make this assert nothing
    // about hosts being kept — the first version of this test did exactly that and failed for the
    // right reason.
    pointAll({ [HOST_A.id]: `http://127.0.0.1:${deadPort}`, [HOST_B.id]: `http://127.0.0.1:${deadPort2}` });
    const t = await llmTargets();
    assert.ok(t.engines.length >= 2, 'distinct down hosts are still reported, never dropped');
    assert.ok(t.engines.every((e) => e.up === false), 'all up:false when nothing is listening');
    assert.deepEqual(t.engines.flatMap((e) => e.models), [], 'no models are conjured for a dead host');
  });

  test('hosts sharing a port are ONE row, and that row does not claim to know which host it is', async () => {
    // The property the dedupe exists for. llama.cpp, llamafile, LocalAI and mlx-lm all default to
    // :8080; probing per-host would fire four identical requests at one server and render four
    // engines where one is running. Deduping by resolved URL is not an optimisation — without it
    // the panel reports a fleet of engines that does not exist.
    const shared = chatHosts.filter((h) => h.portIsShared);
    assert.ok(shared.length >= 2, 'the declaration must still contain the shared-port case');

    pointAll();
    const url = `http://127.0.0.1:${portA}`;
    for (const h of shared) setUrl(h.id, url); // all of them at one live server
    const t = await llmTargets();

    const rows = t.engines.filter((e) => e.url === url);
    assert.equal(rows.length, 1, `${shared.length} hosts on one URL must produce ONE row`);
    assert.equal(rows[0].identified, false, 'a shared endpoint cannot be attributed to one host');
    assert.deepEqual(
      rows[0].candidates.sort(),
      shared.map((h) => h.id).sort(),
      'the candidates are reported — unknown, not silent'
    );
    assert.match(rows[0].label, /unidentified/, 'the label must not name a host the probe cannot tell apart');
    // …and it still reports the models, because the endpoint genuinely answered.
    assert.deepEqual(rows[0].models, MODELS_A);
  });

  test('a host with a port of its own IS identified — the rule is not "never identify anything"', async () => {
    const solo = chatHosts.find((h) => !h.portIsShared);
    pointAll({ [solo.id]: `http://127.0.0.1:${portA}` });
    const t = await llmTargets();
    const row = t.engines.find((e) => e.name === solo.id);
    assert.equal(row.identified, true);
    assert.equal(row.label, solo.label);
  });
});

// fact: the vendored copy is compared, and its ABSENCE is reported rather than passed / memory-layer ships standalone so it carries its own copy of manifests/llm-hosts.json, and a drift test that quietly passes when it cannot see the other copy is the same false clean as no test (expiry: never, prev: not built)
//
// commitwork's own registry inventory defines `mirrored` as the anti-pattern: "two copies of one
// truth: the schema is documentation and the code is the gate, so they drift and only the code
// bites." memory-layer genuinely has to mirror this file — it must build outside this fleet, so it cannot
// read a sibling checkout — which means the mirroring is deliberate and the missing half has to be
// supplied here. This is that half.
//
// The load-bearing property is NOT "they match". It is that this test cannot silently succeed when
// it has nothing to compare: a skip is announced, with the path it looked for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL = resolve(REPO, 'manifests', 'llm-hosts.json');

// Overridable so the test is runnable from a checkout laid out differently, read at call time.
const internalCCopy = () =>
  process.env.CW_VELD_LLM_HOSTS || resolve(REPO, '..', 'memory-layer', 'manifests', 'llm-hosts.json');

test('the canonical declaration is readable — this test is worthless without it', () => {
  assert.ok(existsSync(CANONICAL), `${CANONICAL} is missing; nothing to compare against`);
  JSON.parse(readFileSync(CANONICAL, 'utf8'));
});

test('memory-layer carries a byte-identical copy, or says out loud that it could not look', (t) => {
  const other = internalCCopy();
  if (!existsSync(other)) {
    // NOT a pass. The runner prints this, so "no divergence found" can never be confused with
    // "did not look" — which is the whole reason a mirrored file is normally a defect.
    t.skip(
      `memory-layer is not checked out beside commitwork (looked for ${other}) — ` +
        'drift is UNCHECKED, not absent. Set CW_VELD_LLM_HOSTS to point at it.'
    );
    return;
  }

  const canonical = readFileSync(CANONICAL, 'utf8');
  const vendored = readFileSync(other, 'utf8');

  if (canonical === vendored) return;

  // Say WHERE they differ. "The files differ" sends the reader to a 100-line diff; naming the
  // fields sends them to the line.
  const a = JSON.parse(canonical);
  const b = JSON.parse(vendored);
  const ids = (d) => d.hosts.map((h) => h.id).sort();
  const detail = [];
  if (a.version !== b.version) detail.push(`version ${a.version} vs ${b.version}`);
  if (a.default !== b.default) detail.push(`default ${a.default} vs ${b.default}`);
  if (ids(a).join() !== ids(b).join()) {
    detail.push(`hosts [${ids(a)}] vs [${ids(b)}]`);
  }
  if (a.probeOrder.join() !== b.probeOrder.join()) {
    detail.push(`probeOrder [${a.probeOrder}] vs [${b.probeOrder}]`);
  }

  assert.fail(
    `manifests/llm-hosts.json has diverged between commitwork and memory-layer.\n` +
      `  canonical: ${CANONICAL}\n  vendored:  ${other}\n` +
      (detail.length ? `  differs in: ${detail.join('; ')}\n` : '  differs in formatting or prose\n') +
      "  commitwork's copy is canonical; copy it over memory-layer's."
  );
});

test('the two copies agree on the facts a consumer branches on', (t) => {
  const other = internalCCopy();
  if (!existsSync(other)) {
    t.skip(`memory-layer not present at ${other} — semantic agreement UNCHECKED`);
    return;
  }
  const a = JSON.parse(readFileSync(CANONICAL, 'utf8'));
  const b = JSON.parse(readFileSync(other, 'utf8'));

  // Byte-equality above already covers this, and it is asserted separately anyway: a future change
  // that normalises formatting on one side would make the byte test the only guard, and it would
  // then fail for a reason nobody cares about while these — the things code actually reads — went
  // unchecked.
  for (const h of a.hosts) {
    const mirror = b.hosts.find((x) => x.id === h.id);
    assert.ok(mirror, `memory-layer's copy is missing host ${h.id}`);
    assert.equal(mirror.baseUrl, h.baseUrl, `${h.id}: baseUrl differs`);
    assert.equal(mirror.portIsShared, h.portIsShared, `${h.id}: portIsShared decides whether a probe may NAME this host`);
    assert.equal(mirror.openSource, h.openSource, `${h.id}: openSource backs an open-tooling claim`);
    assert.deepEqual(mirror.capabilities, h.capabilities, `${h.id}: capabilities stop a 404`);
  }
});

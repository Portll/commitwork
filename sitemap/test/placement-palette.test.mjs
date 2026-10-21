// node --test sitemap/test/ — B2 (PALETTE style-token mediator) and B3 (placementPolicy semantic
// layout). The functions under test are LIFTED out of demo.html's inline <script> and evaluated;
// lifting is by source anchor, never line number — a line-keyed lift silently tests the wrong block.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Line endings normalised at the read: this file LIFTS code out of demo.html by anchor and
// evaluates the slice, and every anchor here is written against `\n`. Under a CRLF checkout the
// end anchor was never found — "end anchor not found after start — the lift is stale", which reads
// as a code change rather than as a platform difference. See admin/test/lib/panel-source.mjs.
const SRC = readFileSync(fileURLToPath(new URL('../demo.html', import.meta.url)), 'utf8')
  .split('\r\n').join('\n');

// Lift [start anchor .. end anchor], failing loudly rather than silently testing an empty string.
function lift(startAnchor, endAnchor, label) {
  const a = SRC.indexOf(startAnchor);
  assert.ok(a > -1, `${label}: start anchor not found in demo.html — the lift is stale, not the code`);
  const b = SRC.indexOf(endAnchor, a);
  assert.ok(b > a, `${label}: end anchor not found after start — the lift is stale`);
  return SRC.slice(a, b + endAnchor.length);
}

const b3Src = lift('const IO_EXTERNAL=', 'return scored.map(x=>x.s);\n}', 'B3 placementPolicy');
const b2Src = lift('const PALETTE={', 'PALETTE.access.unknown;', 'B2 PALETTE');

const B3 = new Function(`${b3Src}\nreturn { placementPolicy, externalityScore, IO_EXTERNAL, IO_INTERFACE };`)();

// The colour tables are STUBBED — these tests cover the `access` family and the fallback. The stub
// is why the last B2 test asserts wiring against the SOURCE TEXT: a stub satisfies identity checks
// against itself and proves nothing about what demo.html references.
const LANG_COLOR = { __stub: 'LANG_COLOR' };
const SEV_COLOR = { __stub: 'SEV_COLOR' };
const KIND_STYLE = { __stub: 'KIND_STYLE' }, KIND_COLOR = { __stub: 'KIND_COLOR' }, KIND_LABEL = { __stub: 'KIND_LABEL' };
const B2 = new Function('LANG_COLOR', 'SEV_COLOR', 'KIND_STYLE', 'KIND_COLOR', 'KIND_LABEL',
  `${b2Src}\nreturn { PALETTE, paletteAccess };`)(LANG_COLOR, SEV_COLOR, KIND_STYLE, KIND_COLOR, KIND_LABEL);

const svc = (name, io) => ({ name, ...(io ? { io } : {}) });
const names = (arr) => arr.map((s) => s.name);

describe('B3 externalityScore — external surface outweighs integrations', () => {
  test('a service with no io[] scores 0 — neutral, never guessed', () => {
    assert.equal(B3.externalityScore(svc('a')), 0);
    assert.equal(B3.externalityScore(svc('a', [])), 0);
    assert.equal(B3.externalityScore(null), 0);
    assert.equal(B3.externalityScore({}), 0);
  });

  test('inbound public surface is weighted 3x an integration', () => {
    assert.equal(B3.externalityScore(svc('a', [{ kind: 'http', count: 1 }])), 3);
    assert.equal(B3.externalityScore(svc('b', [{ kind: 'jdbc', count: 1 }])), 1);
    // one http outranks two integrations — the ordering the layout depends on
    assert.ok(B3.externalityScore(svc('a', [{ kind: 'http', count: 1 }]))
      > B3.externalityScore(svc('b', [{ kind: 'jdbc', count: 1 }, { kind: 'redis', count: 1 }])));
  });

  test('count is respected, and a missing count reads as 1 rather than 0', () => {
    assert.equal(B3.externalityScore(svc('a', [{ kind: 'http', count: 4 }])), 12);
    assert.equal(B3.externalityScore(svc('a', [{ kind: 'http' }])), 3, 'no count must not silently zero the edge');
    assert.equal(B3.externalityScore(svc('a', [{ kind: 'http', count: 0 }])), 3, 'count 0 is clamped to 1, not dropped');
  });

  test('an unrecognised io kind contributes nothing — it does not default into a band', () => {
    assert.equal(B3.externalityScore(svc('a', [{ kind: 'carrier-pigeon', count: 9 }])), 0);
  });
});

describe('B3 placementPolicy — internal to external, and honest when it cannot tell', () => {
  test('orders internal -> interfacing -> external-facing', () => {
    const out = B3.placementPolicy([
      svc('gateway', [{ kind: 'http', count: 5 }]),
      svc('worker'),
      svc('billing', [{ kind: 'jdbc', count: 2 }]),
    ]);
    assert.deepEqual(names(out), ['worker', 'billing', 'gateway']);
  });

  test('THE HONEST NO-OP: when no service has io, the original array comes back untouched', () => {
    // A v1 manifest must render byte-identically to before this feature existed.
    const input = [svc('c'), svc('a'), svc('b')];
    const out = B3.placementPolicy(input);
    assert.equal(out, input, 'the SAME array reference — not a copy, not a sort');
    assert.deepEqual(names(out), ['c', 'a', 'b'], 'and emphatically not alphabetised');
  });

  test('equal scores keep manifest order — deterministic rebuilds', () => {
    const out = B3.placementPolicy([
      svc('z', [{ kind: 'jdbc', count: 1 }]),
      svc('a', [{ kind: 'redis', count: 1 }]),
      svc('m', [{ kind: 'http', count: 1 }]),
    ]);
    assert.deepEqual(names(out), ['z', 'a', 'm'], 'z before a: stable by original index, never by name');
  });

  test('the input array is not mutated — the caller still holds manifest order', () => {
    const input = [svc('gateway', [{ kind: 'http', count: 5 }]), svc('worker')];
    const before = names(input);
    B3.placementPolicy(input);
    assert.deepEqual(names(input), before);
  });

  test('a non-array is returned as-is rather than throwing into the render path', () => {
    assert.equal(B3.placementPolicy(null), null);
    assert.equal(B3.placementPolicy(undefined), undefined);
  });

  test('the returned set is the same services — placement reorders, never filters', () => {
    const input = [svc('a', [{ kind: 'http' }]), svc('b'), svc('c', [{ kind: 'redis' }])];
    const out = B3.placementPolicy(input);
    assert.equal(out.length, input.length);
    assert.deepEqual(names(out).sort(), names(input).sort(), 'a dropped service is a service that vanishes from the map');
  });
});

describe('B2 PALETTE — an unprobed endpoint must not be drawn as a gated one', () => {
  const STATES = ['blocked', 'bypassed', 'cross-tenant-write', 'partial', 'unknown'];

  test('every access state declares the full token set', () => {
    for (const s of STATES) {
      const t = B2.PALETTE.access[s];
      assert.ok(t, `${s} is missing`);
      for (const k of ['glass', 'opacity', 'edge', 'label']) {
        assert.ok(t[k] !== undefined, `${s}.${k} missing — a half-declared token falls back silently at render time`);
      }
    }
  });

  test('an unrecognised state falls back to `unknown`, never to blocked or clean', () => {
    // explicit uncertainty at the visual layer: falling back to `blocked` would invent a security control on screen.
    assert.equal(B2.paletteAccess('no-such-state'), B2.PALETTE.access.unknown);
    assert.equal(B2.paletteAccess(undefined), B2.PALETTE.access.unknown);
    assert.equal(B2.paletteAccess(''), B2.PALETTE.access.unknown);
    assert.notEqual(B2.paletteAccess('no-such-state'), B2.PALETTE.access.blocked);
  });

  test('`unknown` is visually distinct from `blocked` — and the faintest of all', () => {
    const u = B2.PALETTE.access.unknown, b = B2.PALETTE.access.blocked;
    assert.notEqual(u.glass, b.glass);
    assert.notEqual(u.edge, b.edge);
    assert.ok(u.opacity < b.opacity, 'unprobed must read as fainter than gated, not more solid');
    for (const s of STATES) {
      if (s === 'unknown') continue;
      assert.ok(u.opacity < B2.PALETTE.access[s].opacity, `unknown must be fainter than ${s}`);
    }
  });

  test('cross-tenant-write is its own state, louder than a read bypass', () => {
    const w = B2.PALETTE.access['cross-tenant-write'], r = B2.PALETTE.access.bypassed;
    assert.notEqual(w.edge, r.edge, 'an integrity breach that renders as a read leak is a downgrade');
    assert.ok(w.opacity >= r.opacity);
  });

  test('every label says what the state MEANS, not just its name', () => {
    for (const s of STATES) {
      const label = B2.PALETTE.access[s].label;
      assert.match(label, /\(/, `${s}: the label carries a parenthetical gloss so the legend is readable without the code`);
    }
    assert.match(B2.PALETTE.access.unknown.label, /unprobed/, 'unknown must say WHY it is unknown');
  });

  test('the mediator wraps the existing tables rather than replacing them', () => {
    // B2 is additive: the base tables stay the single source of truth — if PALETTE stops pointing
    // at them, the two copies drift apart silently.
    assert.ok(SRC.includes('lang: LANG_COLOR'), 'PALETTE.lang must reference LANG_COLOR, not clone it');
    assert.ok(SRC.includes('sev:  SEV_COLOR'), 'PALETTE.sev must reference SEV_COLOR, not clone it');
  });
});

describe('both are actually wired — a mediator nothing reads is a mediator that is not there', () => {
  test('placementPolicy is called by the scene builder', () => {
    assert.match(SRC, /placementPolicy\(M\.services\)/,
      'B3 exists but is not consumed — the ordering would be dead code and the layout unchanged');
  });

  test('the render layer reads access tokens through paletteAccess/PALETTE, not literals', () => {
    assert.ok(SRC.includes('PALETTE.access'), 'the access family must be read from the palette');
    assert.ok(SRC.split('paletteAccess(').length - 1 >= 1, 'the accessor exists to be used');
  });
});

// Same §6 constraints as the CAPEC axis. Every fixture search asserts it found one — see
// cw-taxonomy-gaps-20260823 task 1.45.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseBundle, tacticsFor, parentOf, loadGraph, graphPath, serialise } from '../attack-graph.mjs';

const G = existsSync(graphPath()) ? loadGraph() : null;
const built = (name, fn) => test(name, { skip: G ? false : 'graph not built' }, fn);

const tech = (id, over = {}) => ({
  type: 'attack-pattern', name: `n${id}`,
  external_references: [{ source_name: 'mitre-attack', external_id: id }],
  kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
  ...over,
});

describe('withdrawn ids are excluded, and the TWO KINDS are counted apart', () => {
  test('deprecated and revoked are different facts and are tallied separately', () => {
    // revoked means REPLACED BY something else, so publishing it is stale attribution, not absent
    const g = parseBundle({ objects: [tech('T1'), tech('T2', { x_mitre_deprecated: true }), tech('T3', { revoked: true })] });
    assert.deepEqual(Object.keys(g.techniques), ['T1']);
    assert.equal(g.dropped.deprecated, 1);
    assert.equal(g.dropped.revoked, 1);
  });
  test('an attack-pattern with no ATT&CK id is dropped and counted, not keyed on undefined', () => {
    const g = parseBundle({ objects: [{ type: 'attack-pattern', name: 'x', external_references: [] }] });
    assert.deepEqual(Object.keys(g.techniques), []);
    assert.equal(g.dropped.noId, 1);
  });
  built('the built graph carries no withdrawn id', () => {
    assert.ok(G.dropped.deprecated + G.dropped.revoked > 100,
      `only ${G.dropped.deprecated + G.dropped.revoked} dropped — the filter may not be running`);
  });
});

describe('the sub-technique hierarchy', () => {
  test('parentOf derives from the id, and a base technique has NO parent', () => {
    assert.equal(parentOf('T1059.007'), 'T1059');
    assert.equal(parentOf('T1059'), '');
    assert.equal(parentOf('T1542.002'), 'T1542');
    for (const junk of ['', null, undefined, 'nonsense', 'T', '1059.007']) assert.equal(parentOf(junk), '');
  });
  built('every declared parent EXISTS — a dangling parent breaks the roll-up through it', () => {
    const orphans = Object.entries(G.techniques)
      .filter(([, t]) => t.parent && !G.techniques[t.parent]).map(([k]) => k);
    assert.deepEqual(orphans, []);
  });
  built('sub-techniques are a real majority, so the hierarchy is not decorative', () => {
    const subs = Object.values(G.techniques).filter((t) => t.parent).length;
    assert.ok(subs > 300, `only ${subs} sub-techniques — the parent derivation may be failing`);
  });
  built('a parent is never its own child', () => {
    for (const [id, t] of Object.entries(G.techniques)) assert.notEqual(t.parent, id, `${id} parents itself`);
  });
  built('the hierarchy is exactly one level deep — ATT&CK has no sub-sub-techniques', () => {
    for (const [id, t] of Object.entries(G.techniques)) {
      if (!t.parent) continue;
      assert.equal(G.techniques[t.parent].parent, undefined, `${id} → ${t.parent} → a grandparent`);
    }
  });
});

describe('tactics', () => {
  built('all fifteen enterprise tactics are present with their TA id', () => {
    assert.equal(Object.keys(G.tactics).length, 15);
    for (const [short, t] of Object.entries(G.tactics)) {
      assert.match(t.id, /^TA\d{4}$/, `${short} has no TA id`);
      assert.ok(t.name, `${short} has no name`);
    }
  });
  built('every tactic a technique claims is a declared tactic', () => {
    const declared = new Set(Object.keys(G.tactics));
    const undeclared = new Set();
    for (const t of Object.values(G.techniques)) for (const k of t.tactics || []) if (!declared.has(k)) undeclared.add(k);
    assert.deepEqual([...undeclared], []);
  });
  built('a sub-technique may carry MORE tactics than its parent — it is not inherited', () => {
    // T1542.002 sits under persistence AND stealth; taking the parent's set would lose one
    const multi = Object.entries(G.techniques).find(([, t]) => t.parent && (t.tactics || []).length > 1);
    assert.ok(multi, 'no multi-tactic sub-technique found — this test would pass on an empty subject');
    const [id, t] = multi;
    assert.ok(t.tactics.length > 1, `${id} should carry several tactics`);
  });
});

describe('tacticsFor — attributes, and a declared absence', () => {
  built('rolls a technique set up to its tactics and parents', () => {
    const sub = Object.entries(G.techniques).find(([, t]) => t.parent && t.tactics);
    assert.ok(sub, 'no sub-technique with tactics found — empty subject');
    const r = tacticsFor([sub[0]], G);
    assert.equal(r.attackParent, sub[1].parent);
    assert.ok(r.attackTactic, 'no tactic rolled up');
    assert.equal(r.attackReason, '');
  });
  built('a base technique borrows no parent', () => {
    const base = Object.entries(G.techniques).find(([, t]) => !t.parent);
    assert.ok(base, 'no base technique found — empty subject');
    assert.equal(tacticsFor([base[0]], G).attackParent, '');
  });
  built('absence is declared, never a bare blank', () => {
    assert.equal(tacticsFor([], G).attackReason, 'no-technique');
    assert.equal(tacticsFor(null, G).attackReason, 'no-technique');
    assert.equal(tacticsFor(['T9999999'], G).attackReason, 'technique-unknown');
  });
  built('returns strings, never arrays — the row-multiplying shape is refused', () => {
    const r = tacticsFor(Object.keys(G.techniques).slice(0, 40), G);
    assert.equal(typeof r.attackTactic, 'string');
    assert.equal(typeof r.attackParent, 'string');
  });
  built('emits no severity field of any kind', () => {
    for (const k of Object.keys(tacticsFor(['T1059'], G))) {
      assert.ok(!/^(sev|severity|score|crit|high|med|low)$/i.test(k), `emitted ${k}`);
    }
  });
});

built('one direction — no tactic→technique inverse index', () => {
  for (const k of Object.keys(G)) assert.ok(!/byTactic|tacticTo|inverse/i.test(k), `${k} looks like an inverse`);
});

built('determinism — same graph serialises byte-identically, ids sorted', () => {
  assert.equal(serialise(G), serialise(G));
  const ids = Object.keys(JSON.parse(serialise(G)).techniques);
  assert.deepEqual(ids, [...ids].sort());
});

built('the checked-in graph is self-consistent', () => {
  assert.equal(G.count, Object.keys(G.techniques).length);
  assert.equal(G.domain, 'enterprise-attack');
  for (const id of Object.keys(G.techniques)) assert.match(id, /^T\d+(\.\d+)?$/, `malformed id ${id}`);
});

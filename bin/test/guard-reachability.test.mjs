// guard-reachability — can this guard's branch EXECUTE, in the configuration that actually runs?
// Reachability, not import, is the property that matters. Each guard's probe() computes
// reachability against the live configuration and the declared `expect` is checked against it.
// This suite measures; it does not repair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainsFor, baseChainCount } from '../issue-llm.mjs';
import { computeFindingCalibration, readJournalFile, adjudicationsPath, readCalibrateBaseline } from '../lib/verdict-journal-core.mjs';
import { loadManifest as loadAgentSurface } from '../agent-surface.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// `unknown` is a THIRD value and not a pass: a probe that cannot observe the live configuration
// skips with its reason printed.
const UNKNOWN = (why) => ({ reachable: null, why });

const GUARDS = [
  {
    id: 'reasoning-lint',
    module: 'lib/reasoning-lint.mjs',
    symbol: 'lintPair',
    callSite: 'bin/issue-llm.mjs — fuseChains()',
    classes: ['G1', 'R1'],
    expect: 'unreachable',
    // The precondition is the whole finding, stated so precisely that a change to it fails here.
    precondition: 'lintPair sits past the n<=1 early-continue; chainsFor returns n>1 only for a '
      + '(check, model) calibration node with denominator >= 5, and no live node reaches it',
    // THE PROBE'S ANSWER IS PER-CHECKOUT, measured 2026-10-04. adjudicationsPath() resolves
    // .claude/verdicts/ under whichever checkout runs it, and a sibling worktree accumulates its
    // own. The primary held 158 adjudications and no escalating node; a worktree held a stray 52
    // and reported osv/human=3, which read as "the guard became reachable" and was an artifact of
    // the store, not a change in the code. Run this where the real ledger lives before believing
    // either answer, and treat a reachability flip measured in a worktree as unmeasured.
    probe() {
      let adj;
      try { adj = readJournalFile(adjudicationsPath()); }
      catch (e) { return UNKNOWN(`adjudications unreadable (${e.code || 'error'})`); }
      if (adj.absent) return UNKNOWN('no adjudications ledger on this machine');
      const baseline = readCalibrateBaseline();
      if (baseline && baseline._error) return UNKNOWN('calibrate baseline corrupt — not a basis for a reachability claim');
      const calibration = computeFindingCalibration(adj.records, { windowStart: baseline ? baseline.at : null });
      const floor = baseChainCount();
      // Ask the real function the real question, for every (check, model) the corpus actually has.
      const nodes = [];
      for (const [check, models] of Object.entries(calibration?.checks || {})) {
        for (const model of Object.keys(models)) {
          nodes.push({ check, model, n: chainsFor(check, model, calibration, floor) });
        }
      }
      const escalating = nodes.filter((x) => x.n > 1);
      return {
        reachable: escalating.length > 0,
        why: escalating.length
          ? `${escalating.length} node(s) escalate to n>1: ${escalating.map((x) => `${x.check}/${x.model}=${x.n}`).join(', ')}`
          : `${nodes.length} (check, model) node(s) in the live corpus, none escalating past the floor of ${floor} — every run takes the n<=1 path and fuseChains never executes`,
      };
    },
  },
  {
    id: 'gate-ratchet',
    module: 'bin/gate-ratchet.mjs',
    symbol: 'Stop hook',
    callSite: '.claude/settings.json — hooks.Stop',
    classes: ['A2'],
    expect: 'reachable',
    precondition: 'the gate only protects anything if the harness actually invokes it on Stop',
    probe: () => hookProbe('bin/gate-ratchet.mjs'),
  },
  {
    id: 'gate-tests',
    module: 'bin/gate-tests.mjs',
    symbol: 'Stop hook',
    callSite: '.claude/settings.json — hooks.Stop',
    classes: ['C1', 'A3'],
    expect: 'reachable',
    precondition: 'as above — an unwired gate is an exit code with no subscriber',
    probe: () => hookProbe('bin/gate-tests.mjs'),
  },
];

// guard: every hook in the agent-surface registry gets a reachability row, no test edit
// Adding a hook to manifests/agent-surface.json adds its row here; the registry is the one
// authority for what commitwork installs, so a surface it can enable must be a surface this checks.
function agentSurfaceGuards() {
  let entries;
  try { entries = loadAgentSurface(); } catch { return []; }
  return Object.values(entries).filter((e) => e.kind === 'hook').map((e) => {
    const script = String(e.command || '').replace(/^node\s+/, '').replace('$CW_ROOT/', '');
    return {
      id: e.id,
      module: script,
      symbol: `${e.event} hook`,
      callSite: `.claude/settings.json — hooks.${e.event}`,
      classes: ['A2'],
      expect: 'reachable',
      precondition: e.why || `declared in manifests/agent-surface.json as a ${e.event} hook and expected wired`,
      probe: () => hookProbe(script, e.event),
    };
  });
}
GUARDS.push(...agentSurfaceGuards());

// .claude/ is machine-local: absent is UNKNOWN, never "unwired".
function hookProbe(script, event = 'Stop') {
  let raw;
  try { raw = readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return UNKNOWN('.claude/settings.json absent (expected on a CI runner) — wiring cannot be observed here');
    return UNKNOWN(`.claude/settings.json unreadable (${e.code})`);
  }
  let settings;
  try { settings = JSON.parse(raw); }
  catch { return UNKNOWN('.claude/settings.json is not valid JSON — unreadable is not unwired'); }
  const commands = [];
  for (const entry of settings?.hooks?.[event] || []) {
    for (const h of entry?.hooks || []) if (typeof h?.command === 'string') commands.push(h.command);
  }
  const hit = commands.filter((c) => c.includes(script));
  return {
    reachable: hit.length > 0,
    why: hit.length
      ? `wired as a ${event} hook (${hit.length} entr${hit.length === 1 ? 'y' : 'ies'})`
      : `${commands.length} ${event} hook command(s) configured, none invoking ${script}`,
  };
}

for (const g of GUARDS) {
  test(`reachability: ${g.id} (${g.module}) is ${g.expect}`, (t) => {
    const r = g.probe();
    if (r.reachable === null) {
      t.skip(`UNKNOWN — ${r.why}`);
      return;
    }
    const observed = r.reachable ? 'reachable' : 'unreachable';
    assert.equal(observed, g.expect,
      observed === 'reachable'
        ? `${g.id} is now REACHABLE and was declared unreachable. That is news, not a failure — the `
          + `guard has started protecting something. Update the declaration and the taxonomy classes `
          + `${g.classes.join('/')}.\nProbe: ${r.why}`
        : `${g.id} is UNREACHABLE and was declared reachable — it reads as protection in every review `
          + `and executes nothing.\nPrecondition: ${g.precondition}\nProbe: ${r.why}`);
  });
}

// guard: every agent-surface hook entry produced a reachability row
test('every hook in manifests/agent-surface.json has a reachability row', () => {
  const hooks = Object.values(loadAgentSurface()).filter((e) => e.kind === 'hook').map((e) => e.id);
  assert.ok(hooks.length >= 1, 'the registry declares no hooks — this test would be vacuous');
  for (const id of hooks) assert.ok(GUARDS.some((g) => g.id === id), `agent-surface hook ${id} has no reachability row — the registry and this suite drifted`);
});

// Registry invariants: a guard with no probe is a prose assertion wearing a test's name.
test('every declared guard carries a probe and at least one taxonomy class', () => {
  for (const g of GUARDS) {
    assert.equal(typeof g.probe, 'function', `${g.id} declares no probe — its status would be an assertion`);
    assert.ok(g.classes.length > 0, `${g.id} links to no taxonomy class`);
    assert.ok(g.precondition && g.precondition.length > 20, `${g.id} states no precondition, so nothing can detect it changing`);
  }
});

test('every taxonomy class a guard claims exists in the registry', () => {
  let registry;
  try { registry = JSON.parse(readFileSync(join(REPO, 'monitor', 'failure-taxonomy.json'), 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') { assert.ok(true); return; }   // registry not landed on this checkout
    throw e;                                                 // unreadable is never absent
  }
  const ids = new Set((registry.classes || []).map((c) => c.id));
  assert.ok(ids.size > 0, 'the registry parsed but declares no classes — that is a schema move, not an empty taxonomy');
  for (const g of GUARDS) {
    for (const c of g.classes) {
      assert.ok(ids.has(c), `guard ${g.id} cites taxonomy class ${c}, which the registry does not define`);
    }
  }
});

// The always-a-defect combination: a class the registry calls closed, guarded by something that
// cannot execute. The closure bound is READ from the registry (scaleBounds.fullyClosed), never
// restated here — a hardcoded bound once made this assertion pass vacuously.
test('no guard declared unreachable backs a class the registry scores as closed', () => {
  let registry;
  try { registry = JSON.parse(readFileSync(join(REPO, 'monitor', 'failure-taxonomy.json'), 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') { assert.ok(true); return; }
    throw e;
  }
  const byId = new Map((registry.classes || []).map((c) => [c.id, c]));
  const fullyClosed = registry.scaleBounds?.fullyClosed;
  assert.equal(typeof fullyClosed, 'number',
    'the registry declares no scaleBounds.fullyClosed — refusing to guess a threshold, which is how this test passed vacuously before');
  // prove the predicate is SATISFIABLE — a threshold no class reaches makes the assertion decorative
  const atCeiling = (registry.classes || []).filter((c) => c.closure >= fullyClosed);
  assert.ok(atCeiling.length > 0,
    `no class reaches closure ${fullyClosed}, so this assertion cannot fail — it would pass vacuously and prove nothing`);

  const offences = [];
  for (const g of GUARDS.filter((x) => x.expect === 'unreachable')) {
    for (const id of g.classes) {
      const cls = byId.get(id);
      if (cls && typeof cls.closure === 'number' && cls.closure >= fullyClosed) {
        offences.push(`${id} (closure ${cls.closure}/${fullyClosed}) is backed by ${g.id}, which cannot execute`);
      }
    }
  }
  assert.deepEqual(offences, [], `closure claimed on an unreachable guard:\n  ${offences.join('\n  ')}`);
});

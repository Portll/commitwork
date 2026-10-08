// The posture board's judgement, asserted from fixtures: explicit uncertainty — an approach that did
// not run must never render like one that ran and found nothing. computePosture is pure, so every
// state is reachable with an injected clock.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computePosture, lightFor, deliveryLightFor, deliveryCountFor, slicesInWindow, toolInventory,
  SECURITY_TYPES, WINDOW_DAYS, DAY_MS } from '../posture.mjs';
import { SCANNER_CHECKS, CHECK_ALIASES } from '../scanner-checks.mjs';
import { weaknessClassVoids } from '../coverage-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAXONOMY = JSON.parse(readFileSync(join(HERE, '..', 'approach-taxonomy.json'), 'utf8'));
// ruleId -> [CWE-nnn], flattened across engines, for the lane-E cross-check below.
const RULE_CWE = (() => {
  const raw = JSON.parse(readFileSync(join(HERE, '..', 'ruleId-cwe.json'), 'utf8'));
  const flat = {};
  for (const [engine, rules] of Object.entries(raw)) {
    if (engine.startsWith('$')) continue;
    if (rules && typeof rules === 'object') for (const [id, cwes] of Object.entries(rules)) flat[id] = cwes;
  }
  return flat;
})();

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const recent = new Date(NOW - 2 * DAY_MS).toISOString();
const ancient = new Date(NOW - 40 * DAY_MS).toISOString();

test('an approach that ran nowhere is explicit uncertainty — a void is not a clean result', () => {
  const r = lightFor({ ran: 0, skipped: 12, noscan: 6, crit: 0, high: 0, med: 0, low: 0, total: 0 }, { nowMs: NOW });
  assert.equal(r.light, 'grey', 'ran on zero repos must be grey');
  assert.match(r.why, /coverage void/, 'the reason must name it a void rather than describing a zero');
});

test('no aggregate at all is GREY and says so — absence of a category is not absence of risk', () => {
  assert.equal(lightFor(null, { nowMs: NOW }).light, 'grey');
  assert.equal(lightFor(undefined, { nowMs: NOW }).light, 'grey');
});

test('crit or high is RED; findings below that are AMBER', () => {
  assert.equal(lightFor({ ran: 3, skipped: 0, noscan: 0, crit: 1, high: 0, total: 1, lastRunAt: recent }, { nowMs: NOW }).light, 'red');
  assert.equal(lightFor({ ran: 3, skipped: 0, noscan: 0, crit: 0, high: 2, total: 2, lastRunAt: recent }, { nowMs: NOW }).light, 'red');
  assert.equal(lightFor({ ran: 3, skipped: 0, noscan: 0, crit: 0, high: 0, med: 4, total: 4, lastRunAt: recent }, { nowMs: NOW }).light, 'amber');
});

test('hygiene never reaches red — TODO markers must not glow like a live exposure', () => {
  const live = { ran: 30, skipped: 0, noscan: 0, crit: 0, high: 4019, total: 4019, lastRunAt: recent };
  assert.equal(lightFor(live, { nowMs: NOW }).light, 'red', 'without the hygiene flag this is red');
  const h = lightFor(live, { nowMs: NOW, hygiene: true });
  assert.equal(h.light, 'amber', 'stub-detect markers are hygiene and are excluded from the security headline');
  assert.match(h.why, /hygiene/, 'and the reason must say why it was held back');
});

test('a clean result whose last run predates the window is AMBER, not green', () => {
  const stale = lightFor({ ran: 5, skipped: 0, noscan: 0, crit: 0, high: 0, total: 0, lastRunAt: ancient }, { nowMs: NOW });
  assert.equal(stale.light, 'amber', 'a green number 40 days old is not a green number');
  assert.equal(stale.inWindow, false);
  const fresh = lightFor({ ran: 5, skipped: 0, noscan: 0, crit: 0, high: 0, total: 0, lastRunAt: recent }, { nowMs: NOW });
  assert.equal(fresh.light, 'green');
  assert.equal(fresh.inWindow, true);
});

test('a carried count is AMBER — it was not re-run, so it is not current', () => {
  const r = lightFor({ ran: 0, skipped: 0, noscan: 0, crit: 0, high: 0, total: 0, carried: true, carriedFrom: 'sweep-1' }, { nowMs: NOW });
  assert.equal(r.light, 'amber');
  assert.match(r.why, /carried/);
});

test('clean where it ran but noscan elsewhere is AMBER — partial coverage stated as partial', () => {
  const r = lightFor({ ran: 3, skipped: 0, noscan: 7, crit: 0, high: 0, total: 0, lastRunAt: recent }, { nowMs: NOW });
  assert.equal(r.light, 'amber');
  assert.match(r.why, /no scan at all/);
});

test('slicesInWindow keeps only the last 7 days, newest first, and drops unparseable rows', () => {
  const rows = [
    { sliceId: 'old', generated: ancient },
    { sliceId: 'new', generated: recent },
    { sliceId: 'broken', generated: 'not-a-date' },
    { sliceId: 'newest', generated: new Date(NOW - 1000).toISOString() },
  ];
  const w = slicesInWindow(rows, NOW);
  assert.deepEqual(w.map((r) => r.sliceId), ['newest', 'new'], 'newest first, window-filtered, junk dropped');
});

test('toolInventory finds both declared binaries and the docker images commands actually pull', () => {
  const inv = toolInventory([{ name: 'm', checks: [
    { id: 'a', requires: { tools: ['gitleaks'] }, local: ['gitleaks detect'] },
    { id: 'b', requires: { tools: ['docker'] }, local: ['docker run --rm -v "$PWD":/src ghcr.io/google/osv-scanner:latest scan source'] },
  ] }]);
  const byName = Object.fromEntries(inv.map((t) => [t.tool, t]));
  assert.ok(byName.gitleaks, 'a declared binary is inventoried');
  assert.equal(byName.gitleaks.kind, 'binary');
  assert.ok(byName['ghcr.io/google/osv-scanner:latest'], 'an image is recovered from the command text — there is no requires.images to read');
  assert.equal(byName['ghcr.io/google/osv-scanner:latest'].kind, 'image');
  assert.deepEqual(byName.docker.usedBy, ['b'], 'usedBy ties a tool back to the checks that need it');
});

// ── the whole board ─────────────────────────────────────────────────────────────────────────────
const MANIFESTS = [{ name: 'security-baseline', checks: [
  { id: 'secrets-gitleaks', description: 'gitleaks', requires: { tools: ['gitleaks'] }, report: { file: 'gitleaks.json' } },
  { id: 'dockerfile-lint', description: 'hadolint', requires: { tools: ['hadolint'] }, report: { file: 'hadolint.json' } },
  { id: 'api-fuzz', description: 'schemathesis', requires: { tools: ['schemathesis'], services: ['a running app'] }, report: { file: 'schemathesis.ndjson' } },
  { id: 'stub-detect', description: 'stubs', requires: { tools: ['node'] }, report: { file: 'stub.json' } },
] }, { name: 'runtime', checks: [
  { id: 'api-fuzz-schemathesis', description: 'the same fuzzer, second declaration', aliasOf: 'api-fuzz', report: { file: 'schemathesis.ndjson' } },
] }];

const ROLLUP = { generated: recent, scanners: {
  secrets: { ran: 3, skipped: 0, noscan: 0, crit: 0, high: 0, med: 0, low: 0, total: 0, lastRunAt: recent },
  dockerfile: { ran: 3, skipped: 0, noscan: 0, crit: 0, high: 5, med: 0, low: 0, total: 5, lastRunAt: recent },
  apiFuzz: { ran: 0, skipped: 0, noscan: 3, crit: 0, high: 0, med: 0, low: 0, total: 0 },
  stubs: { ran: 3, skipped: 0, noscan: 0, crit: 0, high: 900, med: 0, low: 0, total: 900, lastRunAt: recent },
} };

const board = (over = {}) => computePosture({
  taxonomy: TAXONOMY, manifests: MANIFESTS, scannerChecks: SCANNER_CHECKS, aliases: CHECK_ALIASES,
  rollup: ROLLUP, historyIndex: [{ sliceId: 's', generated: recent }], lifecycle: null,
  toolchain: [{ tool: 'gitleaks', kind: 'binary', installed: true, version: 'v8', usedBy: ['secrets-gitleaks'] },
    { tool: 'gosec', kind: 'binary', installed: false, version: null, usedBy: ['sast-go-gosec'] }],
  nowMs: NOW, ...over,
});

test('the board classifies every declared approach and sorts the worst first', () => {
  const b = board();
  // the two boards together must account for every declared check
  assert.equal(b.approaches.length + b.delivery.approaches.length, 5,
    'every check in every supplied manifest gets a row on one board or the other');
  assert.equal(b.approaches[0].light, 'red', 'red sorts first — a red buried under greens is a red nobody sees');
  assert.equal(b.approaches[0].check, 'dockerfile-lint');
  const byCheck = Object.fromEntries(b.approaches.map((a) => [a.check, a]));
  assert.equal(byCheck['secrets-gitleaks'].light, 'green');
  assert.equal(byCheck['api-fuzz'].light, 'grey', 'noscan everywhere is a void');
  assert.deepEqual(b.tally, { green: 1, amber: 0, red: 1, grey: 2, 'n/a': 0 });
});

test('the two boards split by DECLARED type — security stays, the rest moves rather than vanishing', () => {
  // splitting is only honest if nothing is LOST — the security board sheds, delivery receives
  const b = board();
  const secTypes = new Set(b.approaches.map((a) => a.type));
  assert.ok(secTypes.size > 0, 'the security board carries no approaches — the type check below would pass having classified nothing');
  for (const t of secTypes) {
    assert.ok(SECURITY_TYPES.includes(t), `${t} is not a security type but is on the security board`);
  }
  const delivered = Object.fromEntries(b.delivery.approaches.map((a) => [a.check, a]));
  assert.ok(delivered['stub-detect'], 'hygiene belongs on delivery, not on the security board');
  assert.equal(delivered['stub-detect'].light, 'amber', '900 markers are hygiene, still held below red');
  assert.ok(!b.approaches.some((a) => a.check === 'stub-detect'),
    'and it must not appear on both — a row counted twice is a tally nobody can reconcile');
});

test('a declared alias joins its twin’s counts instead of reporting no live counts', () => {
  const byCheck = Object.fromEntries(board().approaches.map((a) => [a.check, a]));
  const alias = byCheck['api-fuzz-schemathesis'];
  assert.equal(alias.aliasOf, 'api-fuzz', 'the alias records whose run it is reporting');
  assert.equal(alias.category, 'apiFuzz', 'and resolves to the same category');
  assert.equal(alias.light, byCheck['api-fuzz'].light,
    'the same probe declared twice must not read as present under one id and absent under the other');
});

test('every approach carries a DECLARED type and escalation guidance, never an inferred one', () => {
  for (const a of board().approaches) {
    assert.ok(a.type, `${a.check} has no declared type — add it to monitor/approach-taxonomy.json`);
    assert.ok(a.typeLabel, `${a.check}'s type is not one the taxonomy defines`);
    assert.ok(a.escalates, `${a.check} declares no escalation guidance`);
  }
});

test('an empty 7-day window is reported as a fact, because it conditions every light on the page', () => {
  const b = board({ historyIndex: [{ sliceId: 'old', generated: ancient }] });
  assert.equal(b.window.slices, 0);
  assert.equal(b.window.newest, null);
  assert.equal(b.windowDays, WINDOW_DAYS);
});

test('a missing lifecycle.json reports present:false — NOT "nothing is overdue"', () => {
  const b = board({ lifecycle: null });
  assert.equal(b.escalation.present, false,
    'unreadable and clean must be distinguishable; rendering both as 0 breaches is the silent-green shape');
  assert.equal(b.escalation.breached, 0);
});

test('SLA breaches surface as rows, most overdue first, with the arithmetic shown', () => {
  const lifecycle = { aggregates: { slaBreachCount: 2 }, records: [
    { id: 'CVE-1', repo: 'a', severity: 'high', title: 't1', dwell: { knowableExposureDays: 40 }, escalation: { slaBreached: true, slaTier: 30 } },
    { id: 'CVE-2', repo: 'b', severity: 'crit', title: 't2', dwell: { knowableExposureDays: 100 }, escalation: { slaBreached: true, slaTier: 7 } },
    { id: 'CVE-3', repo: 'c', severity: 'low', escalation: { slaBreached: false, slaTier: 180 } },
  ] };
  const e = board({ lifecycle }).escalation;
  assert.equal(e.present, true);
  assert.equal(e.breached, 2, 'only breached records are rows');
  assert.deepEqual(e.rows.map((r) => r.id), ['CVE-2', 'CVE-1'], 'most overdue first');
  assert.equal(e.rows[0].overdueDays, 93, 'overdue is exposure minus tier, shown rather than asserted');
});

test('the toolchain lane names what is MISSING — absent tools produce skips that look like coverage', () => {
  const t = board().toolchain;
  assert.equal(t.total, 2);
  assert.equal(t.installed, 1);
  assert.deepEqual(t.missing, ['gosec']);
});

describe('the delivery board reads verdicts, not scan provenance', () => {
  // These blocks carry no ran/skipped/noscan — only a recorded value per repo — so the board may
  // say what the repos reported and must never claim something "provably ran".
  test('a failing repo makes the approach red, however many pass', () => {
    const r = deliveryLightFor(['green', 'green', 'RED', 'green']);
    assert.equal(r.light, 'red');
    assert.match(r.why, /1 of 4/);
  });

  test('n/a IS ITS OWN STATE — a determination is not a gap', () => {
    // answered-not-applicable and never-asked must not render alike — filing them together is
    // alarm fatigue by construction
    const allNa = deliveryLightFor(['n/a', 'n/a', 'n/a']);
    assert.equal(allNa.light, 'n/a');
    assert.match(allNa.why, /not to apply/);
    const neverAsked = deliveryLightFor([null, null, null]);
    assert.equal(neverAsked.light, 'grey', 'never evaluated stays grey');
    assert.notEqual(allNa.light, neverAsked.light, 'the two must never render alike');
  });

  test('partial evaluation is amber, not green — passing where we looked is not passing', () => {
    const r = deliveryLightFor(['present', 'present', null, null]);
    assert.equal(r.light, 'amber');
    assert.match(r.why, /2 never evaluated/);
  });

  test('all-pass with some n/a is green, and says how many did not apply', () => {
    const r = deliveryLightFor(['present', 'present', 'n/a']);
    assert.equal(r.light, 'green');
    assert.match(r.why, /1 n\/a/);
  });

  test('an UNRECOGNISED value scores nothing — it is not quietly treated as passing', () => {
    // a value this board cannot read must not become a green
    const r = deliveryLightFor(['present', 'WAT']);
    assert.equal(r.light, 'grey');
    assert.match(r.why, /unrecognised/);
  });

  test('a COUNT source never goes red — a dependency backlog is not a defect', () => {
    assert.equal(deliveryCountFor([0, 0]).light, 'green');
    const busy = deliveryCountFor([32, 7, null]);
    assert.equal(busy.light, 'amber', 'pending updates are a leading indicator, not a failure');
    assert.match(busy.why, /39 pending/);
    assert.match(busy.why, /1 never evaluated/);
  });
});

// ── lane E: the weakness-CLASS axis ───────────────────────────────────────────────────────────────
// Each approach DECLARES which CWE weakness-classes it looks for + an oracle tier, so a repo cleared
// only by lanes that never look for authz/business-logic/race is a DECLARED VOID, not a clean result.
describe('the weakness-class axis is declared, cross-checked against the rule map, and voids what nothing looks for', () => {
  const vocab = TAXONOMY.weaknessClassVocab;

  test('(a) every approach declares a weaknessClasses array of KNOWN slugs and an oracleTier in {1,2,3}', () => {
    assert.ok(vocab && typeof vocab === 'object', 'the taxonomy must declare a weaknessClassVocab universe');
    const known = new Set(Object.keys(vocab));
    assert.ok(known.size >= 10, `only ${known.size} classes declared — the class universe is implausibly small`);
    for (const [slug, def] of Object.entries(vocab)) {
      assert.equal(typeof def.label, 'string', `${slug} has no label`);
      assert.ok(Array.isArray(def.cwes), `${slug} has no cwes array`);
    }
    // The subject is DERIVED from a JSON file. An empty or renamed `approaches` makes every
    // assertion below run zero times and the test reports conformance it never checked.
    assert.ok(Array.isArray(TAXONOMY.approaches) && TAXONOMY.approaches.length >= 10,
      `approaches is ${Array.isArray(TAXONOMY.approaches) ? TAXONOMY.approaches.length : 'not an array'} — `
      + 'the conformance loop below would pass having examined nothing');
    for (const a of TAXONOMY.approaches) {
      assert.ok(Array.isArray(a.weaknessClasses),
        `${a.check} has no weaknessClasses array — an undeclared class axis silently reads as covered`);
      for (const c of a.weaknessClasses) {
        assert.ok(known.has(c), `${a.check} declares '${c}', absent from weaknessClassVocab — a typo'd class never voids`);
      }
      assert.ok([1, 2, 3].includes(a.oracleTier), `${a.check} has oracleTier ${a.oracleTier}; must be 1|2|3`);
    }
  });

  // A declared class must be BACKED by a rule the approach binds. Only lanes that declare `ruleIds`
  // (present in ruleId-cwe.json) are cross-checked — semgrep/gosec are deliberately unbound, because
  // ruleId-cwe.json is result-seeded and binding a broad ruleset to it would manufacture a false void.
  function staleClasses(approach) {
    if (!Array.isArray(approach.ruleIds) || !approach.ruleIds.length) return [];
    const backed = new Set();
    for (const rid of approach.ruleIds) for (const c of (RULE_CWE[rid] || [])) backed.add(c);
    return (approach.weaknessClasses || []).filter((slug) => {
      const cwes = (vocab[slug] && vocab[slug].cwes) || [];
      return cwes.length && !cwes.some((c) => backed.has(c));   // no bound rule backs any of the class's CWEs
    });
  }

  test('(b) a bound approach cannot declare a class no rule backs — a stale claim FAILS', () => {
    for (const a of TAXONOMY.approaches) {
      assert.deepEqual(staleClasses(a), [],
        `${a.check} declares a class its bound ruleIds do not back — stale declaration (over-claimed coverage)`);
    }
    const bound = TAXONOMY.approaches.filter((a) => Array.isArray(a.ruleIds) && a.ruleIds.length);
    assert.ok(bound.length >= 3, 'no approach binds ruleIds — the cross-check would run vacuously');
    for (const a of bound) for (const rid of a.ruleIds) {
      assert.ok(RULE_CWE[rid], `${a.check} binds ruleId '${rid}' absent from ruleId-cwe.json — the binding proves nothing`);
    }
    // non-vacuous the other way: a fabricated over-claim IS caught
    const bogus = { check: 'x', ruleIds: ['java/sql-injection'], weaknessClasses: ['cwe-79-xss'] };
    assert.deepEqual(staleClasses(bogus), ['cwe-79-xss'], 'a class with no backing rule must be flagged stale');
  });

  test('(c) weaknessClassVoids names the classes no in-scope lane covers, fails closed, and never returns [] as clean', () => {
    // a roster of only static SAST/secrets lanes looks for no access-control or business-logic class
    const sastOnly = weaknessClassVoids(TAXONOMY, new Set(['sast', 'sast-codeql', 'secrets']));
    const slugs = new Set(sastOnly.map((v) => v.class));
    assert.ok(slugs.has('cwe-284-authz'), 'a SAST-only roster looks for no authz class — authz must void');
    assert.ok(slugs.has('cwe-840-business-logic'), 'business-logic is covered by nothing, ever');
    for (const v of sastOnly) {
      assert.equal(v.kind, 'no-tool-class');
      assert.match(v.why, /no in-scope lane|nothing looks/i);
    }
    // FAIL CLOSED: a malformed taxonomy THROWS — an empty [] would read as "every class is covered"
    assert.throws(() => weaknessClassVoids({}, new Set(['sast'])), /vocab|approaches/i);
    // with EVERY lane in scope, the two hard voids remain and authz does NOT (it is declared by the probes)
    const full = weaknessClassVoids(TAXONOMY, new Set(TAXONOMY.approaches.map((a) => a.check)));
    const fullSlugs = new Set(full.map((v) => v.class));
    assert.ok(fullSlugs.has('cwe-840-business-logic') && fullSlugs.has('cwe-362-race'),
      'business-logic and race are declared by NO lane and must show even with every approach in scope');
    assert.ok(!fullSlugs.has('cwe-284-authz'), 'authz IS declared — with every lane in scope it is not a NO-lane void');
    assert.ok(!fullSlugs.has('*-advisory-dep'), 'the agnostic dependency class is the ecosystem axis, not a first-party class void');
  });
});

// ── the unknown tally, and the explicit uncertainty trap inside it ────────────────────────────────
// monitor/rollup.mjs publishes unknownFleet; posture is where a reader is already asking "what
// state is this fleet in", so the number belongs beside the lights. The trap is the ABSENT case: a
// slice rolled before the field existed must not report zero unknown, or the feature whose whole
// subject is grey publishes grey as green on every historical slice.
describe('the unknown tally', () => {
  test('a rollup that CARRIES the tally reports it, measured:true', () => {
    const b = board({ rollup: { ...ROLLUP, unknownFleet: { blocks: 3, total: 40, rate: 0.075, byReason: { unparseable: 2, 'no-subject': 1 } } } });
    assert.equal(b.unknown.measured, true);
    assert.equal(b.unknown.blocks, 3);
    assert.equal(b.unknown.total, 40, 'the denominator must survive — a count without one is not a rate');
    assert.equal(b.unknown.rate, 0.075);
    assert.deepEqual(b.unknown.byReason, { unparseable: 2, 'no-subject': 1 },
      'reasons come through, because a bare count is a number nobody can act on');
  });

  test('a rollup that PREDATES the tally reports measured:false and NULLS, never zero', () => {
    const { unknownFleet, ...withoutTally } = { ...ROLLUP, unknownFleet: undefined };
    const b = board({ rollup: withoutTally });
    assert.equal(b.unknown.measured, false);
    assert.equal(b.unknown.blocks, null,
      'zero would say "nothing is unknown" about a slice that never counted — unsupported finding');
    assert.equal(b.unknown.total, null);
    assert.equal(b.unknown.rate, null);
    assert.match(b.unknown.why, /predates/, 'and it says what to do about it');
  });

  test('NO rollup at all is distinguished from a rollup with no tally', () => {
    const b = board({ rollup: null });
    assert.equal(b.unknown.measured, false);
    assert.match(b.unknown.why, /no rollup/,
      'never measured for this area is a different fact from measured before the field existed');
  });

  test('a MEASURED zero is reported as zero, not as unmeasured', () => {
    // The mirror. If measured:true collapsed into the absent case, a fleet that genuinely has no
    // unknowns could never say so — unsupported findings.
    const b = board({ rollup: { ...ROLLUP, unknownFleet: { blocks: 0, total: 40, rate: 0, byReason: {} } } });
    assert.equal(b.unknown.measured, true);
    assert.equal(b.unknown.blocks, 0);
    assert.equal(b.unknown.rate, 0);
  });
});

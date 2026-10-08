// scanner-subject-taxonomy: the registry validates, and each guard actually REFUSES.
// A validator is only worth what it rejects, so every check below breaks the shipped registry in
// one specific way and asserts the specific error — never merely "some error was produced".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { redactionMapPath } from '../../lib/publish-redactions.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { labelVersusMeasurement, lensCoverage, loadParent, measureDistance, resolveSetPath, validate }
  from '../scanner-taxonomy-render.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REG = resolve(REPO, 'monitor', 'scanner-subject-taxonomy.json');
const load = () => JSON.parse(readFileSync(REG, 'utf8'));
const clone = (d) => JSON.parse(JSON.stringify(d));
const has = (errors, re) => errors.some((e) => re.test(e));

test('the shipped registry validates clean', () => {
  assert.deepEqual(validate(load()), []);
});

test('every cited parent id RESOLVES in the parent registry — the citation floor', () => {
  const doc = load();
  const { parent, error } = loadParent(doc);
  assert.equal(error, undefined);
  const ids = new Set(parent.classes.map((c) => c.id));
  const cited = [...new Set(doc.classes.flatMap((c) => c.inherits))];
  assert.ok(cited.length > 0, 'a registry that cites nothing has no floor to test');
  assert.deepEqual(cited.filter((id) => !ids.has(id)), []);
});

test('a dangling citation is REFUSED, not printed as a dead id', () => {
  const doc = clone(load());
  doc.classes.find((c) => c.inherits.length).inherits[0] = 'C99';
  assert.ok(has(validate(doc), /cites parent class C99, which does not exist/));
});

test('origin novel may carry no citations, and a citing origin must carry one', () => {
  const a = clone(load());
  const novel = a.classes.find((c) => c.origin === 'novel');
  novel.inherits = ['C1'];
  novel.originNote = 'x';
  assert.ok(has(validate(a), /origin novel must carry no inherits ids/));

  const b = clone(load());
  const cit = b.classes.find((c) => c.origin === 'transposed');
  cit.inherits = [];
  assert.ok(has(validate(b), /origin transposed requires at least one inherits id/));
});

test('a citation without an originNote is refused — that note is what separates a transposition from a duplicate', () => {
  const doc = clone(load());
  doc.classes.find((c) => c.inherits.length).originNote = '   ';
  assert.ok(has(validate(doc), /with no originNote/));
});

test('instrumentState is measured, so a named instrument that is not in the tree fails the render', () => {
  const doc = clone(load());
  const c = doc.classes.find((x) => x.instrumentState !== 'absent');
  c.instrument = 'monitor/does-not-exist.mjs';
  assert.ok(has(validate(doc), /instrument monitor\/does-not-exist\.mjs does not exist in the tree/));
});

test('instrumentState absent must carry a null instrument, and a stated one must not be null', () => {
  const a = clone(load());
  a.classes.find((c) => c.instrumentState === 'absent').instrument = 'monitor/sweep.mjs';
  assert.ok(has(validate(a), /instrumentState absent must carry instrument null/));

  const b = clone(load());
  b.classes.find((c) => c.instrumentState === 'wired').instrument = null;
  assert.ok(has(validate(b), /requires an instrument path/));
});

test('editions must account for EXACTLY the classes held, in both directions', () => {
  const a = clone(load());
  a.editions[0].ids = a.editions[0].ids.slice(1);
  assert.ok(has(validate(a), /is held by the registry and accounted for by no edition/));

  const b = clone(load());
  b.editions[1].ids.push(b.editions[0].ids[0]);
  assert.ok(has(validate(b), /more than once/));

  const c = clone(load());
  c.editions[1].ids.push('U99');
  assert.ok(has(validate(c), /editions list U99, which the registry does not hold/));
});

test('status and edition cannot disagree — the edition split IS the held/proposed split', () => {
  const doc = clone(load());
  doc.classes.find((c) => c.status === 'held').status = 'proposed';
  assert.ok(has(validate(doc), /status proposed disagrees with edition 1/));
});

test('a lens outside the vocabulary is refused, and every declared lens names a module that exists', () => {
  const a = clone(load());
  a.classes[0].lens = ['not-a-lens'];
  assert.ok(has(validate(a), /lens "not-a-lens" is not in the lenses vocabulary/));

  const b = clone(load());
  b.lenses['hash-chaining'].instruments = ['bin/nope.mjs'];
  assert.ok(has(validate(b), /instrument bin\/nope\.mjs does not exist/));
});

test('the stpa vocabulary is READ from the parent, never restated here', () => {
  const doc = clone(load());
  doc.classes[0].stpa[0].loop = 'not-a-loop';
  assert.ok(has(validate(doc), /is not in the parent's stpaVocabulary\.loops/));
  assert.equal(doc.stpaVocabulary, undefined, 'a local copy would be a second bound that cannot notice the first moving');
});

test('numbering is 1..n per family, with no gap or duplicate', () => {
  const doc = clone(load());
  const c = doc.classes.find((x) => x.id === 'U9');
  c.id = 'U12';
  doc.editions.find((e) => e.ids.includes('U9')).ids = doc.editions.find((e) => e.ids.includes('U9')).ids.map((i) => (i === 'U9' ? 'U12' : i));
  assert.ok(has(validate(doc), /numbering is not 1\.\.n/));
});

test('full closure is absent AND declared; removing the declaration is refused, and so is contradicting it', () => {
  const doc = load();
  assert.ok(!doc.classes.some((c) => c.closure >= doc.scaleBounds.fullyClosed),
    'if a class ever reaches full closure, fullClosureAbsent must be removed in the same change');

  const a = clone(doc); a.fullClosureAbsent = '';
  assert.ok(has(validate(a), /fullClosureAbsent does not say so/));

  const b = clone(doc); b.classes[0].closure = b.scaleBounds.fullyClosed;
  assert.ok(has(validate(b), /fullClosureAbsent claims nothing reaches full closure, and a class does/));
});

test('a parent registry that cannot be read fails CLOSED — never "no citations to check"', () => {
  const doc = clone(load());
  doc.parentRegistry = 'monitor/no-such-parent.json';
  const prev = process.env.CW_TAXONOMY_JSON;
  delete process.env.CW_TAXONOMY_JSON;
  try {
    assert.ok(has(validate(doc), /could not be read .* so nothing here can be reported valid without it/));
  } finally { if (prev !== undefined) process.env.CW_TAXONOMY_JSON = prev; }
});

test('lens coverage names uncovered lenses rather than failing — padding a taxonomy to fill a table is the worse defect', () => {
  const cov = lensCoverage(load());
  assert.deepEqual(cov.uncovered, [], 'every declared lens is currently carried by at least one class');
  assert.equal(Object.keys(cov.counts).length, Object.keys(load().lenses).length);
});

test('label-vs-measurement asserts BOTH directions, and inherited+near counts as agreement not disagreement', () => {
  const doc = load();
  const { report } = measureDistance(doc);
  assert.ok(report, 'the parent registry is present, so distance must be measured');
  const lvm = labelVersusMeasurement(doc, report);
  assert.ok(lvm.confirmed > 0, 'the confirmed count is the denominator the disagreement count is read against');
  for (const r of lvm.rows) assert.match(r.direction, /^(over-claimed|under-claimed)$/);
  // An inherited class measured NEAR its citation must never be reported as a disagreement.
  const inheritedNear = lvm.rows.filter((r) => r.origin === 'inherited' && r.verdict !== 'distinct');
  assert.deepEqual(inheritedNear, [], 'inherited means "applies verbatim", so measuring it as a duplicate is agreement');
});

// The sidecar set is an INPUT this checkout may not have, and "I have no such input" is a different
// state from "the file is not there". Read at call time: a const at load would make the first case
// below pass while proving nothing about the override.
test('$CW_SIDECAR in a reference set path is expanded at call time, and names the missing input when it cannot be', () => {
  const prev = process.env.CW_SIDECAR;
  const dir = mkdtempSync(join(tmpdir(), 'cw-tax-sidecar-'));
  try {
    process.env.CW_SIDECAR = dir;
    assert.equal(resolveSetPath('$CW_SIDECAR/documents/x.json', '/anywhere/repo').path, join(dir, 'documents/x.json'),
      'the env var wins over the default beside the checkout');

    process.env.CW_SIDECAR = join(dir, 'no-such-sidecar');
    const set = resolveSetPath('$CW_SIDECAR/documents/x.json', '/anywhere/repo');
    assert.equal(set.path, null, 'a sidecar that is not there must not resolve to a path');
    assert.match(set.why, /^missing input: CW_SIDECAR names .*no-such-sidecar, which does not exist$/);

    delete process.env.CW_SIDECAR;
    const unset = resolveSetPath('$CW_SIDECAR/documents/x.json', '/public/clone/commitwork');
    assert.equal(unset.path, null);
    assert.match(unset.why, /^missing input: CW_SIDECAR is unset and its default \/public\/clone\/commitwork-sidecar does not exist$/,
      'a public clone is told which input it lacks, not that a file inside the repo is absent');

    assert.equal(resolveSetPath('monitor/failure-taxonomy.json', '/public/clone/commitwork').path,
      '/public/clone/commitwork/monitor/failure-taxonomy.json', 'a repo-relative path is unaffected');
  } finally {
    if (prev === undefined) delete process.env.CW_SIDECAR; else process.env.CW_SIDECAR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a sidecar set read through CW_SIDECAR is the one measured — the effect, not the resolution', () => {
  const prev = process.env.CW_SIDECAR;
  const dir = mkdtempSync(join(tmpdir(), 'cw-tax-sidecar-'));
  try {
    mkdirSync(join(dir, 'documents', 'tools'), { recursive: true });
    writeFileSync(join(dir, 'documents', 'tools', 'proposed.json'),
      JSON.stringify([{ id: 'Z1', title: 'planted', def: 'planted for this probe' }]));
    process.env.CW_SIDECAR = dir;
    const { unmeasured, report } = measureDistance(load());
    assert.deepEqual(unmeasured, [], 'the set the env var names was found');
    assert.ok(report.baselines.proposed, 'and it contributed a baseline');
    // One planted row cannot have a nearest neighbour, which is what reading THIS file looks like.
    assert.equal(report.baselines.proposed.n ?? 1, 1);
  } finally {
    if (prev === undefined) delete process.env.CW_SIDECAR; else process.env.CW_SIDECAR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a reference set absent from this machine is UNMEASURED, not zero distance', () => {
  const doc = clone(load());
  doc.referenceSets.push({ name: 'ghost', path: 'monitor/definitely-not-here.json', pick: 'classes' });
  const { unmeasured, report } = measureDistance(doc);
  assert.ok(unmeasured.some((u) => u.name === 'ghost'));
  assert.equal(report.baselines.ghost, undefined, 'an absent set must contribute no baseline at all');
});

// fact: the SCHEMA itself refuses, not only the hand-written guards beside it / this is what makes
// the inventory's binding "validator" honest rather than "mirrored" — the schema is applied at
// runtime by the consumer that owns the read, and it bites on a key no semantic guard inspects.
test('the schema itself REFUSES — an unknown top-level key is rejected by the schema, not by a guard', () => {
  const doc = load();
  doc.smuggledKey = 'not in the schema';
  const errors = validate(doc);
  assert.ok(has(errors, /unknown key 'smuggledKey'/),
    `additionalProperties:false must reject it; got ${JSON.stringify(errors)}`);
});

// fact: a missing required structure REFUSED rather than threw / before the shape floor, deleting
// any of the seven structures the semantic guards dereference crashed validate() with a TypeError
// at the first `.find` — the schema had already recorded the omission, and the crash happened
// before the function could return it. A stack trace is not a refusal.
test('THE SHAPE FLOOR: EVERY required field the schema names is REFUSED when absent, never thrown', () => {
  // The population is READ FROM THE SCHEMA, not listed here. The first version of this test listed
  // seven fields by hand and passed, while `parentRegistry` — required, unlisted — still threw a
  // TypeError at loadParent's resolve(repo, undefined). A test that names its own subjects can only
  // ever confirm the guard on the cases its author already thought of, which is the same defect the
  // guard had. Deriving both from one source is what makes a field added later covered by default.
  const schema = JSON.parse(readFileSync(resolve(REPO, 'schema', 'scanner-subject-taxonomy.schema.json'), 'utf8'));
  const required = schema.required || [];
  assert.ok(required.length >= 13, `only ${required.length} required fields — this check may be vacuous`);
  for (const field of required) {
    const doc = load();
    delete doc[field];
    let errors;
    assert.doesNotThrow(() => { errors = validate(doc); }, `${field}: validate() threw instead of refusing`);
    assert.ok(has(errors, new RegExp(`^${field} is missing`)),
      `${field}: expected a refusal naming it; got ${JSON.stringify(errors).slice(0, 200)}`);
  }
});

test('the shape floor refuses a wrong CONTAINER, and does not fire on a merely wrong scalar', () => {
  // Both halves matter. An array where an object is read still throws, so it is gated. But `integer`
  // vs `number` is a schema distinction that never crashes a guard, and checking it here reported
  // the SHIPPED register dirty on `version` and took 14 tests down with it. The floor stops a
  // TypeError; it is not a second JSON Schema.
  const a = load(); a.classes = {};
  assert.ok(has(validate(a), /^classes is object where the checks below iterate an array/));
  const b = load(); b.origins = [];
  assert.ok(has(validate(b), /^origins is an array where the checks below read an object/));
  const c = load(); c.parentRegistry = 42;
  assert.ok(has(validate(c), /^parentRegistry is number where the checks below resolve it as a path/));

  const d = load(); d.version = 1.5; // integer -> number: the schema's to report, not the floor's
  assert.ok(!has(validate(d), /the checks below read it, and a guard that throws/),
    'the shape floor fired on a scalar type it has no business gating');
});
// fact: this renderer redacts at its own boundary / it was the THIRD generator writing a public
// page and the only one with no redaction wired. The page was clean, but only because nothing in
// the customer map had reached this register — detection (the fleet-wide page scans) without
// prevention. This asserts the EFFECT end to end: a mapped name placed in the register must not
// survive into the rendered page, and the register itself must still carry it.
// The publish map is a private store (lib/publish-redactions.mjs); a public checkout skips and names it.
test('a customer name in the register does NOT reach the rendered page', existsSync(redactionMapPath()) ? {} : { skip: `private publish map absent at ${redactionMapPath()}` }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync: rf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const map = JSON.parse(rf(redactionMapPath(), 'utf8')).map;
  const [source, replacement] = Object.entries(map).sort((a, b) => b[0].length - a[0].length)[0];

  const doc = load();
  doc.classes[0].example = `${doc.classes[0].example} Seen first on ${source}.`;
  const dir = mkdtempSync(join(tmpdir(), 'cw-scanred-render-'));
  const reg = join(dir, 'reg.json');
  const out = join(dir, 'page.html');
  writeFileSync(reg, JSON.stringify(doc));

  execFileSync(process.execPath, [resolve(REPO, 'bin', 'scanner-taxonomy-render.mjs'), '--json', reg, '--out', out],
    { cwd: REPO, stdio: 'pipe' });

  const page = rf(out, 'utf8');
  assert.ok(!page.includes(source), 'the customer name reached the published page');
  assert.ok(page.includes(replacement), 'the replacement is absent — redaction did not run at all');
  assert.ok(rf(reg, 'utf8').includes(source), 'the register lost the real name; it is supposed to keep it');
});

// docs/THEME.md §11: this page interpolates the house values under its own names, so "partial" and
// "adjacent" read --part in the theme rendered, not a third amber of their own. An empty redaction
// map stands in for the private one, so the render runs in a public checkout.
test('partial and adjacent take --part from lib/brand-tokens.mjs in both themes, never a literal', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync: rf } = await import('node:fs');
  const { LIGHT_SEMANTIC, DARK_SEMANTIC } = await import('../../lib/brand-tokens.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'cw-scantax-part-'));
  try {
    const map = join(dir, 'redactions.json');
    writeFileSync(map, JSON.stringify({ note: 'test fixture: nothing to redact', map: {} }));
    for (const [dark, want] of [[false, LIGHT_SEMANTIC.part], [true, DARK_SEMANTIC.part]]) {
      const out = join(dir, dark ? 'dark.html' : 'light.html');
      execFileSync(process.execPath, [resolve(REPO, 'bin', 'scanner-taxonomy-render.mjs'), ...(dark ? ['--dark'] : []), '--json', REG, '--out', out],
        { cwd: REPO, stdio: 'pipe', env: { ...process.env, CW_PUBLISH_REDACTIONS: map } });
      const page = rf(out, 'utf8');
      const root = /:root \{([^}]*)\}/.exec(page)[1];
      assert.match(root, new RegExp(`--part:${want};`), `${dark ? 'dark' : 'light'} --part is not the house value`);
      for (const cls of ['st-partial', 'd-adjacent']) {
        assert.match(page, new RegExp(`\\.${cls} \\{ color:var\\(--part\\); \\}`), cls);
      }
      assert.ok(!page.includes('#c9992f;'), 'a literal amber is back in a status rule');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// docs/THEME.md §3.4: the closure and gain dials take the escalation ramp, so they follow the theme
// rendered. Until 2026-10-07 they drew from two five-step ramps of their own, the same in both themes.
test('the closure and gain dials take the escalation ramp, and the renderer holds no colour literal', async () => {
  const { readFileSync: rf } = await import('node:fs');
  const { CLOSURE_RAMP, GAIN_RAMP } = await import('../scanner-taxonomy-render.mjs');
  assert.deepEqual(GAIN_RAMP && [...GAIN_RAMP.slice(1)], ['low', 'med', 'high', 'crit'], 'gain does not climb the escalation ramp');
  assert.deepEqual(CLOSURE_RAMP && [...CLOSURE_RAMP], ['crit', 'high', 'med', 'low', 'ok'], 'closure does not descend it to --ok');
  assert.doesNotMatch(rf(resolve(REPO, 'bin', 'scanner-taxonomy-render.mjs'), 'utf8'), /['"]#[0-9a-fA-F]{3,8}['"]/,
    'a colour literal is back in the renderer');
});

test('the dials render from tokens declared on :root, with each theme\'s values', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync: rf } = await import('node:fs');
  const { LIGHT, DARK, LIGHT_SEMANTIC, DARK_SEMANTIC } = await import('../../lib/brand-tokens.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'cw-scantax-dials-'));
  try {
    const map = join(dir, 'redactions.json');
    writeFileSync(map, JSON.stringify({ note: 'test fixture: nothing to redact', map: {} }));
    const seen = {};
    for (const [dark, base, sem] of [[false, LIGHT, LIGHT_SEMANTIC], [true, DARK, DARK_SEMANTIC]]) {
      const out = join(dir, dark ? 'dark.html' : 'light.html');
      execFileSync(process.execPath, [resolve(REPO, 'bin', 'scanner-taxonomy-render.mjs'), ...(dark ? ['--dark'] : []), '--json', REG, '--out', out],
        { cwd: REPO, stdio: 'pipe', env: { ...process.env, CW_PUBLISH_REDACTIONS: map } });
      const page = rf(out, 'utf8');
      const root = /:root \{([^}]*)\}/.exec(page)[1];
      const want = { ok: base.ok, crit: base.crit, plan: sem.plan, low: sem.low, med: sem.med, high: sem.high };
      for (const [t, v] of Object.entries(want)) assert.match(root, new RegExp(`--${t}:${v};`), `${dark ? 'dark' : 'light'} --${t} is not the house value`);
      const rings = page.match(/<svg class="ring"[\s\S]*?<\/svg>/g) || [];
      assert.ok(rings.length > 10, 'no dials rendered');
      const strokes = rings.flatMap((r) => [...r.matchAll(/(?:stroke|fill)="([^"]+)"/g)].map((m) => m[1])).filter((v) => v !== 'none');
      assert.deepEqual(strokes.filter((v) => !/^var\(--[a-z]+\)$/.test(v)), [], 'a dial colour is not a token');
      for (const v of new Set(strokes)) assert.match(root, new RegExp(`${v.slice(4, -1)}:`), `${v} is not declared on :root`);
      seen[dark] = root;
    }
    assert.notEqual(seen.false, seen.true, 'the two themes rendered the same palette');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

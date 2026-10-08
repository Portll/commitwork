// taxonomy-mitigations.test.mjs — the mitigation axis (what each product does against a class, and
// what is proposed) is read from the registry's vocabulary, never restated; a class with nothing
// recorded renders NO RECORD in grey rather than blank; a proposal is refused where nothing is left
// to propose against; and the page leads with its two introductions and its family index.
// Runs on a FIXTURE registry (CW_TAXONOMY_JSON / --json), so the real registry decides nothing here
// except in the one test that names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../taxonomy-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER_CLI = resolve(HERE, '..', 'taxonomy-render.mjs');
const REGISTRY = resolve(HERE, '..', '..', 'monitor', 'failure-taxonomy.json');

const t = (s) => ({ test: s });
const STPA_VOCAB = {
  loops: {
    operator: { controller: 'the operator', controls: 'configuration', test: 'The controller is the operator.' },
    monitor: { controller: 'the monitor', controls: 'its runs', test: 'The controller is the monitor.' },
  },
  uca: { 'not-provided': t('never issued'), unsafe: t('wrong for the state'), none: t('no control action') },
  cause: { 'feedback-missing': t('no signal'), 'controller-model': t('model wrong') },
};
const PROVENANCE = { rater: 'one reader', date: '2026-09-06', method: 'from class text', caveat: 'single rater; unreviewed' };
const RCA_VOCAB = { symmetries: { none: { test: 'names no target' } }, relations: { unassessed: { symmetry: 'none', terminal: true, test: 'fixture' } } };
const MIT_VOCAB = {
  products: {
    commitwork: { layer: 'remediation', test: 'The record names a mechanism in commitwork and the state it is in.' },
    spine: { layer: 'remediation', test: 'The record names a mechanism in spine and the state it is in.' },
    'memory-layer': { layer: 'help', test: 'The record names what memory-layer does, or fails to do, against the class.' },
    'overwatch-layer': { layer: 'help', test: 'The record names what overwatch-layer does, or fails to do, against the class.' },
  },
  statuses: {
    implemented: t('exists, production reaches it, and a test or measured run shows the effect'),
    partial: t('a named half exists and executes'),
    open: t('nothing executes'),
    unassessed: t('filed and never audited against the code'),
  },
};
const mit = (product, status, what) => ({ product, status, what, evidence: `fixture evidence for ${what}`, date: '2026-09-06' });

const cls = (id, machine, closure, gain, extra = {}) => ({
  id, name: `Class ${id}`, machine, layer: 'CTRL', description: `d ${id}`, analogy: `a ${id}`, example: `e ${id}`,
  predicate: `A fixture predicate for ${id}, deliberately long enough to satisfy the schema minimum.`,
  closure, gain, scoreBasis: 'fixture',
  stpa: [{ loop: 'monitor', uca: 'unsafe', cause: 'feedback-missing' }], rca: [{ relation: 'unassessed' }],
  ...extra,
});

const fixture = () => ({
  version: 15, generatedFrom: ['fixture'], verifiedAgainst: 'fixture', note: 'fixture',
  intro: {
    public: 'A plain-language sentence for anyone, long enough to clear the schema minimum length comfortably.',
    academic: 'A sentence for a postdoctoral reader, also long enough to clear the schema minimum length.',
  },
  families: [
    { roman: 'I', key: 'false_clean', prefix: 'C', name: 'False clean', proposition: 'nothing is wrong' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'},
    { roman: 'IX', key: 'false_control', prefix: 'K', name: 'False control', proposition: 'the deciding layer decided it' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'},
  ],
  classes: [
    // Closed: no proposal applies, and the row says so in words rather than grey.
    cls('C1', 'false_clean.one', 4, 0),
    // Open with a record on both layers and a proposal.
    cls('C2', 'false_clean.two', 2, 3, {
      mitigations: [mit('commitwork', 'partial', 'a private index per session'), mit('memory-layer', 'open', 'no readback after a write')],
      proposals: [{ what: 'assert a readback after every write', effort: 'Low', date: '2026-09-06', by: 'fixture', closesTo: 3 }],
    }),
    // Open with nothing recorded anywhere: NO RECORD on both layers, no proposal recorded.
    cls('K1', 'false_control.one', 0, 3),
  ],
  scales: { closure: '0 = nothing stands between us and this class; 4 = fixed and pinned', gain: '0 = nothing further; 4 = biggest available' },
  remediations: [], attributionPlan: [],
  scoreProvenance: 'fixture', scaleBounds: { closureMin: 0, closureMax: 4, gainMin: 0, gainMax: 4, fullyClosed: 4 },
  stpaVocabulary: structuredClone(STPA_VOCAB), stpaProvenance: { ...PROVENANCE },
  rcaVocabulary: structuredClone(RCA_VOCAB), rcaProvenance: { ...PROVENANCE },
  mitigationVocabulary: structuredClone(MIT_VOCAB), mitigationProvenance: { ...PROVENANCE },
});

const tmp = () => mkdtempSync(join(tmpdir(), 'cw-mit-'));
const writeReg = (dir, doc) => { const p = join(dir, 'registry.json'); writeFileSync(p, JSON.stringify(doc)); return p; };
function run(cli, args, env = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
// The page is redacted on write and the render refuses without a map. The live map is private and
// absent from a clone, so the page tests hand the render a synthetic one.
const writeMap = (dir) => {
  const p = join(dir, 'publish-redactions.json');
  writeFileSync(p, JSON.stringify({ note: 'fixture', map: { 'acme-fixture-ltd': 'client-fixture' } }));
  return p;
};
const render = (doc) => {
  const dir = tmp();
  const reg = writeReg(dir, doc);
  const out = join(dir, 'page.html');
  const r = run(RENDER_CLI, ['--json', reg, '--out', out], { CW_PUBLISH_REDACTIONS: writeMap(dir) });
  assert.equal(r.code, 0, r.stderr);
  return readFileSync(out, 'utf8');
};

test('the fixture validates, and absence of records is legal — it is the axis\'s dominant state', () => {
  assert.deepEqual(validate(fixture()), []);
  const bare = fixture();
  delete bare.mitigationVocabulary; delete bare.mitigationProvenance;
  for (const c of bare.classes) { delete c.mitigations; delete c.proposals; }
  assert.deepEqual(validate(bare), [], 'a registry without the axis at all is still a valid registry');
});

test('the vocabulary is closed: an unknown product, status or layer is refused by name', () => {
  const doc = fixture();
  doc.classes[1].mitigations.push(mit('sleight', 'open', 'x'));
  assert.match(validate(doc).join('\n'), /C2: mitigations\[2\]\.product "sleight" is not in mitigationVocabulary\.products/);
  const doc2 = fixture();
  doc2.classes[1].mitigations[0].status = 'done';
  assert.match(validate(doc2).join('\n'), /C2: mitigations\[0\]\.status "done" is not in mitigationVocabulary\.statuses/);
  const doc3 = fixture();
  doc3.mitigationVocabulary.products['memory-layer'].layer = 'helps';
  assert.match(validate(doc3).join('\n'), /mitigationVocabulary\.products\.memory-layer: layer must be one of remediation\|help/);
});

test('entries carry evidence and a date; the vocabulary carries a witness', () => {
  const doc = fixture();
  doc.classes[1].mitigations[0].evidence = '';
  assert.match(validate(doc).join('\n'), /C2: mitigations\[0\] has no evidence/);
  const doc2 = fixture();
  doc2.classes[1].mitigations[1].date = '6 Sept';
  assert.match(validate(doc2).join('\n'), /C2: mitigations\[1\]\.date "6 Sept" is not YYYY-MM-DD/);
  const doc3 = fixture();
  delete doc3.mitigationProvenance;
  assert.match(validate(doc3).join('\n'), /mitigationProvenance is missing or incomplete/);
  const doc4 = fixture();
  delete doc4.mitigationVocabulary; delete doc4.mitigationProvenance;
  assert.match(validate(doc4).join('\n'), /mitigationVocabulary is missing while 1 class\(es\) carry mitigations or proposals/);
});

test('a proposal is refused where nothing is left to propose against', () => {
  const closed = fixture();
  closed.classes[0].proposals = [{ what: 'x', effort: 'Low', date: '2026-09-06', by: 'fixture' }];
  assert.match(validate(closed).join('\n'), /C1: proposals\[0\] on a class at closure 4 and gain 0/);
  const spent = fixture();
  spent.classes[2].gain = 0;
  spent.classes[2].proposals = [{ what: 'x', effort: 'Low', date: '2026-09-06', by: 'fixture' }];
  assert.match(validate(spent).join('\n'), /K1: proposals\[0\] on a class at closure 0 and gain 0/);
  const bad = fixture();
  bad.classes[1].proposals[0].effort = 'Trivial';
  bad.classes[1].proposals[0].closesTo = 9;
  const errs = validate(bad).join('\n');
  assert.match(errs, /C2: proposals\[0\]\.effort "Trivial" is not Low\|Med\|High/);
  assert.match(errs, /C2: proposals\[0\]\.closesTo 9 is not a closure level/);
});

test('G14 / G13: a minted class argues against a neighbour, and a closure rise cites an artefact', () => {
  const doc = fixture();
  doc.classes[2].scoreBasis = 'Minted 2026-09-06 on one instance and a hunch.';
  assert.match(validate(doc).join('\n'), /K1: minted with no separating observation/);
  doc.classes[2].scoreBasis = 'Minted 2026-09-06 on one instance. Against C2: the selector is empty here, not filtered.';
  assert.deepEqual(validate(doc).filter((e) => /K1/.test(e)), [], '"Against <id>" satisfies the rule without the label');
  const rise = fixture();
  rise.classes[2].scoreBasis = 'fixture RE-RATED 2026-09-06 by x: closure 0→2, gain 3→2. Because it felt closed.';
  assert.match(validate(rise).join('\n'), /K1: closure rose 0→2 with no sha, path or register item cited/);
  rise.classes[2].scoreBasis = 'fixture RE-RATED 2026-09-06 by x: closure 0→2, gain 3→2. bin/test/lexical-ratchets.test.mjs holds the line.';
  assert.deepEqual(validate(rise).filter((e) => /K1/.test(e)), [], 'a cited path satisfies it');
  rise.classes[2].scoreBasis = 'fixture RE-RATED 2026-09-06 by x: closure 2→0, gain 3→2. No artefact needed for a fall.';
  assert.deepEqual(validate(rise).filter((e) => /K1/.test(e)), [], 'a fall needs no citation');
});

test('a family declares the sentence a second rater applies, and it may not be the proposition restated', () => {
  // Present and long enough: the schema's job. A family that cannot refuse a member is how family
  // VI absorbed eight rows about a different subject, measured 2026-09-07.
  const missing = fixture();
  delete missing.families[0].test;
  assert.match(validate(missing).join('\n'), /families\[0\]: required key 'test' is missing/);
  const tooShort = fixture();
  tooShort.families[0].test = 'too short';
  assert.match(validate(tooShort).join('\n'), /families\[0\]\.test: string of length 9 is shorter than minLength 60/);
  // The cheapest way to satisfy the field is to paste the proposition into it, which leaves the
  // family exactly as unable to refuse anything as before. validate() refuses that by name.
  const restated = fixture();
  restated.families[0].test = `A class belongs here when the false proposition is ${restated.families[0].proposition} and nothing more is asked of it.`;
  assert.match(validate(restated).join('\n'), /family I: the test restates the proposition/);
  // A genuinely discriminating test passes.
  assert.deepEqual(validate(fixture()), []);
});

test('the page renders each family\'s membership test beside its proposition', () => {
  const html = render(fixture());
  assert.match(html, /<span class="prop">The false proposition: “nothing is wrong”<\/span>\s*<span class="ftest"><span class="lbl">membership test<\/span>A fixture membership test/);
  assert.equal((html.match(/class="ftest"/g) || []).length, 2, 'one per family');
});

test('the intro, when present, must carry both sentences', () => {
  const doc = fixture();
  doc.intro.academic = ' ';
  assert.match(validate(doc).join('\n'), /intro must carry non-empty public and academic sentences/);
});

test('the page: two introductions first, the family index in order, one merged text column, meters with text twins', () => {
  const html = render(fixture());
  const at = (s) => { const i = html.indexOf(s); assert.ok(i >= 0, `page lacks ${JSON.stringify(s)}`); return i; };
  assert.ok(at('class="intro public"') < at('class="intro academic"'), 'the public sentence leads');
  assert.ok(at('class="intro academic"') < at('class="meta"'), 'both introductions precede the meta block');
  assert.ok(at('class="famindex"') < at('<section id="fam-C">'), 'the family index precedes the first family');
  assert.ok(at('href="#fam-C"') < at('href="#fam-K"'), 'families are listed in registry order');
  assert.match(html, /<th>Description · analogy · example<\/th>/);
  assert.doesNotMatch(html, /<th>Example<\/th>/, 'the example is no longer its own column');
  assert.match(html, /<td class="text">d C2\s*<span class="analogy"><span class="lbl">analogy<\/span>a C2<\/span>\s*<span class="example"><span class="lbl">example<\/span>e C2<\/span><\/td>/,
    'description, analogy and example stack in one cell, in that order');
  assert.match(html, /<span class="score closure" title="closure 2 of 4: part-solved">[\s\S]*?<span class="v">2<\/span><\/span>/, 'the meter carries its level as text');
  assert.match(html, /aria-label="gain 3 of 4: high"/);
  assert.doesNotMatch(html, /class="ring"/, 'the rings are gone');
  assert.match(html, /<svg class="dist"[^>]*aria-label="closure distribution, levels 0 to 4: 0, 0, 1, 0, 1"/, 'family C: C1 at 4, C2 at 2');
  assert.match(html, /<span class="twin">0·0·1·0·1<\/span>/, 'and the counts ride beside the bar as text');
  // The shell owns .tw (its table wrapper, with a 1.2rem margin); this page must not wear it.
  assert.doesNotMatch(html, /class="tw"/, 'no element borrows the shell\'s .tw class');
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)="https?:/i, 'no CDN, file:// safe');
  assert.doesNotMatch(html, /<script/i, 'the toggles are CSS-only');
});

test('the layers: three toggles, one mitigation row per class, NO RECORD in grey, closed said in words', () => {
  const html = render(fixture());
  for (const id of ['lay-rem', 'lay-help', 'lay-prop']) assert.match(html, new RegExp(`<input type="checkbox" id="${id}" checked>`));
  assert.equal((html.match(/<tr class="mit">/g) || []).length, 3, 'one mitigation row per class');
  assert.equal((html.match(/<tr class="cls">/g) || []).length, 3);
  // C2 carries a commitwork record on the remediation layer and a memory-layer record on the help layer.
  assert.match(html, /<span class="lay l-rem"><span class="lk">commitwork · spine<\/span><span class="ent"><span class="tag prod">commitwork<\/span><span class="tag st partial" title="a named half exists and executes">partial<\/span> a private index per session/);
  assert.match(html, /<span class="lay l-help"><span class="lk">memory-layer · overwatch-layer<\/span><span class="ent"><span class="tag prod">memory-layer<\/span><span class="tag st open"/);
  assert.match(html, /<span class="tag st proposed">proposed<\/span> assert a readback after every write <span class="ev">effort Low · would reach closure 3 · fixture · 2026-09-06<\/span>/);
  // K1 has nothing anywhere: grey on both layers and on the proposal slot — never blank.
  const k1 = html.slice(html.indexOf('<td class="id">K1'), html.indexOf('</section>', html.indexOf('<td class="id">K1')));
  assert.equal((k1.match(/>no record</g) || []).length, 2, 'K1: no record on the remediation AND the help layer');
  assert.match(k1, />no proposal recorded</);
  // C1 is closed: the proposal slot says so in words, and does NOT read as an unrecorded slot.
  const c1 = html.slice(html.indexOf('<td class="id">C1'), html.indexOf('<td class="id">C2'));
  assert.match(c1, /closed — no proposal applies/);
  assert.doesNotMatch(c1, />no proposal recorded</);
  assert.equal((c1.match(/>no record</g) || []).length, 2, 'closed is not the same as recorded: C1 still has no mitigation record');
  // The CSS toggles exist and print overrides them.
  assert.match(html, /\.taxref:has\(#lay-rem:not\(:checked\)\) \.lay\.l-rem/);
  // The row and its layers must not share a class: a block rule reaching the <tr> collapses the
  // colspan cell to the first column (measured 2026-09-06). Assert the separation structurally.
  assert.doesNotMatch(html, /<tr class="[^"]*\blay\b/, 'the row never carries the layer class');
  assert.doesNotMatch(html, /\.taxref \.mit \{/, 'no bare .mit rule can reach the row');
  assert.match(html, /@media print \{[\s\S]*?\.taxref tr\.mit \{ display:table-row !important; \}/);
});

test('--check prints the mitigation census, leading with NO RECORD', () => {
  const dir = tmp();
  const reg = writeReg(dir, fixture());
  const r = run(RENDER_CLI, ['--check'], { CW_TAXONOMY_JSON: reg });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /mitigations — 2\/3 NO RECORD on any layer; classes with a record per product: commitwork:1 spine:0 memory-layer:1 overwatch-layer:0; proposals on 1 of 2 classes with closure possible and gain remaining/);
});

test('the real registry: if it carries the axis, every entry is inside the vocabulary and the census derives', () => {
  const doc = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  if (!doc.mitigationVocabulary) { console.log('ℹ real registry carries no mitigationVocabulary yet — nothing to assert'); return; }
  const errs = validate(doc).filter((e) => /mitigation|proposal|intro/.test(e));
  assert.deepEqual(errs, []);
  const r = run(RENDER_CLI, ['--check'], { CW_TAXONOMY_JSON: REGISTRY });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /mitigations — \d+\/\d+ NO RECORD on any layer/);
});

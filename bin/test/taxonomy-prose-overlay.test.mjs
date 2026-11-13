// node --test bin/test/taxonomy-prose-overlay.test.mjs
//
// The register's PROSE is split across the publication boundary, and this pins both halves.
//
// An instance account names the tool the instance was measured in, and that name is what lets
// another reader go and look — so stripping it leaves a record nobody can re-audit. The split
// instead: the tracked register names the CAPABILITY, declares that vocabulary in
// `fleetVocabulary` so a reader can SEE that a product name was generalised, and the sentences as
// they were written sit in the private overlay mergeProseOverlay() applies at render time.
//
// THE DIRECTION THAT MATTERS, as with the mitigation overlay beside this file: an ABSENT overlay is
// the PUBLIC shape, and an overlay that EXISTS and cannot be used is a refusal. Those are one line
// apart in the code and opposite in consequence, so they are asserted separately.
//
// The second witness is here too, and it cannot share a failure mode with the first. The merge
// reads the PRIVATE half against the tracked file and refuses when a public sentence it names has
// moved; validateFleetVocabulary() (through validate(), below) reads the TRACKED file alone and
// refuses a declared term that appears in no prose. One needs the private store to run at all; the
// other must work in a clone that has none.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeProseOverlay, validate } from '../taxonomy-render.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'tax-prose-'));
const PUBLIC = 'measured in the memory store, 2026-01-01';
const PRIVATE = 'measured in example-sibling-service, 2026-01-01';

// A register small enough to read, carrying one of each record kind the overlay can address.
const register = () => ({
  version: 4,
  note: `the note's own prose, ${PUBLIC}`,
  classes: [
    { id: 'C1', scoreBasis: PUBLIC, example: 'untouched' },
    { id: 'C2', example: 'nothing generalised here' },
  ],
  remediations: [{ title: 'R one', action: `do it, ${PUBLIC}` }],
  cycleLog: [{ cycle: 'first cycle', note: `folded, ${PUBLIC}` }],
  attributionPlan: [{ area: 'Gating', mechanism: `keyed wrong, ${PUBLIC}` }],
});
const write = (dir, doc) => { const p = join(dir, 'prose.json'); writeFileSync(p, JSON.stringify(doc)); return p; };
const overlay = (prose) => ({ version: 1, prose });
const pair = (pub = PUBLIC, priv = PRIVATE) => ({ public: pub, private: priv });

describe('an absent overlay is the public shape, not a failure', () => {
  test('the register comes back untouched, still carrying the public sentence', () => {
    const dir = scratch();
    try {
      const doc = mergeProseOverlay(register(), { path: join(dir, 'nothing-here.json') });
      assert.equal(doc.classes[0].scoreBasis, PUBLIC);
      assert.equal(doc.note, `the note's own prose, ${PUBLIC}`);
      assert.equal(doc.classes[1].example, 'nothing generalised here');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('CW_TAXONOMY_PROSE is read at CALL time, so a path set after import still decides', () => {
    const dir = scratch();
    const was = process.env.CW_TAXONOMY_PROSE;
    try {
      process.env.CW_TAXONOMY_PROSE = write(dir, overlay({ 'class:C1': [pair()] }));
      // No `path` argument: the resolution must go through the env, read now and not at load.
      assert.equal(mergeProseOverlay(register()).classes[0].scoreBasis, PRIVATE);
      process.env.CW_TAXONOMY_PROSE = join(dir, 'gone.json');
      assert.equal(mergeProseOverlay(register()).classes[0].scoreBasis, PUBLIC);
    } finally {
      if (was === undefined) delete process.env.CW_TAXONOMY_PROSE; else process.env.CW_TAXONOMY_PROSE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('an overlay that exists and cannot be used REFUSES', () => {
  test('unparseable JSON throws and names the path', () => {
    const dir = scratch();
    try {
      const p = join(dir, 'prose.json');
      writeFileSync(p, 'not json at all');
      assert.throws(() => mergeProseOverlay(register(), { path: p }), /not valid JSON/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a directory in place of the file throws rather than reading as absent', () => {
    const dir = scratch();
    try {
      // EISDIR, not ENOENT: only a missing file is the public shape.
      assert.throws(() => mergeProseOverlay(register(), { path: dir }), /could not be read/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an overlay with no prose object throws rather than merging nothing quietly', () => {
    const dir = scratch();
    try {
      const p = write(dir, { version: 1 });
      assert.throws(() => mergeProseOverlay(register(), { path: p }), /declares no prose object/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a key naming a record the register does not declare throws — a stale overlay loses prose', () => {
    const dir = scratch();
    try {
      const p = write(dir, overlay({ 'class:ZZ99': [pair()] }));
      assert.throws(() => mergeProseOverlay(register(), { path: p }), /which the register does not declare/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a key of no known kind throws rather than being skipped', () => {
    const dir = scratch();
    try {
      const p = write(dir, overlay({ 'family:I': [pair()] }));
      assert.throws(() => mergeProseOverlay(register(), { path: p }), /names no record kind/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a pair whose public text is NOT in that record throws — the prose moved and the overlay did not follow', () => {
    const dir = scratch();
    try {
      const p = write(dir, overlay({ 'class:C2': [pair()] }));
      assert.throws(() => mergeProseOverlay(register(), { path: p }), /appears 0 time\(s\) in that record, not once/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a pair whose public text appears twice in one record throws rather than picking a side', () => {
    const dir = scratch();
    try {
      const doc = register();
      doc.classes[0].example = PUBLIC;   // now scoreBasis AND example carry it
      const p = write(dir, overlay({ 'class:C1': [pair()] }));
      assert.throws(() => mergeProseOverlay(doc, { path: p }), /appears 2 time\(s\) in that record, not once/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a pair missing one of its two strings throws', () => {
    const dir = scratch();
    try {
      const p = write(dir, overlay({ 'class:C1': [{ public: PUBLIC }] }));
      assert.throws(() => mergeProseOverlay(register(), { path: p }), /without both a public and a private string/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the merge restores prose in its own record and nowhere else', () => {
  test('each record kind resolves, and only the named record changes', () => {
    const dir = scratch();
    try {
      const p = write(dir, overlay({
        'class:C1': [pair()],
        'remediation:R one': [pair()],
        'cycle:first cycle': [pair()],
        'attribution:Gating': [pair()],
      }));
      const doc = mergeProseOverlay(register(), { path: p });
      assert.equal(doc.classes[0].scoreBasis, PRIVATE);
      assert.equal(doc.remediations[0].action, `do it, ${PRIVATE}`);
      assert.equal(doc.cycleLog[0].note, `folded, ${PRIVATE}`);
      assert.equal(doc.attributionPlan[0].mechanism, `keyed wrong, ${PRIVATE}`);
      // The document's own prose carries the same sentence and must be untouched by a class pair.
      assert.equal(doc.note, `the note's own prose, ${PUBLIC}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a doc-scoped pair reaches the document's own prose and not a class's", () => {
    const dir = scratch();
    try {
      const p = write(dir, overlay({ doc: [pair()] }));
      const doc = mergeProseOverlay(register(), { path: p });
      assert.equal(doc.note, `the note's own prose, ${PRIVATE}`);
      assert.equal(doc.classes[0].scoreBasis, PUBLIC, 'the keyed collections are held out of doc scope');
      assert.equal(doc.remediations[0].action, `do it, ${PUBLIC}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('the record is mutated in place, not in a copy the merge then discards', () => {
    const dir = scratch();
    try {
      const doc = register();
      const cls = doc.classes[0];
      mergeProseOverlay(doc, { path: write(dir, overlay({ 'class:C1': [pair()] })) });
      assert.equal(cls.scoreBasis, PRIVATE, 'the live class object carries the restored sentence');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the tracked half: a declared term must be a term the register actually uses", () => {
  // The witness that needs no private store. It reads the public file alone, so it survives in a
  // clone that has nothing to merge — which is the only place the public form is ever read.
  const full = () => ({
    version: 17,
    families: [{ roman: 'I', key: 'f', prefix: 'C', name: 'F', proposition: 'p', test: 't' }],
    classes: [{ id: 'C1', name: 'n', machine: 'f.n', layer: 'IMPL', description: 'd', predicate: 'p', example: 'measured in the memory store', analogy: 'a', closure: 4, gain: 0, stpa: [{ loop: 'monitor', uca: 'none', cause: 'c' }] }],
    scales: { closure: {}, gain: {} },
    scaleBounds: { closureMin: 0, closureMax: 4, gainMin: 0, gainMax: 4, fullyClosed: 4 },
    stpaVocabulary: { loops: { monitor: { test: 't', controller: 'c', controls: 'x' } }, uca: { none: { test: 't' } }, cause: { c: { test: 't' } } },
    stpaProvenance: { rater: 'r', date: '2026-01-01', method: 'm', caveat: 'c' },
  });

  test('a term that appears in the prose passes', () => {
    const doc = full();
    doc.fleetVocabulary = { note: 'named by capability', terms: { 'the memory store': { test: 'The record is about the memory store.' } } };
    assert.deepEqual(validate(doc).filter((e) => /fleetVocabulary/.test(e)), []);
  });

  test('a term that appears NOWHERE in the prose fails — a substitution with nothing substituted', () => {
    const doc = full();
    doc.fleetVocabulary = { note: 'named by capability', terms: { 'the task registry': { test: 'The record is about the task registry.' } } };
    assert.match(validate(doc).join('\n'), /appears nowhere in the register's prose/);
  });

  test('a term that occurs ONLY in its own declaration still fails', () => {
    const doc = full();
    doc.fleetVocabulary = { note: 'named by capability', terms: { 'the local model host': { test: 'The record is about the local model host.' } } };
    assert.match(validate(doc).join('\n'), /appears nowhere in the register's prose/);
  });

  test('a term with no test fails: a term a second reader cannot apply is a label', () => {
    const doc = full();
    doc.fleetVocabulary = { note: 'named by capability', terms: { 'the memory store': {} } };
    assert.match(validate(doc).join('\n'), /no test/);
  });

  test('an empty or note-less vocabulary fails rather than reading as "nothing was generalised"', () => {
    const noNote = full();
    noNote.fleetVocabulary = { note: '', terms: { 'the memory store': { test: 't' } } };
    assert.match(validate(noNote).join('\n'), /must carry a note and at least one term/);
    const noTerms = full();
    noTerms.fleetVocabulary = { note: 'named by capability', terms: {} };
    assert.match(validate(noTerms).join('\n'), /must carry a note and at least one term/);
  });

  test('a register that declares no vocabulary at all is not failed for it', () => {
    assert.deepEqual(validate(full()).filter((e) => /fleetVocabulary/.test(e)), []);
  });
});

describe('the tracked register is in its public form', () => {
  test('it declares the capability vocabulary, and every term is one it uses', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const doc = JSON.parse(readFileSync(process.env.CW_TAXONOMY_JSON || resolve(repo, 'monitor', 'failure-taxonomy.json'), 'utf8'));
    const V = doc.fleetVocabulary;
    assert.ok(V && Object.keys(V.terms || {}).length, 'the register names tools by capability and must declare the vocabulary it uses');
    // Through validate(), so the dead-term rule is enforced on the real file and not only on a
    // fixture — a vocabulary that drifted from the prose is exactly what goes unnoticed here.
    assert.deepEqual(validate(doc).filter((e) => /fleetVocabulary/.test(e)), []);
  });
});

describe('the shipped example is the public shape, and it is a real overlay', () => {
  test('it parses, declares a pair of every record kind, and names no real product', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const ex = JSON.parse(readFileSync(resolve(repo, 'monitor', 'taxonomy-prose.example.json'), 'utf8'));
    assert.equal(ex.version, 1);
    assert.deepEqual(Object.keys(ex.prose).map((k) => k.split(':')[0]).sort(),
      ['attribution', 'class', 'cycle', 'doc', 'remediation']);
    for (const pairs of Object.values(ex.prose)) {
      for (const p of pairs) {
        assert.ok(p.public && p.private, 'every example pair carries both sides');
        assert.match(p.private, /example-/, 'the example overlay names only synthetic products');
      }
    }
  });
});

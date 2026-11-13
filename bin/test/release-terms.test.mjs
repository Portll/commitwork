import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileTerms, loadTerms, scanTree, summarise, termsGate, maskPath,
  applyAcceptances, draftAcceptances, loadAcceptances, digestOccurrence, occurrenceKey,
} from '../lib/release-terms.mjs';
import { main, parseArgs, EXIT } from '../release-terms.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLE = join(REPO, 'monitor', 'release-terms.example.json');
const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));
const dir = () => mkdtempSync(join(tmpdir(), 'cw-release-terms-test-'));
const LIST = () => ({ fingerprint: 'test', ...compileTerms(example(), 'example') });
const list = (rules, source = 'test') => ({ fingerprint: 'test', ...compileTerms({ rules }, source) });
// A term needs its key, its reason and its test to exist at all; the tests below vary one at a time.
const word = (key, w, over = {}) => ({ key, word: w, why: 'names the tool', test: 'tool or capability?', ...over });

function plantedTree() {
  const root = dir();
  writeFileSync(join(root, 'a.md'), 'Uses Example-Internal-Tool here.\nexample-internal-toolkit is another word.\n');
  mkdirSync(join(root, 'example-sibling-service'));
  writeFileSync(join(root, 'example-sibling-service', 'readme.txt'), 'nothing denied in the text\n');
  writeFileSync(join(root, 'bin.dat'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('example-internal-tool')]));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'CHANGELOG.md'), 'example-incident 2026-01-01 on a box\n');
  // The example narrows one term to one measured occurrence here, so the second one is a hit.
  writeFileSync(join(root, 'docs', 'example-interface.md'), '# example-sibling-service\n\nand a later example-sibling-service mention.\n');
  writeFileSync(join(root, 'notes.txt'), 'example-customer-b asked; an example-ruling followed.\n');
  return root;
}

function cleanTree() {
  const root = dir();
  writeFileSync(join(root, 'README.md'), 'A product readme with nothing private in it.\n');
  return root;
}

describe('compileTerms', () => {
  test('the shipped example compiles against its schema', () => {
    const { rules } = compileTerms(example(), 'example');
    assert.deepEqual(rules.map((r) => r.id), ['internal-tool', 'customer-pseudonym', 'maintainer-history']);
  });

  test('a duplicate id, a bad pattern, an empty-matching pattern and an unknown key each refuse, naming the rule', () => {
    const doc = example();
    const pat = (over) => ({ key: 'one', why: 'a reason', test: 'a test a reader can apply', ...over });
    assert.throws(() => compileTerms({ rules: [doc.rules[0], doc.rules[0]] }), /'internal-tool' is declared twice/);
    assert.throws(() => compileTerms({ rules: [{ id: 'bad', why: 'bad pattern', patterns: [pat({ pattern: '(unclosed' })] }] }), /'bad' term 'one' is not a valid pattern/);
    assert.throws(() => compileTerms({ rules: [{ id: 'empty', why: 'matches nothing', patterns: [pat({ pattern: 'x*' })] }] }), /'empty' term 'one' matches the empty string/);
    assert.throws(() => compileTerms({ rules: [{ id: 'extra', why: 'unknown key', words: [word('one', 'ab')], typo: true }] }));
    assert.throws(() => compileTerms({ rules: [{ id: 'none', why: 'no terms at all' }] }), /'none' has no words and no patterns/);
  });

  // The list is a detector derived from the publication boundary. A term that cannot say why it is
  // denied, or how a reader checks a hit, is not a term yet. Both directions are asserted: a
  // complete term has to LOAD, since a gate that refuses a well-formed list reports cannot-check,
  // and a release reads cannot-check as "not measured" rather than as a defect in the list.
  test('a term states its own key, reason and test, and a term that states none of them refuses', () => {
    const rule = (words) => ({ rules: [{ id: 'internal-tool', why: 'a tool that is not part of the product', words }] });
    const whole = word('workflow-dependency', 'example-internal-tool');
    const { rules } = compileTerms(rule([whole]), 'whole');
    assert.equal(rules[0].terms[0].why, whole.why);
    assert.equal(rules[0].terms[0].test, whole.test);
    assert.throws(() => compileTerms(rule(['example-internal-tool']), 'bare'), /words\[0\]: expected object, got string/);
    assert.throws(() => compileTerms(rule([{ key: 'one', word: 'ab', test: whole.test }]), 'no-why'), /words\[0\]: required key 'why' is missing/);
    assert.throws(() => compileTerms(rule([{ key: 'one', word: 'ab', why: whole.why }]), 'no-test'), /words\[0\]: required key 'test' is missing/);
    assert.throws(() => compileTerms(rule([{ word: 'ab', why: whole.why, test: whole.test }]), 'no-key'), /words\[0\]: required key 'key' is missing/);
  });

  // uniqueItems went with the strings: two objects differing only in their prose are distinct
  // items, so the array keeps both and one detector is counted twice in every figure. Both
  // directions, because a guard that refuses a legitimate pair takes the gate to cannot-check.
  test('two terms with the same key, and two with the same word, each refuse; a distinct pair loads', () => {
    const rule = (words) => ({ rules: [{ id: 'internal-tool', why: 'a tool', words }] });
    assert.throws(() => compileTerms(rule([word('one', 'alpha'), word('one', 'beta')]), 'same-key'),
      /'internal-tool' declares the key 'one' twice/);
    assert.throws(() => compileTerms(rule([word('one', 'alpha'), word('two', 'alpha', { why: 'another reason' })]), 'same-word'),
      /'internal-tool' terms 'one' and 'two' declare the same word/);
    assert.throws(() => compileTerms(rule([word('one', 'alpha'), word('two', 'ALPHA')]), 'same-word-cased'),
      /declare the same word/, 'the default match is case-insensitive, so two casings are one term');
    assert.throws(() => compileTerms({ rules: [{ id: 'r', why: 'a rule', patterns: [
      { key: 'one', pattern: '\\balpha\\b', why: 'a reason', test: 'a test' },
      { key: 'two', pattern: '\\balpha\\b', why: 'another reason', test: 'another test' }] }] }, 'same-pattern'),
      /terms 'one' and 'two' declare the same pattern/);
    const { rules } = compileTerms(rule([word('one', 'alpha'), word('two', 'beta')]), 'distinct');
    assert.deepEqual(rules[0].terms.map((t) => t.label), ['internal-tool#one', 'internal-tool#two']);
  });

  // The label is what a report, a review and a narrowing are keyed on. Keyed on the position, an
  // edit anywhere in the list relabels every term after it — the line-number defect one level out.
  test('a label is keyed on the term, so inserting and reordering terms relabels nothing', () => {
    const rule = (words) => compileTerms({ rules: [{ id: 'r', why: 'a rule', words }] }, 'labels').rules[0];
    const a = word('one', 'alpha'), b = word('two', 'beta'), c = word('three', 'gamma');
    const labelFor = (terms, key) => terms.find((t) => t.key === key).label;
    assert.equal(labelFor(rule([a, b]).terms, 'two'), 'r#two');
    assert.equal(labelFor(rule([c, a, b]).terms, 'two'), 'r#two', 'an inserted term does not relabel the rest');
    assert.equal(labelFor(rule([b, a]).terms, 'two'), 'r#two', 'nor does reordering');
    assert.deepEqual(rule([c, a, b]).terms.map((t) => t.label), ['r#three', 'r#one', 'r#two']);
  });

  // The label is published where the term never is, so it has to survive this same detector.
  test('a key the list itself matches refuses, because a label is published', () => {
    assert.throws(() => compileTerms({ rules: [{ id: 'r', why: 'a rule', words: [word('alpha', 'alpha')] }] }, 'self'),
      /term 'alpha' has a label that term 'r#alpha' matches, and a label is published/);
    assert.throws(() => compileTerms({ rules: [
      { id: 'r', why: 'a rule', words: [word('task-store', 'beta')] },
      { id: 'other', why: 'another rule', words: [word('store', 'task-store')] }] }, 'cross'),
      /a label that term 'other#store' matches/, 'a label has to survive every rule, not just its own');
  });

  // bin/README.md, the schema description and the list all say a narrowing carries the measurement
  // that narrowed it. Optional, that claim is prose; dependentRequired makes it a load condition.
  test('a narrowed term carries its measurement, and one without it refuses', () => {
    const narrowed = (over) => ({ rules: [{ id: 'r', why: 'a rule', words: [word('one', 'alpha', over)] }] });
    assert.throws(() => compileTerms(narrowed({ exceptPaths: [{ path: 'docs/a.md', count: 1 }] }), 'no-measure'),
      /words\[0\]: key 'exceptPaths' requires 'measured', which is missing/);
    const ok = compileTerms(narrowed({ exceptPaths: [{ path: 'docs/a.md', count: 1 }], measured: '2026-01-01: 1 of 1 hit is the declared heading' }), 'measured');
    assert.deepEqual(ok.rules[0].terms[0].except, [{ path: 'docs/a.md', count: 1 }]);
  });

  test('a term exception names one exact path and a count, never a glob', () => {
    const narrowed = (except) => ({ rules: [{ id: 'r', why: 'a rule',
      words: [word('one', 'alpha', { measured: '2026-01-01: measured', exceptPaths: except })] }] });
    assert.throws(() => compileTerms(narrowed([{ path: 'schema/*.json', count: 1 }]), 'glob'),
      /does not match \^\[\^\*\]\+\$/, 'a count is meaningless over an unknown number of files');
    assert.throws(() => compileTerms(narrowed([{ path: 'docs/a.md' }]), 'no-count'), /required key 'count' is missing/);
    assert.throws(() => compileTerms(narrowed([{ path: 'docs/a.md', count: 0 }]), 'zero'),
      /0 < minimum 1/, 'an exception that withdraws nothing is not an exception');
  });

  // A withdrawn term is a register entry, not a detector: the measurement that retired it has to
  // stay where the next reader meets the rule, and it must not be compiled back into a pattern.
  test('removed terms are kept, scanned for by nobody, and cannot be a rule\'s only entries', () => {
    const removed = [{ kind: 'word', term: 'example-retired-tool', why: 'a third-party model family', measured: '2026-01-01: 12 of 12 hits were a model identifier' }];
    const l = list([{ id: 'internal-tool', why: 'a tool that is not part of the product', words: [word('workflow-dependency', 'example-internal-tool')], removed }], 'removed');
    assert.deepEqual(l.rules[0].terms.map((t) => t.label), ['internal-tool#workflow-dependency']);
    const root = dir();
    writeFileSync(join(root, 'a.md'), 'example-retired-tool drafted this; example-internal-tool ran it.\n');
    const s = scanTree(root, l);
    assert.deepEqual(s.hits.map((h) => h.term), ['internal-tool#workflow-dependency'], 'a removed term is a record, not a pattern');
    rmSync(root, { recursive: true, force: true });
    assert.throws(() => compileTerms({ rules: [{ id: 'only-removed', why: 'every term withdrawn', removed }] }, 'only-removed'),
      /'only-removed' has no words and no patterns/);
  });
});

describe('scanTree', () => {
  test('finds a word in content and in a path, case-insensitively, and only as a whole word', () => {
    const root = plantedTree();
    const s = scanTree(root, LIST());
    const at = (path, rule, where) => s.hits.filter((h) => h.path === path && h.rule === rule && h.where === where).reduce((n, h) => n + h.count, 0);
    assert.equal(at('a.md', 'internal-tool', 'content'), 1, 'Example-Internal-Tool counts once; toolkit is another word');
    assert.equal(at('example-sibling-service/readme.txt', 'internal-tool', 'path'), 1);
    assert.equal(at('notes.txt', 'customer-pseudonym', 'content'), 1);
    assert.equal(at('notes.txt', 'maintainer-history', 'content'), 1);
    rmSync(root, { recursive: true, force: true });
  });

  test('a binary is read by path only, and an excepted path is not searched', () => {
    const root = plantedTree();
    const s = scanTree(root, LIST());
    assert.equal(s.skipped.binary, 1);
    assert.deepEqual(s.hits.filter((h) => h.path === 'bin.dat'), []);
    assert.deepEqual(s.hits.filter((h) => h.path === 'docs/CHANGELOG.md'), []);
    assert.equal(s.examined, 5);
    rmSync(root, { recursive: true, force: true });
  });

  // The boundary a word is wrapped in excludes [A-Za-z0-9_] and admits a hyphen. A compound term
  // whose first word is already a term is then a second count of one occurrence, not a second
  // detector. A list derived from an ownership table reaches for the compound, and the number it
  // inflates is the one a reader works through. Asserted here rather than left to be re-measured.
  test('a word matches inside a hyphenated compound, so a compound term counts the same occurrence twice', () => {
    const rules = (words) => list([{ id: 'internal-tool', why: 'a tool that is not part of the product', words }], 'compound').rules;
    const root = dir();
    writeFileSync(join(root, 'a.md'), 'example-internal-tool-extra is one occurrence.\n');
    const base = scanTree(root, { rules: rules([word('base', 'example-internal-tool')]) });
    assert.equal(base.hits.reduce((n, h) => n + h.count, 0), 1, 'the base word reaches into the compound');
    const both = scanTree(root, { rules: rules([word('base', 'example-internal-tool'), word('compound', 'example-internal-tool-extra')]) });
    assert.equal(both.hits.reduce((n, h) => n + h.count, 0), 2, 'adding the compound counts the one occurrence twice');
    rmSync(root, { recursive: true, force: true });
  });

  // A path exception is the instrument for a term that is real and whose pattern is too wide: a
  // file where the word is a schema-declared key. It belongs to the TERM and to a measured number
  // of occurrences, which puts three directions in separate tests. The false-positive direction is
  // that the key stops counting. The false-negative directions are the ones that lie: the excepted
  // file keeps every other term's hits and the excepted term keeps firing elsewhere, and an
  // occurrence BEYOND the measured count is reported rather than inheriting the file's exemption.
  describe('a term-level path exclusion', () => {
    const narrowed = () => list([{
      id: 'internal-tool',
      why: 'a tool that is not part of the product',
      words: [
        word('keyed-tool', 'example-internal-tool', { exceptPaths: [{ path: 'schema/keyed.json', count: 1 }], measured: '2026-01-01: 1 of 1 hit in schema/keyed.json is the schema-declared key' }),
        word('sibling-service', 'example-sibling-service'),
      ],
    }], 'narrowed');

    function twoFileTree() {
      const root = dir();
      mkdirSync(join(root, 'schema'));
      writeFileSync(join(root, 'schema', 'keyed.json'), '{ "example-internal-tool": 1, "note": "example-sibling-service" }\n');
      writeFileSync(join(root, 'notes.md'), 'example-internal-tool and example-sibling-service.\n');
      return root;
    }

    const counts = (root) => {
      const by = {};
      for (const h of scanTree(root, narrowed()).hits) by[`${h.path}:${h.term}`] = (by[`${h.path}:${h.term}`] || 0) + h.count;
      return by;
    };

    test('withdraws that one term from that one path', () => {
      const root = twoFileTree();
      assert.equal(counts(root)['schema/keyed.json:internal-tool#keyed-tool'], undefined);
      rmSync(root, { recursive: true, force: true });
    });

    test('leaves the other terms in the excepted path, and the excepted term everywhere else', () => {
      const root = twoFileTree();
      const by = counts(root);
      assert.equal(by['schema/keyed.json:internal-tool#sibling-service'], 1, 'the exception is term-wide, not file-wide');
      assert.equal(by['notes.md:internal-tool#keyed-tool'], 1, 'the exception is path-wide, not term-wide');
      assert.equal(by['notes.md:internal-tool#sibling-service'], 1);
      rmSync(root, { recursive: true, force: true });
    });

    test('withdraws the measured count and no more, so a new occurrence in the excepted file is reported', () => {
      const root = twoFileTree();
      writeFileSync(join(root, 'schema', 'keyed.json'),
        '{ "example-internal-tool": 1, "note": "example-sibling-service and example-internal-tool in prose" }\n');
      const s = scanTree(root, narrowed());
      const held = s.withheld.filter((w) => w.path === 'schema/keyed.json' && w.term === 'internal-tool#keyed-tool');
      assert.equal(held.reduce((n, w) => n + w.count, 0), 1, 'the measured occurrence is still withheld');
      assert.equal(counts(root)['schema/keyed.json:internal-tool#keyed-tool'], 1, 'the second occurrence is a hit');
      rmSync(root, { recursive: true, force: true });
    });
  });
});

describe('summarise and termsGate', () => {
  test('a planted tree fails, and nothing a denied term matched appears in the detail', () => {
    const root = plantedTree();
    const g = termsGate(root, { load: LIST });
    assert.equal(g.status, 'fail');
    assert.deepEqual(Object.keys(g.detail.byRule), ['customer-pseudonym', 'internal-tool', 'maintainer-history']);
    assert.equal(g.detail.offendingFiles, 4);
    const text = JSON.stringify(g).toLowerCase();
    for (const t of ['example-internal-tool', 'example-sibling-service', 'example-customer-b', 'example-ruling']) assert.ok(!text.includes(t), `${t} leaked into the gate detail`);
    // A term's reason names the private thing as plainly as the term does. It stays in the list.
    for (const r of example().rules) for (const t of [...(r.words || []), ...(r.patterns || [])]) {
      assert.ok(!text.includes(t.why.toLowerCase()), 'a term\'s why leaked into the gate detail');
      assert.ok(!text.includes(t.test.toLowerCase()), 'a term\'s test leaked into the gate detail');
    }
    assert.ok(g.detail.files.some((f) => f.path === '***/readme.txt'), 'a denied directory name is masked');
    rmSync(root, { recursive: true, force: true });
  });

  // Neither the gate report nor the record had a field for what an exception withheld, so a reader
  // of the figure could not tell that anything had been. The count is published with its
  // denominator, and every declared exception gets a row whether it withheld anything or not.
  test('the detail carries what each exception withheld, with its denominator', () => {
    const root = plantedTree();
    const g = termsGate(root, { load: LIST });
    assert.equal(g.detail.withheldCount, 2, 'one rule-level file and one measured occurrence');
    assert.equal(g.detail.grossHitCount, g.detail.hitCount + g.detail.withheldCount);
    const rows = g.detail.exceptions.map((e) => [e.rule, e.term, e.allowed, e.withheld, e.stale]);
    assert.deepEqual(rows, [
      ['internal-tool', 'internal-tool#sibling-service', 1, 1, false],
      ['maintainer-history', null, null, 1, false],
    ]);
    assert.equal(g.detail.withheld.byRule['maintainer-history'].hits, 1);
    rmSync(root, { recursive: true, force: true });
  });

  test('an exception path is masked in the detail like any other path', () => {
    const load = () => list([
      { id: 'r', why: 'a rule', words: [word('one', 'alpha', { exceptPaths: [{ path: 'docs/beta/notes.md', count: 1 }], measured: '2026-01-01: 1 of 1 occurrence is the declared heading' })] },
      { id: 'other', why: 'another rule', words: [word('two', 'beta')] },
    ], 'masked');
    const root = dir();
    mkdirSync(join(root, 'docs', 'beta'), { recursive: true });
    writeFileSync(join(root, 'docs', 'beta', 'notes.md'), 'alpha once.\n');
    const g = termsGate(root, { load });
    assert.deepEqual(g.detail.exceptions.map((e) => e.path), ['docs/***/notes.md']);
    assert.equal(g.detail.withheldCount, 1);
    rmSync(root, { recursive: true, force: true });
  });

  test('a clean tree passes', () => {
    const root = cleanTree();
    const g = termsGate(root, { load: LIST });
    assert.equal(g.status, 'pass');
    assert.equal(g.detail.grossHitCount, 0);
    rmSync(root, { recursive: true, force: true });
  });

  // An exclusion that removes every hit renders hitCount 0, which is the shape of a clean tree. A
  // whole-file exception carries no number to check, so a pass resting on one is not a measurement;
  // a counted allowance is one, but only while the file still holds what was measured in it.
  describe('a clean count an exclusion produced', () => {
    const plant = () => {
      const root = dir();
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'only.md'), 'alpha and alpha again.\n');
      return root;
    };
    const load = ({ ruleExcept, ...termOver }) => () => list([{ id: 'r', why: 'a rule',
      words: [word('one', 'alpha', termOver)], ...(ruleExcept ? { exceptPaths: ruleExcept } : {}) }], 'exclusion');

    test('refuses when a whole-file exception removed everything', () => {
      const root = plant();
      const g = termsGate(root, { load: load({ ruleExcept: ['docs/only.md'] }) });
      assert.equal(g.status, 'cannot-check', 'a whole-file exclusion is not a measurement');
      assert.match(g.detail.error, /is withheld by an exception, and 1 of them name a whole file with no measured count/);
      assert.equal(g.detail.grossHitCount, 2);
      assert.equal(g.detail.withheldCount, 2);
      rmSync(root, { recursive: true, force: true });
    });

    test('refuses when a counted allowance withheld everything but less than it measured', () => {
      const root = plant();
      const g = termsGate(root, { load: load({ exceptPaths: [{ path: 'docs/only.md', count: 5 }], measured: '2026-01-01: 5 occurrences, all the declared heading' }) });
      assert.equal(g.status, 'cannot-check');
      assert.match(g.detail.error, /withheld fewer than the measurement that declared them/);
      rmSync(root, { recursive: true, force: true });
    });

    test('passes when every allowance behind it was exercised exactly as measured', () => {
      const root = plant();
      const g = termsGate(root, { load: load({ exceptPaths: [{ path: 'docs/only.md', count: 2 }], measured: '2026-01-01: 2 of 2 occurrences are the declared heading' }) });
      assert.equal(g.status, 'pass');
      assert.equal(g.detail.hitCount, 0);
      assert.equal(g.detail.withheldCount, 2);
      assert.equal(g.detail.grossHitCount, 2, 'the pass carries the denominator it was taken from');
      rmSync(root, { recursive: true, force: true });
    });

    test('an exception that withheld nothing is reported stale, and does not change a fail', () => {
      const root = plant();
      const g = termsGate(root, { load: load({ exceptPaths: [{ path: 'docs/absent.md', count: 3 }], measured: '2026-01-01: 3 occurrences in a file this tree does not carry' }) });
      assert.equal(g.status, 'fail', 'the hits are still hits');
      assert.deepEqual(g.detail.exceptions.map((e) => [e.withheld, e.allowed, e.stale]), [[0, 3, true]]);
      rmSync(root, { recursive: true, force: true });
    });
  });

  test('no list, an unreadable list and an empty tree are cannot-check, never pass', () => {
    const root = cleanTree();
    assert.equal(termsGate(root, { load: () => null }).status, 'cannot-check');
    assert.match(termsGate(root, { load: () => { throw new Error('boom'); } }).detail.error, /cannot be read \(boom\)/);
    const empty = dir();
    assert.equal(termsGate(empty, { load: LIST }).status, 'cannot-check');
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  });

  test('maskPath hides every denied term in a path', () => {
    assert.equal(maskPath('lib/example-internal-tool/example-customer-a.mjs', LIST()), 'lib/***/***.mjs');
  });

  test('mask: false prints paths as they are and still reports every exception', () => {
    const root = plantedTree();
    const l = LIST();
    const s = summarise(scanTree(root, l), l, { mask: false });
    assert.ok(s.files.some((f) => f.path === 'example-sibling-service/readme.txt'));
    assert.deepEqual(s.exceptions.map((e) => e.path), ['docs/example-interface.md', 'docs/CHANGELOG.md']);
    rmSync(root, { recursive: true, force: true });
  });
});

// A record the gate can read but that settles nothing: the shape loadAcceptances returns when the
// sidecar has none, so every occurrence stays open.
const NOTHING_ACCEPTED = { source: 'no-sidecar', origin: 'no-sidecar', fingerprint: null, note: '', acceptances: [] };

/** The draft a reviewer is handed, signed. Every row is granted against the measurement the scan
 *  just made, which is the only thing that can clear the gate. */
function signedFor(root, list, disposition = 'public-by-design') {
  const draft = draftAcceptances(applyAcceptances(scanTree(root, list), list, NOTHING_ACCEPTED));
  return {
    source: 'test', fingerprint: 'signed', note: draft.note,
    acceptances: draft.acceptances.map((r) => ({
      ...r, disposition, reason: 'synthetic fixture from the example list',
      test: 'grep the example list for the term', reviewer: 'test', reviewedAt: '2026-10-21',
    })),
  };
}

describe('per-term acceptances', () => {
  test('the digest binds the count and the pattern, and the key is the place with no line in it', () => {
    const place = { file: 'a.md', rule: 'internal-tool', term: 'internal-tool#workflow-dependency', where: 'content', count: 1 };
    const d = digestOccurrence(place, 'pattern\0gi');
    assert.equal(digestOccurrence({ ...place }, 'pattern\0gi'), d, 'same inputs, same digest');
    assert.notEqual(digestOccurrence({ ...place, count: 2 }, 'pattern\0gi'), d, 'one more occurrence of the same term');
    assert.notEqual(digestOccurrence(place, 'other\0gi'), d, 'the rule rewritten behind the same label');
    assert.equal(occurrenceKey(place), 'a.md\0internal-tool\0internal-tool#workflow-dependency\0content');
    assert.equal(occurrenceKey({ ...place, line: 400 }), occurrenceKey(place), 'a line number is not part of an identity');
  });

  test('an unreviewed tree fails, and an acceptance bound to its measurement clears it to contested', () => {
    const root = plantedTree();
    // A rule-level exception withholds a whole file with no count, and the next test covers that
    // remainder. Dropping it, not the file, keeps the exception from going stale.
    const doc = example();
    for (const r of doc.rules) delete r.exceptPaths;
    const list = { fingerprint: 'test', ...compileTerms(doc, 'example') };
    const before = termsGate(root, { load: () => list, loadAccepted: () => NOTHING_ACCEPTED });
    assert.equal(before.status, 'fail');
    assert.equal(before.detail.unreviewedCount, before.detail.hitCount);
    assert.equal(before.detail.acceptedCount, 0);
    assert.match(before.detail.summary, /unreviewed$/);

    const g = termsGate(root, { load: () => list, loadAccepted: () => signedFor(root, list) });
    assert.equal(g.status, 'contested', 'an occurrence a person read and defended is not a failure');
    assert.equal(g.detail.acceptedCount, g.detail.hitCount, 'and the detector\'s own count is not erased');
    assert.equal(g.detail.unreviewedCount, 0);
    assert.equal(g.detail.lapsedCount, 0);
    assert.deepEqual(g.detail.stale, [], 'every row matched an occurrence');
    rmSync(root, { recursive: true, force: true });
  });

  // Acceptances settle hits, never exceptions. Once every hit is accepted, what is left is judged as
  // a clean count is: a remainder that rests on a whole-file exception with no count was never
  // measured, so the gate reports that instead of contested.
  test('accepted hits over a remainder an uncounted exception withheld are cannot-check, not contested', () => {
    const root = plantedTree();
    const list = LIST();
    const g = termsGate(root, { load: () => list, loadAccepted: () => signedFor(root, list) });
    assert.equal(g.detail.acceptedCount, g.detail.hitCount, 'every hit is accepted');
    assert.ok(g.detail.withheldCount > 0, 'and the CHANGELOG exception withheld something');
    assert.equal(g.status, 'cannot-check');
    assert.match(g.detail.error, /no measured count/);
    rmSync(root, { recursive: true, force: true });
  });

  // The direction that lies when it is missing: a gate whose acceptances outlive the measurement
  // they were granted against reports a tree as settled while nobody has read what is in it now.
  test('a NEW occurrence of an accepted term lapses the acceptance rather than inheriting it', () => {
    const root = plantedTree();
    const list = LIST();
    const record = signedFor(root, list);
    // The precondition is that the acceptance is in force, stated without the gate's vocabulary: this
    // test must fail for the binding alone, and never share a failure with the third-state test.
    const held = termsGate(root, { load: () => list, loadAccepted: () => record });
    assert.equal(held.detail.acceptedCount, held.detail.hitCount);

    appendFileSync(join(root, 'a.md'), 'Example-Internal-Tool again.\n');
    const g = termsGate(root, { load: () => list, loadAccepted: () => record });
    assert.equal(g.status, 'fail', 'an acceptance that survives a changed hit set is a signature doing no work');
    assert.equal(g.detail.lapsedCount, 2, 'the row was granted against one occurrence and the file now holds two');
    const row = g.detail.lapsed.find((r) => r.rule === 'internal-tool' && r.where === 'content');
    assert.deepEqual([row.path, row.count, row.grantedAgainst], ['a.md', 2, 1]);
    assert.equal(g.detail.unreviewedCount, 0, 'a lapsed acceptance is reported apart from one that never existed');
    assert.ok(!JSON.stringify(g).toLowerCase().includes('example-internal-tool'), 'the matched term leaked into the gate detail');
    rmSync(root, { recursive: true, force: true });
  });

  test('the same accepted term in a new file is a new occurrence, not one the old row covers', () => {
    const root = plantedTree();
    const list = LIST();
    const record = signedFor(root, list);
    writeFileSync(join(root, 'elsewhere.md'), 'example-internal-tool over here.\n');
    const g = termsGate(root, { load: () => list, loadAccepted: () => record });
    assert.equal(g.status, 'fail');
    assert.equal(g.detail.unreviewedCount, 1, 'a new place is unreviewed, not lapsed');
    assert.equal(g.detail.lapsedCount, 0);
    rmSync(root, { recursive: true, force: true });
  });

  test('rewriting the pattern behind an accepted term lapses it, label unchanged', () => {
    const root = plantedTree();
    const record = signedFor(root, LIST());
    // Same label, same matches, a different pattern: nobody has read what internal-tool#workflow-dependency now means.
    const doc = example();
    doc.rules[0].words[0].word = 'Example-Internal-Tool';
    const rewritten = { fingerprint: 'rewritten', ...compileTerms(doc, 'example') };
    const g = termsGate(root, { load: () => rewritten, loadAccepted: () => record });
    assert.equal(g.status, 'fail');
    assert.ok(g.detail.lapsedCount > 0, 'an acceptance granted against the old pattern must not cover the new one');
    rmSync(root, { recursive: true, force: true });
  });

  test('pending and remove-it rulings leave the occurrence open, and a row matching nothing is stale', () => {
    const root = plantedTree();
    const list = LIST();
    const signed = signedFor(root, list);
    for (const disposition of ['pending', 'rename', 'redact', 'move-to-sidecar']) {
      const record = { ...signed, acceptances: signed.acceptances.map((r) => ({ ...r, disposition })) };
      const g = termsGate(root, { load: () => list, loadAccepted: () => record });
      assert.equal(g.status, 'fail', `${disposition} is a ruling that the term must go, not an acceptance`);
      assert.equal(g.detail.acceptedCount, 0, disposition);
      assert.equal(g.detail.unreviewedCount, g.detail.hitCount, disposition);
    }
    const ghost = { ...signed, acceptances: [{ ...signed.acceptances[0], file: 'gone.md' }] };
    const g = termsGate(root, { load: () => list, loadAccepted: () => ghost });
    assert.deepEqual(g.detail.stale.map((r) => r.path), ['gone.md'], 'a row covering no occurrence is reported, never silently kept');
    rmSync(root, { recursive: true, force: true });
  });

  test('an acceptance record that cannot be read is cannot-check, never clean and never a finding', () => {
    const root = plantedTree();
    const g = termsGate(root, { load: LIST, loadAccepted: () => { throw new Error('EACCES'); } });
    assert.equal(g.status, 'cannot-check');
    assert.match(g.detail.error, /term acceptances cannot be read \(EACCES\)/);
    assert.equal(g.detail.hitCount, undefined, 'an unmeasured gate publishes no counts at all');
    rmSync(root, { recursive: true, force: true });
  });
});

describe('loadAcceptances', () => {
  const draftOf = (root, list) => draftAcceptances(applyAcceptances(scanTree(root, list), list, NOTHING_ACCEPTED));

  test('CW_RELEASE_TERM_ACCEPTANCES is read at call time; a named record that is missing or invalid throws', () => {
    const d = dir();
    const root = plantedTree();
    const p = join(d, 'acceptances.json');
    const draft = draftOf(root, LIST());
    writeFileSync(p, JSON.stringify(draft));
    const loaded = loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } });
    assert.equal(loaded.source, p);
    assert.equal(loaded.acceptances.length, draft.acceptances.length);
    assert.match(loaded.fingerprint, /^[0-9a-f]{12}$/);

    assert.throws(() => loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: join(d, 'absent.json') } }), /ENOENT/);
    writeFileSync(p, '{ not json');
    assert.throws(() => loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } }), /not JSON/);
    writeFileSync(p, JSON.stringify({ note: 'no rows key' }));
    assert.throws(() => loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } }), /acceptances/);
    rmSync(d, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  test('an accepting row with no evidence digest, test, reviewer or date refuses to load', () => {
    const d = dir();
    const root = plantedTree();
    const p = join(d, 'acceptances.json');
    const signed = signedFor(root, LIST()).acceptances[0];
    const write = (row) => writeFileSync(p, JSON.stringify({ note: 'one row', acceptances: [row] }));
    const refuses = (row, why) => {
      write(row);
      assert.throws(() => loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } }), /accepted without an evidence digest/, why);
    };
    write(signed);
    assert.equal(loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } }).acceptances.length, 1, 'the signed row itself loads');
    refuses({ ...signed, evidence: null }, 'no digest is an acceptance bound to nothing');
    refuses({ ...signed, reason: '  ' }, 'no reason');
    refuses({ ...signed, test: '' }, 'no test another person can apply');
    refuses({ ...signed, reviewer: '' }, 'nobody signed it');
    refuses({ ...signed, reviewedAt: null }, 'no date');
    write({ ...signed, disposition: 'pending', evidence: null, reason: '', test: '', reviewer: '', reviewedAt: null });
    assert.equal(loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } }).acceptances.length, 1,
      'a pending row accepts nothing, so it needs no signature');
    writeFileSync(p, JSON.stringify({ note: 'twice', acceptances: [signed, { ...signed, count: 9 }] }));
    assert.throws(() => loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } }), /ruled on twice/);
    rmSync(d, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  test('no sidecar, or a sidecar without the record, accepts nothing; only its COMMIT counts', () => {
    const d = dir();
    const root = plantedTree();
    const absent = loadAcceptances({ env: { CW_SIDECAR: join(d, 'absent') } });
    assert.deepEqual([absent.origin, absent.acceptances], ['no-sidecar', []]);
    const side = join(d, 'sidecar');
    mkdirSync(join(side, 'monitor'), { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', side, ...a], { stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(side, 'README.md'), 'sidecar\n');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'one');
    const bare = loadAcceptances({ env: { CW_SIDECAR: side } });
    assert.deepEqual([bare.origin, bare.acceptances], ['sidecar-absent', []],
      'a sidecar with no record is named apart from no sidecar at all');

    const signed = signedFor(root, LIST());
    writeFileSync(join(side, 'monitor', 'release-term-acceptances.json'), JSON.stringify({ note: 'ruled', acceptances: signed.acceptances }));
    assert.deepEqual(loadAcceptances({ env: { CW_SIDECAR: side } }).acceptances, [],
      'an uncommitted acceptance cannot clear the gate');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'two');
    const loaded = loadAcceptances({ env: { CW_SIDECAR: side } });
    assert.match(loaded.source, /^sidecar HEAD:monitor\/release-term-acceptances\.json$/);
    assert.equal(loaded.acceptances.length, signed.acceptances.length);
    rmSync(d, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  test('the shipped example validates, and accepts nothing', () => {
    const p = join(REPO, 'monitor', 'release-term-acceptances.example.json');
    const loaded = loadAcceptances({ env: { CW_RELEASE_TERM_ACCEPTANCES: p } });
    assert.ok(loaded.acceptances.length > 0, 'the example shows the shape of a row');
    assert.deepEqual([...new Set(loaded.acceptances.map((r) => r.disposition))], ['pending']);
  });
});

describe('loadTerms', () => {
  test('CW_RELEASE_TERMS is read at call time, and a named list that is missing throws', () => {
    const d = dir();
    const p = join(d, 'terms.json');
    writeFileSync(p, JSON.stringify(example()));
    const loaded = loadTerms({ env: { CW_RELEASE_TERMS: p } });
    assert.equal(loaded.source, p);
    assert.equal(loaded.rules.length, 3);
    assert.throws(() => loadTerms({ env: { CW_RELEASE_TERMS: join(d, 'absent.json') } }), /ENOENT/);
    writeFileSync(p, '{ not json');
    assert.throws(() => loadTerms({ env: { CW_RELEASE_TERMS: p } }), /not JSON/);
    rmSync(d, { recursive: true, force: true });
  });

  test('no sidecar, or a sidecar without the list, is null; a committed list loads', () => {
    const d = dir();
    assert.equal(loadTerms({ env: { CW_SIDECAR: join(d, 'absent') } }), null);
    const side = join(d, 'sidecar');
    mkdirSync(join(side, 'monitor'), { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', side, ...a], { stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(side, 'README.md'), 'sidecar\n');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'one');
    assert.equal(loadTerms({ env: { CW_SIDECAR: side } }), null);
    writeFileSync(join(side, 'monitor', 'release-terms.json'), JSON.stringify(example()));
    assert.equal(loadTerms({ env: { CW_SIDECAR: side } }), null, 'an uncommitted list is not the reviewed one');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'two');
    const loaded = loadTerms({ env: { CW_SIDECAR: side } });
    assert.match(loaded.source, /^sidecar HEAD:monitor\/release-terms\.json$/);
    assert.equal(loaded.rules.length, 3);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('the CLI', () => {
  const quiet = () => { const lines = []; return { lines, out: (l) => lines.push(l), err: (l) => lines.push(l) }; };

  test('usage errors exit 22', () => {
    assert.equal(main(['--bogus'], quiet()), EXIT.USAGE);
    assert.equal(main(['--root'], quiet()), EXIT.USAGE);
    assert.ok(parseArgs(['--ref', 'HEAD', '--root', '.']).error);
  });

  test('no list exits 21; a planted tree exits 20; a clean tree exits 0', () => {
    const planted = plantedTree(), clean = cleanTree();
    assert.equal(main(['--root', clean], { ...quiet(), load: () => null }), EXIT.CANNOT_CHECK);
    assert.equal(main(['--root', planted], { ...quiet(), load: LIST }), EXIT.FOUND);
    assert.equal(main(['--root', clean], { ...quiet(), load: LIST }), EXIT.CLEAN);
    rmSync(planted, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  });

  test('the text output names the withheld count with its denominator', () => {
    const planted = plantedTree();
    const a = quiet();
    main(['--root', planted], { ...a, load: LIST });
    assert.ok(a.lines.some((l) => /withheld by exception: 2 of \d+ \(2 declared, 0 withholding less than measured\)/.test(l)), a.lines.join('\n'));
    rmSync(planted, { recursive: true, force: true });
  });

  test('--json masks paths unless --show-paths is given', () => {
    const planted = plantedTree();
    const a = quiet();
    main(['--root', planted, '--json'], { ...a, load: LIST });
    const masked = JSON.parse(a.lines.join('\n'));
    assert.ok(masked.files.some((f) => f.path === '***/readme.txt'));
    assert.equal(masked.exceptions.length, 2, 'the mask is a flag, not an empty rule list that drops rows');
    const b = quiet();
    main(['--root', planted, '--json', '--show-paths'], { ...b, load: LIST });
    assert.ok(JSON.parse(b.lines.join('\n')).files.some((f) => f.path === 'example-sibling-service/readme.txt'));
    rmSync(planted, { recursive: true, force: true });
  });
});

// fact: the cases below are real lines from a seeded sample of tracked comments, each one a line a rule once got wrong or is the reason the rule exists / a rule fitted to one example changed meaning on every real firing (expiry: never, prev: wrong)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { secondPass, RULES, isHistory } from '../comment-second-pass.mjs';

const T = ' (expiry: TODO, prev: unknown)';
const fact = (c, pad = '') => `${pad}// fact: ${c}`;
const one = (c, ctx) => secondPass([fact(c)], ctx).lines[0]?.replace(/^\s*\/\/ fact: /, '');
const FIRST = [
  '`no-tally` is a REFUSAL — bin/canary-harness.mjs REFUSALS declares it as declining to judge because a sensor is blind, and says in terms that a refusal is "never scored as a clean read"',
  'It is NOT alarm: the gate found no regression, it found no BASELINE, and reporting a blind instrument as a finding is the over-report this repository refuses in the same breath as the under-report',
  '`regression-disk-undetermined` is that same shape reached from a THIRD direction, and the same rule decides it: bin/gate-tests.mjs refuses to attribute a run whose disk was full or could not be read, because ENOSPC here is swallowed by bare catches and surfaces as unrelated red across write-touching suites',
  'Here one was, but HEAD ran FEWER cases than the tree, so absence from HEAD\'s failures cannot mean "it passed" — it may simply never have run',
  'Refusal, therefore neither',
  'A refusal on the same rule as `no-tally`, therefore neither',
].map((c) => fact(`${c}${T}`, '    '));

test('the operator\'s worked example collapses to exactly the two lines asked for', () => {
  const r = secondPass(FIRST);
  assert.deepEqual(r.lines, [
    '    // fact: `no-tally` is a refusal caused by a blind sensor in bin/canary-harness.mjs',
    '    // fact: `regression-disk-undetermined` - bin/gate-tests.mjs refuses to attribute when a run\'s disk was full/bad read/no read/failed read, because ENOSPC here is swallowed by bare catches and surfaces as unrelated red across write-touching suites',
  ]);
  assert.deepEqual(r.fate, ['reworded', 'dropped', 'reworded', 'dropped', 'dropped', 'dropped']);
  for (const id of ['verdict-only', 'emphasis-caps', 'anaphoric-lead-in', 'elaboration-to-cause', 'read-failure-classes', 'predicate-alternatives', 'relative-to-condition', 'leans-on-a-neighbour']) {
    assert.ok(r.fired.includes(id), `${id} is one of the rules this example motivated`);
  }
});

test('a line with a real trailer, or a half-written one, is left whole', () => {
  const real = '// fact: `x` reads late because a const freezes it (expiry: never, prev: broken)';
  assert.deepEqual(secondPass([real]).lines, [real]);
  const half = '// fact: nothing is erased — the full command survives in `cmd` (expiry: never)';
  assert.deepEqual(secondPass([half]).lines, [half], 'the dash rule cut this to "nothing is erased" when it was not guarded');
});

test('HISTORY: an incident story is removed, a present-tense rule is not', () => {
  assert.equal(one('Under `bool`, COERCE mapped all of them to the word `false`, so the panel published "this credential was refused" for a population that was entirely "nobody could ask"'), undefined);
  assert.equal(one('The first cut read only CW_SESSION_STORE and otherwise went straight to the home directory, which meant every test that boots a panel wrote its fixture sessions into the real store'), undefined);
  assert.equal(one('The target was the literal \'/map/clientA\''), undefined);
  assert.equal(one('A record that matches zero rows is a reported state, not a silence'), 'A record that matches zero rows is a reported state, not a silence');
  assert.equal(isHistory('the file is being used to name B wrongly'), false, '"being used to" is not habitual past');
});

test('HISTORY: only the story clause goes when the line also states the rule', () => {
  assert.equal(one('The raw deletion column counts a replaced line as a deletion, so it overstates: this tool first reported 40 lines at risk in bin/taxonomy-db.mjs where the net was 5'),
    'The raw deletion column counts a replaced line as a deletion, so it overstates');
  assert.equal(one('Caught by looking at the file rather than by any test: a leak into a file only this module reads produces no symptom'),
    'A leak into a file only this module reads produces no symptom');
  assert.match(one('Suppressed ≠ deleted: an annotated row KEEPS its place with `annotation` attached, and only the severity aggregates drop — with `annotated` recorded beside them, so a reduced number never appears without its reason'),
    /keeps its place/, 'a present verb in capitals is still a present verb');
});

test('HISTORY: a "because" clause goes with the story it explains', () => {
  assert.equal(one('The justification was that refusing early beats failing at the system dialog, because the refusal encoded an inference about what a browser will accept'), undefined);
});

test('HISTORY: dates, tracker ids and "which is exactly what the operator saw" are stripped from a kept rule', () => {
  assert.equal(one('A discoverable credential is what a synced password manager wants, so asking for one invites Chrome to route the ceremony elsewhere, which is exactly what the operator saw'),
    'A discoverable credential is what a synced password manager wants, so asking for one invites Chrome to route the ceremony elsewhere');
  assert.equal(one('Each lane declares its kind (operator ruling D4, 2026-08-13; monitor/issue-store.mjs) and severity is orthogonal to it'),
    'Each lane declares its kind and severity is orthogonal to it');
});

test('DASH: a verbless aside is deleted and a dash joining a clause becomes punctuation', () => {
  assert.equal(one('No CodeQL SARIF in scope is written out as coverage.scope \'none\' with the reason — a named no-data state, not a silent zero'),
    'No CodeQL SARIF in scope is written out as coverage.scope \'none\' with the reason');
  assert.equal(one('Clearing overwrites the file with an empty stub — this codebase never unlinks a file'),
    'Clearing overwrites the file with an empty stub; this codebase never unlinks a file', 'deleting this segment removed the reason');
  assert.equal(one('The residual race — two sessions declaring the same file — is the pre-existing shared-tree collision'),
    'The residual race is the pre-existing shared-tree collision');
  assert.equal(one('`--format json` calls Jason.encode!, and Jason comes from the scanned project\'s built deps — which this fleet never builds'),
    '`--format json` calls Jason.encode!, and Jason comes from the scanned project\'s built deps, which this fleet never builds');
});

test('DASH: a segment carrying the cause is kept, and a dash inside parentheses is not an aside', () => {
  assert.match(one('Blend it in weighted well above the body — never exclusively, because two differently-worded headings should still read as similar'), /never exclusively, because/);
  const inParens = 'The exclusions are sourced from the declarations themselves (monitor/scan-scope.mjs — the gitleaks toml for secrets) so the page can never claim a scope the scanner does not have';
  assert.equal(one(inParens), inParens, 'the rule once cut this and left the parenthesis open');
});

test('FIRST PERSON: the first-person clause goes, the decision stays, and my/our become "the"', () => {
  assert.equal(one('residentKey \'discouraged\', not \'preferred\', and this is a hypothesis I cannot test from here'), 'residentKey \'discouraged\', not \'preferred\'');
  assert.equal(one('I never observed a browser reject an IP-literal RP ID'), undefined);
  assert.equal(one('Never red: this lens describes OUR coverage'), 'Never red: this lens describes the coverage');
  assert.equal(one('The save hint quotes "what we snapshotted" verbatim'), 'The save hint quotes "what we snapshotted" verbatim', 'quoted text is content');
  assert.match(one('a user saw I/O errors on the volume every time the disk filled'), /I\/O/, 'I/O is not first person');
});

test('CAPS: emphasis is lowered; acronyms, $VARS, declared names and text after an apostrophe are handled', () => {
  assert.equal(one('`x` reads a HEAD baseline because ENOSPC is swallowed'), '`x` reads a HEAD baseline because ENOSPC is swallowed');
  assert.equal(one('BOTH, because os.homedir() reads $HOME on POSIX and %USERPROFILE% on Windows'), 'Both, because os.homedir() reads $HOME on POSIX and %USERPROFILE% on Windows');
  assert.match(one('Under this schema, COERCE maps every missing value to null', { src: 'const COERCE = {};' }), /COERCE maps/, 'a name the file declares is an identifier');
  assert.equal(one('The fleet-flatten\'s OWN totals are read BEFORE the overlay runs'), 'The fleet-flatten\'s own totals are read before the overlay runs', 'the apostrophe once hid these words as a quotation');
});

test('LEAD-IN and ELABORATION fire only on the shapes they were written for', () => {
  const header = 'monitor/sarif-read.mjs — the one SARIF reader; every `.sarif` this tree opens goes through it. state: ok';
  assert.match(one(header), /the one SARIF reader/, 'a bare "this" is not a back-reference; this deleted the purpose statement');
  assert.match(one('A hook that is live and inert at the same time — which is worse than never having written it, because a wired-looking hook invites the reader to assume'),
    /which is worse than never having written it, because/, 'with no file path before "because" there is no attribution to reduce');
});

test('a pronoun-led line joins its kept antecedent, a self-reference names the file, and a lone pronoun line is dropped', () => {
  const r = secondPass([fact('The gap is split by whether it was measured'), fact('That split is not cosmetic, because unknown outranks reduced')], { used: [3, 4] });
  assert.deepEqual(r.lines, ['// fact: The gap is split by whether it was measured; that split is not cosmetic, because unknown outranks reduced']);
  assert.equal(one('This module keeps SCANNER_SPECS and re-exports every public name', { file: 'monitor/extractors.mjs' }),
    '`extractors.mjs` keeps SCANNER_SPECS and re-exports every public name');
  assert.equal(secondPass([fact('It counts as adjudicated and never as classified')], { used: [5] }).lines.length, 0);
});

test('an empty draft has an empty second pass, and every rule carries its reason', () => {
  assert.deepEqual(secondPass([]), { lines: [], fate: [], fired: [] });
  for (const r of RULES) assert.ok(r.id && r.why && (r.drop || r.rewrite), r.id);
});

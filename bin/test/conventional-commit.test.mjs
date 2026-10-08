import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateConventional, findFooterStart, parseFooters, formatErrors, rulesFor, DEFAULT_TYPES, DEFAULT_SCOPES, RULE_SETS,
} from '../lib/conventional-commit.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ok = (m, o) => validateConventional(m, o).ok;
const errs = (m, o) => validateConventional(m, o).errors.map((e) => e.clause);

describe('clause 1 + 5 — the required prefix and description', () => {
  test('NOT VACUOUS: well-formed subjects pass, or every refusal below proves nothing', () => {
    for (const m of [
      'feat: add the turn recorder',
      'fix(mcp): reject arguments that do not match the schema',
      'docs: explain the trust boundary',
      'refactor(monitor)!: replace urls with url for single-service entries',
      'chore: bump the pinned scanner',
    ]) assert.equal(ok(m), true, `refused a valid subject: ${m}`);
  });

  test('a bare sentence is refused', () => {
    assert.equal(ok('add the turn recorder'), false);
  });

  test("this repository's previous house style is refused — the point of the change", () => {
    // Every commit this session landed before the gate looked like this.
    assert.equal(ok('roster turn-gate: a gate nobody has run and one not wired differ'), false,
      'a `scope: description` subject with no type is not a conventional commit');
  });

  test('a colon with no space after it is refused, and the message says so', () => {
    const r = validateConventional('feat:add a thing');
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /colon is present but not followed by a space/);
  });

  test('a type with no colon at all is refused, and the message says so', () => {
    const r = validateConventional('feat');
    assert.match(r.errors[0].message, /colon and description are missing/);
  });

  test('an empty description after the colon is refused', () => {
    const r = validateConventional('feat: ');
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /description after the colon is empty/);
  });

  test('an empty message is its own condition, not a malformed header', () => {
    const r = validateConventional('   ');
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => e.clause), ['input']);
  });
});

describe('clause 4 — the optional scope', () => {
  test('a scope is parsed off the subject', () => {
    assert.equal(validateConventional('fix(mcp): add x').parsed.scope, 'mcp');
  });
  test('no scope is null, not an empty string', () => {
    assert.equal(validateConventional('fix: add x').parsed.scope, null);
  });
  test('empty parentheses are refused', () => {
    assert.ok(errs('fix(): add x').includes('4'));
  });
  test('a multi-word scope is allowed', () => {
    assert.equal(validateConventional('fix(turn gate): add x').parsed.scope, 'turn gate');
  });
});

describe('clause 6 — the body begins one blank line after the description', () => {
  test('a body glued to the subject is refused — the common miss', () => {
    // Without the blank line every tool that reads the first line silently gets a paragraph.
    assert.ok(errs('feat: add a thing\nand here is why').includes('6'));
  });
  test('a properly separated body passes', () => {
    assert.equal(ok('feat: add a thing\n\nand here is why'), true);
  });
  test('a subject alone passes', () => {
    assert.equal(ok('feat: add a thing'), true);
  });
});

describe('clauses 11-14, 16, 17 — breaking changes', () => {
  test('a ! before the colon marks it breaking', () => {
    assert.equal(validateConventional('feat(api)!: drop the old field').parsed.breaking, true);
  });
  test('a BREAKING CHANGE footer marks it breaking', () => {
    assert.equal(validateConventional('feat: add x\n\nbody\n\nBREAKING CHANGE: the field is gone').parsed.breaking, true);
  });
  test('BREAKING-CHANGE is synonymous (clause 17)', () => {
    assert.equal(validateConventional('feat: add x\n\nbody\n\nBREAKING-CHANGE: gone').parsed.breaking, true);
  });
  test('an ordinary commit is not breaking', () => {
    assert.equal(validateConventional('feat: add x').parsed.breaking, false);
  });
  test('a BREAKING CHANGE footer with no description is refused (clause 12)', () => {
    assert.ok(errs('feat: add x\n\nbody\n\nBREAKING CHANGE: ').includes('12'));
  });
  test('lowercase breaking change is refused — it silently loses the flag (clause 16)', () => {
    // This is the dangerous one: it LOOKS like a footer, parses as prose, and the release tooling
    // never sees a breaking change.
    assert.ok(errs('feat: add x\n\nbody\n\nbreaking change: gone').includes('16'));
  });
});

describe('REGRESSION: a trailing newline is the shape every real message has', () => {
  // Git terminates a commit message with a newline. findFooterStart scanned up from the true last
  // element, hit that blank line, broke immediately and returned -1 — so on essentially every real
  // message no footer was found and a CORRECTLY spelled BREAKING CHANGE was invisible. Every
  // fixture above omitted the trailing newline, so the suite was green over a shape git never
  // produces: one unrealistic detail, repeated in every case, hid a defect in all of them.
  const body = 'feat: add x\n\nbody\n\nBREAKING CHANGE: the field is gone';

  test('a BREAKING CHANGE footer is detected WITH a trailing newline', () => {
    assert.equal(validateConventional(`${body}\n`).parsed.breaking, true,
      'the flag was lost on the shape git actually writes');
  });

  test('and with several trailing newlines', () => {
    assert.equal(validateConventional(`${body}\n\n\n`).parsed.breaking, true);
  });

  test('and with a trailing CRLF', () => {
    assert.equal(validateConventional(`${body}\r\n`).parsed.breaking, true);
  });

  test('the no-newline form still works — the fix did not trade one shape for the other', () => {
    assert.equal(validateConventional(body).parsed.breaking, true);
  });

  test('ordinary footers survive a trailing newline too', () => {
    const r = validateConventional('feat: add x\n\nbody\n\nReviewed-by: someone\nRefs #12\n');
    assert.equal(r.parsed.footers.length, 2);
  });

  test('a message that is ONLY a subject plus newline has no footers and does not throw', () => {
    const r = validateConventional('feat: add x\n');
    assert.equal(r.ok, true);
    assert.deepEqual(r.parsed.footers, []);
  });
});

describe('clauses 8-10 — footers', () => {
  test('both separators are accepted', () => {
    const f = parseFooters(['Reviewed-by: someone', 'Refs #123']);
    assert.equal(f.length, 2);
    assert.equal(f[0].separator, ': ');
    assert.equal(f[1].separator, ' #');
  });
  test('a continuation line folds into the previous footer value (clause 10)', () => {
    const f = parseFooters(['BREAKING CHANGE: the field', 'is gone entirely']);
    assert.equal(f.length, 1);
    assert.match(f[0].value, /the field\nis gone entirely/);
  });
  test('body prose that merely looks like a footer is not read as one', () => {
    // Scanning from the top would call this a footer block and mis-parse the message.
    const lines = 'feat: add x\n\nNote: this paragraph is prose\n\nreal body here'.split('\n');
    assert.equal(findFooterStart(lines), -1, 'a mid-body Note: was treated as a footer');
  });
  test('the trailing footer block is found', () => {
    const lines = 'feat: add x\n\nbody\n\nReviewed-by: a'.split('\n');
    assert.equal(lines[findFooterStart(lines)], 'Reviewed-by: a');
  });
});

describe('exemptions and house rules', () => {
  test('git-authored merge and revert subjects are exempt, and say so', () => {
    const r = validateConventional('Merge branch main into feat/x');
    assert.equal(r.ok, true);
    assert.equal(r.parsed.exempt, 'merge');
    assert.equal(validateConventional('Revert "feat: x"').parsed.exempt, 'revert');
  });
  test('the exemption can be switched off', () => {
    assert.equal(ok('Merge branch main', { allowMerge: false }), false);
  });
  test('an allowed-type list is a HOUSE rule and is labelled as one', () => {
    const r = validateConventional('wibble: add x', { allowedTypes: ['feat', 'fix'] });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].clause, 'house', 'the spec permits any type (clause 15); this is ours');
    assert.match(r.errors[0].fix, /feat, fix/);
  });
  test('the DEFAULT is the restrictive list — an unknown type is refused', () => {
    // The permissive default is what let the old `<area>:` habit through: `taxonomy: …` is a
    // perfectly well-formed conventional commit whose TYPE is `taxonomy`.
    const r = validateConventional('wibble: add x');
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].clause, 'house');
  });

  test('spec-only mode is available but must be asked for EXPLICITLY (clause 15)', () => {
    assert.equal(ok('wibble: add x', { allowedTypes: null }), true);
  });

  test('every DEFAULT_TYPES member is actually accepted — the list is not decorative', () => {
    for (const t of DEFAULT_TYPES) assert.equal(ok(`${t}: make a change`), true, `default type '${t}' was refused`);
  });

  test('THE MEASURED CASE: the old house style is refused and told where the word belongs', () => {
    // Measured over the last 80 subjects when the list was switched on: taxonomy 7, redactions 7,
    // backlog 3, traps 2 — against feat 2 and fix 3. The gate had been accepting the exact style it
    // was added to replace.
    for (const word of ['taxonomy', 'redactions', 'backlog', 'traps']) {
      const r = validateConventional(`${word}: something changed`);
      assert.equal(r.ok, false, `'${word}:' still passes as a type`);
      assert.match(r.errors[0].fix, new RegExp(`docs\\(${word}\\)`),
        'the refusal should say the word is a SCOPE, not just hand over a list');
    }
  });

  test('and the suggested scope form actually passes', () => {
    assert.equal(ok('docs(taxonomy): add a class'), true);
  });
  test('type comparison is case-insensitive (clause 16)', () => {
    assert.equal(ok('Fix: add x', { allowedTypes: ['fix'] }), true);
  });
});

describe('robustness', () => {
  test('CRLF line endings do not fail the header for an invisible reason', () => {
    assert.equal(ok('feat: add a thing\r\n\r\nbody'), true);
  });
  test('null and undefined are refused, not thrown on', () => {
    assert.equal(ok(null), false);
    assert.equal(ok(undefined), false);
  });
  test('every error carries a clause and an actionable fix', () => {
    const r = validateConventional('nope');
    for (const e of r.errors) {
      assert.ok(e.clause, 'an error with no clause cannot be looked up');
      assert.ok(e.fix && e.fix.length > 10, 'an error with no fix tells the author nothing');
    }
    assert.match(formatErrors(r, { subject: 'nope' }), /subject was/);
  });
});

describe('house rules: subject cap, closed scope set, scope over declared paths, tells', () => {
  const long = `fix(bin): add ${'x'.repeat(59)}`;
  test('a subject of exactly 72 characters passes and 73 is refused', () => {
    assert.equal(long.length, 73);
    assert.equal(ok(long.slice(0, 72)), true);
    const r = validateConventional(long);
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /73 characters; the cap is 72/);
  });
  test('a scope outside DEFAULT_SCOPES is refused and the set is listed', () => {
    const r = validateConventional('fix(turn gate): add x');
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /not in this repository's scope set/);
    assert.match(r.errors[0].fix, /commit-phase/);
  });
  test('with declared paths, the refusal names the scopes those paths are under', () => {
    const r = validateConventional('fix(panel): add x', { paths: ['admin/serve.mjs'] });
    assert.equal(r.ok, false);
    assert.match(r.errors[0].fix, /your paths are under: admin/);
  });
  test('a known scope over paths none of which are under it is refused', () => {
    const r = validateConventional('fix(monitor): add x', { paths: ['admin/serve.mjs', 'bin/x.mjs'] });
    assert.equal(r.ok, false);
    assert.match(r.errors[0].message, /no declared path is under it/);
    assert.match(r.errors[0].fix, /admin, bin/);
  });
  test('one declared path under the scope is enough', () => {
    assert.equal(ok('fix(monitor): add x', { paths: ['admin/serve.mjs', 'monitor/sweep.mjs'] }), true);
    assert.equal(ok('fix(commit-phase): add x', { paths: ['bin/lib/conventional-commit.mjs'] }), true);
  });
  test('no paths means no path check, and a null scope set means any scope', () => {
    assert.equal(ok('fix(monitor): add x'), true);
    assert.equal(ok('fix(wibble): add x', { allowedScopes: null }), true);
  });
  test('every DEFAULT_SCOPES prefix matches a real path, so no scope is unusable', () => {
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' }).split('\n');
    // A path .gitattributes keeps out of the published snapshot is absent there and present in the
    // working repository, where commits to it still need a scope.
    const exportIgnored = (pre) => execFileSync('git', ['check-attr', 'export-ignore', '--', pre.endsWith('/') ? `${pre}x` : pre],
      { cwd: REPO, encoding: 'utf8' }).trim().endsWith(': set');
    for (const [scope, prefixes] of Object.entries(DEFAULT_SCOPES)) {
      for (const pre of prefixes) {
        assert.ok(files.some((f) => f === pre || f.startsWith(pre)) || exportIgnored(pre), `scope '${scope}' prefix '${pre}' matches nothing`);
      }
    }
  });
  test('a tell in the body is refused and named', () => {
    const r = validateConventional('fix(bin): add x\n\nHEAD moved — found by commitwork-00, so the land is refused.');
    assert.equal(r.ok, false);
    const idsSeen = r.errors.map((e) => e.message);
    assert.ok(idsSeen.some((m) => /em-dash/.test(m)));
    assert.ok(idsSeen.some((m) => /session-name/.test(m)));
    assert.ok(idsSeen.some((m) => /so-glue/.test(m)));
    assert.ok(idsSeen.some((m) => /\(land\)/.test(m)));
  });
  test('a tell in the subject is refused', () => {
    assert.equal(ok('fix(bin): the fix landed'), false);
  });
  test('a footer is not scanned for tells; a Refs footer with a dash passes', () => {
    assert.equal(ok('fix(bin): add x\n\nplain body.\n\nRefs: D19 item 5 — deed'), true);
  });
  test('tells can be switched off explicitly, for callers that ratchet instead', () => {
    assert.equal(ok('fix(bin): record that the fix landed', { checkTells: false }), true);
  });
});

describe('imperative mood: the description opens with a lower-case verb', () => {
  const free = { allowedScopes: null };
  const refusal = (m, o = free) => validateConventional(m, o).errors.find((e) => /description starts with/.test(e.message));

  test('an imperative subject passes, and the declarative one it replaces is refused', () => {
    assert.equal(ok('feat(gate): fail patches that delete the flagged or source statement', free), true);
    assert.match(refusal('feat: the gate fails a patch that deletes the flagged or source line').message, /'the', which opens a noun phrase/);
  });

  test('-s, -ed and -ing forms are refused, and the fix names the verb', () => {
    for (const [word, base] of [['adds', 'add'], ['added', 'add'], ['adding', 'add'], ['carries', 'carry'], ['pinned', 'pin'], ['refusing', 'refuse'], ['fixes', 'fix']]) {
      const e = refusal(`fix: ${word} the thing`);
      assert.ok(e, `'${word}' passed`);
      assert.match(e.fix, new RegExp(`write '${base}'`));
    }
  });

  test('a capitalised verb, a possessive and a noun are refused', () => {
    assert.match(refusal('feat: Add the recorder').fix, /write 'add'/);
    assert.match(refusal("feat: ASSIGN's later names").message, /possessive/);
    assert.match(refusal('feat: ironwork compile writes a load module').fix, /bin\/lib\/imperative-verbs\.mjs/);
    assert.ok(refusal('feat: `--serve` runs EXEC CICS'));
  });

  test('verbs that end in s, and re-, un-, de- and pre- forms, pass', () => {
    for (const d of ['address', 'process', 'bypass', 'focus', 're-stamp', 'restamp', 'unpin', 'deregister', 'prefetch', 'fast-forward']) {
      assert.equal(refusal(`fix: ${d} the thing`), undefined, `'${d}' was refused`);
    }
  });

  test('merge and revert subjects stay exempt, and the rule can be switched off', () => {
    assert.equal(ok('Revert "feat: the gate fails"'), true);
    assert.equal(ok('feat: the gate fails', { checkMood: false }), true);
  });
});

describe('rule sets: one per repository, named by git config commitwork.rules', () => {
  const body = 'fix: lower OCCURS DEPENDING ON tables\n\nOCCURS DEPENDING ON sizes the table at run time.';

  test("unset is commitwork's own, and an unknown name is refused", () => {
    for (const name of [null, '', undefined]) assert.equal(rulesFor(name).opts.allowedScopes, DEFAULT_SCOPES);
    const r = rulesFor('nope');
    assert.equal(r.ok, false);
    assert.match(r.why, /cobolwork, ironwork/);
  });

  test('outside commitwork any scope passes; commitwork keeps its scope set', () => {
    const m = 'feat(gate): fail patches that delete the flagged line';
    for (const name of ['cobolwork', 'ironwork', 'cobolwork-web']) assert.equal(ok(m, rulesFor(name).opts), true, name);
    assert.equal(ok(m, rulesFor('commitwork').opts), false);
  });

  test('the capitalised-words tell is off in the COBOL repositories only', () => {
    assert.equal(ok(body, rulesFor('cobolwork').opts), true);
    assert.equal(ok(body, rulesFor('ironwork').opts), true);
    assert.equal(ok(body, rulesFor('commitwork').opts), false);
    assert.equal(ok(body, rulesFor('cobolwork-web').opts), false);
  });

  test('every rule set enforces the mood and the 72-character cap', () => {
    for (const name of Object.keys(RULE_SETS)) {
      assert.equal(ok('feat: the gate fails', rulesFor(name).opts), false, `${name} let a noun phrase through`);
      assert.equal(ok(`feat: add ${'y'.repeat(70)}`, rulesFor(name).opts), false, `${name} let a long subject through`);
    }
  });
});

// These run commit-phase against this checkout. Naming a ref lets them reach the message gate on a
// detached HEAD (CI, worktrees); the ref is never created, so a gate that wrongly passed still
// could not land: the compare-and-swap onto a missing ref fails.
const REFUSAL_REF = 'refs/heads/cw-test-refusal-never-created';

describe('the gate is wired into commit-phase, not merely written', () => {
  test('commit-phase REFUSES a subject over the cap and lands nothing', () => {
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath,
        [join(REPO, 'bin', 'commit-phase.mjs'), '--ref', REFUSAL_REF, '-m', `fix(deps): ${'y'.repeat(70)}`, '--', 'package.json'],
        { encoding: 'utf8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { code = e.status; out = `${e.stdout || ''}${e.stderr || ''}`; }
    assert.equal(code, 2, `expected refusal exit 2, got ${code}: ${out.slice(0, 300)}`);
    assert.match(out, /the cap is 72/);
    assert.match(out, /Nothing was staged, nothing landed/);
  });
  test('commit-phase REFUSES a scope none of the declared paths are under', () => {
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath,
        [join(REPO, 'bin', 'commit-phase.mjs'), '--ref', REFUSAL_REF, '-m', 'fix(monitor): add x', '--', 'package.json'],
        { encoding: 'utf8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { code = e.status; out = `${e.stdout || ''}${e.stderr || ''}`; }
    assert.equal(code, 2, `expected refusal exit 2, got ${code}: ${out.slice(0, 300)}`);
    assert.match(out, /no declared path is under it/);
    assert.match(out, /your paths are under: deps/);
  });
  test('commit-phase REFUSES a non-conventional message and lands nothing', () => {
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath,
        [join(REPO, 'bin', 'commit-phase.mjs'), '--ref', REFUSAL_REF, '-m', 'not a conventional subject', '--', 'package.json'],
        { encoding: 'utf8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { code = e.status; out = `${e.stdout || ''}${e.stderr || ''}`; }
    assert.equal(code, 2, `expected refusal exit 2, got ${code}: ${out.slice(0, 300)}`);
    assert.match(out, /not a Conventional Commit/);
    assert.match(out, /Nothing was staged, nothing landed/);
  });
});

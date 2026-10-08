// commitwork — Conventional Commits v1.0.0, as a refusal. Pure; bin/commit-phase.mjs calls it.
//
// WHAT THIS CAN AND CANNOT DECIDE, said first because the gap is the whole risk of a gate like this.
// The specification has seventeen clauses. Some are FORM — a colon and space after the type, a blank
// line before the body, a footer token that uses hyphens — and a parser settles them. Two are
// MEANING: clause 2 says `feat` MUST be used when a commit adds a feature, clause 3 says `fix` MUST
// be used for a bug fix. Nothing here can check those. A commit that adds a feature under `chore:`
// passes this gate and violates the specification.
//
// So this gate enforces the SHAPE of a conventional commit and must never be described as enforcing
// conventional commits. The difference matters because the value of the convention is machine-
// readable history — a release tool reading `feat` to decide a minor bump gets the wrong answer from
// a well-formed lie, and a gate that reported "conventional" would have certified it.
//
// TYPES ARE RESTRICTED TO A LIST, and that is a HOUSE RULE rather than the specification's — clause
// 15 explicitly permits types beyond feat and fix. It is turned on because leaving it off left a
// hole big enough to drive the old habit through: this repository's previous subject style was
// `<area>: <description>`, and `taxonomy: ...` parses as a perfectly well-formed conventional commit
// whose TYPE is `taxonomy`. Measured over the last 80 subjects: taxonomy 7, redactions 7, backlog 3,
// traps 2, against feat 2 and fix 3. So the gate was accepting the very style it was added to
// replace, and reporting it conventional.
//
// Those words are SCOPES wearing a type's clothes, which is why the refusal suggests the scope form
// rather than a bare list — `docs(taxonomy):` keeps the information and makes the type mean
// something to a machine.
import { tells } from './prose-tells.mjs';
import { IMPERATIVE_VERBS } from './imperative-verbs.mjs';

export const DEFAULT_TYPES = Object.freeze([
  'feat', 'fix', 'build', 'chore', 'ci', 'docs', 'perf', 'refactor', 'revert', 'style', 'test',
]);

// fact: whole subject, git's own wrap point
export const SUBJECT_MAX = 72;

// fact: scope is a closed set / a free-text scope carries no machine meaning
// fact: each scope names the path prefixes it may touch / a scope over paths outside it is refused
export const DEFAULT_SCOPES = Object.freeze({
  admin: ['admin/'], bin: ['bin/'], cra: ['cra/'], docs: ['docs/', 'README.md', 'CLAUDE.md'],
  docsite: ['docsite/'], lib: ['lib/'], manifests: ['manifests/'], mcp: ['mcp/'], monitor: ['monitor/'],
  schema: ['schema/'], sitemap: ['sitemap/'], map: ['map/'], flow: ['flow/'],
  fixtures: ['fixtures/'], design: ['design/'], ci: ['.github/', 'ci/', 'workflows/'],
  joern: ['joernwork/'], 'chunk-diff': ['chunk-diff/'], provenance: ['provenance/'],
  'commit-phase': ['bin/commit-phase', 'bin/format-phase', 'bin/lib/conventional-commit', 'bin/lib/prose-tells',
    'bin/test/commit-phase', 'bin/test/conventional-commit', 'bin/test/prose-tells', 'bin/commit-msg',
    'bin/install-commit-msg', 'bin/lib/commit-msg-hook', 'bin/lib/imperative-verbs', 'bin/test/commit-msg'],
  comments: ['bin/comment-', 'bin/test/comment-', 'admin/routes/comments', 'admin/static/comments', 'admin/test/comments'],
  taxonomy: ['monitor/taxonomy', 'bin/taxonomy', 'bin/test/taxonomy', 'docsite/'],
  attribution: ['bin/lib/touch-', 'bin/touch-', 'bin/test/touch-', 'bin/test/commit-phase-attribution'],
  redactions: ['lib/publish-', 'bin/pre-publish', 'bin/test/publish-', 'schema/publish-', 'schema/release-redactions', 'monitor/publish-'],
  licensing: ['LICENSING.md', 'LICENSE', 'docs/AGPL-SCOPE.md', 'docs/stack/'],
  stack: ['docs/stack/'], readme: ['README.md'],
  gates: ['bin/gate-', 'bin/lib/gate-', 'bin/test/gate-'],
  roster: ['bin/session-roster', 'bin/test/session-roster'],
  release: ['bin/release', 'bin/lib/release', 'bin/test/release'],
  deps: ['package.json', 'package-lock.json'],
});

// fact: a repository names its rule set in `git config commitwork.rules`; unset is commitwork's own
// fact: COBOL syntax is runs of capitalised words (OCCURS DEPENDING ON), so the shout tell is off where COBOL is the subject
export const RULE_SETS = Object.freeze({
  commitwork: Object.freeze({ allowedScopes: DEFAULT_SCOPES, skipTells: Object.freeze([]) }),
  cobolwork: Object.freeze({ allowedScopes: null, skipTells: Object.freeze(['shout']) }),
  ironwork: Object.freeze({ allowedScopes: null, skipTells: Object.freeze(['shout']) }),
  'cobolwork-web': Object.freeze({ allowedScopes: null, skipTells: Object.freeze([]) }),
});

/** The options a rule set adds to validateConventional: { ok, name, opts } or { ok: false, why }. */
export function rulesFor(name) {
  const key = name || 'commitwork';
  if (!Object.hasOwn(RULE_SETS, key)) {
    return { ok: false, why: `commitwork.rules names '${key}', and the rule sets are ${Object.keys(RULE_SETS).join(', ')}` };
  }
  return { ok: true, name: key, opts: RULE_SETS[key] };
}

// fact: a subject says what the commit does when applied: `feat(gate): fail patches that delete the flagged line`
const MOOD_EXAMPLE = 'e.g. `feat(gate): fail patches that delete the flagged line`, not `feat: the gate fails a patch that …`';
const NOUN_OPENERS = new Set(('the a an this that these those its their our my your every each all no some any both '
  + 'either neither another such one two three four five six seven eight nine ten eleven twelve it they we what which '
  + 'there here').split(' '));

const isVerb = (word) => {
  if (IMPERATIVE_VERBS.has(word)) return true;
  const m = word.match(/^(?:re|un|de|pre)-?([a-z][a-z-]*)$/);
  return Boolean(m && m[1].length >= 3 && IMPERATIVE_VERBS.has(m[1]));
};

/** The listed verb an -s, -ed or -ing form comes from, or null. */
function baseVerb(word) {
  const tries = [];
  if (word.endsWith('ies') || word.endsWith('ied')) tries.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) tries.push(word.slice(0, -2));
  if (word.endsWith('s')) tries.push(word.slice(0, -1));
  if (word.endsWith('ed')) tries.push(word.slice(0, -2), word.slice(0, -1), word.slice(0, -3));
  if (word.endsWith('ing')) tries.push(word.slice(0, -3), `${word.slice(0, -3)}e`, word.slice(0, -4));
  return tries.find((t) => t.length >= 2 && isVerb(t)) ?? null;
}

/** The refusal for a description that does not open with a lower-case imperative verb, or null. */
export function moodError(description) {
  const word = String(description ?? '').trim().split(/\s+/)[0].replace(/[,.;:!?)]+$/, '');
  const lower = word.toLowerCase();
  if (/['’]s$/.test(lower)) {
    return err('house', `the description starts with '${word}', a possessive that opens a noun phrase`, `start with the verb, ${MOOD_EXAMPLE}`);
  }
  if (isVerb(lower)) {
    return word === lower ? null : err('house', `the description starts with '${word}', and descriptions start lower case`, `write '${lower}'`);
  }
  const base = baseVerb(lower);
  if (base) {
    return err('house', `the description starts with '${word}', which is not the imperative`,
      `write '${base}': the subject says what the commit does, ${MOOD_EXAMPLE}`);
  }
  if (NOUN_OPENERS.has(lower)) {
    return err('house', `the description starts with '${word}', which opens a noun phrase`, `start with the verb, ${MOOD_EXAMPLE}`);
  }
  return err('house', `the description starts with '${word}', which is not a verb in bin/lib/imperative-verbs.mjs`,
    `start with an imperative verb, ${MOOD_EXAMPLE}. If '${lower}' is a verb, add it to commitwork's bin/lib/imperative-verbs.mjs`);
}

const under = (path, prefixes) => prefixes.some((pre) => path === pre || path.startsWith(pre));

// fact: scopes whose prefixes cover a declared path, for the refusal to suggest
export function scopesFor(paths, scopes = DEFAULT_SCOPES) {
  return Object.keys(scopes).filter((s) => paths.some((p) => under(p, scopes[s])));
}

/** Clause 1/4: type, optional (scope), optional !, then a REQUIRED colon and space. */
// The scope group accepts ZERO characters on purpose. `fix(): x` is malformed, but matching it here
// lets clause 4 say "the scope is empty" instead of clause 1 saying "no <type>: prefix was found" —
// the author's mistake is the parentheses, and a message pointing at the type sends them to inspect
// the one part that was right.
const HEADER_RE = /^(?<type>[A-Za-z][A-Za-z0-9]*)(?:\((?<scope>[^()\r\n]*)\))?(?<bang>!)?: (?<description>.+)$/;

// Clause 9/17: a footer token uses `-` in place of whitespace. BREAKING CHANGE is the one exception,
// and BREAKING-CHANGE is synonymous with it.
const FOOTER_RE = /^(?<token>BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][A-Za-z0-9-]*)(?<sep>: | #)(?<value>.*)$/;

const err = (clause, message, fix) => ({ clause, message, fix });

/**
 * Validate a full commit message.
 *
 * @param {string} message raw message, subject line first
 * @param {{allowedTypes?: string[]|null, allowMerge?: boolean}} [opts]
 *   allowedTypes — a HOUSE rule, not the spec's. Defaults to DEFAULT_TYPES. Pass `null` EXPLICITLY
 *                  for spec-only mode, where any well-formed type passes (clause 15). The default
 *                  is the restrictive one because the permissive default is what let the old
 *                  `<area>:` habit through the gate unnoticed.
 *   allowMerge   — exempt `Merge ...` / `Revert ...` subjects git itself authors.
 *   skipTells    — prose-tell ids a rule set turns off (RULE_SETS).
 *   checkMood    — the description opens with a lower-case imperative verb (moodError).
 * @returns {{ok:boolean, errors:Array<{clause:string,message:string,fix:string}>, parsed:object|null}}
 */
export function validateConventional(message, {
  allowedTypes = DEFAULT_TYPES, allowMerge = true, allowedScopes = DEFAULT_SCOPES, paths = null,
  subjectMax = SUBJECT_MAX, checkTells = true, skipTells = [], checkMood = true,
} = {}) {
  const errors = [];
  const raw = String(message ?? '');
  // An empty message is refused as a distinct condition. Reporting it as "bad header" would send the
  // author looking for a typo in a line that is not there.
  if (!raw.trim()) {
    return { ok: false, parsed: null, errors: [err('input', 'the commit message is empty', 'write a subject line: <type>(<scope>): <description>')] };
  }

  // Normalise line endings before splitting; a CRLF file would otherwise leave \r on every subject
  // and fail the header match for a reason the author cannot see on screen.
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const subject = lines[0];

  // Git authors these itself during a merge or a revert, and neither is written by the person the
  // gate is speaking to. Refusing them would make an ordinary merge impossible while teaching
  // nothing. Exempt, and SAID to be exempt, rather than quietly passing an unrecognised shape.
  if (allowMerge && /^(Merge|Revert) /.test(subject)) {
    return { ok: true, errors: [], parsed: { type: null, exempt: subject.startsWith('Merge') ? 'merge' : 'revert', subject } };
  }

  const m = subject.match(HEADER_RE);
  if (!m) {
    // Say which part is wrong where that is knowable, because "does not match" sends an author
    // hunting through a seventeen-clause document for a missing space.
    const near = /^[A-Za-z][A-Za-z0-9]*(\([^()]*\))?!?:(?!\s)/.test(subject)
      ? 'a colon is present but not followed by a space'
      : /^[A-Za-z][A-Za-z0-9]*(\([^()]*\))?!?$/.test(subject)
        ? 'the type is present but the required colon and description are missing'
        : /^[A-Za-z][A-Za-z0-9]*(\([^()]*\))?!?:\s*$/.test(subject)
          ? 'the description after the colon is empty'
          : 'no `<type>: ` prefix was found';
    errors.push(err('1,5', `subject does not match \`<type>[(scope)][!]: <description>\` — ${near}`,
      'e.g. `fix(mcp): reject arguments that do not match the published schema`'));
    return { ok: false, parsed: null, errors };
  }

  const { type, scope, bang, description } = m.groups;

  // Clause 16: case-insensitive except BREAKING CHANGE. Lowercasing for the allowlist comparison
  // rather than refusing `Fix:` keeps this on the spec's side of the line.
  if (allowedTypes && !allowedTypes.map((t) => t.toLowerCase()).includes(type.toLowerCase())) {
    // The rejected word is almost always a SCOPE that arrived in the type position — the old
    // `<area>: <description>` habit. Suggesting the move keeps the information the author wanted to
    // convey instead of asking them to throw it away and pick from a list.
    errors.push(err('house', `type '${type}' is not in this repository's allowed set`,
      `if '${type}' names an area, it is a SCOPE: write \`docs(${type}): …\` or \`fix(${type}): …\`. `
      + `Allowed types: ${allowedTypes.join(', ')}`));
  }
  if (scope !== undefined && !scope.trim()) {
    errors.push(err('4', 'the scope is empty', 'give the scope a noun, or drop the parentheses entirely'));
  } else if (scope !== undefined && allowedScopes && !Object.hasOwn(allowedScopes, scope)) {
    const hint = Array.isArray(paths) && paths.length ? scopesFor(paths, allowedScopes) : [];
    errors.push(err('house', `scope '${scope}' is not in this repository's scope set`,
      hint.length ? `your paths are under: ${hint.join(', ')}` : `scopes: ${Object.keys(allowedScopes).join(', ')}`));
  } else if (scope !== undefined && allowedScopes && Array.isArray(paths) && paths.length
    && !paths.some((p) => under(p, allowedScopes[scope]))) {
    const hint = scopesFor(paths, allowedScopes);
    errors.push(err('house', `scope '${scope}' covers ${allowedScopes[scope].join(', ')} and no declared path is under it`,
      hint.length ? `your paths are under: ${hint.join(', ')}` : 'declare paths under the scope, or drop the scope'));
  }
  if (subjectMax && subject.length > subjectMax) {
    errors.push(err('house', `the subject is ${subject.length} characters; the cap is ${subjectMax}`,
      'shorten the description; a reference like (D19 item 5) goes in a Refs: footer'));
  }
  if (!description.trim()) {
    errors.push(err('5', 'the description is empty', 'describe the change after the colon and space'));
  } else if (checkMood) {
    const mood = moodError(description);
    if (mood) errors.push(mood);
  }

  // Clause 6: the body begins ONE BLANK LINE after the description. A second line of prose glued to
  // the subject is the common miss, and it silently makes the subject a paragraph to every tool that
  // reads only the first line.
  if (lines.length > 1 && lines[1].trim() !== '') {
    errors.push(err('6', 'the body must begin one blank line after the description',
      'insert a blank line between the subject and the body'));
  }

  // Clause 11-14: breaking changes are indicated by `!` in the prefix or a BREAKING CHANGE footer.
  const footerStart = findFooterStart(lines);
  const footers = footerStart === -1 ? [] : parseFooters(lines.slice(footerStart));
  const breakingFooter = footers.find((f) => f.token === 'BREAKING CHANGE' || f.token === 'BREAKING-CHANGE');
  if (breakingFooter && !breakingFooter.value.trim()) {
    errors.push(err('12', 'BREAKING CHANGE must be followed by a colon, a space and a description',
      'e.g. `BREAKING CHANGE: the url field replaces urls for single-service entries`'));
  }
  // Clause 16: BREAKING CHANGE is the one token that MUST be uppercase.
  //
  // SCANNED OVER THE WHOLE MESSAGE, NOT THE FOOTER BLOCK, and that is the entire point. A lowercase
  // `breaking change: x` does not match the footer grammar at all — the space makes it prose — so
  // findFooterStart returns -1 and a check restricted to the detected block never runs. The first
  // version of this did exactly that and silently passed the case it was written to catch: the
  // author believes they flagged a breaking change, no footer exists, and release tooling never
  // sees one. The defect and the blind spot were the same mechanism.
  for (const line of lines.slice(1)) {
    if (/^breaking[ -]change\s*:/i.test(line) && !/^BREAKING[ -]CHANGE\s*:/.test(line)) {
      errors.push(err('16', `'${line.split(':')[0].trim()}' must be uppercase to count as a breaking-change footer`,
        'write `BREAKING CHANGE:` exactly, or the flag is lost and the line is read as prose'));
      break;
    }
  }

  if (checkTells) {
    for (const t of tells(lines.join('\n'), 'commit')) {
      if (skipTells.includes(t.id)) continue;
      errors.push(err('house', `line ${t.line}: "${t.match}" (${t.id})`, t.why));
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    parsed: {
      type,
      scope: scope ?? null,
      breaking: Boolean(bang) || Boolean(breakingFooter),
      description,
      footers,
      subject,
    },
  };
}

/**
 * Index of the first line of the trailing footer block, or -1.
 *
 * Footers are the LAST contiguous run of footer-shaped lines that follows a blank line — the spec's
 * clause 8. Scanning from the top would misread a body paragraph that happens to open with
 * `Note: something`, which is ordinary prose and not a footer.
 */
export function findFooterStart(lines) {
  // TRAILING BLANK LINES ARE SKIPPED FIRST, and this was a real defect rather than a nicety. Git
  // terminates a commit message with a newline, so `lines` almost always ends with an empty string.
  // Scanning up from the true last element hit that blank immediately, broke, and returned -1 — so
  // on essentially every REAL message no footers were found at all and a correctly written
  // `BREAKING CHANGE:` was invisible. That is the precise failure this file's comments warn about,
  // reached through the correct spelling instead of the lowercase one.
  //
  // Every fixture in the test file happened to omit the trailing newline, so the suite was green
  // over a shape no git message has. One unrealistic detail repeated across every case hid it.
  let end = lines.length - 1;
  while (end >= 1 && lines[end].trim() === '') end -= 1;
  let start = -1;
  for (let i = end; i >= 1; i--) {
    const line = lines[i];
    if (line.trim() === '') break;
    // A continuation line (clause 10: a footer value may contain newlines) does not break the run,
    // but it cannot START one either.
    if (FOOTER_RE.test(line)) start = i;
    else if (start === -1) continue;   // trailing prose after the footers — keep looking upward
    else break;                        // prose ABOVE a footer run ends it
  }
  return start;
}

/** Parse a footer block; continuation lines fold into the previous footer's value (clause 10). */
export function parseFooters(block) {
  const out = [];
  for (const line of block) {
    const m = line.match(FOOTER_RE);
    if (m) out.push({ token: m.groups.token, separator: m.groups.sep, value: m.groups.value });
    else if (out.length) out[out.length - 1].value += `\n${line}`;
  }
  return out;
}

/** One-line-per-error rendering for a CLI refusal, with the spec clause each cites. */
export function formatErrors(result, { subject = '' } = {}) {
  const lines = [];
  for (const e of result.errors) lines.push(`  · [clause ${e.clause}] ${e.message}\n      fix: ${e.fix}`);
  if (subject) lines.unshift(`  subject was: ${JSON.stringify(subject.slice(0, 120))}`);
  return lines.join('\n');
}

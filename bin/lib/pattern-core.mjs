// pattern-core — the scanner's decisions, pure. bin/pattern-scan.mjs holds the I/O.
// Detectors emit observations, never verdicts; impact comes off the registry, so none can mint a
// CRITICAL. Identity <path>::<scope>::<class> excludes `line`: a finding that MOVES is the same one.

import { shannon, isRepoDigest, looksLikeIdentifier, isPlaceholder } from './secret-heuristics.mjs';

export const CONFIDENCE = Object.freeze(['structural', 'heuristic', 'inferred']);
export const ADJUDICATIONS = Object.freeze(['finding', 'undetermined', 'accepted', 'baseline']);

/** The identity of an observation. Excludes the line number, deliberately and permanently. */
export const identityOf = ({ path, scope, classId }) => `${path}::${scope ?? '<file>'}::${classId}`;

// ── REDACTION ───────────────────────────────────────────────────────────────────────────────────
// Snippets reach an export path. Entropy predicate, borrowed — a different instrument from the match.

export const REDACTOR = 'secrets-sweep:shannon';
const REDACTION_MIN_RUN = 20;
const REDACTION_MIN_ENTROPY = 4.0;

/** Replace high-entropy runs. `redacted` is a count so "nothing to redact" ≠ "redaction not run". */
export function redactSnippet(text) {
  let redacted = 0;
  const out = String(text ?? '').replace(/[A-Za-z0-9_\-+/=]{20,}/g, (run) => {
    if (run.length < REDACTION_MIN_RUN) return run;
    if (isRepoDigest(run) || looksLikeIdentifier(run) || isPlaceholder(run)) return run;
    if (shannon(run) < REDACTION_MIN_ENTROPY) return run;
    redacted++;
    return `⟨redacted:${run.length}c⟩`;
  });
  return { text: out, redacted };
}

/** One observation, normalised. Snippets are redacted HERE, at construction, not at render. */
export function observation({ detector, version, classId, path, scope, line, predicate, snippet, confidence = 'structural', extra = null }) {
  if (!CONFIDENCE.includes(confidence)) throw new Error(`unknown confidence '${confidence}'`);
  const red = redactSnippet(snippet);
  return {
    identity: identityOf({ path, scope, classId }),
    detector: `${detector}@${version}`,
    classId,
    place: { path, scope: scope ?? '<file>', line: line ?? null, lineIsAdvisory: true },
    evidence: { predicate, snippet: red.text, redacted: red.redacted, redactor: red.redacted ? REDACTOR : null },
    confidence,
    ...(extra ? { extra } : {}),
  };
}

// ── LEXICAL HELPERS ─────────────────────────────────────────────────────────────────────────────
// On stripNonCode output: non-code blanked same-length, so offsets align. One strip per file.

/** Index of the `}` matching the `{` at openIdx, or -1. Operates on stripped source only. */
export function matchBrace(t, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

const WS = /\s/;
const IDENT_CH = /[A-Za-z0-9_$]/;
const backTo = (t, i) => { while (i >= 0 && WS.test(t[i])) i--; return i; };

/** Is the `{` at idx the body of a function or arrow — i.e. code that runs at CALL time? */
export function isFunctionBrace(t, idx) {
  const j = backTo(t, idx - 1);
  if (j < 0) return false;
  if (t[j] === ')') return true;                       // function f(…) { · (…) => … is caught below
  if (t[j] === '>' && t[j - 1] === '=') return true;   // … => {
  return false;
}

/** In a concise arrow body — `() => process.env.X`, no braces? Its absence dominated a 458-finding run. */
export function inConciseArrow(t, offset) {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const c = t[i];
    if (c === ')' || c === ']' || c === '}') { depth++; continue; }
    if (c === '(' || c === '[') {
      // Unmatched opener = step OUT: `() => resolve(process.env.X)`. Returning false here was FP #2.
      if (depth > 0) depth--;
      continue;
    }
    if (c === '{') { if (depth === 0) return false; depth--; continue; }
    if (depth !== 0) continue;
    if (c === ';' || c === ',') return false;            // a statement or binding boundary
    if (c === '>' && t[i - 1] === '=') return true;      // `=>` reached without crossing a brace
  }
  return false;
}

/** Runs at CALL time? Braced body in the stack, or a concise arrow. Object literals are not. */
export function insideFunction(t, offset) {
  const stack = [];
  for (let i = 0; i < offset; i++) {
    if (t[i] === '{') stack.push(i);
    else if (t[i] === '}') stack.pop();
  }
  if (stack.some((idx) => isFunctionBrace(t, idx))) return true;
  return inConciseArrow(t, offset);
}

/** 1-based line number of an offset. */
export const lineAt = (src, offset) => {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
};

/** The original (unstripped) text of the line containing an offset, trimmed and capped. */
export const lineTextAt = (src, offset, cap = 160) => {
  const a = src.lastIndexOf('\n', offset) + 1;
  const b = src.indexOf('\n', offset);
  return src.slice(a, b < 0 ? src.length : b).trim().slice(0, cap);
};

// ── SRC DETECTORS ───────────────────────────────────────────────────────────────────────────────
// (file: {rel, src, stripped}) => observation[]. No fs, no severity.

const ENV = /\bprocess\s*\.\s*env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*'([^']+)')?/g;

/** M9 — env read at module scope, frozen at import. CW_* is structural; anything else heuristic. */
export function detectEnvAtModuleLoad({ rel, src, stripped }) {
  const out = [];
  ENV.lastIndex = 0;
  for (let m; (m = ENV.exec(stripped)); ) {
    if (insideFunction(stripped, m.index)) continue;
    const name = m[1] || m[2] || null;
    const owned = name ? /^CW_/.test(name) : false;
    out.push(observation({
      detector: 'env-at-module-load', version: 1, classId: 'M9',
      path: rel, scope: '<module>', line: lineAt(src, m.index),
      predicate: owned
        ? `${name} is read at module scope, so the value is frozen at import and any test that sets it afterwards proves nothing`
        : `${name || 'process.env'} is read at module scope — outside the CW_* override namespace, so whether that is a defect is UNDETERMINED`,
      snippet: lineTextAt(src, m.index),
      confidence: owned ? 'structural' : 'heuristic',
      extra: name ? { envVar: name } : null,
    }));
  }
  return out;
}

const CATCH = /\bcatch\b\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g;
const EMPTY_RETURN = /\breturn\s*(\[\s*\]|\{\s*\}|null|undefined|false|0|''|""|``)\s*[;}\n]/;
// Recorded ≠ discriminated: the consumer still cannot tell corrupt from empty, but it is not silent.
const RECORDS = /console\s*\.\s*(?:error|warn)|stderr\s*\.\s*write|\berrors?\s*\.\s*push\b/;

// FAILING CLOSED IS NOT C11, AND RECORDING IS NOT THE ONLY WAY TO DO IT.
//
// RECORDS above catches the shapes that SHOUT — console.error, stderr, errors.push. It misses the
// stronger one: a catch that assigns a STRUCTURED FAILURE STATE the caller can branch on, and then
// returns null as a control-flow convenience. Measured 2026-08-26 on monitor/forensics.mjs:69,
// which the detector published at `structural` confidence:
//
//     lanes[name] = { failed: true, error: String((e && e.message) || e) };
//     return null;
//
// Nothing there is indistinguishable from absence — `failed: true` IS the discrimination, and the
// comment one line above says so. That is the house fail-closed rule being obeyed, reported as the
// class that exists to catch disobeying it. A10, manufactured false positive.
//
// NARROW ON PURPOSE. It requires an ASSIGNMENT (not a return) of an object literal carrying a
// failure marker AND mentioning the bound error, so a catch that merely returns `{ error: null }`
// or names a variable called `failed` does not qualify. Widening this to "any body mentioning
// error" would suppress the real class wholesale, which is the more expensive direction.
/**
 * Any conditional on the bound error, or a comparison of one of its properties.
 *
 * ONE IMPLEMENTATION, THREE CALLERS. C11, A20 and A24 all need "did this handler look at WHICH error
 * it caught", and writing it once per detector is G17 — a second hand-written model of a concept
 * that already has one, which drifts silently because nothing compares them.
 */
const discriminatesOn = (bodyStripped, err) =>
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
  new RegExp(`\\b(?:if|switch)\\b[^;{]*\\b${err}\\b`).test(bodyStripped)
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
  || new RegExp(`\\b${err}\\s*(?:\\.|\\?\\.)[\\w$]+\\s*(?:===|!==|==|!=)`).test(bodyStripped);

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
const failsClosed = (body, err) => new RegExp(
  `=\\s*\\{[^}]*\\b(?:failed|ok|error|status)\\s*:[^}]*\\b${err}\\b[^}]*\\}`,
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
).test(body) || new RegExp(
  `=\\s*\\{[^}]*\\b${err}\\b[^}]*\\b(?:failed|ok|error|status)\\s*:[^}]*\\}`,
).test(body);

/**
 * C11 — a catch returning a success-shaped value without discriminating ENOENT. BOUND catches only:
 * bare-catch-ratchet holds the unbound form. That split was once asserted; measuring found 144 shared.
 */
export function detectCatchEmptyReturn({ rel, src, stripped }) {
  const out = [];
  CATCH.lastIndex = 0;
  for (let m; (m = CATCH.exec(stripped)); ) {
    if (!m[1]) continue;                                 // unbound: the ratchet's population
    const open = m.index + m[0].length - 1;
    const close = matchBrace(stripped, open);
    if (close < 0) continue;
    // Structure from STRIPPED, ENOENT from ORIGINAL — the lexer blanks string literals.
    const bodyStripped = stripped.slice(open, close + 1);
    const bodyOriginal = src.slice(open, close + 1);
    if (/\bthrow\b/.test(bodyStripped)) continue;
    if (!EMPTY_RETURN.test(bodyOriginal)) continue;
    // Any conditional on the bound error, not a property list: the old one published `e.status === 1`.
    const err = m[1];
    if (discriminatesOn(bodyStripped, err)) continue;
    // A structured failure state assigned where the caller can see it is discrimination by another
    // name — the return value is not the only channel a catch has.
    if (failsClosed(bodyStripped, err) || failsClosed(bodyOriginal, err)) continue;
    out.push(observation({
      detector: 'catch-empty-return', version: 1, classId: 'C11',
      path: rel, scope: 'catch', line: lineAt(src, m.index),
      predicate: RECORDS.test(bodyOriginal)
        ? `a catch body returns an empty value and records the error but never discriminates it, so a downstream consumer still cannot tell a corrupt input from an absent one — UNDETERMINED, because the failure is at least not silent`
        : 'a catch body returns an empty or success-shaped value, does not rethrow, and never discriminates the error — so an unreadable input is indistinguishable from an absent one',
      snippet: bodyOriginal.replace(/\s+/g, ' ').trim().slice(0, 160),
      confidence: RECORDS.test(bodyOriginal) ? 'heuristic' : 'structural',
    }));
  }
  return out;
}

// The lookbehind is load-bearing: `\b(test|it)\s*\(` also matches the `.test(` of every regex test
// in the tree, so `assert.ok(!/x/.test(s))` read as a test declaration with no assertion in it.
// That one character produced 117 observations over 275 files — 43%, which is a defect signature.
const TEST_CALL = /(?<![.\w$])(?:await\s+)?(test|it)\s*\(/g;
const ASSERTS = /\bassert\b|\bexpect\s*\(|\.throws\s*\(|\.rejects\b|\bdeepEqual\b|\bstrictEqual\b|\bdoesNotThrow\b|\bok\s*\(|\bfail\s*\(/;

/** R1 — a test body with no assertion: it passes on every input, including the one it targets. */
export function detectTestAssertsNothing({ rel, src, stripped }) {
  if (!/\.test\.mjs$/.test(rel)) return [];
  const out = [];
  TEST_CALL.lastIndex = 0;
  for (let m; (m = TEST_CALL.exec(stripped)); ) {
    // The body is the brace after `=>` or `function`, NOT the first brace after `test(`: the
    // options form `test(name, { skip: … }, fn)` puts an object there, and taking it as the body
    // reported every skippable test as assertion-free.
    const fn = /(?:=>|\bfunction\b[^(]*\([^)]*\))\s*\{/g;
    fn.lastIndex = m.index;
    const f = fn.exec(stripped);
    if (!f) continue;
    const open = f.index + f[0].length - 1;
    const close = matchBrace(stripped, open);
    if (close < 0) continue;
    const bodyOriginal = src.slice(open, close + 1);
    if (ASSERTS.test(bodyOriginal)) continue;
    // A body that only delegates may assert inside the helper — heuristic, so undetermined.
    const delegates = /\b[a-zA-Z_$][\w$]*\s*\(/.test(bodyOriginal);
    // The title is the test's place; a computed title has none, so those share one identity per file.
    const title = src.slice(m.index + m[0].length).match(/^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/)?.[2];
    out.push(observation({
      detector: 'test-asserts-nothing', version: 1, classId: 'R1',
      path: rel, scope: title === undefined ? m[1] : `${m[1]}:${title}`, line: lineAt(src, m.index),
      predicate: 'a test body contains no assertion, so it reports pass on every input',
      snippet: lineTextAt(src, m.index),
      confidence: delegates ? 'heuristic' : 'structural',
    }));
  }
  return out;
}

const FOR_OF = /\bfor\s*\(\s*(?:const|let)\s+[\w$]+\s+of\s+([A-Za-z_$][\w$.]*)\s*\)/g;
// A collection is at risk only if it is COMPUTED. A literal array cannot be empty, and 144 of the
// 183 loop-assert sites here iterate one. Object.keys/entries count only over a lowercase-initial
// binding — over a SCREAMING_CASE literal they are as fixed as the literal.
const DERIVED = /\.\s*(?:match|matchAll|filter|map|flatMap)\s*\(|readFileSync|JSON\s*\.\s*parse|Object\s*\.\s*(?:keys|entries)\s*\(\s*[a-z]|[a-z][\w$]*\s*\.\s*split\s*\(/;

/**
 * Proofs of non-emptiness OTHER than a length assertion, all measured against real sites:
 *   assert.ok(c.some(…))            — true only if c has a member
 *   deepEqual(c…, ['x'])            — a non-empty literal on the right
 *   deepEqual(c…, [])               — the test EXPECTS empty, so the loop is vacuous BY DESIGN
 * The last is not a guard but a declaration, and either way the site is not the defect.
 */
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
const nonEmptyProof = (base) => new RegExp(
  `assert[^\\n]*\\b${base}\\b[^\\n]*\\.\\s*some\\s*\\(`
  + `|deepEqual\\s*\\([^\\n]*\\b${base}\\b[^\\n]*,\\s*\\[\\s*(?:\\]|['"\`])`
  + `|deepStrictEqual\\s*\\([^\\n]*\\b${base}\\b[^\\n]*,\\s*\\[\\s*(?:\\]|['"\`])`);

/**
 * R1, second predicate — a test asserts inside a loop over a DERIVED collection and nothing asserts
 * the collection is non-empty, so an empty derivation passes having checked nothing.
 *
 * HEURISTIC ON PURPOSE, which is what makes it report-only: adjudicate() routes anything softer than
 * structural to `undetermined`, so it counts and never publishes. Promoting it to structural IS the
 * decision to gate, and should be made after the standing sites are cleared, not before — a gate
 * that fires 20 times on arrival gets baselined, which banks the defect as the floor.
 *
 * The guard is looked for FILE-wide rather than in the loop, which errs toward silence: a non-empty
 * assertion in a sibling test still counts.
 */
export function detectTestLoopUnguarded({ rel, src, stripped }) {
  if (!/\.test\.mjs$/.test(rel)) return [];
  const out = [];
  FOR_OF.lastIndex = 0;
  for (let m; (m = FOR_OF.exec(stripped)); ) {
    const coll = m[1];
    const base = coll.split('.')[0];
    // The body is braced or it is a single statement — `for (const r of rows) assert.ok(r);` is the
    // compact form this repo uses, and requiring `{` silently skipped every one of them.
    const after = m.index + m[0].length;
    let body;
    const brace = stripped.slice(after).search(/\S/);
    if (brace >= 0 && stripped[after + brace] === '{') {
      const close = matchBrace(stripped, after + brace);
      if (close < 0) continue;
      body = stripped.slice(after + brace, close + 1);
    } else {
      const semi = stripped.indexOf(';', after);
      body = stripped.slice(after, semi < 0 ? stripped.length : semi + 1);
    }
    if (!/\bassert\b/.test(body)) continue;
    // The NEAREST PRECEDING declaration, and the guard is looked for only between it and the loop.
    // A file-wide search cleared bin/test/resolve-sha.test.mjs entirely off one test's
    // `assert.ok(lines.length > 100)` while a second test rebound the same name to a `.slice(0, 40)`
    // with no guard at all — one name, two bindings, and only the first was ever checked.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
    const declRe = new RegExp(`(?:const|let|var)\\s+${base}\\s*=\\s*([^;\\n]{0,140})`, 'g');
    let decl = null;
    for (let d; (d = declRe.exec(stripped)) && d.index < m.index; ) decl = d;
    if (!decl || !DERIVED.test(decl[1])) continue;
    // The window is the ENCLOSING TEST BODY, not declaration-to-loop: a length assertion AFTER the
    // loop still constrains the collection (registry-repos.test.mjs closes with
    // `assert.equal(seen.size + unresolvable.length, REPOS.length)`), while a sibling test's guard
    // must not count — which is what scoping to the body, rather than the file, buys.
    let bodyEnd = stripped.length;
    TEST_CALL.lastIndex = 0;
    for (let t; (t = TEST_CALL.exec(stripped)) && t.index < decl.index; ) {
      const fn = /(?:=>|\bfunction\b[^(]*\([^)]*\))\s*\{/g;
      fn.lastIndex = t.index;
      const f2 = fn.exec(stripped);
      if (!f2) continue;
      const o = f2.index + f2[0].length - 1;
      const c = matchBrace(stripped, o);
      if (c > m.index) bodyEnd = c;
    }
    const between = stripped.slice(decl.index, bodyEnd);
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
    const guard = new RegExp(
      `assert[^\\n]*\\b${base}\\b[^\\n]*\\.\\s*(?:length|size)`
      + `|assert[^\\n]*\\.\\s*(?:length|size)[^\\n]*\\b${base}\\b`
      + `|\\b${base}\\s*\\.\\s*(?:length|size)\\s*[>!=]`);
    if (guard.test(between)) continue;
    // Against the ORIGINAL, not the stripped text: the lexer blanks string contents, so
    // `deepEqual(x, ["a","b"])` and `deepEqual(x, [])` are indistinguishable after stripping — and
    // those two mean opposite things. Same trap as the ENOENT discriminator above.
    if (nonEmptyProof(base).test(src)) continue;
    out.push(observation({
      detector: 'test-loop-unguarded', version: 1, classId: 'R1',
      path: rel, scope: `loop:${coll}`, line: lineAt(src, m.index),
      predicate: `assertions run inside a loop over \`${coll}\`, which is derived, and nothing asserts it is non-empty — an empty derivation passes having checked nothing`,
      snippet: lineTextAt(src, m.index),
      confidence: 'heuristic',
      extra: { collection: coll, boundFrom: decl[1].trim().slice(0, 80) },
    }));
  }
  return out;
}

// ── B1 SECOND TRANCHE: A20, K7, C2, A24 ─────────────────────────────────────────────────────────
// Built 2026-09-06 from the ed.15 remediation audit (its spine plan,
// task 2.1). All four classes were RULE-mode with no detector, no canary and no register row: the
// audit's largest finding was that 149 of 179 remediable classes have no mechanical coverage at all.
//
// DISJOINTNESS IS ASSERTED, NOT ASSUMED. C11 is the catch that RETURNS an empty value; A20 is the
// catch that CONTINUES; A24 is the catch that THROWS a new error. Each excludes the others'
// population by construction, and pattern-core.test.mjs runs all three over one another's fixtures
// and asserts an empty intersection — M19 ("asserted partition, overlapping populations") applied to
// the detectors themselves rather than trusted.

const SKIPS = /\bcontinue\s*[;}]|\b[\w$]*(?:skip|ignor|omit)[\w$]*\s*(?:\+\+|\+=)/i;

/**
 * Does something DERIVED FROM THE BOUND ERROR reach a structure or a binding the caller can see?
 * `skipped.push({ reason: e.message })`, `live.add(pid)` under an `e.code` branch, `status = e.status`.
 *
 * MEASURED, NOT ANTICIPATED. The first run of A20 and K7 over this tree published 22 and 13
 * STRUCTURAL findings; every site read was one of these shapes — the house fail-closed idiom, named
 * by the class that exists to catch its absence. `bin/dep-provenance.mjs:54` carries the comment
 * "FAIL CLOSED: a lockfile we could not read is named" one line above the push, and was reported.
 * That is A10, manufactured false positives, and it is the reason both detectors now ask this
 * question before reporting: recording the reason into a channel the caller receives IS
 * discrimination by another name, exactly as `failsClosed` already argues for C11.
 */
const routesCause = (body, err) => {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
  const has = new RegExp(`\\b${err}\\b`);
  return body.split(/[;\n]/).some((seg) => {
    if (!has.test(seg)) return false;
    // A console or stderr write RECORDS the error; it does not route it. The caller's data is
    // unchanged, so under the C11 precedent this stays heuristic rather than clearing the site.
    if (/console\s*\.|stderr\s*\.\s*write/.test(seg)) return false;
    return /\breturn\b|\.\s*(?:push|add|set)\s*\(|=|[\w$]\s*\(/.test(seg);
  });
};

/** Is the bound error named in the body at all? If not, the cause is definitively gone. */
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
const mentions = (body, err) => new RegExp(`\\b${err}\\b`).test(body);

/**
 * A20 — one handler, opposite correct responses. A catch that SKIPS the item without discriminating
 * the error: a permission denial, a rate limit and a genuine absence all produce the same `continue`,
 * so the loop's output cannot distinguish "not there" from "could not look".
 *
 * The population is deliberately the complement of C11's: a body that returns an empty value is that
 * class and is skipped here, so the two counts can be added without double-counting a site.
 */
export function detectCatchContinueUndiscriminated({ rel, src, stripped }) {
  const out = [];
  CATCH.lastIndex = 0;
  for (let m; (m = CATCH.exec(stripped)); ) {
    if (!m[1]) continue;                                 // unbound: bare-catch-ratchet's population
    const open = m.index + m[0].length - 1;
    const close = matchBrace(stripped, open);
    if (close < 0) continue;
    const bodyStripped = stripped.slice(open, close + 1);
    const bodyOriginal = src.slice(open, close + 1);
    if (/\bthrow\b/.test(bodyStripped)) continue;        // A24's population
    if (EMPTY_RETURN.test(bodyOriginal)) continue;       // C11's population
    if (!SKIPS.test(bodyStripped)) continue;
    const err = m[1];
    if (discriminatesOn(bodyStripped, err)) continue;
    if (failsClosed(bodyStripped, err) || failsClosed(bodyOriginal, err)) continue;
    if (routesCause(bodyStripped, err) || routesCause(bodyOriginal, err)) continue;
    // Named but not routed — logged and dropped. Counted, never published: the operator can at
    // least see it went wrong, and promoting that to a gate is a decision, not a measurement.
    const named = mentions(bodyStripped, err) || mentions(bodyOriginal, err);
    out.push(observation({
      detector: 'catch-continue-undiscriminated', version: 1, classId: 'A20',
      path: rel, scope: 'catch', line: lineAt(src, m.index),
      predicate: named
        ? 'a catch skips the item and records the error but never branches on it or routes it to the caller — UNDETERMINED'
        : 'a catch skips the item without ever naming the error, so a refusal, a rate limit and a genuine absence are one silent outcome',
      snippet: bodyOriginal.replace(/\s+/g, ' ').trim().slice(0, 160),
      confidence: named ? 'heuristic' : 'structural',
    }));
  }
  return out;
}

// Local, not the module-level FOR_OF: that object is /g and already driven by detectTestLoopUnguarded.
// Sharing a stateful regex across two detectors makes the second one's results depend on whether the
// first ran, which is a defect this catalogue names twice over.
const LOOP_OF = /\bfor\s*(?:await\s+)?\(\s*(?:const|let|var)\s+[\w$]+\s+of\s+[^)\n]{1,100}\)\s*\{/g;
// A per-item failure LEAVES A TRACE if it is pushed into a structure, flips the process exit code,
// or sets a failure marker. Any of those and the aggregate can still answer "did every item work".
const ITEM_FAILURE_RECORDED = /\.\s*push\s*\(|process\s*\.\s*exitCode\s*=|\b[\w$]*(?:fail|error|bad|broken)[\w$]*\s*(?:\+\+|\+=|=\s*true)|\.\s*set\s*\(/i;

/**
 * K7 — aggregate exit code hides per-item failure. A catch INSIDE a fan-out loop that neither
 * rethrows nor records the failure anywhere: the loop completes, the process exits 0, and N of M
 * items silently did nothing.
 *
 * `forEach` and `Promise.all` callbacks are NOT in this predicate — the binding says so rather than
 * implying the class is covered. Stating the gap is the difference between `partial` and a false
 * `complete`, which is R3 and is the reason this file carries a coverage state at all.
 */
export function detectFanoutSwallowsItem({ rel, src, stripped }) {
  const out = [];
  LOOP_OF.lastIndex = 0;
  for (let loop; (loop = LOOP_OF.exec(stripped)); ) {
    const loopOpen = loop.index + loop[0].length - 1;
    const loopClose = matchBrace(stripped, loopOpen);
    if (loopClose < 0) continue;
    const inner = stripped.slice(loopOpen, loopClose + 1);
    const catcher = /\bcatch\b\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g;
    for (let c; (c = catcher.exec(inner)); ) {
      const open = c.index + c[0].length - 1;
      const close = matchBrace(inner, open);
      if (close < 0) continue;
      const bodyStripped = inner.slice(open, close + 1);
      const bodyOriginal = src.slice(loopOpen + open, loopOpen + close + 1);
      const err = c[1];
      if (/\bthrow\b/.test(bodyStripped)) continue;      // the failure reaches the caller
      if (ITEM_FAILURE_RECORDED.test(bodyStripped)) continue;
      // A handler that BRANCHES on the error is handling it deliberately, and one that assigns from
      // it keeps the item's outcome readable: `catch (e) { status = e.status ?? 3 }` two lines above
      // an `if (status > 1) failures += 1`. Both were published as structural by the first run.
      if (discriminatesOn(bodyStripped, err)) continue;
      if (routesCause(bodyStripped, err) || routesCause(bodyOriginal, err)) continue;
      const named = mentions(bodyStripped, err) || mentions(bodyOriginal, err);
      const absOffset = loopOpen + c.index;
      out.push(observation({
        detector: 'fanout-swallows-item', version: 1, classId: 'K7',
        path: rel, scope: 'loop-catch', line: lineAt(src, absOffset),
        predicate: named
          ? 'a catch inside a fan-out loop logs the failure and lets the loop continue, so the aggregate still exits 0 — UNDETERMINED'
          : 'a catch inside a fan-out loop neither rethrows, records, nor names the failure, so the aggregate completes and exits 0 with an unknown number of members having done nothing',
        snippet: bodyOriginal.replace(/\s+/g, ' ').trim().slice(0, 160),
        confidence: named ? 'heuristic' : 'structural',
      }));
    }
  }
  return out;
}

// spawnSync ONLY. execSync and execFileSync THROW on a non-zero exit, so their status has a
// subscriber by construction and requiring a `.status` read of them would be a manufactured finding
// (A10). spawnSync is the one that hands back a status nobody has to look at.
const SPAWN_BOUND = /(?:const|let|var)\s+([\w$]+)\s*=\s*spawnSync\s*\(/g;
const SPAWN_DESTRUCTURED = /(?:const|let|var)\s*\{([^}]{0,200})\}\s*=\s*spawnSync\s*\(/g;

/**
 * C2 — exit code with no subscriber. A spawnSync result whose `status` and `error` are never read.
 *
 * The sharp case, and the only one reported as structural, is a result whose OUTPUT is consumed:
 * the caller parsed stdout and never asked whether the command succeeded, which is how a tool that
 * refuses and exits non-zero produces a clean parse of its own error message. A binding used for
 * nothing at all is a dead binding — a different defect — and is not reported here.
 */
/**
 * Is the offset inside a `try {` block? A consumption guarded by one has a SECOND discriminator: a
 * refusal that produced empty or non-JSON output throws on parse and takes the catch, so the caller
 * distinguishes could-not-run from clean WITHOUT ever reading the status.
 *
 * MEASURED, AND IT IS A CORRECTION TO THIS DETECTOR RATHER THAN TO ANY CALLER. The first run rated
 * monitor/workflow-harden.mjs:154 structural — `try { return JSON.parse(r.stdout || '').length }
 * catch { return null }` — where a zizmor that never ran yields null, not 0, so the class's damage
 * (a refusal read as a clean result) cannot occur. Publishing that as structural is A10 in the
 * instrument built to find A10-adjacent defects. The site is still reported, because the status is
 * genuinely unread and the discrimination is incidental to a parse rather than intended; it is
 * reported as heuristic, so it counts and does not publish.
 */
const insideTry = (stripped, offset) => {
  const TRY = /\btry\s*\{/g;
  for (let t; (t = TRY.exec(stripped)) && t.index < offset; ) {
    const open = t.index + t[0].length - 1;
    const close = matchBrace(stripped, open);
    if (close > offset) return true;
  }
  return false;
};

export function detectExitStatusUnread({ rel, src, stripped }) {
  const out = [];
  SPAWN_BOUND.lastIndex = 0;
  for (let m; (m = SPAWN_BOUND.exec(stripped)); ) {
    const name = m[1];
    const tail = m.index + m[0].length;
    const after = stripped.slice(tail);
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
    if (new RegExp(`\\b${name}\\s*(?:\\.|\\?\\.)\\s*(?:status|error|signal)\\b`).test(after)) continue;
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
    const useRe = new RegExp(`\\b${name}\\s*(?:\\.|\\?\\.)\\s*(?:stdout|stderr|output)\\b`);
    const useAt = after.search(useRe);
    if (useAt < 0) continue;
    const guarded = insideTry(stripped, tail + useAt);
    out.push(observation({
      detector: 'exit-status-unread', version: 1, classId: 'C2',
      path: rel, scope: `spawn:${name}`, line: lineAt(src, m.index),
      predicate: guarded
        ? `the status of \`${name}\` is never read, but its output is consumed inside a try — a refusal that produced no parseable output takes the catch, so could-not-run is distinguishable by accident of the parse — UNDETERMINED`
        : `the output of \`${name}\` is consumed and its status is never read, so a command that refused and exited non-zero is parsed as if it had answered`,
      snippet: lineTextAt(src, m.index),
      confidence: guarded ? 'heuristic' : 'structural',
    }));
  }
  SPAWN_DESTRUCTURED.lastIndex = 0;
  for (let m; (m = SPAWN_DESTRUCTURED.exec(stripped)); ) {
    const names = m[1].split(',').map((s) => s.split(':')[0].trim());
    if (names.some((n) => n === 'status' || n === 'error' || n === 'signal')) continue;
    if (!names.some((n) => n === 'stdout' || n === 'stderr' || n === 'output')) continue;
    out.push(observation({
      detector: 'exit-status-unread', version: 1, classId: 'C2',
      path: rel, scope: `spawn:{${names.join(',')}}`, line: lineAt(src, m.index),
      predicate: 'a spawnSync result is destructured for its output and neither status nor error is taken, so the exit code has no subscriber at the call site',
      snippet: lineTextAt(src, m.index),
      confidence: 'structural',
    }));
  }
  return out;
}

/**
 * A24 — cause discarded at emission. A catch that throws a NEW error without carrying the one it
 * caught: the message that reaches the operator names the operation and not the reason, and the
 * reason is gone from the process for good.
 *
 * `{ cause: e }` counts as carrying it, and so does any mention of the bound name inside the throw
 * expression — this is about whether the cause SURVIVES, not about how it is formatted.
 */
export function detectCauseDiscarded({ rel, src, stripped }) {
  const out = [];
  CATCH.lastIndex = 0;
  for (let m; (m = CATCH.exec(stripped)); ) {
    if (!m[1]) continue;
    const err = m[1];
    const open = m.index + m[0].length - 1;
    const close = matchBrace(stripped, open);
    if (close < 0) continue;
    const bodyStripped = stripped.slice(open, close + 1);
    const throwAt = bodyStripped.search(/\bthrow\b/);
    if (throwAt < 0) continue;
    // A HANDLER THAT DISCRIMINATED FIRST DID NOT DISCARD THE CAUSE — it read it and chose the
    // wording. This is the house idiom, and the first run reported all three of its instances:
    //
    //     if (e.code === 'ENOENT') throw new Error(`no such artifact: ${path}`);
    //     throw new Error(`artifact at ${path} is unreadable (${e.code}) …`);
    //
    // The first throw names no cause because the cause is KNOWN and is in the branch condition.
    // Reporting it is A10, and it is the same shape `failsClosed` was written for in C11.
    if (discriminatesOn(bodyStripped, m[1])) continue;
    // The throw EXPRESSION, from the original: a template literal's `${e.message}` is blanked by the
    // lexer, so reading the stripped text here would report every interpolated cause as discarded.
    const tail = bodyStripped.slice(throwAt);
    const end = tail.indexOf(';');
    const exprStripped = end < 0 ? tail : tail.slice(0, end);
    const exprOriginal = src.slice(open + throwAt, open + throwAt + exprStripped.length);
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
    if (new RegExp(`\\b${err}\\b`).test(exprOriginal)) continue;
    // A rethrow of something else the body derived FROM the error still carries it.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
    const derived = new RegExp(`(?:const|let|var)\\s+([\\w$]+)\\s*=[^;\\n]*\\b${err}\\b`, 'g');
    let carried = false;
    for (let d; (d = derived.exec(src.slice(open, close + 1))); ) {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- err/base/name are \w identifiers captured from source by an earlier \w-only regex; the pattern is linear in them
      if (new RegExp(`\\b${d[1]}\\b`).test(exprOriginal)) { carried = true; break; }
    }
    if (carried) continue;
    out.push(observation({
      detector: 'cause-discarded', version: 1, classId: 'A24',
      path: rel, scope: 'catch', line: lineAt(src, m.index),
      predicate: `a catch throws a new error that never mentions \`${err}\`, so the operation is named and the reason it failed is discarded at emission`,
      snippet: exprOriginal.replace(/\s+/g, ' ').trim().slice(0, 160),
      confidence: 'structural',
    }));
  }
  return out;
}

const isTest = (rel) => /\.test\.mjs$/.test(rel);
const notTest = (rel) => !isTest(rel);

// Each detector DECLARES its population, and the bus counts per detector rather than sharing one
// number. A shared count is how both R1 detectors reported "ran, 0 findings, 235 modules" while the
// walk they were handed excluded every test directory: the denominator stated a size, so a zero over
// an empty subpopulation was indistinguishable from a zero over a scanned one.
export const SRC_DETECTORS = Object.freeze([
  { id: 'env-at-module-load', version: 1, classId: 'M9', population: notTest, populationName: 'non-test module', run: detectEnvAtModuleLoad },
  { id: 'catch-empty-return', version: 1, classId: 'C11', population: notTest, populationName: 'non-test module', run: detectCatchEmptyReturn },
  { id: 'test-asserts-nothing', version: 1, classId: 'R1', population: isTest, populationName: 'test file', run: detectTestAssertsNothing },
  { id: 'test-loop-unguarded', version: 1, classId: 'R1', population: isTest, populationName: 'test file', run: detectTestLoopUnguarded },
  { id: 'catch-continue-undiscriminated', version: 1, classId: 'A20', population: notTest, populationName: 'non-test module', run: detectCatchContinueUndiscriminated },
  { id: 'fanout-swallows-item', version: 1, classId: 'K7', population: notTest, populationName: 'non-test module', run: detectFanoutSwallowsItem },
  { id: 'exit-status-unread', version: 1, classId: 'C2', population: notTest, populationName: 'non-test module', run: detectExitStatusUnread },
  { id: 'cause-discarded', version: 1, classId: 'A24', population: notTest, populationName: 'non-test module', run: detectCauseDiscarded },
]);

// ── HIST DETECTORS ──────────────────────────────────────────────────────────────────────────────
// (input) => { observations, undetermined, denominator }. Caller supplies read git output.

/**
 * D6 — a durable record in exactly one working tree. Durable = under a declared root OR read by
 * tracked source. Hand-listed roots missed monitor/failure-taxonomy.json and this file's siblings.
 */
export function detectUntrackedDurable({ untrackedPaths, durableRoots, referencedPaths = [] }) {
  const referenced = new Set(referencedPaths);
  const underRoot = (p) => durableRoots.some((r) => p === r || p.startsWith(`${r}/`));
  const observations = [];
  for (const p of untrackedPaths) {
    const byRoot = underRoot(p);
    const byRef = referenced.has(p);
    if (!byRoot && !byRef) continue;
    observations.push(observation({
      detector: 'untracked-durable-record', version: 1, classId: 'D6',
      path: p, scope: '<file>',
      predicate: byRef
        ? 'tracked source reads this path and git does not track the file — the repo depends on a record that exists in exactly one working tree, where `git clean` and `git checkout <path>` are named hazards'
        : 'a file under a declared durable-record path that git does not track — it exists in exactly one working tree',
      snippet: p,
      extra: { basis: byRef ? (byRoot ? 'referenced+root' : 'referenced-by-tracked-source') : 'declared-root' },
    }));
  }
  return {
    observations,
    undetermined: [],
    denominator: {
      unit: 'untracked-file',
      scanned: untrackedPaths.length,
      // Roots NAMED, not counted: a count says the scan was bounded, not which bound.
      basis: { declaredRoots: durableRoots, referencedByTrackedSource: referenced.size },
      skipped: [],
    },
  };
}

/**
 * D2 — a cited SHA that resolves and no branch contains. resolution: sha → {resolves, containedBy};
 * containedBy null = the question was NOT ASKED, which is undetermined, never reachable.
 */
export function detectUnreachableCitations({ citations, resolution }) {
  const observations = [];
  const undetermined = [];
  for (const c of citations) {
    const r = resolution[c.sha];
    if (!r || !r.resolves) continue;                       // a dangling citation is a different class
    if (r.containedBy === null || r.containedBy === undefined) {
      undetermined.push(observation({
        detector: 'unreachable-citation', version: 1, classId: 'D2',
        path: c.path, scope: `sha:${c.sha.slice(0, 12)}`, line: c.line,
        predicate: 'containment was not determined for this citation — reachability is UNKNOWN, not confirmed',
        snippet: c.sha.slice(0, 12), confidence: 'inferred',
      }));
      continue;
    }
    if (r.containedBy > 0) continue;
    observations.push(observation({
      detector: 'unreachable-citation', version: 1, classId: 'D2',
      path: c.path, scope: `sha:${c.sha.slice(0, 12)}`, line: c.line,
      predicate: 'a cited SHA that rev-parse resolves and no branch contains — readable today, collectable at the next gc',
      snippet: c.sha.slice(0, 12),
    }));
  }
  return {
    observations, undetermined,
    denominator: { unit: 'citation', scanned: citations.length, skipped: [] },
  };
}

// ── ART DETECTORS ───────────────────────────────────────────────────────────────────────────────

/** A10 — one rule dominating a severity bucket. Ruleless records are undetermined and leave the denominator. */
export function detectRuleDominance({ issues, minBucket = 20, dominanceShare = 0.5 }) {
  const open = issues.filter((i) => i.state !== 'closed');
  const ruled = open.filter((i) => i.source && i.source.rule);
  const observations = [];
  const undetermined = [];

  const unruled = open.length - ruled.length;
  if (unruled > 0) {
    undetermined.push(observation({
      detector: 'rule-dominance', version: 1, classId: 'A10',
      path: '<issue-store>', scope: 'unruled',
      predicate: `${unruled} of ${open.length} open findings carry no rule, so dominance is undefined for them — this is not a clean result for that population`,
      snippet: `unruled=${unruled} of ${open.length}`, confidence: 'inferred',
    }));
  }

  const buckets = {};
  for (const i of ruled) (buckets[i.severity ?? 'unknown'] ??= []).push(i);
  for (const [sev, rows] of Object.entries(buckets)) {
    if (rows.length < minBucket) {
      undetermined.push(observation({
        detector: 'rule-dominance', version: 1, classId: 'A10',
        path: '<issue-store>', scope: `severity:${sev}`,
        predicate: `bucket of ${rows.length} is below the ${minBucket} needed for a share to mean anything — undetermined, not clean`,
        snippet: `${sev}: n=${rows.length}`, confidence: 'inferred',
      }));
      continue;
    }
    const by = {};
    for (const i of rows) {
      const k = `${i.source.tool ?? '?'}::${i.source.rule}`;
      by[k] = (by[k] || 0) + 1;
    }
    const [rule, n] = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    if (n / rows.length < dominanceShare) continue;
    observations.push(observation({
      detector: 'rule-dominance', version: 1, classId: 'A10',
      path: '<issue-store>', scope: `severity:${sev}`,
      predicate: `one rule accounts for ${(100 * n / rows.length).toFixed(1)}% of the ${sev} bucket — a defect signature, not a population in crisis`,
      snippet: `${rule} — ${n}/${rows.length}`,
      extra: { severity: sev, rule, count: n, bucket: rows.length, share: n / rows.length },
    }));
  }
  return {
    observations, undetermined,
    denominator: { unit: 'open-finding-with-a-rule', scanned: ruled.length, skipped: [{ path: '<issue-store>', reason: `${unruled} open findings carry no rule` }] },
  };
}

/**
 * G12 — an adjudication whose adjudicator and whose subject share an author.
 *
 * THE POPULATION IS SELF-DECLARED, WHICH IS WHY THIS IS BUILDABLE AT ALL. Measured over the live
 * verdict journal on 2026-08-26: 593 of 9,338 records carry
 * `adjudicatedBy: "adjudicate-gates (re-measurement; the operator of this tool may have authored
 * the gates being judged — see the file header)"` — 579 on gate-tests, 14 on docs-doctor. The tool
 * states the hazard in prose on every record it writes and nothing has ever counted it. A risk
 * named once in a header and repeated 593 times in a field is not a control; it is a sentence.
 *
 * THE PREDICATE IS THE ABSENCE OF A SECOND PARTY, not a grep for that sentence. A detector keyed to
 * one tool's wording would pass forever the day the wording changes, and would never see a second
 * self-adjudicating tool. What makes a record self-adjudicated here is that the adjudicator is an
 * in-repo instrument AND no independent party is recorded on the same record — no `who` (a human
 * hand), no `attributionCorrect` (a separate attribution check). Re-running the same instrument
 * twice, which these records do and say so in `basis`, is repetition rather than corroboration:
 * two runs of one witness cannot disagree about what that witness cannot see.
 *
 * IT EMITS AN OBSERVATION, NEVER A VERDICT. Self-adjudication is not proof the verdict is wrong —
 * most of these are almost certainly right. It is proof that nothing independent has confirmed it,
 * which is a different and weaker claim, and the one the record can actually support.
 */
export function detectSelfAdjudication({ records, humanParties = [] }) {
  const observations = [];
  const undetermined = [];
  const humans = new Set(humanParties);
  const adjudications = (records || []).filter((r) => r && r.kind === 'adjudication' && r.adjudicatedBy);

  const byParty = {};
  for (const r of adjudications) {
    // A CANARY IS NOT SELF-ADJUDICATION, and excluding it is the difference between a detector and
    // noise. A canary record judges a case whose answer was decided BEFORE the run: the planted
    // expectation is the independent party, and the harness is checking itself against it rather
    // than against its own opinion. Measured 2026-08-26 with canaries included, `canary-harness`
    // accounted for 4,638 of 4,950 rows — 94% from one party. This repository's own rule is that
    // one source dominating a bucket that heavily is a defect signature in the instrument, not a
    // population in crisis, so the instrument is what changed.
    if (r.canary) continue;
    // An independent party on the record clears it: a human hand (`who`) or a separate attribution
    // check (`attributionCorrect`) is a second party, however thin.
    const independent = !!r.who || r.attributionCorrect !== undefined || humans.has(r.adjudicatedBy);
    if (independent) continue;
    const party = String(r.adjudicatedBy);
    (byParty[party] ??= []).push(r);
  }

  for (const [party, rows] of Object.entries(byParty)) {
    const gates = [...new Set(rows.map((r) => r.gate).filter(Boolean))].sort();
    observations.push(observation({
      detector: 'self-adjudication', version: 1, classId: 'G12',
      path: '<verdict-journal>', scope: `party:${party.split(' ')[0]}`,
      predicate: `${rows.length} adjudication(s) were recorded by an instrument with no independent party on the record — `
        + `no human hand and no separate attribution check, so the verdict rests on one witness re-run rather than on two`,
      snippet: `${party.slice(0, 120)} — ${rows.length} record(s)${gates.length ? `, gates: ${gates.join(', ')}` : ''}`,
      extra: { party, count: rows.length, gates },
    }));
  }

  // A journal with no adjudications at all is not a journal free of self-adjudication.
  if (!adjudications.length) {
    undetermined.push(observation({
      detector: 'self-adjudication', version: 1, classId: 'G12',
      path: '<verdict-journal>', scope: '<none>',
      predicate: 'the journal carries no adjudication records, so independence could not be assessed — undetermined, not clean',
      snippet: 'adjudications=0', confidence: 'inferred',
    }));
  }

  const canaries = adjudications.filter((r) => r.canary).length;
  return {
    observations, undetermined,
    denominator: {
      unit: 'adjudication-record',
      scanned: adjudications.length - canaries,
      skipped: canaries ? [{ path: '<verdict-journal>', reason: `${canaries} canary records excluded — a planted expectation is the independent party` }] : [],
    },
  };
}

/** K8 — set difference, both directions, between what the registry declares and what has evidence. */
export function detectRegistryScheduleDrift({ declared, withEvidence }) {
  const D = new Set(declared);
  const E = new Set(withEvidence);
  const observations = [];
  for (const s of declared) {
    if (E.has(s)) continue;
    observations.push(observation({
      detector: 'registry-schedule-drift', version: 1, classId: 'K8',
      path: '<registry>', scope: `declared:${s}`,
      predicate: 'the registry declares this target and no artifact store shows evidence it was ever scheduled — the difference is invisible to both sides',
      snippet: s,
    }));
  }
  for (const s of withEvidence) {
    if (D.has(s)) continue;
    observations.push(observation({
      detector: 'registry-schedule-drift', version: 1, classId: 'K8',
      path: '<registry>', scope: `undeclared:${s}`,
      predicate: 'an artifact store holds evidence for a target the registry does not declare — scheduled without a declaration',
      snippet: s,
    }));
  }
  return {
    observations, undetermined: [],
    denominator: { unit: 'target', scanned: D.size + E.size, skipped: [] },
  };
}

// ── COVERAGE, ADJUDICATION, RUN RECORD ──────────────────────────────────────────────────────────

/** Per-class coverage. Four states: two collapse unscanned onto clean, three make `complete` unreachable. */
export function coverageFor(bindings, ran) {
  const byClass = {};
  for (const b of bindings.detectors) {
    const st = (byClass[b.classId] ??= { declared: [], ran: [], complete: true, enumerated: true });
    st.declared.push(b.id);
    if (ran.has(b.id)) st.ran.push(b.id);
    if (!b.complete) st.complete = false;
    if (!b.complete && !(b.siblingPredicates || []).length) st.enumerated = false;
  }
  const out = {};
  for (const [classId, st] of Object.entries(byClass)) {
    if (!st.ran.length) out[classId] = 'unscanned';
    else if (st.complete) out[classId] = 'complete';
    else if (st.enumerated) out[classId] = 'partial';
    else out[classId] = 'unspecified';
  }
  return out;
}

/**
 * Collapse onto identity: 22 env reads in one file are ONE observation with 22 occurrences, or one
 * defect dominates a bucket by arithmetic. Strongest confidence wins; lines kept as advisory.
 */
export function dedupe(observations) {
  const rank = { structural: 3, heuristic: 2, inferred: 1 };
  const by = new Map();
  for (const o of observations) {
    const prev = by.get(o.identity);
    if (!prev) { by.set(o.identity, { ...o, occurrences: 1, lines: o.place.line == null ? [] : [o.place.line] }); continue; }
    prev.occurrences++;
    if (o.place.line != null && !prev.lines.includes(o.place.line)) prev.lines.push(o.place.line);
    if (rank[o.confidence] > rank[prev.confidence]) {
      prev.confidence = o.confidence;
      prev.evidence = o.evidence;
      prev.place = { ...prev.place, line: o.place.line };
    }
  }
  for (const o of by.values()) o.lines.sort((a, b) => a - b);
  return [...by.values()];
}

/**
 * Apply the ledger (verdict-journal: four truths, rotation-safe, retractable). Unadjudicated keeps
 * the detector's confidence — structural publishes, softer stays undetermined. None self-escalates.
 */
export function adjudicate(observations, adjudicationsByIdentity = {}) {
  return observations.map((o) => {
    const a = adjudicationsByIdentity[o.identity];
    if (a && a.truth === 'false-alarm') return { ...o, adjudication: 'accepted', adjudicatedBy: a.adjudicatedBy ?? null, basis: a.basis ?? null };
    if (a && a.truth === 'true-alarm') return { ...o, adjudication: 'finding', adjudicatedBy: a.adjudicatedBy ?? null, basis: a.basis ?? null };
    return { ...o, adjudication: o.confidence === 'structural' ? 'finding' : 'undetermined', adjudicatedBy: null, basis: null };
  });
}

/** Fold the baseline in: a known identity is `baseline`, never absent, so the delta is what bites. */
export function applyBaseline(adjudicated, baselineIdentities) {
  const base = new Set(baselineIdentities || []);
  return adjudicated.map((o) => (o.adjudication === 'finding' && base.has(o.identity) ? { ...o, adjudication: 'baseline' } : o));
}

/** Priority off the registry, never authored here — the taxonomy_open view's formula. */
// The bound, NAMED rather than spelled twice as a bare literal. This file has no registry in scope,
// so a caller holding one should pass its closureMax; the default serves the callers that do not,
// and is the value every registry declares today. The taxonomy_open view in bin/taxonomy-db.mjs
// computes this identical priority in SQL and reads the bound off the registry directly -- when
// that bound moves, this default is the second place it must move. That duplication is the
// residual: one bound, two files, and only one of them can see the registry.
export const DEFAULT_CLOSURE_MAX = 4;
export const priorityOf = (cls, closureMax = DEFAULT_CLOSURE_MAX) =>
  (cls ? cls.gain * closureMax + (closureMax - cls.closure) : null);

/** The run record. `reach` names what was NOT scanned — 6 of 97 listing only findings reads clean. */
export function buildRunRecord({ at, tree, taxonomy, bindingsHash, detectors, coverage, results, classesTotal }) {
  const counts = { finding: 0, undetermined: 0, accepted: 0, baseline: 0 };
  for (const o of results) counts[o.adjudication] = (counts[o.adjudication] || 0) + 1;
  const states = Object.values(coverage);
  return {
    schema: 'commitwork.pattern-scan/1',
    generatedAt: at,
    tree,
    taxonomy,
    bindings: { sha256: bindingsHash, detectors: detectors.length },
    reach: {
      classesTotal,
      scanned: Object.entries(coverage).filter(([, v]) => v !== 'unscanned').map(([k]) => k).sort(),
      coverage: {
        complete: states.filter((s) => s === 'complete').length,
        partial: states.filter((s) => s === 'partial').length,
        unspecified: states.filter((s) => s === 'unspecified').length,
        unscanned: classesTotal - states.filter((s) => s !== 'unscanned').length,
      },
      statement: `${classesTotal - states.filter((s) => s !== 'unscanned').length} of ${classesTotal} classes were NOT SCANNED. Their absence from these results is absence of evidence, not evidence of absence.`,
      notInThisVersion: [
        'renderer — no HTML report is produced',
        'db projection — no scan_run/scan_observation tables are written',
        'witness scaffold — the failing-test generator is not built',
        'per-lane denominators — A7 needs a run manifest that does not exist',
      ],
    },
    detectors,
    counts,
    observations: results,
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripNonCode } from '../bare-catch-ratchet.mjs';
import {
  identityOf, redactSnippet, observation, dedupe, inConciseArrow, insideFunction,
  detectEnvAtModuleLoad, detectCatchEmptyReturn, detectTestAssertsNothing,
  detectUnreachableCitations, detectRuleDominance, detectUntrackedDurable, detectTestLoopUnguarded,
  detectCatchContinueUndiscriminated, detectFanoutSwallowsItem, detectExitStatusUnread,
  detectCauseDiscarded, SRC_DETECTORS,
  coverageFor, adjudicate, applyBaseline, priorityOf, buildRunRecord,
} from '../lib/pattern-core.mjs';

const file = (src, rel = 'x.mjs') => ({ rel, src, stripped: stripNonCode(src) });

// ── IDENTITY ────────────────────────────────────────────────────────────────────────────────────

test('identity excludes the line number, so a finding that moves is the same finding', () => {
  const a = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a.mjs', scope: 'f', line: 10, predicate: 'p', snippet: 's' });
  const b = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a.mjs', scope: 'f', line: 400, predicate: 'p', snippet: 's' });
  assert.equal(a.identity, b.identity);
  assert.equal(a.place.lineIsAdvisory, true);
});

test('identityOf defaults a missing scope rather than producing "undefined" in the key', () => {
  assert.equal(identityOf({ path: 'a.mjs', classId: 'D6' }), 'a.mjs::<file>::D6');
});

// ── REDACTION ───────────────────────────────────────────────────────────────────────────────────

test('a high-entropy run is redacted at construction, not at render', () => {
  const o = observation({
    detector: 'd', version: 1, classId: 'C1', path: 'a.mjs', scope: 'f', predicate: 'p',
    snippet: "const k = 'xK9vQ2mZpL7wR4tY8nB3jH6dF1sA5gC0eU';",
  });
  assert.ok(!o.evidence.snippet.includes('xK9vQ2mZpL7wR4tY8nB3jH6dF1sA5gC0eU'));
  assert.equal(o.evidence.redacted, 1);
  assert.equal(o.evidence.redactor, 'secrets-sweep:shannon');
});

test('a 40-hex git digest is NOT redacted — the D2 detector quotes SHAs as its whole evidence', () => {
  const r = redactSnippet('cited 3a2f1c0d9e8b7a6f5d4c3b2a1908f7e6d5c4b3a2');
  assert.equal(r.redacted, 0);
  assert.ok(r.text.includes('3a2f1c0d9e8b7a6f5d4c3b2a1908f7e6d5c4b3a2'));
});

test('redacted:0 distinguishes "nothing to redact" from "redaction did not run"', () => {
  const o = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a', scope: 'f', predicate: 'p', snippet: 'const a = 1;' });
  assert.equal(o.evidence.redacted, 0);
  assert.equal(o.evidence.redactor, null);
});

// ── M9: the false positives that the first two runs published ───────────────────────────────────

test('REGRESSION: a concise arrow body reads env at CALL time and is not a finding', () => {
  const obs = detectEnvAtModuleLoad(file('const p = () => process.env.CW_X || 1;\n'));
  assert.deepEqual(obs, []);
});

test('REGRESSION: an arrow wrapping a CALL is still call-time — `() => resolve(process.env.CW_X)`', () => {
  const obs = detectEnvAtModuleLoad(file('const p = () => resolve(process.env.CW_X || REPO);\n'));
  assert.deepEqual(obs, []);
});

test('REGRESSION: a ternary inside a concise arrow is call-time', () => {
  const obs = detectEnvAtModuleLoad(file('const p = () => (process.env.CW_R ? resolve(process.env.CW_R) : D);\n'));
  assert.deepEqual(obs, []);
});

test('a braced function body is call-time', () => {
  const obs = detectEnvAtModuleLoad(file('function p() { return process.env.CW_X; }\n'));
  assert.deepEqual(obs, []);
});

test('a module-scope const IS the defect, and is structural', () => {
  const obs = detectEnvAtModuleLoad(file('export const P = process.env.CW_AUTH_STORE || "d";\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'M9');
  assert.equal(obs[0].confidence, 'structural');
  assert.equal(obs[0].extra.envVar, 'CW_AUTH_STORE');
});

test('an object literal at module scope is NOT a function boundary — the value still freezes at import', () => {
  const obs = detectEnvAtModuleLoad(file('const C = { root: process.env.CW_ROOT };\n'));
  assert.equal(obs.length, 1);
});

test('env OUTSIDE the CW_* namespace is heuristic, so it lands in undetermined rather than published', () => {
  const obs = detectEnvAtModuleLoad(file('const E = process.env.NODE_ENV;\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].confidence, 'heuristic');
  assert.match(obs[0].evidence.predicate, /UNDETERMINED/);
});

test('inConciseArrow stops at a binding boundary rather than reaching a previous arrow', () => {
  const t = stripNonCode('const f = () => 1, g = process.env.CW_X;\n');
  assert.equal(inConciseArrow(t, t.indexOf('process')), false);
  assert.equal(insideFunction(t, t.indexOf('process')), false);
});

// ── C11 ─────────────────────────────────────────────────────────────────────────────────────────

test('an UNBOUND catch is bare-catch-ratchet\'s population, not this detector\'s', () => {
  const obs = detectCatchEmptyReturn(file('const r = (p) => { try { return f(p); } catch { return null; } };\n'));
  assert.deepEqual(obs, []);
});

test('a bound catch returning an empty collection with no discrimination is a structural finding', () => {
  const obs = detectCatchEmptyReturn(file('function load(p) { try { return read(p); } catch (e) { return []; } }\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'C11');
  assert.equal(obs[0].confidence, 'structural');
});

test('a catch that rethrows is not a finding', () => {
  const obs = detectCatchEmptyReturn(file('function load(p) { try { return read(p); } catch (e) { if (e.code === "ENOENT") return []; throw e; } }\n'));
  assert.deepEqual(obs, []);
});

test('REGRESSION: discrimination on ANY error property counts — `e.status === 1`, not just .code/ENOENT', () => {
  const src = 'function has(s) { try { return run(s); } catch (e) { if (e && e.status === 1) return false; return null; } }\n';
  assert.deepEqual(detectCatchEmptyReturn(file(src)), []);
});

test('a catch that RECORDS the error but does not discriminate it is heuristic, not published', () => {
  const src = 'function g(a) { try { return run(a); } catch (e) { errors.push({ e }); return null; } }\n';
  const obs = detectCatchEmptyReturn(file(src));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].confidence, 'heuristic');
});

test('the ENOENT discriminator is read from the ORIGINAL source, since the lexer blanks string literals', () => {
  // If this were read from the stripped text, 'ENOENT' would be spaces and every guarded catch
  // would be reported — a scanner-shaped instance of the class the scanner detects.
  const src = 'function r(p) { try { return read(p); } catch (e) { if (e.code === "ENOENT") return []; return []; } }\n';
  assert.deepEqual(detectCatchEmptyReturn(file(src)), []);
});

// ── R1 ──────────────────────────────────────────────────────────────────────────────────────────

test('a test body with no assertion is a finding; only .test.mjs files are in the population', () => {
  const src = 'test("x", () => { const a = 1; });\n';
  assert.deepEqual(detectTestAssertsNothing(file(src, 'a.mjs')), []);
  const obs = detectTestAssertsNothing(file(src, 'a.test.mjs'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'R1');
});

test('a test body that asserts is not a finding', () => {
  assert.deepEqual(detectTestAssertsNothing(file('test("x", () => { assert.ok(1); });\n', 'a.test.mjs')), []);
});

test('a test body that only delegates is heuristic — the assertion may live in the helper', () => {
  const obs = detectTestAssertsNothing(file('test("x", () => { runCase(1); });\n', 'a.test.mjs'));
  assert.equal(obs[0].confidence, 'heuristic');
});

// R1, second predicate — the class another session raised from the passkey `[hidden]` defect.

test('a loop over a DERIVED collection with no non-empty guard is reported, and is report-only', () => {
  const src = 'const rows = SRC.matchAll(/x/g);\ntest("t", () => { for (const r of rows) assert.ok(r); });\n';
  const obs = detectTestLoopUnguarded(file(src, 'a.test.mjs'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'R1');
  assert.equal(obs[0].confidence, 'heuristic');
  assert.equal(adjudicate(obs)[0].adjudication, 'undetermined');   // report-only, by confidence
  assert.equal(obs[0].extra.collection, 'rows');
});

test('a LITERAL collection cannot be empty and is not reported — 144 of this repo\'s sites', () => {
  const src = 'const KINDS = ["a", "b"];\ntest("t", () => { for (const k of KINDS) assert.ok(k); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('a non-empty guard anywhere in the file clears it', () => {
  const src = 'const rows = SRC.split("\\n").filter(Boolean);\ntest("t", () => { assert.ok(rows.length > 0); for (const r of rows) assert.ok(r); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('a loop with no assertion in it is not this class — nothing is being vacuously proven', () => {
  const src = 'const rows = SRC.split("\\n").filter(Boolean);\ntest("t", () => { for (const r of rows) collect(r); assert.ok(1); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('Object.keys over a SCREAMING literal is as fixed as the literal', () => {
  const src = 'const MAP = { a: 1 };\nconst ks = Object.keys(MAP);\ntest("t", () => { for (const k of ks) assert.ok(k); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('only .test.mjs files are in the population', () => {
  const src = 'const rows = SRC.matchAll(/x/g);\ntest("t", () => { for (const r of rows) assert.ok(r); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.mjs')), []);
});

// ── A20 / K7 / C2 / A24 — the B1 second tranche ─────────────────────────────────────────────────
// Every one asserts BOTH directions separately: a fixture that must be found, and a fixture that
// must not be. A detector tested only on what it should catch has no floor — it can stop matching
// anything at all and every test still passes.

test('A20: a catch that skips the item without branching on the error is structural', () => {
  const obs = detectCatchContinueUndiscriminated(file(
    'for (const r of repos) {\n  try { read(r); } catch (e) { continue; }\n}\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'A20');
  assert.equal(obs[0].confidence, 'structural');
});

test('A20: a catch that branches on the error before skipping is not a finding', () => {
  const obs = detectCatchContinueUndiscriminated(file(
    'for (const r of repos) {\n  try { read(r); } catch (e) { if (e.code === "ENOENT") continue; throw e; }\n}\n'));
  assert.deepEqual(obs, []);
});

test('A20: recording the error makes the skip heuristic, so it counts and does not publish', () => {
  const obs = detectCatchContinueUndiscriminated(file(
    'for (const r of repos) {\n  try { read(r); } catch (e) { console.error(e); continue; }\n}\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].confidence, 'heuristic');
});

test('A20: a skip COUNTER is the same defect as continue', () => {
  const obs = detectCatchContinueUndiscriminated(file(
    'for (const r of repos) {\n  try { read(r); } catch (e) { skipped++; }\n}\n'));
  assert.equal(obs.length, 1);
});

test('K7: a loop catch that neither rethrows nor records is a finding', () => {
  const obs = detectFanoutSwallowsItem(file(
    'for (const r of repos) {\n  try { scan(r); } catch (e) { }\n}\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'K7');
});

test('K7: a loop catch that pushes the failure into a structure is not a finding', () => {
  const obs = detectFanoutSwallowsItem(file(
    'for (const r of repos) {\n  try { scan(r); } catch (e) { failures.push({ r, e }); }\n}\n'));
  assert.deepEqual(obs, []);
});

test('K7: setting process.exitCode is recording it — the aggregate can still answer', () => {
  const obs = detectFanoutSwallowsItem(file(
    'for (const r of repos) {\n  try { scan(r); } catch (e) { process.exitCode = 1; }\n}\n'));
  assert.deepEqual(obs, []);
});

test('K7: a catch OUTSIDE any loop is not this class — one item is not a fan-out', () => {
  const obs = detectFanoutSwallowsItem(file('try { scan(r); } catch (e) { }\n'));
  assert.deepEqual(obs, []);
});

test('C2: a spawnSync whose output is read and whose status is not is structural', () => {
  const obs = detectExitStatusUnread(file(
    'const r = spawnSync("git", ["log"]);\nconst lines = r.stdout.toString().split("\\n");\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'C2');
});

test('C2: reading .status clears it, and so does destructuring status', () => {
  assert.deepEqual(detectExitStatusUnread(file(
    'const r = spawnSync("git", ["log"]);\nif (r.status !== 0) throw new Error("x");\nconst l = r.stdout;\n')), []);
  assert.deepEqual(detectExitStatusUnread(file(
    'const { status, stdout } = spawnSync("git", ["log"]);\nif (status) throw new Error("x");\n')), []);
});

test('C2: destructuring only the output is the same defect as ignoring .status', () => {
  const obs = detectExitStatusUnread(file('const { stdout } = spawnSync("git", ["log"]);\n'));
  assert.equal(obs.length, 1);
});

test('C2: execFileSync is NOT in the population — it throws, so its status has a subscriber', () => {
  assert.deepEqual(detectExitStatusUnread(file(
    'const out = execFileSync("git", ["log"]);\nconst lines = out.toString();\n')), []);
});

test('C2: a spawnSync binding used for nothing at all is a dead binding, not this class', () => {
  assert.deepEqual(detectExitStatusUnread(file('const r = spawnSync("git", ["gc"]);\n')), []);
});

test('C2: output consumed inside a try is heuristic — the parse discriminates could-not-run', () => {
  // monitor/workflow-harden.mjs:154, which the first run rated structural. A zizmor that never ran
  // yields null through the catch, not 0, so the class's damage cannot occur at this site.
  const obs = detectExitStatusUnread(file(
    'const r = spawnSync("zizmor", ["--format", "json", dir]);\ntry { return JSON.parse(r.stdout || "").length; } catch { return null; }\n'));
  assert.equal(obs.length, 1, 'still reported — the status is genuinely unread');
  assert.equal(obs[0].confidence, 'heuristic', 'but not published: the parse is a second discriminator');
});

test('C2: the SAME consumption outside a try stays structural — the try is the whole difference', () => {
  const obs = detectExitStatusUnread(file(
    'const r = spawnSync("zizmor", ["--format", "json", dir]);\nreturn JSON.parse(r.stdout || "").length;\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].confidence, 'structural');
});

test('A24: a catch throwing a new error that never mentions the cause is a finding', () => {
  const obs = detectCauseDiscarded(file(
    'try { load(); } catch (e) { throw new Error("could not load the config"); }\n'));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].classId, 'A24');
});

test('A24: an interpolated cause is carried — and is read from the ORIGINAL, not the stripped text', () => {
  const obs = detectCauseDiscarded(file(
    'try { load(); } catch (e) { throw new Error(`could not load the config: ${e.message}`); }\n'));
  assert.deepEqual(obs, []);
});

test('A24: `{ cause: e }` carries it, and so does a binding derived from the error', () => {
  assert.deepEqual(detectCauseDiscarded(file(
    'try { load(); } catch (e) { throw new Error("could not load", { cause: e }); }\n')), []);
  assert.deepEqual(detectCauseDiscarded(file(
    'try { load(); } catch (e) { const why = String(e.message); throw new Error("could not load: " + why); }\n')), []);
});

test('A24: a bare rethrow is not a discard', () => {
  assert.deepEqual(detectCauseDiscarded(file('try { load(); } catch (e) { throw e; }\n')), []);
});

test('the three catch detectors partition their population — asserted, not assumed (M19)', () => {
  // One file holding all three shapes. Each detector must claim its own site and no other's, so the
  // counts add to three with no site claimed twice. A shared site would double-count every scan.
  const src = [
    'function a() { try { x(); } catch (e) { return []; } }',            // C11
    'function b() { for (const r of rs) { try { x(); } catch (e) { continue; } } }', // A20
    'function c() { try { x(); } catch (e) { throw new Error("nope"); } }',          // A24
  ].join('\n');
  const f = file(src);
  const c11 = detectCatchEmptyReturn(f).map((o) => o.place.line);
  const a20 = detectCatchContinueUndiscriminated(f).map((o) => o.place.line);
  const a24 = detectCauseDiscarded(f).map((o) => o.place.line);
  assert.equal(c11.length, 1, 'C11 claims the returning catch');
  assert.equal(a20.length, 1, 'A20 claims the continuing catch');
  assert.equal(a24.length, 1, 'A24 claims the throwing catch');
  const all = [...c11, ...a20, ...a24];
  assert.equal(new Set(all).size, all.length, 'no site is claimed by two detectors');
});

test('every new detector is registered in SRC_DETECTORS with a population and a class', () => {
  const ids = ['catch-continue-undiscriminated', 'fanout-swallows-item', 'exit-status-unread', 'cause-discarded'];
  for (const id of ids) {
    const d = SRC_DETECTORS.find((x) => x.id === id);
    assert.ok(d, `${id} is not registered — an unregistered detector never runs`);
    assert.equal(typeof d.run, 'function');
    assert.equal(typeof d.population, 'function');
    assert.ok(d.classId && d.populationName);
  }
  assert.ok(ids.length > 0);
});

// ── D2 / D6 ─────────────────────────────────────────────────────────────────────────────────────

test('a citation whose containment was NOT ASKED is undetermined, never reachable', () => {
  const r = detectUnreachableCitations({
    citations: [{ sha: 'abcdef1', path: 'a.md', line: 1 }],
    resolution: { abcdef1: { resolves: true, containedBy: null } },
  });
  assert.equal(r.observations.length, 0);
  assert.equal(r.undetermined.length, 1);
  assert.equal(r.undetermined[0].confidence, 'inferred');
});

test('a resolving SHA no branch contains is a finding; one that does not resolve is a different class', () => {
  const r = detectUnreachableCitations({
    citations: [{ sha: 'aaa1111', path: 'a.md', line: 1 }, { sha: 'bbb2222', path: 'a.md', line: 2 }],
    resolution: { aaa1111: { resolves: true, containedBy: 0 }, bbb2222: { resolves: false, containedBy: null } },
  });
  assert.equal(r.observations.length, 1);
  assert.equal(r.observations[0].classId, 'D2');
  assert.equal(r.denominator.scanned, 2);
});

test('D6 names its roots in the denominator rather than counting them', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['evaluations/x.md', 'tmp/scratch'], durableRoots: ['evaluations', 'docs'] });
  assert.equal(r.observations.length, 1);
  assert.equal(r.denominator.scanned, 2);                       // the population is untracked FILES
  assert.deepEqual(r.denominator.basis.declaredRoots, ['evaluations', 'docs']);
});

test('REGRESSION: an untracked file that tracked source READS is durable, even outside every root', () => {
  const r = detectUntrackedDurable({
    untrackedPaths: ['monitor/failure-taxonomy.json'], durableRoots: ['evaluations', 'docs'],
    referencedPaths: ['monitor/failure-taxonomy.json'],
  });
  assert.equal(r.observations.length, 1);
  assert.equal(r.observations[0].extra.basis, 'referenced-by-tracked-source');
  assert.match(r.observations[0].evidence.predicate, /the repo depends on a record/);
});

test('an untracked file that is neither under a root nor referenced is not a finding', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['tmp/scratch.txt'], durableRoots: ['evaluations'], referencedPaths: [] });
  assert.deepEqual(r.observations, []);
});

test('a root boundary is a path segment, not a prefix — `evaluations-old/` is not under `evaluations`', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['evaluations-old/x.md'], durableRoots: ['evaluations'], referencedPaths: [] });
  assert.deepEqual(r.observations, []);
});

// ── A10 ─────────────────────────────────────────────────────────────────────────────────────────

const iss = (n, sev, rule) => Array.from({ length: n }, (_, i) => ({ id: `i${sev}${rule}${i}`, state: 'open', severity: sev, source: rule ? { tool: 't', rule } : null }));

test('a rule above the dominance share in a large enough bucket is a finding', () => {
  const r = detectRuleDominance({ issues: [...iss(30, 'high', 'r1'), ...iss(10, 'high', 'r2')] });
  assert.equal(r.observations.length, 1);
  assert.equal(r.observations[0].classId, 'A10');
  assert.equal(r.observations[0].extra.rule, 't::r1');
  assert.ok(r.observations[0].extra.share > 0.5);
});

test('a bucket below the minimum is UNDETERMINED, never clean', () => {
  const r = detectRuleDominance({ issues: iss(5, 'crit', 'r1') });
  assert.equal(r.observations.length, 0);
  assert.ok(r.undetermined.some((o) => /undetermined, not clean/.test(o.evidence.predicate)));
});

test('findings with no rule are undetermined and are excluded from the denominator', () => {
  const r = detectRuleDominance({ issues: [...iss(30, 'high', 'r1'), ...iss(50, 'high', null)] });
  assert.equal(r.denominator.scanned, 30);
  assert.ok(r.undetermined.some((o) => o.place.scope === 'unruled'));
  assert.equal(r.denominator.skipped.length, 1);
});

test('closed findings are excluded from the population', () => {
  const closed = iss(30, 'high', 'r1').map((i) => ({ ...i, state: 'closed' }));
  const r = detectRuleDominance({ issues: closed });
  assert.equal(r.denominator.scanned, 0);
});

// ── DEDUPE ──────────────────────────────────────────────────────────────────────────────────────

test('observations collapse onto identity, keeping every line and the strongest confidence', () => {
  const mk = (line, confidence) => observation({ detector: 'd', version: 1, classId: 'M9', path: 'a.mjs', scope: '<module>', line, predicate: 'p', snippet: 's', confidence });
  const out = dedupe([mk(10, 'heuristic'), mk(20, 'structural'), mk(30, 'heuristic')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].occurrences, 3);
  assert.deepEqual(out[0].lines, [10, 20, 30]);
  assert.equal(out[0].confidence, 'structural');
});

// ── COVERAGE / ADJUDICATION / RUN RECORD ────────────────────────────────────────────────────────

const BINDINGS = {
  detectors: [
    { id: 'a', classId: 'X1', complete: true },
    { id: 'b', classId: 'X2', complete: false, siblingPredicates: ['something else'] },
    { id: 'c', classId: 'X3', complete: false },
    { id: 'd', classId: 'X4', complete: true },
  ],
};

test('coverage has four states, so unscanned and clean can never share a value', () => {
  const cov = coverageFor(BINDINGS, new Set(['a', 'b', 'c']));
  assert.equal(cov.X1, 'complete');
  assert.equal(cov.X2, 'partial');        // predicate list enumerated, not all covered
  assert.equal(cov.X3, 'unspecified');    // incomplete and never enumerated
  assert.equal(cov.X4, 'unscanned');      // bound but did not run
});

test('a detector is never trusted to escalate itself: heuristic stays undetermined', () => {
  const o = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a', scope: 'f', predicate: 'p', snippet: 's', confidence: 'heuristic' });
  assert.equal(adjudicate([o])[0].adjudication, 'undetermined');
});

test('a journalled false-alarm accepts the observation; a true-alarm publishes it', () => {
  const o = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a', scope: 'f', predicate: 'p', snippet: 's' });
  assert.equal(adjudicate([o], { [o.identity]: { truth: 'false-alarm', adjudicatedBy: 'op' } })[0].adjudication, 'accepted');
  assert.equal(adjudicate([o], { [o.identity]: { truth: 'true-alarm' } })[0].adjudication, 'finding');
});

test('an adjudication survives a line move, because it is keyed on identity', () => {
  const at10 = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a', scope: 'f', line: 10, predicate: 'p', snippet: 's' });
  const at99 = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a', scope: 'f', line: 99, predicate: 'p', snippet: 's' });
  const ledger = { [at10.identity]: { truth: 'false-alarm' } };
  assert.equal(adjudicate([at99], ledger)[0].adjudication, 'accepted');
});

test('the baseline demotes a known finding and leaves a new one biting', () => {
  const known = observation({ detector: 'd', version: 1, classId: 'C1', path: 'a', scope: 'f', predicate: 'p', snippet: 's' });
  const fresh = observation({ detector: 'd', version: 1, classId: 'C1', path: 'b', scope: 'f', predicate: 'p', snippet: 's' });
  const out = applyBaseline(adjudicate([known, fresh]), [known.identity]);
  assert.equal(out.find((o) => o.place.path === 'a').adjudication, 'baseline');
  assert.equal(out.find((o) => o.place.path === 'b').adjudication, 'finding');
});

test('priority is read off the registry, matching the taxonomy_open formula', () => {
  assert.equal(priorityOf({ gain: 4, closure: 1 }), 19);
  assert.equal(priorityOf(null), null);
});

test('the run record states what was NOT scanned, in its own field', () => {
  const rec = buildRunRecord({
    at: '2026-08-23T00:00:00Z', tree: { head: 'abc', dirty: false }, taxonomy: { version: 6 },
    bindingsHash: 'h', detectors: [], coverage: { X1: 'complete', X4: 'unscanned' }, results: [], classesTotal: 97,
  });
  assert.equal(rec.reach.coverage.unscanned, 96);
  assert.match(rec.reach.statement, /96 of 97 classes were NOT SCANNED/);
  assert.ok(rec.reach.notInThisVersion.length > 0);
});

test('REGRESSION: `/re/.test(x)` is a regex call, not a test declaration', () => {
  const src = 'test("t", () => { assert.ok(!/Co-Authored-By/i.test(show)); });\n';
  assert.deepEqual(detectTestAssertsNothing(file(src, 'a.test.mjs')), []);
});

test('REGRESSION: the options form `test(name, {skip}, fn)` reads the FN as the body, not the options', () => {
  const src = 'test("t", { skip: G ? false : "not built" }, () => { assert.ok(1); });\n';
  assert.deepEqual(detectTestAssertsNothing(file(src, 'a.test.mjs')), []);
});

test('the options form with a genuinely empty body is still caught', () => {
  const src = 'test("t", { concurrency: 1 }, () => { const a = 1; });\n';
  assert.equal(detectTestAssertsNothing(file(src, 'a.test.mjs')).length, 1);
});

test('REGRESSION: one name, two bindings — a sibling test\'s guard does not clear an unguarded rebind', () => {
  const src = [
    'test("a", () => { const lines = readFileSync(M, "utf8").split("\\n").filter(Boolean);',
    '  assert.ok(lines.length > 100); for (const l of lines) assert.ok(l); });',
    'test("b", () => { const lines = readFileSync(M, "utf8").split("\\n").filter(Boolean).slice(0, 40);',
    '  for (const l of lines) assert.ok(l); });',
  ].join('\n');
  const obs = detectTestLoopUnguarded(file(src, 'a.test.mjs'));
  assert.equal(obs.length, 1, 'the guarded first binding is cleared, the rebound second is not');
  assert.match(obs[0].extra.boundFrom, /slice/);
});

test('REGRESSION: `assert.ok(c.some(...))` proves non-empty without mentioning length', () => {
  const src = 'const code = SRC.split("\\n").filter(Boolean);\ntest("t", () => { assert.ok(code.some((l) => l.includes("x"))); for (const l of code) assert.ok(l); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('REGRESSION: a deepEqual against a NON-empty literal proves non-empty', () => {
  const src = 'const scoped = s.blocks.filter((b) => b.t);\ntest("t", () => { assert.deepEqual(scoped.map(x => x.p), ["a", "b"]); for (const b of scoped) assert.ok(b); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('a deepEqual against [] means the test EXPECTS empty — vacuous by design, not by accident', () => {
  const src = 'const outside = r.prompts.filter((p) => !p.c);\ntest("t", () => { for (const p of outside) assert.equal(p.live, null); assert.deepEqual(outside.map(p => p.check), []); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('REGRESSION: splitting a STRING LITERAL cannot yield an empty array', () => {
  const src = 'test("t", () => { const R = "A,B,C".split(",");\n  for (const x of R) assert.ok(x); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(src, 'a.test.mjs')), []);
});

test('splitting a VARIABLE is still derived and still reported', () => {
  const src = 'test("t", () => { const R = out.split("\\n");\n  for (const x of R) assert.ok(x); });\n';
  assert.equal(detectTestLoopUnguarded(file(src, 'a.test.mjs')).length, 1);
});

test('a length assertion AFTER the loop still guards it; a sibling test\'s does not', () => {
  const guardedAfter = 'test("t", () => { const u = R.filter(Boolean);\n for (const x of u) assert.ok(x);\n assert.equal(seen + u.length, R.length); });\n';
  assert.deepEqual(detectTestLoopUnguarded(file(guardedAfter, 'a.test.mjs')), []);
  const sibling = 'test("a", () => { const u = R.filter(Boolean); assert.ok(u.length > 0); });\n'
    + 'test("b", () => { const u = R.filter(Boolean); for (const x of u) assert.ok(x); });\n';
  assert.equal(detectTestLoopUnguarded(file(sibling, 'a.test.mjs')).length, 1);
});

// An identity keyed on a line moves whenever code above it does, which reads as one finding ending
// and another beginning. Shift the same source down and every identity must stay put.
test('no detector identity changes when the code moves down the file', () => {
  const src = 'function load(p) { try { return read(p); } catch (e) { return []; } }\n'
    + 'test("does a thing", () => { run(); });\n'
    + 'test(`a template title`, () => { run(); });\n'
    + 'for (const r of repos) { try { scan(r); } catch { continue; } }\n';
  const ids = (s) => SRC_DETECTORS.flatMap((d) => d.run(file(s, 'a.test.mjs'))).map((o) => o.identity).sort();
  const lines = (s) => SRC_DETECTORS.flatMap((d) => d.run(file(s, 'a.test.mjs'))).map((o) => o.place.line).sort();
  const before = ids(src);
  assert.ok(before.length >= 3, `the fixture must trip several detectors to mean anything, got ${JSON.stringify(before)}`);
  const moved = `// header\n\n\n${src}`;
  assert.notDeepEqual(lines(moved), lines(src), 'precondition: the lines did move');
  assert.deepEqual(ids(moved), before);
  assert.ok(before.every((id) => !/@\d+::/.test(id)), `no identity may carry a line: ${before.join(' | ')}`);
  assert.ok(before.includes('a.test.mjs::test:does a thing::R1'), 'a test is keyed by its title');
});

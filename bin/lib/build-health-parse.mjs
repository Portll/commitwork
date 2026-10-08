/**
 * Pure parsers for build-health's `toolchain` sub-command — no I/O, no docker, no process exit.
 * Extracted so the judging logic is unit-testable (build-health.mjs dispatches at module scope).
 * The phase marker carries each phase's real exit code out of the container; no-tests /
 * unreadable / env-blocked name the not-green-not-RED states.
 */

/** Emitted on its own line after every phase. Parsed line-anchored: a scanned repo's stdout must
 *  not be able to forge a phase result. */
export const PHASE_MARKER = '__CW_PHASE';

/**
 * The CLOSED status vocabulary for `toolchain`; bin/test/build-health-vocabulary.test.mjs pins
 * the other declaration sites to it.
 *   no-tests    ran, produced NO test evidence — never green
 *   unreadable  output could not be parsed — never green, never RED
 *   env-blocked docker absent on THIS MACHINE — a machine property, distinct from `skipped`
 *               (a repo property)
 */
export const TOOLCHAIN_STATUSES = Object.freeze([
  'green', 'RED', 'no-tests', 'unreadable', 'env-blocked', 'skipped', 'n/a',
]);

/** Statuses that mean "a human should look at this", for consumers that colour cells. */
export const TOOLCHAIN_BAD = Object.freeze(['RED']);

/**
 * The phase that copies the scanned repo into a container-local workspace: read-only mount at
 * /src, phases run against a copy at /w that dies with the container — a survey must not mutate
 * its subject, and per-run copies retire the shared-build-dir race.
 * Excludes are regenerated build outputs ONLY: a source directory copied incomplete is a false
 * RED, so `build`, `dist`, `out`, `vendor` and `bin` are deliberately absent (each is a source
 * dir somewhere in this fleet).
 */
export const WORKSPACE_PHASE = 'materialise';
export const WORKSPACE_EXCLUDES = Object.freeze([
  'node_modules', 'target', '.gradle', '.venv', 'venv', '__pycache__', 'coverage',
]);

/** Materialise `src` (read-only) into `dst`. No pipe: dash has no pipefail, and a truncated read
 *  would extract a partial tree and report success — via a temp file every failure is the step's
 *  exit code. */
export function workspaceStep({ src = '/src', dst = '/w', excludes = WORKSPACE_EXCLUDES, tarPath = '/tmp/cw-workspace.tar' } = {}) {
  // Unanchored --exclude: GNU tar matches at any depth (nested node_modules too).
  const ex = excludes.map((d) => `--exclude=${d}`).join(' ');
  return {
    name: WORKSPACE_PHASE,
    cmd: `mkdir -p ${dst} && (cd ${src} && tar -cf - ${ex} .) > ${tarPath} && tar -C ${dst} -xf ${tarPath} && rm -f ${tarPath}`,
  };
}

/**
 * Build the `sh -c` body that runs `steps` and reports each phase's exit code. Phases stop at the
 * first failure; skipped phases report `attempted: false` (a sentinel exit collides with a real
 * one). Each phase runs under `timeout` so one wedged phase cannot hold the container open.
 */
export function buildPhaseScript(steps, { timeoutSeconds = 1800 } = {}) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('buildPhaseScript: steps must be a non-empty array');
  const parts = ['cw_rc=0'];
  for (const { name, cmd } of steps) {
    if (/[\r\n]/.test(name) || name.includes(' ')) throw new Error(`buildPhaseScript: bad phase name ${JSON.stringify(name)}`);
    parts.push(
      `if [ "$cw_rc" -eq 0 ]; then ` +
        `timeout ${timeoutSeconds} sh -c ${shq(cmd)}; cw_p=$?; ` +
        `echo "${PHASE_MARKER} name=${name} attempted=1 exit=$cw_p"; ` +
        `cw_rc=$cw_p; ` +
      `else echo "${PHASE_MARKER} name=${name} attempted=0 exit=-"; fi`,
    );
  }
  // Terminator: its ABSENCE signals the container died mid-flight — without it a truncated log
  // reads as a clean run.
  parts.push(`echo "${PHASE_MARKER} end=1"`);
  return parts.join('; ');
}

/** POSIX single-quoting. Use this, never JSON.stringify, for anything crossing into `sh -c` —
 *  double quotes let the HOST shell expand $vars before docker runs. */
export const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const shq = shQuote;

/**
 * Parse phase results from captured container output. Linear line scan, never a multiline regex
 * (catastrophic backtracking over multi-MB output). Returns { complete: false } when the
 * terminator is missing — callers MUST treat that as `unreadable`, never as success.
 */
export function parsePhases(out) {
  const phases = [];
  let complete = false;
  for (const line of String(out == null ? '' : out).split('\n')) {
    // Line-ANCHORED. A repo whose build prints the marker mid-line cannot inject a phase result.
    if (!line.startsWith(PHASE_MARKER)) continue;
    const rest = line.slice(PHASE_MARKER.length).trim();
    if (rest === 'end=1') { complete = true; continue; }
    const f = Object.create(null);
    for (const kv of rest.split(/\s+/)) { const i = kv.indexOf('='); if (i > 0) f[kv.slice(0, i)] = kv.slice(i + 1); }
    if (!f.name) continue;
    const attempted = f.attempted === '1';
    const exit = attempted && /^\d+$/.test(f.exit || '') ? +f.exit : null;
    phases.push({ name: f.name, attempted, exit, green: attempted && exit === 0 });
  }
  return { complete, phases };
}

const uniq = (a) => [...new Set(a)];

/**
 * Deviating FILES from a --check formatter's output, per tool. Pure so the patterns are testable
 * against captured output — the first cut of the rust pattern matched rustfmt's older
 * `Diff in <path> at line N` and parsed zero from a tree with 193 deviating files.
 */
export const FORMAT_PARSERS = Object.freeze({
  // Current rustfmt: `Diff in <path>:12:`. Older: `Diff in <path> at line 12:`. One line per hunk.
  'cargo fmt': (o) => uniq([...String(o ?? '').matchAll(/^Diff in (.+?)(?::\d+:|\s+at line\s+\d+)/gm)].map((m) => m[1])),
  // gofmt -l prints bare paths, nothing else.
  gofmt: (o) => String(o ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
  // prettier --check prints its headers to the same stream as the file list.
  prettier: (o) => String(o ?? '').split('\n').map((s) => s.trim().replace(/^\[warn\]\s*/, ''))
    .filter((s) => s && !/^(Checking formatting|Code style issues|All matched files)/.test(s) && !/^\[error\]/.test(s))
    .filter((s) => /\.\w+$/.test(s)),
  ruff: (o) => uniq([...String(o ?? '').matchAll(/^[Ww]ould reformat:?\s+(\S+)/gm)].map((m) => m[1])),
  black: (o) => uniq([...String(o ?? '').matchAll(/^[Ww]ould reformat:?\s+(\S+)/gm)].map((m) => m[1])),
  // fact: scalafmt --test writes its diffs to stderr and only `error: --test failed` to stdout / a stdout-only read parses 0 against exit 1, which foldFormat calls unreadable on every unformatted repo (expiry: if scalafmt merges its streams, prev: not built)
  // fact: `+++ b/X` is forgeable by the payload, so the `--- a/X` pair is matched / a Scala line beginning `++ b/` arrives as `+++ b/` and the naive form counts 2 files for 1 (expiry: never, prev: not built)
  scalafmt: (o) => uniq([...String(o ?? '').matchAll(/^--- a\/(.+)\n\+\+\+ b\/(.+)$/gm)]
    .filter((m) => m[1] === m[2]).map((m) => m[2].replace(/\/\.\//g, '/'))),
});

export const formatDeviations = (tool, out) => (FORMAT_PARSERS[tool] ? FORMAT_PARSERS[tool](out) : null);

/**
 * Fold one formatter run into a report fragment.
 *
 * Every --check formatter exits non-zero IFF it found deviations, so a non-zero exit with nothing
 * parsed means the tool errored or the parser missed its format — `unreadable`, never `clean`.
 * That guard is why the rustfmt pattern bug was caught rather than shipped as a clean bill.
 */
export function foldFormat({ lang, tool, declaredBy, command, ok, code, files }) {
  const base = { lang, ran: true, tool, declaredBy, command };
  if (files === null) {
    return { ...base, status: 'unreadable', exit: ok ? 0 : (code ?? null), deviationCount: null,
      note: `no parser is registered for ${tool} — its output was not read, which is not conformance` };
  }
  if (!ok && !files.length) {
    return { ...base, status: 'unreadable', exit: code ?? null, deviationCount: null,
      note: `${tool} exited ${code ?? '?'} but no deviating file could be parsed — it either failed to run or emits a format this parser does not match. Not clean, and not a count either.` };
  }
  return { ...base, status: files.length ? 'findings' : 'clean', exit: ok ? 0 : (code ?? null),
    deviationCount: files.length, deviations: files.slice(0, 200) };
}

/**
 * Lint diagnostics per tool. Counts DIAGNOSTICS, not files — a lint finding is a diagnostic,
 * where a format deviation is a file. Returns null when no parser is registered, never [].
 */
export const LINT_PARSERS = Object.freeze({
  // --message-format=short: `src/lib.rs:10:5: warning: unused variable: `x``
  clippy: (o) => String(o ?? '').split('\n')
    .map((l) => l.match(/^(\S+?):(\d+):(\d+):\s+(warning|error):\s*(.+)$/))
    .filter(Boolean).map((m) => ({ file: m[1], line: +m[2], severity: m[4], message: m[5].trim() })),
  // eslint --format=unix: `path:line:col: message [severity/rule]`
  eslint: (o) => String(o ?? '').split('\n')
    .map((l) => l.match(/^(\S+?):(\d+):(\d+):\s*(.+?)\s*\[(Error|Warning)\/(\S+)\]$/))
    .filter(Boolean).map((m) => ({ file: m[1], line: +m[2], severity: m[5].toLowerCase(), message: m[4], rule: m[6] })),
  'golangci-lint': (o) => String(o ?? '').split('\n')
    .map((l) => l.match(/^(\S+?):(\d+):(\d+):\s*(.+?)\s*\((\S+)\)$/))
    .filter(Boolean).map((m) => ({ file: m[1], line: +m[2], severity: 'warning', message: m[4], rule: m[5] })),
  // ruff check --output-format=concise: `path:line:col: RULE message`
  ruff: (o) => String(o ?? '').split('\n')
    .map((l) => l.match(/^(\S+?):(\d+):(\d+):\s+([A-Z]+\d+)\s+(.+)$/))
    .filter(Boolean).map((m) => ({ file: m[1], line: +m[2], severity: 'warning', rule: m[4], message: m[5] })),
});

export const lintFindings = (tool, out) => (LINT_PARSERS[tool] ? LINT_PARSERS[tool](out) : null);

/**
 * Did the linter analyse everything, or abort partway?
 *
 * A linter that dies on one target still prints findings for the targets it got through, and the
 * count then reads as a complete survey when it is a floor — so a repo whose lint CRASHES looks
 * cleaner than one whose lint finishes. Measured on memory-layer 2026-08-23: clippy reported 105 parseable
 * diagnostics and ended `error: could not compile memory-layer (bench "adaptive_memory_benchmarks") due to
 * 2 previous errors`. The count was real and the subject set was not the tree.
 *
 * Returns { complete, reason }. Unknown tools are assumed complete — an unrecognised output format
 * is caught by the exit-vs-parse cross-check, not here.
 */
export function lintComplete(tool, out) {
  const text = String(out ?? '');
  const abort = text.match(/^error: could not compile .*$/m)
    || text.match(/^error: aborting due to .*$/m)
    || text.match(/^Error: (?:typecheck|compilation) failed.*$/mi);
  return abort ? { complete: false, reason: abort[0].trim() } : { complete: true, reason: null };
}

/**
 * Fold one linter run.
 *
 * `enforced` is the severity THE REPO DECLARED, not what the linter can do. memory-layer's CI runs
 * `cargo clippy --all-targets -- -W clippy::all`, counts warnings, and prints "Status | Passed"
 * unconditionally — it declares clippy as a advisory count, never a gate. Reporting that repo as
 * FAILING clippy would assert a bar it never set, which is the same error as running a formatter's
 * default over a repo that never adopted it, one level in: not "is the tool declared" but "at what
 * severity did they declare it".
 *
 * So an advisory declaration can never produce `findings:` — it reports `advisory` and carries the
 * count in the payload. Only a repo that denies (-D) gets a findings verdict.
 *
 * Same exit-vs-parse cross-check as foldFormat: a linter that exited non-zero while nothing parsed
 * is `unreadable`, never clean. Linters exit non-zero on DENIED lints only, so under an advisory
 * declaration a non-zero exit means the tool itself failed — also unreadable, not a finding.
 */
export function foldLint({ lang, tool, declaredBy, command, enforced, ok, code, findings, completeness = { complete: true, reason: null } }) {
  const base = { lang, ran: true, tool, declaredBy, command, enforced: enforced ? 'deny' : 'warn' };
  if (findings === null) {
    return { ...base, status: 'unreadable', exit: ok ? 0 : (code ?? null), findingCount: null,
      note: `no parser is registered for ${tool} — its output was not read, which is not a clean lint` };
  }
  if (!ok && !findings.length) {
    return { ...base, status: 'unreadable', exit: code ?? null, findingCount: null,
      note: `${tool} exited ${code ?? '?'} with nothing parseable — it failed to run, or emits a format this parser does not match` };
  }
  // An aborted run is UNREADABLE even though findings parsed. The findings are kept — they are
  // real — but the COUNT is a floor over the targets the linter reached, and publishing a floor as
  // a total makes a crashing lint look cleaner than a finishing one.
  if (!completeness.complete) {
    return { ...base, status: 'unreadable', exit: ok ? 0 : (code ?? null),
      findingCount: null, findingsFloor: findings.length, findings: findings.slice(0, 200), complete: false,
      note: `${tool} did not analyse the whole tree — ${completeness.reason}. ${findings.length} diagnostic(s) were parsed and are real, but they are a FLOOR over the targets it reached, not a count of the tree. Absence from this list is not evidence of absence.` };
  }
  const sample = findings.slice(0, 200);
  if (!enforced) {
    // The repo declared a count, so this reports a count. Never a verdict it did not ask for.
    return { ...base, status: findings.length ? 'advisory' : 'clean', exit: ok ? 0 : (code ?? null),
      findingCount: findings.length, findings: sample,
      note: findings.length ? `${findings.length} diagnostic(s); this repo declares ${tool} at WARN level, so this is a count and not a failed gate` : undefined };
  }
  return { ...base, status: findings.length ? `findings:${findings.length}` : 'clean',
    exit: ok ? 0 : (code ?? null), findingCount: findings.length, findings: sample };
}

/**
 * Count executed tests per language. Returns null — never 0 — when nothing matched: 0 means "ran
 * and found no tests" (no-tests), null means "output not recognised" (uncounted, not a finding).
 * Rust and Go are SUMMED across lines (one result line per test binary/crate).
 */
export function countTests(lang, out) {
  const text = String(out == null ? '' : out);
  const sum = (re, group = 1) => {
    let total = null;
    for (const line of text.split('\n')) {
      const m = line.match(re);
      if (m) total = (total || 0) + Number(m[group]);
    }
    return total;
  };
  switch (lang) {
    case 'rust':
      // Anchored to line start so a test that PRINTS this string cannot inflate the count.
      return sum(/^\s*test result:\s+\w+\.\s+(\d+)\s+passed/);
    case 'go': {
      // No total line; count top-level verdicts only (subtests indent), matching go test -v.
      const verdicts = text.split('\n').filter((l) => /^--- (?:PASS|FAIL|SKIP):/.test(l)).length;
      return verdicts || (/^(?:ok|FAIL|\?)\s+\S/m.test(text) ? 0 : null);
    }
    case 'javascript': case 'typescript': case 'js': {
      // node --test TAP-ish summary, then jest/vitest.
      const nodePass = sum(/^#\s+pass\s+(\d+)/);
      if (nodePass !== null) return nodePass;
      const m = text.match(/^\s*Tests?:.*?(\d+)\s+passed/m);
      return m ? Number(m[1]) : null;
    }
    case 'python': {
      const m = text.match(/^=+\s.*?(\d+)\s+passed/m) || text.match(/(\d+)\s+passed/);
      return m ? Number(m[1]) : null;
    }
    case 'ruby': {
      const m = text.match(/(\d+)\s+examples?,/);
      return m ? Number(m[1]) : null;
    }
    default:
      return null;
  }
}

/** Fold one language's phase results into a report fragment. `green` still means every phase that
 *  ran exited 0; its scope narrowed — a no-test repo is now `no-tests`, not green. */
export function foldPhases({ lang, parsed, testPhaseName = 'test', testCount = null, testPhasePresent = true, infraPhases = [WORKSPACE_PHASE] }) {
  if (!parsed.complete) {
    return { green: false, status: 'unreadable', phases: parsed.phases, failedPhase: null, testPhasePresent,
      note: 'the container produced no phase terminator — it died mid-run (OOM kill, daemon restart, or truncated output). Not a verdict on the repo.' };
  }
  const failed = parsed.phases.find((p) => p.attempted && !p.green) || null;
  if (failed) {
    // An INFRA phase failing is not a finding about the repo — same class as an absent docker
    // daemon, so env-blocked.
    if (infraPhases.includes(failed.name)) {
      return { green: false, status: 'env-blocked', phases: parsed.phases, failedPhase: failed.name, testPhasePresent,
        note: `the ${failed.name} phase exited ${failed.exit} — the workspace copy could not be made on this runner (disk, permissions, or a missing tar in the image), so the repo's build was never attempted. A property of the runner, not of the repo.` };
    }
    return { green: false, status: 'RED', phases: parsed.phases, failedPhase: failed.name, testPhasePresent,
      note: `${failed.name} phase exited ${failed.exit}` };
  }
  const testPhase = parsed.phases.find((p) => p.name === testPhaseName && p.attempted) || null;
  if (!testPhase || testCount === 0) {
    return { green: false, status: 'no-tests', phases: parsed.phases, failedPhase: null, testPhasePresent: !!testPhase,
      testCount: testPhase ? 0 : null,
      note: testPhase
        ? 'the test phase ran and executed zero tests — a passing exit code over an empty set is not evidence of health'
        : 'no test phase was run for this repo (no test script/target declared) — nothing was verified' };
  }
  return { green: true, status: 'green', phases: parsed.phases, failedPhase: null, testPhasePresent: true, testCount,
    note: testCount === null ? 'all phases passed; test count not parsed for this language (uncounted, not zero)' : undefined };
}

// What the scanners were NOT allowed to look at — derived from the files that actually bound them.
// Suppression is a coverage cost, and a cost not displayed has not been paid. Fail closed: an
// unreadable/unparsable scope file returns known:false, never an empty exclusion list — even
// ENOENT (gitleaks fatals on a missing --config, so absence never means "scanned unbounded").

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { relativePosix } from '../lib/path-contain.mjs'; // `startsWith(root + '/')` is false on Windows
import { fileURLToPath } from 'node:url';
import { SCANNER_CHECKS } from './scanner-checks.mjs'; // the ONE category->check declaration

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');
export const scopePath = () => resolve(process.env.CW_GITLEAKS_CONFIG || join(CW, 'manifests', 'gitleaks.toml'));
export const baselinePath = () => resolve(process.env.CW_BASELINE_MANIFEST || join(CW, 'manifests', 'security-baseline.json'));

// Strings, comment-aware, one left-to-right pass — linear, no lookahead, no backtracking.
function scanLine(line) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '#') break;                                  // comment — the rest of the line is prose
    if (c === "'" && line.startsWith("'''", i)) {          // literal string, the form this file uses
      const end = line.indexOf("'''", i + 3);
      if (end === -1) break;                               // unterminated: take nothing, claim nothing
      out.push(line.slice(i + 3, end)); i = end + 2; continue;
    }
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end === -1) break;
      out.push(line.slice(i + 1, end)); i = end; continue;
    }
  }
  return out;
}

// Enough TOML for this file's shape; anything else is ignored rather than guessed at.
function parseAllowlists(src) {
  const blocks = [];
  let cur = null, key = null, buf = null;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (buf !== null) {                                    // inside a multi-line array
      buf.push(...scanLine(line));
      if (line.includes(']')) { if (cur) cur[key] = buf; buf = null; key = null; }
      continue;
    }
    if (line.startsWith('[[allowlists]]')) { cur = { description: '', paths: [], targetRules: null }; blocks.push(cur); continue; }
    if (line.startsWith('[')) { cur = null; continue; }     // any other table ends the block
    if (!cur) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    if (k !== 'description' && k !== 'paths' && k !== 'targetRules') continue;
    const rest = line.slice(eq + 1).trim();
    if (rest.startsWith('[') && !rest.includes(']')) { key = k; buf = scanLine(rest); continue; }
    const vals = scanLine(rest);
    if (k === 'description') cur.description = vals[0] || '';
    else cur[k] = vals;
  }
  return blocks;
}

// The size bound (--max-target-megabytes). { mb } is a determination (number, or null = flag
// genuinely absent); { unknown, reason } is a refusal to determine — the two never share an answer.
function maxTargetMB() {
  let raw;
  try { raw = readFileSync(baselinePath(), 'utf8'); }
  catch (e) { return { unknown: true, reason: e && e.code === 'ENOENT' ? 'absent' : 'unreadable' }; }
  let m;
  try { m = JSON.parse(raw); } catch { return { unknown: true, reason: 'unparsed' }; }
  const check = (m.checks || []).find((c) => c.id === 'secrets-gitleaks');
  if (!check) return { unknown: true, reason: 'undeclared' };   // no check, so nothing to read a bound off
  const hit = /--max-target-megabytes[ =](\d+)/.exec((check.local || []).join(' '));
  return { mb: hit ? Number(hit[1]) : null };
}

let cache = null;

/** Declared scan scope for the secret scan. Never returns an empty exclusion set as a success. */
export function scanScope() {
  const path = scopePath();
  let st;
  try { st = statSync(path); } catch (e) {
    return { known: false, reason: e.code === 'ENOENT' ? 'absent' : 'unreadable', source: relSource(path), detail: e.code || 'error' };
  }
  const stamp = `${path}:${st.mtimeMs}:${st.size}`;
  if (cache && cache.stamp === stamp) return cache.value;

  let src;
  try { src = readFileSync(path, 'utf8'); } catch (e) {
    return { known: false, reason: 'unreadable', source: relSource(path), detail: e.code || 'error' };
  }
  let blocks;
  try { blocks = parseAllowlists(src); } catch {
    return { known: false, reason: 'unparsed', source: relSource(path), detail: 'the scope file did not parse' };
  }
  // Zero exclusions is indistinguishable from a silent parser failure — say so.
  if (!blocks.length) return { known: false, reason: 'unparsed', source: relSource(path), detail: 'no allowlist blocks were recognised' };

  // maxTargetMB stays number-or-null; maxTargetUnknown says when the bound could not be determined.
  const mt = maxTargetMB();
  const value = {
    known: true,
    source: relSource(path),
    maxTargetMB: mt.unknown ? null : mt.mb,
    ...(mt.unknown ? { maxTargetUnknown: mt.reason } : {}),
    // rule-scoped blocks last: the bigger (every-rule) claim reads first
    blocks: blocks
      .map((b) => ({
        description: b.description,
        paths: [...b.paths],
        targetRules: b.targetRules && b.targetRules.length ? [...b.targetRules] : null,
      }))
      .sort((a, b) => (a.targetRules ? 1 : 0) - (b.targetRules ? 1 : 0)),
  };
  cache = { stamp, value };
  return value;
}

function relSource(p) {
  // relativePosix(): the old `startsWith(CW + '/')` was false for every path on Windows, so nothing
  // was ever relativised and absolute machine paths went into the output. POSIX separators because
  // this value is STORED and COMPARED — a separator-dependent string is a separator-dependent
  // identity, which is the same class of defect as keying one on a line number.
  const r = relativePosix(CW, p);
  return r === null ? p : r;
}

// ── PER-SCANNER SCOPE ───────────────────────────────────────────────────────────────────────────
// Derived from each check's own `local` command in the baseline manifest: path bounds become
// `blocks`, non-path bounds become `notes` — never free-standing prose.
// category key → the manifest check whose command carries the bounds.
// DERIVED FROM SCANNER_CHECKS, not hand-kept beside it.
//
// This was a literal map of ten categories, written when there were ten worth bounding. The
// category set has since grown past thirty, and nothing made this list grow with it — so a lane
// added on Tuesday was scope-disclosed only if someone remembered to add it here on Tuesday, and
// twenty-one of them were not. That is the SCANNER_LABEL 12-of-25 failure again: a parallel list
// that silently stops matching the thing it describes.
//
// It is caught here rather than left to memory: every category the rollup speaks for now gets a
// scope answer, and a lane whose command declares no bounds returns `blocks:[] notes:[]` — "no
// bounds declared", which is a DIFFERENT claim from `known:false` ("could not tell") and from
// silence ("never asked"). All three are states a reader must be able to distinguish.
//
// `secrets` is excluded because it keeps its toml-derived shape (scanScope()), which reads the
// gitleaks config rather than a command line.
const COMMAND_SCOPES = Object.fromEntries(
  Object.entries(SCANNER_CHECKS).filter(([key]) => key !== 'secrets'),
);

let baselineCache = null;
function readBaseline() {
  const path = baselinePath();
  let st;
  try { st = statSync(path); } catch (e) {
    return { err: { known: false, reason: e.code === 'ENOENT' ? 'absent' : 'unreadable', source: relSource(path), detail: e.code || 'error' } };
  }
  const stamp = `${path}:${st.mtimeMs}:${st.size}`;
  if (baselineCache && baselineCache.stamp === stamp) return baselineCache.value;
  let value;
  try { value = { manifest: JSON.parse(readFileSync(path, 'utf8')), source: relSource(path) }; }
  catch (e) {
    value = { err: { known: false, reason: e instanceof SyntaxError ? 'unparsed' : 'unreadable', source: relSource(path), detail: e.code || 'bad json' } };
  }
  baselineCache = { stamp, value };
  return value;
}

// Linear flag reads over one command string. Derivation is cross-checked against declaration:
// each derived bound carries a stable key, the check declares its expected keys in `scopeNotes`,
// and disagreement in either direction is known:false. Prose may be reworded; keys are the contract.
// A check can live in an OPT-IN bundled manifest (test-hermetic in hermetic-tests.json) rather than
// the baseline; its scope is then derived from that manifest's command like any other. Never from
// security-baseline.json when a fixture baseline is set: a test that removes a check to prove
// "undeclared" must not find it in the shipped copy instead.
const SHIPPED_BASELINE = 'security-baseline.json';
function declaringManifest(base, checkId) {
  const inBase = (base.manifest.checks || []).find((c) => c && c.id === checkId);
  if (inBase) return { base, check: inBase };
  const dir = join(CW, 'manifests');
  let names;
  try { names = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== SHIPPED_BASELINE).sort(); } catch { return null; }
  for (const f of names) {
    const p = join(dir, f);
    if (resolve(p) === resolve(baselinePath())) continue;
    let m;
    try { m = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    const c = Array.isArray(m && m.checks) ? m.checks.find((x) => x && x.id === checkId) : null;
    if (c) return { base: { manifest: m, source: relSource(p) }, check: c };
  }
  return null;
}

function commandScope(baseline, checkId) {
  if (baseline.err) return baseline.err;
  const found = declaringManifest(baseline, checkId);
  if (!found) return { known: false, reason: 'undeclared', source: baseline.source, detail: `no check '${checkId}' in the manifest` };
  const { base, check } = found;
  const cmd = (Array.isArray(check.local) ? check.local : []).join(' ');
  const blocks = [], notes = [], keys = [];
  const note = (key, text) => { keys.push(key); notes.push(text); };
  // DE-DUPLICATED: a check may run more than one command (sast runs the Pro pass and, where Pro
  // ran, an OSS control pass), and both exclude the same paths. The excluded set is a SET — the
  // same path named twice is one bound, not two, and listing it twice made the derived scope
  // disagree with itself the moment a second command was added.
  const ex = [...new Set([...cmd.matchAll(/--exclude[ =]([^\s]+)/g)].map((h) => h[1].replace(/^['"]|['"]$/g, '')))];
  if (ex.length) blocks.push({ description: `paths excluded by --exclude in the ${checkId} command`, paths: ex, targetRules: null });
  const skip = [...cmd.matchAll(/--skip-dirs[ =]([^\s]+)/g)].flatMap((h) => h[1].replace(/^['"]|['"]$/g, '').split(',')).filter(Boolean);
  if (skip.length) blocks.push({ description: `directories skipped by --skip-dirs in the ${checkId} command`, paths: skip, targetRules: null });
  const lang = /--language[ =]([^\s"']+)/.exec(cmd);
  if (lang) note('language', `analyses ${lang[1]} only — other languages in the repo are not scanned by this check`);
  if (/--build-mode[ =]none/.test(cmd)) note('build-mode-none', 'build-mode none — source-only analysis; nothing that only exists after a build is reached');
  // fact: `autobuild` decides whether the lane runs AT ALL — it needs a build method it can recognise and this fleet clones repos it never builds / `none` merely narrows what is REACHED, which is the milder of the two bounds (expiry: never, prev: unknown)
  // fact: that bound is held by the BOX, not the command, so it is stated rather than inferred from a green suite that never built / measured 2026-08-24 (evaluations/php-taint-and-csharp-lane) one C# source root: buildless made a database, autobuild exited 2 "Could not auto-detect a suitable build method"; 2026-08-26 across the swift lane's fleet history: 4 of 6 runs exited 2 with no SARIF (expiry: on re-measure, prev: missing)
  if (/--build-mode[ =]autobuild/.test(cmd)) note('build-mode-autobuild', 'build-mode autobuild — the extractor must find and run a build it recognises before anything is analysed. On a checkout this fleet never builds (no toolchain, no SDK, no dependency restore) database creation FAILS rather than narrowing, so the lane reports noscan. A repo whose build does not run here is NOT scanned by this check, and that is a property of this machine, not of the repo.');
  if (/\bdocker run\b/.test(cmd)) note('docker', 'runs inside docker — on a box without docker the check is skipped, not scanned');
  if (cmd.includes('$CW_TARGET_URL')) note('target-url', 'runs against the declared live target URL only — a repo with no declared target is skipped, not scanned');
  // A REAL COVERAGE BOUND, not a tidy-up. Template types that take only the HOST from the target and
  // use their own ports are excluded, so this lane does not cover network services on the target
  // machine at all. It was added because it had the opposite defect first: unrestricted, one run
  // against http://localhost:8080 returned 19 findings of which SIX described the probe host —
  // PostgreSQL on :5432, RabbitMQ on :5672, SNMPv3 on :161, mDNS and Zeroconf on :5353, and a CAA
  // record for the name "localhost" — published beside genuine application findings under a report
  // line that already read UNKNOWN SCOPE. The port mismatch is the proof: a template respecting a
  // :8080 target could not be at :5432. Host posture is a real subject and needs a check with its
  // own target; stating the bound here is what stops its absence reading as its coverage.
  if (/(?:^|\s)(?:-ept|--exclude-type)[ =]/.test(cmd)) {
    const t = /(?:^|\s)(?:-ept|--exclude-type)[ =]([^\s]+)/.exec(cmd);
    note('probe-host-excluded', `template types ${t ? t[1] : 'listed in -ept'} are NOT run — they take only the host from the target and use their own ports, so services on the target machine (databases, brokers, SNMP, mDNS) are outside this scan entirely. Their absence here is not evidence they are absent there.`);
  }
  // Which rules ran is a scope bound; --config is repeatable and the packs union, so read ALL of
  // them. Telemetry is disclosed in both directions (off states itself too).
  const cfgs = [...cmd.matchAll(/--config[ =]([^\s"']+)/g)].map((m) => m[1]);
  if (cfgs.includes('auto')) {
    note('ruleset-auto', 'the rule set is chosen REMOTELY per run (--config auto) — coverage can change with no commit here, and what ran is not recorded in this manifest');
  } else if (cfgs.some((c) => /^p\//.test(c))) {
    const packs = cfgs.filter((c) => /^p\//.test(c));
    note('ruleset-pinned', `runs ${packs.length} named registry pack(s) — ${packs.join(', ')}. Coverage changes only when this command changes, so two scans of unchanged code compare honestly. Measured 2026-08-11 on this repo: the three together load 1157 rules against p/default's 1074, and p/default alone was already identical to what \`auto\` resolved`);
  }
  // Which engine ran is an account-gated coverage bound. /--pro\b/ also matches --pro-intrafile
  // (\b matches at the hyphen) — negative lookahead, narrower flag first.
  // The conditional form MUST be tested first: `${CW_SEMGREP_PRO:+--pro-intrafile}` contains the
  // literal `--pro-intrafile`, so both regexes below match it and the fixed-engine note would be
  // published for every repo in the fleet — including the ones that ran OSS. A declaration derived
  // from text that only LOOKS like the flag is exactly the shape this file exists to refuse.
  const perRepo = /\$\{(\w+):\+\s*--pro-intrafile\s*\}/.exec(cmd);
  if (perRepo) {
    note('engine-per-repo', 'the engine is NOT fixed by this manifest: Semgrep Pro is licensed for a '
      + `bounded number of repositories and is allocated per repo (\`${perRepo[1]}\`, set by the sweep from `
      + 'the registry\'s semgrepPro.repos). Repos inside the allocation get intra-file interprocedural '
      + 'taint; repos outside it run the OSS engine, whose findings are REAL — the narrower engine is a '
      + 'coverage bound, not a reason to discount a number. Which engine actually ran is not taken from '
      + 'this command: each repo\'s semgrep.sarif records it at runs[].tool.driver.name (\'Semgrep PRO\' '
      + 'or \'Semgrep OSS\', measured 2026-08-29), so the allocation is checkable against the artifact '
      + 'rather than believed from the declaration');
  }
  else if (/--pro-intrafile\b/.test(cmd)) note('engine-pro-intrafile', 'runs the Pro engine, intra-file interprocedural taint only (--pro-intrafile) — requires a semgrep login. Measured 2026-08-11 on this repo: same 3033 rules as full --pro and 36 of its 38 findings, at 48s against 175s. The two it misses need cross-file flow, which is the `deep` group\'s job');
  else if (/--pro(?![-\w])/.test(cmd)) note('engine-pro-interfile', 'runs the Pro engine with INTERFILE analysis (--pro) — requires a semgrep login; without one the check fails and reports noscan rather than silently narrowing');
  // The OSS CONTROL PASS — a separate `if`, deliberately outside the engine chain above: which
  // engine ran and whether a control pass ran are independent facts, and chaining this would have
  // suppressed the engine note on exactly the repos that carry the control.
  // Pro is a different analysis, not a superset: measured 2026-08-30 across ten repositories, two
  // reported FEWER findings under Pro, and semgrep/semgrep#10761 (open) is an outright result-loss
  // mode in interfile analysis. A per-repo engine allocation therefore has to make the loss
  // measurable rather than assume it absent, so the lane re-runs OSS wherever Pro ran and
  // bin/semgrep-pro-delta.mjs reports anything the OSS engine saw and the Pro engine did not.
  if (/semgrep-oss\.sarif/.test(cmd)) {
    note('pro-delta-control', 'where Pro runs, the OSS engine runs too and both SARIFs are kept, so a finding '
      + 'the narrower engine reports and the wider one does not is VISIBLE rather than assumed impossible. '
      + 'The comparison excludes nosemgrep-suppressed results (a suppression is a judgement already made) '
      + 'and keys identity on rule+file, never line. A control pass that is absent reads as not-applicable '
      + 'and one that cannot be parsed reads as unknown — neither is reported as zero loss');
  }
  // zizmor pointed at `.` walked .git/ and re-scanned stale worktrees — scoped to .github/.
  if (/\bzizmor\b/.test(cmd) && /\s\.github\//.test(cmd)) {
    note('workflows-dir-only', 'scans .github/ only — not the whole tree. Deliberate: pointed at `.` it walked .git/ and re-scanned every stale worktree checkout, inflating commitwork from 5 findings to 1753');
  }
  // CLEAN BUILD TRACED. GitHub documents that for compiled languages the traced command "must
  // specify a 'clean' build which compiles all the source code files without reusing existing
  // build artefacts". autobuild does not clean, and a target already up to date compiles nothing —
  // measured 2026-08-30, that produced a Swift database holding two package manifests and no
  // application code, at exit 0.
  if (/codeql-swift-build\.sh|xcodebuild clean/.test(cmd)) {
    note('clean-build-traced', 'the traced build CLEANS first, so every source file is compiled and '
      + 'therefore seen by the extractor. An incremental build under a tracer measures only what '
      + 'changed since a build nobody recorded, which is indistinguishable from a clean scan and '
      + 'costs a full rebuild per run to avoid');
  }
  const met = /--metrics[ =](on|off|auto)/.exec(cmd);
  if (met) {
    note('metrics', met[1] === 'off'
      ? 'sends NO usage telemetry to the rule vendor (--metrics=off) — an explicit decision, not a default. `--config auto` still fetches rules from their server, so the network call happens; nothing about what was found goes back'
      : `sends pseudonymous usage metrics to the rule vendor on every run (--metrics=${met[1]}) — rule ids, counts and timings leave this machine for every repo scanned, including ones this fleet does not own. Not source code, and not a bound on what was scanned: a bound on what the scan discloses`);
  }
  // Which npm manifest is itself a bound (declared vs resolved tree); the two regexes never both
  // fire on one path.
  if (/package-lock\.json/.test(cmd)) note('package-lock', 'reads package-lock.json only — other manifests and the source tree are not examined');
  if (/package\.json/.test(cmd)) note('package-json', 'reads package.json only — the DECLARED dependencies, not the resolved lockfile tree; transitive dependencies and the source tree are not examined');
  // A bound held in a file, not a flag: the CodeQL filter reference is FOLLOWED, not merely noted.
  const ff = /([\w./$-]*codeql-filters\.txt)/.exec(cmd);
  if (ff) {
    const fp = resolve(ff[1].replace(/^\$CW_ROOT\/?/, CW + '/').replace(/^["']|["']$/g, ''));
    let raw;
    try { raw = readFileSync(fp, 'utf8'); } catch (e) {
      // Fail closed — "could not read the bound" and "no bound" are opposite claims.
      return { known: false, reason: e.code === 'ENOENT' ? 'absent' : 'unreadable', source: relSource(fp), detail: e.code || 'error' };
    }
    const rules = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const paths = rules.filter((l) => l.startsWith('exclude:')).map((l) => l.slice('exclude:'.length));
    if (!paths.length) return { known: false, reason: 'unparsed', source: relSource(fp), detail: 'no exclude rules were recognised in the filter file' };
    blocks.push({ description: `paths CodeQL was not allowed to index, from ${relSource(fp)} (LGTM_INDEX_FILTERS)`, paths, targetRules: null });
    // fact: the extractor's own baseline is a second bound this command never states, and it is PER-LANGUAGE / the set enumerated below was measured against codeql/javascript's baseline-config.json and is true of that extractor only (expiry: when the other lanes' baselines are read, prev: unknown)
    // fact: every lane gets the KEY because the bound exists for all of them, but a lane whose baseline has not been read SAYS SO / "not enumerated" and "nothing excluded" are opposite claims, and asserting javascript's set of python/ruby/cpp/csharp/swift is a false coverage statement wearing a disclosure's clothes (expiry: never, prev: wrong)
    const JS_BASELINE = 'the CodeQL extractor additionally drops **/node_modules/**, **/bower_components/**, **/*.min.js and **/*-min.js before this filter file is consulted — dependency trees are covered by deps-osv/deps-retire/npm-audit instead. A VENDORED minified asset that no SAST lane reads is now covered for READABILITY by the minifiedCode lane (minify-detect), which makes unreadable/obfuscated content its own signal; it runs in the `deep` group until its R2 baseline lets it graduate to `all`, so a minified asset is scanned for obfuscation on demand rather than nightly.';
    const isJs = lang && /^javascript/.test(lang[1]);
    note('codeql-extractor-baseline', isJs ? JS_BASELINE
      : `the ${lang ? lang[1] : 'CodeQL'} extractor applies its OWN baseline exclusions before this filter file is consulted (LGTM_INDEX_FILTERS is appended to those defaults, never replaces them). That set has NOT been enumerated here for this language — only codeql/javascript's baseline has been read and measured. So this lane carries an undisclosed second bound: its zero is bounded by an exclusion list nobody in this repository has written down. Treat it as a known unknown, not as "nothing else is excluded".`);
  }
  // Both drift directions are reported: declared-not-derived (a bound vanished) and
  // derived-not-declared (a bound nobody signed off on).
  const declared = Array.isArray(check.scopeNotes) ? check.scopeNotes.map(String) : null;
  if (declared) {
    const have = new Set(keys), want = new Set(declared);
    const vanished = [...want].filter((k) => !have.has(k));
    const unsigned = [...have].filter((k) => !want.has(k));
    if (vanished.length || unsigned.length) {
      // Drift invalidates the notes, not the blocks — blocks are still derived correctly and are
      // handed over; `notes` is deliberately absent rather than a half-list.
      return { known: false, reason: 'scope-drift', source: base.source, blocks,
        ...(/--max-target-megabytes[ =](\d+)/.exec(cmd) ? { maxTargetMB: Number(/--max-target-megabytes[ =](\d+)/.exec(cmd)[1]) } : {}),
        detail: `${checkId}: the command no longer matches its declared scopeNotes — `
          + `${vanished.length ? `declared but not derived: ${vanished.join(', ')}` : ''}`
          + `${vanished.length && unsigned.length ? '; ' : ''}`
          + `${unsigned.length ? `derived but not declared: ${unsigned.join(', ')}` : ''}`
          + '. Update scopeNotes in the manifest if the command change was intended. '
          + 'The path exclusions below are still derived from the command and remain accurate; '
          + 'the non-path bounds are what cannot be stated.' };
    }
  }
  const mb = /--max-target-megabytes[ =](\d+)/.exec(cmd);
  return { known: true, source: base.source, blocks, notes, ...(mb ? { maxTargetMB: Number(mb[1]) } : {}) };
}

/** Declared scope for EVERY scanner category the panel details. secrets keeps its toml-derived
 *  shape; the rest are read from their check commands. A category with no declared bounds gets
 *  `blocks:[] notes:[]` — "no bounds declared", which is a different claim from `known:false`. */
export function scanScopes() {
  const base = readBaseline();
  const out = { secrets: scanScope() };
  for (const [key, checkId] of Object.entries(COMMAND_SCOPES)) out[key] = commandScope(base, checkId);
  return out;
}

export const _internals = { parseAllowlists, scanLine, commandScope };

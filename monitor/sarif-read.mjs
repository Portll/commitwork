// monitor/sarif-read.mjs — the one SARIF reader; every `.sarif` this tree opens goes through it.
// Returns a typed record, never a bare array:
//   state: 'ok' | 'absent' | 'unreadable' | 'empty' | 'unparseable' | 'never-ran' | 'tool-failed'
// Only 'ok' carries runs/results arrays; every other state carries null — a defaulted [] is how a
// scan that never ran reads as a clean scan, and null poisons that arithmetic loudly.
// 'never-ran': valid JSON without the spec-required runs[] (a tool's error object, a stub).
// 'tool-failed': zero results while the invocation channel reports failure; both channels are
// checked because executionSuccessful can be true while the notifications carry the fatal error.
// Findings win over errors: any results present ⇒ 'ok' (degraded, not void). So does a run whose
// only errors are per-file extraction failures while other files extracted: 'ok' with
// extractionErrors[], which callers report as reduced coverage.
// 'absent' is ENOENT only; callers decide what absence MEANS, never re-detect it with existsSync.
// 'empty' has two live meanings (manifest's "no sources" vs a killed tool) — the caller maps it.
// norules is an advisory fact on 'ok', not a verdict: per-tool meaning (osv-scanner's clean output
// is norules-shaped; semgrep's is the empty-ruleset void).
// Residual: truncated-but-VALID JSON is undetectable from content and reads 'ok'; bytes and
// resultCount ride the record for external anomaly comparison. Nothing here claims to catch it.
import { readFileSync } from 'node:fs';

export const SARIF_STATES = ['ok', 'absent', 'unreadable', 'empty', 'unparseable', 'never-ran', 'tool-failed'];

// Semgrep names a rule loaded from a local --config directory after that directory's absolute path,
// dotted (`Users.<name>.….manifests.semgrep-classes.cw-x`), so a rule's id, and every issue keyed on
// it, moved with the checkout that ran the sweep and carried the home directory into titles. The
// bundled packs keep `manifests.semgrep-<pack>.<rule>`; the last occurrence wins when the checkout
// path itself contains one. Ids of any other shape are returned unchanged.
const LOCAL_RULE_ID = /^(?:[\w.-]*\.)?(manifests\.semgrep-[a-z-]+\.[\w-]+)$/;
export const localRuleId = (id) => {
  if (typeof id !== 'string') return id;
  const m = LOCAL_RULE_ID.exec(id);
  return m ? m[1] : id;
};

function normaliseRuleIds(runs) {
  for (const run of runs) {
    if (!run || typeof run !== 'object') continue;
    const rules = run.tool && run.tool.driver && Array.isArray(run.tool.driver.rules) ? run.tool.driver.rules : [];
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') continue;
      if (rule.name === rule.id) rule.name = localRuleId(rule.name);
      rule.id = localRuleId(rule.id);
    }
    for (const res of Array.isArray(run.results) ? run.results : []) {
      if (!res || typeof res !== 'object') continue;
      res.ruleId = localRuleId(res.ruleId);
      if (res.rule && typeof res.rule === 'object') res.rule.id = localRuleId(res.rule.id);
    }
  }
}

const REC = (state, reason, extra = {}) => ({
  state, runs: null, results: null, resultCount: null, tool: null, ruleCount: null,
  norules: false, bytes: null, version: null, reason, ...extra,
});

export function readSarif(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    // ENOENT is the only code meaning "legitimately absent"; everything else fails closed
    if (e && e.code === 'ENOENT') return REC('absent', 'no artifact at this path');
    return REC('unreadable', `artifact exists but could not be read — ${(e && e.code) || 'unknown error'}`);
  }
  const bytes = Buffer.byteLength(raw);
  if (!raw.trim()) return REC('empty', 'zero-byte or whitespace-only artifact', { bytes });
  let j; try { j = JSON.parse(raw); } catch { return REC('unparseable', 'present but not valid JSON — truncated or corrupt write', { bytes }); }
  // runs[] holds ONE ENTRY PER TOOL INVOCATION, so an empty array describes zero invocations — the
  // same evidence as no runs[] at all. A tool that ran and found nothing emits one run with an
  // empty results[]; a zero-run document asserts nothing ran.
  if (!Array.isArray(j.runs)) return REC('never-ran', 'not a sarif document — no runs[]', { bytes });
  if (j.runs.length === 0) return REC('never-ran', 'sarif document describing zero tool invocations — runs[] is empty', { bytes });
  normaliseRuleIds(j.runs);

  const results = j.runs.flatMap((r) => (r && Array.isArray(r.results) ? r.results : []));
  const tool = (j.runs[0] && j.runs[0].tool && j.runs[0].tool.driver && j.runs[0].tool.driver.name) || null;

  const invocations = j.runs.flatMap((r) => (r && r.invocations) || []);
  // Semgrep's Pro-language gate notifies at level 'note', descriptor.id 'Missing plugin' (an Elixir
  // rule against real Elixir source) — the file was never parsed, but 'note' sits outside the
  // error/fatal filter, so without this a Pro-gated language reads as a genuine clean scan
  // (state:ok, results:0) rather than the never-parsed truth. Admitted by descriptor id, not by
  // level, so other 'note' notifications (which are routinely benign) don't get swept into
  // tool-failed alongside it.
  const errorNotes = invocations.flatMap((i) => ((i && i.toolExecutionNotifications) || [])
    .filter((n) => n && (n.level === 'error' || n.level === 'fatal'
      || (n.level === 'note' && n.descriptor && n.descriptor.id === 'Missing plugin'))));
  const toolErrors = errorNotes.map((n) => (n.message && n.message.text) || 'unspecified tool error');
  const failedRun = invocations.some((i) => i && i.executionSuccessful === false);
  // A file the extractor could not parse is a coverage fact, not a failed run: CodeQL names the file
  // and extracts the rest. Two shapes — javascript locates the file, go names it only in the
  // message — and on both the failed file ALSO appears in successfully-extracted-
  // files, so "the rest" is the success set minus the failures. Any other error keeps the void.
  const perFile = errorNotes.map(extractionFailure);
  const extractionErrors = dedupeByUri(perFile.filter(Boolean));
  const onlyFileErrors = errorNotes.length > 0 && perFile.every(Boolean) && !failedRun;
  const extractedAll = extractedUris(invocations);
  const failedSet = subtractedBy(extractionErrors.map((e) => e.uri), extractedAll);
  const extractedOther = onlyFileErrors && extractedAll.some((u) => !failedSet.has(u));
  if (!results.length && (failedRun || toolErrors.length) && !extractedOther) {
    // reason is uncapped — display truncation is the caller's
    return REC('tool-failed', toolErrors[0] || 'executionSuccessful=false', { bytes, tool });
  }

  let ruleCount = 0;
  for (const run of j.runs) {
    if (!run || typeof run !== 'object') continue;
    if (!Array.isArray(run.results)) run.results = []; // normalised: run.results is always an array on the ok path
    ruleCount += ((run.tool && run.tool.driver && run.tool.driver.rules) || []).length;
  }
  // A zero with NO invocation record cannot self-certify that the tool ran. osv-scanner emits the
  // same empty invocations[] whether egress was severed or healthy, so the artifact alone cannot
  // tell a clean scan from a scan of nothing, and the exit code is the SOLE witness.
  // A FIELD, never a state: Trivy, osv-scanner and GuardDog all commonly write this shape, so
  // promoting it to tool-failed would fail a large share of documents, most of them truly clean.
  // Consumers holding a second witness (the .exit sidecar) resolve it; consumers without one must
  // not read the zero as clean.
  const unwitnessedZero = results.length === 0 && invocations.length === 0;
  return {
    state: 'ok', runs: j.runs, results, resultCount: results.length, tool, ruleCount,
    version: typeof j.version === 'string' ? j.version : null,
    norules: j.runs.length > 0 && ruleCount === 0 && results.length === 0,
    unwitnessedZero,
    extractionErrors,
    partialAnalysis: partialAnalysis(invocations),
    ruleFailures: ruleFailures(invocations),
    bytes, reason: null,
  };
}

// Semgrep reports what it could not finish at level `warning`, below the error/fatal filter above,
// so a file it timed out on read as scanned and clean. Measured on one Rust repository's 2026-10-07
// sweep: 124 Timeout notifications over 49 files, the statement executor among them, published as 2
// results. The vocabulary is taken from 424 stored SARIFs (2026-10-08), not guessed, and splits two
// ways. A file the parser or matcher did not finish is a coverage fact about that file. A rule the
// engine cannot evaluate is a fact about the ruleset: 87,890 of 87,901 "Internal matching error"
// notices were three registry rules using a Pro-only operator, failing on every JavaScript file, and
// 2,427 of 4,319 syntax errors were a rule parsing a captured snippet as Bash. Counting those per
// file would mark almost every repository reduced, which says nothing about any of them.
const FILE_PARTIAL_IDS = Object.freeze({
  Timeout: 'timeout', 'Syntax error': 'syntax-error', 'Other syntax error': 'syntax-error', 'Lexical error': 'lexical-error',
  // bin/base-images.mjs: an image Trivy could not scan, or whose OS is past end of support.
  'Image not scanned': 'image-not-scanned',
});
const FILE_OF = [/ on (.+?):\s*$/s, /^(?:Other )?(?:Syntax|Lexical) error at line (.+?):\d+:/];
const SNIPPET = /When parsing a snippet as/;
const RULE_OF = [/when running (\S+) on /, /in rule '([^']+)'/];

const notices = (invocations) => (invocations || []).flatMap((i) => (i && i.toolExecutionNotifications) || []);
const byUriThenRule = (a, b) => (a.uri ?? a.rule) < (b.uri ?? b.rule) ? -1 : (a.uri ?? a.rule) > (b.uri ?? b.rule) ? 1 : 0;

/** Files a run read only in part, one row per file: {uri, reasons, notices}. Sorted by uri. */
export function partialAnalysis(invocations) {
  const byUri = new Map();
  for (const n of notices(invocations)) {
    const reason = FILE_PARTIAL_IDS[(n && n.descriptor && n.descriptor.id) || ''];
    const text = (n && n.message && n.message.text) || '';
    if (!reason || SNIPPET.test(text)) continue;
    const loc = (((n.locations || [])[0] || {}).physicalLocation || {}).artifactLocation;
    const uri = (loc && loc.uri) || FILE_OF.map((re) => re.exec(text)).find(Boolean)?.[1] || null;
    if (!uri) continue;
    const row = byUri.get(uri) || { uri, reasons: [], notices: 0 };
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
    row.notices++;
    byUri.set(uri, row);
  }
  return [...byUri.values()].map((r) => ({ ...r, reasons: r.reasons.sort() })).sort(byUriThenRule);
}

/** Rules the engine could not evaluate, one row per rule: {rule, notices, reason}. Sorted by rule. */
export function ruleFailures(invocations) {
  const byRule = new Map();
  for (const n of notices(invocations)) {
    const id = (n && n.descriptor && n.descriptor.id) || '';
    const text = (n && n.message && n.message.text) || '';
    if (id !== 'Internal matching error' && !(FILE_PARTIAL_IDS[id] && SNIPPET.test(text))) continue;
    const rule = localRuleId(RULE_OF.map((re) => re.exec(text)).find(Boolean)?.[1]);
    if (!rule) continue;
    const row = byRule.get(rule) || { rule, notices: 0, reason: (text.split('\n').map((s) => s.trim()).filter(Boolean).pop() || id).slice(0, 160) };
    row.notices++;
    byRule.set(rule, row);
  }
  return [...byRule.values()].sort(byUriThenRule);
}

const RULE_TITLE_MAX = 100;

/** A rule's own one-line description, or null. Rule-level metadata, the same for every hit, so it
 *  is a structured field rather than message text (issue titles take structured fields only).
 *  Tried in order: short description, name, first sentence of the full description; a candidate
 *  that restates the id (Semgrep's "Semgrep Finding: <id>") or names a generic class is skipped. */
export function ruleTitle(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const id = String(rule.id || '');
  const generic = /^(misconfiguration|vulnerability|finding|issue|warning|error)$/i;
  // Semgrep's short description and name both restate the id; its full description is the rule's
  // message template, the same for every hit, so its first sentence is the title.
  const full = rule.fullDescription && typeof rule.fullDescription.text === 'string'
    ? (rule.fullDescription.text.trim().match(/^[\s\S]*?[.!?](?=\s|$)/) || [rule.fullDescription.text])[0] : null;
  for (const cand of [rule.shortDescription && rule.shortDescription.text, rule.name, full]) {
    const t = String(cand || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t === id || (id && t.includes(id)) || generic.test(t)) continue;
    return t.length <= RULE_TITLE_MAX ? t : `${t.slice(0, RULE_TITLE_MAX - 1).trimEnd()}…`;
  }
  return null;
}

const EXTRACTION_ERROR_ID = /\/diagnostics\/extraction-errors$/;
const FAILED_IN = /^Extraction failed in (.+?) with error (.*)$/s;

/** {uri, line, error} for a per-file extraction failure, else null. */
export function extractionFailure(n) {
  if (!n || !n.descriptor || !EXTRACTION_ERROR_ID.test(n.descriptor.id || '')) return null;
  const loc = ((n.locations || [])[0] || {}).physicalLocation || {};
  const text = (n.message && n.message.text) || '';
  const m = FAILED_IN.exec(text);
  const uri = (loc.artifactLocation && loc.artifactLocation.uri) || (m && m[1]) || null;
  if (!uri) return null;
  return { uri, line: (loc.region && loc.region.startLine) || null, error: m ? m[2].trim() : text };
}

function dedupeByUri(rows) {
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.uri)) seen.set(r.uri, r);
  return [...seen.values()].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
}

function extractedUris(invocations) {
  const out = [];
  for (const i of invocations) {
    for (const n of (i && i.toolExecutionNotifications) || []) {
      if (!/successfully-extracted-files$/.test((n && n.descriptor && n.descriptor.id) || '')) continue;
      const uri = (((n.locations || [])[0] || {}).physicalLocation || {}).artifactLocation?.uri;
      if (uri) out.push(uri);
    }
  }
  return out;
}

/** Relative SARIF uris and the absolute paths some messages carry name one file when one ends the other. */
export function sameFile(a, b) {
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  return long.endsWith(`/${short}`);
}

/**
 * The members of `uris` that one failed file IS. Exact equality wins. A suffix match counts as
 * identity only when exactly one candidate matches: an absolute failed path `/r/cmd/x/main.go`
 * suffix-matches both `cmd/x/main.go` and a healthy root `main.go`, and picking either would
 * either void a scan that read the tree or credit a file that was not read. Ambiguous => none.
 */
export function failedMembers(failedUri, uris) {
  const list = [...uris];
  if (list.includes(failedUri)) return [failedUri];
  const hits = [...new Set(list.filter((u) => sameFile(failedUri, u)))];
  return hits.length === 1 ? hits : [];
}

/** Set of `uris` entries identified as one of `failedUris`, by failedMembers' resolution. */
export function subtractedBy(failedUris, uris) {
  const out = new Set();
  for (const f of failedUris) for (const u of failedMembers(f, uris)) out.add(u);
  return out;
}

// id -> rule index; extensions (CodeQL) are opt-in, driver rules win
// An in-source suppression (nosemgrep, // lgtm and the like) is a recorded judgement, not a live
// finding. The tool keeps the result and marks it; a suppression only a reviewer REJECTED does not hold.
export const isSuppressed = (res) =>
  Array.isArray(res && res.suppressions) && res.suppressions.some((s) => s && s.status !== 'rejected');

/**
 * The crit/high/med/low band of one result. security-severity (CodeQL's numeric convention, on the
 * rule or the result) outranks level; level falls back to the rule's default, then SARIF's own
 * default of 'warning'.
 */
export function sarifBand(res, rule) {
  const r = rule || {};
  const ss = parseFloat(((r.properties && r.properties['security-severity']) ?? (res && res.properties && res.properties['security-severity'])) ?? NaN);
  if (!Number.isNaN(ss)) return ss >= 9 ? 'crit' : ss >= 7 ? 'high' : ss >= 4 ? 'med' : 'low';
  const lvl = (res && res.level) || (r.defaultConfiguration && r.defaultConfiguration.level) || 'warning';
  return lvl === 'error' ? 'high' : lvl === 'warning' ? 'med' : 'low';
}

export function ruleIndex(run, { extensions = false } = {}) {
  const rules = {};
  for (const r of (run && run.tool && run.tool.driver && run.tool.driver.rules) || []) if (r && r.id) rules[r.id] = r;
  if (extensions) {
    for (const ext of (run && run.tool && run.tool.extensions) || []) {
      for (const r of (ext && ext.rules) || []) if (r && r.id) rules[r.id] = rules[r.id] || r;
    }
  }
  return rules;
}

// ── CWE, read from the rule the scanner already shipped ────────────────────
//
// WHY THIS IS HERE AND NOT IN A LANE. The scanners already ship CWEs on their rules (one semgrep
// SARIF can carry over a hundred distinct CWEs), and this module is the one SARIF reader every
// .sarif in this tree goes through. One reader, one extraction, and every consumer gets it for free
// rather than each lane inventing its own tag parsing.
//
// TWO CONVENTIONS, BOTH REAL:
//   CodeQL  properties.tags: ["external/cwe/cwe-079", ...]
//   semgrep properties.cwe:  "CWE-79: Improper Neutralization..."  (string OR array)
// Both are read. Neither is preferred; a rule may legitimately assert several.
//
// WHAT THIS DELIBERATELY DOES NOT DO: infer. If the rule asserts no CWE, the answer is an empty
// array and the finding's cwe stays absent. A CWE we assigned by guessing what a rule "probably"
// means is a fabricated citation with a MITRE identifier on it, which is worse than a blank —
// blank is honestly unknown, and a wrong CWE silently corrupts every Top-25 and ASVS rollup built
// on top of it. Assign what the source asserted; leave the rest unknown and say how many.
const CWE_TAG = /(?:^|\/)cwe-0*(\d+)\b/i;   // external/cwe/cwe-079 -> 79
const CWE_TXT = /\bCWE[-_ ]0*(\d+)\b/i;     // "CWE-79: ..."        -> 79

/** Canonical, deduped, sorted CWE ids a SARIF rule asserts. [] when it asserts none. */
export function cweOf(rule) {
  if (!rule || typeof rule !== 'object') return [];
  const found = new Set();
  const props = rule.properties || {};
  const take = (v, re) => {
    const m = re.exec(String(v ?? ''));
    if (m) found.add(`CWE-${Number(m[1])}`);   // Number() drops the zero padding: cwe-079 -> CWE-79
  };
  for (const t of Array.isArray(props.tags) ? props.tags : []) take(t, CWE_TAG);
  const c = props.cwe;
  for (const s of Array.isArray(c) ? c : (c == null ? [] : [c])) take(s, CWE_TXT);
  // Numeric sort, not lexical: CWE-79 must not sort after CWE-119.
  return [...found].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
}

/**
 * CWE ids for one result, via its rule. Returns { cwe, via } so a caller can tell
 * "the rule asserted none" from "we could not find the rule" — different facts, and the second
 * is a broken join rather than a clean absence.
 */
export function cweForResult(result, rules) {
  const id = result && (result.ruleId || (result.rule && result.rule.id));
  if (!id) return { cwe: [], via: 'no-rule-id' };
  const rule = rules && rules[id];
  if (!rule) return { cwe: [], via: 'rule-not-found' };
  const cwe = cweOf(rule);
  return { cwe, via: cwe.length ? 'rule-tags' : 'rule-asserts-none' };
}

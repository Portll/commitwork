// bin/lib/sarif-export.mjs — commitwork's own findings as SARIF 2.1.0, one log per scanned repository,
// for VS Code / JetBrains SARIF viewers and GitHub code scanning uploads. Reads the same run the brief
// reads: the dependency rows monitor/dep-findings.mjs parses and each issue lane's extractor rows.
//
// Only a measured finding with a crit/high/med/low severity becomes a `result`. An undetermined row
// goes to run.properties.commitwork.undetermined with its original claim, and a lane that did not
// measure goes to the invocation's toolExecutionNotifications: neither may render as a finding.
// partialFingerprints carry the line-free identity the issue store keys on; repeated occurrences of
// one identity are told apart by their order within it, never by the line itself.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { repoDepFindings } from '../../monitor/dep-findings.mjs';
import { SCANNER_SPECS, SCANNER_LABELS, TOTALS_EXCLUDE, kindOf } from '../../monitor/extractors.mjs';
import { scannerIdentityParts } from '../../monitor/issue-store.mjs';
import { writeAtomic } from '../../monitor/lockfile.mjs';
import { validateRemediation } from '../../lib/remediation-contract.mjs';
import { sarifFixes, remediationProperty } from '../../lib/sarif-remediation.mjs';

export const SARIF_VERSION = '2.1.0';
export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
export const SARIF_FILE = 'commitwork.sarif';
export const FINGERPRINT_KEY = 'commitworkIdentity/v1';

const LEVEL = Object.freeze({ crit: 'error', high: 'error', med: 'warning', low: 'note' });
// Same lane selection as the brief: issue kinds only, and no lane another lane already counts.
const ISSUE_KINDS = new Set(['vulnerability', 'posture', 'integrity']);
const NOT_SUMMED = new Set(TOTALS_EXCLUDE);
const VOID_FLAGS = ['nosrc', 'unparseable', 'norules', 'neverran', 'toolfailed'];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Repo-relative forward-slash path, or '' when the path cannot be placed inside the repository. */
// The row schema strips `file:///`, so an absolute URI can arrive as `Users/…/repo/x.js`: matched
// against the repo root with its leading slash dropped. Anything absolute and outside it has no place.
export function repoRelative(path, repoRoot) {
  let p = String(path || '').replace(/\\/g, '/');
  const hadScheme = /^file:/i.test(p);
  p = p.replace(/^file:\/*/i, '');
  const root = repoRoot && isAbsolute(repoRoot) ? String(repoRoot).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '') : '';
  const bare = p.replace(/^\/+/, '');
  if (root && bare.startsWith(`${root}/`)) return bare.slice(root.length + 1);
  if (hadScheme || p.startsWith('/') || /^[A-Za-z]:\//.test(p)) return '';
  p = p.replace(/^(\.\/)+/, '');
  return !p || p === '..' || p.startsWith('../') ? '' : p;
}

const ruleNameOf = (r) => String(r.rule || r.id || r.detector || r.check || '');
const messageOf = (r, fallback) => String(r.message || r.title || r.verificationError || '') || fallback;

function laneEntries(row, dir) {
  const out = { findings: [], undetermined: [], notes: [], suppressed: 0 };
  for (const [category, checkId, fn] of SCANNER_SPECS) {
    if (NOT_SUMMED.has(category) || !ISSUE_KINDS.has(kindOf(category))) continue;
    const cell = row.cells[checkId];
    if (!cell || cell.sev === 'skip' || cell.sev === 'noscan') continue;
    let c;
    try { c = fn(dir); } catch (e) {
      out.notes.push({ id: checkId, level: 'warning', text: `${checkId}: its report could not be read for export (${e.message}); its findings are not in this log` });
      continue;
    }
    if (c) {
      out.suppressed += (c.suppressed && c.suppressed.total) || 0;
      const flag = VOID_FLAGS.find((f) => c[f]);
      if (flag) out.notes.push({ id: checkId, level: 'warning', text: `${checkId}: the lane did not measure (${flag})` });
      if (c.truncated) out.notes.push({ id: checkId, level: 'warning', text: `${checkId}: ${c.truncated} finding row(s) beyond the extractor's cap are not in this log` });
    }
    const rows = c && Array.isArray(c.findings) ? c.findings : [];
    if (!rows.length && (cell.sev === 'high' || cell.sev === 'med')) {
      out.notes.push({ id: checkId, level: 'warning', text: `${checkId}: the lane reported ${cell.sev} findings (${cell.summary || ''}) but published no rows to export` });
    }
    for (const r of rows) {
      const ruleName = ruleNameOf(r);
      const ruleId = ruleName ? `${category}/${ruleName}` : category;
      const { parts } = scannerIdentityParts(r, category);
      const entry = { ruleId, category, checkId, ruleName, sev: String(r.sev || ''),
        file: r.file || r.path || '', line: Number(r.line) || 0, message: messageOf(r, ruleId),
        identity: parts.length ? `sc|${category}|${parts.join('|')}` : '' };
      if (LEVEL[entry.sev]) out.findings.push(entry);
      else out.undetermined.push({ ...entry, claimed: r.claimedSeverity || null, reason: r.why || r.undeterminedReason || r.unknownReason || '' });
    }
  }
  return out;
}

function depEntries(dir) {
  const { findings, state } = repoDepFindings(dir);
  const out = { findings: [], undetermined: [], notes: [] };
  for (const [tool, s] of Object.entries(state).sort(([a], [b]) => cmp(a, b))) {
    if (s !== 'ok' && s !== 'absent') out.notes.push({ id: `deps-${tool}`, level: 'warning', text: `deps-${tool}: the advisory report is ${s}; its findings are not in this log` });
  }
  for (const f of findings) {
    const ruleId = `deps/${f.id}`;
    // f:<repo>|<tool>|<advisory>|<package>|<path> in the issue store; the repo is the log itself.
    const entry = { ruleId, category: 'deps', checkId: `deps-${f.tool}`, ruleName: f.id, sev: String(f.severity || ''),
      file: f.path || '', line: 0, message: `${f.package}${f.version ? `@${f.version}` : ''}: ${f.title || f.id}${f.fixed ? ` (fixed in ${f.fixed})` : ''}`,
      identity: `f|${f.tool}|${f.id}|${f.package}|${f.path || ''}`, helpUri: f.advisory || '', title: f.title || '' };
    if (!f.undetermined && LEVEL[entry.sev]) out.findings.push(entry);
    else out.undetermined.push({ ...entry, claimed: f.claimedSeverity || null, reason: f.undeterminedReason || f.unknownReason || '' });
  }
  return out;
}

const sortEntries = (xs) => xs.sort((a, b) => cmp(a.ruleId, b.ruleId) || cmp(String(a.file), String(b.file))
  || a.line - b.line || cmp(a.message, b.message));

const byIdentityThenOccurrence = (a, b) => cmp(a.identity, b.identity) || a.occurrence - b.occurrence;

// A remediation document is only usable against the scan it was made for: a malformed one is an
// error, and a fix verified against another repository or commit is not a fix for this one.
function checkRemediation(remediation, row) {
  const { errors } = validateRemediation(remediation);
  if (errors.length) {
    const shown = errors.slice(0, 3).join('; ');
    const more = errors.length > 3 ? `; and ${errors.length - 3} more` : '';
    throw new Error(`remediation.json for ${row.slug} is invalid: ${shown}${more}`);
  }
  if (remediation.repository !== row.slug) {
    throw new Error(`remediation.json for ${row.slug} names repository ${JSON.stringify(remediation.repository)}, not ${JSON.stringify(row.slug)}`);
  }
  if (remediation.commit != null && row.commit != null && remediation.commit !== row.commit) {
    throw new Error(`remediation.json for ${row.slug} names commit ${JSON.stringify(remediation.commit)}, not ${JSON.stringify(row.commit)}`);
  }
}

/**
 * One SARIF log for one repository of a finished run.
 * row: { repo, slug, commit?, cells } as scan.json records it; dir: that repo's report directory.
 * remediation: a commitwork.remediation/1 document, or null. Findings join results on the
 * (identity, occurrence) pair the fingerprint hashes, never on a line or a path.
 */
export function buildRepoSarif({ row, dir, toolVersion, generatedAt, remediation = null }) {
  if (remediation !== null) checkRemediation(remediation, row);
  const lanes = laneEntries(row, dir);
  const deps = depEntries(dir);
  const findings = sortEntries([...deps.findings, ...lanes.findings]);
  const undetermined = sortEntries([...deps.undetermined, ...lanes.undetermined]);

  const notes = [...deps.notes, ...lanes.notes];
  for (const [checkId, cell] of Object.entries(row.cells || {}).sort(([a], [b]) => cmp(a, b))) {
    if (cell.sev === 'noscan') notes.push({ id: checkId, level: 'warning', text: `${checkId}: did not measure — ${cell.summary || 'no reason recorded'}` });
    else if (cell.sev !== 'skip' && (cell.coverage === 'reduced' || cell.coverage === 'unknown')) {
      notes.push({ id: checkId, level: 'note', text: `${checkId}: ran with ${cell.coverage} coverage${cell.coverageReason ? ` — ${cell.coverageReason}` : ''}; its findings are a floor` });
    }
  }
  if (remediation !== null) {
    for (const n of remediation.notMeasured) {
      notes.push({ id: n.lane, level: 'note', text: `${n.lane}: remediation did not measure — ${n.reason}` });
    }
  }
  notes.sort((a, b) => cmp(a.id, b.id) || cmp(a.text, b.text));

  const rules = new Map();
  for (const f of findings) {
    if (rules.has(f.ruleId)) continue;
    const kind = f.category === 'deps' ? 'vulnerability' : kindOf(f.category);
    rules.set(f.ruleId, {
      id: f.ruleId,
      shortDescription: { text: f.category === 'deps' ? (f.title || f.ruleName) : `${SCANNER_LABELS[f.category] || f.category}: ${f.ruleName || f.category}` },
      ...(f.helpUri ? { helpUri: f.helpUri } : {}),
      properties: { category: f.category, lane: f.checkId, kind, tags: ['security', kind] },
    });
  }
  const ruleIds = [...rules.keys()].sort(cmp);
  const ruleIndex = new Map(ruleIds.map((id, i) => [id, i]));

  const seen = new Map();
  const resultsByIdentity = new Map();
  const results = findings.map((f) => {
    const uri = repoRelative(f.file, row.repo);
    const result = { ruleId: f.ruleId, ruleIndex: ruleIndex.get(f.ruleId), level: LEVEL[f.sev], message: { text: f.message } };
    if (uri) {
      result.locations = [{ physicalLocation: { artifactLocation: { uri, uriBaseId: '%SRCROOT%' },
        ...(f.line > 0 ? { region: { startLine: f.line } } : {}) } }];
    }
    if (f.identity) {
      const h = sha(f.identity);
      const n = seen.get(h) || 0;
      seen.set(h, n + 1);
      const fingerprint = `${h}:${n}`;
      result.partialFingerprints = { [FINGERPRINT_KEY]: fingerprint };
      resultsByIdentity.set(fingerprint, result);
    }
    result.properties = { severity: f.sev, lane: f.checkId };
    return result;
  });

  const remediationUnmatched = [];
  const remediationUnprojectable = [];
  if (remediation !== null) {
    for (const finding of remediation.findings) {
      const result = resultsByIdentity.get(`${sha(finding.identity)}:${finding.occurrence}`);
      if (!result) {
        remediationUnmatched.push({ identity: finding.identity, occurrence: finding.occurrence });
        continue;
      }
      const property = remediationProperty(finding);
      if (property !== null) result.properties.commitwork = { remediation: property };
      const projected = sarifFixes(finding);
      if (projected.fixes.length) result.fixes = projected.fixes;
      for (const u of projected.unprojectable) {
        remediationUnprojectable.push({ identity: finding.identity, occurrence: finding.occurrence, path: u.path, reason: u.reason });
      }
    }
    remediationUnmatched.sort(byIdentityThenOccurrence);
    remediationUnprojectable.sort((a, b) => byIdentityThenOccurrence(a, b)
      || cmp(String(a.path), String(b.path)) || cmp(a.reason, b.reason));
  }

  const commitworkProperties = {
    repository: row.slug,
    commit: row.commit || null,
    suppressedInSource: lanes.suppressed,
    undetermined: undetermined.map((u) => ({ ruleId: u.ruleId, lane: u.checkId, file: repoRelative(u.file, row.repo) || null,
      line: u.line || null, message: u.message, claimedSeverity: u.claimed || (u.sev || null), reason: u.reason })),
  };
  if (remediation !== null) {
    commitworkProperties.remediationUnmatched = remediationUnmatched;
    commitworkProperties.remediationUnprojectable = remediationUnprojectable;
  }

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [{
      tool: { driver: { name: 'commitwork', version: toolVersion, semanticVersion: toolVersion, rules: ruleIds.map((id) => rules.get(id)) } },
      automationDetails: { id: `commitwork/${generatedAt}` },
      invocations: [{
        executionSuccessful: !notes.some((n) => n.level === 'warning'),
        endTimeUtc: generatedAt,
        toolExecutionNotifications: notes.map((n) => ({ descriptor: { id: n.id }, level: n.level, message: { text: n.text } })),
      }],
      columnKind: 'utf16CodeUnits',
      results,
      properties: { commitwork: commitworkProperties },
    }],
  };
}

/** The version tool.driver reports: this checkout's package.json, read when asked. */
export function commitworkVersion() {
  return JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version;
}

// A run without remediation.json is the normal case; any other read or parse failure is an error,
// never an absent document.
function readRemediation(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(`remediation.json is not JSON: ${path} (${e.message})`); }
  if (doc === null) throw new Error(`remediation.json holds null, not a document: ${path}`);
  return doc;
}

/**
 * Write one log per repository of a run. `file` writes the single repository's log there instead and
 * refuses a run of more than one. Returns [{ slug, path, results, undetermined, notMeasured, fixes,
 * remediationUnmatched }]; the last two are null for a repository with no remediation document.
 */
export function writeRunSarif({ runDir, rows, toolVersion, generatedAt, file = null }) {
  const ordered = [...rows].sort((a, b) => cmp(a.slug, b.slug));
  if (file && ordered.length !== 1) throw new Error(`a single SARIF file holds one repository; this run has ${ordered.length}`);
  // Every log is built before any is written, so a refused repository leaves no partial run behind.
  const built = ordered.map((row) => {
    const dir = join(runDir, row.slug);
    const remediation = readRemediation(join(dir, 'remediation.json'));
    return { row, measured: remediation !== null, doc: buildRepoSarif({ row, dir, toolVersion, generatedAt, remediation }) };
  });
  return built.map(({ row, measured, doc }) => {
    const path = file || join(runDir, row.slug, SARIF_FILE);
    writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`, { mkdir: true });
    const run = doc.runs[0];
    return { slug: row.slug, path, results: run.results.length, undetermined: run.properties.commitwork.undetermined.length,
      notMeasured: run.invocations[0].toolExecutionNotifications.length,
      fixes: measured ? run.results.filter((r) => r.fixes).length : null,
      remediationUnmatched: measured ? run.properties.commitwork.remediationUnmatched.length : null };
  });
}

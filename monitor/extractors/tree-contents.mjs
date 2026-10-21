// monitor/extractors/tree-contents.mjs — what a source tree CONTAINS besides source it owns.
//
// Three lanes, each reading one of this repository's own detectors: vendored third-party copies
// (bin/vendor-scan.mjs, vendorAssets), unfinished-work markers (bin/stub-detect.mjs, stubs), and
// minified or obfuscated code (bin/minify-detect.mjs, minifiedCode). They are grouped by what they
// look AT, not by what they claim: LANE_KINDS gives them three different kinds (vulnerability,
// hygiene, integrity), which is why this module is not called hygiene.
//
// A fourth lane reads bin/model-artefacts.mjs (modelArtefacts): pickle globals, safetensors
// headers, dataset loader configs and hub loads — files in the tree that execute when loaded.
//
// A fifth reads bin/webshell-detect.mjs (webshell): server code hidden in encoded layers, request
// input wired straight to an execution sink, code under upload directories and php-lock .htaccess.
// A sixth reads bin/log-evidence.mjs (logEvidence): attacks the tree's own log files recorded.
// A seventh reads bin/yara-witness.mjs (yaraWitness): community YARA rules as webshell's second witness.
// An eighth reads bin/tree-integrity.mjs (treeIntegrity): the tree compared with its own records, a
// deployed checkout's committed tree and each installed Python package's RECORD.
//
// Keep the order vendor, stubs, minify: minify's "Unlike stubs" reads against its neighbour.
// monitor/extractors.mjs re-exports every public name here.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyWorktreePath } from '../worktree-paths.mjs'; // an agent worktree is this repo counted twice
import { _zero, _emptyArtifact, _detailFor, capMessage, _wtBucket, _setAsideWorktree, _worktreesOf } from './core.mjs';

// bin/vendor-scan.mjs writes {ran, skipped, reason, summary, findings[], unidentified[]}.
// ran:false is honoured as a VOID, never a zero: an unreachable advisory database and a clean one
// are the same empty array, and only the flag tells them apart. `unidentified` rides in the counts
// so the panel can say "0 findings, N files nothing could identify" instead of a bare clean.
export function _vendorCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (j && j.ran === false) return { ..._zero(), ran: false, noscan: true, reason: j.reason || null };
  const arr = (j && Array.isArray(j.findings)) ? j.findings : [];
  const map = { critical: 'crit', crit: 'crit', high: 'high', moderate: 'med', medium: 'med', med: 'med', low: 'low' };
  const rows = arr.map((f) => ({ package: f && f.package, version: f && f.version, file: f && f.file,
    id: f && f.id, sev: map[String((f && f.severity) || '').toLowerCase()] || '',
    severitySource: String((f && f.severitySource) || ''),
    severityReason: String((f && f.severityReason) || ''),
    cvssVia: String((f && f.cvssVia) || ''), cwe: String((f && f.cwe) || ''),
    cwePillar: String((f && f.cwePillar) || ''), capec: String((f && f.capec) || ''),
    capecVia: String((f && f.capecVia) || ''), attack: String((f && f.attack) || ''),
    attackTactic: String((f && f.attackTactic) || ''), capecReason: String((f && f.capecReason) || ''),
    summary: f && f.summary }));
  const t = { ..._zero(), ran: true, total: arr.length, undetermined: 0,
    unidentified: (j.unidentified || []).length };
  // Ungradable lands in `undetermined`, never nowhere, so the split always sums to `total`.
  for (const r of rows) { if (t[r.sev] !== undefined) t[r.sev] += 1; else t.undetermined += 1; }
  return { ...t, ..._detailFor('vendorAssets', rows) };
}

// stub-detect is OURS (bin/stub-detect.mjs) and writes {summary, findings:[{type, marker, severity,
// path, line, detail}]}. It is usually the largest category by row count. It stays out of the
// severity headline (TOTALS_EXCLUDE: a TODO is not a vulnerability); being out of the headline is
// not a reason to be unreadable, so it carries a drill-down.
export function _stubCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  const all = (j && Array.isArray(j.findings)) ? j.findings : [];
  // CONTEXT SPLIT. bin/stub-detect.mjs tags each row `comment` or `code`: a stub marker is a note
  // somebody left, and the same WORD appearing in an identifier, a string or a JSX prop is not one
  // (in an app with a to-do feature, `todo` is a domain noun).
  //
  // A row with NO `context` key is a VINTAGE artifact from before the split, and is counted as a
  // finding exactly as it was: re-rolling an old batch must still produce its original answer, and
  // silently reinterpreting old evidence under a new rule would make corrected-history a fiction.
  // Only `context === 'code'` moves.
  const arr = all.filter((f) => !f || f.context !== 'code');
  const codeRows = all.filter((f) => f && f.context === 'code');
  const map = { critical: 'crit', high: 'high', medium: 'med', med: 'med', low: 'low' };
  const rows = arr.map((f) => ({ marker: f && (f.marker || f.type), file: f && f.path, line: f && f.line,
    sev: map[String((f && f.severity) || '').toLowerCase()] || 'high', message: f && f.detail }));
  // COUNTS ARE DERIVED FROM THE ROWS, never asserted beside them: a bucket computed independently
  // of the per-row `sev` is free to disagree with it, and deriving the buckets makes that
  // disagreement unrepresentable.
  const bySev = { crit: 0, high: 0, med: 0, low: 0 };
  for (const r of rows) if (r.sev in bySev) bySev[r.sev] += 1;
  // Never dropped: the code-context rows are counted under `undetermined`, outside crit/high/med/
  // low, the same routing cspm and advisory-reach use for a claim that is real evidence but not a
  // finding. `codeContextNote` travels so the gap is stated where it is read, not only where it is
  // produced.
  const out = { ..._zero(), ran: true, total: arr.length, ...bySev, ..._detailFor('stubs', rows) };
  if (codeRows.length) {
    out.undetermined = (out.undetermined || 0) + codeRows.length;
    out.codeContextNote = `${codeRows.length} row(s) matched a marker WORD outside any comment — an identifier, a string or a prop, not a note. Counted apart rather than published as unfinished work.`;
  }
  return out;
}

// bin/minify-detect.mjs writes {tool, summary:{findings, byRule, filesScanned, filesSkipped, config},
// findings:[{rule, path, sev, capped, metrics, detail}]}. Unlike stubs this lane carries mixed
// severities (per-rule) and IS security-relevant, so it tallies each row's sev rather than folding
// all to high, and it is NOT in TOTALS_EXCLUDE. filesScanned===0 is a declared void, not a clean
// zero: a walk that matched nothing must not read as examined-and-clean.
export function _minifyCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || !j.summary || !Array.isArray(j.findings)) return { ..._zero(), ran: true, unparseable: true };
  if ((j.summary.filesScanned || 0) === 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true };
  const bucket = { crit: 'crit', critical: 'crit', high: 'high', med: 'med', medium: 'med', low: 'low' };
  // minified-source counts as undetermined, not med — readability is coverage, not a verdict, and
  // its `maxLine > 1000` clause fires on any long template literal. Claim preserved.
  const UNDETERMINED_RULES = new Set(['minified-source']);
  // byName as well as byPattern, so this matches worktree-paths.partition()'s report shape — one
  // concept must not have two shapes that are free to disagree (see the stubs bucket above).
  const wt = { crit: 0, high: 0, med: 0, low: 0, total: 0, byPattern: {}, byName: {}, rows: [] };
  // minify-detect marks rows where it matched its OWN pattern definitions. Set aside with severity
  // intact and enumerable, same contract as `worktrees` — the producer decides, we do not re-derive
  // the path list here (two authorities over one publication decision is how they drift apart).
  const sr = { crit: 0, high: 0, med: 0, low: 0, total: 0, byFile: {}, rows: [] };
  let undetermined = 0;
  const rows = [];
  for (const f of (j.findings || [])) {
    const file = (f && f.path) || '';
    const m = (f && f.metrics) || {};
    const metric = `entropy=${m.entropy} ws=${m.wsRatio} maxline=${m.bytesPerLineMax}`;
    const raw = bucket[String((f && f.sev) || '').toLowerCase()] || 'med';
    if (f && f.selfReference) {
      sr[raw]++; sr.total++;
      sr.byFile[file] = (sr.byFile[file] || 0) + 1;
      sr.rows.push({ rule: f && f.rule, file, sev: raw, why: String(f.selfReference) });
      continue;
    }
    const cls = classifyWorktreePath(file);
    if (cls.worktree) {
      // Set aside with its severity intact — this row is not judged, it is addressed to another
      // copy of this repo. Enumerable in `worktrees.rows`, untouched in minify.json on disk.
      wt[raw]++; wt.total++;
      wt.byPattern[cls.pattern] = (wt.byPattern[cls.pattern] || 0) + 1;
      wt.byName[cls.name] = (wt.byName[cls.name] || 0) + 1;
      wt.rows.push({ rule: f && f.rule, file, sev: raw, pattern: cls.pattern, name: cls.name, why: cls.why });
      continue;
    }
    const grey = UNDETERMINED_RULES.has(f && f.rule);
    // sev '' is the schema's legal no-severity value; giving one back would be the assertion again.
    const sev = grey ? '' : raw;
    if (grey) undetermined++; else { c[sev]++; c.total++; }
    rows.push({
      rule: f && f.rule, file, sev, capped: !!(f && f.capped), metric,
      message: grey
        ? `UNDETERMINED — unreadable is a coverage fact, not a vulnerability; this file was measured, not judged. minify-detect reported: ${String((f && f.detail) || '').slice(0, 160)}`
        : f && f.detail,
    });
  }
  if (undetermined) c.undetermined = undetermined;
  // Stated as a fraction, so a shrinking published count is visible rather than merely true.
  const scanned = c.total + undetermined + wt.total + sr.total;
  if (wt.total) {
    c.worktrees = { ...wt, of: scanned, note: `${wt.total} of ${scanned} rows are the same files re-scanned through an agent worktree under .claude/worktrees/ and are excluded from these counts. They remain in minify.json on disk. Set CW_WORKTREE_PATHS=off to count them.` };
  }
  if (sr.total) {
    c.selfReference = { ...sr, of: scanned, note: `${sr.total} of ${scanned} rows are minify-detect matching its own pattern definitions — the literals in its comments and fixtures ARE the rules — and are excluded from these counts. They remain in minify.json on disk. Readability, bidi and packer rules stay live on those files.` };
  }
  // Recorded skips must have a reader, or "no silent size drop" becomes a silent drop one hop
  // later. Surface the count alongside the standard buckets.
  const skipped = Array.isArray(j.summary.filesSkipped) ? j.summary.filesSkipped.length : 0;
  return { ...c, ...(skipped ? { skipped } : {}), ..._detailFor('minifiedCode', rows) };
}

// bin/model-artefacts.mjs — pickle globals, safetensors headers, dataset loader configs, hub loads.
// Severity is per rule and read from the row; a row with no legal sev is `undetermined`, never
// given one. filesScanned === 0 is a void (no model, dataset or hub surface in the tree). A
// non-zero `unreadable` or `skippedOversize` is carried through as a declared partial read.
export function _modelArtefactsCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'model-artefacts' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const row = { rule, file: String(f.path || ''), line: Number(f.line) || 0, sev,
      cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  const unreadable = Number(j.summary.unreadable) || 0;
  const oversize = Number(j.summary.skippedOversize) || 0;
  if (unreadable || oversize) {
    c.partial = { unreadable, skippedOversize: oversize,
      note: `${unreadable} file(s) had a magic the walker could not read and ${oversize} exceeded CW_MODEL_MAX_BYTES; none of them was judged, so these counts are a floor.` };
  }
  return { ...c, ..._detailFor('modelArtefacts', rows) };
}

// bin/webshell-detect.mjs — web shells, encoded droppers, code in upload directories and the locks
// an intruder leaves. Severity is per row (a decoded layer that holds a sink is crit, the same rule
// without one is high), so it is read from the row and never re-derived here. filesScanned === 0 is
// a void; an unreadable file is a declared partial read. A file over the cap was examined in
// windows rather than skipped, so it is carried as `windowed`, not as a partial read.
export function _webshellCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'webshell-detect' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const row = { rule, file: String(f.path || ''), sev, cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  const windowed = Number(j.summary.windowed) || 0;
  if (windowed) c.windowed = windowed;
  const unreadable = Number(j.summary.unreadable) || 0;
  if (unreadable) {
    c.partial = { unreadable,
      note: `${unreadable} file(s) could not be read and none of them was judged, so these counts are a floor.` };
  }
  return { ...c, ..._detailFor('webshell', rows) };
}

// bin/log-evidence.mjs — attacks the tree's own logs recorded. Severity is per row (low when every
// recorded response refused the attempt), read from the row. filesScanned counts LOG files, so 0 is
// a void — no logs to read — and never a clean result; an unreadable log is a declared partial read.
export function _logEvidenceCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'log-evidence' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const row = { rule, file: String(f.path || ''), lines: Number(f.lines) || 0, first: String(f.first || ''), last: String(f.last || ''),
      sev, cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  const unreadable = Number(j.summary.unreadable) || 0;
  if (unreadable) {
    c.partial = { unreadable, note: `${unreadable} log file(s) could not be read and none of them was judged, so these counts are a floor.` };
  }
  return { ...c, ..._detailFor('logEvidence', rows) };
}

// bin/yara-witness.mjs — the second witness for webshell. Severity is per row. filesScanned 0 is a
// void whose reason the report names (yara-x absent, rule packs absent or off their pins); a partial
// read is carried through. The divergence block rides along so the panel can show where the two
// witnesses disagree without re-deriving it.
export function _yaraWitnessCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'yara-witness' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const row = { rule, file: String(f.path || ''), sev, cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  const d = j.summary.divergence;
  if (d && typeof d === 'object') {
    c.divergence = { both: Number(d.both) || 0, yaraOnly: Number(d.yaraOnly && d.yaraOnly.count) || 0, detectOnly: Number(d.detectOnly && d.detectOnly.count) || 0 };
  }
  // a pack measured to be noise reports its matches here, outside crit/high/med/low, claim kept
  const und = j.summary.undetermined;
  if (und && typeof und === 'object' && Number(und.count) > 0) c.undetermined = (c.undetermined || 0) + Number(und.count);
  if (j.summary.partial === true) {
    const reasons = Array.isArray(j.summary.partialReasons) ? j.summary.partialReasons.map(String) : [];
    c.partial = { reasons, note: `yara-x read only part of its input (${reasons.join('; ') || 'reason unstated'}), so these counts are a floor.` };
  }
  return { ...c, ..._detailFor('yaraWitness', rows) };
}

// bin/tree-integrity.mjs — the tree against the records that say what it should hold. Severity is per
// row (by what the differing file is), read from the row. `applicable:false` is a repository with no
// installed package and no web-root mode: nothing-to-compare, nosrc with the lane's own reason, as a
// repo without a Gradle wrapper is. filesScanned 0 otherwise is a void, and a partial read (git drift
// unmeasured, a RECORD line unreadable) is carried through as a floor.
export function _treeIntegrityCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'tree-integrity' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  if (j.summary.applicable === false && !j.findings.length) {
    return { ..._zero(), ran: true, nosrc: true, reason: String(j.summary.notApplicableReason || 'no record to compare in this tree') };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true, ...(j.summary.voidReason ? { reason: String(j.summary.voidReason) } : {}) };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const row = { rule, file: String(f.path || ''), sev, cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  if (Array.isArray(j.summary.rulesNotApplicable) && j.summary.rulesNotApplicable.length) c.rulesNotApplicable = j.summary.rulesNotApplicable.map(String);
  if (j.summary.partial === true) {
    const reasons = Array.isArray(j.summary.partialReasons) ? j.summary.partialReasons.map(String) : [];
    c.partial = { reasons, note: `part of the tree was not compared with its record (${reasons.join('; ').slice(0, 300) || 'reason unstated'}), so these counts are a floor.` };
  }
  return { ...c, ..._detailFor('treeIntegrity', rows) };
}

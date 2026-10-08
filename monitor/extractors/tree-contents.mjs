// monitor/extractors/tree-contents.mjs — what a source tree CONTAINS besides source it owns.
//
// Lifted unchanged from monitor/extractors.mjs on 2026-09-23. Three lanes, each reading one of this
// repository's own detectors: vendored third-party copies (bin/vendor-scan.mjs, vendorAssets),
// unfinished-work markers (bin/stub-detect.mjs, stubs), and minified or obfuscated code
// (bin/minify-detect.mjs, minifiedCode). They are grouped by what they look AT, not by what they
// claim: LANE_KINDS gives them three different kinds (vulnerability, hygiene, integrity), which is
// why this module is not called hygiene.
//
// A fourth lane reads bin/model-artefacts.mjs (modelArtefacts): pickle globals, safetensors
// headers, dataset loader configs and hub loads — files in the tree that execute when loaded.
//
// ONE COMMENT MOVED. The "stub-detect is OURS" note had been stranded above vendor-scan's note and
// _vendorCounts, while _stubCounts itself carried no comment at all. It now sits on _stubCounts.
// Function order is the original's (vendor, stubs, minify), so minify's "Unlike stubs" still reads
// against its neighbour. Every line is byte-identical; only that one paragraph changed position.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

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
  // Ungradable lands in `undetermined`, never nowhere: 'unknown' matched no bucket, so 35 of 37 rows
  // left `total` standing over a split summing to 2.
  for (const r of rows) { if (t[r.sev] !== undefined) t[r.sev] += 1; else t.undetermined += 1; }
  return { ...t, ..._detailFor('vendorAssets', rows) };
}

// stub-detect is OURS (bin/stub-detect.mjs) and writes {summary, findings:[{type, marker, severity,
// path, line, detail}]}. It is the LARGEST category in the fleet — 4,283 findings, an order of
// magnitude above anything else — and it has never had a drill-down, so it existed only as a number
// nobody could act on. It stays out of the severity headline (TOTALS_EXCLUDE: a TODO is not a
// vulnerability); being out of the headline is not a reason to be unreadable.
//
// The counts stay byte-compatible with _countArray's convention — total = high = rows — so this
// change adds evidence without moving a single number.
export function _stubCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  const all = (j && Array.isArray(j.findings)) ? j.findings : [];
  // CONTEXT SPLIT (2026-08-28). bin/stub-detect.mjs now tags each row `comment` or `code`: a stub
  // marker is a note somebody left, and the same WORD appearing in an identifier, a string or a JSX
  // prop is not one. Both twins ship a to-do feature, so `todo` is a domain noun in their source —
  // measured before the split, memory-layer published 982 TODO rows of which 10 contained the CAPS word.
  //
  // A row with NO `context` key is a VINTAGE artifact from before the split, and is counted as a
  // finding exactly as it was. That is deliberate: re-rolling a 2026-07 batch must still produce
  // the 2026-07 answer, and silently reinterpreting old evidence under a new rule would make
  // corrected-history a fiction. Only `context === 'code'` moves.
  const arr = all.filter((f) => !f || f.context !== 'code');
  const codeRows = all.filter((f) => f && f.context === 'code');
  const map = { critical: 'crit', high: 'high', medium: 'med', med: 'med', low: 'low' };
  const rows = arr.map((f) => ({ marker: f && (f.marker || f.type), file: f && f.path, line: f && f.line,
    sev: map[String((f && f.severity) || '').toLowerCase()] || 'high', message: f && f.detail }));
  // COUNTS ARE DERIVED FROM THE ROWS, never asserted beside them. This was `high: arr.length`, a
  // hardcoded bucket computed independently of the per-row `sev` two lines above — two numbers from
  // one input, free to disagree, and they did: measured 2026-08-19, scanners.stubs read
  // {high: 4322, low: 0} fleet-wide while every one of those 4,322 rows carried sev 'low'. A
  // complete inversion, and the reason it was survivable is that TOTALS_EXCLUDE keeps the lane out
  // of the headline — unexcluded, 4,322 TODO markers would have landed in the fleet's HIGH count.
  // Deriving the buckets makes the disagreement unrepresentable rather than merely absent today.
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
// zero (Portll-security PS3): a walk that matched nothing must not read as examined-and-clean.
export function _minifyCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || !j.summary || !Array.isArray(j.findings)) return { ..._zero(), ran: true, unparseable: true };
  if ((j.summary.filesScanned || 0) === 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true };
  const bucket = { crit: 'crit', critical: 'crit', high: 'high', med: 'med', medium: 'med', low: 'low' };
  // fix: minified-source counts as undetermined, not med — readability is coverage, not a verdict.
  // As med it was 19 of 20 med rows (2026-08-25), and its `maxLine > 1000` clause fires on any long
  // template literal (timeline2.mjs:418 is an HTML legend). cspm precedent above; claim preserved.
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
  // later (Sauron S4). Surface the count alongside the standard buckets.
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

// monitor/extractors/sast-lint.mjs — per-language code scanners that read formats of their own.
//
// Lifted unchanged from monitor/extractors.mjs on 2026-09-23. Thirteen readers:
//   - SAST, kind `vulnerability`: joern, bearer, sobelow, bandit, brakeman, phpcs, and actionlint
//     (whose untrusted-input-in-`run:` finding is live script injection);
//   - lint, kind `hygiene`: clippy, hlint, PMD, deno lint, deno check, and shellcheck. All but
//     shellcheck are non-additive, kept out of the severity headline; shellcheck stays additive,
//     because SC2086-class quoting defects are injection.
//
// Beside them: rustfmt (formatRust, hygiene), and the COBOL readers — cobolwork's scan report for
// sastCobol, and its inventory for cobolCoverage.
// The scanners that emit SARIF (Semgrep, CodeQL, gosec, golangci-lint, ruff, Psalm and others) read
// through ./sarif.mjs instead.
//
// The first comment below is the GRADUATION LEDGER: every lane here started as a stub that
// published a present artifact as unparseable, never as a count, until a parser was written
// against a real run. Its rule outlives the stub function it describes, which is why it travels
// at the head of this module.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParseFile } from '../safe-parse.mjs';
import { _zero, _emptyArtifact, _detailFor, capMessage } from './core.mjs';
import { classifyPath } from '../fixture-paths.mjs';

// A lane that is DECLARED but whose output shape nobody here has ever seen. joern, bearer, sobelow,
// clippy and hlint were added 2026-08-24 with all five wired here as stubs, because none of the
// binaries had run on this fleet and every claim about their JSON was documentation-derived.
// Writing a parser from documentation is how you get one that returns zero on a shape it did not
// recognise, and a zero from an unverified parser is indistinguishable from a clean repository —
// the defect this whole file is arranged against. So: an absent artifact is absent, and a PRESENT
// one is `unparseable` until a parser is written against real output. That publishes as
// undetermined, never as a count and never as clean.
// Status 2026-08-26: clippy graduated — cargo-clippy is installed here and _clippyCounts below was
// written against real fold output from scratch crates (clean / linted / compile-failed shapes).
// Status 2026-08-27: joern, bearer and sobelow graduated the same way — all three tools now
// installed on this box, all three parsers below written against real runs on scratch fixtures
// (findings / clean / failure shapes each; see the per-function comments for what the probes
// exposed, because in every case the real contract differed from the documented one). Later the
// same day, hlint graduated last (_hlintCounts below) and the stub itself (_unverifiedShape,
// which returned `unparseable` for ANY present artifact) was retired with zero consumers. THE
// RULE OUTLIVES THE FUNCTION: a new lane whose output nobody here has read gets a stub of the
// same shape — absent is null, present is unparseable, never a count and never clean — until a
// parser is written against a real run. Every probe in this ledger found the real contract
// differing from the documented one, which is the whole argument.
// clippy's parser, written against REAL output (2026-08-26, scratch crates on this box's
// toolchain — the check's formatNotes hold the fold contract, verified 2026-08-23). The artifact
// is the FOLD's product, `{tool:'clippy', diagnostics:[{code,level,message,file,line}]}` — the
// wrapper key is the proof the fold ran, so a body without it is unparseable, never zero.
// Level mapping: `error` → med, `warning` → low; `failure-note`/`note`/`help` lines are
// explanations, not findings, and are not counted. rustc's own lints (unused_variables and
// friends) share the stream with clippy:: lints and stay counted under their own codes — the
// artifact is "compiler diagnostics under the clippy invocation", and dropping them would be a
// filter nobody declared. LANE_KINDS keeps all of it out of the severity headline (hygiene,
// not-a-vulnerability) — a lint count must not wear a vulnerability verdict.
// THE EXIT SIDECAR IS THE SECOND WITNESS, orthogonal to the parse: a non-zero exit with no
// clippy:: diagnostic means the compile died before the lint pass could finish (the --offline
// cold-registry case, or a broken crate) — that run reads toolfailed, never clean, whatever
// partial rustc errors it managed to emit. A non-zero exit WITH clippy:: diagnostics is the
// deny(warnings) shape: the lint DID run and its findings are real, so they count. A missing
// sidecar is a pre-sidecar vintage — health unknown, the parse decides alone.
export function _clippyCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;          // absent is absent — the lane did not produce
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || j.tool !== 'clippy' || !Array.isArray(j.diagnostics)) return { ..._zero(), ran: true, unparseable: true };
  let exit = 0;
  try { exit = parseInt(readFileSync(`${p}.exit`, 'utf8').trim(), 10) || 0; } catch { /* no sidecar: vintage artifact */ }
  const lintRan = j.diagnostics.some((d) => typeof d.code === 'string' && d.code.startsWith('clippy::'));
  if (exit !== 0 && !lintRan) return { ..._zero(), ran: true, toolfailed: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const d of j.diagnostics) {
    const b = d.level === 'error' ? 'med' : d.level === 'warning' ? 'low' : null;
    if (!b) continue;                       // failure-note / note / help — explanation, not finding
    c[b]++; c.total++;
    rows.push({ rule: d.code || 'clippy', file: d.file || '', line: Number(d.line) || 0, sev: b, message: capMessage(d.message || '') });
  }
  return { ...c, ..._detailFor('lintRust', rows) };
}
// rustfmt: one row per deviating FILE, never per hunk — a reformat moves every hunk line, and the
// identity is rule+file. Severity is the repo's own declaration: `med` where its CI or a
// rustfmt.toml gates on the formatter (the build it ships will fail), `low` where it never adopted
// it. bin/rustfmt-lane-scan.mjs deletes the report when no root produced a check result, so a
// present artifact always ran; `partial` marks roots that failed or files rustfmt could not parse.
export function _rustfmtCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || j.tool !== 'rustfmt' || !Array.isArray(j.files) || !Array.isArray(j.parseErrors)) return { ..._zero(), ran: true, unparseable: true };
  const sev = j.declared ? 'med' : 'low';
  const gate = j.declared ? `the repo gates on it (${j.declared})` : 'the repo does not declare rustfmt';
  const c = { ..._zero(), ran: true, ...(j.partial ? { partial: true } : {}) };
  const rows = [];
  for (const f of j.files) {
    c[sev]++; c.total++;
    rows.push({ rule: 'rustfmt', file: String(f.file || ''), line: Number(f.firstLine) || 0, sev,
      message: capMessage(`${Number(f.hunks) || 0} hunk(s) differ from ${j.version || 'rustfmt'}; ${gate}`) });
  }
  for (const e of j.parseErrors) {
    c[sev]++; c.total++;
    rows.push({ rule: 'rustfmt/parse-error', file: String(e.file || ''), line: 0, sev, message: capMessage(String(e.message || '')) });
  }
  return { ...c, ..._detailFor('formatRust', rows) };
}

// hlint's parser, written against REAL output (2026-08-27, scratch modules on this box's hlint —
// the last stub to graduate). `--json` emits an ARRAY of hint objects {severity, hint, file,
// startLine, from, to, …}; severity is Error / Warning / Suggestion and maps med / low / low —
// a taste lint must not climb higher, and LANE_KINDS keeps all of it out of the headline anyway
// (hygiene, not-a-vulnerability).
// WHAT THE PROBE EXPOSED, once again differing from the docs: on a tree with NO Haskell sources
// hlint does not print an empty array — it CRASHES (exit 1, "Uncaught exception … ErrorCall")
// and the exception text lands in hlint.json via the redirect, so the artifact body is prose,
// not JSON. That body must read unparseable/toolfailed, never clean — which is exactly what the
// sidecar-plus-parse contract below yields. The gate (appliesIfSourceExt .hs/.lhs) makes the
// no-source run rare; the parser refuses it anyway, because gates and parsers must not share a
// failure mode.
export function _hlintCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;          // absent is absent — the lane did not produce
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let exit = 0;
  try { exit = parseInt(readFileSync(`${p}.exit`, 'utf8').trim(), 10) || 0; } catch { /* no sidecar: vintage artifact */ }
  let j; try { j = JSON.parse(raw); } catch {
    // The crash shape writes prose here; with a non-zero sidecar that is the tool dying, and with
    // a zero one it is still not a result. Either way: undetermined, never a count.
    return { ..._zero(), ran: true, ...(exit !== 0 ? { toolfailed: true } : { unparseable: true }) };
  }
  if (!Array.isArray(j)) return { ..._zero(), ran: true, unparseable: true };
  if (exit !== 0 && !j.length) return { ..._zero(), ran: true, toolfailed: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const h of j) {
    if (!h || typeof h !== 'object') continue;
    const b = h.severity === 'Error' ? 'med' : 'low';
    c[b]++; c.total++;
    rows.push({
      rule: String(h.hint || 'hlint'),
      file: String(h.file || '').replace(/^\.\//, ''),
      line: Number(h.startLine) || 0,
      sev: b,
      message: capMessage(h.from && h.to ? `${h.from} ⇒ ${h.to}` : String(h.from || h.hint || '')),
    });
  }
  return { ...c, ..._detailFor('lintHaskell', rows) };
}
// joern-scan's parser, written against REAL output (2026-08-27, joern 4.0.610 on scratch C
// sources). The probe rewrote the lane's whole contract: joern-scan 4.x has NO --format option —
// the manifest's original `--format json` produced 'Error: Unknown option' AND EXIT 0, a one-line
// husk that a zero-line parser would have read as clean. So the artifact is joern.txt: raw stdout,
// `Result: <score> : <title>: <file>:<line>:<method>` findings interleaved with [INFO] pass logs.
// THE SCAN-RAN GUARD IS THE POINT: a ScanPass marker (or at least one Result line) is required
// before ANY number is published, zero included — without it the husk shape reads unparseable
// (exit 0) or toolfailed (non-zero), never clean. Scores are the query authors' 0-10 scale and
// band CVSS-style: >=9 crit, >=7 high, >=4 med, else low (measured: gets()=8.0→high,
// non-constant printf format=4.0→med, unchecked malloc/read=3.0→low). The Result line names no
// query id, so the title is the rule — stable per query, and identity is [rule,file] per the
// house line-exclusion rule.
export function _joernScanCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;          // absent is absent — the lane did not produce
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let exit = 0;
  try { exit = parseInt(readFileSync(`${p}.exit`, 'utf8').trim(), 10) || 0; } catch { /* no sidecar: vintage artifact */ }
  // The artifact holds one section per language (bin/joern-lane.mjs), so a ScanPass anywhere in it
  // is NOT evidence that every language ran. The sidecar says which did; without it (a vintage
  // artifact) the whole-file reading below is all there is.
  const lane = _joernLaneRecord(dir);
  if (lane === 'unparseable') return { ..._zero(), ran: true, unparseable: true };
  if (lane) {
    const failed = lane.languages.filter((l) => l && l.reason);
    const scanned = lane.languages.filter((l) => l && l.scanRan && l.exit === 0);
    if (!scanned.length) return { ..._zero(), ran: true, toolfailed: true };
    const c = _joernResultCounts(raw);
    if (failed.length) {
      // The same marker the CodeQL lanes raise when a run read less than it claims: these counts are
      // real and their SILENCE about the failed languages is not evidence. `coverage` carries the
      // detail in the shape codeql-coverage.mjs produces, so one reader serves both.
      c.coverageIncomplete = true;
      c.coverage = {
        state: 'partial',
        languagesScanned: scanned.map((l) => l.id),
        languagesFailed: failed.map((l) => ({ language: l.id, reason: l.reason })),
        reason: `${failed.length} of ${lane.languages.length} language(s) never produced a scan pass (${failed.map((l) => l.id).join(', ')}), so this count covers ${scanned.map((l) => l.id).join(', ')} only. The lane's own exit is non-zero, so the run row carries the reason too.`,
      };
    }
    return c;
  }
  const lines = raw.split('\n');
  const results = lines.filter((l) => l.startsWith('Result: '));
  const scanRan = results.length > 0 || lines.some((l) => l.includes('ScanPass completed'));
  if (!scanRan) {
    // joern-scan's exit code lies — measured twice: an option error exits 0, and a failed CPG
    // frontend exits 0 (memory-layer, 2026-08-28: rust2cpg died on the missing rust_ast_gen-macos-arm,
    // '[ERROR] Process exited with code 1.' in the artifact, sidecar 0). So on a scanless
    // artifact the error MARKER is the witness the exit code refuses to be: error text present
    // → the tool broke (toolfailed); no error text → a shape nobody verified (unparseable, the
    // pure 'Writing logs to' husk). Either way, never a number.
    const errored = lines.some((l) => l.includes('[ERROR]') || / ERROR /.test(l) || l.startsWith('Error:'));
    return (exit !== 0 || errored)
      ? { ..._zero(), ran: true, toolfailed: true }
      : { ..._zero(), ran: true, unparseable: true };
  }
  return _joernResultCounts(raw);
}

/** bin/joern-lane.mjs's per-language record, or null when the artifact predates it. */
function _joernLaneRecord(dir) {
  const p = join(dir, 'joern-lane.json');
  if (!existsSync(p)) return null;                 // absent: a vintage artifact, read whole-file below
  // Present and unreadable is NOT absent. Falling back here would re-enable the defect this record
  // exists to remove: a ScanPass in one language's section certifying every other language.
  let j; try { j = safeParseFile(p); } catch { return 'unparseable'; }
  if (!j || typeof j !== 'object') return 'unparseable';
  // A file in our own name that does not carry our shape is a void too — only ENOENT above is
  // absence, and `languages: []` is what runLane writes when nothing in a covered language ran.
  if (j.tool !== 'joern-lane' || !Array.isArray(j.languages) || !j.languages.length) return 'unparseable';
  return j;
}

function _joernResultCounts(raw) {
  const results = raw.split('\n').filter((l) => l.startsWith('Result: '));
  const c = { ..._zero(), ran: true };
  const rows = [];
  // joern-scan emits BYTE-IDENTICAL Result lines for one defect when more than one query in the
  // bundle matches the same call — measured 2026-09-01 on a single strcpy(): three Result lines for
  // two defects, so `total` overstated by 50% and the duplicate landed in the detail rows twice.
  // Deduped on the whole emitted tuple, which is what "the tool said this twice" means.
  //
  // This is NOT the line-keyed identity the house rule bans. That rule is about deciding whether a
  // finding across RUNS is the same one — where a line moves for reasons unrelated to the finding.
  // Here both lines came out of ONE artifact in one run, so the line cannot have moved between
  // them, and two rows identical in every emitted field are one defect reported twice by
  // construction. Nothing downstream keys on this; it only stops one defect being counted as two.
  const seen = new Set();
  for (const line of results) {
    const m = line.match(/^Result:\s*([0-9.]+)\s*:\s*(.+):\s*([^:\s]+):(\d+)(?::(\S+))?\s*$/);
    if (!m) continue;                       // a Result line the shape does not fit — skip, never guess
    const key = line.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = parseFloat(m[1]);
    const b = score >= 9 ? 'crit' : score >= 7 ? 'high' : score >= 4 ? 'med' : 'low';
    c[b]++; c.total++;
    rows.push({ rule: m[2].trim(), file: m[3], line: Number(m[4]) || 0, sev: b, message: capMessage(m[2].trim()) });
  }
  return { ...c, ..._detailFor('sastJoern', rows) };
}
// bearer's parser, written against REAL output (2026-08-27, bearer 2.1.1 on a scratch JS project).
// The measured shape: severity buckets ARE the top-level keys ({critical:[...], medium:[...]});
// a clean scan emits literally `{}` (measured), and exit is 1 when findings exist, 0 when clean —
// so a non-{0,1} exit is the tool dying, toolfailed. `warning`-bucket entries are informational
// rule matches, not findings — uncounted, the same treatment nuclei's info severity gets. A body
// that is valid JSON but neither empty-object-clean nor carrying a known bucket is a shape nobody
// verified: unparseable, never zero.
export function _bearerCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;          // absent is absent — the lane did not produce
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ..._zero(), ran: true, unparseable: true };
  let exit = 0;
  try { exit = parseInt(readFileSync(`${p}.exit`, 'utf8').trim(), 10) || 0; } catch { /* no sidecar: vintage artifact */ }
  if (exit !== 0 && exit !== 1) return { ..._zero(), ran: true, toolfailed: true };
  const map = { critical: 'crit', high: 'high', medium: 'med', low: 'low' };
  const keys = Object.keys(j);
  const known = keys.filter((k) => map[k] || k === 'warning');
  if (keys.length && !known.length) return { ..._zero(), ran: true, unparseable: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const k of known) {
    const b = map[k]; if (!b) continue;     // warning bucket: informational, not a finding
    for (const f of Array.isArray(j[k]) ? j[k] : []) {
      c[b]++; c.total++;
      rows.push({ rule: String(f.id || ''), file: String(f.filename || f.full_filename || ''),
        line: Number(f.line_number) || 0, sev: b, message: capMessage(String(f.title || '')) });
    }
  }
  return { ...c, ..._detailFor('sastBearer', rows) };
}
// sobelow's parser, written against REAL output (2026-08-27, sobelow 0.15.0 archive on a scratch
// Phoenix skeleton). The probe exposed a fleet-shaped trap: `--format json` calls Jason.encode!,
// and Jason comes from the SCANNED PROJECT's built deps — which this fleet never builds (deps.get
// executes package code). Without a jason archive on the scanning box the scan completes and then
// CRASHES ENCODING, leaving an empty artifact and exit 1 — that is the toolfailed branch below,
// and the box-prep fix is `mix archive.install hex jason` (done here 2026-08-27). The wrapper
// {findings:{...}, total_findings} is the proof sobelow finished, like clippy's {tool,diagnostics}.
// Sobelow asserts CONFIDENCE (high/medium/low_confidence), not severity — mapping confidence to
// high/crit would dress likelihood-of-true-positive as impact (the GuardDog defect in miniature),
// so: high_confidence→med, medium/low_confidence→low, the class string preserved as the rule.
// Sobelow exits 0 findings-or-not (no --exit flag in the lane); a non-zero exit WITH a valid
// wrapper still counts — the scan finished and something after it failed, not the findings.
export function _sobelowCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;          // absent is absent — the lane did not produce
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  let exit = 0;
  try { exit = parseInt(readFileSync(`${p}.exit`, 'utf8').trim(), 10) || 0; } catch { /* no sidecar: vintage artifact */ }
  if (!raw.trim()) return exit !== 0
    ? { ..._zero(), ran: true, toolfailed: true }  // the measured Jason-crash shape: scan done, encode died, nothing written
    : { ..._zero(), ran: true, unparseable: true }; // empty with exit 0 is a shape no probe has produced
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j.findings !== 'object' || j.findings === null || typeof j.total_findings !== 'number') {
    return { ..._zero(), ran: true, unparseable: true }; // wrapperless body — the fold never finished
  }
  const map = { high_confidence: 'med', medium_confidence: 'low', low_confidence: 'low' };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const [bucket, b] of Object.entries(map)) {
    for (const f of Array.isArray(j.findings[bucket]) ? j.findings[bucket] : []) {
      c[b]++; c.total++;
      rows.push({ rule: String(f.type || ''), file: String(f.file || ''), line: Number(f.line) || 0,
        sev: b, message: capMessage(String(f.type || '') + (f.variable ? ` (${f.variable})` : f.key ? ` (${f.key})` : '')) });
    }
  }
  return { ...c, ..._detailFor('sastElixir', rows) };
}
// bandit's parser, written against a REAL install (1.8.6, verified 2026-09-01) rather than a
// remembered claim: bandit has NO SARIF format at all (-f {csv,custom,html,json,screen,txt,xml,
// yaml}), so this reads its native -f json shape: {results:[{filename,line_number,test_id,
// issue_severity,issue_confidence,issue_text,issue_cwe:{id}}], errors:[...]}.
// `sev` comes from issue_severity ALONE, never issue_confidence -- Bandit asserts the two
// independently and folding confidence into severity is the GuardDog capability-* defect in
// miniature (a likelihood-of-true-positive signal dressed as impact). Confidence rides in the
// message text instead, matching lintRust/lintGo's convention of embedding classifying context
// rather than adding a schema column for something no existing lane has needed one for.
// Bandit exits non-zero merely for FINDING issues (bin/python-lane-scan.mjs already refuses to
// write a report unless the JSON actually parses into {results:[]}), so a present, parseable file
// with results is `ran: true` regardless of exit code -- the same discipline every SARIF-based
// lane already applies.
export function _banditCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let j; try { j = safeParseFile(p); } catch { return null; }
  if (!j || !Array.isArray(j.results)) return { ..._zero(), ran: true, unparseable: true };
  const map = { HIGH: 'high', MEDIUM: 'med', LOW: 'low' };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const r of j.results) {
    const b = map[String(r.issue_severity || '').toUpperCase()]; if (!b) continue;
    c[b]++; c.total++;
    const conf = String(r.issue_confidence || '').toUpperCase();
    rows.push({
      rule: String(r.test_id || ''), file: String(r.filename || ''), line: Number(r.line_number) || 0,
      sev: b, message: capMessage(String(r.issue_text || '') + (conf ? ` (confidence: ${conf})` : '')),
      cwe: r.issue_cwe && r.issue_cwe.id ? `CWE-${r.issue_cwe.id}` : '',
    });
  }
  return { ...c, ..._detailFor('sastPython', rows) };
}
// brakeman's parser, written against a REAL run (5.4.1, verified 2026-09-01 against a fixture Rails
// app: SQL injection, dangerous eval, XSS, CSRF and EOL-Rails findings). Native JSON, not SARIF:
// Brakeman's own -f sarif output DROPS both `confidence` and `cwe_id` (checked directly — the SARIF
// rule properties carry only a bare check-name tag, no CWE, and `level` collapses confidence to two
// buckets), while the native format carries both for free. `confidence` (High/Medium/Weak) is
// Brakeman's ONLY severity-shaped signal — it has no separate issue_severity field the way Bandit
// does, so unlike bandit's parser above (which keeps confidence OUT of `sev` because it has a real
// severity to use instead) this one maps confidence directly to severity: there is nothing else to
// map from. Embedded in the message too, matching the fleet's convention of surfacing confidence as
// readable context rather than a schema column nothing else has needed.
export function _brakemanCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let j; try { j = safeParseFile(p); } catch { return null; }
  if (!j || !Array.isArray(j.warnings)) return { ..._zero(), ran: true, unparseable: true };
  const map = { High: 'high', Medium: 'med', Weak: 'low' };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const w of j.warnings) {
    const b = map[String(w.confidence || '')]; if (!b) continue;
    c[b]++; c.total++;
    const cwe = Array.isArray(w.cwe_id) ? w.cwe_id.map((n) => `CWE-${n}`).join(', ') : '';
    rows.push({
      rule: String(w.check_name || ''), file: String(w.file || ''), line: Number(w.line) || 0,
      sev: b, message: capMessage(`${String(w.message || '')} (confidence: ${w.confidence || 'unknown'})`),
      cwe,
    });
  }
  return { ...c, ..._detailFor('sastBrakeman', rows) };
}
// phpcs's parser, written against a REAL run (PHP_CodeSniffer 4.0.4 + the pheromone/phpcs-security-
// audit ruleset, verified 2026-09-01 against a fixture with mysqli/eval/echo-XSS patterns). --report
// =json shape: {totals:{errors,warnings,fixable}, files:{<path>:{errors,warnings,messages:[{message,
// source,severity,fixable,type,line,column}]}}}. `type` (ERROR/WARNING) is the only severity-shaped
// signal this ruleset's messages carry in practice — every real message measured had `severity:5`
// regardless of how dangerous the pattern was (eval() and a dynamic mysqli param both landed on the
// same number), so severity is NOT trusted as a bucket; `type` alone decides sev, and `severity` is
// dropped rather than folded in as false precision. No CWE: `source` is a dotted rule id
// (Security.BadFunctions.NoEvals.NoEvals) with no CWE mapping shipped by the ruleset or phpcs
// itself, so this lane declares no cwe field rather than inventing one.
export function _phpcsCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let j; try { j = safeParseFile(p); } catch { return null; }
  if (!j || !j.files || typeof j.files !== 'object') return { ..._zero(), ran: true, unparseable: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const [filePath, entry] of Object.entries(j.files)) {
    for (const m of (entry && Array.isArray(entry.messages)) ? entry.messages : []) {
      const b = String(m.type || '').toUpperCase() === 'ERROR' ? 'high' : 'med';
      c[b]++; c.total++;
      rows.push({
        rule: String(m.source || ''), file: String(filePath || ''), line: Number(m.line) || 0,
        sev: b, message: capMessage(String(m.message || '')),
      });
    }
  }
  return { ...c, ..._detailFor('sastPhp', rows) };
}
// PMD's parser, written against REAL runs (7.9.0 then 7.27.0/Homebrew, verified 2026-09-01 against
// a fixture with an empty catch block, an always-true if, and System.out usage). --format json:
// {formatVersion, pmdVersion, timestamp, files:[{filename, violations:[{beginline, begincolumn,
// endline, endcolumn, description, rule, ruleset, priority, externalInfoUrl}]}], suppressedViolations,
// processingErrors, configurationErrors}. `priority` is PMD's own 1(High)-5(Low) scale, folded to
// high/med/low: 1-2 high, 3 med, 4-5 low. No CWE: the JSON renderer carries no CWE mapping for any
// rule in any of the four categories scanned (errorprone, bestpractices, multithreading,
// performance — codestyle/documentation/design and the 2-rule security.xml are deliberately not
// scanned, see LANE_KINDS/detail-schema notes).
// THE AMBIGUITY THE PROBE FOUND: `files` lists only files WITH AT LEAST ONE VIOLATION — a real run
// with zero violations and a run against zero .java files (a build marker with no Java sources,
// e.g. a Kotlin-only Gradle module) produce the IDENTICAL body, {files: [], ...all empty}. PMD logs
// "No files to analyze" to stderr in the second case and nothing distinguishing in the first, so
// the manifest's `local` command redirects that stream to pmd.log and this parser reads it ONLY
// when files is empty, to tell a real zero from a scan that never had anything to scan — grey, not
// green, exactly as a source-count guard is required to be everywhere else in this file. The `local`
// command also passes --no-fail-on-error --no-fail-on-violation, so a normal run's exit is always 0
// regardless of findings (PMD's own docs: undecorated exit is a bitmask over violations/errors) —
// the ran/did-not-run decision is made from the parsed JSON, never the exit code, matching lintGo.
export function _pmdCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let j; try { j = safeParseFile(p); } catch { return null; }
  if (!j || !Array.isArray(j.files)) return { ..._zero(), ran: true, unparseable: true };
  if (j.files.length === 0) {
    let log = ''; try { log = readFileSync(join(dir, 'pmd.log'), 'utf8'); } catch { /* no log: treat as a real zero */ }
    if (log.includes('No files to analyze')) return { ..._zero(), ran: true, nosrc: true };
  }
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const f of j.files) {
    for (const v of (f && Array.isArray(f.violations)) ? f.violations : []) {
      const pr = Number(v.priority) || 5;
      const b = pr <= 2 ? 'high' : pr === 3 ? 'med' : 'low';
      c[b]++; c.total++;
      rows.push({
        rule: String(v.rule || ''), file: String(f.filename || '').replace(/^\.\//, ''),
        line: Number(v.beginline) || 0, sev: b, message: capMessage(String(v.description || '')),
      });
    }
  }
  return { ...c, ..._detailFor('lintJava', rows) };
}

// shellcheck --format=json1 → { comments: [ {file, line, level, code, message} ] }. json1 and NOT
// json: the plain formatter emits a BARE ARRAY, so `[]` from a clean run and `[]` from a shellcheck
// that examined nothing are the same two bytes. The `comments` key is the proof of a real run, and
// its absence is `unparseable` — a void — rather than a zero.
export function _shellcheckCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!Array.isArray(j && j.comments)) return { ..._zero(), ran: true, unparseable: true };
  const c = { ..._zero(), ran: true }, map = { error: 'high', warning: 'med', info: 'low', style: 'low' };
  const rows = [];
  for (const f of j.comments) {
    const b = map[String((f && f.level) || '').toLowerCase()] || 'low';
    c[b]++; c.total++;
    rows.push({ rule: f && f.code ? `SC${f.code}` : '', file: f && f.file, line: f && f.line, sev: b, message: f && f.message });
  }
  return { ...c, ..._detailFor('shellLint', rows) };
}
// actionlint has no SARIF mode and no severity field of its own. The lane's manifest wraps its bare
// array in `{tool, ran:true, findings}` using actionlint's own Go template, because the tool exits
// before rendering the template — so the marker cannot survive a run that did not happen, and its
// absence is a void. Severity is derived here: untrusted input interpolated into an inline `run:`
// is the script-injection sink (a live RCE on pull_request_target) and outranks everything else;
// every other finding, INCLUDING a kind this code has never seen, is `med` rather than `low`, so a
// future actionlint check cannot land silently at the bottom of the panel.
export function _actionlintCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || j.ran !== true || !Array.isArray(j.findings)) return { ..._zero(), ran: true, unparseable: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const f of j.findings) {
    const b = /potentially untrusted/i.test(String((f && f.message) || '')) ? 'high' : 'med';
    c[b]++; c.total++;
    rows.push({ rule: (f && f.kind) || 'unknown', file: f && f.filepath, line: f && f.line, sev: b, message: f && f.message });
  }
  return { ...c, ..._detailFor('actionsLint', rows) };
}
// deno lint emits {diagnostics:[{code,message,filename,range}], errors:[]}. It assigns NO severity
// — every rule is just "a diagnostic" — so everything lands in `low` and the COUNT carries the
// signal. Ranking them here would be inventing a precision the tool does not have, which is the
// failure this rollup keeps finding in other people's scanners.
export function _denoLintCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  const diags = Array.isArray(j && j.diagnostics) ? j.diagnostics : [];
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const d of diags) {
    c.low++; c.total++;
    rows.push({ rule: d.code || 'deno-lint', sev: 'low', message: d.message || '',
      path: d.filename ? String(d.filename).replace(/^file:\/\//, '') : undefined,
      line: d.range && d.range.start ? d.range.start.line : undefined });
  }
  return { ...c, ..._detailFor('denoLint', rows) };
}

// deno check writes human text, not JSON: the parseable fact is its trailing "Found N errors."
// A clean run prints "Check file:///…" lines and no total, which is a real zero — distinguished
// from "the log is missing" (null, so the category reads as a void) and from an unparseable body.
export function _denoCheckCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  const m = raw.match(/Found (\d+) errors?\./);
  const n = m ? Number(m[1]) : 0;
  const c = { ..._zero(), ran: true };
  if (!n) return c;                                   // ran, type-clean
  c.low = n; c.total = n;
  // One row per distinct TS code, not per occurrence: 422 errors on client-d were four or five real
  // shapes repeated, and a 422-row table hides that where a 5-row one states it.
  //
  // ANSI FIRST, AND IT IS LOAD-BEARING. `deno check` colours its output, and the reset sequence
  // lands BETWEEN the code and the tag: the bytes are `TS2307 <ESC>[0m[ERROR]:`, not
  // `TS2307 [ERROR]:`. The pattern below matched neither, so every deno repo published a correct
  // total from `Found N errors.` and ZERO detail rows beside it. Measured 2026-08-22 across the
  // fleet's 34 rollups: 40,453 counted errors with no row to explain any of them, the single
  // largest detail gap in the fleet — and it read as an aggregation choice rather than a parse
  // failure, which is why it survived. Same defect class as the GuardDog message shape above:
  // the data was never missing, the pattern was looking for bytes the tool does not emit.
  // The ESC byte is written as \u001b rather than pasted literally: an invisible control
  // character in source survives nothing — a copy, a lint autofix, or an editor normalising the
  // file silently turns this pattern back into one that matches nothing, which is the exact bug
  // it was added to fix.
  const plain = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const byCode = new Map();
  for (const mm of plain.matchAll(/TS(\d+)\s*\[ERROR\]:\s*([^\n]*)/g)) {
    const code = `TS${mm[1]}`;
    if (!byCode.has(code)) byCode.set(code, { rule: code, sev: 'low', message: (mm[2] || '').trim(), count: 0 });
    byCode.get(code).count++;
  }
  return { ...c, ..._detailFor('denoTypes', [...byCode.values()].sort((a, b) => b.count - a.count)) };
}

// cobolwork's parser, written against real reports (monitor/test/fixtures/cobolwork/). Native JSON,
// not SARIF: cobolwork's SARIF maps crit to error (read here as high) and info to note (read as low).
// `evidence` decides the bucket; a configuration gap in setsIncomplete is not a coverage gap.
//
// READ BY CAPABILITY, NOT BY VERSION. This refused a report below schemaVersion 3, which made one
// cobolwork version mandatory for the lane to say anything — the wrong dependency for a tool that
// is still moving. Every field is used where it is present and has a safe reading where it is not.
// `info` has never been a defect severity in any cobolwork, so a report from before `evidence`
// still counts, with its info rows undetermined. A kind this reader does not know stays
// undetermined either way: one added later may not be a defect.
const COBOLWORK_DEFECT_KINDS = new Set(['path', 'construct', 'tampering', 'advisory', 'exposure', 'change']);
const COBOLWORK_SEVERITIES = new Set(['crit', 'high', 'med', 'low']);

function _cobolworkBucket(f) {
  const evidence = String(f.evidence || '');
  if (!evidence) return COBOLWORK_SEVERITIES.has(f.sev) ? f.sev : 'undetermined';
  if (evidence === 'context') return 'context';
  if (!COBOLWORK_DEFECT_KINDS.has(evidence)) return 'undetermined';   // coverage, or a kind unknown here
  return COBOLWORK_SEVERITIES.has(f.sev) ? f.sev : 'undetermined';
}

// summary.toolRevision, the commit the cobolwork that wrote the report runs from: 'release' (a
// packed release's stamp) or 'checkout' (a working tree, dirty or not). Kept to its four fields.
function _cobolworkRevision(s) {
  const t = s && s.toolRevision;
  if (!t || typeof t !== 'object' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(String(t.commit || ''))) return {};
  return { toolRevision: { commit: t.commit, dirty: typeof t.dirty === 'boolean' ? t.dirty : null,
    ...(typeof t.tag === 'string' && t.tag ? { tag: t.tag } : {}), from: ['release', 'checkout'].includes(t.from) ? t.from : null } };
}

function _cobolworkCoverage(s, inv) {
  const read = Number(s.filesScanned) || 0;
  if (s.coverageIncomplete !== true) {
    return { state: 'covered', ratio: null, extracted: read, expected: read,
      reason: `cobolwork read ${read} file(s) and reports nothing it did not read` };
  }
  const sets = (Array.isArray(s.setsIncomplete) ? s.setsIncomplete : [])
    .filter((x) => x && x.kind === 'coverage' && x.why).map((x) => String(x.why));
  const refused = Array.isArray(inv.refusedCopies) ? inv.refusedCopies.length : 0;
  const dirs = Number(inv.dirsUnreadable) || 0;
  const outside = Number(inv.symlinks && inv.symlinks.outside) || 0;
  const why = [
    s.copiesMissing ? `${s.copiesMissing} COPY statement(s) name a copybook not in the tree, so size-dependent CICS checks cannot fire on those programs` : '',
    refused ? `${refused} COPY statement(s) named a file outside the tree and were refused` : '',
    s.filesUnreadable ? `${s.filesUnreadable} file(s) could not be read` : '',
    dirs ? `${dirs} director(ies) could not be listed` : '',
    outside ? `${outside} symlink(s) point outside the tree and were not followed` : '',
    s.filesOverBudget ? `${s.filesOverBudget} file(s) were past the source budget` : '',
    ...sets,
  ].filter(Boolean);
  return { state: 'partial', ratio: null, extracted: read, expected: null,
    reason: `cobolwork read ${read} file(s) and says its coverage is incomplete`
      + (why.length ? `: ${why.join('; ')}` : '')
      + '. Findings reported are real; their absence in what it did not read is not evidence of absence.' };
}

export function _cobolworkCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true, emptyArtifact: true };
  let j;
  try { j = safeParseFile(p); } catch (e) {
    return { ..._zero(), ran: true, unparseable: true, unparseableWhy: String((e && e.message) || e).slice(0, 200) };
  }
  if (!j || j.tool !== 'cobolwork' || !j.summary || typeof j.summary !== 'object' || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true, unparseableWhy: 'not a cobolwork scan report' };
  }
  const s = j.summary;
  // What this report let the lane read, so a count can be judged without knowing which cobolwork
  // wrote it: `evidence` decides the buckets, `fingerprint` is a line-independent identity.
  const evidenceRead = j.findings.some((f) => f && f.evidence);
  // Whether this cobolwork states a per-rule impact and fix at all. An older one carries neither
  // map, so a blank Impact or Fix column means the tool did not answer, not that there is no fix.
  const remediationRead = j.ruleImpact !== undefined || j.ruleRemedy !== undefined;
  // Whether this cobolwork states reach and effect at all. An older one carries neither, so a blank
  // Reach or Effect column means the tool did not answer, not that the finding is unreachable.
  const reachRead = s.byReach !== undefined || s.reachNote !== undefined;
  const provenance = {
    schemaVersion: Number.isFinite(Number(j.schemaVersion)) ? Number(j.schemaVersion) : null,
    toolVersion: String(s.toolVersion || ''), flowModel: String(s.flowModel || ''),
    evidenceRead,
    remediationRead,
    reachRead,
    // The scheme that produced the fingerprints, so a consumer knows whether it recognises them.
    ...(s.identity && s.identity.version ? { fingerprintVersion: String(s.identity.version) } : {}),
    ..._cobolworkRevision(s),
    ...(evidenceRead ? {} : { evidenceNote: "this cobolwork does not state what kind of claim a finding makes, so severity alone decided the buckets and every info row is undetermined" }),
    ...(remediationRead ? {} : { remediationNote: "this cobolwork does not state a per-rule impact or fix, so the Impact and Fix columns are blank because the tool did not answer, not because the finding has none" }),
    ...(reachRead ? {} : { reachEffectNote: "this cobolwork does not state whether a finding is reachable or what it runs as, so the Reach and Effect columns are blank because the tool did not answer, not because the finding is unreachable" }),
  };
  // A report without `nosrc` that read no file is the same void: a zero over nothing read.
  const readNothing = s.filesScanned !== undefined && Number(s.filesScanned) === 0 && !j.findings.length;
  if (s.nosrc === true || readNothing) return { ..._zero(), ran: true, nosrc: true, ...provenance };

  const c = { ..._zero(), ran: true, undetermined: 0, context: 0, ...provenance };
  const fx = { crit: 0, high: 0, med: 0, low: 0, total: 0, byPattern: {}, rows: [] };
  const rows = [];
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const b = _cobolworkBucket(f);
    const row = {
      rule: String(f.rule || ''), file: String(f.path || ''), line: Number(f.line) || 0,
      sev: COBOLWORK_SEVERITIES.has(b) ? b : '',
      evidence: String(f.evidence || ''), cwe: String(f.cwe || ''),
      fingerprint: String(f.fingerprint || ''),
      message: capMessage([String(f.detail || ''), f.sources > 1 ? `(${f.sources} sources reach this statement)` : '']
        .filter(Boolean).join(' ')),
      impact: capMessage(String((j.ruleImpact && j.ruleImpact[f.rule]) || '')),
      remedy: capMessage(String((j.ruleRemedy && j.ruleRemedy[f.rule]) || '')),
      reach: String(f.reach || ''),
      effect: String(f.effect || ''),
      program: String(f.program || ''),
      // The analysis that produced the row. issue-store's auto-close reads it off the row: a row
      // absent under a different flow model was never compared, so it is carried, not fixed.
      model: provenance.flowModel,
    };
    if (!COBOLWORK_SEVERITIES.has(b)) { c[b]++; rows.push(row); continue; }
    // the same fixture split _sarifCounts makes
    const cls = classifyPath(row.file);
    if (cls.fixture) {
      fx[b]++; fx.total++;
      fx.byPattern[cls.pattern] = (fx.byPattern[cls.pattern] || 0) + 1;
      fx.rows.push({ rule: row.rule, file: row.file, line: row.line, sev: b, pattern: cls.pattern,
        ...(cls.intent ? { intent: cls.intent, intentBasis: cls.intentBasis } : {}) });
      continue;
    }
    c[b]++; c.total++;
    rows.push(row);
  }
  if (fx.total) {
    c.fixtures = { ...fx, of: fx.total + c.total, note: `${fx.total} of ${fx.total + c.total} findings are under a test-fixture path and are excluded from these counts. They remain in the cobolwork report on disk. Set CW_FIXTURE_PATHS=off to count them.` };
  }
  c.coverage = _cobolworkCoverage(s, (j.inventory && typeof j.inventory === 'object') ? j.inventory : {});
  if (s.coverageIncomplete === true) c.coverageIncomplete = true;
  if (Number(s.crossProgram) > 0) c.crossProgram = Number(s.crossProgram);
  if (Array.isArray(s.setsIncomplete) && s.setsIncomplete.length) {
    c.setsIncomplete = s.setsIncomplete.slice(0, 20).map((x) => ({
      set: String((x && x.set) || ''), kind: String((x && x.kind) || ''), why: capMessage(String((x && x.why) || '')),
    }));
  }
  return { ...c, ..._detailFor('sastCobol', rows) };
}

// cobolwork inventory writes coverage, never vulnerabilities — every row here is a fact about what
// was READ. They are counted as `undetermined` for that reason: publishing a missing copybook as a
// severity would put coverage and vulnerability in one number, and the lane exists to separate them.
export function _cobolInventoryCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || !j.summary) return { ..._zero(), ran: true, unparseable: true };
  if (!(j.schemaVersion >= 2)) return { ..._zero(), ran: true, unparseable: true, reason: `cobolwork schemaVersion ${j.schemaVersion ?? 'missing'} < 2` };
  const s = j.summary;
  if ((s.filesScanned || 0) === 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const [name, count] of Object.entries(j.missingCopybooks || {})) {
    rows.push({ kind: 'missing-copybook', name, count, sev: '',
      message: `COPY ${name} resolves to no copybook in this tree (${count} statement${count === 1 ? '' : 's'}). The fields it defines were never read, so every check that needs one of them is blind on those programs.` });
  }
  for (const u of (j.unreadable || [])) {
    const [path, why] = String(u).split(/:\s*/);
    rows.push({ kind: 'unreadable', name: path, count: 1, sev: '',
      message: `not read${why ? `: ${why}` : ''} — an EBCDIC-converted source or a binary member carrying a COBOL extension reads the same way here as a genuine read failure, so this is coverage unknown, not coverage clean.` });
  }
  for (const [fmt, n] of Object.entries(s.formats || {})) {
    rows.push({ kind: 'source-format', name: fmt, count: n, sev: '',
      message: `${n} file(s) parsed as ${fmt} reference format. A file read under the wrong format parses into something that is not the program anyone wrote.` });
  }
  c.undetermined = rows.length;
  return { ...c, ..._detailFor('cobolCoverage', rows) };
}

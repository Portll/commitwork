import { readFileSync } from 'node:fs';
import { safeReadJSON } from './common.mjs';

export function parseTrufflehog(path) {
  const lines = (() => { try { return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()); } catch { return []; } })();
  let verified = 0, total = 0, unparsed = 0;
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { unparsed++; continue; /* trufflehog interleaves non-JSON log lines */ }
    if (o.SourceMetadata || o.DetectorName || o.Verified !== undefined) { total++; if (o.Verified) verified++; }
  }
  // A scanner that dies mid-run writes non-JSON and no findings, which a bare catch turned into
  // "0 verified, ok". No findings plus a parse failure is a void. A zero-byte report is also
  // what a clean trufflehog writes, so the receipt is read from trufflehog.log instead:
  //   {"msg":"finished scanning","chunks":2,"bytes":41,"verified_secrets":0,…}
  // is a clean scan reporting itself, and it was on disk unread all along.
  //
  // So a clean run must now PRODUCE the receipt to be believed. Verified 2026-08-11 against
  // trufflehog 3.95.9. `chunks: 0` is its own answer — the scan started and examined nothing,
  // which is not a clean repository. Absent receipt ⇒ the run did not finish.
  const receipt = (() => {
    const logPath = path.replace(/\.jsonl?$/i, '') + '.log';
    let raw; try { raw = readFileSync(logPath, 'utf8'); } catch { return null; }
    for (const l of raw.split('\n')) {
      if (!l.includes('finished scanning')) continue;
      try { const o = JSON.parse(l); if (o && o.msg === 'finished scanning') return o; } catch { /* not the record */ }
    }
    return null;
  })();
  // The manifest sends stderr to trufflehog.log and stdout to trufflehog.json, so the report file
  // should hold findings and nothing else — "interleaved log noise" cannot legitimately arrive
  // here, which is what makes strictness safe. Content with ZERO finding records is therefore a
  // void whether or not it parsed: `{"error":"permission denied"}` is valid JSON and still not a
  // scan. A genuinely clean run writes an EMPTY file and stays green on the `0` below.
  if (!total && lines.length) {
    return { ok: false, sev: 'noscan', summary: unparsed
      ? `output not parseable — ${unparsed} line(s), tool likely failed`
      : `no trufflehog records — ${lines.length} line(s) of something else` };
  }
  // A CLEAN result must be earned. Findings prove the scanner worked by themselves, so the
  // receipt is only required on the empty path — the one that would otherwise be a bare claim.
  if (!total) {
    if (!receipt) {
      return { ok: false, sev: 'noscan', summary: 'no findings and no completion receipt in trufflehog.log — the scan did not finish' };
    }
    const chunks = Number(receipt.chunks || 0);
    const bytes = Number(receipt.bytes || 0);
    if (!chunks) {
      return { ok: false, sev: 'noscan', summary: `scan finished having examined NOTHING (0 chunks) — an empty scan is not a clean repo${receipt.trufflehog_version ? ` [${receipt.trufflehog_version}]` : ''}` };
    }
    // The number is carried into the summary on purpose: "0" and "0 secrets in 5,000 chunks" are
    // the same verdict with very different standing, and only the second can be checked.
    return { ok: true, total: 0, verified: 0, sev: 'ok', receipt: { chunks, bytes },
      summary: `0 secrets — ${chunks.toLocaleString('en-US')} chunk(s) / ${bytes.toLocaleString('en-US')} byte(s) scanned` };
  }
  const sev = verified ? 'high' : 'med';
  return { ok: true, total, verified, sev, summary: `${verified} verified / ${total - verified} unverified` };
}

export function parseGitleaks(path, tool = 'gitleaks') {
  // gitleaks --report-format json emits a JSON array of findings ([] when clean).
  // Without this branch the report fell through to the generic { sev:'ok' } below and a
  // repo full of leaked secrets scored GREEN as long as the file existed. --redact is set
  // in the manifest, so RuleID/File/StartLine are safe to summarise; never echo the secret.
  const j = safeReadJSON(path);
  if (!Array.isArray(j)) return { ok: false, summary: `no ${tool} data` };
  const total = j.length;
  // The trufflehog receipt rule: `[]` is what a clean gitleaks writes and what one that scanned
  // nothing writes, so the sibling log's "INF scanned ~N bytes" line is the proof of work.
  // Zero bytes scanned is a run that examined nothing, not a clean repository.
  //
  // Findings are believed on their own evidence: the receipt gates CLEAN only, never detection.
  // That restriction is what makes this safe to apply per lane rather than as a blanket rule.
  if (!total) {
    const receipt = (() => {
      const logPath = path.replace(/\.json$/i, '') + '.log';
      let raw; try { raw = readFileSync(logPath, 'utf8'); } catch { return null; }
      // Strip ANSI: gitleaks colourises even when redirected, so a naive match misses the line.
      const m = /scanned\s+~?([\d,]+)\s+bytes/i.exec(raw.replace(/\[[0-9;]*m/g, ''));
      return m ? { bytes: Number(m[1].replace(/,/g, '')) } : null;
    })();
    if (!receipt) {
      return { ok: false, sev: 'noscan', total: 0,
        summary: `no findings and no "scanned ~N bytes" receipt in ${tool}.log — the scan did not finish` };
    }
    if (!receipt.bytes) {
      return { ok: false, sev: 'noscan', total: 0,
        summary: `${tool} finished having scanned 0 bytes — an empty scan is not a clean repo` };
    }
    // The number rides in the summary on purpose: "0" and "0 secrets in 6.97 MB scanned" are
    // different claims, and only the second one can be checked by whoever reads it later.
    return { ok: true, total: 0, sev: 'ok', summary: `0 (${(receipt.bytes / 1048576).toFixed(2)} MB scanned)` };
  }
  return { ok: true, total, sev: 'high', summary: `${total} secret finding${total > 1 ? 's' : ''}` };
}

// betterleaks writes gitleaks' array shape plus a per-finding confidence and, under --validation,
// an inline ValidationStatus. Only a validated-live credential is `high`, trufflehog's rule: most of
// its generic-* rules fire at low confidence (61 of 87 rows on commitwork, 2026-10-07), and
// publishing those at gitleaks' blanket `high` would let one rule family own the bucket.
export function parseBetterleaks(path) {
  const base = parseGitleaks(path, 'betterleaks');
  if (!base.ok || !base.total) return base;
  const rows = safeReadJSON(path);
  let live = 0, dead = 0, low = 0;
  for (const f of rows) {
    const status = f && f.ValidationStatus;
    if (status === 'valid') live++;
    else if (status === 'invalid' || status === 'revoked') dead++;
    else if (f && f.Attributes && f.Attributes.confidence === 'low') low++;
  }
  const total = rows.length;
  return { ok: true, total, verified: live, sev: live ? 'high' : 'med',
    summary: `${total} secret finding${total > 1 ? 's' : ''}: ${live} validated live, ${dead} invalid or revoked, ${low} low-confidence and unvalidated` };
}

export function parseWeakRandom(path) {
  // bin/weak-random-detect.mjs writes {tool, summary:{findings, byRule, filesScanned,
  // testContext}, findings:[{rule, severity, path, line, context, ...}]}.
  //
  // `summary.findings` counts SOURCE-context rows only; test/bench/fixture matches are carried in
  // `testContext` and are not findings — a deterministic seed in a benchmark is the correct
  // implementation of a benchmark. The severity is read from the rows rather than asserted here,
  // for the reason _stubCounts records: a count computed independently of the rows it summarises
  // is free to disagree with them, and did.
  //
  // filesScanned === 0 is a VOID, not a clean repository: a walk that matched nothing has not
  // examined anything. Same rule minify-detect applies.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object' || j.tool !== 'weak-random-detect' || !j.summary || !Array.isArray(j.findings)) {
    return { ok: false, sev: 'noscan', summary: 'not a weak-random report' };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) {
    return { ok: false, sev: 'noscan', total: 0, summary: 'scanned 0 files — a walk that examined nothing is not a clean result' };
  }
  const real = j.findings.filter((f) => f && f.context !== 'test');
  const total = real.length;
  const inTests = j.findings.length - total;
  // Any genuine finding is `high`: a guessable credential is not a gradient.
  const sev = total ? 'high' : 'ok';
  const parts = [`${scanned} files`];
  if (inTests) parts.push(`${inTests} in test/bench context, not counted`);
  return { ok: true, total, sev, summary: total ? `${total} (${parts.join('; ')})` : `0 (${parts.join('; ')})` };
}

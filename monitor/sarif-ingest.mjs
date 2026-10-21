#!/usr/bin/env node
// monitor/sarif-ingest.mjs — import a third-party SARIF 2.1.0 file as commitwork findings.
//
// The generic counterpart to the per-lane readers: any tool that writes SARIF can be brought in
// without a lane of its own. The document is read through monitor/sarif-read.mjs, so every state
// that reader refuses (absent, unreadable, empty, unparseable, never-ran, tool-failed) is an
// error here — a file that could not be read never imports as zero findings.
//
// Each result is routed by SARIF `kind`: fail (the default) is a finding; review/open are
// undetermined, kept with the tool's original level and outside crit/high/med/low; pass,
// notApplicable and informational are counted and not published as findings. A result whose
// baselineState is `absent` describes something no longer present and is counted the same way.
// In-source suppressions are listed separately.
//
// Identity excludes line: tool|repo|rule|file, plus the result's partialFingerprints when it
// carries any. Without fingerprints, two results of one rule in one file share an identity — the
// same thing having moved, by house rule, never one ending and another beginning.
//
//   node monitor/sarif-ingest.mjs <file.sarif> [--repo <name>] [--out <file.json>]
//
// Exit 0 imported, 2 usage, 20 the document was refused (reason on stderr, nothing written).

import { readSarif, ruleIndex, cweOf, isSuppressed, sarifBand } from './sarif-read.mjs';
import { buildFindingKey } from '../bin/lib/verdict-journal-core.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { resolve } from 'node:path';

export const SARIF_VERSION = '2.1.0';
const FINDING_KINDS = new Set(['fail']);
const UNDETERMINED_KINDS = new Set(['review', 'open']);
const NON_FINDING_KINDS = new Set(['pass', 'notApplicable', 'informational']);
const MESSAGE_CAP = 500;

export class SarifIngestError extends Error {
  constructor(code, reason, path) {
    super(`sarif-ingest refused ${path}: ${code} — ${reason}`);
    this.name = 'SarifIngestError';
    this.code = code;
    this.reason = reason;
    this.path = path;
  }
}

function ruleFor(res, run, rules) {
  if (res.ruleId) return { id: String(res.ruleId), rule: rules[res.ruleId] || null };
  if (res.rule && res.rule.id) return { id: String(res.rule.id), rule: rules[res.rule.id] || null };
  const i = res.rule && Number.isInteger(res.rule.index) ? res.rule.index : null;
  const byIndex = i === null ? null : ((run.tool && run.tool.driver && run.tool.driver.rules) || [])[i];
  if (byIndex && byIndex.id) return { id: String(byIndex.id), rule: byIndex };
  return null;
}

function locationOf(res) {
  const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
  const file = String((loc && loc.artifactLocation && loc.artifactLocation.uri) || '')
    .replace(/^file:\/\/\/?/, '').replace(/^\.\//, '');
  return { file, line: Number(loc && loc.region && loc.region.startLine) || 0 };
}

function fingerprintOf(res) {
  const pf = res.partialFingerprints;
  if (!pf || typeof pf !== 'object') return '';
  return Object.keys(pf).sort().map((k) => `${k}=${pf[k]}`).join(';');
}

const byIdentity = (a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : a.line - b.line
  || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

/**
 * Read one SARIF 2.1.0 document into normalised findings. Throws SarifIngestError for anything
 * that is not a readable SARIF 2.1.0 document whose every result names its rule.
 */
export function ingestSarif(path, { repo = '' } = {}) {
  const r = readSarif(path);
  if (r.state !== 'ok') throw new SarifIngestError(r.state, r.reason, path);
  if (r.version !== SARIF_VERSION) {
    throw new SarifIngestError('unsupported-version', `version is ${JSON.stringify(r.version)}, this importer reads ${SARIF_VERSION} only`, path);
  }
  const findings = [];
  const undetermined = [];
  const suppressed = [];
  const nonFindings = { pass: 0, notApplicable: 0, informational: 0, absent: 0 };
  const counts = { crit: 0, high: 0, med: 0, low: 0, total: 0 };
  let n = -1;
  for (const run of r.runs) {
    if (!run || typeof run !== 'object') throw new SarifIngestError('malformed', 'a runs[] entry is not an object', path);
    const tool = String((run.tool && run.tool.driver && run.tool.driver.name) || '');
    if (!tool) throw new SarifIngestError('malformed', 'a run has no tool.driver.name', path);
    const rules = ruleIndex(run, { extensions: true });
    for (const res of run.results) {
      n++;
      if (!res || typeof res !== 'object') throw new SarifIngestError('malformed', `result ${n} is not an object`, path);
      const kind = res.kind || 'fail';
      if (NON_FINDING_KINDS.has(kind)) { nonFindings[kind]++; continue; }
      if (!FINDING_KINDS.has(kind) && !UNDETERMINED_KINDS.has(kind)) {
        throw new SarifIngestError('malformed', `result ${n} has unknown kind ${JSON.stringify(kind)}`, path);
      }
      if (res.baselineState === 'absent') { nonFindings.absent++; continue; }
      const ref = ruleFor(res, run, rules);
      if (!ref) throw new SarifIngestError('malformed', `result ${n} names no rule (ruleId, rule.id or rule.index)`, path);
      const { file, line } = locationOf(res);
      const fp = fingerprintOf(res);
      const rule = ref.rule || {};
      const level = res.level || (rule.defaultConfiguration && rule.defaultConfiguration.level) || 'warning';
      const row = {
        tool, rule: ref.id, file, line, level,
        message: String((res.message && res.message.text) || '').slice(0, MESSAGE_CAP),
        cwe: cweOf(rule),
        identity: buildFindingKey([['source', 'sarif'], ['tool', tool], ['repo', repo], ['rule', ref.id], ['file', file], ['fingerprint', fp]]),
        identityBasis: fp ? 'partialFingerprints' : 'rule+file',
      };
      if (UNDETERMINED_KINDS.has(kind)) { undetermined.push({ ...row, kind }); continue; }
      const sev = sarifBand(res, rule);
      if (isSuppressed(res)) { suppressed.push({ ...row, sev }); continue; }
      findings.push({ ...row, sev });
      counts[sev]++; counts.total++;
    }
  }
  findings.sort(byIdentity); undetermined.sort(byIdentity); suppressed.sort(byIdentity);
  return {
    source: 'sarif', version: r.version, tools: [...new Set(r.runs.map((x) => String(x.tool.driver.name)))].sort(),
    repo, counts, findings, undetermined, suppressed, nonFindings,
    // Zero results with no invocation record cannot certify the tool ran; carried, never read as clean.
    unwitnessedZero: r.unwitnessedZero,
    extractionErrors: r.extractionErrors,
  };
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const input = argv.find((a, i) => !a.startsWith('--') && !['--repo', '--out'].includes(argv[i - 1]));
  if (!input) {
    process.stderr.write('usage: sarif-ingest.mjs <file.sarif> [--repo <name>] [--out <file.json>]\n');
    process.exitCode = 2;
  } else {
    let doc = null;
    try { doc = ingestSarif(resolve(input), { repo: flag('--repo') || '' }); } catch (e) {
      if (!(e instanceof SarifIngestError)) throw e;
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 20;
    }
    if (doc) {
      const text = `${JSON.stringify(doc, null, 2)}\n`;
      const out = flag('--out');
      if (out) writeAtomic(resolve(out), text, { mkdir: true });
      else process.stdout.write(text);
    }
  }
}

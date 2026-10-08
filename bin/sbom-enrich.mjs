#!/usr/bin/env node
// sbom-enrich.mjs — put back the provenance syft's CycloneDX writer dropped.
//
// Runs immediately after `syft scan` in the sbom-syft check, over the two documents that scan
// produced. See monitor/sbom-provenance.mjs for the measurement and the reasoning.
//
// Usage: node bin/sbom-enrich.mjs <cyclonedx.json> <native-syft.json> [--report <file>]
//
// ALWAYS writes the report sidecar, even when it changes nothing, because "enriched and found
// nothing to correct" and "never ran" are the same CycloneDX and must not be the same claim. The
// sidecar is what a publisher checks before shipping the document as evidence.
//
// Exit 0 when the enricher READ its reference: enriched, nothing needed correcting, nothing to
// inventory, or `unstated` (syft recorded no resolution for these ecosystems). The last is not a
// clean state; the sidecar carries it as unknown and the lane's coverage signal matches its line.
// Exit 1 when there was no reference to read — a missing native document leaves every git-sourced
// component asserting a registry identity, and that must not pass silently.

import { writeAtomic } from '../monitor/lockfile.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { enrich } from '../monitor/sbom-provenance.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function run(cdxPath, nativePath, reportPath) {
  let cdx = null; let native = null; let reason = '';
  try { cdx = readJSON(cdxPath); } catch (e) { reason = `cyclonedx unreadable: ${e.message}`; }
  if (!cdx) {
    const report = { ran: false, unknown: true, unknownReason: 'unparseable', detail: reason,
      note: 'the CycloneDX document could not be read, so nothing was corrected and nothing should be published from it' };
    if (reportPath) writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { ok: false, report };
  }
  try { native = readJSON(nativePath); } catch (e) { reason = `native unreadable: ${e.message}`; }

  const { cdx: out, report } = enrich(cdx, native);
  report.sources = { cyclonedx: cdxPath, native: nativePath, nativeRead: !!native };
  if (reason) report.detail = reason;

  // Only rewrite when something actually changed: an untouched document keeps its bytes, which
  // keeps the sweep's determinism check honest.
  if (report.enriched > 0) writeAtomic(cdxPath, `${JSON.stringify(out, null, 2)}\n`);
  if (reportPath) writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ok: report.ran === true || report.unknownReason === 'unstated', report };
}

export function summaryLine(report) {
  if (report.ran === true && report.artifacts === 0) return `sbom-enrich: NOTHING TO INVENTORY — ${report.note}`;
  if (report.ran === true) {
    return `sbom-enrich: ${report.enriched}/${report.components} component(s) corrected `
      + `(${JSON.stringify(report.byResolution)}), ${report.unmatched} unmatched`;
  }
  if (report.unknownReason === 'unstated') return `sbom-enrich: PROVENANCE UNVERIFIED (unstated) — ${report.note}`;
  return `sbom-enrich: NOT ENRICHED (${report.unknownReason}) — ${report.note || report.detail}`;
}

function main(argv) {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const [cdxPath, nativePath] = positional;
  const ri = args.indexOf('--report');
  const reportPath = ri >= 0 ? args[ri + 1] : (cdxPath ? cdxPath.replace(/\.json$/, '') + '-provenance.json' : null);
  if (!cdxPath || !nativePath) {
    process.stderr.write('usage: sbom-enrich.mjs <cyclonedx.json> <native-syft.json> [--report <file>]\n');
    process.exit(2);
  }
  if (!existsSync(cdxPath)) {
    // The scan itself did not produce a document. That is the scan's failure to report, not ours.
    process.stderr.write(`sbom-enrich: ${cdxPath} does not exist — syft wrote no CycloneDX\n`);
    process.exit(1);
  }
  const { ok, report } = run(cdxPath, nativePath, reportPath);
  process.stdout.write(`${summaryLine(report)}\n`);
  process.exit(ok ? 0 : 1);
}

if (isMainModule(import.meta.url)) main(process.argv);

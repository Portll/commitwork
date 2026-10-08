// cra/report.mjs — Art. 14 report drafts (24h early warning / 72h notification / 14-day final).
//
// DRAFTS, not submissions: a human reviews and submits via the ENISA single reporting
// platform (routes to your coordinating national CSIRT). Each draft is emitted as both
// markdown (human review) and JSON (future SRP payload mapping), derived from the case
// record + slice/ledger evidence so every statement is traceable to a scan artifact.
//
// Zero deps. Used by watch.mjs; also runnable standalone:
//   node cra/report.mjs <caseId>

import { isMainModule } from '../lib/is-main.mjs';
import { join } from 'node:path';
import { loadJSON, writeTextAtomic, writeJSONAtomic, resolvePaths, loadProducts, nowISO, resolveEvidenceForRepos } from './lib.mjs';

const DRAFT_BANNER =
  '> **DRAFT — NOT SUBMITTED.** Review every field, then submit via the ENISA single\n' +
  '> reporting platform (Art. 16 CRA); it routes to the CSIRT designated as coordinator.\n' +
  '> Obligations apply from 11 September 2026. This draft was generated from commitwork\n' +
  '> slice evidence; verify awareness time and exploitation status before submission.\n';

function fmtClock(label, iso, refIso) {
  const overdue = refIso && new Date(refIso) > new Date(iso);
  return `- **${label}:** ${iso}${overdue ? '  ⚠️ OVERDUE' : ''}`;
}

function caseHeader(kase, product, manufacturer) {
  const isIncident = kase.kind === 'incident';
  const subjectLine = isIncident
    ? `- **Incident:** ${kase.title || 'TODO'}${kase.summary ? ` — ${kase.summary}` : ''}`
    : `- **Vulnerability:** ${kase.vulnId}${kase.title ? ` — ${kase.title}` : ''}`;
  const triggerLine = isIncident
    ? '- **Trigger:** severe incident (manufacturer-declared) — Art. 14(1) second limb'
    : `- **Exploitation trigger:** ${kase.trigger} (${kase.trigger === 'kev' ? 'listed in CISA KEV — treat as actively exploited' : 'EPSS exploitation probability over threshold — verify active exploitation'})`;
  return [
    `- **Case:** ${kase.caseId} _(${kase.kind || 'vulnerability'})_`,
    `- **Manufacturer:** ${manufacturer.name || 'TODO'} (${manufacturer.contact || 'TODO contact'})`,
    manufacturer.euRepresentative ? `- **EU authorised representative:** ${manufacturer.euRepresentative}` : null,
    `- **Product:** ${product.name} ${product.version} (id: ${product.id})`,
    subjectLine,
    `- **Affected packages:** ${(kase.packages || []).join(', ') || 'n/a'}`,
    `- **Affected components (repos):** ${(kase.repos || []).join(', ') || 'n/a'}`,
    isIncident
      ? `- **Severity:** ${kase.severity || 'TODO — assess impact on confidentiality / integrity / availability'}`
      : `- **Severity:** ${kase.severity || 'unknown'}${kase.cvss ? ` (CVSS ${kase.cvss})` : ''} · EPSS ${kase.epss == null ? 'unknown' : kase.epss} · KEV ${kase.kev ? 'YES' : 'no'}`,
    triggerLine,
    kase.advisory ? `- **Advisory:** ${kase.advisory}` : null,
  ].filter(Boolean).join('\n');
}

const subject = (kase) => (kase.kind === 'incident' ? `incident "${kase.title || 'untitled'}"` : kase.vulnId);

function clocksBlock(kase, ref) {
  return [
    `- **Awareness basis:** ${kase.clocks.basis}`,
    fmtClock('Early warning due (awareness + 24h)', kase.clocks.earlyWarningDue, ref),
    fmtClock('Vulnerability notification due (awareness + 72h)', kase.clocks.notificationDue, ref),
    fmtClock(`Final report due (${kase.clocks.finalBasis || 'awareness + 14 days — recomputed from when a corrective measure is available (`watch.mjs measure`)'})`, kase.clocks.finalDue, ref),
  ].join('\n');
}

export function renderEarlyWarning(kase, product, manufacturer, ref = nowISO()) {
  const md = `# CRA Art. 14 — Early warning (24h) — ${subject(kase)} in ${product.name}

${DRAFT_BANNER}
## Identification

${caseHeader(kase, product, manufacturer)}

## Early-warning content (Art. 14(2)(a))

- **Notification type:** ${kase.kind === 'incident' ? 'severe incident' : 'actively exploited vulnerability'} — early warning
- **Suspected unlawful or malicious act:** TODO — state whether the exploitation is
  suspected to result from unlawful or malicious acts (required field; default unknown)
- **Cross-border relevance:** TODO — indicate if the product is made available in more
  than one Member State
- **First detected by monitoring:** ${kase.firstDetectedAt} (slice ${kase.slices[0] || 'n/a'})
- **Awareness:** ${kase.awarenessAt || `not yet acknowledged — clock currently runs from detection (${kase.firstDetectedAt}); acknowledge with \`node cra/watch.mjs ack ${kase.caseId}\``}

## Clocks

${clocksBlock(kase, ref)}

## Evidence trail

- Detection source: commitwork sweep slice(s) ${kase.slices.join(', ') || 'n/a'} (provenance-gated; tool runs recorded in checks-status.json)
- Case event log: cra/cases.json (hash-chained; verify with \`node cra/watch.mjs verify\`)
`;
  const json = {
    type: 'early-warning', case: kase.caseId, vulnId: kase.vulnId,
    manufacturer, product: { id: product.id, name: product.name, version: product.version },
    suspectedMalicious: null, crossBorder: null,
    firstDetectedAt: kase.firstDetectedAt, awarenessAt: kase.awarenessAt, clocks: kase.clocks,
    generatedAt: ref, draft: true,
  };
  return { md, json };
}

export function renderNotification(kase, product, manufacturer, ref = nowISO()) {
  const md = `# CRA Art. 14 — ${kase.kind === 'incident' ? 'Incident' : 'Vulnerability'} notification (72h) — ${subject(kase)} in ${product.name}

${DRAFT_BANNER}
## Identification

${caseHeader(kase, product, manufacturer)}

## Notification content (Art. 14(2)(b))

- **General information about the product:** ${product.description || 'TODO'}
- **Affected version(s):** ${product.version} (confirm against the product SBOM: reports/cra/sbom/)
- **General nature of the exploit:** TODO — how the vulnerability is being exploited, if known
- **Initial assessment — severity & impact:** ${kase.severity || 'unknown'}${kase.cvss ? `, CVSS ${kase.cvss}` : ''}; TODO impact on users (confidentiality / integrity / availability)
- **Corrective or mitigating measures taken:** ${kase.measures?.length ? kase.measures.map((m) => `${m.detail} (${m.at})`).join('; ') : 'TODO — none recorded yet; record with `node cra/watch.mjs measure ' + kase.caseId + ' --detail "..."`'}
- **Corrective or mitigating measures users can take:** TODO
- **Sensitivity:** indicate if you consider the notified information sensitive

## Clocks

${clocksBlock(kase, ref)}
`;
  const json = {
    type: 'vulnerability-notification', case: kase.caseId, vulnId: kase.vulnId,
    manufacturer, product: { id: product.id, name: product.name, version: product.version },
    severity: kase.severity, cvss: kase.cvss ?? null, epss: kase.epss, kev: kase.kev,
    measures: kase.measures || [], clocks: kase.clocks, generatedAt: ref, draft: true,
  };
  return { md, json };
}

export function renderFinal(kase, product, manufacturer, ledgerEntries = [], ref = nowISO()) {
  const fixes = (kase.vulnId ? ledgerEntries : [])
    .filter((e) => e.vulnId === kase.vulnId && (kase.repos || []).includes(e.repo) && ['strong', 'medium'].includes(e.evidence?.tier))
    .map((e) => `- ${e.repo}: ${e.package} ${e.fromVersion || '?'} → ${e.toVersion || '?'} (evidence: ${e.evidence.tier} — ${e.evidence.detail}${e.fixCommit ? `; commit ${e.fixCommit}` : ''})`);
  const dueLabel = kase.kind === 'incident' ? 'one month after notification' : '14 days';
  const md = `# CRA Art. 14 — Final report (${dueLabel}) — ${subject(kase)} in ${product.name}

${DRAFT_BANNER}
## Identification

${caseHeader(kase, product, manufacturer)}

## Final report content (Art. 14(2)(c))

- **Description of the ${kase.kind === 'incident' ? 'incident' : 'vulnerability'}:** ${kase.title || 'TODO'}${kase.vulnId ? ` (${kase.vulnId})` : ''}
- **Severity and impact:** ${kase.severity || 'unknown'}${kase.cvss ? `, CVSS ${kase.cvss}` : ''}; TODO final impact statement
- **Root cause (if available):** TODO
- **Corrective or mitigating measures applied:**
${fixes.length ? fixes.join('\n') : '  - TODO — no verified fix in the remediation ledger yet for this vulnerability (weak/unconfirmed evidence is deliberately excluded)'}
- **Security update availability:** TODO — where users obtain the fix, free of charge

## Verified-remediation evidence

${fixes.length ? 'The measures above are backed by the commitwork remediation ledger (evidence-tiered; strong = lockfile diff between slice git anchors).' : 'No strong/medium-tier ledger entry yet — the final report should not claim remediation until one exists.'}

## Clocks

${clocksBlock(kase, ref)}
`;
  const json = {
    type: 'final-report', case: kase.caseId, vulnId: kase.vulnId,
    manufacturer, product: { id: product.id, name: product.name, version: product.version },
    verifiedFixes: fixes, clocks: kase.clocks, generatedAt: ref, draft: true,
  };
  return { md, json };
}

export function writeCaseReports(kase, product, manufacturer, ledgerEntries, outDir, ref = nowISO()) {
  const dir = join(outDir, 'cases', kase.caseId);
  const ew = renderEarlyWarning(kase, product, manufacturer, ref);
  const no = renderNotification(kase, product, manufacturer, ref);
  const fi = renderFinal(kase, product, manufacturer, ledgerEntries, ref);
  writeTextAtomic(join(dir, 'early-warning.md'), ew.md);
  writeJSONAtomic(join(dir, 'early-warning.json'), ew.json);
  writeTextAtomic(join(dir, 'notification.md'), no.md);
  writeJSONAtomic(join(dir, 'notification.json'), no.json);
  writeTextAtomic(join(dir, 'final-report.md'), fi.md);
  writeJSONAtomic(join(dir, 'final-report.json'), fi.json);
  return dir;
}

// ── standalone: node cra/report.mjs <caseId> ─────────────────────────────────
if (isMainModule(import.meta.url)) {
  const caseId = process.argv[2];
  if (!caseId) { console.error('usage: node cra/report.mjs <caseId>'); process.exit(2); }
  const paths = resolvePaths();
  const casesDoc = loadJSON(paths.cases, { cases: {} });
  const kase = casesDoc.cases?.[caseId];
  if (!kase) { console.error(`no such case: ${caseId}`); process.exit(2); }
  const { products, manufacturer } = loadProducts(paths.products);
  const product = products.find((p) => p.id === kase.productId);
  // R22 fix 1: the case's own affected repos, merged across whichever declared area(s) they
  // resolve to — not the single global ledger, which only ever held the AMBIENT area's
  // evidence. A case whose product lives elsewhere used to render "no verified fix in the
  // ledger yet" even when a real evidence-tiered fix existed, just filed under a different area.
  const repos = kase.repos?.length ? kase.repos : (product?.repos || []);
  const { ledgerEntries } = resolveEvidenceForRepos(repos, paths);
  const dir = writeCaseReports(kase, product, manufacturer, ledgerEntries, paths.out);
  console.log(`drafts written: ${dir}`);
}

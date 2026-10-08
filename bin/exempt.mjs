#!/usr/bin/env node
// bin/exempt.mjs — the sanctioned write path for monitor/private/gate-exemptions.json: appends an
// exemption and emits the matching suppression-label (C-5 fatigue ledger) in the same write.
// Store is append-only — never delete, set expires.
//
// usage:
//   node bin/exempt.mjs --gate qg-openapi --service svc-api-gateway --area clientA \
//     --reason "why this judgment call is safe" --who "name (approval basis)" \
//     [--expires 2027-01-01T00:00:00Z --expires-reason "why this horizon"] [--force] [--dry]
//
// CW_GATE_EXEMPTIONS overrides the store path; CW_VERDICT_DIR routes the label (both read at call
// time, so tests run entirely on fixtures).
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSuppressionLabel } from '../monitor/annotate-lib.mjs';
import { appendRecord, adjudicationsPath, redactLedgerFields } from './lib/verdict-journal-core.mjs';
import { acquireLock } from '../monitor/lockfile.mjs';
import { gateExemptionsPathFor } from '../monitor/store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const storePath = () => gateExemptionsPathFor(REPO);

// gate = manifest check id; a typo is refused with the roster, never appended as an unmatchable gate.
const GATES = ['qg-boot-test', 'qg-contract-tests', 'qg-openapi', 'qg-ci', 'qg-boot-test-pass'];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.lastIndexOf(name); return i >= 0 ? args[i + 1] : null; };
const has = (name) => args.includes(name);

const gate = flag('--gate');
const service = flag('--service');
const area = flag('--area');
const reason = flag('--reason');
const who = flag('--who');
const expires = flag('--expires');
const expiresReason = flag('--expires-reason');

const errs = [];
if (!GATES.includes(gate)) errs.push(`--gate must be one of ${GATES.join(' | ')} (got ${gate ?? 'nothing'})`);
if (!service) errs.push('--service is required (service dir name)');
if (!area) errs.push('--area is required (registry area slug)');
if (!reason || reason.trim().length < 20) errs.push('--reason is required and must actually explain the judgment (≥20 chars) — validate-authored-judgment lints this field');
if (!who) errs.push('--who is required (who decided, and on what basis)');
if (expires && Number.isNaN(Date.parse(expires))) errs.push(`--expires is not a parseable date: ${expires}`);
if (expires && !expiresReason) errs.push('--expires-reason is required with --expires (why this horizon — the store\'s own exemplar shows the shape)');
if (errs.length) {
  console.error('refusing to write an invalid exemption:');
  for (const e of errs) console.error(`  - ${e}`);
  process.exit(1);
}

const at = new Date().toISOString();
const entry = {
  gate, service, area, action: 'exempt', reason, who, at,
  ...(expires ? { expires, expiresReason } : {}),
};

let doc;
try { doc = JSON.parse(readFileSync(storePath(), 'utf8')); }
catch (e) {
  // Fail closed: only ENOENT means a fresh store — never replace a corrupt one.
  if (e.code !== 'ENOENT') { console.error(`gate-exemptions store is unreadable (${e.message}) — refusing to overwrite it; fix it first`); process.exit(1); }
  doc = { exemptions: [] };
}
if (!Array.isArray(doc.exemptions)) { console.error('store has no exemptions[] array — refusing to guess its shape'); process.exit(1); }

// One ACTIVE entry per (gate, service, area) — a duplicate doubles fatigue counts.
const now = at;
const active = doc.exemptions.find((x) => x.gate === gate && x.service === service && x.area === area
  && (!x.expires || x.expires > now));
if (active && !has('--force')) {
  console.error(`an ACTIVE exemption for ${gate}:${service}@${area} already exists (at ${active.at}${active.expires ? `, expires ${active.expires}` : ', no expires'}).`);
  console.error('Extend it by setting expires on the old entry and appending anew, or --force to append anyway.');
  process.exit(1);
}

if (has('--dry')) { console.log(`(dry) would append to ${storePath()}:`); console.log(JSON.stringify(entry, null, 2)); process.exit(0); }

const LOCK = join(dirname(storePath()), '.gate-exemptions.lock');
const lock = acquireLock(LOCK, { staleMs: 30_000, label: 'exempt-cli', attempts: 50, spinMs: 20 });
if (!lock.ok) { console.error(`gate-exemptions store is locked (${LOCK}${lock.holder ? `, held by '${lock.holder.label}'` : ''}) — try again`); process.exit(1); }
try {
  doc.exemptions.push(entry);
  const tmp = `${storePath()}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, storePath());
} finally { lock.release(); }
console.log(`appended to ${storePath()} (${doc.exemptions.length} exemption(s) total). Applied by the next rollup as-of ${at}.`);

// A no-expires exemption is flagged and counted, never blocked.
const label = buildSuppressionLabel({
  target: `${gate}:${service}@${area}`,
  action: 'exempt', who, at,
  ...(expires ? { expires } : { noExpires: true }),
});
const res = appendRecord(adjudicationsPath(), redactLedgerFields(label));
if (!res.ok) console.error(`warning: suppression-label not recorded (${res.error}) — the exemption write itself succeeded`);
else console.log('suppression-label recorded (C-5 fatigue ledger).');

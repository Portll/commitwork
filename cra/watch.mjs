#!/usr/bin/env node
// cra/watch.mjs — exploited-vulnerability watch with CRA Art. 14 reporting clocks.
//
// The CRA's reporting trigger is an ACTIVELY EXPLOITED vulnerability (or severe
// incident) in a product placed on the EU market. The monitor already knows every
// open finding per repo (rollup) and enriches with KEV/EPSS; this watch closes the
// loop: it joins open findings × the CURRENT KEV catalog × EPSS, maps repos onto
// products (the product registry, monitor/private/cra-products.json), and opens a CASE the moment a finding crosses the
// trigger — starting the 24h / 72h / 14-day clocks and generating report drafts.
//
// A nightly sweep is too slow for a 24-hour clock: run this every 30 minutes via the launchd agent
// com.portll.commitwork-cra-watch, which monitor/install-agents.mjs generates per machine
// (`node monitor/install-agents.mjs --write --load`) — there is no committed plist. Set CRA_FETCH=1
// to refresh the KEV catalog from CISA on each run (graceful offline fallback to the cached copy);
// the generated agent sets it.
//
// The case log (cra/cases.json) is append-only and hash-chained: every event carries
// prevHash+hash, so the sequence of what-was-known-when is tamper-evident. `verify`
// recomputes the chain. Timestamps honour CW_CRA_NOW for deterministic tests.
//
// Commands:
//   watch (default)      join inputs, open/update cases, write drafts, print status
//   list                 print case table (--json for machine output)
//   ack <caseId> [--at ISO]        record real awareness (clocks recompute from it)
//   measure <caseId> --detail "…" [--at ISO]   corrective/mitigating measure available
//                        (final-report clock re-bases to measure time + 14d)
//   close <caseId> --reason "…"
//   verify               recompute the hash chain; non-zero exit if broken
//
// Exit codes: 0 ok · 2 usage/config error · 3 = at least one case clock is OVERDUE · 4 stale
// evidence · 5 an overdue clock could not be paged · 6 the case log was locked by another writer,
// so this run wrote NOTHING (see updateCases in ./lib.mjs — the ledger fails closed).
//
// Zero deps.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadJSON, writeJSONAtomic, resolvePaths, loadProducts, kevSet, epssFor, openFindings,
  nowISO, addHours, addDays, addMonths, isOverdue, hoursSince, chainHash, sha256, slugify,
  emptyCasesDoc, appendCaseEvent, updateCases, CLOCK_SPEC, clockSpecFor, kevFreshness,
} from './lib.mjs';
import { writeCaseReports } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EPSS_THRESHOLD = Number(process.env.CRA_EPSS_THRESHOLD || 0.5);
const EPSS_WARN = Number(process.env.CRA_EPSS_WARN || 0.1);
const CRIT_CVSS = Number(process.env.CRA_CRIT_CVSS || 9.0);
const CLOCK_LABELS = CLOCK_SPEC.article14.map((c) => [c.label, c.key]);
const KEV_URL = process.env.CRA_KEV_URL || 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s), cy = (s) => c('36', s);

// emptyCasesDoc / appendCaseEvent / updateCases live in ./lib.mjs — every writer of cases.json goes
// through updateCases, which locks and loads the document itself.

// THREE TRACKS, NEVER MERGED. Two INDEPENDENT questions decide the track:
//   (1) did a REPORTABLE trigger fire — actual or predicted exploitation, or a declared incident?
//   (2) is there an advisory body DELEGATED for this product's locale to receive the report?
//
// fact: `article14` — (1) yes, (2) yes: a regulatory obligation, with clocks owed to a NAMED body, drafts generated and escalation pages (expiry: never, prev: unknown)
// fact: `bestpractice` — (1) yes, (2) no body delegated: the same 24h/72h/final clocks run as discipline / the reason they exist does not depend on who is listening, and nothing being filed is DISPLAYED rather than rendered "not applicable" — delegate a body and it becomes article14 with clocks already running from awareness (expiry: never, prev: wrong)
// fact: `internal` — (1) no: a critical finding with no evidence of exploitation, on the own-policy schedule / the CRA triggers on EXPLOITATION, a high CVSS is not that, and clocking it would manufacture an obligation the regulation does not create (expiry: never, prev: wrong)
//
// trackOf() is the ONE place this is decided; consumers read the field, never re-derive it.
// `incident-declared` is FIRST because an Art. 14(3) severe incident is declared by a human, not
// derived from a rollup — omitting it silently demotes every declared incident to internal.
export const ARTICLE14_TRIGGERS = Object.freeze(['incident-declared', 'kev', 'epss']);

// ── advisory-body delegation, resolved from the DIRECTORY ───────────────────────────────────────
// Not a hand-written map. cra/csirt-directory.json (schema/csirt-directory.schema.json) holds the
// Art. 14(7) cascade verbatim plus the 27 Member States; a locale that is not in it resolves to
// `unrecognised`, which is a DIFFERENT state from "recognised, no body sourced yet". A typo used to
// be indistinguishable from an honest gap — see REMEDIATION-schema-derivation-2026-08-22.md R5.
//
// Under Art. 14(7) the report goes to ENISA's SRP AND the coordinator CSIRT of the Member State the
// cascade selects. `EU` alone therefore cannot name the CSIRT — a Member State code is required for
// that, and until one is declared the CSIRT half is reported as undetermined rather than guessed.
let _dir = null;
export function csirtDirectory() {
  if (!_dir) _dir = loadJSON(join(HERE, 'csirt-directory.json'));
  return _dir;
}
const ENISA = 'ENISA (Single Reporting Platform)';

export function reportingFor(product) {
  const declared = product?.reporting?.locale || (product?.market?.eu ? 'EU' : null);
  if (!declared) return { locale: null, regime: null, bodies: [], why: 'no reporting locale declared for this product' };

  const dir = csirtDirectory();
  const state = (dir.memberStates || []).find((m) => m.code === declared);
  if (state) {
    const csirt = state.coordinator;
    return {
      locale: declared,
      regime: 'regulatory',
      // ENISA is always owed; the CSIRT is owed too and is named only when sourced.
      bodies: csirt ? [ENISA, `${csirt.name} (coordinator CSIRT, ${state.name})`] : [ENISA],
      csirt: csirt ? { ...csirt, memberState: state.code } : null,
      why: csirt
        ? `Art. 14(7): ENISA + the coordinator CSIRT of ${state.name}`
        : `Art. 14(7): ENISA is owed a report; the coordinator CSIRT for ${state.name} is NOT YET SOURCED in cra/csirt-directory.json — the obligation stands, the end-point is unknown`,
    };
  }
  if (declared === 'EU') {
    // The union without a Member State: ENISA is determinable, the CSIRT is not.
    return {
      locale: 'EU', regime: 'regulatory', bodies: [ENISA], csirt: null,
      why: 'Art. 14(7) selects the coordinator CSIRT by MEMBER STATE — declare one (reporting.locale: "DE", …) or the CSIRT half of the obligation cannot be resolved',
    };
  }
  const bench = (dir.benchmarkRegimes || []).find((b) => b.code === declared);
  if (bench) {
    return {
      locale: declared, regime: 'benchmark', bodies: [], csirt: null,
      why: `${bench.name}: CRA timeline followed as a benchmark, no CRA body is owed a report — ${bench.rationale}`,
    };
  }
  // Unrecognised is its OWN state. Silently treating it as an undelegated locale turns a typo into
  // what looks like a deliberate known gap.
  return {
    locale: declared, regime: 'unrecognised', bodies: [], csirt: null,
    why: `locale "${declared}" is in neither memberStates nor benchmarkRegimes of cra/csirt-directory.json — check the spelling, or add it`,
  };
}
// Ratchet order for a case whose trigger changes between sweeps. Higher wins; a case never
// de-escalates off the Art. 14 track on its own. A declared incident outranks everything — it is a
// human act and no sweep may overwrite it.
export const TRIGGER_RANK = Object.freeze({ 'incident-declared': 4, kev: 3, epss: 2, crit: 1, 'near-miss': 0 });
export const trackOf = (kase) => {
  if (!ARTICLE14_TRIGGERS.includes(kase.trigger)) return 'internal';
  return kase.reporting?.bodies?.length ? 'article14' : 'bestpractice';
};
/** Only the regulatory track may produce a filing. bestpractice runs the clocks and files nothing. */
export const isFilable = (kase) => trackOf(kase) === 'article14';

// Internal-policy clocks. Deliberately NOT 24/72h: reusing the Art. 14 numbers would make an
// internal clock indistinguishable from a regulatory one at a glance, which is the whole failure
// this split exists to prevent.
const INTERNAL_TRIAGE_H = Number(process.env.CRA_INTERNAL_TRIAGE_HOURS || 72);
const INTERNAL_FIX_DAYS = Number(process.env.CRA_INTERNAL_FIX_DAYS || 30);

// Art. 14 clocks. The final-report deadline differs by case kind:
//  - vulnerability: 14 days after a corrective/mitigating measure is available (14(4)(a));
//  - incident:      one month after the incident notification (point b) is SUBMITTED (14(4)(c)).
function computeClocks(kase) {
  const basisAt = kase.awarenessAt || kase.firstDetectedAt;
  const basis = kase.awarenessAt
    ? `acknowledged awareness at ${kase.awarenessAt}`
    : `detection time ${kase.firstDetectedAt} (unacknowledged — ack to set true awareness)`;
  const track = trackOf(kase);
  if (track === 'internal') {
    const lastMeasure = (kase.measures || [])[kase.measures?.length - 1];
    return {
      track: 'internal',
      regime: `commitwork internal policy (${INTERNAL_TRIAGE_H}h triage / ${INTERNAL_FIX_DAYS}d remediate) — NOT a CRA Art. 14 obligation`,
      basis, basisAt,
      triageDue: addHours(basisAt, INTERNAL_TRIAGE_H),
      remediateDue: lastMeasure ? lastMeasure.at : addDays(basisAt, INTERNAL_FIX_DAYS),
      remediateBasis: lastMeasure ? `measure recorded ${lastMeasure.at}` : `detection + ${INTERNAL_FIX_DAYS} days`,
    };
  }
  const earlyWarningDue = addHours(basisAt, 24);
  const notificationDue = addHours(basisAt, 72);
  if (kase.kind === 'incident') {
    const submitted = kase.submitted?.notification;
    return {
      track,
      regime: track === 'article14'
        ? `CRA Art. 14(3) severe incident — 24h early warning / 72h notification / 1 month final, owed to ${kase.reporting.bodies.join(' + ')}`
        : `CRA Art. 14(3) timeline followed as BEST PRACTICE — ${kase.reporting?.why || 'no advisory body delegated'}. Clocks run; nothing is filed.`,
      basis, basisAt, earlyWarningDue, notificationDue,
      finalDue: addMonths(submitted || notificationDue, 1),
      finalBasis: submitted
        ? `incident notification submitted ${submitted} + 1 month`
        : 'notification due (awareness + 72h) + 1 month (re-bases when the notification is submitted: `submit <case> --stage notification`)',
    };
  }
  const lastMeasure = (kase.measures || [])[kase.measures?.length - 1];
  return {
    track,
    regime: track === 'article14'
      ? `CRA Art. 14(1) actively exploited vulnerability — 24h early warning / 72h notification / 14d final, owed to ${kase.reporting.bodies.join(' + ')}`
      : `CRA Art. 14(1) timeline followed as BEST PRACTICE — ${kase.reporting?.why || 'no advisory body delegated'}. Clocks run; nothing is filed.`,
    basis, basisAt, earlyWarningDue, notificationDue,
    finalDue: lastMeasure ? addDays(lastMeasure.at, 14) : addDays(basisAt, 14),
    finalBasis: lastMeasure
      ? `corrective measure available ${lastMeasure.at} + 14 days`
      : 'awareness + 14 days (re-based when a measure is recorded)',
  };
}

async function refreshKev(paths) {
  if (process.env.CRA_FETCH !== '1') return;
  try {
    const res = await fetch(KEV_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    if (!Array.isArray(doc.vulnerabilities)) throw new Error('unexpected KEV shape');
    writeJSONAtomic(paths.kev, doc);
    console.log(dim(`  KEV catalog refreshed (${doc.vulnerabilities.length} entries)`));
  } catch (e) {
    console.error(yel(`  KEV refresh failed (${e.message}) — using cached catalog`));
  }
}

// ── the join: open findings × KEV/EPSS × products ────────────────────────────
function computeTriggers(paths) {
  const rollup = loadJSON(paths.rollup);
  const kev = kevSet(loadJSON(paths.kev, {}));
  const epss = loadJSON(paths.epss, {});
  const { products, byRepo, manufacturer } = loadProducts(paths.products);

  const triggers = [];   // every trigger on a mapped product; the locale picks the track, not this list
  const advisories = []; // a repo mapped to no product, or an EPSS near-miss below the trigger
  const byCase = new Map();

  for (const f of openFindings(rollup)) {
    if (!f.id || !/^(CVE|GHSA)-/i.test(f.id)) continue;
    const inKev = f.kev === true || kev.has(f.id);
    const score = typeof f.epss === 'number' ? f.epss : epssFor(epss, f.id); // null = unknown, never 0 (B1)
    // Order matters and is legal, not stylistic: kev and epss are Art. 14 triggers, crit is ours.
    // A finding that is BOTH exploited and critical is an Art. 14 case — the regulatory track always
    // wins, so `crit` can only ever be reached when neither Art. 14 trigger fired.
    const isCrit = f.severity === 'crit' || (typeof f.cvss === 'number' && f.cvss >= CRIT_CVSS);
    const trigger = inKev ? 'kev'
      : (score != null && score >= EPSS_THRESHOLD ? 'epss'
        : (isCrit ? 'crit' : null));
    const near = !trigger && score != null && score >= EPSS_WARN;
    if (!trigger && !near) continue;

    const prods = byRepo.get(f.repo) || [];
    const record = { finding: f, kev: inKev, epss: score, trigger: trigger || 'near-miss' };
    if (!prods.length) { advisories.push({ ...record, reason: `repo ${f.repo} not mapped to any product` }); continue; }
    for (const prod of prods) {
      if (!trigger) { advisories.push({ ...record, product: prod.id, reason: `EPSS ${score} ≥ warn ${EPSS_WARN} (below trigger ${EPSS_THRESHOLD})` }); continue; }
      // NO MARKET GATE. Locale decides who is OWED a report, never whether the clock runs — a
      // product outside the EU gets the same discipline on the bestpractice track, and delegating
      // a body later promotes it to article14 with its clocks already running from first awareness.
      const caseId = `${slugify(prod.id)}--${slugify(f.id)}`;
      if (!byCase.has(caseId)) {
        byCase.set(caseId, {
          caseId, productId: prod.id, vulnId: f.id.toUpperCase(),
          kind: 'vulnerability',
          reporting: reportingFor(prod),
          title: f.title || null, advisory: f.advisory || null,
          severity: f.severity || null, cvss: f.cvss ?? null, epss: score, kev: inKev, trigger,
          packages: [], repos: [], slices: rollup.sliceId ? [rollup.sliceId] : [],
        });
      }
      const kase = byCase.get(caseId);
      if (f.package && !kase.packages.includes(f.package)) kase.packages.push(f.package);
      if (!kase.repos.includes(f.repo)) kase.repos.push(f.repo);
      triggers.push(record);
    }
  }
  return { byCase, advisories, products, manufacturer, rollup };
}

// Material fields whose change warrants a case-updated event (not timestamps).
// EPSS drifts a little on every feed pull — only a move ≥ 0.05 is material, so the
// hash chain records signal, not noise.
function materialDiff(existing, computed) {
  const diff = {};
  // `reporting` is HERE and not merely re-assigned downstream: the assign only runs when a diff is
  // found, so without this a locale gaining an advisory body changes nothing until some unrelated
  // field happens to move. The case would sit on the bestpractice track with a body now delegated —
  // silently unreported, which is the failure the track split exists to make visible.
  for (const k of ['severity', 'cvss', 'kev', 'trigger', 'reporting']) {
    if (JSON.stringify(existing[k]) !== JSON.stringify(computed[k])) diff[k] = { from: existing[k], to: computed[k] };
  }
  if ((existing.epss == null) !== (computed.epss == null) ||
      (existing.epss != null && computed.epss != null && Math.abs(existing.epss - computed.epss) >= 0.05)) {
    diff.epss = { from: existing.epss, to: computed.epss };
  }
  const addRepos = computed.repos.filter((r) => !existing.repos.includes(r));
  const addPkgs = computed.packages.filter((p) => !existing.packages.includes(p));
  if (addRepos.length) diff.repos = { added: addRepos };
  if (addPkgs.length) diff.packages = { added: addPkgs };
  return Object.keys(diff).length ? diff : null;
}

// A 30-min watch reading a days-old rollup is silently blind — the sweep that feeds it
// may have stopped. Treat a stale slice as a coverage failure, surfaced loudly (grey ≠
// green applies to the pipeline itself, not just findings).
function evidenceStaleness(paths, at) {
  const rollup = loadJSON(paths.rollup, null);
  const generated = rollup?.generated || null;
  const maxHours = Number(process.env.CRA_STALE_HOURS || 26); // one nightly sweep + slack
  const ageHours = generated ? hoursSince(generated, at) : Infinity;
  return { generated, ageHours, maxHours, stale: !generated || ageHours > maxHours, sliceId: rollup?.sliceId || null };
}

// fact: KEV freshness is judged from the catalogue's OWN dateReleased/catalogVersion, NEVER this file's mtime (bifocal R21/C5) / kev.json is a tracked-turned-ignored cache, so a checkout reset its mtime to "now" and a dateReleased of 2026-07-01 — 28 days stale — read as 9 (expiry: never, prev: wrong)
// fact: EPSS's store is a flat {cveId: score} map with NO version/date field, so its freshness is reported 'unknown' in rollup.json's enrichment.epssFreshness / inventing one from mtime is the same defect (expiry: if the EPSS store gains a version field, prev: unknown)
// Both facts above hold for kevFreshness() in ./lib.mjs, which this file imports. It kept its own
// copy until 2026-09-27; the copy read the threshold separately, and one threshold now has one
// reader (kevStaleDays).

function cmdWatch(paths, opts) {
  const at = nowISO();
  // Read-only over rollup/KEV/EPSS, so it stays outside the case-log lock.
  const { byCase, advisories, products, manufacturer } = computeTriggers(paths);

  const res = updateCases(paths, (doc) => {
    let changed = false;
    for (const [caseId, computed] of byCase) {
      const existing = doc.cases[caseId];
      if (!existing) {
        // kind rides in from `computed` — hardcoding it here is what made Art. 14(3) incidents
        // unreachable, since every path into this function produced a `vulnerability`.
        const kase = { kind: 'vulnerability', ...computed, firstDetectedAt: at, awarenessAt: null, measures: [], status: 'open' };
        kase.clocks = computeClocks(kase);
        appendCaseEvent(doc, 'case-opened', caseId, { vulnId: kase.vulnId, productId: kase.productId, trigger: kase.trigger, kev: kase.kev, epss: kase.epss, repos: kase.repos, packages: kase.packages }, at);
        doc.cases[caseId] = kase;
        changed = true;
        console.log(red(`  ● CASE OPENED ${caseId} — ${kase.vulnId} (${kase.trigger}) in ${kase.productId} · early warning due ${kase.clocks.earlyWarningDue}`));
      } else if (existing.status !== 'closed') {
        const diff = materialDiff(existing, computed);
        if (diff) {
          Object.assign(existing, {
            // Re-synced every sweep: delegating a body for a locale must PROMOTE the open cases
            // already running on the bestpractice track, not only apply to cases opened afterwards.
            reporting: computed.reporting,
            severity: computed.severity, cvss: computed.cvss, epss: computed.epss, kev: existing.kev || computed.kev,
            // A case only ever RATCHETS toward the regulatory track. kev outranks epss outranks
            // crit; without this a case that fired on KEV last sweep and merely looks critical this
            // one would silently drop off the Art. 14 track and stop being reportable.
            trigger: TRIGGER_RANK[existing.trigger] >= TRIGGER_RANK[computed.trigger] ? existing.trigger : computed.trigger,
            repos: [...new Set([...existing.repos, ...computed.repos])],
            packages: [...new Set([...existing.packages, ...computed.packages])],
          });
          if (computed.slices?.[0] && !existing.slices.includes(computed.slices[0])) existing.slices.push(computed.slices[0]);
          existing.clocks = computeClocks(existing);
          appendCaseEvent(doc, 'case-updated', caseId, diff, at);
          changed = true;
          console.log(yel(`  ~ case updated ${caseId}: ${Object.keys(diff).join(', ')}`));
        } else if (computed.slices?.[0] && !existing.slices.includes(computed.slices[0])) {
          existing.slices.push(computed.slices[0]); // observed again in a new slice — state, not evidence event
          changed = true;
        }
      }
    }
    return changed;
  });

  // Fail closed: a refused tick opened no case, so printing a status table would render a detected
  // trigger as "no open Art. 14 cases". Exit 6 = the ledger could not be written.
  if (!res.ok) {
    console.error(red('  ⚠ case log not written — no case was opened or updated by this run. Re-run once the other writer finishes.'));
    process.exitCode = 6;
    return 0;
  }
  const doc = res.doc;

  // Drafts regenerate deterministically from the committed document, so they stay outside the lock.
  const ledger = loadJSON(paths.ledger, { entries: [] });
  for (const kase of Object.values(doc.cases)) {
    if (kase.status === 'closed') continue;
    // ONLY the regulatory track gets Art. 14 drafts. writeCaseReports emits an ENISA early-warning
    // and notification; producing one for an internal-policy case would put a draft filing for a
    // non-obligation on disk, one copy-paste from being submitted.
    if (trackOf(kase) !== 'article14') continue;
    const product = products.find((p) => p.id === kase.productId) || { id: kase.productId, name: kase.productId, version: '?' };
    writeCaseReports(kase, product, manufacturer, ledger.entries || [], paths.out, at);
  }

  return printStatus(doc, advisories, at, { ...opts, staleness: evidenceStaleness(paths, at), kevFreshness: kevFreshness(paths, at) });
}

function printStatus(doc, advisories, at, opts = {}) {
  const allOpen = Object.values(doc.cases).filter((k) => k.status !== 'closed');
  // The two tracks are counted separately EVERYWHERE. A single "N open cases" number that mixes a
  // regulatory obligation with our own policy clock is the over-reporting this split exists to
  // prevent, arriving by the back door of a total.
  const open = allOpen.filter((k) => trackOf(k) === 'article14');
  const bestpractice = allOpen.filter((k) => trackOf(k) === 'bestpractice');
  const internal = allOpen.filter((k) => trackOf(k) === 'internal');
  const stale = opts.staleness?.stale;
  let overdue = 0;
  if (opts.json) {
    console.log(JSON.stringify({ at, evidence: opts.staleness || null, kev: opts.kevFreshness || null, open, bestpractice, internal, advisories }, null, 2));
  } else {
    console.log('');
    console.log(bold(`cra watch — ${at}`));
    if (opts.staleness) {
      const s = opts.staleness;
      if (s.stale) console.log(red(`  ⚠ STALE EVIDENCE — latest slice ${s.sliceId || '(none)'} is ${s.generated ? Math.round(s.ageHours) + 'h old' : 'missing'} (> ${s.maxHours}h): the sweep feeding this watch may have stopped. Cases below reflect stale scans.`));
      else console.log(dim(`  evidence: slice ${s.sliceId} ${Math.round(s.ageHours)}h old (fresh, ≤ ${s.maxHours}h)`));
    }
    if (opts.kevFreshness) {
      const k = opts.kevFreshness;
      if (k.state === 'stale') console.log(red(`  ⚠ KEV CATALOGUE STALE — catalogVersion ${k.catalogVersion || '?'} (released ${k.dateReleased || '?'}) is ${k.ageDays}d old (> ${k.maxDays}d): CISA's list may have moved since. Refresh: CRA_FETCH=1 node cra/watch.mjs`));
      else if (k.state === 'unknown') console.log(yel(`  ⚠ KEV catalogue freshness unknown — ${k.reason || 'monitor/data/kev.json missing dateReleased'}`));
      else console.log(dim(`  KEV catalogue: catalogVersion ${k.catalogVersion || '?'} · ${k.ageDays}d old (fresh, ≤ ${k.maxDays}d)`));
    }
    if (!open.length) console.log(grn('  no open Art. 14 cases'));
    for (const k of open) {
      const flags = [];
      for (const [label, due] of [['24h early warning', k.clocks.earlyWarningDue], ['72h notification', k.clocks.notificationDue], ['14d final report', k.clocks.finalDue]]) {
        if (isOverdue(due, at)) { flags.push(`${label} OVERDUE (${due})`); overdue++; }
      }
      const state = flags.length ? red(`⏰ ${flags.join(' · ')}`) : grn(`clocks running (early warning due ${k.clocks.earlyWarningDue})`);
      console.log(`  ${k.status === 'open' ? red('●') : yel('◐')} ${bold(k.caseId)} ${dim(`[${k.trigger}${k.kev ? ',KEV' : ''} epss=${k.epss ?? 'unknown'}]`)} ${state}`);
      console.log(dim(`      drafts: reports/cra/cases/${k.caseId}/ · ack: node cra/watch.mjs ack ${k.caseId}`));
    }
    if (bestpractice.length) {
      console.log('');
      console.log(bold(`  best-practice clocks — Art. 14 timeline, NO ADVISORY BODY DELEGATED: ${bestpractice.length}`));
      for (const k of bestpractice) {
        const flags = CLOCK_LABELS.filter(([, key]) => k.clocks?.[key] && isOverdue(k.clocks[key], at)).map(([l]) => l);
        console.log(`  ${flags.length ? yel('◆') : cy('◇')} ${k.caseId} ${dim(`[${k.trigger}]`)} ${flags.length ? yel(`${flags.join(' · ')} OVERDUE`) : dim(`early warning due ${k.clocks.earlyWarningDue}`)}`);
        console.log(dim(`      ${k.reporting?.why || 'no locale declared'} — delegate one to make these filable`));
      }
    }
    if (internal.length) {
      console.log('');
      console.log(bold(`  internal policy clocks (NOT Art. 14, never filed): ${internal.length}`));
      for (const k of internal) {
        const late = isOverdue(k.clocks.triageDue, at);
        console.log(`  ${late ? yel('◆') : dim('◇')} ${k.caseId} ${dim(`[${k.trigger} cvss=${k.cvss ?? '?'}]`)} ${late ? yel(`triage overdue (${k.clocks.triageDue})`) : dim(`triage due ${k.clocks.triageDue}`)}`);
      }
      console.log(dim('      these do not page and do not affect the exit code — no regulator is owed them'));
    }
    if (advisories.length) {
      console.log('');
      console.log(bold(`  advisory (triggered but not CRA-scoped): ${advisories.length}`));
      for (const a of advisories.slice(0, 10)) {
        console.log(yel(`    ▪ ${a.finding.id} in ${a.finding.repo} [${a.trigger}${a.kev ? ',KEV' : ''} epss=${a.epss ?? 'unknown'}] — ${a.reason}`));
      }
      if (advisories.length > 10) console.log(dim(`    … ${advisories.length - 10} more`));
    }
  }
  // Exit signals for the launchd run (most urgent wins): 3 overdue clock, 4 stale evidence.
  if (overdue) { console.error(red(`  ${overdue} clock(s) OVERDUE`)); process.exitCode = 3; }
  else if (stale) { console.error(red('  evidence is stale — watch is running on scans that may be out of date')); process.exitCode = 4; }
  return overdue;
}

// Severe incidents are the CRA's second Art. 14 trigger. Unlike exploited vulnerabilities
// they are a human judgment, not a scan result — so they are DECLARED, then reuse the same
// clock/draft/hash-chain machinery (with the incident final-report rule).
function cmdIncident(paths, opts) {
  const title = opts.title;
  if (!opts.productId || !title) { console.error('usage: incident --product <id> --title "…" [--summary "…"] [--at ISO]'); process.exit(2); }
  const { products } = loadProducts(paths.products);
  const product = products.find((p) => p.id === opts.productId);
  if (!product) { console.error(red(`no such product: ${opts.productId}`)); process.exit(2); }
  const at = opts.at || nowISO();
  const caseId = `${slugify(product.id)}--incident--${sha256(product.id + '|' + title + '|' + at).slice(0, 8)}`;

  // Duplicate check goes inside the lock, or two declarations both pass and one replaces the other.
  let kase = null;
  const res = updateCases(paths, (doc) => {
    if (doc.cases[caseId]) return { save: false, result: 'exists' };
    kase = {
      caseId, kind: 'incident', productId: product.id, vulnId: null,
      reporting: reportingFor(product),
      title, summary: opts.summary || null, trigger: 'incident-declared',
      severity: null, cvss: null, epss: null, kev: false,
      packages: [], repos: [...(product.repos || [])], slices: [],
      firstDetectedAt: at, awarenessAt: at, measures: [], submitted: {}, status: 'acknowledged',
    };
    kase.clocks = computeClocks(kase);
    appendCaseEvent(doc, 'incident-declared', caseId, { productId: product.id, title, summary: kase.summary, by: process.env.USER || 'unknown' }, at);
    doc.cases[caseId] = kase;
    return { save: true, result: 'declared' };
  }, { label: 'cra-incident' });

  if (!res.ok) { console.error(red('  ⚠ incident NOT declared — the case log is locked by another writer. Nothing was recorded; re-run.')); process.exit(6); }
  if (res.result === 'exists') { console.error(red(`incident case already exists: ${caseId}`)); process.exit(2); }

  const { manufacturer } = loadProducts(paths.products);
  // Same gate as the watch loop. A severe incident on a product with no delegated advisory body is
  // real and its clocks run, but there is nobody to file with — so no draft notification is written.
  if (isFilable(kase)) writeCaseReports(kase, product, manufacturer, [], paths.out, at);
  else console.log(yel(`  no drafts written — ${kase.reporting?.why || 'no advisory body delegated'}. The clocks run; there is nobody to file with.`));
  console.log(red(`  ● INCIDENT DECLARED ${caseId} — "${title}" in ${product.id}`));
  console.log(dim(`      early warning due ${kase.clocks.earlyWarningDue} · notification due ${kase.clocks.notificationDue} · final report ${kase.clocks.finalDue}`));
  console.log(dim(`      drafts: reports/cra/cases/${caseId}/`));
}

// ack / measure / submit / close — load, existence check, mutation, append and write are one
// critical section. Exits happen after updateCases returns, never inside the mutator.
function mutateCase(paths, caseId, fn, eventType, data) {
  const res = updateCases(paths, (doc) => {
    const kase = doc.cases[caseId];
    if (!kase) return { save: false, result: 'missing' };
    const at = data.at || nowISO();
    fn(kase, at);
    kase.clocks = computeClocks(kase);
    appendCaseEvent(doc, eventType, caseId, data, at);
    return { save: true, result: 'mutated' };
  }, { label: `cra-${eventType}` });

  if (!res.ok) { console.error(red(`  ⚠ ${eventType} NOT recorded for ${caseId} — the case log is locked by another writer. Nothing was written; re-run.`)); process.exit(6); }
  if (res.result === 'missing') { console.error(red(`no such case: ${caseId}`)); process.exit(2); }
  console.log(grn(`  ✓ ${eventType} ${caseId}`));
  return res.doc;
}

function cmdVerify(paths) {
  const doc = existsSync(paths.cases) ? loadJSON(paths.cases) : emptyCasesDoc();
  let prev = null;
  for (const [i, ev] of doc.events.entries()) {
    if (ev.prevHash !== prev) { console.error(red(`chain broken at event ${i} (${ev.type} ${ev.caseId}): prevHash mismatch`)); process.exit(1); }
    const h = chainHash(ev.prevHash, ev);
    if (h !== ev.hash) { console.error(red(`chain broken at event ${i} (${ev.type} ${ev.caseId}): hash mismatch`)); process.exit(1); }
    prev = ev.hash;
  }
  console.log(grn(`  ✓ chain intact — ${doc.events.length} event(s)`));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// IMPORT GUARD. Without it, `import ... from './watch.mjs'` runs a REAL watch as a side effect of
// loading the module: cmd defaults to 'watch', so importing this file to read one exported constant
// opens cases and writes the hash-chained ledger. Found 2026-08-22 by a test that imported
// TRIGGER_RANK and thereby fired a sweep. Same shape as sweep.mjs's unknown-first-arg trap.
// Everything above this line is import-safe by construction; everything below is the CLI.
const INVOKED_DIRECTLY = process.argv[1] && /(^|[\\/])watch\.mjs$/.test(process.argv[1]);
const argv = INVOKED_DIRECTLY ? process.argv.slice(2) : [];
const cmd = INVOKED_DIRECTLY ? (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'watch') : null;
const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(k);
const paths = resolvePaths();

if (cmd === 'watch') {
  await refreshKev(paths);
  cmdWatch(paths, { json: has('--json') });
  // W3: the clocks are now computed and exitCode is set (3 = overdue). Page a human on any overdue,
  // unpaged clock instead of letting the deadline die into the launchd log. escalate() no-ops when
  // nothing is overdue; when a clock IS overdue and it cannot deliver a page, that is MORE urgent
  // than "overdue" itself, so raise the exit to 5. Skipped for --json (a programmatic read must not
  // page as a side effect). Dynamic import so a non-watch subcommand never loads the pager/secrets.
  if (!has('--json') && process.env.CW_ESCALATE !== '0') {
    const { escalate } = await import('./escalate.mjs');
    const esc = await escalate({ paths });
    if (esc.exit === 5) process.exitCode = 5;
  }
} else if (cmd === 'list') {
  const doc = existsSync(paths.cases) ? loadJSON(paths.cases) : emptyCasesDoc();
  const at = nowISO();
  printStatus(doc, [], at, { json: has('--json'), staleness: evidenceStaleness(paths, at), kevFreshness: kevFreshness(paths, at) });
} else if (cmd === 'incident') {
  cmdIncident(paths, { productId: flag('--product'), title: flag('--title'), summary: flag('--summary'), at: flag('--at') });
} else if (cmd === 'submit') {
  const stage = flag('--stage');
  if (!['early-warning', 'notification', 'final-report'].includes(stage)) {
    console.error('usage: submit <caseId> --stage <early-warning|notification|final-report> [--at ISO]'); process.exit(2);
  }
  mutateCase(paths, argv[1], (k, at) => { (k.submitted ||= {})[stage] = flag('--at') || at; },
    'report-submitted', { at: flag('--at'), stage, by: process.env.USER || 'unknown' });
} else if (cmd === 'ack') {
  mutateCase(paths, argv[1], (k, at) => { k.awarenessAt = flag('--at') || at; k.status = 'acknowledged'; },
    'acknowledged', { at: flag('--at'), by: process.env.USER || 'unknown' });
} else if (cmd === 'measure') {
  const detail = flag('--detail');
  if (!detail) { console.error('usage: measure <caseId> --detail "…" [--at ISO]'); process.exit(2); }
  mutateCase(paths, argv[1], (k, at) => { (k.measures ||= []).push({ detail, at: flag('--at') || at }); },
    'measure-available', { at: flag('--at'), detail, by: process.env.USER || 'unknown' });
} else if (cmd === 'close') {
  const reason = flag('--reason');
  if (!reason) { console.error('usage: close <caseId> --reason "…"'); process.exit(2); }
  mutateCase(paths, argv[1], (k) => { k.status = 'closed'; k.closedReason = reason; },
    'case-closed', { reason, by: process.env.USER || 'unknown' });
} else if (cmd === 'report') {
  const doc = existsSync(paths.cases) ? loadJSON(paths.cases) : emptyCasesDoc();
  const kase = doc.cases[argv[1]];
  if (!kase) { console.error(red(`no such case: ${argv[1]}`)); process.exit(2); }
  const { products, manufacturer } = loadProducts(paths.products);
  const product = products.find((p) => p.id === kase.productId);
  const ledger = loadJSON(paths.ledger, { entries: [] });
  // Explicit `report` is still gated: asking for a draft does not create an obligation to file one.
  if (!isFilable(kase)) {
    console.error(red(`refusing to draft a filing for ${kase.caseId} — ${kase.reporting?.why || 'no advisory body delegated'} (track: ${trackOf(kase)}).`));
    console.error(dim('  Its clocks are running and visible; delegate an advisory body for the locale to make it filable.'));
    process.exit(2);
  }
  console.log(`drafts: ${writeCaseReports(kase, product, manufacturer, ledger.entries || [], paths.out)}`);
} else if (cmd === 'verify') {
  cmdVerify(paths);
} else if (INVOKED_DIRECTLY) {
  console.log(`usage: node cra/watch.mjs [watch|list|incident|ack|measure|submit|close|report|verify] …
  watch                      (default) join open findings × KEV/EPSS × products; open cases; write drafts
  list [--json]              show open cases, clock state, and evidence freshness
  incident --product <id> --title "…" [--summary "…"] [--at ISO]
                             declare a severe incident (Art. 14 2nd trigger; final report = notification + 1 month)
  ack <caseId> [--at ISO]    record awareness (Art. 14 clocks re-base to it)
  measure <caseId> --detail "…" [--at ISO]   record corrective measure (vuln final report = measure + 14d)
  submit <caseId> --stage <early-warning|notification|final-report> [--at ISO]
                             record that a report was submitted to the SRP (incident final clock re-bases off notification)
  close <caseId> --reason "…"
  report <caseId>            regenerate the three Art. 14 drafts
  verify                     verify the hash chain over cra/cases.json
env: CRA_EPSS_THRESHOLD (${EPSS_THRESHOLD}) CRA_EPSS_WARN (${EPSS_WARN}) CRA_STALE_HOURS (26) CRA_FETCH=1 CW_CRA_NOW CW_* path overrides
exit: 0 ok · 2 usage · 3 overdue clock · 4 stale evidence · 5 overdue and unpageable · 6 case log locked (nothing written)`);
}

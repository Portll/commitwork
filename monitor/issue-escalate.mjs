#!/usr/bin/env node
// monitor/issue-escalate.mjs — page a human when an open issue is past its SLA and nobody has
// touched it. Mirrors cra/escalate.mjs: the issue store declares `slaDueAt` on every open issue and
// lifecycle.mjs DETECTS a breach; until this file existed nothing ACTED on one (measured 2026-08-23:
// 977 open, 14 past due, all crit, median 11.2 d over, 0 claimed, 0 attempted, 0 paged).
//
// Design (the six cra/escalate.mjs must-fixes, restated for the issue store):
//  1. OPAQUE payload — the wire never carries the issue id, title, repo, area, rule or path. A
//     webhook may traverse Slack/ntfy/a bridge. It carries ref = sha256("issue-page|"+issueId)
//     .slice(0,16), the severity tier, days overdue and the run's count; the operator maps the ref
//     back inside the panel.
//  2. HTTPS only — refused before any POST, in the core, so an injected transport cannot bypass it.
//  3. POST-then-record — the `paged` event is appended ONLY after delivery succeeds. A recorded-but-
//     unsent page is a false green and is impossible by construction.
//  4. De-dup is a chain-covered `paged` event keyed {issueId, slaDueAt}, never a mutable field.
//     A reopen or severity change moves slaDueAt → new key → the page legitimately re-arms.
//     `escalated`/`escalatedAt` on the record are a PROJECTION of that event, written beside it.
//  5. LOUD — an overdue, unpaged issue left after the run exits 5: no target, non-https target,
//     delivery failure, or delivered-but-unrecorded. Determinism: CW_ESCALATE_NOW / CW_NOW read at
//     CALL time; writes atomic (saveIssues); a second run over the same slaDueAt pages nothing.
//  6. SERIALISED — the record goes through withIssuesLock, re-loading the store inside the lock.
//     The read-to-write window spans every POST, so the pre-lock copy is reliably stale; delivery
//     stays outside the lock, only the record is inside. The mutated store is schema-validated
//     before the save: a write loadIssues would later refuse must never reach disk.
//
// One POST per issue, as cra/escalate.mjs sends one per clock — a receiver that rate-limits sees
// each page as its own event and a partial delivery records exactly the pages that went out.
//
// Env: CW_ISSUE_WEBHOOK_URL — deliberately NOT CRA_WEBHOOK_URL. An issue page is an internal
// work-queue nudge; a CRA page is a regulator-clock alarm. Routing both to one channel would let
// the noisier one train the reader to ignore the one with a legal deadline behind it.

import { resolve } from 'node:path';
import {
  loadIssues, saveIssues, withIssuesLock, mutateIssue, issuesPath, issueSchemaPath,
} from './issue-store.mjs';
import { validateAgainstSchema } from './registry.mjs';
import { sha256 } from '../cra/lib.mjs';
import { resolveInto, reportMissing, SECRETS_FILE } from '../lib/secrets.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const WEBHOOK_ENV = 'CW_ISSUE_WEBHOOK_URL';
export const EVENT_TYPE = 'paged';

// Opaque per-issue reference — reveals nothing about the issue; stable so the panel can map it back.
export const pageRef = (issueId) => sha256(`issue-page|${issueId}`).slice(0, 16);

// Read at call time: a module-level const would defeat any test that sets the override after import.
export function escalateNow(env = process.env) {
  const forced = env.CW_ESCALATE_NOW || env.CW_NOW;
  return (forced ? new Date(forced) : new Date()).toISOString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daysBetween = (aIso, bIso) => (new Date(bIso).getTime() - new Date(aIso).getTime()) / 86_400_000;

export function alreadyPaged(doc, issueId, slaDueAt) {
  return doc.events.some((e) => e.type === EVENT_TYPE && e.issueId === issueId && e.data?.slaDueAt === slaDueAt);
}

// Open, untouched, past due. `claimed`/`blocked`/`closed` are states someone has already reached
// into; an expired-but-unreaped claim is still a claim until gc says otherwise. attemptCount > 0 is
// a prior touch whether or not the claim survived.
export function overdueUnpaged(doc, at) {
  const out = [];
  for (const iss of Object.values(doc.issues || {})) {
    if (iss.state !== 'open' || iss.claim || (iss.attemptCount || 0) > 0) continue;
    if (typeof iss.slaDueAt !== 'string') continue;
    const due = new Date(iss.slaDueAt).getTime();
    if (!Number.isFinite(due) || !(new Date(at).getTime() > due)) continue;
    if (alreadyPaged(doc, iss.id, iss.slaDueAt)) continue;
    out.push({
      issueId: iss.id,
      slaDueAt: iss.slaDueAt,
      severity: iss.severity,
      overdueByDays: Math.round(daysBetween(iss.slaDueAt, at) * 10) / 10,
      ref: pageRef(iss.id),
    });
  }
  // Stable order => byte-identical --dry output and a fixed POST sequence.
  out.sort((a, b) => a.issueId.localeCompare(b.issueId));
  return out;
}

// The record's `escalated` is derived from the chain, never set by hand: the latest `paged` event
// for THIS slaDueAt. A moved due date with no page yet projects to false.
export function projectEscalation(iss, events) {
  let hit = null;
  for (const e of events) if (e.type === EVENT_TYPE && e.issueId === iss.id && e.data?.slaDueAt === iss.slaDueAt) hit = e;
  iss.escalated = !!hit;
  iss.escalatedAt = hit ? hit.at : null;
  return iss.escalated;
}

// Default transport. Same retry shape as cra/escalate.mjs: one retry on 429 (2.5s) or a thrown
// fetch (500ms); any other non-2xx is a failure.
export async function postWebhook(url, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 429 && attempt === 0) { await sleep(2500); continue; }
      if (!res.ok) return { ok: false, why: `http-${res.status}` };
      return { ok: true };
    } catch (e) {
      if (attempt === 0) { await sleep(500); continue; }
      return { ok: false, why: `fetch-error:${e?.name || 'error'}` };
    }
  }
  return { ok: false, why: 'exhausted' };
}

/**
 * The core. Every input is injectable so the tests run on fixtures with no network and no keychain.
 * @param {object} o
 * @param {(url:string, body:object)=>Promise<{ok:boolean, why?:string}>} [o.post]  transport
 * @param {string}  [o.now]         ISO instant; default CW_ESCALATE_NOW || CW_NOW || wall clock
 * @param {string}  [o.issuesPath]  store path; default CW_ISSUES || monitor/issues.json
 * @param {string}  [o.schemaPath]  schema path; default CW_ISSUE_SCHEMA || schema/issue.schema.json
 * @param {object}  [o.env]         environment the webhook URL is resolved from
 * @param {boolean} [o.dry]         list what would page; POST nothing, write nothing
 * @param {object}  [o.logger]      console-shaped
 * @returns {Promise<{overdue:number, paged:number, failed:number, lostRecords:number, exit:0|5,
 *   reason:string, pending:object[], delivered:object[]}>}
 */
export async function escalateIssues({
  post = postWebhook,
  now,
  issuesPath: path,
  schemaPath,
  env = process.env,
  dry = false,
  logger = console,
} = {}) {
  const at = now ? new Date(now).toISOString() : escalateNow(env);
  const storePath = resolve(path || issuesPath());
  const schema = schemaPath || issueSchemaPath();

  // Fail closed: loadIssues throws on anything but ENOENT; an unreadable store is not "no issues".
  const doc = loadIssues({ path: storePath, schemaPath: schema });
  const pending = overdueUnpaged(doc, at);
  const base = { at, overdue: pending.length, paged: 0, failed: 0, lostRecords: 0, pending, delivered: [] };
  if (!pending.length) return { ...base, exit: 0, reason: 'nothing-overdue-unpaged' };

  if (dry) return { ...base, exit: 0, reason: 'dry-run' };

  // An issue IS overdue and unpaged — we MUST be able to page. Resolve the target loudly. The
  // secrets table path is read here, not at import, so CW_SECRETS_FILE set later still applies.
  const r = resolveInto([WEBHOOK_ENV], { env, file: env.CW_SECRETS_FILE || SECRETS_FILE });
  const url = r.env[WEBHOOK_ENV];
  if (!url) {
    reportMissing((r.missing || []).filter((m) => m.reason !== 'undeclared'), { context: 'issue SLA escalation', logger });
    logger.error(
      `issue-escalate: ${pending.length} overdue, untouched issue(s) and no resolvable ${WEBHOOK_ENV} — cannot page. `
      + `Set it: node bin/secrets.mjs set ${WEBHOOK_ENV} (or export it for a one-off).`,
    );
    return { ...base, failed: pending.length, exit: 5, reason: 'no-target' };
  }
  if (!/^https:\/\//i.test(url)) {
    logger.error(`issue-escalate: ${WEBHOOK_ENV} is not https — refusing to POST ${pending.length} page(s) over a cleartext hop.`);
    return { ...base, failed: pending.length, exit: 5, reason: 'webhook-url-not-https' };
  }

  // Deliver outside the lock: each page is a 5s-timeout round trip with a retry, and holding the
  // store across the loop would block every ingest, claim and close for tens of seconds.
  const delivered = [];
  let failed = 0;
  for (const p of pending) {
    const body = {
      kind: 'issue-sla-overdue',
      ref: p.ref,                                   // opaque — no id/title/repo/area/rule/path
      severity: p.severity,
      slaDueAt: p.slaDueAt,
      overdueByDays: p.overdueByDays,
      count: pending.length,                        // how many this run is paging in total
      action: 'An open issue is past its SLA with no claim and no attempt. Open the commitwork panel to identify and act on it.',
    };
    // POST first… A transport that throws is one failed page, not an aborted run: the pages that
    // did go out must still be recorded below.
    let res;
    try { res = await post(url, body); } catch (e) { res = { ok: false, why: `transport-threw:${e?.message || e}` }; }
    if (res && res.ok === true) delivered.push(p);
    else {
      failed++;
      logger.error(`issue-escalate: page FAILED for ref ${p.ref} (${res?.why || 'no-result'})`);
    }
  }

  // …then record against a document re-read inside the lock: `doc` above is stale by however long
  // the pages took, so the de-dup re-runs on the fresh copy and prevHash follows the real tail.
  let paged = 0;
  let lostRecords = 0;
  if (delivered.length) {
    try {
      withIssuesLock(() => {
        const fresh = loadIssues({ path: storePath, schemaPath: schema });
        for (const p of delivered) {
          if (alreadyPaged(fresh, p.issueId, p.slaDueAt)) continue;   // another run recorded it meanwhile
          if (!fresh.issues[p.issueId]) continue;                      // gone from the store since the read
          // mutateIssue is the store's single funnel (stamps updatedAt, appends the chained event).
          // The mutator is empty on purpose: the record's escalated/escalatedAt are PROJECTED from
          // the event once it exists, never set ahead of it.
          mutateIssue(fresh, p.issueId, () => {}, EVENT_TYPE,
            { slaDueAt: p.slaDueAt, severity: p.severity, ref: p.ref, overdueByDays: p.overdueByDays, target: 'webhook' }, at);
          projectEscalation(fresh.issues[p.issueId], fresh.events);
          paged++;
        }
        if (!paged) return;
        // Fail closed on our own write: a store loadIssues would refuse must never reach disk.
        const { errors } = validateAgainstSchema(fresh, { path: schema });
        if (errors.length) throw new Error(`the paged store would not validate (${errors.length}): ${errors.slice(0, 3).join('; ')}`);
        saveIssues(fresh, { path: storePath });
      }, { path: storePath });
    } catch (e) {
      // Delivered-but-unrecorded is the benign half of at-least-once (the next run re-pages), but
      // it is still a missing record, so it is loud and raises the exit rather than a quiet 0.
      paged = 0;
      lostRecords = delivered.length;
      logger.error(
        `issue-escalate: ${delivered.length} page(s) were DELIVERED but could not be recorded (${e?.message || e}). `
        + 'The pages went out; the store does not yet say so, and the next run will re-page these issues.',
      );
    }
  }

  const exit = failed || lostRecords ? 5 : 0;
  return {
    ...base, paged, failed, lostRecords, delivered, exit,
    reason: failed ? 'delivery-failure' : lostRecords ? 'record-failure' : 'paged',
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────
// node monitor/issue-escalate.mjs [--dry] [--json]
//   exit 0  nothing overdue-unpaged, or every page delivered and recorded (or --dry)
//   exit 2  unknown argument — an unrecognised flag must never fire real pages
//   exit 5  an overdue, untouched issue is left unpaged: no CW_ISSUE_WEBHOOK_URL, non-https target,
//           delivery failure, delivered-but-unrecorded, or an unreadable store
export function formatReport(r, { json = false } = {}) {
  if (json) return JSON.stringify({ at: r.at, reason: r.reason, exit: r.exit, overdue: r.overdue, paged: r.paged, failed: r.failed, lostRecords: r.lostRecords, pending: r.pending }, null, 2);
  const lines = [];
  if (r.reason === 'dry-run') {
    lines.push(`issue-escalate (dry): ${r.overdue} overdue, untouched, unpaged issue(s) would page at ${r.at}`);
    for (const p of r.pending) lines.push(`  ${p.ref}  ${p.severity.padEnd(4)}  ${String(p.overdueByDays).padStart(6)} d over  due ${p.slaDueAt}`);
  } else if (r.reason === 'nothing-overdue-unpaged') {
    lines.push(`issue-escalate: nothing overdue and unpaged at ${r.at}`);
  } else {
    lines.push(`issue-escalate: ${r.overdue} overdue · ${r.paged} paged · ${r.failed} failed · ${r.lostRecords} unrecorded (${r.reason})`);
  }
  return lines.join('\n');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const known = new Set(['--dry', '--json']);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length) {
    console.error(`issue-escalate: unknown argument ${unknown.join(' ')} — usage: node monitor/issue-escalate.mjs [--dry] [--json]`);
    process.exit(2);
  }
  const json = args.includes('--json');
  escalateIssues({ dry: args.includes('--dry') })
    .then((r) => {
      console.log(formatReport(r, { json }));
      process.exit(r.exit);
    })
    .catch((e) => { console.error(`issue-escalate: ${e?.message || e}`); process.exit(5); });
}

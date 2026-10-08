#!/usr/bin/env node
// cra/escalate.mjs — page a human when a CRA Art. 14 clock is overdue, instead of the deadline
// dying into an unread launchd log. Runs right after `cra/watch.mjs watch` (which sets exitCode 3
// when a clock is overdue). It reads the append-only case log, finds overdue-and-unpaged clocks,
// and POSTs an OPAQUE notification to CRA_WEBHOOK_URL.
//
// Design (all Stage-6-verified must-fixes):
//  1. OPAQUE payload — the wire never carries caseId or vulnId. A webhook may traverse Slack/ntfy/
//     a bridge; "clientA CVE-2026-1234 is overdue" must not leak there. We send a stable per-case
//     ref = sha256("cra-page|"+caseId); the operator maps it back inside the panel.
//  2. HTTPS only — a page carries a token over the hop; a non-https target is refused.
//  3. POST-then-record — the `paged` event is written ONLY after delivery, so a recorded-but-unsent
//     page (a false green) is impossible.
//  4. De-dup is a chain-covered `paged` event keyed by {caseId, clock, due}, NOT a mutable case
//     field (so `watch.mjs verify` still covers it) and NOT via mutateCase (which recomputes clocks).
//     An ack that re-bases a clock yields a new `due` → new key → the page legitimately re-arms.
//  5. LOUD on failure — a clock overdue with no deliverable page exits 5 (the inverse of
//     export-overwatch's silent exit-0). Determinism: honours CW_ESCALATE_NOW; writes are atomic.
//  6. SERIALISED — the paged-event write goes through cra/lib.mjs's updateCases, which re-loads the
//     document under the lock. The read-to-write window here spans every webhook POST, so the
//     pre-lock copy is reliably stale. Delivery stays outside the lock; only the record is inside.

import {
  resolvePaths, loadJSON, isOverdue, hoursSince, nowISO, sha256, appendCaseEvent, updateCases, CLOCK_SPEC,
} from './lib.mjs';
import { resolveInto, reportMissing } from '../lib/secrets.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// Imported from the one spec, never re-listed. The `escalationId` values are LEDGER IDENTITY: the
// de-dup key of a chain-covered `paged` event is {caseId, clock, due}, so renaming one would
// re-arm every page ever sent. They are pinned by cra/test/clock-spec.test.mjs for that reason.
// Only the Art. 14 track pages: an internal-policy clock owes no regulator a notification, and
// cra/test asserts that this exclusion is deliberate rather than an oversight.
const CLOCKS = CLOCK_SPEC.article14.map((c) => [c.escalationId, c.key]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opaque per-case reference — reveals neither product nor CVE. Stable, so the panel can map it back.
export const pageRef = (caseId) => sha256(`cra-page|${caseId}`).slice(0, 16);

function overdueClocks(kase, at) {
  const out = [];
  for (const [clock, key] of CLOCKS) {
    const due = kase.clocks?.[key];
    if (due && isOverdue(due, at)) out.push({ clock, due });
  }
  return out;
}

function alreadyPaged(doc, caseId, clock, due) {
  return doc.events.some(
    (e) => e.type === 'paged' && e.caseId === caseId && e.data?.clock === clock && e.data?.due === due,
  );
}

// The chained append is cra/lib.mjs's appendCaseEvent; this file no longer carries its own copy.

async function postWebhook(url, body) {
  if (!/^https:\/\//i.test(url)) return { ok: false, why: 'webhook-url-not-https' };
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

export async function escalate({ paths = resolvePaths(), at = process.env.CW_ESCALATE_NOW || nowISO(), env = process.env } = {}) {
  const doc = loadJSON(paths.cases, null);
  if (!doc || !doc.cases) return { overdue: 0, paged: 0, failed: 0, exit: 0, reason: 'no-cases' };

  const pending = [];
  for (const kase of Object.values(doc.cases)) {
    if (kase.status === 'closed') continue;
    for (const oc of overdueClocks(kase, at)) {
      if (!alreadyPaged(doc, kase.caseId, oc.clock, oc.due)) pending.push({ caseId: kase.caseId, ...oc });
    }
  }
  if (!pending.length) return { overdue: 0, paged: 0, failed: 0, exit: 0, reason: 'nothing-overdue-unpaged' };

  // A clock IS overdue and unpaged — we MUST be able to page. Resolve the target loudly.
  const r = resolveInto(['CRA_WEBHOOK_URL'], { env });
  const url = r.env.CRA_WEBHOOK_URL;
  if (!url) {
    reportMissing((r.missing || []).filter((m) => m.reason !== 'undeclared'), { context: 'CRA escalation' });
    console.error(`cra/escalate: ${pending.length} overdue Art. 14 clock(s) and no resolvable CRA_WEBHOOK_URL — cannot page. Set it: node bin/secrets.mjs set CRA_WEBHOOK_URL`);
    return { overdue: pending.length, paged: 0, failed: pending.length, exit: 5, reason: 'no-target' };
  }

  // Deliver outside the lock: each page is a 5s-timeout round trip with a retry, and holding the
  // case log across the loop would block a human's `ack` for tens of seconds.
  const delivered = [];
  let failed = 0;
  for (const p of pending) {
    const body = {
      kind: 'cra-art14-clock-overdue',
      ref: pageRef(p.caseId),                                // opaque — no caseId/CVE/product
      clock: p.clock,
      due: p.due,
      overdueByHours: Math.round(hoursSince(p.due, at)),
      action: 'A CRA Art. 14 reporting clock is overdue. Open the commitwork panel to identify and act on the case.',
    };
    const res = await postWebhook(url, body);              // POST first…
    if (res.ok) delivered.push({ ...p, ref: body.ref });
    else {
      failed++;
      console.error(`cra/escalate: page FAILED for clock ${p.clock} (${res.why})`);
    }
  }

  // …then record against a document re-read inside the lock: `doc` above is stale by however long
  // the pages took, so the dedup check re-runs on the fresh copy and prevHash follows the real tail.
  let paged = 0;
  let lostRecords = 0;
  if (delivered.length) {
    const w = updateCases(paths, (fresh) => {
      for (const p of delivered) {
        if (alreadyPaged(fresh, p.caseId, p.clock, p.due)) continue; // another run recorded it meanwhile
        appendCaseEvent(fresh, 'paged', p.caseId, { clock: p.clock, due: p.due, ref: p.ref, target: 'webhook' }, at);
        paged++;
      }
      return paged > 0;
    }, { label: 'cra-escalate' });

    // Delivered-but-unrecorded is the benign half of at-least-once (the next tick re-pages), but it
    // is still a missing compliance record, so it is loud and raises the exit rather than a quiet 0.
    if (!w.ok) {
      lostRecords = delivered.length;
      console.error(
        `cra/escalate: ${delivered.length} page(s) were DELIVERED but could not be recorded — the case `
        + 'log is locked by another writer. The pages went out; the ledger does not yet say so, and the '
        + 'next run will re-page these clocks.',
      );
    }
  }

  const exit = failed || lostRecords ? 5 : 0;
  return {
    overdue: pending.length, paged, failed, lostRecords, exit,
    reason: failed ? 'delivery-failure' : lostRecords ? 'record-failure' : 'paged',
  };
}

if (isMainModule(import.meta.url)) {
  escalate()
    .then((r) => {
      if (r.paged) console.log(`cra/escalate: paged ${r.paged} overdue Art. 14 clock(s)`);
      process.exit(r.exit);
    })
    .catch((e) => { console.error(`cra/escalate: ${e?.message || e}`); process.exit(5); });
}

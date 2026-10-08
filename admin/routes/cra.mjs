// admin/routes/cra.mjs — the CRA panel's server half: open Art. 14 cases with their clock state,
// the preflight verdict, recent escalations, and the products wizard.
// Every route requires a session OR the operator port — the same rule as every other lane.
import { requireSession, OPERATOR_PORT } from '../lib/route-auth.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolvePaths, loadJSON, isOverdue, nowISO, writeJSONAtomic, validateProducts, sha256, clockSpecFor, CLOCK_SPEC } from '../../cra/lib.mjs';
import { preflight } from '../../cra/preflight.mjs';
import { evidenceStatus } from '../../cra/evidence-status.mjs';


// A session OR the operator port, which is the same rule every other lane uses
// (codeql-remediation.mjs `authed`, packages.mjs, host.mjs). This file previously demanded a
// session even on loopback, which made the CRA page dead on the very port an operator uses standing
// at the box — the clocks rendered and no data ever arrived. Loopback privilege is keyed to
// `req.socket.localPort`, a property of the accepted socket that no caller can assert, and the
// tunnel is verified at boot never to route it (assertOperatorPortUnroutable in serve.mjs).
// Operator ruling 2026-08-22.

// Imported, never re-listed: cra/watch.mjs owns the clock vocabulary. The two literals that used to
// live here drifted the moment the internal track gained its own keys — `overdueFlags` read Art. 14
// key names against internal cases, so an internal clock could never be reported overdue at all.
const clocksFor = (kase) => clockSpecFor(kase.clocks?.track);
const overdueFlags = (kase, at) =>
  clocksFor(kase).filter((c) => kase.clocks?.[c.key] && isOverdue(kase.clocks[c.key], at)).map((c) => c.escalationId);

// A case whose clocks predate the track split carries no `track`. It is NOT assumed regulatory and
// NOT assumed internal — it is reported as unknown, so the page can show it as unclassified rather
// than silently counting it into either total.
const trackOfCase = (k) => k.clocks?.track || 'unknown';

export const routes = [
  // GET /api/cra/cases — open cases + clock/overdue state; configured:false distinguishes "no case
  // log yet" from "no open cases" (explicit uncertainty)
  { method: 'GET', path: '/api/cra/cases', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx, OPERATOR_PORT)) return send(401, { ok: false, error: 'authentication required' });
    const doc = loadJSON(resolvePaths().cases, null);
    const at = nowISO();
    if (!doc || !doc.cases) return send(200, { ok: true, configured: false, count: 0, cases: [] });
    const open = Object.values(doc.cases)
      .filter((k) => k.status !== 'closed')
      .map((k) => ({
        caseId: k.caseId, kind: k.kind, product: k.productId, vulnId: k.vulnId,
        status: k.status, trigger: k.trigger, kev: !!k.kev, epss: k.epss ?? null,
        track: trackOfCase(k), reporting: k.reporting || null,
        clocks: k.clocks || null, overdue: overdueFlags(k, at),
        // Null only for tracks that can NEVER have drafts. An `unknown` (pre-split) case keeps its
        // path: its drafts really are on disk, and hiding them would suppress existing evidence to
        // make a classification look tidy.
        draftsPath: ['bestpractice', 'internal'].includes(trackOfCase(k)) ? null : `reports/cra/cases/${k.caseId}/`,
      }));
    // `count` is every open case and is honest as such. `counts` is the breakdown, and it is what
    // a renderer must show: a single number that folds a regulatory obligation together with a
    // best-practice or internal clock is the misreport this three-track split exists to prevent.
    // `unknown` is its own bucket — a pre-split case is never silently adopted into either track.
    const counts = { article14: 0, bestpractice: 0, internal: 0, unknown: 0 };
    for (const k of open) counts[k.track] = (counts[k.track] || 0) + 1;
    // Which clocks exist, and what each is called, travels WITH the payload. The browser used to
    // re-list them, which made it a fourth copy of the vocabulary CLOCK_SPEC exists to hold once
    // (R3): a clock added server-side would have rendered nowhere and nobody would have been told.
    // `paged` is the SERVER's chain-covered record of what was actually escalated — the page must
    // show that rather than infer it, because an overdue clock nobody was paged about is the worst
    // state there is and it looks identical to a merely-overdue one from the client's side.
    const paged = (doc.events || [])
      .filter((e) => e.type === 'paged')
      .map((e) => `${e.caseId}|${e.data?.clock}|${e.data?.due}`);
    // `serverNow` is the ONLY basis a client may tick from. A browser computing remaining time from
    // its own clock renders a legal deadline through an unverified offset.
    return send(200, {
      ok: true, configured: true, at, serverNow: at, count: open.length, counts,
      clockSpec: CLOCK_SPEC, paged, cases: open,
    });
  } },

  // GET /api/cra/preflight — is products.json configured to actually work? Mirrors `node cra/preflight.mjs`.
  { method: 'GET', path: '/api/cra/preflight', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx, OPERATOR_PORT)) return send(401, { ok: false, error: 'authentication required' });
    const r = preflight(resolvePaths());
    return send(200, { ok: true, ready: r.ready, errors: r.errors, advisories: r.advisories, info: r.info });
  } },

  // GET /api/cra/evidence — is the evidence pack current (cra/evidence-status.mjs): current, stale,
  // never-generated, failed or unknown, with reasons and the last refresh's exit.
  { method: 'GET', path: '/api/cra/evidence', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx, OPERATOR_PORT)) return send(401, { ok: false, error: 'authentication required' });
    return send(200, { ok: true, ...evidenceStatus(resolvePaths()) });
  } },

  // GET /api/cra/escalations — recent `paged` events: the audit trail behind "the clock paged a human"
  { method: 'GET', path: '/api/cra/escalations', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx, OPERATOR_PORT)) return send(401, { ok: false, error: 'authentication required' });
    const doc = loadJSON(resolvePaths().cases, null);
    const paged = (doc?.events || [])
      .filter((e) => e.type === 'paged')
      .map((e) => ({ caseId: e.caseId, at: e.at, clock: e.data?.clock, due: e.data?.due, ref: e.data?.ref, target: e.data?.target }));
    return send(200, { ok: true, count: paged.length, escalations: paged.slice(-50) });
  } },

  // GET /api/cra/products — products.json + content hash (the wizard posts it back WITH the hash;
  // 409 on drift). An unparseable store is 503, never a silent empty doc.
  { method: 'GET', path: '/api/cra/products', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx, OPERATOR_PORT)) return send(401, { ok: false, error: 'authentication required' });
    const p = resolvePaths().products;
    if (!existsSync(p)) return send(200, { ok: true, exists: false, products: null, hash: null });
    let raw;
    try { raw = readFileSync(p, 'utf8'); } catch (e) { return send(503, { ok: false, error: `products store unreadable: ${e.code || e.message}` }); }
    let doc;
    try { doc = JSON.parse(raw); } catch { return send(503, { ok: false, error: 'products store is corrupt (unparseable JSON)' }); }
    return send(200, { ok: true, exists: true, products: doc, hash: sha256(raw) });
  } },

  // POST /api/cra/products {products, baseHash} — replace products.json, guarded.
  // 400 invalid · 409 changed since baseHash · 503 corrupt store (refuse to overwrite blind).
  { method: 'POST', path: '/api/cra/products', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    if (!requireSession(ctx, OPERATOR_PORT)) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const doc = body && body.products;
      if (!doc || typeof doc !== 'object') return send(400, { ok: false, error: 'body.products (the products.json document) is required' });
      const p = resolvePaths().products;
      let currentHash = null;
      if (existsSync(p)) {
        let raw;
        try { raw = readFileSync(p, 'utf8'); } catch (e) { return send(503, { ok: false, error: `products store unreadable: ${e.code || e.message}` }); }
        try { JSON.parse(raw); } catch { return send(503, { ok: false, error: 'products store is corrupt (unparseable JSON) — refusing to overwrite blind' }); }
        currentHash = sha256(raw);
      }
      if ((body.baseHash ?? null) !== currentHash) {
        return send(409, { ok: false, error: 'products.json changed since it was loaded (or no baseHash was supplied) — reload and reapply', currentHash });
      }
      const v = validateProducts(doc);
      if (v.errors.length) return send(400, { ok: false, errors: v.errors, advisories: v.advisories });
      writeJSONAtomic(p, doc);
      const hash = sha256(readFileSync(p, 'utf8'));           // exactly the on-disk bytes → the next baseHash
      const fresh = preflight(resolvePaths());
      return send(200, { ok: true, hash, advisories: v.advisories, preflight: { ready: fresh.ready, errors: fresh.errors, advisories: fresh.advisories, info: fresh.info } });
    });
  } },
];

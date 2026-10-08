// admin/routes/annotations.mjs — the panel's write path for SCANNER-FINDING annotations
// (monitor/annotations.json `scannerAnnotations`): "this row is a false positive / accepted /
// won't-fix", authored from a scanner tab row (#secrets and friends).
//
// THE RULES LIVE IN monitor/annotate-lib.mjs, not here — validateScannerAnnotation is the same
// gate the rollup applies at overlay time and bin/annotate.mjs applies at CLI-authoring time. A
// record this route accepts is exactly a record the rollup would apply; a transport with its own
// rules is the transport with the weaker rules.
//
// EVERY ROUTE REQUIRES A SESSION, LOOPBACK INCLUDED — same reasoning as routes/ingest.mjs: the
// product is an ATTRIBUTED judgment, `who` comes from the session, and on the box with nobody
// logged in there is no one to attribute it to. The modular dispatcher sits above the login gate,
// so this check is the only gate these routes get.
//
// HONESTY CONTRACT OF THE RESPONSE: recording an annotation changes NOTHING the panel currently
// shows — the overlay runs at rollup time. The response says `effective: 'next-rollup'` and
// `stillOpen: true`, every time, because a UI that renders ok:true as "gone" is exactly how a
// suppression starts looking like a fix. The finding is also never deleted: the row stays in the
// artifact with the annotation attached (struck through, with who/reason), and only the severity
// aggregates drop.

import { requireSession } from '../lib/route-auth.mjs';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { identityFor, detailKeys } from '../../monitor/detail-schema.mjs';
import { validateScannerAnnotation, findActiveScannerAnnotation, SUPPRESSING_ACTIONS, annotationsLockPath, activeSuppressionFor, anyActiveSuppressionFor } from '../../monitor/annotate-lib.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';
import { CW, outDirFor } from '../../monitor/area.mjs';
import { acquireLockOrReason } from '../../monitor/lockfile.mjs';
import { writeAtomic } from '../../monitor/lockfile.mjs';
import { annotationsPathFor } from '../../monitor/store-paths.mjs';

const STORE = () => annotationsPathFor(CW);

// fail closed: only ENOENT is "legitimately absent". A parse failure surfaces as a 503 — an
// unreadable ledger and an empty one are different facts, and a write on top of the parse
// failure would clobber whatever the broken bytes used to say.
function loadStore() {
  try { return JSON.parse(readFileSync(STORE(), 'utf8')); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { annotations: [], scannerAnnotations: [] };
    throw new Error(`annotations store unreadable (${STORE()}): ${e.message}`);
  }
}

// How many rows of an area's CURRENT rollup a record addresses, with the same matcher the overlay
// uses. Only ENOENT is "no rollup to measure against"; an unreadable or non-JSON rollup THROWS,
// because a suppression written past evidence it could not read is the silent class.
export function coverageInRollup(project, record, idf, { sample = 0 } = {}) {
  if (typeof project !== 'string' || !project) return { matched: null, rollupState: 'no-project' };
  let rollupPath;
  try { rollupPath = join(outDirFor(project), 'rollup.json'); } catch { return { matched: null, rollupState: 'unknown-area' }; }
  let text;
  try { text = readFileSync(rollupPath, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { matched: null, rollupState: 'absent', rollupPath };
    throw new Error(`rollup at ${rollupPath} is unreadable (${e.code || e.message})`);
  }
  let rollup;
  try { rollup = JSON.parse(text); } catch (e) { throw new Error(`rollup at ${rollupPath} is not JSON (${e.message})`); }
  const rows = ((rollup && rollup.scannerFindings || {})[record.category] || []);
  const hits = rows.filter((row) => findActiveScannerAnnotation([record], row, record.at || new Date().toISOString(), idf));
  const out = { matched: hits.length, rows: rows.length, rollupState: 'measured', rollupPath };
  if (sample > 0) out.sample = hits.slice(0, sample).map((row) => Object.fromEntries((idf || []).map((f) => [f, row[f] ?? null])));
  return out;
}

export const routes = [
  // GET /api/annotations/scanner — the authored records, optionally filtered by category/repo.
  // Application status (applied / noMatch / expired / invalid) is NOT here — it lives on
  // rollup.scannerAnnotationStatus, computed at overlay time, and restating it from the store
  // would be this route inventing a claim the rollup owns.
  { method: 'GET', path: '/api/annotations/scanner', handle: (ctx) => {
    const { send, query } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    let doc;
    try { doc = loadStore(); } catch (e) { return send(503, { ok: false, error: e.message }); }
    const recs = (doc.scannerAnnotations || [])
      .filter((a) => !query.get('category') || a.category === query.get('category'))
      .filter((a) => !query.get('repo') || a.repo === query.get('repo'));
    return send(200, { ok: true, categories: detailKeys(), suppressingActions: [...SUPPRESSING_ACTIONS], records: recs });
  } },

  // GET /api/annotations/scanner/coverage — how many rows of the area's CURRENT rollup a record
  // would address, before anything is written. Same matcher and same rollup as the POST, so the
  // number shown is the number that will be recorded. Query: project, category, repo|scope=fleet,
  // identity fields. Never writes.
  { method: 'GET', path: '/api/annotations/scanner/coverage', handle: (ctx) => {
    const { send, query } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    const category = query.get('category');
    const idf = identityFor(category);
    if (!idf) return send(400, { ok: false, error: `unknown category '${category}'` });
    const record = { category };
    if (query.get('scope') === 'fleet') record.scope = 'fleet';
    else if (query.get('repo')) record.repo = query.get('repo');
    else return send(400, { ok: false, error: "repo is required (or scope=fleet)" });
    for (const f of idf) if (query.get(f) !== null && query.get(f) !== '') record[f] = query.get(f);
    const named = idf.filter((f) => record[f] !== undefined);
    if (!named.length) return send(400, { ok: false, error: `name at least one identity field (${idf.join(', ')})` });
    // The matcher's reach depends on the action: every identity field is strict except that
    // 'incorrect-scan-result' treats an omitted PLACE field as a wildcard. Measure with the action
    // that will be written, or the number shown is not the number recorded.
    const action = query.get('action') || 'false-positive';
    if (!SUPPRESSING_ACTIONS.includes(action)) return send(400, { ok: false, error: `action must be one of ${SUPPRESSING_ACTIONS.join(', ')}` });
    record.action = action;
    record.at = new Date().toISOString();           // the matcher only reads records that are in force
    const project = query.get('project');
    if (!project) return send(400, { ok: false, error: 'project is required' });
    try {
      const c = coverageInRollup(project, record, idf, { sample: 5 });
      return send(200, { ok: true, ...c, scope: record.scope === 'fleet' ? 'fleet' : 'repo', named });
    } catch (e) {
      return send(503, { ok: false, error: e.message, unavailable: true });
    }
  } },

  // POST /api/annotations/scanner — author one record from a scanner tab row.
  // Body: { project, category, repo, <identity fields…>, action, reason, expires? , force? }
  // `who` and `at` are NEVER taken from the body — the session signs, the server clocks.
  { method: 'POST', path: '/api/annotations/scanner', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      if (!body || typeof body !== 'object') return send(400, { ok: false, error: 'body must be a JSON object' });

      const idf = identityFor(body.category);
      const record = { category: body.category };
      if (body.scope === 'fleet') record.scope = 'fleet';
      else if (typeof body.repo === 'string') record.repo = body.repo;
      for (const f of idf || []) if (body[f] !== undefined) record[f] = String(body[f]);
      if (!SUPPRESSING_ACTIONS.includes(body.action)) {
        return send(400, { ok: false, error: `action must be one of ${SUPPRESSING_ACTIONS.join(', ')} — note/resolved do not suppress and are authored via the CLI` });
      }
      record.action = body.action;
      // The defect object is what makes 'incorrect-scan-result' a claim about an instrument rather
      // than a dismissal; the validator insists on it, so the panel must be able to send it.
      if (body.defect && typeof body.defect === 'object' && !Array.isArray(body.defect)) {
        record.defect = {};
        for (const k of ['tool', 'detail', 'detector', 'fixedIn']) if (body.defect[k] !== undefined) record.defect[k] = String(body.defect[k]);
      }
      record.reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      record.who = sessionWho(s);
      record.at = new Date().toISOString();
      if (typeof body.expires === 'string' && body.expires) record.expires = body.expires;
      // EVIDENCE, never identity — deliberately not named `line`, because the identity tuple
      // excludes line on purpose (a line-keyed suppression un-suppresses itself on the next
      // unrelated edit above it) and a field the matcher must never read should not share a name
      // with one it does. scannerAnnMatch only ever compares identityFields, so this is inert to
      // matching; it exists so a record can say WHICH row was looked at.
      if (body.line !== undefined && body.line !== null && body.line !== '') record.seenAtLine = Number(body.line);

      // requireExpires: true — this is a WRITE (same reasoning as bin/annotate.mjs). A record
      // already on disk without expires stays untouched: rollup.mjs's own overlay call is the
      // 2-arg, requireExpires-default-false form and never re-validates existing records this way.
      const errs = validateScannerAnnotation(record, idf, { requireExpires: true });
      if (errs.length) return send(400, { ok: false, error: 'invalid record', errors: errs });

      // match proof against the area's CURRENT rollup: a record addressing zero published rows is
      // refused (409), not written — a typo'd file would otherwise sit in the ledger reading
      // exactly like "no annotations apply". force:true overrides for the row-not-yet-rolled case.
      // A rollup that EXISTS but cannot be read is not "no proof either way": it is evidence the
      // write cannot see, and writing past it would be the silent class — so that is a 503.
      let coverage;
      try { coverage = coverageInRollup(body.project, record, idf); } catch (e) {
        return send(503, { ok: false, error: `${e.message} — refusing to write a suppression whose coverage cannot be measured`, unavailable: true });
      }
      const matched = coverage.matched;
      if (matched === 0 && !body.force) {
        return send(409, { ok: false, error: 'record matches zero published rows in the current rollup — refusing to write. Pass force:true if the row is newer than the rollup.', matched, rollupState: coverage.rollupState });
      }
      // What the record covered when it was written travels with it, so a later audit can compare
      // coverage then with coverage now: a by-rule scope that matched 3 rows and now hides 300 is a
      // growth a reader should be able to see. `forced` names the override that wrote a zero.
      record.coveredAtWrite = matched;
      if (matched === 0 && body.force) record.forced = true;

      // C2: read -> modify -> write against the shared store, excluded from bin/annotate.mjs's CLI
      // writer via the SAME lock path (monitor/annotate-lib.mjs::annotationsLockPath) — a panel
      // click and a CLI author interleaving would otherwise each read the pre-write doc and one
      // push wins, silently dropping the other. The critical section is one small JSON read+write
      // (milliseconds), so a short retry budget keeps the request responsive; contention past that
      // is a 409 naming the holder, never a silently lost write.
      const lockPath = annotationsLockPath(STORE());
      const got = acquireLockOrReason(lockPath, {
        staleMs: 30_000, label: 'annotations-route', attempts: 10, spinMs: 20,
        onStale: (ageMs) => console.warn(`[annotations] breaking a stale lock (${Math.round(ageMs / 1000)}s old) at ${lockPath}`),
      });
      // A full disk is not contention: 409 "try again" would be false, because the next try fails
      // the same way. 503 names the condition an operator has to clear.
      if (!got.ok && got.reason === 'unavailable') {
        return send(503, {
          ok: false,
          error: `annotations store cannot be locked${got.code ? ` (${got.code})` : ''}: ${got.message}`,
          unavailable: true,
        });
      }
      if (!got.ok) {
        return send(409, {
          ok: false,
          error: `annotations store is locked by another writer${got.holder ? ` ('${got.holder.label}')` : ''} — try again`,
          locked: true,
        });
      }
      const lock = got.lock;

      try {
        let doc;
        try { doc = loadStore(); } catch (e) { return send(503, { ok: false, error: e.message }); }
        if (!Array.isArray(doc.scannerAnnotations)) doc.scannerAnnotations = [];

        // Duplicate check INSIDE the lock: read-then-decide outside it is the same lost-update race
        // the lock exists for, just with a subtler loss (two identical suppressions, both "first").
        const sameCat = doc.scannerAnnotations.filter((a) => a.category === record.category);
        const twin = activeSuppressionFor(sameCat, record, record.at, idf);
        if (twin && !body.force) {
          // The judgment is already in force, so a second suppression adds no coverage and only
          // pushes the review date out (first-match-wins on read, last-to-expire in practice). The
          // click is still evidence, so it is kept as a NOTE — non-suppressing by vocabulary — with
          // a back-link to the record it corroborates. Nothing is discarded and nothing is doubled.
          const note = {
            category: record.category, action: 'note',
            reason: record.reason, who: record.who, at: record.at,
            corroborates: twin.at,
          };
          if (record.scope === 'fleet') note.scope = 'fleet'; else note.repo = record.repo;
          for (const f of idf || []) if (record[f] !== undefined) note[f] = record[f];
          if (record.seenAtLine !== undefined) note.seenAtLine = record.seenAtLine;
          const noteErrs = validateScannerAnnotation(note, idf, { requireExpires: true });
          if (noteErrs.length) return send(500, { ok: false, error: 'corroboration record failed validation', errors: noteErrs });
          doc.scannerAnnotations.push(note);
          writeAtomic(STORE(), `${JSON.stringify(doc, null, 2)}\n`);
          return send(200, {
            ok: true, duplicate: true, recorded: 'note', record: note, matched,
            incumbent: { who: twin.who, at: twin.at, action: twin.action, reason: twin.reason, expires: twin.expires || null },
            message: `already ${twin.action} by ${twin.who} at ${twin.at}${twin.expires ? ` (review by ${twin.expires})` : ''} — your judgment is recorded as corroboration, and the review date is unchanged. Pass force:true to author a second suppression anyway.`,
            effective: 'next-rollup', stillOpen: true,
          });
        }

        // Not a twin, but something else may already suppress this identity under a DIFFERENT
        // action. That is a changed judgment, not a duplicate, so it is written — but first-match
        // -wins means the incumbent keeps governing, and an operator who is not told that will
        // believe they changed something.
        const governing = anyActiveSuppressionFor(sameCat, record, record.at, idf);
        doc.scannerAnnotations.push(record);
        writeAtomic(STORE(), `${JSON.stringify(doc, null, 2)}\n`);

        return send(200, {
          ok: true, record, matched,
          ...(governing ? {
            governedBy: { who: governing.who, at: governing.at, action: governing.action },
            message: `written, but '${governing.action}' by ${governing.who} at ${governing.at} still governs this identity — the overlay takes the FIRST active match, so this record will not change what the rollup shows until that one expires or is removed.`,
          } : {}),
          // the overlay runs at rollup time; until then every consumer still shows the row open
          effective: 'next-rollup',
          stillOpen: true,
        });
      } finally {
        lock.release();
      }
    });
  } },
];

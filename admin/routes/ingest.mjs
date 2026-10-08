// admin/routes/ingest.mjs — the return path's HTTP mouth: the panel's half of "a person disagrees
// with this finding".
//
// This module validates nothing — every rule lives in monitor/ingest-external.mjs, the only thing
// that writes an external judgement. Every route requires a session, loopback included (the
// dispatcher sits above the login gate). Deliberately absent: deleting a finding, closing as fixed.

import { requireSession } from '../lib/route-auth.mjs';
import {
  loadIssues, saveIssues, withIssuesLock, nowISO,
} from '../../monitor/issue-store.mjs';
import {
  ingestExternal, runRescan, rescanArgv, rescanLevels, judgementView, subjectDigest,
  DISPOSITIONS, RESCAN_NONE,
} from '../../monitor/ingest-external.mjs';
import { refreshLearningView } from '../../monitor/learning-refresh.mjs';

// Identical to routes/profile.mjs::requireSession.

// Fail closed: an unreadable store is a 503, never an empty list.
function withStore(send, fn) {
  try { return fn(); }
  catch (e) { return send(503, { ok: false, error: `issue store unavailable: ${e.message}` }); }
}

export const routes = [
  // GET /api/ingest/targets — what can be judged, and what each thing's CURRENT green actually is.
  // subjectDigest travels so the client can pin it on the way back — same guarantee as an ETag.
  { method: 'GET', path: '/api/ingest/targets', handle: (ctx) => {
    const { send, query } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return withStore(send, () => {
      const now = nowISO();
      const doc = loadIssues();
      const area = query.get('project');
      const rows = Object.values(doc.issues)
        .filter((i) => i.state !== 'closed')
        .filter((i) => !area || i.area === area)
        .map((i) => judgementView(i, { now }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 500);
      return send(200, {
        ok: true, generated: now, area: area || null,
        // the legend travels WITH the data — `human-green` is not `scanner-clean`
        greenKinds: {
          'scanner-clean': 'a scanner proved it — evidence-gated auto-close',
          'human-green': 'a person ruled on it; the finding is still here, attributed and expiring',
          'claimed-fixed': 'a person says they fixed it — unproven, still queued',
          'agent-proposed': 'an agent proposed a false-positive or not-applicable — not in force, still queued until a person rules',
          'human-closed': 'closed by a person (accepted/refuted/superseded) — a decision, not a proof',
          grey: 'closed as fixed with no machine evidence tier — provenance missing, not proven',
          open: 'no judgement, no proof',
        },
        rescanLevels: [...rescanLevels()].sort(),
        dispositions: [...DISPOSITIONS],
        rows,
      });
    });
  } },

  // POST /api/ingest/judgement — the write; the spine owns the body
  { method: 'POST', path: '/api/ingest/judgement', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const at = nowISO();
      let out, area, learningSource;
      try {
        out = withIssuesLock(() => {
          const doc = loadIssues();
          // `session` is the session object — attribution.mjs::sessionWho is the one resolver, HTTP-free
          const res = ingestExternal(doc, body, { now: at, session: s, channel: 'http' });
          if (res.ok) { saveIssues(doc); area = doc.issues[res.issueId].area; learningSource = doc; }
          return res;                       // refusals mutate nothing, so nothing is saved
        });
      } catch (e) { return send(503, { ok: false, error: `issue store unavailable: ${e.message}` }); }

      if (!out.ok) {
        // 401 unsigned, 409 subject moved, 404 unknown, 400 caller-fixable; `quarantined` = filed
        // as a refusal, not dropped
        const status = (out.refused === 'no-identity' || out.refused === 'bad-identity') ? 401
          : out.refused === 'stale-subject' ? 409
            : out.refused === 'unknown-issue' ? 404 : 400;
        return send(status, { ok: false, refused: out.refused, errors: out.errors, quarantined: !!out.quarantined });
      }

      const learning = refreshLearningView(learningSource, { now: at });
      if (!learning.ok) console.error(`[learning] ${learning.error}`);

      // the judgement is ALREADY FILED — an unbuildable re-scan is reported un-run, never thrown
      // past the caller
      let spawned;
      try {
        const argv = out.rescan.level === RESCAN_NONE ? null : rescanArgv(out.rescan.level, area);
        spawned = runRescan(argv);
      } catch (e) { spawned = { spawned: false, reason: `re-scan not started: ${e.message}` }; }
      return send(200, {
        ok: true,
        issueId: out.issueId,
        filed: {
          id: out.disposition.id, disposition: out.disposition.disposition,
          who: out.disposition.who, whoKind: out.disposition.whoKind,
          at: out.disposition.at, expires: out.disposition.expires,
        },
        subjectDigest: out.subjectDigest,
        greenKind: out.greenKind,
        // stated every time — ok:true must not read as a fix
        stillOpen: true,
        learning,
        rescan: { level: out.rescan.level, spawned: spawned.spawned, reason: spawned.reason },
      });
    });
  } },

  // GET /api/ingest/judgement?id=ISS-… — one issue's full judgement history, for the detail view.
  { method: 'GET', path: '/api/ingest/judgement', handle: (ctx) => {
    const { send, query } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return withStore(send, () => {
      const now = nowISO();
      const doc = loadIssues();
      // the query string is only an object-key lookup — a caller's bytes never travel onward
      const iss = doc.issues[String(query.get('id') || '')];
      if (!iss) return send(404, { ok: false, error: 'no such issue' });
      return send(200, { ok: true, generated: now, ...judgementView(iss, { now }), currentSubjectDigest: subjectDigest(iss) });
    });
  } },
];

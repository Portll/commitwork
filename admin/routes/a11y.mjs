// admin/routes/a11y.mjs — the Accessibility tab: WCAG 2.2 conformance by criterion, plus human
// attestations for the criteria static analysis cannot close.
//
// The rules live in monitor/a11y-attestations.mjs — this transport re-implements none of them.
// Every write requires a session, loopback included (the dispatcher sits above the login gate).
// An attested criterion never counts as a scanner pass: effectiveState sits BESIDE `state`.

import { requireSession } from '../lib/route-auth.mjs';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import {
  loadAttestations, saveAttestations, withAttestationsLock, recordAttestation, mergeAttestations,
  attestableCriteria, nowISO, VERDICTS,
} from '../../monitor/a11y-attestations.mjs';
import { CW, readJSON, registry, reportsFor } from '../lib/core.mjs';

/** The newest sweep batch that carries an a11y.json, and the first repo dir in it that has one. */
function latestA11y(project) {
  // resolve(), not join(): an ABSOLUTE reportsRoot is legitimate registry input — join() under CW
  // made every batch lookup miss
  const root = resolve(CW, registry().reportsRoot || 'reports');
  if (!existsSync(root)) return null;
  let batches;
  try {
    batches = readdirSync(root).filter((d) => /^sweep-\d{14}/.test(d) && statSync(join(root, d)).isDirectory()).sort().reverse();
  } catch { return null; }
  const slug = project ? projectSlug(project) : null;
  for (const b of batches) {
    // an area-scoped batch is named sweep-<stamp>-<slug>; prefer the selected area's own batches
    if (slug && !(b.endsWith(`-${slug}`) || b.endsWith('-all'))) continue;
    let repos; try { repos = readdirSync(join(root, b)); } catch { continue; }
    for (const r of repos.sort()) {
      const p = join(root, b, r, 'a11y.json');
      if (existsSync(p)) { const j = readJSON(p); if (j) return { ...j, batch: b, repo: r }; }
    }
  }
  return null;
}

/** Area an attestation files under; unresolvable ⇒ refused. Returns the KNOWN set's own slug, never the caller's bytes. */
function resolveArea(q, known) {
  const raw = String(q || '');
  if (!raw) return null;
  const slug = projectSlug(raw);
  for (const cand of [slug, raw]) { if (cand && known.has(cand)) return projectSlug(cand) || cand; }
  return null;
}

// Identical to routes/ingest.mjs::requireSession.

// Fail closed: an unreadable store is a 503, never an empty board.
function withStore(send, fn) {
  try { return fn(); }
  catch (e) { return send(503, { ok: false, error: `a11y attestation store unavailable: ${e.message}` }); }
}

/** Shared by the two write routes: resolve identity + area, then hand the payload to the spine. */
function writeAttestation(ctx, force) {
  const { req, send, query, knownProjects } = ctx;
  const s = requireSession(ctx);
  if (!s) return send(401, { ok: false, error: 'authentication required — an attestation is worth exactly the identity behind it, and there is no anonymous one' });
  return ctx.readJsonBody(req, (body, err) => {
    if (err) return send(400, { ok: false, error: err });
    const area = resolveArea(query.get('project'), knownProjects());
    const now = nowISO();
    const report = latestA11y(area);
    let out;
    try {
      out = withAttestationsLock(() => {
        const doc = loadAttestations();
        // `session` is the session object — attribution.mjs::sessionWho is the one resolver, HTTP-free
        const res = recordAttestation(doc, force ? { ...body, action: force } : body,
          { report, area: area || '', session: s, now, channel: 'http' });
        if (res.ok) saveAttestations(doc);
        return res;                            // refusals mutate nothing, so nothing is saved
      });
    } catch (e) { return send(503, { ok: false, error: `a11y attestation store unavailable: ${e.message}` }); }

    if (!out.ok) {
      // 401 unsigned, 409 content moved, 404 unknown criterion, 400 caller-fixable
      const status = (out.refused === 'no-identity' || out.refused === 'bad-identity') ? 401
        : out.refused === 'stale-subject' ? 409
          : (out.refused === 'no-subject' || out.refused === 'nothing-to-withdraw') ? 404 : 400;
      return send(status, { ok: false, refused: out.refused, errors: out.errors });
    }
    return send(200, {
      ok: true,
      entry: out.entry,
      // stated every time — ok:true must not read as a green tick
      note: out.entry.action === 'withdraw'
        ? 'withdrawn — the criterion is `unchecked` again, which is not a pass'
        : 'recorded as an ATTESTATION, not a scanner pass: it is bound to this exact page content, '
          + 'it lapses when that content changes, and it is counted separately from `pass` everywhere.',
    });
  });
}

export const routes = [
  { method: 'GET', path: '/api/a11y', handle: (ctx) => {
    const { send, query, knownProjects } = ctx;
    const q = query.get('project');
    const known = knownProjects();
    const area = resolveArea(q, known);
    const doc = latestA11y(area);
    if (!doc) {
      return send(200, { ok: false,
        reason: 'no a11y.json in this area’s sweep batches — the WCAG audit has not run here. That is unmeasured, not conformant.' });
    }
    return withStore(send, () => {
      const now = nowISO();
      const store = loadAttestations();
      const merged = mergeAttestations(doc, store, { area, now });
      return send(200, {
        ok: true,
        ...merged,
        attestation: {
          area,
          // attestable only with an area to file under AND a content digest to bind to; both absences stated
          canAttest: !!area && !!merged.subjectDigest,
          reason: !area ? 'pick a project — an attestation names the pages it is about'
            : !merged.subjectDigest ? 'this audit artifact predates content digests; re-run the a11y-wcag check before attesting against it'
              : null,
          attestable: [...attestableCriteria()].sort(),
          verdicts: [...VERDICTS],
        },
      });
    });
  } },

  // POST /api/a11y/attest?project=… — record one verification; the spine owns the body
  { method: 'POST', path: '/api/a11y/attest', handle: (ctx) => writeAttestation(ctx, null) },

  // POST /api/a11y/attest/clear?project=… — withdraw: an APPEND with `action` forced, never a delete
  { method: 'POST', path: '/api/a11y/attest/clear', handle: (ctx) => writeAttestation(ctx, 'withdraw') },
];

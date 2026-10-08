// admin/routes/remediation-policy.mjs — read/write the org's remediation posture (the three
// toggles). Session-gated, loopback included; same 400/409/503 ladder as the products wizard.
import { requireSession } from '../lib/route-auth.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { policyPath, loadPolicy, validatePolicy, checkAgenticPreconditions, DEFAULT_POLICY, MODES, VERIFICATION, LEARNING, CADENCE }
  from '../../monitor/remediation-policy.mjs';
import { writeJSONAtomic, sha256 } from '../../cra/lib.mjs';
import { acquireLockOrReason } from '../../monitor/lockfile.mjs';

// The agentic modes authorise a machine to change code — escalation is refused here and made a
// deliberate file edit; de-escalation never needs ceremony.
const API_SETTABLE_MODES = new Set(['report', 'hitl-item']);

// Read-hash-compare-write is a TOCTOU without this lock — writeJSONAtomic prevents torn files, not
// lost updates.
function withPolicyLock(path, fn) {
  const got = acquireLockOrReason(`${path}.lock`, {
    staleMs: 30_000, label: 'remediation-policy', attempts: 50, spinMs: 20,
    onStale: (ageMs) => console.warn(`[policy] breaking a stale policy lock (${Math.round(ageMs / 1000)}s old)`),
  });
  // Three outcomes, not two: `unavailable` (the disk/mount refused the lock) must not be reported
  // as `locked` (another writer holds it), because only one of those is worth retrying.
  if (!got.ok && got.reason === 'unavailable') return { unavailable: true, code: got.code, message: got.message };
  if (!got.ok) return { locked: true };
  try { return { locked: false, value: fn() }; } finally { got.lock.release(); }
}

export const routes = [
  // GET /api/remediation-policy — DECLARED policy + content hash + enums; a corrupt store is 503,
  // never a silent default. Read ungated so a refused agentic mode can still be seen and
  // de-escalated; `agentic` says whether this run's witness permits the declared mode.
  { method: 'GET', path: '/api/remediation-policy', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    let policy;
    try { policy = loadPolicy(policyPath(), { agenticGate: false }); } catch (e) { return send(503, { ok: false, error: e.message }); }
    const p = policyPath();
    const hash = existsSync(p) ? sha256(readFileSync(p, 'utf8')) : null;
    return send(200, {
      ok: true, policy, hash,
      agentic: checkAgenticPreconditions({ policy }),
      enums: { mode: MODES, verification: VERIFICATION, learning: LEARNING, cadence: CADENCE },
      default: DEFAULT_POLICY,
    });
  } },

  // POST /api/remediation-policy {policy, baseHash} — replace, guarded. 400 invalid body /
  // validatePolicy errors · 409 changed since baseHash (or none) · 503 current store corrupt.
  { method: 'POST', path: '/api/remediation-policy', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const doc = body && body.policy;
      if (!doc || typeof doc !== 'object') return send(400, { ok: false, error: 'body.policy is required' });
      const p = policyPath();
      // AUTHORITY BEFORE CONCURRENCY — refused on the ASKED-FOR state, never the stored one.
      // MODES.includes first: a non-mode is malformed (400), not forbidden (403).
      if (doc.mode !== undefined && MODES.includes(doc.mode) && !API_SETTABLE_MODES.has(doc.mode)) {
        const pre = checkAgenticPreconditions({ policy: doc });
        return send(403, {
          ok: false,
          error: `mode=${doc.mode} authorises a machine to change code in repositories this one does not own. `
            + 'That is an operator decision, not a panel toggle: edit monitor/remediation-policy.json '
            + 'directly and record the ruling in evaluations/DECISIONS.md. This route sets '
            + `${[...API_SETTABLE_MODES].join(' or ')}.`
            + (pre.ok ? '' : ` Even as a file edit it would be refused for this run: ${pre.errors.join('; ')}`),
          settableModes: [...API_SETTABLE_MODES],
          agentic: pre,
        });
      }
      if (doc.m3 && doc.m3.autoMerge === true) {
        return send(403, {
          ok: false,
          error: 'm3.autoMerge authorises landing machine-authored changes without a human merge. '
            + 'Authoring is not merging — set it in the file deliberately, not over the API.',
        });
      }
      const outcome = withPolicyLock(p, () => {
        let currentHash = null;
        if (existsSync(p)) {
          let raw;
          try { raw = readFileSync(p, 'utf8'); } catch (e) { return { code: 503, body: { ok: false, error: `policy store unreadable: ${e.code || e.message}` } }; }
          try { JSON.parse(raw); } catch { return { code: 503, body: { ok: false, error: 'policy store is corrupt (unparseable JSON) — refusing to overwrite blind' } }; }
          currentHash = sha256(raw);
        }
        if ((body.baseHash ?? null) !== currentHash) {
          return { code: 409, body: { ok: false, error: 'policy changed since it was loaded (or no baseHash was supplied) — reload and reapply', currentHash } };
        }
        const v = validatePolicy(doc);
        if (v.errors.length) return { code: 400, body: { ok: false, errors: v.errors, advisories: v.advisories } };
        writeJSONAtomic(p, doc);
        const hash = sha256(readFileSync(p, 'utf8'));
        return { code: 200, body: { ok: true, hash, advisories: v.advisories, policy: loadPolicy() } };
      });
      // Checked before outcome.value is touched: on `unavailable` there is no value, and the
      // old two-branch shape would have fallen through to outcome.value.code and thrown.
      if (outcome.unavailable) {
        return send(503, { ok: false, unavailable: true, error: `policy lock unavailable${outcome.code ? ` (${outcome.code})` : ''}: ${outcome.message}` });
      }
      if (outcome.locked) {
        return send(503, { ok: false, error: 'another writer holds the policy file; retry in a moment' });
      }
      return send(outcome.value.code, outcome.value.body);
    });
  } },
];

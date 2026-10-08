// admin/routes/verdicts.mjs — the oversight layer's own decision history, served.
//
// Gate journals carry free text and are NEVER served raw — only the redacted projection from
// bin/lib/verdict-journal-core.mjs (imported, never reimplemented). Health states render faithfully:
// absent, torn, stale and unreadable each keep their own rendering, never merged with "ok".
// Session-checked here — the dispatcher sits above the login gate.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { journalHealth, readJournal, readJournalFile, redactGateRecord, readAdjudications, fatigueReport, computeFindingCalibration, appendFindingAdjudication, TRUTHS } from '../../bin/lib/verdict-journal-core.mjs';
import { bandOf } from '../../lib/chain-lexicon.mjs';
import { projectFatigue, projectCalibration, projectEscalations } from '../lib/served-projection.mjs';
import { buildQueue, adjudicatedKeys, TRIAGE_RULES } from '../lib/adjudication-triage.mjs';
import { loadRegistry, areaOut } from '../../monitor/registry.mjs';
import { reportsRootDir } from '../../monitor/area.mjs';
import { projectSlug, areaSlugOf } from '../../monitor/project-scope.mjs';
import { resolveRepos } from '../../monitor/discover.mjs';

// guard: project name never shapes a path
function rollupFor(project) {
  const reg = loadRegistry({ quiet: true });
  const slug = projectSlug(project) || String(project || '');
  const out = areaOut(slug, reg) || slug;
  if (!out || !/^[a-z0-9][a-z0-9._-]*$/i.test(out)) return { state: 'unresolved', reg };
  let text;
  try { text = readFileSync(join(reportsRootDir(reg), out, 'rollup.json'), 'utf8'); }
  catch (e) { return e && e.code === 'ENOENT' ? { state: 'no-rollup', area: out, reg } : { state: 'unreadable', area: out, detail: (e && e.code) || 'error', reg }; }
  try { return { state: 'ok', area: out, rollup: JSON.parse(text), reg }; }
  catch { return { state: 'unreadable', area: out, detail: 'parse', reg }; }
}
// fact: unresolvable ownership ranks nobody
function ownRepoSet(reg) {
  try {
    const third = new Set((reg.areas || []).filter((a) => a.thirdParty).map((a) => a.slug));
    const own = new Set();
    for (const r of resolveRepos(reg, {}).repos) if (!third.has(r.area || areaSlugOf(r.name))) own.add(r.name);
    return own;
  } catch { return null; }
}
const who = (s) => String((s && (s.user || s.email || s.name)) || 'operator').slice(0, 80);

// --tally's fatigue + calibration sections, served. Unreadable is its own state, never "nothing
// suppressed" / "calibrated clean"; the wire shape is the allowlist in lib/served-projection.mjs.
function tallySections() {
  let adj;
  try { adj = readAdjudications(); }
  catch (e) {
    const unreadable = { state: 'unreadable', detail: (e && e.code) || 'error' };
    // fail closed on all three: 'none recorded' must never stand in for 'could not read'
    return { fatigue: unreadable, calibration: unreadable, escalations: unreadable };
  }
  const escalations = projectEscalations(adj);
  const fatigue = projectFatigue(adj, fatigueReport(adj.records));
  const findingRecords = (adj.records || []).filter((r) => r && r.kind === 'finding-adjudication');
  // aggregate only (windowStart null => everything standing); the banked-baseline regression
  // compare stays CLI-only (bin/verdict-journal.mjs --calibrate) — the panel states rates, not deltas.
  const calibration = adj.absent || !findingRecords.length
    ? { state: 'no-records' }
    : projectCalibration(computeFindingCalibration(findingRecords));
  return { fatigue, calibration, escalations };
}

export const routes = [{
  method: 'GET',
  path: '/api/verdicts',
  handle(ctx) {
    const s = ctx.adminSession(ctx.req);
    if (!s) return ctx.send(401, { ok: false, error: 'not authenticated — log in first' });
    try {
      // LABEL AND BAND, BOTH, ON EVERY ROW. The label is the specific finding; the band is how to
      // read it, and it is the only field a renderer should colour on. Bands are a closed set of
      // six, labels are open — colour on the label and every state added later falls through to
      // whatever the renderer's default happens to be. `known: false` marks a state nobody has
      // classified: it bands as `undetermined`, never silently as sound or forged.
      const withBand = (o) => ({ ...o, ...(({ band, known }) => ({ band, bandKnown: known }))(bandOf(o.state)) });
      const gates = journalHealth().map((h) => {
        if (h.state !== 'ok' && h.state !== 'torn') return withBand(h);
        try {
          const j = readJournal(h.gate);
          const recent = j.records.slice(-20).map(redactGateRecord);
          // WHY, not just how many. `breaks[]` carries the reason for each break; without it the
          // panel could only say "chain-broken, 47" and 47 unexplained breaks sat unread. Bounded
          // at 20 so one very broken ledger cannot dominate the response.
          //
          // `line` is DISPLAY ONLY and `path` is made store-relative: a finding's identity must
          // never key on a line number (code moves for reasons that have nothing to do with the
          // finding), and an absolute path discloses the sidecar layout to the client.
          const breaks = (j.breaks || []).slice(0, 20).map((b) => ({
            file: String(b.path || '').split('/').pop(), line: b.line, why: b.why,
          }));
          return withBand({
            ...h, recent, last: recent.length ? recent[recent.length - 1] : null,
            breaks, breakCount: (j.breaks || []).length,
            renumbered: j.chain?.renumbered ?? 0, gaps: j.gaps || [],
            // examined is part of the verdict, not a debug field: `broken: 0` is produced by an
            // intact chain AND by a chain nobody read, and those two must not print identically.
            examined: j.chain?.examined ?? 0,
          });
        } catch (e) {
          return withBand({ ...h, state: 'unreadable', detail: e.code || 'error' });
        }
      });

      const areas = [];
      let fleet = null;
      let sweepError = null;
      try {
        const reg = loadRegistry({ quiet: true });
        const root = reportsRootDir(reg);
        for (const a of reg.areas || []) {
          try {
            const j = readJournalFile(join(root, areaOut(a.slug, reg), 'sweep-journal.jsonl'));
            const last = j.records.length ? j.records[j.records.length - 1] : null;
            areas.push(j.absent
              ? { area: a.slug, state: 'absent' }
              : { area: a.slug, state: j.torn ? 'torn' : 'ok', torn: j.torn, entries: j.records.length, last });
          } catch (e) {
            areas.push({ area: a.slug, state: 'unreadable', detail: e.code || 'error' });
          }
        }
        try {
          const f = readJournalFile(join(root, 'sweep-fleet-journal.jsonl'));
          fleet = f.absent
            ? { state: 'absent' }
            : { state: f.torn ? 'torn' : 'ok', torn: f.torn, entries: f.records.length, last: f.records.length ? f.records[f.records.length - 1] : null };
        } catch (e) {
          fleet = { state: 'unreadable', detail: e.code || 'error' };
        }
      } catch {
        // registry failure is stated, never rendered as "no areas" — explicit uncertainty
        sweepError = 'registry unavailable — sweep journal state is UNKNOWN this load, not empty';
      }

      return ctx.send(200, { gates, areas, fleet, ...tallySections(), ...(sweepError ? { sweepError } : {}), generatedAt: new Date().toISOString() });
    } catch {
      return ctx.send(500, { ok: false, error: 'verdict journals could not be read — see the panel log' });
    }
  },
}, {
  // fact: every non-ok state is named
  method: 'GET',
  path: '/api/verdicts/triage',
  handle(ctx) {
    const s = ctx.adminSession(ctx.req);
    if (!s) return ctx.send(401, { ok: false, error: 'not authenticated — log in first' });
    const project = ctx.query && typeof ctx.query.get === 'function' ? ctx.query.get('project') : null;
    const r = rollupFor(project);
    if (r.state !== 'ok') return ctx.send(200, { state: r.state, area: r.area || null, ...(r.detail ? { detail: r.detail } : {}), rules: TRIAGE_RULES });
    let adj;
    try { adj = readAdjudications(); }
    catch (e) { return ctx.send(200, { state: 'unreadable', area: r.area, detail: `adjudications: ${(e && e.code) || 'error'}`, rules: TRIAGE_RULES }); }
    const queue = buildQueue({ rollup: r.rollup, adjudicated: adjudicatedKeys(adj.records), ownRepos: ownRepoSet(r.reg) });
    return ctx.send(200, { area: r.area, generatedAt: new Date().toISOString(), ...queue });
  },
}, {
  // guard: writes accepted from operator port only
  method: 'POST',
  path: '/api/verdicts/adjudicate',
  handle(ctx) {
    const { req, send, readJsonBody } = ctx;
    const s = ctx.adminSession(req);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    if (!ctx.isLoopbackReq) return send(403, { ok: false, error: 'adjudications are written from the operator port only — the published port is external even when you are sitting at the box' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      if (!body || typeof body !== 'object') return send(400, { ok: false, error: 'body must be a JSON object' });
      const findingKey = typeof body.findingKey === 'string' ? body.findingKey.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      const repo = typeof body.repo === 'string' ? body.repo.trim() : '';
      const basis = typeof body.basis === 'string' ? body.basis.trim() : '';
      if (!findingKey || findingKey.length > 400) return send(400, { ok: false, error: 'findingKey is required (≤400 chars)' });
      if (!category || !repo || category.length > 40 || repo.length > 120) return send(400, { ok: false, error: 'category and repo are required' });
      if (!TRUTHS.includes(body.truth)) return send(400, { ok: false, error: `truth must be one of ${TRUTHS.join(', ')}` });
      if (!basis || basis.length > 2000) return send(400, { ok: false, error: 'basis is required (≤2000 chars) — a truth with no stated evidence is an opinion, and the ledger records evidence' });
      const w = appendFindingAdjudication(
        { findingKey, category, repo, truth: body.truth, basis, adjudicatedBy: who(s), method: 'human', provenance: 'triage:panel' },
        { place: `${category}:${repo}`, artifact: 'rollup.json' },
      );
      if (!w || !w.ok) return send(500, { ok: false, error: `adjudication write FAILED (${(w && w.error) || 'unknown'}) — nothing was recorded` });
      return send(200, { ok: true, findingKey, truth: body.truth, by: who(s) });
    });
  },
}];

// admin/routes/report.mjs — the Report tab: the evidence remediation acts on, redacted for hand-off.

import { join, basename } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { readJSON, reportsFor } from '../lib/core.mjs';
import { verifyChain, verifySliceBytes } from '../../monitor/history-chain.mjs';

// ── the Report tab: the evidence remediation acts on — redacted for hand-off, replayable ────────
// REPLAYABLE: history is read from reports/<area>/history/, never re-derived; the index is the
// closed set, so no caller string becomes a path.
// REDACTED: public identifiers only — no paths, lines, shas, branches, hosts, or reachability
// join; withholding is COUNTED and stated, never silent.
const STAMP_RE = /^\d{14}$/;
const REPORT_CAP = 300; // evidence rows per state — the COUNT is never capped, only the list
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// month-name form: "01/08" is locale-ambiguous; UTC so two reads of one slice agree
function reportWhen(iso) {
  const t = new Date(iso || 0);
  if (!iso || Number.isNaN(t.getTime())) return 'undated';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}Z`;
}
function stateLabel(e, { change = true } = {}) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const sev = [n(e.crit), n(e.high), n(e.med), n(e.low)];
  const open = sev.some((v) => v === null) ? 'open ?' : `open ${sev[0] + sev[1] + sev[2] + sev[3]} (${sev[0]}C ${sev[1]}H ${sev[2]}M ${sev[3]}L)`;
  const base = `${reportWhen(e.generated)} · ${e.kind || 'sweep'} · ${open}`;
  if (!change) return base; // the current state is a standing reading, not a change record
  const bits = [];
  if (n(e.new)) bits.push(`+${e.new} new`);
  if (n(e.fixed)) bits.push(`−${e.fixed} cleaned`);
  if (n(e.accepted)) bits.push(`${e.accepted} accepted`);
  if (n(e.carried)) bits.push(`${e.carried} carried`);
  return `${base}${bits.length ? ' · ' + bits.join(' · ') : ' · no change'}`;
}
function reportStates(project) {
  const dir = reportsFor(project);
  const rollup = readJSON(join(dir, 'rollup.json'));
  const idxRaw = readJSON(join(dir, 'history', 'index.json'));
  const idx = Array.isArray(idxRaw) ? idxRaw : null;
  if (!rollup && !idx) {
    return { absent: true, states: null,
      why: `no rollup and no history for ${project || 'the default area'} — it has never been swept`,
      remedy: 'run a sweep for this project first; every sweep records one replayable state' };
  }
  const states = [];
  if (rollup) {
    const o = rollup.openTotals || rollup.totals || {};
    states.push({ id: 'current', kind: rollup.kind || 'sweep', sliceId: rollup.sliceId || null,
      generated: rollup.generated || null,
      label: `current · ${stateLabel({ generated: rollup.generated, kind: rollup.kind, crit: o.crit, high: o.high, med: o.med, low: o.low }, { change: false })}` });
  }
  // newest first: the dropdown reads downward into the past
  for (const e of (idx || []).slice().sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)))) {
    if (!STAMP_RE.test(String(e.stamp || ''))) continue; // index rows are trusted-shape only
    states.push({ id: String(e.stamp), kind: e.kind || 'sweep', sliceId: e.sliceId || null,
      generated: e.generated || null, label: stateLabel(e) });
  }
  // the hash-chained write log, verified on every read. `unrecorded` names index rows the chain
  // never saw (a write that dodged the log); capped for the wire, with the true count carried.
  const chain = verifyChain(join(dir, 'history'), idx || [], { area: basename(dir), committed: true });
  return { ok: true, project: project || null, states, historyAbsent: !idx,
    historyWhy: idx ? null : 'this area has no history index yet — only the current state is replayable',
    chain: {
      present: chain.present, verified: chain.verified, length: chain.length,
      brokenAt: chain.brokenAt, tailTorn: chain.tailTorn, retroSealed: chain.retroSealed,
      unrecordedCount: chain.unrecorded.length, unrecorded: chain.unrecorded.slice(0, 8),
      // a slice+index rewritten together behind the log: the chain's own hashes still verify, so
      // this is the field that says the store no longer matches what was recorded
      driftedCount: chain.drifted.length, drifted: chain.drifted.slice(0, 8),
      // consistency with the LOCAL anchor only — tamper evidence begins at the sidecar commit
      anchored: chain.anchored, anchorMissing: chain.anchorMissing, anchorShrunk: chain.anchorShrunk,
      anchorAt: chain.anchorAt, anchorWhy: chain.anchorWhy,
      // the COMMITTED anchor: null = undetermined (nothing committed yet, no repo), false = HEAD
      // contradicts the chain, true = the committed tip is in the chain. The three render apart.
      committed: chain.committed, committedMissing: chain.committedMissing, committedShrunk: chain.committedShrunk,
      committedAt: chain.committedAt, committedSha: chain.committedSha, committedWhy: chain.committedWhy,
      // where full-line hashing (chainVersion 2) begins; notes on earlier lines are unprotected
      v1Lines: chain.v1Lines, protectedFrom: chain.protectedFrom,
      error: chain.error,
      note: !chain.present
        ? 'no chain log yet — it starts on this area\'s next sweep; until then the state list is unattested'
        : (chain.drifted.length
          ? `${chain.drifted.length} recorded state(s) no longer hash to what the log recorded for them — rewritten after the fact, consistently enough that the chain alone did not see it`
          : (chain.retroSealed
            ? `${chain.retroSealed} state(s) retro-sealed: attested as found at seal time, which claims nothing about the pre-seal past`
            : null)),
    } };
}
// One whitelist for every finding row leaving this route. Fields are NAMED IN, never filtered
// out; `path` is deliberately absent — counted, not carried.
function redactFinding(f, repo) {
  return {
    repo: f.repo || repo || null,
    severity: f.severity || null,
    tool: f.tool || null,
    id: f.primaryId || f.id || null,
    package: f.package || null,
    version: f.version || null,
    fixedIn: f.fixed || null,
    title: f.title || null,                    // public advisory text, keyed to the public id
    advisory: f.advisory || null,              // public osv.dev / GHSA URL
    kev: f.kev === true,
    epss: typeof f.epss === 'number' && Number.isFinite(f.epss) ? f.epss : null,
    cvss: typeof f.cvss === 'number' && Number.isFinite(f.cvss) ? f.cvss : null,
    state: f.state || f.status || 'open',
  };
}
// scanners.* pass through as COUNTS + provenance only — no per-finding locations
function redactScanners(scanners) {
  if (!scanners || typeof scanners !== 'object') return null;
  const out = {};
  for (const [k, s] of Object.entries(scanners)) {
    if (!s || typeof s !== 'object') continue;
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    out[k] = { crit: n(s.crit), high: n(s.high), med: n(s.med), low: n(s.low), total: n(s.total),
      ran: n(s.ran), skipped: n(s.skipped), noscan: n(s.noscan),
      carried: s.carried === true || undefined, carriedFrom: s.carried ? (s.carriedFrom || null) : undefined };
  }
  return Object.keys(out).length ? out : null;
}
function reportEvidence(project, stateId) {
  const dir = reportsFor(project);
  let doc, sourceFile, delta = null, deltaWhy = null;
  // integrity: recorded states are byte-checked against the hash their index row attests; the
  // current rollup is the live document, so integrity is a property only recorded states can have.
  let integrity = { checked: false, match: null, why: 'the current rollup is the live document — integrity attaches to recorded states' };
  if (stateId === 'current') {
    doc = readJSON(join(dir, 'rollup.json'));
    sourceFile = 'rollup.json';
    if (!doc) {
      return { ok: false, absent: true,
        error: `no rollup for ${project || 'the default area'} — nothing to report against. This is the absence of a reading, not a clean bill of health.` };
    }
    deltaWhy = 'change is recorded per slice; the current state shows standing evidence — pick a recorded state to see what changed at it';
  } else {
    // the history INDEX is the closed set of replayable states — an unnamed stamp never becomes a filename
    const idx = readJSON(join(dir, 'history', 'index.json'));
    const entry = Array.isArray(idx) ? idx.find((e) => String(e.stamp) === stateId) : null;
    if (!entry) {
      return { ok: false, unknownState: true,
        error: `state ${stateId} is not in this project's history index — the index is the closed set of replayable states` };
    }
    doc = readJSON(join(dir, 'history', `${stateId}.json`));
    sourceFile = `history/${stateId}.json`;
    integrity = verifySliceBytes(join(dir, 'history'), entry.file || `${stateId}.json`, entry.sliceSha256 || null);
    if (!doc) {
      // the index names it but the slice is unreadable — a read failure, never an empty success
      return { ok: false, error: `the history index names ${stateId} but ${sourceFile} could not be read — the state exists and cannot be replayed, which is not the same as empty` };
    }
    const d = doc.delta || {};
    delta = {
      new: typeof d.new === 'number' ? d.new : null,
      fixed: typeof d.fixed === 'number' ? d.fixed : null,
      newFindings: (d.newFindings || []).slice(0, 50).map((f) => redactFinding(f)),
      fixedFindings: (d.fixedFindings || []).slice(0, 50).map((f) => redactFinding(f)),
    };
  }
  // findings: the rollup nests them per repo; a slice carries them flat. One whitelist either way.
  let rows = [];
  if (Array.isArray(doc.findings)) rows = doc.findings.map((f) => redactFinding(f));
  else for (const r of (doc.repos || [])) for (const f of (r.findings || [])) rows.push(redactFinding(f, r.name));
  // withheld is COUNTED, not implied
  let withheldLocations = 0;
  const countPaths = (list) => { for (const f of list || []) if (f && (f.path || f.line != null)) withheldLocations++; };
  if (Array.isArray(doc.findings)) countPaths(doc.findings);
  else for (const r of (doc.repos || [])) countPaths(r.findings);
  // secrets: rule + repo + count ONLY — file/line/commit locate a credential and are withheld, counted
  let secretsEvidence = null, malwareEvidence = null, supplyEvidence = null, scannerEvidenceWhy = null;
  const scannerEvidence = {};   // category -> [{repo, rule, sev, count}] for every OTHER detail category
  const sf = doc.scannerFindings;
  if (sf && typeof sf === 'object') {
    const tally = new Map();
    for (const s of (sf.secrets || [])) {
      const k = `${s.repo || '?'}|${s.rule || '?'}`;
      tally.set(k, (tally.get(k) || 0) + 1);
      withheldLocations++;
    }
    secretsEvidence = [...tally.entries()].sort().map(([k, count]) => {
      const [repo, rule] = k.split('|');
      return { repo, rule, count };
    });
    malwareEvidence = (sf.maliciousPackages || []).map((m) => ({ repo: m.repo || null, id: m.id || null,
      package: m.package || null, version: m.version || null, ecosystem: m.ecosystem || null, advisory: m.advisory || null }));
    supplyEvidence = (sf.supplyChainHeuristic || []).map((g) => ({ repo: g.repo || null, rule: g.rule || null,
      package: g.package || null, version: g.version || null })); // message withheld: free text can embed metadata

    // ── every other category, tallied ─────────────────────────────────────────────────────────
    // rule ids + counts are public; locations withheld and counted. Driven off the categories
    // PRESENT in the slice, so a new rollup category needs no second edit here.
    const HANDLED = new Set(['secrets', 'maliciousPackages', 'supplyChainHeuristic']);
    for (const [cat, rows2] of Object.entries(sf)) {
      if (HANDLED.has(cat) || !Array.isArray(rows2) || !rows2.length) continue;
      const tally = new Map();
      for (const f of rows2) {
        if (!f || typeof f !== 'object') continue;
        if (f.file || f.path || f.line != null) withheldLocations++;
        const k = `${f.repo || '?'}|${f.rule || f.id || '?'}|${f.sev || ''}`;
        tally.set(k, (tally.get(k) || 0) + 1);
      }
      scannerEvidence[cat] = [...tally.entries()].sort().map(([k, count]) => {
        const [repo, rule, sev] = k.split('|');
        return { repo, rule, sev: sev || null, count };
      });
    }
  } else {
    scannerEvidenceWhy = stateId === 'current'
      ? 'this rollup carries no per-category detail — re-roll the batch to populate it'
      : 'this state’s slice predates per-category detail recording; counts above are the slice’s own — newer slices carry the detail and replay it';
  }
  const o = doc.openTotals || doc.totals || {};
  const total = rows.length;
  return {
    ok: true,
    state: { id: stateId, kind: doc.kind || 'sweep', sliceId: doc.sliceId || null,
      generated: doc.generated || null, label: stateId === 'current' ? 'current' : stateLabel({ ...(doc.delta || {}), generated: doc.generated, kind: doc.kind, crit: o.crit, high: o.high, med: o.med, low: o.low }) },
    totals: { crit: o.crit ?? null, high: o.high ?? null, med: o.med ?? null, low: o.low ?? null },
    scanners: redactScanners(doc.scanners),
    findingsTotal: total,
    findings: rows.slice(0, REPORT_CAP),
    truncated: total > REPORT_CAP ? total - REPORT_CAP : 0,
    delta, deltaWhy, integrity,
    secretsEvidence, malwareEvidence, supplyEvidence, scannerEvidenceWhy,
    scannerEvidence: Object.keys(scannerEvidence).length ? scannerEvidence : null,
    redaction: {
      withheldLocations,
      policy: [
        'carries public identifiers only: CVE/advisory ids, package names, rule ids — the evidence being remediated',
        `file paths, lines and commits are withheld (${withheldLocations} located value(s) counted, not carried) — the located rows stay on the authenticated scanner tabs`,
        'no hosts, endpoints, branches, shas or machine paths anywhere in this payload',
        'no reachability data and no exposure join — a leaked copy cannot compose these findings into an attack chain; the joined view lives on the Exposure tab and does not leave the box',
      ],
    },
    source: { file: sourceFile },
  };
}
// ── routes ──────────────────────────────────────────────────────────────────────────────────────
export const routes = [
  { method: 'GET', path: '/api/report/states', handle: ({ send, query, knownProjects }) => {
    const q = query.get('project');
    const known = knownProjects();
    const ok = q && (known.has(q) || known.has(projectSlug(q)));
    return send(200, reportStates(ok ? q : null));
  } },
  { method: 'GET', path: '/api/report/evidence', handle: ({ send, query, knownProjects }) => {
    const q = query.get('project');
    const known = knownProjects();
    const ok = q && (known.has(q) || known.has(projectSlug(q)));
    const st = String(query.get('state') || 'current');
    // the closed set: 'current' or a 14-digit history stamp, never a caller-shaped path
    if (st !== 'current' && !STAMP_RE.test(st)) {
      return send(400, { ok: false, error: 'state must be "current" or a 14-digit history stamp' });
    }
    const ev = reportEvidence(ok ? q : null, st);
    return send(ev.ok ? 200 : (ev.unknownState ? 404 : 200), ev);
  } },
];

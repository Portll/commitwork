// admin/routes/panel-state.mjs — the panel's read models: GET /api/state, /api/config,
// /api/services and /api/exposure.

import { join } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { reportsFor, readJSON } from '../lib/core.mjs';
import { state } from '../lib/state-view.mjs';
import { exposureVerdict, NOT_A_CLEAN_RESULT } from '../../monitor/exposure-verdict.mjs';
import { knownProjects } from '../lib/jobs.mjs';

// fact: bound once at boot by initPanelStateRoutes
let registry = () => { throw new Error('panel-state.mjs used before initPanelStateRoutes'); };
let configState = () => { throw new Error('panel-state.mjs used before initPanelStateRoutes'); };
let SERVICES = {};

// contract: run once at boot, before the first request
export function initPanelStateRoutes(deps) {
  ({ registry, configState, SERVICES } = deps);
}

export const routes = [
  { method: 'GET', path: '/api/config', handle: ({ send }) => {
    return send(200, configState());
  } },
  // ?project=<label> selects which area's reports to read; omitted keeps the default.
  { method: 'GET', path: '/api/state', handle: ({ req, send }) => {
    const q = new URL(req.url, 'http://127.0.0.1').searchParams.get('project');
    // knownProjects() is a Set of area slugs + registry/discovered names; the picker
    // sends a label ('clientA'), so accept either form.
    const known = knownProjects();
    const ok = q && (known.has(q) || known.has(projectSlug(q)));
    return send(200, state(ok ? q : null));
  } },
  { method: 'GET', path: '/api/services', handle: ({ send }) => {
    return send(200, SERVICES);
  } },
  // ── EXPOSURE: open connections × unpatched software ───────────────────────────────────────────
  // "Vulnerability" here means what the operator means by it: something reachable from outside that
  // is running software with known unpatched findings. Neither half was visible in this panel before
  // — nuclei hostnames are stripped on both server and client, and nothing rendered hosts, ports or
  // certificates at all.
  //
  // The join that makes it exposure rather than two unrelated tables is
  //   hostname -> area -> that area's rollup -> its unpatched findings,
  // and the registry already supplies every hop. Deployment state comes from the SAME module the
  // `bin/deploy.mjs --verify` CLI uses, so the panel and the CLI cannot disagree about what is
  // published. Read-only: it resolves DNS and TCP-probes origins, and writes nothing.
  //
  // HONESTY RULES, carried over from the monitor and not negotiable here:
  //   - an area with no rollup reports scanned:false / worst:'not-scanned', NEVER worst:'none'
  //   - a hostname no area declares is 'undeclared', never silently attributed to a project
  { method: 'GET', path: '/api/exposure', handle: ({ req, send }) => {
    return (async () => {
      let st;
      try {
        const { resolveDeployState } = await import('../../monitor/deploy-state.mjs');
        st = await resolveDeployState({ registry: registry() });
      } catch (e) { return send(200, { ok: false, error: `could not resolve deployment state: ${e.message}`, rows: [] }); }
      if (st.error) return send(200, { ok: false, error: st.error, rows: [], configPath: st.configPath });

      const SEV = ['crit', 'high', 'med', 'low'];
      const rows = st.rows.map((r) => {
        const out = { ...r, scanned: false, worst: 'not-scanned', findings: { crit: 0, high: 0, med: 0, low: 0, kev: 0 }, topFixable: [] };
        if (!r.area) { out.worst = 'unmapped'; return out; }
        const rollup = readJSON(join(reportsFor(r.area), 'rollup.json'));
        if (!rollup) return out;                        // known area, never swept — stays not-scanned
        out.scanned = true;
        out.generated = rollup.generated || null;
        // AGE, always, next to the number it qualifies. Nothing is scheduled on this box (no launchd
        // agent is installed), so every rollup ages indefinitely and a count rendered without its age
        // reads as current when it is days old — the silent-green shape this view exists to break.
        out.ageHours = out.generated ? Math.round((Date.now() - new Date(out.generated).getTime()) / 36e5) : null;
        out.stale = out.ageHours === null ? null : out.ageHours > 24;
        const seen = new Set();
        for (const repo of rollup.repos || []) for (const f of repo.findings || []) {
          if (out.findings[f.severity] != null) out.findings[f.severity]++;
          if (f.kev) out.findings.kev++;
          const key = `${f.id}|${f.package}`;
          if (!seen.has(key) && (f.severity === 'crit' || f.severity === 'high')) {
            seen.add(key);
            out.topFixable.push({ package: f.package || null, id: f.id || null, severity: f.severity, kev: !!f.kev, fixedIn: f.fixed || null });
          }
        }
        out.topFixable.sort((a, b) => (b.kev - a.kev) || SEV.indexOf(a.severity) - SEV.indexOf(b.severity));
        out.topFixable = out.topFixable.slice(0, 8);

        // ── HONESTY RULES 3 AND 4 (R13) ──────────────────────────────────────────────────────
        // The verdict lives in monitor/exposure-verdict.mjs, with the full reasoning and its
        // fixtures. It is a separate module because it was eleven lines inline here, which made
        // the one piece of logic whose whole job is "never render a green you cannot justify" the
        // one piece with no test.
        const v = exposureVerdict({ findings: out.findings, repos: rollup.repos || [], ageHours: out.ageHours });
        Object.assign(out, v);
        return out;
      });

      // ── SCOPE (?project=) ────────────────────────────────────────────────────────────────────
      // This route returned every hostname the box publishes, always. Reading commitwork-admin
      // therefore showed three other projects' rows, and the KPI row counted them — a
      // project's exposure page describing other projects' exposure.
      //
      // Scoped HERE and not in the panel, because the totals below are computed with predicates
      // this file owns (NOT_A_CLEAN_RESULT). Filtering rows in the client and leaving these totals
      // fleet-wide would put a number beside a table that disagrees with it; re-deriving the
      // predicates in the client would be a second declaration of one rule, which is the drift this
      // repository has a named failure mode for. One filter, applied before the totals.
      //
      // An unknown project name yields NO rows rather than every row: a scope that silently falls
      // back to the fleet is how the original defect reads to anyone who does not check.
      const scopeProject = new URL(req.url, 'http://127.0.0.1').searchParams.get('project') || '';
      const scopeArea = scopeProject ? (projectSlug(scopeProject) || String(scopeProject)) : null;
      const inScope = (r) => !scopeArea || r.area === scopeArea;
      const scopedRows = rows.filter(inScope);
      // What the scope is HIDING, so a narrowed view can never read as a complete one. Undeclared
      // hostnames are called out separately: they belong to no project, so no project scope will
      // ever show them, and they are exactly the rows most worth noticing.
      const hidden = rows.filter((r) => !inScope(r));
      const scopeInfo = {
        project: scopeProject || null,
        area: scopeArea,
        hidden: hidden.length,
        hiddenUndeclared: hidden.filter((r) => !r.area).length,
        hiddenDrifted: hidden.filter((r) => r.state !== 'ok' && r.state !== 'withheld (correct)').length,
      };

      // "Exposed" is the intersection: reachable from outside AND carrying unpatched findings.
      const publicRows = scopedRows.filter((r) => r.declared === 'public' || r.declared === 'undeclared');
      const scopedDrift = st.drift.filter((dh) => scopedRows.some((r) => r.hostname === dh.hostname));
      return send(200, {
        ok: true, generated: new Date().toISOString(), configPath: st.configPath,
        declaredCount: st.declaredCount, routedCount: st.routedCount,
        rows: scopedRows,
        scope: scopeInfo,
        drift: scopedDrift.map((d) => d.hostname),
        totals: {
          published: publicRows.length,
          reachable: publicRows.filter((r) => r.dns === true && r.origin !== false).length,
          // `withFindings` used to be `scanned && worst !== 'none'`, which counted every
          // not-scanned/partial/stale row as though a finding had been observed. It now counts
          // ONLY rows carrying a real severity, and the rows whose verdict cannot be trusted are
          // reported separately as `uncertain` rather than folded into either column. A number
          // that silently mixes "we found something" with "we could not tell" is the same defect
          // this view exists to break, one level up in the aggregate.
          withFindings: publicRows.filter((r) => !NOT_A_CLEAN_RESULT.has(r.worst) && r.worst !== 'none').length,
          uncertain: publicRows.filter((r) => NOT_A_CLEAN_RESULT.has(r.worst)).length,
          clean: publicRows.filter((r) => r.worst === 'none').length,
          unscanned: publicRows.filter((r) => !r.scanned).length,
          drifted: scopedDrift.length,
        },
      });
    })();
  } },
];

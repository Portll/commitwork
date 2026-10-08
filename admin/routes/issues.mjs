// admin/routes/issues.mjs — GET /api/issues: the issue tracker rows behind the Issues tab.

import { join } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { reportsFor, readJSON } from '../lib/core.mjs';
import { knownProjects } from '../lib/jobs.mjs';
import { loadIssues, panelRows, nowISO as issuesNowISO } from '../../monitor/issue-store.mjs';

export const routes = [
  // the issue tracker — read-only rows for the Issues tab. panelRows() IS the field whitelist
  // (id / area / kind / severity / state / ageDays / slaBreached / title), enforced at the
  // producer; its rows are served untouched because this payload crosses the published tunnel.
  // Fail closed: loadIssues() throws on a corrupt/unreadable store, and that surfaces as a 500 —
  // never an empty array reading as "no issues". 'never-ingested' is stated explicitly so the
  // client can render absence of evidence rather than a clean-looking empty table (explicit uncertainty).
  { method: 'GET', path: '/api/issues', handle: ({ req, send }) => {
    try {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams.get('project');
      const known = knownProjects();
      const ok = q && (known.has(q) || known.has(projectSlug(q)));
      const slug = ok ? (projectSlug(q) || String(q)) : null;
      const doc = loadIssues();
      const rows = panelRows(doc, { now: issuesNowISO() }).filter((r) => !slug || r.area === slug);
      const areaStatus = slug
        ? (doc.lastIngest[slug] || 'never-ingested')
        : (Object.keys(doc.lastIngest).length ? doc.lastIngest : 'never-ingested');
      // BEHIND is its own state, beside 'never-ingested' and 'current'. The tab used to print
      // lastIngest as a bare fact and evaluate nothing, so a tracker fourteen hours behind the live
      // rollup rendered exactly like one ingested a minute ago — the queue looked authoritative
      // while describing a scan that had been superseded twice. Comparing it to the rollup the
      // panel is already reading is the whole fix.
      //
      // An unreadable rollup yields behind:null — UNKNOWN, never `false`. "We could not check" and
      // "it is current" are different answers and only one of them is reassuring.
      let behind = null;
      if (slug) {
        const rollup = readJSON(join(reportsFor(slug), 'rollup.json'));
        if (rollup && rollup.generated) {
          const last = doc.lastIngest[slug];
          behind = {
            currentSliceId: rollup.sliceId || null,
            currentGenerated: rollup.generated,
            ingestedGenerated: last ? last.generated : null,
            // strictly newer: ingestArea itself refuses an at-or-before slice (A1 monotonicity),
            // so "equal" is current, not behind.
            isBehind: !last || String(rollup.generated) > String(last.generated),
          };
        }
      }
      return send(200, { generated: issuesNowISO(), area: slug, areaStatus, behind, rows });
    } catch (e) { return send(500, { error: e.message }); }
  } },
];

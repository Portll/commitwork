// admin/routes/renovate.mjs — the Renovate paste-ingest: POST /api/renovate/paste, and its clear
// (POST /api/renovate/paste/clear, DELETE /api/renovate/paste).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { renovateManualFor, RENOVATE_PASTE_CAP, parseRenovatePaste } from '../lib/renovate-paste.mjs';
import { knownProjects } from '../lib/jobs.mjs';

// The store is per project, so no project means no store. Refused before any path is built: the
// old null fallback aimed the write at reports/__unresolved__ and answered its ENOENT as a 500.
function requestProject(req) {
  const raw = new URLSearchParams((req.url.split('?')[1]) || '').get('project');
  if (!raw) return { error: 'no ?project= given — pasted Renovate data is stored per project' };
  const known = knownProjects();
  return known.has(raw) || known.has(projectSlug(raw)) ? { project: raw }
    : { error: 'unknown ?project= — it names no project or area in the registry' };
}

// A project the registry knows but no sweep has reached has no report directory yet.
function writeManual(target, text) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

// clear pasted entries: POST /api/renovate/paste/clear or DELETE /api/renovate/paste.
// NEVER unlinks — overwrites renovate-manual.json with an empty cleared stub (entries: []),
// which the panel treats as "no pasted data".
function clearPaste({ req, send }) {
  const p = requestProject(req);
  if (p.error) return send(400, { ok: false, error: p.error });
  const target = renovateManualFor(p.project);
  const existed = existsSync(target);
  try { writeManual(target, JSON.stringify({ pastedAt: null, clearedAt: new Date().toISOString(), source: 'paste', entries: [] }, null, 1) + '\n'); }
  catch (e) { return send(500, { ok: false, error: 'write failed: ' + e.message }); }
  return send(200, { ok: true, cleared: existed });
}

export const routes = [
  // renovate paste-ingest: POST raw Dependency-Dashboard markdown / renovate log / PR-title text.
  // Body capped at 256KB (oversize → 413), non-text garbage → 400. Parsed server-side by the
  // shared parseRenovatePaste(); result written to reports/…/renovate-manual.json (the panel
  // merges it with the live renovate.json snapshot — live wins on a normalized-title match).
  { method: 'POST', path: '/api/renovate/paste', handle: ({ req, send }) => {
    // the paste belongs to the project being viewed; validated like every other project input
    const p = requestProject(req);
    if (p.error) return send(400, { ok: false, error: p.error });
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= RENOVATE_PASTE_CAP) chunks.push(c); });
    req.on('end', () => {
      if (size > RENOVATE_PASTE_CAP) return send(413, { ok: false, error: `body too large (${size} bytes) — cap is 256KB` });
      const buf = Buffer.concat(chunks);
      if (!buf.length) return send(400, { ok: false, error: 'empty body — paste the Dependency Dashboard markdown, a renovate log excerpt, or PR titles' });
      let ctrl = 0;
      for (const b of buf) { if (b === 0) return send(400, { ok: false, error: 'body is not text (contains NUL bytes)' }); if (b < 9 || (b > 13 && b < 32)) ctrl++; }
      if (ctrl / buf.length > 0.05) return send(400, { ok: false, error: 'body does not look like text (too many control characters)' });
      let entries;
      try { entries = parseRenovatePaste(buf.toString('utf8')); }
      catch (e) { return send(400, { ok: false, error: 'parse failed: ' + e.message }); }
      if (!entries.length) return send(400, { ok: false, error: 'no Renovate update entries recognized — expected "- [ ] chore(deps): update …" dashboard checkboxes or conventional deps PR titles' });
      const out = { pastedAt: new Date().toISOString(), source: 'paste', entries };
      try { writeManual(renovateManualFor(p.project), JSON.stringify(out, null, 1) + '\n'); }
      catch (e) { return send(500, { ok: false, error: 'write failed: ' + e.message }); }
      return send(200, { ok: true, pastedAt: out.pastedAt, entries: entries.length,
        states: entries.reduce((a, e) => (a[e.state] = (a[e.state] || 0) + 1, a), {}) });
    });
    req.on('error', () => { /* client went away mid-body — nothing to answer */ });
    return;
  } },
  { method: 'POST', path: '/api/renovate/paste/clear', handle: clearPaste },
  { method: 'DELETE', path: '/api/renovate/paste', handle: clearPaste },
  { method: 'DELETE', path: '/api/renovate/paste/clear', handle: clearPaste },
];

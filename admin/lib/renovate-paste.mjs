// admin/lib/renovate-paste.mjs — parsing pasted Renovate content into update entries.
//
// The Renovate tab's live snapshot (renovate.json) stays empty until the app's Monday schedule.
// Users can PASTE Renovate content in advance — the GitHub Dependency Dashboard issue markdown
// (checkbox lists under Open / Rate-Limited / Awaiting Schedule / Pending …), a renovate log
// excerpt, or a plain list of conventional deps PR titles — and it is parsed SERVER-SIDE into
// reports/<area>/renovate-manual.json. The panel merges it with the live snapshot
// (normalized-title match; live wins). Clearing OVERWRITES the file with an empty stub — this
// codebase never unlinks a file.
//
// EXTRACTED FROM admin/serve.mjs 2026-09-04, unchanged. It sat inline in a 3,686-line server, so
// two pure text→data functions — the exact shape a unit test wants — could only be reached by
// booting an HTTP server and POSTing to it. Nothing about the parsing needed a socket; the file
// it lived in did. Behaviour is byte-for-byte the same, and admin/test/renovate-paste.test.mjs now
// covers it directly.

import { join } from 'node:path';
import { reportsFor, stripHtmlComments } from './core.mjs';

// Pasted-Renovate overlay, PER PROJECT: a single shared file meant a paste made while viewing
// project A rendered under project B, and clearing from B wiped A's. Resolved through the same
// area resolver as every other report artifact.
export const renovateManualFor = (project) => join(reportsFor(project), 'renovate-manual.json');
export const RENOVATE_PASTE_CAP = 256 * 1024; // bytes

// map a Dependency-Dashboard section heading to a compact state token
export function renovateState(section) {
  if (!section) return '';
  const s = section.toLowerCase();
  if (/rate.?limit/.test(s)) return 'rate-limited';
  if (/awaiting schedule/.test(s)) return 'awaiting-schedule';
  if (/pending approval/.test(s)) return 'pending-approval';
  if (/pending/.test(s)) return 'pending';
  if (/^open/.test(s)) return 'open';
  if (/edited|blocked/.test(s)) return 'edited-blocked';
  if (/ignored|closed/.test(s)) return 'ignored';
  if (/error/.test(s)) return 'errored';
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || '';
}

// shared parse: raw pasted text → update entries. Handles (a) dashboard markdown checkboxes
// ("- [ ] <!-- unlimit-branch=… -->chore(deps): update spring (major)", incl. the Open section's
// "[title](../pull/N)" link form), (b) bare conventional deps PR-title lines, and (c) renovate
// log excerpts where the PR title appears quoted ("prTitle": "chore(deps): …").
export function parseRenovatePaste(text) {
  const entries = []; const seen = new Set(); let section = '';
  const push = (rawTitle, state, rawLine) => {
    let title = stripHtmlComments(rawTitle).trim();
    const link = title.match(/^\[(.+?)\]\(([^)]*)\)$/); // Open section: [title](../pull/123)
    let prNumber = null;
    if (link) { title = link[1].trim(); const pm = link[2].match(/pull\/(\d+)|#(\d+)/); if (pm) prNumber = +(pm[1] || pm[2]); }
    title = title.replace(/`/g, '').replace(/\*\*/g, '').trim();
    if (!title) return;
    // dashboard control rows are not updates ("Create all rate-limited PRs at once", manual-run box, …)
    if (/create all .*prs|approve all|rebase all|check this box|request for renovate to run|open these|retry.rebase all/i.test(title)) return;
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return; seen.add(key);
    const e = { title, state: state || 'pending', raw: String(rawLine).trim().slice(0, 300) };
    if (prNumber != null) e.prNumber = prNumber;
    let m;
    if ((m = title.match(/update\s+(?:dependency\s+|module\s+|plugin\s+|docker\s+tag\s+|github\s+action\s+|gradle\s+plugin\s+|helm\s+release\s+)?(.+?)\s+to\s+(v?\d[\w.+-]*)/i))) {
      e.packages = m[1].split(/\s*,\s*|\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
      e.targetVersion = m[2];
    } else if ((m = title.match(/update\s+(?:dependency\s+|module\s+|plugin\s+)?(.+?)\s*\((non-major|major|minor|patch|digest|pin|lockfile|security)\)\s*$/i))) {
      e.packages = [m[1].trim()]; // grouped update, e.g. "spring (major)" — no single target version
    } else if ((m = title.match(/update\s+(\S+)/i))) {
      e.packages = [m[1].replace(/[.,;:]+$/, '')];
    }
    entries.push(e);
  };
  for (const line of String(text).split('\n')) {
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/); // markdown heading → section/state
    if (h) { section = h[1].trim(); continue; }
    const cb = line.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.+)/); // (a) dashboard checkbox
    if (cb) { push(cb[2], renovateState(section), line); continue; }
    const t = line.replace(/^[\s>*·|-]+/, '').trim(); // (b) bare conventional deps PR title
    if (/^(chore|fix|feat|build)\(deps[^)]*\)!?:\s*\S/i.test(t)) { push(t, renovateState(section), line); continue; }
    const lg = line.match(/["']((?:chore|fix|feat|build)\(deps[^)]*\)!?:\s*[^"']+)["']/i); // (c) log excerpt, quoted title
    if (lg) push(lg[1], renovateState(section), line);
  }
  return entries;
}

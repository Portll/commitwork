#!/usr/bin/env node
// parse-renovate.mjs — turn a Renovate local dry-run (debug) log into a compact updates summary.
// Each update object ends with a branchName; version/type are read from the preceding object body.
// Best-effort: the raw log stays the source of truth; a parse miss degrades to count 0, never throws.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
let log = '';
try { log = readFileSync(path, 'utf8'); } catch { process.stdout.write(JSON.stringify({ ran: false, reason: 'no log' })); process.exit(0); }

const ran = /Repository finished|packageFiles|Renovate is exiting/i.test(log);
const updates = [];
const seen = new Set();
const brRe = /"branchName":\s*"(renovate\/[^"]+)"/g;
let m;
while ((m = brRe.exec(log))) {
  const branch = m[1];
  if (/lockfile|lock-file-maintenance/i.test(branch)) continue; // artifact branch, not a distinct update
  if (seen.has(branch)) continue; seen.add(branch);
  const body = log.slice(Math.max(0, m.index - 800), m.index); // the update object preceding branchName
  const nv = [...body.matchAll(/"newVersion":\s*"([^"]+)"/g)].pop();
  const ut = [...body.matchAll(/"updateType":\s*"([^"]+)"/g)].pop();
  const dn = [...body.matchAll(/"depName":\s*"([^"]+)"/g)].pop();
  const slug = branch.replace(/^renovate\//, '');
  const dep = (dn && dn[1]) || slug.replace(/-(v?\d[\w.]*|\d+\.x)$/i, '') || slug;
  updates.push({ dep, branch, newVersion: nv ? nv[1] : null, updateType: ut ? ut[1] : 'unknown' });
}

const RANK = { major: 0, minor: 1, patch: 2, pin: 3, digest: 4 };
const byType = {};
for (const u of updates) byType[u.updateType] = (byType[u.updateType] || 0) + 1;
updates.sort((a, b) => (RANK[a.updateType] ?? 9) - (RANK[b.updateType] ?? 9) || a.dep.localeCompare(b.dep));

process.stdout.write(JSON.stringify({ ran, count: updates.length, byType, updates }, null, 2));

// monitor/daily-validate.mjs — checks a model's /daily suggestions against the digest they answer:
// every id exists and every listed item is accounted for exactly once, each `where` names a cited
// item's file and line, `verify` names a lane of the repo or one of its own test runners, and no
// text carries a URL or a fetch-and-run command copied from scanned content.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateAgainstSchema } from '../lib/json-schema.mjs';
import { digestIdOf } from './daily.mjs';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');
export const schemaPath = (name) => join(SCHEMA_DIR, `${name}.schema.json`);

const URL_RE = /\bhttps?:\/\/|\bftp:\/\//i;
// Shell execution only: naming curl or eval is how a fix to a curl grant or an eval() call is described, and URLs are refused on their own.
const FETCH_RUN_RE = /\|\s*(ba|z)?sh\b|\b(ba|z)?sh\s+-c\b|\beval\s+["'$`(]|\biex\s*\(/i;
const SHELL_META_RE = /[;&|`$<>\\\n]/;
const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };

export function validateDigest(digest) {
  const errors = validateAgainstSchema(digest, { path: schemaPath('daily-digest') }).errors;
  if (!errors.length && digestIdOf(digest) !== digest.digestId) errors.push('digest: digestId does not match its content');
  return errors;
}

/** Every reason `out` (commitwork.daily-suggestions/1) does not answer `digest`; empty when it does. */
export function validateSuggestions(digest, out, { testCommands = {} } = {}) {
  const errors = validateAgainstSchema(out, { path: schemaPath('daily-suggestions') }).errors;
  if (errors.length) return errors;

  const items = new Map();
  const repos = new Map(digest.repos.map((r) => [r.name, r]));
  for (const r of digest.repos) for (const i of r.items) items.set(i.id, { ...i, repo: r.name });
  const seen = new Map();
  const account = (id, where) => {
    if (!items.has(id)) errors.push(`${where}: ${id} is not an item in the digest`);
    else if (seen.has(id)) errors.push(`${where}: ${id} is already accounted for in ${seen.get(id)}`);
    else seen.set(id, where);
  };

  let lastRank = -1;
  out.suggestions.forEach((s, n) => {
    const at = `suggestions[${n}] ${s.id}`;
    if (s.id !== `S${n + 1}`) errors.push(`${at}: ids run S1, S2, ... in order; expected S${n + 1}`);
    if (PRIORITY_RANK[s.priority] < lastRank) errors.push(`${at}: ${s.priority} after a lower priority; suggestions are in priority order`);
    lastRank = Math.max(lastRank, PRIORITY_RANK[s.priority]);
    const repo = repos.get(s.repo);
    if (!repo) { errors.push(`${at}: repo ${s.repo} is not in the digest`); return; }
    const cited = [];
    for (const id of s.findingIds) {
      account(id, at);
      const item = items.get(id);
      if (item && item.repo !== s.repo) errors.push(`${at}: ${id} belongs to ${item.repo}, not ${s.repo}`);
      if (item) cited.push(item);
    }
    for (const w of s.where) {
      const ok = cited.some((i) => i.file === w.file && (w.line === undefined ? !i.lines.length : i.lines.includes(w.line)));
      if (!ok) errors.push(`${at}: where ${w.file}${w.line === undefined ? ' (no line)' : `:${w.line}`} is not a line of a cited item`);
    }
    if (s.verify.lane !== undefined && !repo.lanes.some((l) => l.lane === s.verify.lane)) errors.push(`${at}: verify.lane ${s.verify.lane} is not a lane of ${s.repo}`);
    if (s.verify.command !== undefined) {
      const allowed = testCommands[s.repo] ?? [];
      if (SHELL_META_RE.test(s.verify.command)) errors.push(`${at}: verify.command carries shell metacharacters`);
      else if (!allowed.some((p) => s.verify.command === p || s.verify.command.startsWith(`${p} `))) errors.push(`${at}: verify.command must start with one of ${s.repo}'s test runners (${allowed.join(', ') || 'none declared'})`);
    }
    if (s.verify.lane === undefined && s.verify.command === undefined) errors.push(`${at}: verify needs a lane or a command`);
    if (s.introducedBy !== undefined && !repo.commitsSince.some((c) => c.sha === s.introducedBy)) errors.push(`${at}: introducedBy ${s.introducedBy} is not in ${s.repo}'s commitsSince`);
    for (const field of ['title', 'why', 'change']) {
      if (URL_RE.test(s[field])) errors.push(`${at}: ${field} carries a URL`);
      if (FETCH_RUN_RE.test(s[field])) errors.push(`${at}: ${field} carries a fetch or shell-run command`);
    }
    if (URL_RE.test(s.verify.expect) || FETCH_RUN_RE.test(s.verify.expect)) errors.push(`${at}: verify.expect carries a URL or a shell-run command`);
  });
  out.notActioned.forEach((x, n) => account(x.findingId, `notActioned[${n}]`));
  for (const id of items.keys()) if (!seen.has(id)) errors.push(`item ${id} (${items.get(id).repo} ${items.get(id).file}) is neither in a suggestion nor in notActioned`);
  if (URL_RE.test(out.headline) || FETCH_RUN_RE.test(out.headline)) errors.push('headline carries a URL or a shell-run command');
  return errors;
}

export function validateReport(report) {
  return validateAgainstSchema(report, { path: schemaPath('daily-report') }).errors;
}

// admin/routes/comments.mjs — the Slop Bucket: comment blocks over the schema's limit, each with a
// drafted replacement, a diff, and a tick box.
//
// fact: a suggestion is a DRAFT and the operator edits it before accepting / the counterfactual test is a judgement no heuristic makes, and a wrong deletion loses knowledge with no test to catch it (expiry: on a suggester that can be trusted unattended, prev: not built)
// fact: accept refuses a block whose `before` no longer sits where it claimed / applying by position after a co-session edit overwrites something else (expiry: never, prev: not built)
// fact: every accepted write is re-parsed and the file is restored if it stops parsing / a comment edit that breaks a module is worse than the verbosity it removed (expiry: never, prev: not built)
import { readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { withinRoot } from '../../lib/path-contain.mjs'; // `startsWith(root + '/')` is false on Windows
import { fileURLToPath } from 'node:url';

import { suggestFile } from '../../bin/comment-suggest.mjs';
import { applyTo } from '../../bin/comment-suggest.mjs';
import { scanFile } from '../../bin/comment-schema.mjs';
import { writeAtomic } from '../../monitor/lockfile.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = () => process.env.CW_COMMENT_ROOT || CW;

// fact: a project names a root and the map is the allowlist / a root read from the query is an arbitrary-directory read primitive (expiry: never, prev: not built)
const PROJECTS = {
  commitwork: () => root(),
  spine: () => process.env.CW_SLOP_SPINE_ROOT || resolve(CW, '..', 'spine'),
};
export const DEFAULT_PROJECT = 'commitwork';

/** The repository a request scans. An unknown name falls back to the default rather than erroring. */
export function projectOf(name) {
  const p = String(name || '').trim();
  return Object.hasOwn(PROJECTS, p) ? p : DEFAULT_PROJECT;
}
const projectRoot = (project) => resolve(PROJECTS[projectOf(project)]());

// fact: the scanned set comes from git ls-files, never a walk / a walk reaches node_modules and worktrees, and an editor pointed at those is a write primitive (expiry: never, prev: unknown)
function tracked(project) {
  const out = execFileSync('git', ['-C', projectRoot(project), 'ls-files', '*.mjs', '*.js', '*.cjs'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.split('\n').filter(Boolean)
    .filter((f) => !f.includes('pre-lifecycle') && !f.startsWith('reports/'));
}

// fact: a path is resolved and confined under the repo root / `..` in an id is otherwise an arbitrary-file write (expiry: never, prev: unknown)
function safePath(rel, project) {
  const r = projectRoot(project);
  const p = resolve(r, rel);
  // withinRoot(), not `startsWith(root + '/')`: root comes from resolve() and is BACKSLASHED on
  // Windows, so the old test was false for every path and this route refused every file as
  // "escapes the repository". See lib/path-contain.mjs — and note it keeps the sibling-prefix
  // guard the `+ '/'` was there for (`/repo-evil` must not pass for root `/repo`).
  if (!withinRoot(r, p)) return null;
  return p;
}

export function collect(project = DEFAULT_PROJECT) {
  const files = tracked(project);
  const items = [];
  for (const f of files) {
    const p = safePath(f, project);
    if (!p) continue;
    let src;
    try { src = readFileSync(p, 'utf8'); } catch { continue; }
    for (const s of suggestFile(f, src)) {
      items.push({
        id: s.id, key: s.key, file: s.file, ordinal: s.ordinal, kind: s.kind, confidence: s.confidence,
        startLine: s.startLine, lines: s.lines, saved: s.saved,
        keptCount: s.keptCount, droppedCount: s.droppedCount, dropped: s.dropped,
        void: s.void, reason: s.reason,
        before: s.before, after: s.after, diff: s.diff, second: s.second, original: s.original, tally: s.tally,
      });
    }
  }
  // fact: ranked by block SIZE, never by lines the draft would delete / sorting by `saved` floated the most lossy collapse to the top and called it the biggest win (expiry: never, prev: broken)
  items.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file) || a.ordinal - b.ordinal);
  const byFile = {};
  for (const i of items) byFile[i.file] = (byFile[i.file] || 0) + 1;
  return {
    ok: true,
    project: projectOf(project),
    total: items.length,
    files: Object.keys(byFile).length,
    saveable: items.reduce((a, i) => a + i.saved, 0),
    scanned: files.length,
    items,
  };
}

// fact: the gate reads the session or the operator port, as learning.mjs does / it read `ctx.authed`, which the dispatcher never passes, so it allowed everyone (expiry: never, prev: broken)
function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  return s && s.user ? { ok: true } : { ok: false };
}

// fact: a body arrives only through ctx.readJsonBody / the dispatcher passes no `ctx.body`, so reading it made every accept a 400 (expiry: never, prev: broken)
const readBody = (ctx) => new Promise((done) => ctx.readJsonBody(ctx.req, (body, err) => done({ body, err })));

/** Apply one edited suggestion. Returns {ok} or {ok:false, error} — never throws to the caller. */
export function acceptOne(id, replacement, project = DEFAULT_PROJECT) {
  const [file, ord] = String(id).split('#');
  const p = safePath(file, project);
  if (!p) return { ok: false, id, error: 'path escapes the repository' };
  let src;
  try { src = readFileSync(p, 'utf8'); } catch (e) { return { ok: false, id, error: `unreadable: ${e.code}` }; }

  const sug = suggestFile(file, src).find((s) => String(s.ordinal) === String(ord));
  if (!sug) return { ok: false, id, error: 'no such block — it may already have been accepted' };

  // fact: a VOID block has no machine draft, so accepting one with no human text applies after:[] and blanks it / the empty draft would delete the block and report the lines "saved" (expiry: never, prev: not built)
  if (sug.void && !(typeof replacement === 'string' && replacement.trim())) {
    return { ok: false, id, error: 'no machine draft for this block — write the replacement by hand; it is not auto-collapsed' };
  }

  const applied = applyTo(src, sug, replacement);
  if (!applied.ok) return { ok: false, id, error: applied.error };

  // fact: the replacement must pass the schema it was drafted to satisfy, BEFORE it reaches disk / accepting a draft that still says expiry: TODO writes the exact slop the bucket exists to catch (expiry: never, prev: not built)
  const finalAfter = (replacement ?? sug.after.join('\n')).split('\n');
  const schemaBad = scanFile(file, `${finalAfter.join('\n')}\n`).violations;
  if (schemaBad.length) {
    return { ok: false, id, error: `refused: the replacement is not schema-clean — ${schemaBad[0].why} ("${schemaBad[0].text}")` };
  }

  writeAtomic(p, applied.text);

  // fact: a comment-only edit is verified by re-parsing and rolled back on failure / an unbalanced block comment swallows the code beneath it and the panel would report success (expiry: never, prev: not built)
  if (/\.(mjs|js|cjs)$/.test(file)) {
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    } catch (e) {
      writeFileSync(p, src);
      return { ok: false, id, error: `refused: the edit stopped the file parsing (${String(e.stderr || '').split('\n')[0] || 'syntax error'}) — restored` };
    }
  }
  return { ok: true, id, saved: Math.max(0, sug.before.length - finalAfter.length) };
}

// fact: the sweep record is an append-only ledger in the sidecar store, one line per run / a count that lives only in the panel's memory cannot show slop falling over time, and reports/ is gitignored (expiry: never, prev: not built)
// fact: one ledger per project / a shared file would read as one trend line over two repositories (expiry: never, prev: not built)
const sweepLog = (project = DEFAULT_PROJECT) => (projectOf(project) === DEFAULT_PROJECT
  ? process.env.CW_SLOP_SWEEP_LOG || join(CW, '.claude', 'store', 'slop-sweeps.jsonl')
  : process.env[`CW_SLOP_${projectOf(project).toUpperCase()}_SWEEP_LOG`]
    || join(CW, '.claude', 'store', `slop-sweeps-${projectOf(project)}.jsonl`));
const now = () => process.env.CW_NOW || new Date().toISOString();

/** Aggregate one collect() result into the summary the panel renders and the ledger stores. */
export function summarize(c, at) {
  const voids = c.items.filter((i) => i.void);
  const byReason = {};
  for (const v of voids) byReason[v.reason] = (byReason[v.reason] || 0) + 1;
  const byFile = {};
  for (const i of c.items) byFile[i.file] = (byFile[i.file] || 0) + 1;
  const topFiles = Object.entries(byFile)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10).map(([file, blocks]) => ({ file, blocks }));
  return { at, scanned: c.scanned, files: c.files, blocks: c.total,
    voids: voids.length, byReason, candidates: c.total - voids.length,
    couldRemove: c.saveable, topFiles };
}

/** Recorded sweeps, oldest→newest, capped. ENOENT is "no sweep yet"; any other read error fails closed. */
export function readHistory(limit = 30, project = DEFAULT_PROJECT) {
  let raw;
  try { raw = readFileSync(sweepLog(project), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`sweep history unreadable (${e.code}) — refusing to treat that as no history`);
  }
  return raw.split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .slice(-limit);
}

/** Re-run the whole tree, append a durable dated record, and return the list + summary + trend. */
export function sweep(project = DEFAULT_PROJECT) {
  const c = collect(project);
  const summary = summarize(c, now());
  const p = sweepLog(project);
  // fact: append, never tmp+rename / a whole-file atomic write keeps only the latest and the trend this exists for would never accrue — a sweep is an event, not a rebuild (expiry: never, prev: not built)
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(summary)}\n`);
  return { ...c, summary, history: readHistory(30, project) };
}

export const routes = [
  { method: 'GET', path: '/api/comments', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, collect(ctx.query?.get('project'))); }
    catch (e) { return ctx.send(500, { ok: false, error: `suggestions could not be read: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/comments/accept', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    const { body: parsed, err } = await readBody(ctx);
    if (err) return ctx.send(400, { ok: false, error: err });
    const body = parsed || {};
    const picks = Array.isArray(body.accept) ? body.accept : null;
    if (!picks || !picks.length) {
      return ctx.send(400, { ok: false, error: 'accept[] is required and must name at least one suggestion' });
    }
    if (picks.length > 200) return ctx.send(400, { ok: false, error: 'refusing more than 200 in one request' });

    // fact: applied newest-first within a file / accepting an earlier block first shifts every later one and the next apply lands on the wrong lines (expiry: never, prev: broken)
    const ordered = [...picks].sort((a, b) => {
      const [fa, oa] = String(a.id ?? a).split('#');
      const [fb, ob] = String(b.id ?? b).split('#');
      return fa === fb ? Number(ob) - Number(oa) : fa.localeCompare(fb);
    });

    const results = [];
    for (const pick of ordered) {
      const id = pick.id ?? pick;
      const replacement = typeof pick.text === 'string' ? pick.text : undefined;
      results.push(acceptOne(id, replacement, body.project));
    }
    const applied = results.filter((r) => r.ok);
    return ctx.send(applied.length ? 200 : 409, {
      ok: applied.length > 0,
      project: projectOf(body.project),
      applied: applied.length,
      refused: results.length - applied.length,
      linesSaved: applied.reduce((a, r) => a + (r.saved || 0), 0),
      results,
    });
  } },

  { method: 'POST', path: '/api/comments/sweep', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, sweep(ctx.query?.get('project'))); }
    catch (e) { return ctx.send(500, { ok: false, error: `sweep failed: ${e.message}` }); }
  } },
];

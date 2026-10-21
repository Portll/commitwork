// monitor/daily-todos.mjs — files a /daily report's suggestions on the veld todo list and keeps the
// list in step with the findings. planTodos() decides from the report, the digest, the area's ledger
// (reports/<out>/daily/ledger.json) and veld's current daily todos; applyTodos() carries the plan out.
// The ledger, not veld, is the record of what was filed: a todo the operator closed or deleted is not
// filed again while its finding persists, and is filed again only after the finding was fixed and came back.
import { createHash } from 'node:crypto';
import { itemId } from './daily.mjs';

export const LEDGER_SCHEMA = 'commitwork.daily-ledger/1';
export const TAG = 'commitwork-daily';
const PRIORITY = { p0: 'urgent', p1: 'high', p2: 'medium', p3: 'low' };
const OPEN = new Set(['backlog', 'todo', 'in_progress', 'blocked']);
const PROVENANCE = 'Machine-written by commitwork /daily from scan data: verify before acting.';

export const emptyLedger = () => ({ schema: LEDGER_SCHEMA, configSha256: null, findings: {} });
const findingTags = (todo) => (todo.tags ?? []).filter((t) => t.startsWith('finding:')).map((t) => t.slice(8));
export const externalIdFor = (area, ids) => `${TAG}:${area}:${createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16)}`;

function notesFor(s, { area, batch, reportPath }) {
  const where = s.where.map((w) => `${w.file}:${w.line}`).join(', ');
  const verify = [s.verify.lane && `re-run lane ${s.verify.lane}`, s.verify.command].filter(Boolean).join('; ');
  return [
    s.why, '', `Change: ${s.change}`, `Where: ${where}`, `Verify: ${verify}. Expect: ${s.verify.expect}`,
    `Effort ${s.effort}, confidence ${s.confidence}.`, '',
    PROVENANCE, `Report ${reportPath}, ${s.id} of ${batch} (area ${area}).`,
  ].join('\n');
}

/**
 * The actions that bring veld and the ledger in step with one report:
 * { create: [{ externalId, findingIds, body }], complete: [{ todoId, comment }], comment: [{ todoId, text }], ledger }.
 * `todos` is every daily todo veld holds for the user, completed ones included. `today` is YYYY-MM-DD.
 */
export function planTodos({ report, digest, ledger, todos, fileTodos = {}, reportPath, today, forgetFixedBefore = null }) {
  const next = structuredClone(ledger ?? emptyLedger());
  next.schema = LEDGER_SCHEMA;
  const byId = new Map(todos.map((t) => [t.id, t]));
  const batch = report.batch;
  const plan = { create: [], complete: [], comment: [], ledger: next };
  // A rename gives a finding a new identity; the old one becomes an alias, so its todo stays its todo.
  for (const r of digest.repos) {
    for (const i of r.items) {
      if (!i.renamedFrom || next.findings[i.id]) continue;
      const oldId = itemId(r.name, i.category, i.rule, i.renamedFrom);
      const old = next.findings[oldId];
      if (!old || old.state === 'renamed') continue;
      next.findings[i.id] = { ...old, lastSeenBatch: batch };
      next.findings[oldId] = { repo: r.name, state: 'renamed', renamedTo: i.id };
    }
  }
  const resolve = (id) => { let x = id; for (let n = 0; n < 20 && next.findings[x]?.state === 'renamed'; n++) x = next.findings[x].renamedTo; return x; };

  for (const entry of Object.values(next.findings)) {
    if (!entry.todoId || entry.state !== 'open' || entry.closedByUser) continue;
    const t = byId.get(entry.todoId);
    if (!t || !OPEN.has(t.status)) entry.closedByUser = true;
  }

  const fixedNow = new Set(digest.repos.flatMap((r) => r.fixed.map((f) => f.id)));
  for (const id of fixedNow) {
    const entry = next.findings[id];
    if (!entry) continue;
    entry.state = 'fixed';
    entry.closedByUser = false;
    entry.fixedBatch = batch;
  }
  for (const t of todos) {
    if (!OPEN.has(t.status)) continue;
    const ids = findingTags(t).map(resolve);
    if (ids.length && ids.every((id) => next.findings[id]?.state === 'fixed')) {
      plan.complete.push({ todoId: t.id, comment: `Fixed: every finding of this todo is gone in ${batch}, and its lane ran in both sweeps.` });
    }
  }

  const carriedNow = new Set(digest.repos.flatMap((r) => r.carried));
  for (const t of todos) {
    if (!OPEN.has(t.status)) continue;
    const unmeasured = findingTags(t).map(resolve).filter((id) => carriedNow.has(id));
    if (unmeasured.length) plan.comment.push({ todoId: t.id, text: `Not measured in ${batch}: the lane did not run or its tool changed, so ${unmeasured.length} finding(s) here are neither fixed nor confirmed.` });
  }

  for (const r of digest.repos) {
    for (const i of r.items) {
      const e = next.findings[i.id];
      if (!e || e.state === 'fixed') next.findings[i.id] = { repo: r.name, state: 'open', todoId: null, closedByUser: false, firstSeenBatch: e?.state === 'fixed' ? batch : (e?.firstSeenBatch ?? batch), lastSeenBatch: batch };
      else e.lastSeenBatch = batch;
    }
    for (const id of r.omittedIds) if (next.findings[id]) next.findings[id].lastSeenBatch = batch;
  }

  let p2 = 0;
  for (const s of report.suggestions) {
    if (s.priority === 'p3' && !fileTodos.p3) continue;
    if (s.priority === 'p2' && p2 >= (fileTodos.p2PerDay ?? 5)) continue;
    const uncovered = s.findingIds.filter((id) => {
      const e = next.findings[id];
      if (!e || e.state !== 'open' || e.closedByUser) return false;
      const t = e.todoId && byId.get(e.todoId);
      return !(t && OPEN.has(t.status));
    });
    if (!uncovered.length) continue;
    if (s.priority === 'p2') p2 += 1;
    plan.create.push({
      externalId: externalIdFor(report.area, uncovered),
      findingIds: uncovered,
      body: {
        content: `[${s.repo}] ${s.title}`,
        priority: PRIORITY[s.priority],
        project: s.repo,
        tags: [TAG, `area:${report.area}`, `priority:${s.priority}`, ...uncovered.map((id) => `finding:${id}`)],
        notes: notesFor(s, { area: report.area, batch, reportPath }),
        ...(s.priority === 'p0' ? { due_date: today } : {}),
      },
    });
  }
  if (forgetFixedBefore) {
    for (const [id, e] of Object.entries(next.findings)) if (e.state === 'fixed' && e.fixedBatch && e.fixedBatch < forgetFixedBefore) delete next.findings[id];
    for (const [id, e] of Object.entries(next.findings)) if (e.state === 'renamed' && !next.findings[resolve(id)]) delete next.findings[id];
  }
  next.configSha256 = digest.config.sha256;
  return plan;
}

/** A veld client over fetch: user, url and key are passed in, never read here. */
export function veldClient({ url, key, user, fetchImpl = globalThis.fetch, timeoutMs = 30_000 }) {
  const call = async (path, body) => {
    const res = await fetchImpl(`${url}${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: user, ...body }), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`veld ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    if (json.success === false) throw new Error(`veld ${path} refused: ${String(json.formatted ?? '').slice(0, 200)}`);
    return json;
  };
  return {
    async dailyTodos() {
      const { todos } = await call('/api/todos/list', { include_completed: true, limit: 1000 });
      return (todos ?? []).filter((t) => (t.tags ?? []).includes(TAG));
    },
    add: (body) => call('/api/todos/add', body),
    complete: (id) => call(`/api/todos/${encodeURIComponent(id)}/complete`, {}),
    comment: (id, content) => call(`/api/todos/${encodeURIComponent(id)}/comments`, { content, author: 'commitwork-daily' }),
  };
}

/** Carries out a plan. A todo already holding the plan's external id is reused, so a re-run after a crash files nothing twice. */
export async function applyTodos(plan, client, todos) {
  const result = { created: [], reused: [], completed: [], commented: [], errors: [] };
  const byExternal = new Map(todos.filter((t) => t.external_id).map((t) => [t.external_id, t]));
  for (const c of plan.create) {
    try {
      let todo = byExternal.get(c.externalId);
      if (todo) result.reused.push(todo.id);
      else {
        todo = (await client.add({ ...c.body, external_id: c.externalId })).todo;
        result.created.push(todo.id);
      }
      for (const id of c.findingIds) plan.ledger.findings[id].todoId = todo.id;
    } catch (e) { result.errors.push(`create ${c.externalId}: ${e.message}`); }
  }
  for (const c of plan.complete) {
    try { await client.comment(c.todoId, c.comment); await client.complete(c.todoId); result.completed.push(c.todoId); } catch (e) { result.errors.push(`complete ${c.todoId}: ${e.message}`); }
  }
  for (const c of plan.comment) {
    try { await client.comment(c.todoId, c.text); result.commented.push(c.todoId); } catch (e) { result.errors.push(`comment ${c.todoId}: ${e.message}`); }
  }
  return result;
}

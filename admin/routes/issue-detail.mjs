// admin/routes/issue-detail.mjs — one issue, in depth: lodge a fix, read the prompt, run a model.
//
//   GET  /api/issue              session            — the lodging surface. Whitelisted, tunnel-safe.
//   POST /api/issue/fix          session            — lodge fixType + notes. A CLAIM, never a close.
//   GET  /api/issue/prompt       session + loopback — the composed prompt. Source-bearing.
//   POST /api/issue/llm          session + loopback — run it locally, record the reply as evidence.
//   POST /api/issue/claude       session + loopback — hand it to a Claude Code session.
//
// Source-bearing halves are loopback-only (source does not cross the tunnel); each route gates
// itself (the dispatcher sits above the login gate); the panel can never close an issue.

import { requireSession } from '../lib/route-auth.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadIssues, saveIssues, withIssuesLock, nowISO, mutateIssue, lodgeFix, FIX_TYPES,
  FIX_NOTES_MIN, FIX_NOTES_MAX, identityProblems,
} from '../../monitor/issue-store.mjs';
import { ingestArea } from '../../monitor/issue-ingest.mjs';
import { resolveRepos } from '../../monitor/discover.mjs';
import { projectSlug } from '../../monitor/project-scope.mjs';
import { composeIssuePrompt } from '../../monitor/issue-prompt.mjs';
import { judgementView, DISPOSITIONS, rescanLevels } from '../../monitor/ingest-external.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';
import { parseVerdict, splitThinking } from '../../lib/llm-reply.mjs';
import { CW, readJSON, registry, reportsFor, resolvedRepos } from '../lib/core.mjs';
// Dispatch ladder and engine endpoints OWNED by routes/remediation.mjs — imported, never re-implemented.
import { launchClaudeSession, llmTargets } from './remediation.mjs';
import { baseUrlFor, hostsInProbeOrder } from '../../monitor/llm-hosts.mjs';
import { annotationsPathFor } from '../../monitor/store-paths.mjs';
import { refreshLearningView } from '../../monitor/learning-refresh.mjs';

const LOCAL_TIMEOUT_MS = 600_000; // matches bin/issue-llm.mjs: a 27B on a laptop is not fast

// The operator-port refusal, spelled the same way everywhere; it names the port so the 403 is actionable.
const LOCAL_ONLY = {
  ok: false,
  error: 'this action is available only on the operator port (http://127.0.0.1:7879 by default, or http://commitwork.local). It composes a '
    + 'prompt containing the anchored source of the finding, and source does not leave the box over '
    + 'the published tunnel.',
  localOnly: true,
};

// A corrupt/unreadable store is a 503 describing the real state, never an empty answer.
function withStore(send, fn) {
  try { return fn(); }
  catch (e) { return send(503, { ok: false, error: `issue store unavailable: ${e.message}` }); }
}

// The id is only an object-key lookup — a caller's bytes never become a path, argv or RegExp.
function lookup(doc, rawId) {
  return doc.issues[String(rawId || '')] || null;
}

// Rows per bulk call. 200 ids with notes sit well inside the 64 KiB body cap in admin/serve.mjs.
export const FIX_BULK_MAX = 200;

// Repo root for the source window; falls back to the commitwork tree — a wrong root yields
// "(source unavailable)", stated in the prompt.
function repoRoot(iss) {
  if (!iss.repo) return CW;
  const r = resolvedRepos().find((x) => x.name === iss.repo);
  return (r && r.path) || CW;
}

// ── the lodging surface (tunnel-safe) ────────────────────────────────────────────────────────────
// Field-whitelisted at the producer — no `body`, `anchor` or `source.key`; `title` recomposed,
// never passed through.
function detailView(iss, { now, promptAvailable }) {
  const src = iss.source || {};
  const j = judgementView(iss, { now });
  return {
    ok: true,
    generated: now,
    id: iss.id,
    area: iss.area,
    repo: iss.repo,
    kind: iss.kind,
    severity: iss.severity,
    state: iss.state,
    closedAs: iss.closedAs,
    suspect: iss.suspect,
    rule: src.rule || null,
    tool: src.tool || null,
    // scanner-authored guidance at mint — distinct from the human's `fix`
    remediation: iss.remediation,
    fix: iss.fix || null,
    llm: iss.llm ? { at: iss.llm.at, engine: iss.llm.engine, model: iss.llm.model,
      verdict: iss.llm.verdict ?? null, confidence: iss.llm.confidence ?? null,
      truncated: !!iss.llm.truncated } : null,
    greenKind: j.greenKind,
    subjectDigest: j.subjectDigest,
    dispositions: j.dispositions,
    slaDueAt: iss.slaDueAt,
    createdAt: iss.createdAt,
    updatedAt: iss.updatedAt,
    // vocabularies travel WITH the data so the client cannot invent its own copy
    vocab: {
      fixTypes: [...FIX_TYPES],
      dispositions: [...DISPOSITIONS],
      rescanLevels: [...rescanLevels()].sort(),
      notes: { min: FIX_NOTES_MIN, max: FIX_NOTES_MAX },
    },
    // whether THIS request may see the source-bearing half — stated, so the client renders "local-only"
    promptAvailable,
  };
}

// ── the local run ────────────────────────────────────────────────────────────────────────────────
// The CLI's contract reused whole — a verdict is evidence of a claim, never a close. Deliberately
// NOT the triage-verdict schema: that shape describes a whole artifact, not one finding.
async function runLocalOnIssue({ engine, model, prompt }) {
  const base = baseUrlFor(engine);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), LOCAL_TIMEOUT_MS);
  let content = '', explicit = null, finish = null;
  try {
    // One request shape. The ollama branch that used to be here is gone with the host.
    const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) return { ok: false, error: `${engine} answered HTTP ${r.status}` };
    const j = await r.json();
    const choice = (j.choices && j.choices[0]) || {};
    const msg = choice.message || {};
    content = msg.content || '';
    explicit = msg.reasoning_content || msg.reasoning || null;
    finish = choice.finish_reason || null;
  } catch (e) {
    return { ok: false, error: ac.signal.aborted
      ? `the local model did not answer within ${LOCAL_TIMEOUT_MS / 1000}s — if this is a cold load of a big model the machine is likely paging`
      : `local model unreachable: ${e.message}` };
  } finally { clearTimeout(t); }

  const split = splitThinking(content, explicit);
  const parsed = parseVerdict(split.answer);
  // reasoning can hide in an explicit field, a <think> fence, or an unfenced preamble
  const thinking = [explicit && String(explicit).trim(), split.thinking, parsed.preamble]
    .filter(Boolean).join('\n\n---\n\n') || null;
  return {
    ok: true,
    answer: parsed.answer,
    thinking,
    verdict: parsed.verdict ?? null,
    confidence: parsed.confidence ?? null,
    // finish 'length' = cut off mid-reply — recorded, never inferred away
    truncated: finish === 'length',
  };
}

export const routes = [
  // GET /api/issue?id=ISS-… — the lodging surface. Tunnel-safe by construction.
  { method: 'GET', path: '/api/issue', handle: (ctx) => {
    const { send, query, isLoopbackReq } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    return withStore(send, () => {
      const iss = lookup(loadIssues(), query.get('id'));
      if (!iss) return send(404, { ok: false, error: 'no such issue' });
      return send(200, detailView(iss, { now: nowISO(), promptAvailable: !!isLoopbackReq }));
    });
  } },

  // POST /api/issue/fix {id, fixType, notes, dispositionId?} — the human's account of the fix.
  // Never touches state/closedAs; lodgeFix enforces that.
  { method: 'POST', path: '/api/issue/fix', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const at = nowISO();
      // sessionWho is the ONE resolver for "who acted"; '' is a refusal, not a default
      const who = sessionWho(s);
      if (!who) {
        return send(401, { ok: false, error: 'no resolvable identity — an unattributed lodging is worth exactly the identity behind it' });
      }
      let out, learningSource;
      try {
        out = withIssuesLock(() => {
          const doc = loadIssues();
          const iss = lookup(doc, body && body.id);
          if (!iss) return { status: 404, payload: { ok: false, error: 'no such issue' } };
          lodgeFix(doc, iss.id, {
            fixType: body.fixType, notes: body.notes, who, at,
            dispositionId: body.dispositionId ?? null,
          });
          saveIssues(doc);
          learningSource = doc;
          return { status: 200, payload: {
            ok: true, id: iss.id, fix: doc.issues[iss.id].fix,
            state: doc.issues[iss.id].state,
            // stated on EVERY success — ok:true must not read as a fix
            stillOpen: doc.issues[iss.id].state !== 'closed',
            note: 'recorded as a claim. This issue leaves the queue on scan evidence at the next ingest, or on an explicit evidence-carrying close — not on this.',
          } };
        });
      } catch (e) {
        // lodgeFix refusals are caller-fixable (400); an unloadable store reads as 503 via withStore
        return send(400, { ok: false, error: e.message });
      }
      if (out.status === 200) {
        out.payload.learning = refreshLearningView(learningSource, { now: at });
        if (!out.payload.learning.ok) console.error(`[learning] ${out.payload.learning.error}`);
      }
      return send(out.status, out.payload);
    });
  } },

  // POST /api/issues/fix-bulk — lodge the same kind of fix on several issues, one lock, one write,
  // one result PER ROW. Body: { items: [{ id, fixType, notes, dispositionId?, expectUpdatedAt? }] }.
  // A row whose updatedAt no longer matches expectUpdatedAt is refused (409) rather than overwritten,
  // the same precondition the judgement route pins; a row already carrying this exact fix is
  // reported unchanged and writes no event; a refused row never stops the others. Bounded to
  // FIX_BULK_MAX rows so a selection the body cap would truncate is paged, not half-applied.
  { method: 'POST', path: '/api/issues/fix-bulk', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const items = body && Array.isArray(body.items) ? body.items : null;
      if (!items || !items.length) return send(400, { ok: false, error: 'items must be a non-empty array' });
      if (items.length > FIX_BULK_MAX) return send(400, { ok: false, error: `at most ${FIX_BULK_MAX} items per call — page the selection`, max: FIX_BULK_MAX });
      const at = nowISO();
      const who = sessionWho(s);
      if (!who) return send(401, { ok: false, error: 'no resolvable identity — an unattributed lodging is worth exactly the identity behind it' });
      let out, learningSource = null;
      try {
        out = withIssuesLock(() => {
          const doc = loadIssues();
          const results = [];
          let applied = 0, unchanged = 0, refused = 0;
          for (const item of items) {
            const id = String((item && item.id) || '');
            const iss = lookup(doc, id);
            if (!iss) { refused++; results.push({ id, ok: false, status: 404, error: 'no such issue' }); continue; }
            if (item.expectUpdatedAt !== undefined && item.expectUpdatedAt !== null && iss.updatedAt !== item.expectUpdatedAt) {
              refused++;
              results.push({ id, ok: false, status: 409, error: 'the issue changed since this selection was read — re-read before lodging', updatedAt: iss.updatedAt });
              continue;
            }
            const notes = String(item.notes ?? '');
            if (iss.fix && iss.fix.fixType === item.fixType && iss.fix.notes === notes) {
              unchanged++;
              results.push({ id, ok: true, status: 200, unchanged: true, updatedAt: iss.updatedAt });
              continue;
            }
            try {
              lodgeFix(doc, id, { fixType: item.fixType, notes, who, at, dispositionId: item.dispositionId ?? null });
              applied++;
              results.push({ id, ok: true, status: 200, updatedAt: doc.issues[id].updatedAt, state: doc.issues[id].state });
            } catch (e) {
              refused++;
              results.push({ id, ok: false, status: 400, error: e.message });
            }
          }
          if (applied) { saveIssues(doc); learningSource = doc; }
          return { results, applied, unchanged, refused };
        });
      } catch (e) {
        return send(503, { ok: false, error: e.message });
      }
      const payload = {
        ok: true, at, ...out,
        // stated on EVERY success — ok:true must not read as a fix
        stillOpen: true,
        note: 'recorded as claims. Each issue leaves the queue on scan evidence at the next ingest, or on an explicit evidence-carrying close — not on this.',
      };
      if (learningSource) {
        payload.learning = refreshLearningView(learningSource, { now: at });
        if (!payload.learning.ok) console.error(`[learning] ${payload.learning.error}`);
      }
      return send(200, payload);
    });
  } },

  // GET /api/issue/prompt?id=ISS-… — SOURCE-BEARING. Operator port only.
  { method: 'GET', path: '/api/issue/prompt', handle: (ctx) => {
    const { send, query, isLoopbackReq } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    if (!isLoopbackReq) return send(403, LOCAL_ONLY);
    return withStore(send, () => {
      const iss = lookup(loadIssues(), query.get('id'));
      if (!iss) return send(404, { ok: false, error: 'no such issue' });
      return send(200, { ok: true, id: iss.id, prompt: composeIssuePrompt(iss, { root: repoRoot(iss) }) });
    });
  } },

  // GET /api/issue/llm/targets — which local engines exist right now. Probed per request;
  // loopback-gated, only useful next to the source-bearing run.
  { method: 'GET', path: '/api/issue/llm/targets', handle: (ctx) => {
    const { send, isLoopbackReq } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    if (!isLoopbackReq) return send(403, LOCAL_ONLY);
    return llmTargets().then((t) => send(200, t));
  } },

  // POST /api/issue/llm {id, engine, model} — SOURCE-BEARING. Operator port only.
  { method: 'POST', path: '/api/issue/llm', handle: (ctx) => {
    const { req, send, readJsonBody, isLoopbackReq } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    if (!isLoopbackReq) return send(403, LOCAL_ONLY);
    return readJsonBody(req, async (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const engine = String((body && body.engine) || '');
      // Derived, for the reason given in routes/remediation.mjs: a literal list would reject a
      // host the declaration supports.
      const allowed = hostsInProbeOrder().filter((h) => h.capabilities.includes('chat')).map((h) => h.id);
      if (!allowed.includes(engine)) return send(400, { ok: false, error: `engine must be one of: ${allowed.join(' | ')}` });
      // `model` travels ONLY inside a JSON body to a loopback model server — never a path, never argv.
      const model = String((body && body.model) || '').slice(0, 200);
      if (!model) return send(400, { ok: false, error: 'a local run needs a model — pick one from /api/issue/llm/targets' });
      let iss;
      try { iss = lookup(loadIssues(), body && body.id); }
      catch (e) { return send(503, { ok: false, error: `issue store unavailable: ${e.message}` }); }
      if (!iss) return send(404, { ok: false, error: 'no such issue' });

      const out = await runLocalOnIssue({ engine, model, prompt: composeIssuePrompt(iss, { root: repoRoot(iss) }) });
      if (!out.ok) return send(502, out);

      const at = nowISO();
      try {
        withIssuesLock(() => {
          const doc = loadIssues();
          if (!doc.issues[iss.id]) return; // vanished under us (a concurrent gc/rekey) — say nothing false
          mutateIssue(doc, iss.id, (i) => {
            i.llm = { at, engine, model, answer: out.answer, thinking: out.thinking,
              verdict: out.verdict, confidence: out.confidence, truncated: out.truncated };
          }, 'issue-updated', { llm: { engine, model, verdict: out.verdict, truncated: out.truncated } }, at);
          saveIssues(doc);
        });
      } catch (e) { return send(503, { ok: false, error: `reply produced but not recorded: ${e.message}` }); }

      return send(200, { ok: true, id: iss.id, engine, model, ...out, recorded: true,
        note: 'recorded as evidence of a claim. A model saying "false positive" does not close anything.' });
    });
  } },

  // POST /api/issues/ingest {project} — run the ingest for one area, now. The SAME ingestArea call
  // the sweep makes, with the same gates. Refusal statuses come back as HTTP 200 with the status
  // named — nothing happened AND WHY.
  { method: 'POST', path: '/api/issues/ingest', handle: (ctx) => {
    const { req, send, readJsonBody, knownProjects } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      // area resolved through knownProjects() — a caller-supplied slug never becomes a path
      const q = body && body.project;
      const known = knownProjects();
      if (!q || !(known.has(q) || known.has(projectSlug(q)))) {
        return send(400, { ok: false, error: 'project must name a known area' });
      }
      const slug = projectSlug(q) || String(q);
      const rollup = readJSON(join(reportsFor(q), 'rollup.json'));
      if (!rollup) return send(200, { ok: true, status: 'no-rollup', area: slug, note: 'this area has no rollup to ingest — run a sweep first' });
      const ledger = readJSON(join(reportsFor(q), 'remediation-ledger.json'));
      const annDoc = readJSON(annotationsPathFor(CW));
      const repoPaths = {};
      try { for (const r of resolveRepos(registry(), {}).repos) if (r.path) repoPaths[r.name] = r.path; }
      catch { /* no anchors ⇒ the suspect lane instead of anchor-drift closes; weaker, never wrong */ }
      const now = nowISO();
      let summary;
      try {
        summary = withIssuesLock(() => {
          const doc = loadIssues();
          // same identity gate as the sweep: a regression this ingest introduced must not reach disk
          const before = identityProblems(doc).length;
          const s = ingestArea(doc, {
            areaSlug: slug, rollup, ledger, annotations: (annDoc && annDoc.annotations) || [], repoPaths, now,
          });
          const after = identityProblems(doc).length;
          s.identityProblems = { before, after };
          if (s.status === 'ok') {
            if (after > before) { s.status = 'refused-identity-regression'; return s; }
            saveIssues(doc);
          }
          return s;
        });
      } catch (e) { return send(503, { ok: false, error: `issue store unavailable: ${e.message}` }); }
      return send(200, { ok: true, ...summary });
    });
  } },

  // POST /api/issue/claude {id} — SOURCE-BEARING. Operator port only.
  { method: 'POST', path: '/api/issue/claude', handle: (ctx) => {
    const { req, send, readJsonBody, isLoopbackReq } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    if (!isLoopbackReq) return send(403, LOCAL_ONLY);
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      let iss;
      try { iss = lookup(loadIssues(), body && body.id); }
      catch (e) { return send(503, { ok: false, error: `issue store unavailable: ${e.message}` }); }
      if (!iss) return send(404, { ok: false, error: 'no such issue' });
      const cwd = repoRoot(iss);
      const prompt = [
        composeIssuePrompt(iss, { root: cwd }),
        '',
        '---',
        '',
        `Tracked as **${iss.id}** in commitwork's issue tracker (\`monitor/issues.json\`).`,
        '',
        'When you have verified a fix, close it with:',
        '',
        `    node bin/issue.mjs close ${iss.id} --as fixed --evidence "<what you verified>" --session <your session>`,
        '',
        'Preferred path: leave the close to scan evidence — the next sweep\'s ingest'
        + ' (`node bin/issue.mjs ingest`) auto-closes on proof, never on absence.',
        '',
      ].join('\n');
      // every path is server-derived — no caller string reaches a shell
      const dir = join(reportsFor(null), 'handoff');
      let file;
      try {
        mkdirSync(dir, { recursive: true });
        file = join(dir, `${iss.id}-${Date.now()}.md`);
        writeFileSync(file, prompt);
      } catch (e) { return send(503, { ok: false, error: `could not write the handoff file: ${e.message}` }); }
      return launchClaudeSession({ file, cwd, prompt })
        .then((r) => send(200, { ...r, id: iss.id }))
        .catch((e) => send(500, { ok: false, error: e.message }));
    });
  } },
];

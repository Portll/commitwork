// admin/routes/leaks-check.mjs — LLM triage for a gitleaks row: real leak, or test fixture?
//
// Reads the line server-side, sends it to the local model only, and scrubs the matched text from
// the reply before it reaches the browser. Advisory: writes no annotation.

import { readFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { CW, resolvedRepos } from '../lib/core.mjs';
import { resolveLocalModel, runLocal } from './codeql-remediation.mjs';

const CONTEXT_LINES = 12;
const LINE_CAP = 400;        // chars per line handed to the model
const MODEL_TIMEOUT_HINT = 'load a model in LM Studio, or pin one with CW_CODEQL_LOCAL_MODEL';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'confidence', 'reasoning', 'signals'],
  properties: {
    verdict: { type: 'string', enum: ['fixture', 'real', 'undetermined'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    signals: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `You triage secret-scanner findings. Decide whether a match is a REAL credential or a
TEST FIXTURE (sample data, a documented example value, a scanner's own canary, a unit-test constant).
Answer "undetermined" whenever the evidence does not settle it — a wrong "fixture" hides a live
credential, and a wrong "real" wastes a rotation. Never quote the matched value in your reasoning;
describe its shape instead.`;

// Resolves through the registry, never by joining a caller string onto a root.
export function repoRoot(repoName) {
  const hit = resolvedRepos().find((r) => r.name === repoName);
  if (!hit || !hit.path) return null;
  return resolve(hit.path);
}

// Contains the file to its repo: resolve, then require the result to still be inside.
export function safeJoin(root, relPath) {
  if (!root || typeof relPath !== 'string' || !relPath) return null;
  if (isAbsolute(relPath)) return null;
  const p = resolve(join(root, relPath));
  const rel = relative(root, p);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return p;
}

// Returns the excerpt shown to the model plus the raw matched line, which stays in this process.
export function readContext(absPath, line) {
  let text;
  try { text = readFileSync(absPath, 'utf8'); }
  catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'file no longer present in the working tree' : `unreadable: ${e.message}` }; }
  const lines = text.split('\n');
  const idx = Math.max(0, Math.min(lines.length - 1, (Number(line) || 1) - 1));
  const from = Math.max(0, idx - CONTEXT_LINES);
  const to = Math.min(lines.length, idx + CONTEXT_LINES + 1);
  const cap = (s) => (s.length > LINE_CAP ? `${s.slice(0, LINE_CAP)}… [truncated]` : s);
  const numbered = lines.slice(from, to).map((s, i) => `${String(from + i + 1).padStart(5)}| ${cap(s)}`).join('\n');
  return { ok: true, excerpt: numbered, matched: lines[idx] || '', totalLines: lines.length };
}

// The excerpt an OPERATOR may see. scrub() alone is not enough for source: it only removes tokens
// of >=8 chars taken from the matched line, so a short secret would survive, and the matched line is
// the one line certain to contain the value. So the match is redacted STRUCTURALLY — every run of
// non-space, non-delimiter characters on that line is masked. That takes the IDENTIFIER with it —
// `aws_key` becomes `•••••••` — which costs legibility and is the right trade: telling an
// identifier from a value on an arbitrary line is not reliable, and the surrounding lines carry
// the context that actually decides fixture-vs-real. scrub() is then applied to the whole excerpt
// in case the same value also appears on a neighbouring line.
export function redactExcerpt(excerpt, matched, lineNo) {
  const marker = `${String(lineNo).padStart(5)}| `;
  const out = String(excerpt || '').split('\n').map((row) => {
    if (!row.startsWith(marker)) return row;
    const body = row.slice(marker.length).replace(/[^\s"'`,;:(){}\[\]<>=]{4,}/g, (m) => '•'.repeat(Math.min(m.length, 12)));
    return `${marker}${body}`;
  }).join('\n');
  return scrub(out, matched);
}

// Removes any run of >=8 non-space chars from the matched line out of model output.
export function scrub(text, matchedLine) {
  if (!text) return '';
  let out = String(text);
  const tokens = String(matchedLine || '').split(/[\s"'`,;(){}[\]<>]+/).filter((t) => t.length >= 8);
  // longest first: a token containing a shorter one leaves nothing behind
  for (const t of tokens.sort((a, b) => b.length - a.length)) out = out.split(t).join('[redacted]');
  return out;
}

export const routes = [
  // POST /api/leaks/check — { project, repo, rule, file, line }
  { method: 'POST', path: '/api/leaks/check', handle: (ctx) => {
    const { send, req, readJsonBody } = ctx;
    const s = ctx.adminSession(req);
    if (!s || !s.user) return send(401, { ok: false, error: 'authentication required' });

    // readJsonBody is (req, cb) — every other route in admin/routes/ calls it that way. This one
    // was written as `await readJsonBody()`, so `req` was undefined inside it and the first thing
    // it touched was `req.on('data')`: every check ever attempted died as
    // "bad body: Cannot read properties of undefined (reading 'on')". The route has never run.
    // The nine tests beside it exercise safeJoin/scrub/readContext and never invoke the handler,
    // which is why they were green throughout.
    return readJsonBody(req, async (body, err) => {
    // `err` is a STRING here, not an Error — readJsonBody reports via cb(null, 'body too large').
    if (err) return send(400, { ok: false, error: `bad body: ${err}` });
    const { repo, rule, file, line } = body || {};
    if (!repo || !file) return send(400, { ok: false, error: 'repo and file are required' });

    const root = repoRoot(repo);
    if (!root) return send(404, { ok: false, error: `no resolved repo named '${repo}'` });
    const abs = safeJoin(root, file);
    if (!abs) return send(400, { ok: false, error: 'file escapes its repository root' });

    const ctxRead = readContext(abs, line);
    if (!ctxRead.ok) return send(200, { ok: true, verdict: 'undetermined', confidence: 'low', reasoning: ctxRead.error, signals: [], engine: null });

    const model = await resolveLocalModel();
    if (!model.ok) return send(503, { ok: false, error: `${model.error} — ${MODEL_TIMEOUT_HINT}` });

    const user = [
      `Scanner: gitleaks`,
      `Rule: ${rule || '(unnamed)'}`,
      `Repository: ${repo}`,
      `Path: ${file}`,
      `Line: ${line}`,
      ``,
      `Source around the match:`,
      '```',
      ctxRead.excerpt,
      '```',
    ].join('\n');

    const r = await runLocal(model.model, SYSTEM, user, SCHEMA, 'leak_triage', null, '{"verdict"');
    if (!r.ok) return send(503, { ok: false, error: r.error });
    if (!r.verdict) return send(502, { ok: false, error: 'the local model returned no parseable verdict' });

    const v = r.verdict;
    return send(200, {
      ok: true,
      verdict: ['fixture', 'real', 'undetermined'].includes(v.verdict) ? v.verdict : 'undetermined',
      confidence: v.confidence || 'low',
      reasoning: scrub(v.reasoning, ctxRead.matched),
      signals: (v.signals || []).map((x) => scrub(String(x), ctxRead.matched)),
      salvaged: !!r.salvaged,
      // THE EVIDENCE, redacted. An advisory verdict with nothing to check it against is the shape
      // this panel refuses everywhere else: the operator is the adjudicator here and cannot
      // adjudicate a claim they are asked to take on trust. The matched value never reaches the
      // browser; its SHAPE and the surrounding lines do, which is what decides fixture-vs-real.
      excerpt: redactExcerpt(ctxRead.excerpt, ctxRead.matched, Number(line) || 1),
      matchedLine: Number(line) || 1,
      redaction: 'the whole matched line is masked, identifier included — telling an identifier from a value on an arbitrary line is not reliable, so the line is over-masked rather than partly. Surrounding lines are verbatim.',
      engine: { engine: 'lmstudio', model: model.model, pinned: !!model.pinned },
      advisory: true,
    });
    });
  } },
];

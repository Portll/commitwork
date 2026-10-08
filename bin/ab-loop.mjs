#!/usr/bin/env node
// bin/ab-loop.mjs — the prompt A/B loop backbone, runnable today.
//
// One command per build loop: dispatch prompt variant A and prompt variant B to a local LLM,
// run a blind judge over the pair (prompts/compare_ab.md rubric), and persist every artefact of
// the loop — prompts, responses, judge audit, machine-readable run record — locally under
// reports/ab-runs/<runId>/ (generated, gitignored per this repo's doc-tier convention).
// Memory-layer persistence is attempted when a key is present and otherwise degrades: the exact
// upsert payloads that WOULD have been sent are written to memory-layer-backfill.json so a later
// session with a key can replay them losslessly.
//
// Migrated from internal-d (scripts/ab-loop.mjs) 2026-09-01 — same contract, adapted to this repo's
// conventions: LLM endpoint resolves via manifests/llm-hosts.json (monitor/llm-hosts.mjs) instead
// of a hardcoded guess, persistence goes through lib/memory-layer-client.mjs's upsert/verifyReceipt
// (three-state receipts, redaction gate, content-hash verification) instead of a raw POST, and
// every override env var is CW_*-prefixed per house convention. `@fn:` primitive resolution is
// unchanged — $HOME/.claude/_functions/{p0,p1} is a user-scope convention, not a internal-d-repo one,
// so it already worked from any checkout.
//
// Usage:
//   node bin/ab-loop.mjs --a promptA.md --b promptB.md [--tool <template>] \
//     [--question "which handles failure better?"] [--label retry-shape] [--parent <runId>] \
//     [--model <id>] [--temperature 0.2] [--seed 42] [--max-tokens N] [--timeout ms] \
//     [--serial] [--double-judge] [--no-judge] [--runs-dir path] [--llm-url url]
//
// Exit codes: 0 = loop completed (memory-layer degradation is NOT a failure); 1 = config or variant
// dispatch failure; 2 = variants succeeded but the judge failed (artefacts still persisted).

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { loadLlmHosts, baseUrlFor } from "../monitor/llm-hosts.mjs";
import { upsert, verifyReceipt } from "../lib/memory-layer-client.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FN_DIRS = [
  join(homedir(), ".claude", "_functions", "p0"),
  join(homedir(), ".claude", "_functions", "p1"),
];
const MAX_FN_DEPTH = 8;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
// Readable-refusals contract: an unknown parameter is REJECTED with a human-language report —
// never silently ignored. A silently-dropped flag (e.g. --tempature) would run the experiment
// with different parameters than the operator believes, invalidating the comparison.
const BOOL_FLAGS = ["--serial", "--double-judge", "--no-judge"];
const VALUED_FLAGS = [
  "--a", "--b", "--tool", "--question", "--label", "--parent", "--model", "--temperature",
  "--seed", "--max-tokens", "--timeout", "--runs-dir", "--llm-url",
];

function editDistance(s, t) {
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 0; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++)
    for (let j = 1; j <= t.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
  return d[s.length][t.length];
}

function rejectUnknown(rejected) {
  const accepted = [...VALUED_FLAGS, ...BOOL_FLAGS].join(", ");
  const lines = rejected.map(({ key, value }) => {
    let hint = "";
    if (key.startsWith("--")) {
      const [best] = [...VALUED_FLAGS, ...BOOL_FLAGS]
        .map((k) => [k, editDistance(key, k)])
        .sort((x, y) => x[1] - y[1]);
      if (best && best[1] <= 3) hint = ` — did you mean '${best[0]}'?`;
    }
    const tail = value !== undefined ? ` (its value '${value}' was also not applied)` : "";
    return key.startsWith("--")
      ? `unknown parameter '${key}'${hint}${tail}`
      : `unexpected positional argument '${key}' — this runner takes only named flags`;
  });
  die(`refusing to run:\n  ${lines.join("\n  ")}\nAccepted parameters: ${accepted}`);
}

function parseArgs(argv) {
  const out = { _: [] };
  const rejected = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (BOOL_FLAGS.includes(a)) out[a.slice(2)] = true;
      else if (VALUED_FLAGS.includes(a)) out[a.slice(2)] = argv[++i];
      else {
        const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : undefined;
        rejected.push({ key: a, value });
      }
    } else rejected.push({ key: a });
  }
  if (rejected.length) rejectUnknown(rejected);
  return out;
}

const args = parseArgs(process.argv.slice(2));

function die(msg) {
  process.stderr.write(`ab-loop: ${msg}\n`);
  process.exit(1);
}

// LLM endpoint: resolve from manifests/llm-hosts.json's declared default host, not a guess —
// the same resolver admin/ and monitor/ already use, so a host added there is available here too.
function defaultLlmUrl() {
  try {
    const decl = loadLlmHosts();
    return `${baseUrlFor(decl.default, decl)}/v1`;
  } catch (e) {
    die(`could not resolve a default LLM host from manifests/llm-hosts.json: ${e.message}`);
  }
}

const cfg = {
  a: args.a,
  b: args.b,
  tool: args.tool || null,
  question: args.question || "Which response better serves the stated goal?",
  label: (args.label || "run").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40),
  parent: args.parent || null,
  model: args.model || process.env.CW_AB_LLM_MODEL || null,
  temperature: args.temperature !== undefined ? Number(args.temperature) : 0.2,
  seed: args.seed !== undefined ? Number(args.seed) : 42,
  maxTokens: args["max-tokens"] !== undefined ? Number(args["max-tokens"]) : 2048,
  timeoutMs: args.timeout !== undefined ? Number(args.timeout) : 300_000,
  serial: !!args.serial,
  doubleJudge: !!args["double-judge"],
  judge: !args["no-judge"],
  runsDir: args["runs-dir"] || process.env.CW_AB_RUNS_DIR || join(REPO_ROOT, "reports", "ab-runs"),
  llmUrl: (args["llm-url"] || process.env.CW_AB_LLM_URL || defaultLlmUrl()).replace(/\/$/, ""),
  promptsDir: process.env.CW_AB_PROMPTS_DIR || null,
};

for (const [k, v] of Object.entries({ temperature: cfg.temperature, seed: cfg.seed, "max-tokens": cfg.maxTokens, timeout: cfg.timeoutMs }))
  if (Number.isNaN(v)) die(`refusing to run: parameter '--${k}' must be a number — got a non-numeric value`);

if (!cfg.a) die("--a is required (path to a prompt/context file)");
// Single-variant mode: with no --b, the runner dispatches A alone (no judge).
const SINGLE = !cfg.b;

// ---------------------------------------------------------------------------
// @fn: resolution — p0 first, then p1, per the global CLAUDE.md convention. Missing primitive is
// a hard failure: silently leaving the token literal would change prompt semantics and invalidate
// the A/B comparison.
// ---------------------------------------------------------------------------
function resolveFns(body, visited = new Set(), depth = 0) {
  if (depth > MAX_FN_DEPTH) throw new Error(`@fn: resolution exceeded max depth (${MAX_FN_DEPTH})`);
  return body.replace(/@fn:([a-zA-Z0-9_-]+)/g, (whole, name) => {
    // A second reference is a cross-reference, not a loop (dimension-master <-> dimension-registry,
    // fmea-rpn <-> hazop-guide, etc. cite each other as ordinary documentation). Re-entry emits a
    // pointer and the recursion terminates on its own; a name resolving NOWHERE stays fatal below.
    if (visited.has(name)) return `(see ${name} above)`;
    const file = FN_DIRS.map((d) => join(d, `${name}.md`)).find((p) => existsSync(p));
    if (!file) throw new Error(`@fn:${name} not found in p0/ or p1/`);
    visited.add(name);
    // Every primitive names itself in its own heading (`# @fn:<name>`) — strip the self-mention so
    // it doesn't trip the cycle detector, without touching genuine cross-primitive cycles. Negative
    // lookahead on name-continuation chars, not \b, so a prefix-of-another-name stays intact.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- name is captured by [a-zA-Z0-9_-]+ from the primitive body just above
    const raw = readFileSync(file, "utf8").replace(new RegExp(`@fn:${name}(?![a-zA-Z0-9_-])`, "g"), name);
    const resolved = resolveFns(raw, visited, depth + 1);
    visited.delete(name);
    return resolved;
  });
}

function loadTemplate(tool) {
  // The templates live in spine's prompts/ (moved 2026-10-06); this checkout holds no copy.
  if (!cfg.promptsDir) die("missing input: --tool needs CW_AB_PROMPTS_DIR, the prompts/ directory of a spine checkout");
  const path = join(cfg.promptsDir, `${tool}.md`);
  if (!existsSync(path)) die(`template not found: ${path}`);
  return readFileSync(path, "utf8");
}

function buildPrompt(rawContext) {
  let body = rawContext;
  const applied = [];
  if (cfg.tool) {
    const template = loadTemplate(cfg.tool);
    if (!template.includes("{{context}}")) die(`template ${cfg.tool}.md has no {{context}} placeholder`);
    body = template.replace("{{context}}", () => rawContext);
  }
  const fnNames = [...body.matchAll(/@fn:([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  const resolved = resolveFns(body);
  for (const n of fnNames) if (!applied.includes(n)) applied.push(n);
  return { prompt: resolved, appliedFunctions: applied };
}

// ---------------------------------------------------------------------------
// HTTP with mandatory timeout
// ---------------------------------------------------------------------------
async function http(url, { method = "GET", headers = {}, body = null, timeoutMs = cfg.timeoutMs } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json", ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body is fine */ }
    return { status: res.status, ok: res.ok, text, json };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// memory-layer — best-effort upsert + immediate verify, backfill record on degrade
// ---------------------------------------------------------------------------
const internalCState = { backfill: [] };

async function internalCRemember(content, tags, runId, externalIdSuffix) {
  if (typeof content !== "string" || content.length === 0) {
    return { state: "failed", reason: "no content to persist" };
  }
  const external_id = `commitwork/ab-run/${runId}/${externalIdSuffix}`;
  const record = { content, memory_type: "Context", tags: [...tags, `ab-run:${runId}`], external_id };
  const receipt = await upsert(record, { scope: "ab-loop" });
  if (receipt.state === "failed" || receipt.state === "accepted-unverified") {
    internalCState.backfill.push({ external_id, record, receipt });
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// LLM — preflight model resolution, then non-streaming chat completion
// ---------------------------------------------------------------------------
async function resolveModel() {
  let models = [];
  try {
    const r = await http(`${cfg.llmUrl}/models`, { timeoutMs: 5000 });
    if (r.ok && r.json?.data) models = r.json.data.map((m) => m.id);
  } catch (e) {
    die(`LLM endpoint unreachable at ${cfg.llmUrl} (${e.message})`);
  }
  if (models.length === 0) die(`LLM endpoint has no models loaded (${cfg.llmUrl}/models)`);
  if (cfg.model && models.includes(cfg.model)) return { model: cfg.model, warning: null };
  if (cfg.model) {
    if (models.length === 1)
      return { model: models[0], warning: `configured model '${cfg.model}' absent; auto-fell-back to sole available '${models[0]}'` };
    die(`configured model '${cfg.model}' not available. Available: ${models.join(", ")}`);
  }
  return { model: models[0], warning: models.length > 1 ? `no model configured; picked first of ${models.length}: '${models[0]}'` : null };
}

async function chat(model, prompt, { temperature, maxTokens }) {
  const started = Date.now();
  const r = await http(`${cfg.llmUrl}/chat/completions`, {
    method: "POST",
    body: {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      seed: cfg.seed,
      max_tokens: maxTokens,
      stream: false,
    },
  });
  const latencyMs = Date.now() - started;
  if (!r.ok) throw new Error(`chat/completions ${r.status}: ${r.text.slice(0, 300)}`);
  const choice = r.json?.choices?.[0];
  const reasoning = choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;
  if (!choice?.message?.content) {
    if (reasoning && choice?.finish_reason === "length") {
      const e = new Error(`reasoning consumed the entire token budget (${maxTokens}) before any content — raise --max-tokens`);
      e.code = "REASONING_EXHAUSTED";
      throw e;
    }
    throw new Error(`malformed completion: ${r.text.slice(0, 300)}`);
  }
  return {
    content: choice.message.content,
    reasoning,
    finishReason: choice.finish_reason ?? "unknown",
    truncated: choice.finish_reason === "length",
    usage: r.json.usage ?? null,
    latencyMs,
  };
}

// One automatic retry with a 4x budget when a thinking model exhausts its tokens in reasoning.
// The prompt is never altered (a /no_think-style soft switch would change A/B semantics).
async function chatResilient(model, prompt, opts) {
  try {
    return await chat(model, prompt, opts);
  } catch (e) {
    if (e.code !== "REASONING_EXHAUSTED") throw e;
    const retryOpts = { ...opts, maxTokens: opts.maxTokens * 4 };
    const res = await chat(model, prompt, retryOpts);
    return { ...res, retried: true, retryMaxTokens: retryOpts.maxTokens };
  }
}

// ---------------------------------------------------------------------------
// judge — blind, order-randomised, verdict parsed from trailing json fence
// ---------------------------------------------------------------------------
function buildJudgePrompt(question, first, second, modelId) {
  // Claude-class judges get the @fn:-bearing variant; local models must never see @fn: syntax
  // (methodology-heavy prompts measurably collapse small-model output).
  const claudeJudge = /claude|opus|sonnet|haiku|fable/i.test(modelId || "");
  const template = loadTemplate(claudeJudge ? "compare_ab_claude" : "compare_ab");
  const context = [
    `## Comparison question\n${question}`,
    `## R1\n\n${first}`,
    `## R2\n\n${second}`,
  ].join("\n\n");
  // HTML comments are the template's maintainer metadata, stripped before the responses go in: a
  // response is model output, and one holding `<!--` would otherwise eat text up to the other's `-->`.
  let shell = template;
  let next;
  while ((next = shell.replace(/<!--[\s\S]*?-->\n?/g, "")) !== shell) shell = next;
  // A function replacement: `$&` or `$'` in a response is text, not a replacement pattern.
  const body = shell.replace("{{context}}", () => context);
  // @fn: expansion throws for several primitives in this corpus today (missing/cyclic refs), so
  // both judge templates carry their rules IN FULL rather than resolving — every judge gets the
  // token stripped, since unresolvable syntax is noise.
  return body.replace(/@fn:[a-zA-Z0-9_-]+/g, "the shared rubric");
}

function parseVerdict(judgeText, mapping) {
  const fences = [...judgeText.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (fences.length === 0) return { parsed: false, raw: null };
  try {
    const v = JSON.parse(fences[fences.length - 1][1]);
    const norm = String(v.winner ?? "").trim().toLowerCase().replace(/^response\s*/, "r");
    const label = norm === "tie" ? "tie" : norm === "r1" ? mapping.R1 : norm === "r2" ? mapping.R2 : null;
    return { parsed: label !== null, raw: v, winner: label };
  } catch {
    return { parsed: false, raw: null };
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function readPromptFile(path, flag) {
  const abs = resolve(path);
  if (!existsSync(abs)) die(`refusing to run: ${flag} file not found: ${abs}`);
  const size = statSync(abs).size;
  const MAX_PROMPT_BYTES = Number(process.env.CW_AB_MAX_PROMPT_BYTES || 8_000_000);
  if (size > MAX_PROMPT_BYTES)
    die(`refusing to run: ${flag} file is ${size} bytes (cap ${MAX_PROMPT_BYTES}) — no model here can read that; point ${flag} at a prompt, not a corpus`);
  return readFileSync(abs, "utf8");
}

async function main() {
  const contextA = readPromptFile(cfg.a, "--a");
  const contextB = SINGLE ? null : readPromptFile(cfg.b, "--b");

  const earlyWarnings = [];
  if (cfg.parent === "latest") {
    try {
      cfg.parent = readFileSync(join(cfg.runsDir, "LATEST"), "utf8").trim();
    } catch {
      cfg.parent = null;
      earlyWarnings.push("--parent latest: no LATEST pointer in the runs dir — running unchained (first run?)");
    }
  }

  const runId = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${cfg.label}-${randomBytes(3).toString("hex")}`;
  const runDir = join(cfg.runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  const warnings = [...earlyWarnings];
  const promptA = buildPrompt(contextA);
  const promptB = SINGLE ? { prompt: null, appliedFunctions: [] } : buildPrompt(contextB);

  // Context-size guard: some local servers silently truncate over-length prompts (context shift),
  // which would invalidate the comparison without any visible error. ~4 chars/token heuristic.
  const CTX_WARN_TOKENS = Number(process.env.CW_AB_CTX_WARN_TOKENS || 24_000);
  for (const [name, p] of [["A", promptA], ["B", promptB]]) {
    if (!p.prompt) continue;
    const estTokens = Math.ceil(p.prompt.length / 4);
    if (estTokens > CTX_WARN_TOKENS)
      warnings.push(`prompt ${name} is ~${estTokens} tokens (> ${CTX_WARN_TOKENS}) — model may silently truncate; comparison validity at risk`);
  }

  const { model, warning: modelWarning } = await resolveModel();
  if (modelWarning) warnings.push(modelWarning);

  // dispatch variants
  const opts = { temperature: cfg.temperature, maxTokens: cfg.maxTokens };
  let resA, resB;
  if (SINGLE) {
    resA = await chatResilient(model, promptA.prompt, opts).catch((e) => ({ error: e.message }));
    resB = { skipped: true };
  } else if (cfg.serial) {
    resA = await chatResilient(model, promptA.prompt, opts).catch((e) => ({ error: e.message }));
    resB = await chatResilient(model, promptB.prompt, opts).catch((e) => ({ error: e.message }));
  } else {
    [resA, resB] = (await Promise.allSettled([
      chatResilient(model, promptA.prompt, opts),
      chatResilient(model, promptB.prompt, opts),
    ])).map((s) => (s.status === "fulfilled" ? s.value : { error: s.reason?.message ?? String(s.reason) }));
  }

  writeFileSync(join(runDir, "prompt-a.md"), promptA.prompt);
  if (!SINGLE) writeFileSync(join(runDir, "prompt-b.md"), promptB.prompt);
  if (resA.content) writeFileSync(join(runDir, "response-a.md"), resA.content);
  if (resB.content) writeFileSync(join(runDir, "response-b.md"), resB.content);
  if (resA.reasoning) writeFileSync(join(runDir, "response-a-reasoning.md"), resA.reasoning);
  if (resB.reasoning) writeFileSync(join(runDir, "response-b-reasoning.md"), resB.reasoning);
  if (resA.retried) warnings.push(`variant A retried at ${resA.retryMaxTokens} max_tokens after reasoning exhaustion`);
  if (resB.retried) warnings.push(`variant B retried at ${resB.retryMaxTokens} max_tokens after reasoning exhaustion`);

  if (resA.error || resB.error) {
    const failed = await persistRun(runDir, runId, model, promptA, promptB, resA, resB, null, warnings, "variant-failure");
    writeReport(runDir, failed);
    updateIndex(failed);
    die(`variant dispatch failed — A: ${resA.error ?? "ok"} | B: ${resB.error ?? "ok"} (artefacts in ${runDir})`);
  }
  if (resA.truncated) warnings.push("response A truncated (finish_reason=length) — judge audits an incomplete artefact");
  if (resB.truncated) warnings.push("response B truncated (finish_reason=length) — judge audits an incomplete artefact");

  // memory-layer: variant artefacts (tag scheme matches review-ab's prior run-prompt convention)
  const toolTag = cfg.tool ?? "raw";
  const receipts = {};
  receipts.aInput = await internalCRemember(promptA.prompt, ["run-prompt", toolTag, "type:input", "variant:a"], runId, "variant-a-input");
  receipts.aResponse = await internalCRemember(resA.content, ["run-prompt", toolTag, "type:response", "variant:a"], runId, "variant-a-response");
  if (!SINGLE) {
    receipts.bInput = await internalCRemember(promptB.prompt, ["run-prompt", toolTag, "type:input", "variant:b"], runId, "variant-b-input");
    receipts.bResponse = await internalCRemember(resB.content, ["run-prompt", toolTag, "type:response", "variant:b"], runId, "variant-b-response");
  }

  // judge (blind, randomised order; judge model == variant model is recorded, not hidden)
  let judge = null;
  if (cfg.judge && !SINGLE) {
    const aFirst = randomBytes(1)[0] < 128;
    const mapping = aFirst ? { R1: "A", R2: "B" } : { R1: "B", R2: "A" };
    const first = aFirst ? resA.content : resB.content;
    const second = aFirst ? resB.content : resA.content;
    const judgePrompt = buildJudgePrompt(cfg.question, first, second, model);
    const judgeEstTokens = Math.ceil(judgePrompt.length / 4);
    if (judgeEstTokens > CTX_WARN_TOKENS)
      warnings.push(`judge prompt is ~${judgeEstTokens} tokens (> ${CTX_WARN_TOKENS}) — model may silently truncate; verdict validity at risk`);
    try {
      const j = await chatResilient(model, judgePrompt, {
        temperature: 0,
        maxTokens: Math.max(cfg.maxTokens, 2048),
      });
      if (j.reasoning) writeFileSync(join(runDir, "judge-reasoning.md"), j.reasoning);
      writeFileSync(join(runDir, "judge.md"), j.content);
      const verdict = parseVerdict(j.content, mapping);
      judge = { mapping, latencyMs: j.latencyMs, usage: j.usage, truncated: j.truncated, verdict, selfJudge: true };
      if (j.truncated) warnings.push("judge output truncated — verdict may be missing; raise --max-tokens");
      if (!verdict.parsed) warnings.push("judge verdict JSON not parseable — read judge.md manually");
      receipts.judge = await internalCRemember(j.content, ["run-prompt", "compare_ab", "type:response", "role:judge"], runId, "judge");

      if (cfg.doubleJudge) {
        const j2 = await chatResilient(model, buildJudgePrompt(cfg.question, second, first), {
          temperature: 0,
          maxTokens: Math.max(cfg.maxTokens, 2048),
        });
        writeFileSync(join(runDir, "judge-swapped.md"), j2.content);
        receipts.judgeSwapped = await internalCRemember(j2.content, ["run-prompt", "compare_ab", "type:response", "role:judge-swapped"], runId, "judge-swapped");
        const swappedMapping = { R1: mapping.R2, R2: mapping.R1 };
        const v2 = parseVerdict(j2.content, swappedMapping);
        judge.swapped = { verdict: v2, latencyMs: j2.latencyMs };
        judge.positionConsistent = verdict.parsed && v2.parsed && verdict.winner === v2.winner;
        if (judge.positionConsistent === false)
          warnings.push(`judge disagrees with itself under order swap (${verdict.winner} vs ${v2.winner}) — treat as tie, escalate to manual audit`);
      }
    } catch (e) {
      warnings.push(`judge call failed: ${e.message}`);
      judge = { error: e.message };
    }
  }

  const record = await persistRun(runDir, runId, model, promptA, promptB, resA, resB, judge, warnings, judge?.error ? "judge-failure" : "complete", receipts);
  writeReport(runDir, record);
  updateIndex(record);
  process.stdout.write(`${JSON.stringify({ runId, runDir, winner: record.judge?.verdict?.winner ?? null, internalC: record.internalC, warnings }, null, 2)}\n`);
  if (judge?.error) process.exit(2);
}

// Per-loop efficiency: the next loop must find this one without directory archaeology.
// index.json accumulates one summary row per run; LATEST holds the newest runId.
// Single-operator assumption — concurrent loops sharing a runs dir can race this file.
function updateIndex(record) {
  const indexPath = join(cfg.runsDir, "index.json");
  let index = [];
  try { index = JSON.parse(readFileSync(indexPath, "utf8")); } catch { /* first run */ }
  index.push({
    runId: record.runId,
    createdAt: record.createdAt,
    label: record.label,
    parent: record.parent,
    status: record.status,
    tool: record.tool,
    model: record.model,
    winner: record.judge?.verdict?.winner ?? null,
    warningsCount: record.warnings.length,
  });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  writeFileSync(join(cfg.runsDir, "LATEST"), record.runId + "\n");
}

async function persistRun(runDir, runId, model, promptA, promptB, resA, resB, judge, warnings, status, receipts = {}) {
  const receiptList = Object.values(receipts).filter(Boolean);
  const verifiedCount = receiptList.filter((r) => r.state === "verified").length;
  const record = {
    schema: "ab-run/v1",
    runId,
    status,
    mode: SINGLE ? "single" : "ab",
    createdAt: new Date().toISOString(),
    label: cfg.label,
    parent: cfg.parent,
    question: cfg.question,
    tool: cfg.tool,
    model,
    params: { temperature: cfg.temperature, seed: cfg.seed, maxTokens: cfg.maxTokens, serial: cfg.serial },
    appliedFunctions: [...new Set([...promptA.appliedFunctions, ...promptB.appliedFunctions])],
    variants: {
      a: { source: resolve(cfg.a), latencyMs: resA.latencyMs ?? null, usage: resA.usage ?? null, finishReason: resA.finishReason ?? null, truncated: !!resA.truncated, error: resA.error ?? null },
      b: SINGLE ? null : { source: resolve(cfg.b), latencyMs: resB.latencyMs ?? null, usage: resB.usage ?? null, finishReason: resB.finishReason ?? null, truncated: !!resB.truncated, error: resB.error ?? null },
    },
    judge,
    internalC: {
      writes: receiptList.length,
      verified: verifiedCount,
      degraded: receiptList.length - verifiedCount,
      receipts: Object.fromEntries(Object.entries(receipts).filter(([, v]) => v).map(([k, v]) => [k, { state: v.state, id: v.id, reason: v.reason }])),
    },
    warnings,
  };
  writeFileSync(join(runDir, "run.json"), JSON.stringify(record, null, 2));
  writeFileSync(join(runDir, "memory-layer-backfill.json"), JSON.stringify(internalCState.backfill, null, 2));
  return record;
}

function writeReport(runDir, r) {
  if (r.mode === "single") {
    const lines = [
      `# AB-LOOP (single) — ${r.runId}`,
      "",
      `- model: ${r.model}`,
      `- params: temp ${r.params.temperature}, seed ${r.params.seed}, max_tokens ${r.params.maxTokens}`,
      `- latency: ${r.variants.a.latencyMs}ms · truncated: ${r.variants.a.truncated}`,
      `- memory-layer: ${r.internalC.verified}/${r.internalC.writes} verified — ${r.internalC.degraded} in memory-layer-backfill.json`,
      r.warnings.length ? `\n## Warnings\n${r.warnings.map((x) => `- ${x}`).join("\n")}` : null,
      "",
      "## Next loop",
      `- This is a baseline. Branch a variant and compare: --a <this prompt> --b <variant> --parent ${r.runId}`,
    ].filter((x) => x !== null);
    writeFileSync(join(runDir, "report.md"), lines.join("\n") + "\n");
    return;
  }
  const w = r.judge?.verdict?.winner ?? "unjudged";
  // The judge speaks in blind labels; the operator reads variants. De-blind all prose.
  const deblind = (s) => (r.judge?.mapping ? String(s).replaceAll("R1", r.judge.mapping.R1).replaceAll("R2", r.judge.mapping.R2) : s);
  const lines = [
    `# AB-LOOP — ${r.runId}`,
    "",
    "```",
    "AB-LOOP — A vs B",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ` A: ${(r.judge?.verdict?.raw ? (r.judge.mapping.R1 === "A" ? r.judge.verdict.raw.r1_total : r.judge.verdict.raw.r2_total) : null) ?? "?"}/120   B: ${(r.judge?.verdict?.raw ? (r.judge.mapping.R1 === "B" ? r.judge.verdict.raw.r1_total : r.judge.verdict.raw.r2_total) : null) ?? "?"}/120`,
    ` Key trade-offs: ${deblind((r.judge?.verdict?.raw?.key_tradeoffs ?? []).join("; ")) || "see judge.md"}`,
    ` Recommendation: ${w}`,
    ` Blockers: ${deblind(JSON.stringify(r.judge?.verdict?.raw?.blockers ?? "n/a"))}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "```",
    "",
    `- model: ${r.model} (judge is same model — self-judge bias is on the record)`,
    `- params: temp ${r.params.temperature}, seed ${r.params.seed}, max_tokens ${r.params.maxTokens}`,
    `- latency: A ${r.variants.a.latencyMs}ms / B ${r.variants.b.latencyMs}ms / judge ${r.judge?.latencyMs ?? "-"}ms`,
    `- truncation: A ${r.variants.a.truncated} / B ${r.variants.b.truncated}`,
    `- memory-layer: ${r.internalC.verified}/${r.internalC.writes} verified — ${r.internalC.degraded} in memory-layer-backfill.json`,
    r.parent ? `- parent run: ${r.parent}` : null,
    r.warnings.length ? `\n## Warnings\n${r.warnings.map((x) => `- ${x}`).join("\n")}` : null,
    "",
    "## Next loop",
    w === "tie" || w === "unjudged"
      ? "- No clear winner. Sharpen the comparison question or increase variant divergence before spending another loop."
      : `- Carry variant ${w} forward as the new baseline; branch the next B from it. Chain with --parent ${r.runId}.`,
  ].filter((x) => x !== null);
  writeFileSync(join(runDir, "report.md"), lines.join("\n") + "\n");
}

main().catch((e) => die(e.stack ?? String(e)));

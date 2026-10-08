#!/usr/bin/env node
// bin/issue-llm.mjs — put an issue in front of a model and record what it said.
//
// Unlike issue-loop.mjs (which spawns an agent that edits the tree), this writes nothing but
// evidence — nothing here can change a line of source. The reply (analysis and thinking) is
// appended as machine-attributed EVIDENCE, never a close: a model's verdict is a claim, and
// closing stays a human act or a scan-proved auto-close at ingest.
//
// usage:
//   node bin/issue-llm.mjs --issue ISS-000001 [--model <id>]
//   node bin/issue-llm.mjs --all-open --area <slug> [--limit N]
//   node bin/issue-llm.mjs --list-models
//
// exit: 0 ok · 2 usage · 5 engine unreachable
//
// env: CW_LLM_URL_LMSTUDIO (LM Studio server; default from manifests/llm-hosts.json) ·
//      CW_LMSTUDIO_URL (older name for CW_LLM_URL_LMSTUDIO) · CW_ISSUE_MODEL · CW_ISSUES · CW_NOW ·
//      CW_MODEL_PROVIDER (select a hosted API instead; see lib/model-provider.mjs)

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitThinking, parseVerdict } from '../lib/llm-reply.mjs';
import { resolveModelProvider, chatComplete, describeProvider } from '../lib/model-provider.mjs';
import { baseUrlFor } from '../monitor/llm-hosts.mjs';
import {
  loadIssues, saveIssues, withIssuesLock, nowISO, mutateIssue,
} from '../monitor/issue-store.mjs';
// Prompt composition lives in monitor/issue-prompt.mjs — the panel asks the same question, so two
// copies would drift.
import { composeIssuePrompt } from '../monitor/issue-prompt.mjs';
import { checkForIssue } from '../lib/exemplar-select.mjs';
import { lintPair } from '../lib/reasoning-lint.mjs';
import { identityFor } from '../monitor/detail-schema.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import {
  readJournalFile, readAdjudications, adjudicationsPath, readCalibrateBaseline, computeFindingCalibration,
  appendFindingAdjudication, findingKeyForScanner,
} from './lib/verdict-journal-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const has = (k) => args.includes(k);
const say = (m) => process.stdout.write(m + '\n');
const die = (m, c = 2) => { process.stderr.write(m + '\n'); process.exitCode = c; };

async function listModels(base) {
  const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.data || []).map((m) => m.id);
}

// Prefer a dense mid-size coder over a tiny one or a few-active-param MoE; embeddings are never chat.
// Exported so bin/finding-analysis.mjs selects the same way: "first in the list" is not a choice
// when nine models are loaded, and two lanes picking differently makes their results incomparable.
export function pickModel(ids) {
  const usable = ids.filter((id) => !/embed/i.test(id));
  const score = (id) => {
    let s = 0;
    if (/coder|code/i.test(id)) s += 40;
    const b = Number((id.match(/(\d+)b/i) || [])[1] || 0);
    s += Math.min(b, 70);
    if (/a\d+b/i.test(id)) s -= 15;              // MoE: fewer active params than the label suggests
    if (/uncensored|heretic|fusion/i.test(id)) s -= 30;  // tuned for something other than this
    if (/instruct|qat|general/i.test(id)) s += 5;
    return s;
  };
  return usable.sort((a, b) => score(b) - score(a))[0] || null;
}

async function ask(llm, text, maxTokens = 3000) {
  // A model that reasons in `content` spends the budget twice, so the ceiling is generous.
  const r = await chatComplete(llm.provider, { model: llm.model, temperature: 0.2, maxTokens,
    messages: [{ role: 'user', content: text }] });
  // An empty answer whose reasoning survived goes on to the verdict follow-up, as it always did.
  if (!r.ok && !(r.code === 'empty-answer' && r.thinking)) throw new Error(r.error);
  const content = r.ok ? r.text : '';
  const split = splitThinking(content);
  const parsed = parseVerdict(split.answer);
  // Three places reasoning can hide: reasoning_content, a <think> fence, an unfenced preamble. Keep all.
  const thinking = [r.thinking?.trim(), split.thinking, parsed.preamble]
    .filter(Boolean).join('\n\n---\n\n') || null;
  return {
    thinking,
    answer: parsed.answer,
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    // `length` = cut off mid-reply; a budget-truncated verdict is not a declined one.
    truncated: !!r.truncated,
    answeredBy: r.answeredBy,
  };
}

// When the first call yields no verdict, ask a second tiny question (bounded 24 tokens) whose only
// answer IS the verdict, feeding back the model's own reasoning. Two honest failures, never a guess.
async function extractVerdict(llm, reasoning) {
  const tail = String(reasoning || '').slice(-6000);   // the conclusion lives at the end
  if (!tail.trim()) return { verdict: null, confidence: null };
  try {
    const out = await ask(llm, [
      'Below is your own analysis of a static-analysis finding. Read it and answer with ONE line only.',
      'No preamble, no reasoning, no restatement — just the line.',
      '',
      'VERDICT: <real-vulnerability|needs-context|false-positive|already-mitigated>',
      '',
      '--- your analysis ---',
      tail,
    ].join('\n'), 24);
    return { verdict: out.verdict, confidence: out.confidence };
  } catch { return { verdict: null, confidence: null }; }
}

// One chain: ask() + bounded follow-up. Never throws — an engine failure comes back as {error}.
async function runChain(llm, prompt) {
  let out;
  try { out = await ask(llm, prompt); }
  catch (e) { return { error: e.message }; }
  // no verdict in the first reply — ask the bounded follow-up rather than recording a shrug
  let recovered = false;
  if (!out.verdict) {
    const ex = await extractVerdict(llm, out.thinking || out.answer);
    if (ex.verdict) { out.verdict = ex.verdict; out.confidence ||= ex.confidence; recovered = true; }
  }
  return { ...out, recovered };
}

// ── N-CHAIN ADJUDICATION ────────────────────────────────────────────────────────────────────────
// CW_ADJUDICATE_CHAINS sets the FLOOR (default 1); a check whose calibration shows it unreliable
// earns more chains automatically (Math.max(floor, escalated)). Read at call time — a const at
// import would defeat test/operator overrides.
const DEFAULT_CHAINS = 1;
const CALIBRATION_ESCALATED_CHAINS = 3;
const CALIBRATION_MIN_DENOMINATOR = 5;   // fewer adjudicated records than this is noise, not a rate
const CALIBRATION_FALSE_ALARM_THRESHOLD = 0.3;

export function baseChainCount() {
  const raw = process.env.CW_ADJUDICATE_CHAINS;
  if (raw == null || raw === '') return DEFAULT_CHAINS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_CHAINS;
}

// The same corpus --calibrate --json prints, via direct import. null = no calibration signal
// (absent ledger, unreadable journal, corrupt baseline) — chainsFor then falls back to the floor.
function loadCalibration() {
  try {
    const adj = readAdjudications();
    const baseline = readCalibrateBaseline();
    if (baseline && baseline._error) return null;   // a corrupt baseline is not a basis for escalating
    return computeFindingCalibration(adj.records, { windowStart: baseline ? baseline.at : null });
  } catch { return null; }
}

// Escalation keys on the OVERALL rate (standing+delta merged), never delta alone — delta-only
// would fire before there is enough adjudicated history on this model to trust the number.
export function chainsFor(check, model, calibration, base) {
  if (!check || !calibration) return base;
  const node = calibration.checks?.[check]?.[model];
  if (!node || node.denominator < CALIBRATION_MIN_DENOMINATOR) return base;
  const earns = node.falseCleanRate > 0 || node.falseAlarmRate >= CALIBRATION_FALSE_ALARM_THRESHOLD;
  return earns ? Math.max(base, CALIBRATION_ESCALATED_CHAINS) : base;
}

async function runChains(llm, prompt, n) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(await runChain(llm, prompt));
  return results;
}

// Fusion never votes or averages — clean agreement or escalate:
//   any chain error (a partial run is not a majority); verdicts not all equal; or lintPair flags a
//   contradiction on any chain (an agreeing verdict whose reasoning contradicts it).
export function fuseChains(chainResults) {
  if (chainResults.some((c) => c.error)) return { outcome: 'escalate', reason: 'chain-error' };
  const verdicts = chainResults.map((c) => c.verdict);
  const unanimous = verdicts.length > 0 && !!verdicts[0] && verdicts.every((v) => v === verdicts[0]);
  if (!unanimous) return { outcome: 'escalate', reason: 'disagreement' };
  const flagged = chainResults.some(
    (c) => lintPair({ reasoning: c.thinking || c.answer || '', verdict: c.verdict }).contradiction,
  );
  if (flagged) return { outcome: 'escalate', reason: 'lint-flagged' };
  return { outcome: 'unanimous', verdict: verdicts[0] };
}

// Best-effort place-keyed findingKey from the fields an issue carries (source.rule, anchor.file,
// body). A category whose identityFor() tuple reaches past those returns null rather than a wrong
// key that would fragment identity against adjudication-import's row-sourced one; dependency-cve
// is excluded (needs CVE id + package, which an issue does not carry).
export function findingKeyFor(issue, check) {
  if (!check || check === 'dependency-cve' || !issue?.repo) return null;
  const fields = identityFor(check);
  if (!fields) return null;
  const row = {
    rule: issue.source?.rule ?? null, file: issue.anchor?.file ?? null,
    path: issue.anchor?.file ?? null, message: issue.body ?? null,
  };
  if (!fields.every((f) => row[f] != null)) return null;
  try { return findingKeyForScanner(check, issue.repo, row); } catch { return null; }
}

// The finding-adjudication PAYLOAD (pure, so the shape is testable). `truth` is always null: this
// is one model's self-consistency, never ground truth, and must not inflate a calibration rate.
// On escalation `evidence` carries every chain's verdict/confidence/truncated/error only — never
// its free-text answer, which would route raw model prose around redactLedgerFields.
export function buildAdjudicationRecord(issue, check, findingKey, fused, chains, model) {
  const n = chains.length;
  const provenance = fused.outcome === 'unanimous' ? `unanimous(${n})` : `escalation:${fused.reason}(${n})`;
  return {
    findingKey, category: check, repo: issue.repo,
    machineVerdict: fused.outcome === 'unanimous' ? fused.verdict : null,
    humanVerdict: null, truth: null,
    basis: fused.outcome === 'unanimous'
      ? `unanimous verdict across ${n} independent chains, no reasoning-lint flags`
      : `chains did not converge cleanly (${fused.reason}) — see evidence`,
    evidence: JSON.stringify(chains.map((c) => (
      { verdict: c.verdict ?? null, confidence: c.confidence ?? null, truncated: !!c.truncated, error: c.error ?? null }
    ))),
    model, promptId: null, bornSlice: null, provenance,
  };
}

// Who answered, as the record states it. A failed chain has no answer to attribute, so the
// requested model stands in and the engine is the provider that was asked.
export function attribution(answeredBy, model) {
  if (!answeredBy) return { engine: 'lmstudio', model };
  return { engine: answeredBy.engine, model: answeredBy.model || model, host: answeredBy.host };
}

async function main() {
  const localBase = baseUrlFor('lmstudio');
  const chosen = resolveModelProvider({ local: { baseUrl: localBase, engine: 'lmstudio' } });
  if (!chosen.ok) return die(chosen.error);
  const provider = chosen.provider;
  let model = flag('--model', process.env.CW_ISSUE_MODEL) || provider.model;
  if (provider.id === 'local') {
    let models;
    try { models = await listModels(localBase); }
    catch (e) { return die(`LM Studio unreachable at ${localBase} (${e.message}) — is the server running?`, 5); }
    if (has('--list-models')) return say(models.join('\n'));
    model ||= pickModel(models);
    if (!model) return die('no usable chat model in LM Studio');
  } else if (has('--list-models')) {
    return die(`--list-models reads a local server; ${describeProvider(provider)} is configured`);
  }
  const llm = { provider, model };

  const doc = loadIssues();
  const one = flag('--issue', null);
  const area = flag('--area', null);
  const limit = +(flag('--limit', '99')) || 99;
  const targets = one
    ? [doc.issues[one]].filter(Boolean)
    : Object.values(doc.issues)
      .filter((i) => i.state !== 'closed' && (!area || i.area === area))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);
  if (!targets.length) return die(one ? `unknown or closed issue ${one}` : 'nothing open to review');

  say(`model: ${describeProvider(provider, model)}   issues: ${targets.length}   (proposal only — nothing is edited or closed)`);
  const calibration = loadCalibration();
  const base = baseChainCount();
  for (const issue of targets) {
    const started = Date.now();
    const tick = setInterval(() => {
      process.stderr.write(`\r⏳ ${issue.id} — thinking ${Math.floor((Date.now() - started) / 1000)}s `);
    }, 1000);
    const check = checkForIssue(issue);
    const n = chainsFor(check, model, calibration, base);
    const prompt = composeIssuePrompt(issue, { root: CW });

    if (n <= 1) {
      // Single-call path — unchanged when no check earns escalation.
      const chain = await runChain(llm, prompt);
      clearInterval(tick);
      process.stderr.write('\r' + ' '.repeat(60) + '\r');
      if (chain.error) { say(`${issue.id} FAILED: ${chain.error}`); continue; }

      const at = nowISO();
      const by = attribution(chain.answeredBy, model);
      withIssuesLock(() => {
        const d = loadIssues();
        mutateIssue(d, issue.id, (i) => {
          i.llm = { at, ...by, answer: chain.answer, thinking: chain.thinking || null,
            verdict: chain.verdict ?? null, confidence: chain.confidence ?? null, truncated: !!chain.truncated };
        }, 'issue-updated', { llm: { ...by, verdict: chain.verdict ?? null, truncated: !!chain.truncated } }, at);
        saveIssues(d);
      });
      // 'no-verdict' is a real outcome, never a '?' that reads like a parse bug
      const verdict = (chain.verdict ? chain.verdict + (chain.recovered ? '*' : '') : (chain.truncated ? 'TRUNCATED-no-verdict' : 'no-verdict'));
      say(`${issue.id}  ${verdict.padEnd(22)} ${Math.round((Date.now() - started) / 1000)}s  ${chain.thinking ? '(thinking captured)' : ''}`);
      continue;
    }

    // N>1: independent chains, fused (see fuseChains). Escalation still records, with no machine
    // verdict and every chain attached as evidence.
    const chains = await runChains(llm, prompt, n);
    clearInterval(tick);
    process.stderr.write('\r' + ' '.repeat(60) + '\r');
    const fused = fuseChains(chains);
    const rep = chains.find((c) => !c.error) || chains[0];

    const at = nowISO();
    const by = attribution(rep.answeredBy, model);
    withIssuesLock(() => {
      const d = loadIssues();
      mutateIssue(d, issue.id, (i) => {
        i.llm = {
          at, ...by, answer: rep.answer ?? null, thinking: rep.thinking || null,
          verdict: fused.outcome === 'unanimous' ? fused.verdict : null,
          confidence: rep.confidence ?? null, truncated: chains.some((c) => c.truncated),
          adjudication: { chains: n, outcome: fused.outcome, reason: fused.reason ?? null },
        };
      }, 'issue-updated', { llm: { ...by, chains: n, outcome: fused.outcome } }, at);
      saveIssues(d);
    });

    // Machine-attributed EVIDENCE, never a close (same append path as adjudication-import; truth null).
    const findingKey = findingKeyFor(issue, check);
    if (findingKey) {
      const res = appendFindingAdjudication(buildAdjudicationRecord(issue, check, findingKey, fused, chains, model));
      if (!res.ok) say(`${issue.id}  WARNING: finding-adjudication append failed (${res.error})`);
    }

    const label = fused.outcome === 'unanimous' ? `${fused.verdict} [unanimous(${n})]` : `ESCALATED(${fused.reason},${n})`;
    say(`${issue.id}  ${label.padEnd(22)} ${Math.round((Date.now() - started) / 1000)}s`);
  }
}

if (isMainModule(import.meta.url)) await main();

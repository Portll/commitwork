#!/usr/bin/env node
/**
 * bin/rate-llm.mjs — a SECOND rater, so interrater reliability stops being undefined.
 *
 * Both raters see the SAME evidence, so agreement is about what the evidence implies —
 * consistency, not accuracy. The model is never shown the gate's verdict text, any prior label,
 * or that another rater exists. `undecidable` is first-class, a counterfactual is required,
 * temperature is pinned to 0, and `method: lmstudio:<model id>` makes a different model a
 * different rater.
 *
 * usage:
 *   node bin/rate-llm.mjs --limit 5                 dry: judge 5 overlapping decisions, print
 *   node bin/rate-llm.mjs --limit 5 --write         ...and bank them
 *   node bin/rate-llm.mjs --model qwen/qwen3.8-...  when the download finishes
 * env: CW_LLM_URL (default http://127.0.0.1:1234/v1), CW_LLM_MODEL, CW_LLM_TIMEOUT_MS
 */
import { readAdjudications, appendRecord, adjudicationsPath, readJournal, cohortId } from './lib/verdict-journal-core.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const URL_BASE = () => process.env.CW_LLM_URL || 'http://127.0.0.1:1234/v1';
// Overridable; whatever it is ends up on the record.
const MODEL = () => process.env.CW_LLM_MODEL || 'qwen/qwen3.6-35b-a3b';
// Overridable ceiling — a rater cut off mid-thought contributes a failure, not a judgement.
const MAX_TOKENS = () => Number(process.env.CW_LLM_MAX_TOKENS) || 3000;
// Dense local models have needed 400s+; a timeout is only paid when something is already wrong.
const TIMEOUT = () => Number(process.env.CW_LLM_TIMEOUT_MS) || 600_000;

// The ONE definition of the rater's temperature. The call below and the `basis` string written into
// the adjudication ledger both read it, because a basis that HARDCODES "temperature 0" keeps saying
// so after someone changes the call — a claim about evidence that the evidence no longer supports.
// Deliberately not env-overridable: an operator-tunable temperature is an unpinned rater by another
// route, and every judgement it writes is unreproducible.
export const TEMPERATURE = 0;

const SYSTEM = [
  'You are adjudicating whether a software quality gate made the RIGHT CALL on one past decision.',
  '',
  'You are given the evidence the gate had, and WHERE ONE EXISTS an independent re-measurement taken',
  'later at the same commit. Some decisions carry no re-measurement; judge those from the gate record',
  'alone rather than treating the absence as a signal. You are NOT given the gate\'s own wording, and',
  'you are NOT given anyone else\'s conclusion. Decide from the evidence.',
  '',
  'Verdicts:',
  '  true-alarm   — the gate raised an alarm and a real defect was present',
  '  false-alarm  — the gate raised an alarm and nothing was wrong',
  '  true-clean   — the gate stayed quiet and nothing was wrong',
  '  false-clean  — the gate stayed quiet while something WAS wrong (the costly one)',
  '  undecidable  — the evidence cannot settle it. This is a real answer, not a cop-out, and it is',
  '                 the RIGHT answer whenever the evidence is consistent with more than one verdict.',
  '',
  'Rules:',
  '  · A counterfactual is required: name the observation that would have made this the OPPOSITE',
  '    verdict. If you cannot name one, your verdict is a guess and you must answer undecidable.',
  '  · Do not assume a gate is correct because it is a gate.',
  '  · Tests that read machine state outside the commit (a fleet, a filesystem, a network) do not',
  '    reproduce reliably at an old commit; treat a mismatch there as undecidable, not as a verdict.',
  '',
  'Reply with JSON only:',
  '{"truth":"...","why":"one sentence","counterfactual":"...","confidence":"high|medium|low"}',
].join('\n');

/** The evidence, and only the evidence. No verdict text, no prior label, no mention of a peer. */
export function evidenceFor(rec, remeasured) {
  // A missing field is rendered the same way everywhere: COMMIT already said "(none recorded)"
  // while WHEN and GATE interpolated a raw `undefined` into the rater's evidence. Two docs-doctor
  // canary records are synthesised from an artifact and carry neither, so a rater was being shown
  // the string "undefined" as though it were a measurement. Absent is a state; render it as one.
  const or = (v) => (v === undefined || v === null || v === '' ? '(none recorded)' : v);
  const L = [`GATE: ${or(rec.gate)}`, `WHEN: ${or(rec.at)}`, `COMMIT: ${or(rec.headSha)}`];
  if (rec.gate === 'gate-tests') {
    L.push(`The stored floor it compared against: ${rec.baseline?.fail} failing / ${rec.baseline?.pass} passing.`);
    L.push(`What it measured in the working tree: ${rec.fail} failing / ${rec.pass} passing.`);
    if (typeof rec.headFail === 'number') L.push(`What it measured at a pristine checkout of the commit: ${rec.headFail} failing.`);
    if (rec.committed?.length) L.push(`Tests it recorded as failing in COMMITTED code: ${rec.committed.slice(0, 6).join('; ')}`);
    if (rec.names?.length) L.push(`Tests it recorded as failing: ${rec.names.slice(0, 6).join('; ')}`);
  } else if (rec.metrics) {
    L.push(`Stored floor: ${JSON.stringify(rec.baseline)}`);
    L.push(`Measured: ${JSON.stringify(rec.metrics)}`);
  }
  if (remeasured) {
    L.push('', 'INDEPENDENT RE-MEASUREMENT, taken later at that same commit, run twice with agreement required:');
    L.push(`  ${remeasured}`);
  }
  L.push('', 'Did the gate make the right call?');
  return L.join('\n');
}

/** Call the model. Branches on `finish_reason`, not empty content: truncated is reported as
 *  truncated; JSON that arrived in the reasoning channel is SALVAGED and marked. */
export async function ask(evidence, { model = MODEL(), url = URL_BASE(), timeout = TIMEOUT() } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let body;
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        model,
        temperature: TEMPERATURE,  // pinned: an unpinned run is a capability claim it cannot support
        max_tokens: MAX_TOKENS(),
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: evidence }],
      }),
    });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    body = await res.json();
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? `timed out after ${timeout}ms` : String(e.message || e) };
  } finally { clearTimeout(t); }

  const choice = body?.choices?.[0] || {};
  const finish = choice.finish_reason || null;
  const content = choice.message?.content || '';
  const reasoning = choice.message?.reasoning_content || choice.message?.reasoning || '';
  if (finish === 'length' && !content.trim()) {
    return { ok: false, why: `truncated at ${MAX_TOKENS()} tokens with an empty content channel (${reasoning.length} chars of reasoning) — the model was still thinking, so it judged nothing` };
  }
  const parsed = extractJSON(content) || (extractJSON(reasoning) ? { ...extractJSON(reasoning), salvaged: true } : null);
  if (!parsed) return { ok: false, why: `no JSON in either channel (finish=${finish}, content ${content.length}, reasoning ${reasoning.length})` };
  if (!parsed.truth) return { ok: false, why: 'JSON carried no truth field' };
  if (!parsed.counterfactual) return { ok: false, why: 'no counterfactual — by the rules of the ask, that makes the verdict a guess' };
  return { ok: true, finish, ...parsed };
}

/** First balanced {...} in a string. Cheap, and good enough for one object per reply. */
export function extractJSON(s) {
  const i = String(s || '').indexOf('{');
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
    }
  }
  return null;
}

const TRUTHY = new Set(['true-alarm', 'false-alarm', 'true-clean', 'false-clean']);

export { SYSTEM };

/**
 * One entry per DECISION, not per peer record — the re-runnable peer appends duplicates.
 * Same-truth duplicates: latest wins. Differing truths: the decision is DROPPED — an agreement
 * figure needs one peer label, and iteration order must not pick it.
 */
// `anchored` swaps the target population from peer-judged decisions to PLANTED ones, whose label is
// truth by construction rather than another rater's opinion. Without it the pool accepts only
// method:'re-measurement', which is why 9,148 canaries had never entered a cohort.
export function targetPool(adjudications, { anchored = false } = {}) {
  const isTarget = anchored
    ? (r) => r?.canary != null
    : (r) => r?.method === 're-measurement';
  const latest = new Map();
  const contested = new Set();
  for (const r of adjudications) {
    if (!isTarget(r) || !TRUTHY.has(r.truth) || !r.gate || !r.recordAt) continue;
    const k = `${r.gate}@${r.recordAt}`;
    const prev = latest.get(k);
    if (prev && prev.truth !== r.truth) { contested.add(k); continue; }
    if (!prev || String(prev.at) <= String(r.at)) latest.set(k, r);
  }
  for (const k of contested) latest.delete(k);
  return {
    pool: [...latest.values()].sort((a, b) => String(a.recordAt).localeCompare(String(b.recordAt))),
    contested: [...contested],
  };
}

// ── THE MEASUREMENT CHANNEL ──────────────────────────────────────────────────────────────────────
// The peer's `evidence` prose narrates the verdict, so the preferred channel is the structured
// `measurement`; the rater-facing sentence is rendered from its FIELDS in code. Prose crosses only
// through the validating numeric extractor and is re-rendered through the same renderer.

// Verdict-stating phrases judge() writes into prose; swept by bin/test/rate-llm.test.mjs. Grown
// whenever adjudicate-gates grows a new narrated conclusion. Matched case-insensitively.
export const CONCLUSION_PHRASES = [
  // the verdict labels themselves — a prior rater's label is never evidence
  'true-alarm', 'false-alarm', 'true-clean', 'false-clean',
  // the steady/false-clean sentence (the line-399 leak, worst of the set)
  'already present', 'stayed quiet', 'the gate called',
  // the verifiable-stratum sentence
  'correspond to the ones the record named', 'both clean',
  // the attribution sentences
  'unjudgeable', 'as the record said', 'HEAD clean now', 'the record claimed',
  'correspond to ones a record',
  // the docs-doctor sentence
  'matching the recorded verdict', 'read the tree correctly',
];

/** Rater-facing sentence rendered from measurement FIELDS; null for anything malformed. */
export function renderMeasurement(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.docsVerdict !== undefined) {
    return typeof m.docsVerdict === 'string' && m.docsVerdict
      ? `docs-doctor, re-derived from the tree at that same commit, returned: ${m.docsVerdict}` : null;
  }
  const n = (x) => Number.isInteger(x) && x >= 0;
  if (!n(m.fail) || !n(m.floor)) return null;   // a fail count with no floor is not a comparison
  const L = [`the suite, re-run at that same commit, measured ${m.fail} failing${n(m.pass) ? ` / ${m.pass} passing` : ''}, against the stored floor of ${m.floor} failing`];
  // Corroborated names are evidence, not conclusion; the rater draws the correspondence.
  if (Array.isArray(m.corroboratedTests) && m.corroboratedTests.length) {
    L.push(`tests failing in both this re-run and the records taken at the time: ${m.corroboratedTests.slice(0, 6).join('; ')}`);
  }
  return `${L.join('. ')}.`;
}

/** Validating numeric extraction from legacy prose — the only door prose can cross. Never returns
 *  the prose itself; the caller re-renders through renderMeasurement. */
export function extractMeasurement(prose) {
  const s = String(prose || '');
  const docs = /re-derived docs-doctor at [0-9a-f]{7,40}: (green|orange|grey-only)\b/.exec(s);
  if (docs) return { docsVerdict: docs[1] };
  const floorM = /against (?:the|a) floor of (\d+)/.exec(s);
  if (!floorM) return null;                      // no floor anywhere: nothing to compare against
  const floor = Number(floorM[1]);
  const suite = /re-ran the suite at [0-9a-f]{7,40} twice: (\d+) failing, (\d+) passing/.exec(s);
  if (suite) return { floor, fail: Number(suite[1]), pass: Number(suite[2]) };
  const head = /(?:pristine|committed) HEAD (?:at [0-9a-f]{7,40} )?re-measures (\d+) failing/.exec(s);
  if (head) return { floor, fail: Number(head[1]) };
  return null;
}

/** The peer's evidence with its conclusion left behind: structured measurement first, then
 *  validated legacy prose. Null when nothing validates — the caller declines to compare. */
export function peerEvidence(a) {
  const structured = renderMeasurement(a?.measurement);
  if (structured) return structured;
  let prose = a?.evidence ? String(a.evidence) : null;
  if (!prose) {
    // Structural split of the basis string, never phrase-matching.
    const m = /^RE-MEASURED at [0-9a-f]+:\s*([\s\S]*?)\.?\s*Method:/i.exec(String(a?.basis || ''));
    prose = m && m[1].trim() ? m[1].trim() : null;
  }
  if (!prose) return null;
  return renderMeasurement(extractMeasurement(prose));
}

async function main() {
  const args = process.argv.slice(2);
  const at = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const limit = Number(at('--limit') || 5);
  // --models a,b: each model over THE SAME decisions, one model fully before the next
  // (one LM Studio load each).
  const models = (at('--models') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const model = at('--model') || MODEL();

  // Overlap by design: judge decisions another rater has already judged.
  const adj = readAdjudications().records.filter((r) => r?.kind === 'adjudication');
  // Chosen once, before any model runs, ordered by the judged decision's timestamp.
  // --anchored judges PLANTED decisions, so the score is accuracy against a known answer rather
  // than agreement with a peer. bin/rater-accuracy.mjs reads the result.
  const anchored = args.includes('--anchored');
  const { pool, contested } = targetPool(adj, { anchored });
  if (!pool.length) {
    console.log(anchored
      ? 'no planted decisions in the ledger — an anchored cohort needs canaries to have been banked'
      : 'no decisions another rater has judged — nothing to overlap with');
    process.exit(0);
  }
  if (anchored) console.log(`anchored cohort: ${pool.length} planted decision(s) available`);
  if (contested.length) {
    console.log(`${contested.length} decision(s) dropped: the peer judged them more than once and disagreed with itself —`);
    console.log('  a decision whose own peer label is contested cannot serve as an agreement target.');
  }

  const byGate = {};
  for (const g of new Set(pool.map((t) => t.gate))) {
    try { byGate[g] = new Map(readJournal(g).records.filter((r) => r?.at).map((r) => [r.at, r])); }
    catch { byGate[g] = new Map(); }
  }

  // --dump makes parity an artifact: unreachable raters get the exact SYSTEM text and evidence
  // blocks the HTTP raters see.
  const dump = at('--dump');
  if (dump) {
    // --redact replaces each sha with a stable pseudonym so a filesystem-holding rater cannot look
    // the peer's verdict up. Keyed on the shas this corpus contains, never a hex-shaped pattern —
    // /[0-9a-f]{7,}/ eats English words like `defaced` out of test names.
    const redact = args.includes('--redact');
    const aliases = new Map();                    // sha7 -> pseudonym, stable across every occurrence
    // The timestamp is the other lookup key (an adjudication names its decision by recordAt), so
    // WHEN: is aliased too, in first-seen order.
    const stamps = new Map();
    const scrub = (s) => {
      let out = String(s);
      if (!redact) return out;
      for (const [sha7, name] of aliases) out = out.replace(new RegExp(`${sha7}[0-9a-f]*`, 'g'), name);
      out = out.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, (m) => {
        if (!stamps.has(m)) stamps.set(m, `time-${String(stamps.size + 1).padStart(2, '0')}`);
        return stamps.get(m);
      });
      return out;
    };
    const learn = (sha) => {
      const s = String(sha || '').toLowerCase();
      if (!/^[0-9a-f]{7,40}$/.test(s)) return;
      const k = s.slice(0, 7);                    // a short sha and its full form must alias alike
      if (!aliases.has(k)) aliases.set(k, `commit-${String(aliases.size + 1).padStart(2, '0')}`);
    };
    const items = [];
    const skipped = [];
    for (const t of pool.slice(0, limit)) {
      // A PLANTED decision is never in the live journal — its scenario journal is deleted when the
      // scenario ends — so the record rides on the adjudication itself. Live decisions still resolve
      // from the journal first; the embedded copy is a fallback, never an override.
      const rec = byGate[t.gate]?.get(t.recordAt) ?? t.record ?? null;
      if (!rec) { skipped.push({ gate: t.gate, recordAt: t.recordAt, why: t.canary != null ? 'planted decision banked without its record (pre-dates the embed; re-run the canary harness)' : 'decision not in the journal' }); continue; }
      // A planted target has no peer re-measurement and needs none: evidenceFor renders the gate
      // record alone. Its own basis narrates the outcome, so it is never shown.
      const numbers = peerEvidence(t);
      if (!numbers && !anchored) { skipped.push({ gate: t.gate, recordAt: t.recordAt, why: "peer's evidence unrecoverable" }); continue; }
      learn(rec.headSha);
      for (const m of `${numbers} ${rec.headSha || ''}`.matchAll(/\b[0-9a-f]{7,40}\b/g)) learn(m[0]);
      items.push({ id: `${t.gate}@${t.recordAt}`, gate: t.gate, recordAt: t.recordAt,
        ...(anchored ? { anchored: true, canary: t.canary } : {}),
        prompt: evidenceFor(rec, numbers) });
    }
    // Scrubbed after the whole corpus is read, so a sha first seen late is redacted everywhere.
    for (const it of items) it.prompt = scrub(it.prompt);
    const { writeFileSync } = await import('node:fs');
    // The asked-set stamped on the artifact as a cohort id; --ingest requires it back (--asked).
    writeFileSync(dump, JSON.stringify({
      v: 1, system: SYSTEM, redacted: redact, aliasCount: aliases.size, anchored,
      cohort: cohortId(items.map((i) => i.id)), cohortSize: items.length, items, skipped,
    }, null, 2));
    console.log(`${items.length} evidence blocks + the system prompt → ${dump}${skipped.length ? ` (${skipped.length} skipped)` : ''}`);
    console.log(`cohort ${cohortId(items.map((i) => i.id)) || '(empty)'} over ${items.length} decision(s) — pass this file back as --asked when ingesting`);
    console.log(redact
      ? `commit identifiers replaced by ${aliases.size} stable pseudonyms — every count and test name intact, the lookup key gone`
      : 'Every rater judging from this file has seen the same bytes as every rater judging over HTTP.');
    process.exit(0);
  }

  // --ingest banks a rater that could not be reached over HTTP; everything that differs about how
  // the verdicts were produced goes ON THE RECORD.
  const ingest = at('--ingest');
  if (ingest) {
    const rater = at('--rater');
    if (!rater) { console.error('--ingest needs --rater <name>: an unnamed rater cannot be compared with anything'); process.exit(1); }
    const { readFileSync } = await import('node:fs');
    // The asked-set is required and cannot be recovered from the answers (a self-selected
    // denominator). Recomputed from the artifact's items; refused if it contradicts its stored cohort.
    const askedPath = at('--asked');
    if (!askedPath) {
      console.error('--ingest needs --asked <dump.json> (the artifact this rater judged from): the cohort — the set of');
      console.error('decisions ASKED — cannot be recovered from the answers, and without it coverage regresses to a proxy.');
      process.exit(1);
    }
    let askedDoc;
    try { askedDoc = JSON.parse(readFileSync(askedPath, 'utf8')); }
    catch (e) { console.error(`could not read --asked ${askedPath}: ${e.message}`); process.exit(1); }
    const askedIds = (askedDoc?.items || []).map((i) => i?.id).filter(Boolean);
    if (!askedIds.length) { console.error(`--asked ${askedPath} carries no items — an empty asked-set asks nothing`); process.exit(1); }
    const cohort = cohortId(askedIds);
    if (askedDoc.cohort && askedDoc.cohort !== cohort) {
      console.error(`--asked ${askedPath} claims cohort ${askedDoc.cohort} but its own items hash to ${cohort} — the artifact was edited after it was dumped; refusing`);
      process.exit(1);
    }
    const askedSet = new Set(askedIds);
    const cohortSize = askedSet.size;
    let verdicts;
    try { verdicts = JSON.parse(readFileSync(ingest, 'utf8')); }
    catch (e) { console.error(`could not read ${ingest}: ${e.message}`); process.exit(1); }
    if (!Array.isArray(verdicts)) { console.error('expected a JSON array of verdicts'); process.exit(1); }
    const byId = new Map(pool.map((t) => [`${t.gate}@${t.recordAt}`, t]));
    let agreed = 0; let n = 0; let undec = 0; const unknown = [];
    const toWrite = [];
    const abstained = [];
    for (const v of verdicts) {
      if (!v?.id || !askedSet.has(v.id)) { unknown.push(`${v?.id} (not in the asked-set — nobody gave this rater that decision)`); continue; }
      const t = byId.get(v.id);
      // Asked at dump time, but the pool moved since — named as its own state.
      if (!t) { unknown.push(`${v?.id} (asked at dump time, but the target pool has moved since — not comparable now)`); continue; }
      // An abstention is banked as its own kind — dropping it silently flatters agreement.
      if (v.truth === 'undecidable') { undec++; abstained.push({ v, t }); continue; }
      if (!TRUTHY.has(v.truth)) { unknown.push(`${v.id} (truth=${v.truth})`); continue; }
      if (!v.counterfactual) { unknown.push(`${v.id} (no counterfactual — by the rules of the ask, a guess)`); continue; }
      n++; if (v.truth === t.truth) agreed++;
      toWrite.push({ v, t });
    }
    console.log(`${rater}: ${agreed}/${n} agreed with the peer · ${undec} undecidable · ${unknown.length} unusable`);
    for (const u of unknown.slice(0, 8)) console.log(`  unusable: ${u}`);
    if (!args.includes('--write')) { console.log('  dry run — nothing written.'); process.exit(0); }
    for (const { v, t } of toWrite) {
      const w = appendRecord(adjudicationsPath(), {
        v: 1, kind: 'adjudication', at: new Date().toISOString(),
        gate: t.gate, recordAt: t.recordAt, truth: v.truth,
        // Same stamp on both kinds and in BOTH writers.
        cohort, cohortSize,
        basis: `LLM RATER (${rater}), judged from the same evidence blocks as every other rater `
          + `(bin/rate-llm.mjs --dump --redact), with the gate's own verdict and every prior judgement withheld: `
          + `${v.why} COUNTERFACTUAL: ${v.counterfactual}`,
        adjudicatedBy: rater,
        method: rater,
        // The instrument, stated: batched, pseudonymised — a real divergence from the HTTP raters.
        instrument: { batched: true, identifiersRedacted: true, evidence: 'rate-llm --dump --redact' },
        ...(v.confidence ? { confidence: v.confidence } : {}),
      });
      if (!w.ok) { console.error(`  ledger write FAILED: ${w.error}`); process.exit(1); }
    }
    for (const { v, t } of abstained) {
      const w = appendRecord(adjudicationsPath(), {
        v: 1, kind: 'adjudication-abstention', at: new Date().toISOString(),
        gate: t.gate, recordAt: t.recordAt,
        cohort, cohortSize,
        reason: `${v.why || '(none given)'}${v.counterfactual ? ` COUNTERFACTUAL: ${v.counterfactual}` : ''}`,
        adjudicatedBy: rater,
        method: rater,
        instrument: { batched: true, identifiersRedacted: true, evidence: 'rate-llm --dump --redact' },
        ...(v.confidence ? { confidence: v.confidence } : {}),
      });
      if (!w.ok) { console.error(`  abstention write FAILED: ${w.error}`); process.exit(1); }
    }
    console.log(`  ${toWrite.length} verdicts + ${abstained.length} abstentions banked as rater ${rater}`);
    if (abstained.length) {
      console.log(`  The abstentions are recorded as a separate kind so they stay OUT of the agreement`);
      console.log(`  denominator while remaining visible: ${rater} declined ${abstained.length} of ${abstained.length + n},`);
      console.log(`  and an agreement rate quoted without that number is quoted over a cohort it selected.`);
    }
    process.exit(0);
  }

  const roster = models.length ? models : [model];
  const summary = [];
  for (const m of roster) {
    const judged = await judgeWith(m, pool, byGate, limit, args.includes('--write'), anchored);
    summary.push({ model: m, ...judged });
  }
  if (roster.length > 1) {
    console.log('\n  ── across models ──');
    for (const s of summary) {
      console.log(`  ${s.model.padEnd(26)} ${s.agreed}/${s.n} agreed with the peer · ${s.undec} undecidable · ${s.failed} unusable`);
    }
    console.log('  Same decisions, same evidence, different model. Where two models agree with each other');
    console.log('  AND with the peer, the judgement is at least reproducible across instruments; where they');
    console.log('  split, the decision is genuinely ambiguous and is worth a human rather than a fourth model.');
  }
  process.exit(0);
}

/** One model over the shared target set. Returns its tally; writes only when told to. */
// `anchored` is a PARAMETER, not a closure read: judgeWith is defined outside main, so reading
// main's local threw ReferenceError on the first real run — a branch no test enters, because
// judgeWith needs a live model. The caller owns the flag; this function must be told.
async function judgeWith(model, pool, byGate, limit, write, anchored = false) {
  const adj = readAdjudications().records.filter((r) => r?.kind === 'adjudication');
  const mine = new Set(adj.filter((r) => r.method === `lmstudio:${model}`).map((r) => `${r.gate}@${r.recordAt}`));
  const targets = pool.filter((t) => !mine.has(`${t.gate}@${t.recordAt}`));
  // An anchored cohort is PLANTED, not peer-judged. Printing "decisions another rater has judged"
  // over truth-by-construction describes the wrong provenance for the number that follows.
  console.log(`\n${model} · judging ${Math.min(limit, targets.length)} of ${pool.length} `
    + `${anchored ? 'planted decisions (truth by construction)' : 'decisions another rater has judged'}`
    + (mine.size ? ` (${mine.size} already judged by this model)` : '') + '\n');
  const out = [];
  // Asked-set of this run: only decisions actually PRESENTED (a SKIP was never asked; a failed
  // ask was). Hashed after the loop and stamped on every record this run banks.
  const asked = [];
  let failed = 0;
  for (const t of targets.slice(0, limit)) {
    // Same fallback as the --dump path: a planted decision carries its own record (see targetPool).
    const rec = byGate[t.gate]?.get(t.recordAt) ?? t.record ?? null;
    if (!rec) { console.log(`  SKIP ${t.gate}@${t.recordAt} — ${t.canary != null ? 'planted decision banked without its record; re-run bin/canary-harness.mjs --write' : 'the judged decision is not in the journal'}`); continue; }
    const numbers = peerEvidence(t);
    // Both raters see the same evidence or they are not compared: skipping costs one data point;
    // not skipping poisons the statistic.
    // An ANCHORED target has no peer and needs none — its label is truth by construction, so the
    // gate record alone is the evidence. Requiring peer numbers here skipped every planted decision
    // and was the second half of the same defect as the journal lookup above; --dump already
    // guarded this way (see the `!numbers && !anchored` line) and this path did not.
    if (!numbers && !anchored) {
      console.log(`  SKIP ${t.gate}@${t.recordAt} — could not recover the peer's evidence, and a rater shown less evidence is not a second opinion`);
      continue;
    }
    asked.push(`${t.gate}@${t.recordAt}`);
    const r = await ask(evidenceFor(rec, numbers), { model });
    if (!r.ok) { failed++; console.log(`  FAIL ${t.gate}@${t.recordAt} — ${r.why}`); continue; }
    const agree = r.truth === t.truth;
    console.log(`  ${agree ? 'agree   ' : 'DIFFER  '} ${t.recordAt}  llm=${String(r.truth).padEnd(12)} peer=${String(t.truth).padEnd(12)} conf=${r.confidence || '?'}${r.salvaged ? ' [salvaged from reasoning]' : ''}`);
    if (!agree) console.log(`            why: ${String(r.why).slice(0, 150)}`);
    out.push({ t, r });
  }

  const agreed = out.filter(({ t, r }) => r.truth === t.truth).length;
  const undec = out.filter(({ r }) => r.truth === 'undecidable').length;
  console.log(`\n  ${agreed}/${out.length} agreed · ${undec} undecidable · ${failed} unusable`);
  console.log('  Agreement here is about what the evidence IMPLIES — both raters saw the same numbers.');
  console.log('  It is consistency, not accuracy: two raters can agree and both be wrong.');

  const cohort = cohortId(asked);
  const cohortSize = asked.length;
  console.log(`  cohort ${cohort || '(nothing asked)'} — ${cohortSize} decision(s) presented to this model in this run`);

  if (!write) { console.log('  dry run — nothing written.'); return { n: out.length, agreed, undec, failed }; }
  for (const { t, r } of out) {
    // Abstentions are banked here too — both writers of this corpus must agree a decline is data.
    if (r.truth === 'undecidable') {
      const w = appendRecord(adjudicationsPath(), {
        v: 1, kind: 'adjudication-abstention', at: new Date().toISOString(),
        gate: t.gate, recordAt: t.recordAt,
        // Same stamp as the --ingest writer.
        ...(cohort ? { cohort, cohortSize } : {}),
        reason: `${r.why || '(none given)'}${r.counterfactual ? ` COUNTERFACTUAL: ${r.counterfactual}` : ''}`,
        adjudicatedBy: `lmstudio:${model}`,
        method: `lmstudio:${model}`,
        ...(r.confidence ? { confidence: r.confidence } : {}),
      });
      if (!w.ok) { console.error(`  abstention write FAILED: ${w.error}`); process.exit(1); }
      continue;
    }
    const w = appendRecord(adjudicationsPath(), {
      v: 1, kind: 'adjudication', at: new Date().toISOString(),
      gate: t.gate, recordAt: t.recordAt, truth: r.truth,
      ...(cohort ? { cohort, cohortSize } : {}),
      basis: `LLM RATER (${model}, temperature ${TEMPERATURE}), judged from evidence with the gate's own verdict and every prior judgement withheld: ${r.why} COUNTERFACTUAL: ${r.counterfactual}`
        + (r.salvaged ? ' [JSON salvaged from the reasoning channel — the content channel was empty]' : ''),
      adjudicatedBy: `lmstudio:${model}`,
      method: `lmstudio:${model}`,
      ...(r.confidence ? { confidence: r.confidence } : {}),
      ...(r.salvaged ? { salvaged: true } : {}),
    });
    if (!w.ok) { console.error(`  ledger write FAILED: ${w.error}`); process.exit(1); }
  }
  console.log(`  ${out.filter(({ r }) => r.truth !== 'undecidable').length} banked as rater lmstudio:${model}`);
  return { n: out.length, agreed, undec, failed };
}

if (isMainModule(import.meta.url)) main();

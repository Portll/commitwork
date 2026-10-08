// commitwork — turn-recorder-core: what a session's transcript SAYS happened in each turn, pure.
// bin/turn-recorder.mjs keeps the I/O. Every function here is total in its arguments.
//
// WHY THE TRANSCRIPT AND NOT THE AGENT'S OWN REPORT. The failure taxonomy's false-progress family
// (W1–W6) and most of K/L are tier T2 on the SESS substrate: the predicate is deterministic and
// nothing is writing the evidence down. The one record that already exists is the harness-written
// transcript, and its decisive property is that the judged agent does not author it — it cannot
// edit its own transcript mid-turn to change what a predicate reads. A gate fed by an agent's
// self-report is self-adjudication (G12); a gate fed by the transcript has a second witness by
// construction.
//
// WHAT THIS FILE REFUSES TO DO. It does not decide that a session misbehaved. It reports what the
// turn contained — tool calls, tokens, claim words, witnesses — and leaves the verdict to a caller
// that can be tested against planted truth (bin/canary-harness.mjs). Separating the reading from
// the ruling is what let gate-ratchet's attribution claim become unit-testable, and the same split
// applies here.

/** An entry we could not parse is NEVER dropped. Absence and corruption are different states. */
export function parseTranscript(text) {
  const lines = String(text ?? '').split('\n');
  const steps = [];
  let unparseable = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { unparseable += 1; continue; }
    if (obj && typeof obj === 'object') steps.push(obj);
  }
  return { steps, unparseable };
}

/**
 * What kind of record is this?
 *
 * `user` covers BOTH a person's prompt and a tool result — the harness reuses the role. Telling
 * them apart is load-bearing: a turn boundary is a real prompt, and counting tool results as
 * prompts would split one turn into a dozen and make every report-loop run look like length 1.
 */
export function classifyEntry(e) {
  if (!e || typeof e !== 'object') return 'other';
  if (e.type === 'assistant') return 'assistant';
  if (e.type !== 'user') return 'other';
  const c = e.message?.content;
  if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) return 'tool-result';
  return 'user-prompt';
}

/** Tokens for one assistant step. Missing is null (UNKNOWN), never 0 — a zero would sum silently. */
export function stepTokens(e) {
  const u = e?.message?.usage;
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? v : null);
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheCreation: n(u.cache_creation_input_tokens),
    thinking: n(u.output_tokens_details?.thinking_tokens),
  };
}

const addNullable = (a, b) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

/** Sum token records, preserving UNKNOWN: all-null stays null rather than collapsing to 0. */
export function sumTokens(list) {
  const keys = ['input', 'output', 'cacheRead', 'cacheCreation', 'thinking'];
  const out = Object.fromEntries(keys.map((k) => [k, null]));
  for (const t of list) {
    if (!t) continue;
    for (const k of keys) out[k] = addNullable(out[k], t[k]);
  }
  return out;
}

/** Content blocks of a given type, tolerant of a string body (the harness emits both shapes). */
function blocks(e, type) {
  const c = e?.message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((b) => b?.type === type);
}

export const toolCallsOf = (e) => blocks(e, 'tool_use').map((b) => b?.name).filter((n) => typeof n === 'string');

export function textOf(e) {
  const c = e?.message?.content;
  if (typeof c === 'string') return c;
  return blocks(e, 'text').map((b) => (typeof b.text === 'string' ? b.text : '')).join('\n');
}

/**
 * Fold steps into turns. A turn opens at a user PROMPT and holds every assistant step and tool
 * result until the next prompt.
 *
 * Identity is (sessionId, openedByUuid) — a uuid the harness assigned, never an index into a file.
 * Keying on position would make an inserted record renumber every turn after it, converting an
 * unrelated append into a state change for every consumer. That is the line-number identity defect
 * this repository refuses everywhere else, in its transcript-shaped form.
 */
// A TRANSPORT failure, not a decision. The permission stream breaking is ambiguous between "the
// operator declined" and "the channel died", and six sessions in the 2026-09-06 survey collapsed it
// to declined and went silent — twice leaving the working tree mid-edit with no record of what was
// unverified. Matched on the tool_result text because that is where the harness reports it.
const TRANSPORT_ABORT = /\b(?:aborterror|tool permission stream|stream closed before response|econnreset|etimedout|socket hang ?up)\b/i;

export function isTransportAbort(entry) {
  const c = entry?.message?.content;
  if (!Array.isArray(c)) return false;
  return c.some((b) => {
    if (b?.type !== 'tool_result') return false;
    const s = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
    return TRANSPORT_ABORT.test(s);
  });
}

export function foldTurns(steps) {
  const turns = [];
  let cur = null;
  const open = (e) => ({
    openedByUuid: e?.uuid ?? null,
    sessionId: e?.sessionId ?? null,
    at: e?.timestamp ?? null,
    assistantSteps: 0,
    toolCalls: [],
    toolResults: 0,
    tokens: [],
    texts: [],
    transportAborts: 0,
    callsAfterAbort: 0,
  });
  for (const e of steps) {
    const kind = classifyEntry(e);
    if (kind === 'user-prompt') {
      if (cur) turns.push(cur);
      cur = open(e);
      continue;
    }
    // Steps before the first prompt (a resumed transcript, a system preamble) still belong to a
    // turn. Dropping them would silently shrink the denominator of every rate computed from this.
    if (!cur) cur = open(e);
    if (kind === 'assistant') {
      cur.assistantSteps += 1;
      const calls = toolCallsOf(e);
      if (cur.transportAborts > 0) cur.callsAfterAbort += calls.length;
      cur.toolCalls.push(...calls);
      cur.tokens.push(stepTokens(e));
      const t = textOf(e);
      if (t.trim()) cur.texts.push(t);
    } else if (kind === 'tool-result') {
      cur.toolResults += 1;
      // Reset, never accumulate: the question is whether the LAST abort was read back. A turn that
      // recovered from an early abort and then died on a later one has an unread abort, and a
      // running total would score it as read — the flattering direction.
      if (isTransportAbort(e)) { cur.transportAborts += 1; cur.callsAfterAbort = 0; }
    }
  }
  if (cur) turns.push(cur);
  return turns.map((t) => {
    const tokens = sumTokens(t.tokens);
    return {
      openedByUuid: t.openedByUuid,
      // NOT A WORKER IDENTITY. sessionId names a CONVERSATION: measured 2026-09-06 on this fleet,
      // one transcript id was held by two live processes at once (pids 99699 and 76259), each
      // listed separately and each answering to a different name. Anything that must address a
      // WORKER joins this to the spine session record, which binds pid and pid_start. Carried here
      // so a consumer cannot mistake it for the unique handle it looks like.
      sessionId: t.sessionId,
      at: t.at,
      assistantSteps: t.assistantSteps,
      toolCalls: t.toolCalls,
      toolCallCount: t.toolCalls.length,
      toolResults: t.toolResults,
      transportAborts: t.transportAborts,
      callsAfterAbort: t.callsAfterAbort,
      tokens,
      // Did the MODEL produce this turn? The harness writes assistant-shaped records of its own —
      // "No response requested.", a usage-limit notice — with every usage field zero. Measured on a
      // real 2,872-step transcript: three such turns, one of them "You've hit your session limit",
      // and the report-loop predicate counted two of them as a rumination run. That is a false
      // alarm about a session that was CUT OFF, which is close to the opposite of the defect.
      // Output tokens are the discriminator because a model turn that emitted text cannot have zero.
      //
      // STRICTLY `=== 0`, AND THE STRICTNESS IS THE POINT. Two other states look like zero here and
      // are not it: a turn with NO assistant step (a prompt nothing answered yet) and a step whose
      // usage block is ABSENT (unknown). An earlier draft wrote `(output ?? 0) === 0` and swept both
      // into "harness-authored", which silently removed them from every denominator — absence
      // rendered as a known quantity, in the file whose whole purpose is refusing that. Caught by
      // two existing tests within a minute of the change.
      modelAuthored: !(t.assistantSteps > 0 && tokens.output === 0),
      text: t.texts.join('\n'),
    };
  });
}

// Words that assert a checked outcome. Deliberately NOT a misconduct list: the word is the
// TRIGGER, and the missing witness is the finding. A gate that blocked on vocabulary alone would
// be evadable by paraphrase and would punish honest prose, so nothing here is a verdict on its own.
export const CLAIM_PATTERNS = [
  /\bverified\b/i, /\bconfirmed\b/i, /\ball tests? pass(?:es|ed|ing)?\b/i,
  /\bsuite (?:is )?green\b/i, /\bcommitted\b/i, /\blanded\b/i, /\bre-?ran\b/i,
];

export const claimWordsIn = (text) => CLAIM_PATTERNS.filter((re) => re.test(String(text ?? ''))).map((re) => re.source);

/**
 * A turn asserting a checked outcome with nothing in it that could have done the checking.
 *
 * The witness is a tool call or a tool result IN THE SAME TURN. Prior turns do not count and the
 * asymmetry is deliberate: "I verified it" about a measurement three turns ago is exactly the
 * stale-reading failure this repo has recorded repeatedly, so a live claim needs live evidence.
 * Returns a REPORT, not a ruling — `witnessed` false is a fact about the turn; whether that blocks
 * is the caller's policy.
 */
export function claimWitness(turn) {
  const words = claimWordsIn(turn?.text);
  if (words.length === 0) return { claimed: false, witnessed: null, words: [] };
  const witnessed = (turn?.toolCallCount ?? 0) > 0 || (turn?.toolResults ?? 0) > 0;
  return { claimed: true, witnessed, words };
}

/**
 * Maximal runs of consecutive turns that produced text and called no tool.
 *
 * W3 (report loop) and W2 (handoff reflex) are both this shape. A single toolless turn is normal —
 * answering a question is not a defect — so the signal is the RUN, and the run length is reported
 * rather than compared to a threshold here. Empty turns (no text, no tools) break a run instead of
 * extending it: a turn that said nothing is not evidence of reporting instead of working.
 */
export function reportLoopRuns(turns) {
  const list = Array.isArray(turns) ? turns : [];
  // Harness-authored turns are TRANSPARENT: they neither extend a run nor break one. Extending is
  // the false alarm measured above; breaking would be the mirror defect, letting an injected notice
  // hide a real run of rumination that continued straight through it. They are excluded from the
  // population rather than assigned to either side of it, and counted separately by tokenSummary.
  const model = list.map((t, i) => ({ t, i })).filter(({ t }) => t?.modelAuthored !== false);
  const runs = [];
  let start = -1;
  const isToolless = (t) => (t?.toolCallCount ?? 0) === 0 && String(t?.text ?? '').trim().length > 0;
  for (let k = 0; k <= model.length; k++) {
    if (k < model.length && isToolless(model[k].t)) { if (start === -1) start = k; continue; }
    if (start !== -1) {
      runs.push({
        from: model[start].i,
        to: model[k - 1].i,
        length: k - start,
        openedByUuid: model[start].t?.openedByUuid ?? null,
      });
      start = -1;
    }
  }
  return runs;
}

/**
 * Token efficiency with its denominators attached. A rate whose denominator is not on the page is
 * the false-measurement family's headline defect, so every ratio here ships beside its counts and
 * is null — not 0 — when the denominator is absent or zero.
 */
export function tokenSummary(turns) {
  const all = Array.isArray(turns) ? turns : [];
  // Harness-authored turns are reported, then excluded from every rate. Leaving them in the
  // denominator would quietly flatter every efficiency number by adding free turns.
  const synthetic = all.filter((t) => t?.modelAuthored === false).length;
  const list = all.filter((t) => t?.modelAuthored !== false);
  const totals = sumTokens(list.map((t) => t.tokens));
  const toolless = list.filter((t) => (t.toolCallCount ?? 0) === 0 && String(t.text ?? '').trim());
  const tokenless = list.filter((t) => t.tokens && t.tokens.output === null).length;
  const ratio = (num, den) => (den === null || den === 0 || num === null ? null : num / den);
  const tollessOut = sumTokens(toolless.map((t) => t.tokens)).output;
  return {
    turns: list.length,
    syntheticTurns: synthetic,
    turnsWithoutTools: toolless.length,
    turnsWithoutUsage: tokenless,
    totals,
    // output tokens spent in turns that called no tool, over all output tokens
    ruminationShare: ratio(tollessOut, totals.output),
    // cache reads over all input the model was charged for reading
    cacheHitRatio: ratio(totals.cacheRead, addNullable(totals.cacheRead, addNullable(totals.input, totals.cacheCreation))),
    outputPerTurn: ratio(totals.output, list.length),
  };
}

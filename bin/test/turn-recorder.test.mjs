import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTranscript, classifyEntry, stepTokens, sumTokens, toolCallsOf, textOf,
  foldTurns, claimWitness, reportLoopRuns, tokenSummary,
} from '../lib/turn-recorder-core.mjs';

const asst = (over = {}) => ({
  type: 'assistant', uuid: 'a1', sessionId: 's', timestamp: '2026-09-06T00:00:00Z',
  message: { content: [], usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens_details: { thinking_tokens: 3 } } },
  ...over,
});
const prompt = (uuid = 'p1') => ({ type: 'user', uuid, sessionId: 's', timestamp: '2026-09-06T00:00:00Z', message: { content: 'do the thing' } });
const toolResult = () => ({ type: 'user', uuid: 'r1', message: { content: [{ type: 'tool_result', content: 'ok' }] } });
const say = (text) => asst({ message: { ...asst().message, content: [{ type: 'text', text }] } });
const call = (name) => asst({ message: { ...asst().message, content: [{ type: 'tool_use', name, input: {} }] } });

describe('parseTranscript — corruption is counted, never dropped silently', () => {
  test('an unparseable line is REPORTED, not skipped into a smaller denominator', () => {
    const { steps, unparseable } = parseTranscript('{"type":"assistant"}\nnot json\n{"type":"user"}');
    assert.equal(steps.length, 2);
    assert.equal(unparseable, 1, 'a dropped line would shrink every rate computed from this');
  });
  test('empty input is empty, and is not an error', () => {
    assert.deepEqual(parseTranscript(''), { steps: [], unparseable: 0 });
    assert.deepEqual(parseTranscript(null), { steps: [], unparseable: 0 });
  });
});

describe('classifyEntry — a tool result is NOT a user prompt', () => {
  test('the two user-role shapes are told apart', () => {
    assert.equal(classifyEntry(prompt()), 'user-prompt');
    assert.equal(classifyEntry(toolResult()), 'tool-result');
    assert.equal(classifyEntry(asst()), 'assistant');
    assert.equal(classifyEntry({ type: 'system' }), 'other');
    assert.equal(classifyEntry(null), 'other');
  });
  test('conflating them would split one turn into many — the load-bearing case', () => {
    const turns = foldTurns([prompt(), call('Bash'), toolResult(), call('Bash'), toolResult(), say('done')]);
    assert.equal(turns.length, 1, 'tool results must not open turns');
    assert.equal(turns[0].toolCallCount, 2);
    assert.equal(turns[0].toolResults, 2);
  });
});

describe('tokens — missing is UNKNOWN, never zero', () => {
  test('a step with no usage block reads null, not a zero that sums silently', () => {
    assert.equal(stepTokens({ message: {} }), null);
    assert.equal(stepTokens(null), null);
  });
  test('summing all-null preserves null rather than collapsing to 0', () => {
    assert.deepEqual(sumTokens([null, null]), { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null });
  });
  test('a real step reads every field', () => {
    assert.deepEqual(stepTokens(asst()), { input: 1, output: 10, cacheRead: 5, cacheCreation: 2, thinking: 3 });
  });
  test('one known value among unknowns still sums', () => {
    assert.equal(sumTokens([null, stepTokens(asst())]).output, 10);
  });
});

describe('content extraction', () => {
  test('tool names and text come off the blocks', () => {
    assert.deepEqual(toolCallsOf(call('Edit')), ['Edit']);
    assert.equal(textOf(say('hello')), 'hello');
  });
  test('a string content body is tolerated (the harness emits both shapes)', () => {
    assert.equal(textOf({ message: { content: 'plain' } }), 'plain');
  });
  test('a malformed block does not throw', () => {
    assert.deepEqual(toolCallsOf({ message: { content: [{ type: 'tool_use' }] } }), []);
  });
});

describe('foldTurns — identity is a uuid, never a position', () => {
  test('turns open at prompts and carry the opening uuid', () => {
    const turns = foldTurns([prompt('p1'), say('a'), prompt('p2'), call('Bash')]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].openedByUuid, 'p1');
    assert.equal(turns[1].openedByUuid, 'p2');
  });
  test('an inserted record does not renumber the identity of later turns', () => {
    const before = foldTurns([prompt('p1'), say('a'), prompt('p2'), say('b')]);
    const after = foldTurns([prompt('p0'), say('x'), prompt('p1'), say('a'), prompt('p2'), say('b')]);
    assert.deepEqual(before.map((t) => t.openedByUuid), ['p1', 'p2']);
    assert.deepEqual(after.map((t) => t.openedByUuid), ['p0', 'p1', 'p2'],
      'a positional key would have made every later turn a different turn');
  });
  test('steps before the first prompt are kept, not dropped', () => {
    const turns = foldTurns([say('resumed mid-session'), prompt('p1'), say('a')]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].openedByUuid, 'a1');
  });
});

describe('claimWitness — the word triggers, the missing witness is the finding', () => {
  test('a claim with no tool call and no tool result is unwitnessed', () => {
    const [t] = foldTurns([prompt(), say('I verified the suite passes.')]);
    const w = claimWitness(t);
    assert.equal(w.claimed, true);
    assert.equal(w.witnessed, false);
  });
  test('the same claim WITH a tool call in the same turn is witnessed', () => {
    const [t] = foldTurns([prompt(), call('Bash'), toolResult(), say('I verified the suite passes.')]);
    assert.equal(claimWitness(t).witnessed, true);
  });
  test('a turn making no claim is not judged at all — witnessed is null, not false', () => {
    const [t] = foldTurns([prompt(), say('Here is what I think the design should be.')]);
    assert.deepEqual(claimWitness(t), { claimed: false, witnessed: null, words: [] });
  });
  test('evidence from a PREVIOUS turn does not witness this one', () => {
    const turns = foldTurns([prompt('p1'), call('Bash'), toolResult(), prompt('p2'), say('confirmed, all tests pass')]);
    assert.equal(claimWitness(turns[1]).witnessed, false, 'a stale reading must not witness a live claim');
  });
});

describe('reportLoopRuns — the run is the signal, not one turn', () => {
  test('a single toolless turn is a run of one, and the caller decides if that matters', () => {
    const turns = foldTurns([prompt('p1'), say('an answer')]);
    assert.deepEqual(reportLoopRuns(turns).map((r) => r.length), [1]);
  });
  test('consecutive toolless turns accumulate; a working turn breaks the run', () => {
    const turns = foldTurns([
      prompt('p1'), say('a'), prompt('p2'), say('b'), prompt('p3'), say('c'),
      prompt('p4'), call('Bash'),
      prompt('p5'), say('d'),
    ]);
    assert.deepEqual(reportLoopRuns(turns).map((r) => r.length), [3, 1]);
  });
  test('a turn with no text and no tools does not extend a run', () => {
    const turns = foldTurns([prompt('p1'), say('a'), prompt('p2'), prompt('p3'), say('c')]);
    assert.deepEqual(reportLoopRuns(turns).map((r) => r.length), [1, 1]);
  });
  test('empty input yields no runs rather than throwing', () => {
    assert.deepEqual(reportLoopRuns([]), []);
    assert.deepEqual(reportLoopRuns(null), []);
  });
});

describe('tokenSummary — every ratio ships with its denominator', () => {
  test('counts and ratios are reported together', () => {
    const turns = foldTurns([prompt('p1'), call('Bash'), prompt('p2'), say('just talking')]);
    const s = tokenSummary(turns);
    assert.equal(s.turns, 2);
    assert.equal(s.turnsWithoutTools, 1);
    assert.equal(s.totals.output, 20);
    assert.equal(s.ruminationShare, 0.5, '10 of 20 output tokens were spent in a turn that called no tool');
  });
  test('a zero denominator yields null, never a fabricated 0 or a division by zero', () => {
    const s = tokenSummary([]);
    assert.equal(s.turns, 0);
    assert.equal(s.ruminationShare, null);
    assert.equal(s.outputPerTurn, null);
    assert.equal(s.cacheHitRatio, null);
  });
  test('turns whose usage is absent are COUNTED as unknown, not treated as zero-cost', () => {
    const noUsage = { type: 'assistant', uuid: 'x', message: { content: [{ type: 'text', text: 'hi' }] } };
    const s = tokenSummary(foldTurns([prompt(), noUsage]));
    assert.equal(s.turnsWithoutUsage, 1);
  });
});

// A harness-authored assistant record: text, but every usage field zero. Real shapes measured in a
// live transcript were "No response requested." and "You've hit your session limit".
const harnessSay = (text) => asst({
  message: {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
});

describe('harness-authored turns are not the model reporting instead of working', () => {
  test('a zero-usage turn is marked, and a real one is not', () => {
    const turns = foldTurns([prompt('p1'), harnessSay('You have hit your session limit'), prompt('p2'), say('a real answer')]);
    assert.equal(turns[0].modelAuthored, false);
    assert.equal(turns[1].modelAuthored, true);
  });

  test('REGRESSION: a limit notice must not be counted as a rumination run', () => {
    const turns = foldTurns([
      prompt('p1'), call('Bash'),
      prompt('p2'), harnessSay('No response requested.'),
      prompt('p3'), harnessSay("You've hit your session limit"),
    ]);
    assert.deepEqual(reportLoopRuns(turns), [],
      'the measured false alarm: two harness notices scored as a report loop of 2');
  });

  test('a harness turn does not BREAK a real run either — the mirror defect', () => {
    const turns = foldTurns([
      prompt('p1'), say('a'),
      prompt('p2'), harnessSay('No response requested.'),
      prompt('p3'), say('b'),
    ]);
    const runs = reportLoopRuns(turns);
    assert.equal(runs.length, 1, 'an injected notice must not hide a run that continued through it');
    assert.equal(runs[0].length, 2);
  });

  test('run indices still point at the ORIGINAL turn positions, not the filtered ones', () => {
    const turns = foldTurns([
      prompt('p1'), harnessSay('notice'),
      prompt('p2'), say('a'), prompt('p3'), say('b'),
    ]);
    const [run] = reportLoopRuns(turns);
    assert.equal(run.from, 1, 'index must address the caller-visible array');
    assert.equal(run.to, 2);
    assert.equal(turns[run.from].openedByUuid, 'p2');
  });

  test('synthetic turns are counted and then excluded from every rate', () => {
    const s = tokenSummary(foldTurns([prompt('p1'), harnessSay('notice'), prompt('p2'), say('real')]));
    assert.equal(s.syntheticTurns, 1);
    assert.equal(s.turns, 1, 'a free turn in the denominator would flatter every efficiency number');
    assert.equal(s.ruminationShare, 1);
  });
});

describe('sessionId is a conversation, not a worker', () => {
  test('it is carried but is not the turn identity', () => {
    const [t] = foldTurns([prompt('p1')]);
    assert.equal(t.sessionId, 's');
    assert.equal(t.openedByUuid, 'p1');
    // Two live processes were measured sharing one transcript id, so anything addressing a WORKER
    // must join this to the spine session record (pid + pid_start), never key on sessionId alone.
    const a = foldTurns([{ ...prompt('p1'), sessionId: 'shared' }])[0];
    const b = foldTurns([{ ...prompt('p2'), sessionId: 'shared' }])[0];
    assert.equal(a.sessionId, b.sessionId);
    assert.notEqual(a.openedByUuid, b.openedByUuid);
  });
});

describe('NOT VACUOUS: the parser reads a real transcript shape end to end', () => {
  test('a realistic session yields turns, tools and tokens', () => {
    const lines = [prompt('p1'), call('Read'), toolResult(), say('done, verified'), prompt('p2'), say('anything else?')]
      .map((o) => JSON.stringify(o)).join('\n');
    const { steps, unparseable } = parseTranscript(lines);
    assert.equal(unparseable, 0);
    const turns = foldTurns(steps);
    assert.equal(turns.length, 2);
    assert.deepEqual(turns[0].toolCalls, ['Read']);
    assert.equal(claimWitness(turns[0]).witnessed, true);
    assert.equal(claimWitness(turns[1]).claimed, false);
    assert.ok(tokenSummary(turns).totals.output > 0);
  });
});

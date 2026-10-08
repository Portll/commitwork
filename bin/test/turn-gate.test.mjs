import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { foldTurns } from '../lib/turn-recorder-core.mjs';
import {
  DEFAULT_POLICY, unwitnessedClaims, reportLoop, toollessSession, recordIntegrity, assess, RULES,
  carriedHandback, handbackItem, transportAbortUnread, strandedAssignment,
} from '../lib/turn-gate-core.mjs';

const usage = (output = 10) => ({ input_tokens: 1, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const prompt = (uuid) => ({ type: 'user', uuid, sessionId: 's', message: { content: 'go' } });
const say = (text) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'text', text }], usage: usage() } });
const call = (name) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'tool_use', name, input: {} }], usage: usage() } });
const harness = (text) => ({ type: 'assistant', uuid: 'h', sessionId: 's', message: { content: [{ type: 'text', text }], usage: usage(0) } });

describe('recordIntegrity — a broken reader clears nobody and condemns nobody', () => {
  test('unparseable lines make the assessment unknown, never pass', () => {
    const v = recordIntegrity({ unparseable: 2, steps: 100 });
    assert.equal(v.verdict, 'unknown');
    assert.match(v.reason, /denominator is unknown/);
  });
  test('an empty transcript is unknown, not a clean session', () => {
    assert.equal(recordIntegrity({ unparseable: 0, steps: 0 }).verdict, 'unknown');
  });
  test('missing counts are unknown rather than assumed zero', () => {
    assert.equal(recordIntegrity({}).verdict, 'unknown');
  });
  test('a fully parsed transcript passes', () => {
    assert.equal(recordIntegrity({ unparseable: 0, steps: 10 }).verdict, 'pass');
  });
});

describe('unwitnessedClaims — the count crosses the threshold, not a single sentence', () => {
  test('one retrospective claim is tolerated — normal writing, not a defect', () => {
    const turns = foldTurns([prompt('p1'), say('I verified that earlier.')]);
    assert.equal(unwitnessedClaims(turns).verdict, 'pass');
  });
  test('a habit of them blocks', () => {
    const turns = foldTurns([
      prompt('p1'), say('verified'), prompt('p2'), say('confirmed'), prompt('p3'), say('all tests pass'),
    ]);
    const v = unwitnessedClaims(turns);
    assert.equal(v.verdict, 'block');
    assert.equal(v.evidence.count, 3);
  });
  test('a claim WITH work in the same turn is not counted at all', () => {
    const turns = foldTurns([
      prompt('p1'), call('Bash'), say('verified'), prompt('p2'), call('Bash'), say('confirmed'),
      prompt('p3'), call('Bash'), say('all tests pass'),
    ]);
    assert.equal(unwitnessedClaims(turns).evidence.count, 0);
  });
  test('a harness notice containing a claim word is not the model claiming anything', () => {
    const turns = foldTurns([prompt('p1'), harness('confirmed: session limit reached'), prompt('p2'), harness('verified notice'), prompt('p3'), harness('all tests pass')]);
    assert.equal(unwitnessedClaims(turns).evidence.count, 0);
  });
  test('the policy travels inside the verdict', () => {
    assert.equal(unwitnessedClaims([]).policy.unwitnessedClaims, DEFAULT_POLICY.unwitnessedClaims);
    const v = unwitnessedClaims(foldTurns([prompt('p1'), say('verified')]), { ...DEFAULT_POLICY, unwitnessedClaims: 0 });
    assert.equal(v.verdict, 'block');
    assert.equal(v.policy.unwitnessedClaims, 0);
  });
});

describe('reportLoop', () => {
  test('a run at the threshold blocks', () => {
    const turns = foldTurns([prompt('p1'), say('a'), prompt('p2'), say('b'), prompt('p3'), say('c')]);
    const v = reportLoop(turns);
    assert.equal(v.verdict, 'block');
    assert.equal(v.evidence.longest, 3);
  });
  test('a run under it passes and still reports the longest', () => {
    const turns = foldTurns([prompt('p1'), say('a'), prompt('p2'), call('Bash')]);
    const v = reportLoop(turns);
    assert.equal(v.verdict, 'pass');
    assert.equal(v.evidence.longest, 1);
  });
  test('REGRESSION: harness notices do not manufacture a run', () => {
    const turns = foldTurns([prompt('p1'), harness('a'), prompt('p2'), harness('b'), prompt('p3'), harness('c')]);
    assert.equal(reportLoop(turns).verdict, 'pass');
  });
});

describe('toollessSession — a short advisory session is not a defect', () => {
  test('a long session with no tool call at all blocks', () => {
    const steps = [];
    for (let i = 0; i < 5; i++) steps.push(prompt(`p${i}`), say(`answer ${i}`));
    assert.equal(toollessSession(foldTurns(steps)).verdict, 'block');
  });
  test('a short one passes — answering questions is legitimate work', () => {
    const turns = foldTurns([prompt('p1'), say('an answer'), prompt('p2'), say('another')]);
    assert.equal(toollessSession(turns).verdict, 'pass');
  });
  test('no model turns is unknown, not pass', () => {
    assert.equal(toollessSession([]).verdict, 'unknown');
  });
});

describe('assess — integrity vetoes, and the suppressed rules stay visible', () => {
  test('an unreadable record yields unknown even when other rules would block', () => {
    const steps = [];
    for (let i = 0; i < 5; i++) steps.push(prompt(`p${i}`), say(`verified ${i}`));
    const r = assess({ turns: foldTurns(steps), unparseable: 3, steps: 50 });
    assert.equal(r.outcome, 'unknown');
    assert.equal(r.vetoedBy, 'record-integrity');
    const blocked = r.verdicts.filter((v) => v.verdict === 'block');
    assert.ok(blocked.length > 0, 'a vetoed assessment must still SHOW what it found, or unreadable looks clean');
  });

  test('a working session passes', () => {
    const turns = foldTurns([prompt('p1'), call('Bash'), say('done, verified'), prompt('p2'), call('Read')]);
    const r = assess({ turns, unparseable: 0, steps: 20 });
    assert.equal(r.outcome, 'pass');
  });

  test('a claiming, toolless session blocks and names every reason', () => {
    const steps = [];
    for (let i = 0; i < 6; i++) steps.push(prompt(`p${i}`), say(`verified step ${i}`));
    const r = assess({ turns: foldTurns(steps), unparseable: 0, steps: 60 });
    assert.equal(r.outcome, 'block');
    assert.match(r.reason, /unwitnessed|no tool call|toolless|asserted/i);
  });

  test('every declared rule actually runs — a rule in the roster and not in the output is a silent gap', () => {
    const r = assess({ turns: foldTurns([prompt('p1'), call('Bash')]), unparseable: 0, steps: 5 });
    assert.deepEqual(r.verdicts.map((v) => v.rule).sort(), [...RULES].sort());
  });

  test('REGRESSION: `evidence.turns` is an ARRAY in every rule that has it, or nowhere', () => {
    // toolless-session once carried `turns` as a COUNT while unwitnessed-claim carried it as a LIST.
    // A renderer iterating verdicts uniformly called .slice() on a number and threw, and an uncaught
    // throw exits 1 — this command's code for "blocked". The crash accused a session instead of
    // reporting a failure. One name must mean one type across sibling rules.
    const steps = [];
    for (let i = 0; i < 8; i++) steps.push(prompt(`p${i}`), say(`verified ${i}`));
    const r = assess({ turns: foldTurns(steps), unparseable: 0, steps: 80 });
    for (const v of r.verdicts) {
      if (v.evidence && 'turns' in v.evidence) {
        assert.ok(Array.isArray(v.evidence.turns), `${v.rule}.evidence.turns must be an array, got ${typeof v.evidence.turns}`);
      }
    }
    const tl = r.verdicts.find((v) => v.rule === 'toolless-session');
    assert.equal(typeof tl.evidence.modelTurns, 'number', 'the count lives under its own unambiguous name');
  });

  test('the effective policy is reported, including an override', () => {
    const r = assess({ turns: [], unparseable: 0, steps: 1 }, { reportLoopRun: 99 });
    assert.equal(r.policy.reportLoopRun, 99);
    assert.equal(r.policy.unwitnessedClaims, DEFAULT_POLICY.unwitnessedClaims, 'an override must not drop the other defaults');
  });
});

describe('carriedHandback — the prose changes each turn, the item does not', () => {
  const busy = (uuid, text) => [prompt(uuid), call('Bash'), call('Edit'), say(text)];
  const carried = [
    ...busy('p1', 'Landed. Gate built, tested at 26, and still not connected to the Stop event pending your call.'),
    ...busy('p2', 'Recorded in the sidecar. Nothing changes about the gate itself: still not connected to the Stop event pending your call.'),
    ...busy('p3', 'Four rounds of correction. Nothing changed about the deliverable: still not wired to the Stop event pending your call.'),
  ];

  test('three busy turns handing back one unmoved item block', () => {
    const v = carriedHandback(foldTurns(carried));
    assert.equal(v.verdict, 'block');
    assert.equal(v.evidence.longest, 3);
    assert.deepEqual(v.evidence.runs[0].turns, ['p1', 'p2', 'p3']);
  });

  test('report-loop passes the same session — tool calls hide it from the toolless rule', () => {
    const turns = foldTurns(carried);
    assert.equal(reportLoop(turns).verdict, 'pass');
    assert.equal(carriedHandback(turns).verdict, 'block');
  });

  test('the shared hand-back phrase does not join unrelated asks', () => {
    const turns = foldTurns([
      ...busy('p1', 'Installing the hook is your call.'),
      ...busy('p2', 'Deleting the stale branch is your call.'),
      ...busy('p3', 'Rotating the leaked token is your call.'),
    ]);
    assert.equal(carriedHandback(turns).verdict, 'pass');
  });

  test('a turn that hands nothing back breaks the run', () => {
    const turns = foldTurns([carried.slice(0, 8), busy('mid', 'Landed abc1234.'), carried.slice(8)].flat());
    assert.equal(carriedHandback(turns).verdict, 'pass');
  });

  test('harness-authored turns neither extend nor break a run', () => {
    const turns = foldTurns([...carried.slice(0, 8), prompt('api'), harness('API Error: ENOTFOUND'), ...carried.slice(8)]);
    assert.equal(carriedHandback(turns).evidence.longest, 3);
  });

  test('a hand-back with no item left after the phrase is stripped cannot key a run', () => {
    assert.equal(handbackItem('Want me to?'), null);
    assert.equal(handbackItem('No hand-back here.'), null);
    assert.deepEqual([...handbackItem('Clearing the shared cargo target is still your call.')].sort(), ['cargo', 'clearing', 'shared', 'target']);
  });

  test('the run limit is policy, and reported', () => {
    const v = carriedHandback(foldTurns(carried.slice(0, 8)), { carriedHandbackRun: 2 });
    assert.equal(v.verdict, 'block');
    assert.equal(v.policy.carriedHandbackRun, 2);
    assert.equal(assess({ turns: [], unparseable: 0, steps: 1 }).policy.carriedHandbackRun, DEFAULT_POLICY.carriedHandbackRun);
  });
});

describe('transportAbortUnread — a closed stream is not a decision', () => {
  const abort = () => ({ type: 'user', uuid: 'r', message: { content: [{ type: 'tool_result', content: 'Tool permission request failed: AbortError: Tool permission stream closed before response received', is_error: true }] } });
  const ok = () => ({ type: 'user', uuid: 'r', message: { content: [{ type: 'tool_result', content: 'ok' }] } });

  test('an abort with no state read after it blocks', () => {
    const turns = foldTurns([prompt('p1'), call('Edit'), abort(), say('No response requested.')]);
    const v = transportAbortUnread(turns);
    assert.equal(v.verdict, 'block');
    assert.deepEqual(v.evidence.turns.map((t) => t.openedByUuid), ['p1']);
  });

  test('an abort followed by a tool call passes — the read is the rule, not the retry', () => {
    const turns = foldTurns([prompt('p1'), call('Edit'), abort(), call('Bash'), ok(), say('checked; the edit had not applied')]);
    assert.equal(transportAbortUnread(turns).verdict, 'pass');
  });

  test('ADVERSARIAL: recovering from an early abort does not clear a later one', () => {
    // A running total of calls-after-abort scores this turn as read, which is the flattering
    // direction. The question is only ever about the LAST abort.
    const turns = foldTurns([prompt('p1'), call('Edit'), abort(), call('Bash'), ok(), call('Edit'), abort()]);
    assert.equal(transportAbortUnread(turns).verdict, 'block');
  });

  test('a turn boundary is not the deadline: recovery on the NEXT turn clears it', () => {
    // 22 of the 44 corpus sessions that fire within-turn read the disk back on the very next turn.
    const turns = foldTurns([prompt('p1'), call('Edit'), abort(), prompt('p2'), call('Bash'), ok(), say('checked')]);
    assert.equal(transportAbortUnread(turns).verdict, 'pass');
  });

  test('a next turn that also calls nothing leaves it unread', () => {
    const turns = foldTurns([prompt('p1'), call('Edit'), abort(), prompt('p2'), say('I will wait for direction.')]);
    assert.equal(transportAbortUnread(turns).verdict, 'block');
  });

  test('a session with no abort passes, and says the count it saw', () => {
    const v = transportAbortUnread(foldTurns([prompt('p1'), call('Bash'), ok(), say('done')]));
    assert.equal(v.verdict, 'pass');
    assert.equal(v.evidence.count, 0);
  });

  test('an ordinary tool error is not a transport abort', () => {
    const err = () => ({ type: 'user', uuid: 'r', message: { content: [{ type: 'tool_result', content: 'ENOENT: no such file', is_error: true }] } });
    const turns = foldTurns([prompt('p1'), call('Read'), err(), say('missing file, moving on')]);
    assert.equal(transportAbortUnread(turns).verdict, 'pass');
  });

  test('a WHOLLY harness-authored turn is not judged', () => {
    assert.equal(transportAbortUnread(foldTurns([prompt('p1'), abort(), harness('API Error: ENOTFOUND')])).verdict, 'pass');
  });

  test('but a model turn is still judged when a harness notice follows its abort', () => {
    // The first draft of the test above asserted pass for this, on the premise that a trailing
    // harness notice makes the turn the harness's. It does not: the turn called Edit, the abort
    // left that edit unverified, and nobody read the disk back.
    const turns = foldTurns([prompt('p1'), call('Edit'), abort(), harness('API Error: ENOTFOUND')]);
    assert.equal(transportAbortUnread(turns).verdict, 'block');
  });
});

describe('strandedAssignment — assigned minus touched minus what a blocker NAMES', () => {
  const A = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), goal: `t${i + 1}` }));

  test('no ledger and an unreadable ledger are UNKNOWN, never pass', () => {
    assert.equal(strandedAssignment(undefined).verdict, 'unknown');
    assert.equal(strandedAssignment(null).verdict, 'unknown');
    assert.equal(strandedAssignment({ assigned: undefined, touched: [] }).verdict, 'unknown');
    assert.equal(strandedAssignment({ assigned: A(1), touched: undefined }).verdict, 'unknown');
  });

  test('a session with no plan passes — nothing was assigned to it', () => {
    assert.equal(strandedAssignment({ assigned: null, touched: [] }).verdict, 'pass');
    assert.equal(strandedAssignment({ assigned: [], touched: [] }).verdict, 'pass');
  });

  test('4 assigned, 3 touched, no blocker blocks and names the stranded one', () => {
    const v = strandedAssignment({ assigned: A(4), touched: ['1', '2', '3'], blockers: [] });
    assert.equal(v.verdict, 'block');
    assert.deepEqual(v.evidence.stranded, ['4']);
  });

  test('ADVERSARIAL: a real blocker covers the items it names and no others', () => {
    const blockers = [{ covers: ['5', '6'], statement: 'projects.json held by a peer' }];
    const v = strandedAssignment({ assigned: A(7), touched: ['1', '2', '3', '4'], blockers });
    assert.equal(v.verdict, 'block', 'task 7 shares none of the named blocker');
    assert.deepEqual(v.evidence.stranded, ['7']);
  });

  test('ADVERSARIAL: a blocker naming nothing, or naming an unassigned id, clears nothing', () => {
    assert.equal(strandedAssignment({ assigned: A(2), touched: [], blockers: [{ covers: [] }] }).verdict, 'block');
    assert.equal(strandedAssignment({ assigned: A(2), touched: [], blockers: [{ covers: ['9'] }] }).verdict, 'block');
  });

  test('assess carries the ledger through, and its absence does not condemn a session', () => {
    const turns = foldTurns([prompt('p1'), call('Bash')]);
    const clean = assess({ turns, unparseable: 0, steps: 5 });
    assert.equal(clean.outcome, 'pass');
    assert.equal(clean.verdicts.find((v) => v.rule === 'stranded-assignment').verdict, 'unknown');
    const fed = assess({ turns, unparseable: 0, steps: 5, ledger: { assigned: A(2), touched: ['1'] } });
    assert.equal(fed.outcome, 'block');
  });
});

describe('strandedAssignment — a finished plan is not an absent one', () => {
  test('all items settled says so, rather than "nothing was assigned"', () => {
    const done = strandedAssignment({ assigned: [], touched: ['1'], planId: 'cwfa-carry-rule' });
    assert.equal(done.verdict, 'pass');
    assert.match(done.reason, /every assigned item on cwfa-carry-rule is settled/);
    const none = strandedAssignment({ assigned: null, touched: [] });
    assert.equal(none.verdict, 'pass');
    assert.match(none.reason, /no plan bound/);
  });
});

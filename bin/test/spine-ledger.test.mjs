// The overwatch-layer recorder's field extraction. The envelope shapes are pinned as DATA, taken from
// the real payloads (a bare array of content blocks), and the `shape` field says WHY when
// extraction fails — a silent task:null blinds the gate's decoy arm.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEDGER_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'spine-ledger.mjs');
const SID = '07002350-f868-4dbf-84ed-573507ad7ff4';

/** Run the real hook over one event; return the row it appended, or null. */
function record(ev) {
  const path = join(mkdtempSync(join(tmpdir(), 'cw-spine-led-')), 'spine.jsonl');
  execFileSync(process.execPath, [LEDGER_BIN], {
    input: JSON.stringify(ev), encoding: 'utf8', env: { ...process.env, CW_SPINE_LEDGER: path },
  });
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

/** The REAL envelope: a bare array of content blocks whose text is the tool's JSON. */
const envelope = (obj) => [{ type: 'text', text: JSON.stringify(obj) }];

describe('spine-ledger extracts ids from the envelope the boundary actually sends', () => {
  test('create_task: the task id comes from the RESPONSE, because overwatch-layer assigns it', () => {
    const row = record({
      session_id: SID,
      tool_name: 'mcp__spine__create_task',
      tool_input: { planId: 'cw-plan-1', goal: 'do the thing' },
      tool_response: envelope({ id: '7', plan_id: 'cw-plan-1', status: 'pending' }),
    });
    assert.equal(row.task, '7');
    assert.equal(row.plan, 'cw-plan-1');
    assert.equal(row.kind, 'create_task');
    assert.equal(row.shape, undefined, 'a successful extraction leaves no diagnostic behind');
  });

  test('set_status: the task is named by the CALLER as `id`, not `taskId`', () => {
    // `taskId` matches no parameter overwatch-layer declares
    const row = record({
      session_id: SID,
      tool_name: 'mcp__spine__set_status',
      tool_input: { planId: 'cw-plan-1', id: '6', status: 'completed' },
      tool_response: envelope({ id: '6', plan_id: 'cw-plan-1', status: 'completed' }),
    });
    assert.equal(row.task, '6');
    assert.equal(row.plan, 'cw-plan-1');
  });

  test('create_plan has no task, and that absence is not an extraction failure', () => {
    const row = record({
      session_id: SID,
      tool_name: 'mcp__spine__create_plan',
      tool_input: { id: 'cw-plan-2', name: 'a plan' },
      tool_response: envelope({ id: 'cw-plan-2', status: 'active' }),
    });
    assert.equal(row.task, null);
    assert.equal(row.plan, 'cw-plan-2');
    assert.equal(row.shape, undefined, 'a plan legitimately has no task — do not flag it');
  });

  test('the OTHER envelope shape still works, so a boundary change is survivable', () => {
    const row = record({
      session_id: SID,
      tool_name: 'mcp__spine__create_task',
      tool_input: { planId: 'p' },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ id: '3', plan_id: 'p' }) }] },
    });
    assert.equal(row.task, '3');
  });

  test('an UNRECOGNISED response shape records WHY, rather than a silent null', () => {
    // an envelope change must announce itself, not degrade into a column of nulls
    const row = record({
      session_id: SID,
      tool_name: 'mcp__spine__update_task',
      tool_input: { planId: 'p' },                       // no id anywhere
      tool_response: { totally: 'different', nested: { id: '9' } },
    });
    assert.equal(row.task, null);
    assert.deepEqual(row.shape, ['totally', 'nested'], 'the row names the keys it could not use');
  });

  test('the session id is stored WHOLE — truncation is a display concern', () => {
    const row = record({
      session_id: SID, tool_name: 'mcp__spine__create_task',
      tool_input: { planId: 'p' }, tool_response: envelope({ id: '1', plan_id: 'p' }),
    });
    assert.equal(row.s, SID);
    assert.equal(row.s.length, 36);
  });

  test('a non-overwatch-layer tool is ignored entirely', () => {
    assert.equal(record({ session_id: SID, tool_name: 'Edit', tool_input: { file_path: 'x' } }), null);
  });

  test('a malformed event never throws and never writes', () => {
    // hot path of every external development task ledger call — interrupting a tool call is worse than losing the record
    assert.equal(record({ tool_name: 'mcp__spine__create_task' }), null, 'no session, no row');
    assert.doesNotThrow(() => record({ session_id: SID, tool_name: 'mcp__spine__create_task', tool_response: null }));
  });
});

// The server was re-registered spine <- substrate. A session that connected before that
// still calls the old name, so a recorder matching only the new one records nothing for it — and the
// gate reads that as "filed nothing" and blocks, which is what happened: 2001 rows, then none after
// 2026-09-09T14:08 while sessions kept filing.
describe('both registered names are recorded — a rename must not silently orphan live sessions', () => {
  for (const prefix of ['mcp__spine__', 'mcp__substrate__']) {
    test(`${prefix}create_task is recorded, and kind carries no prefix`, () => {
      const row = record({
        session_id: SID,
        tool_name: `${prefix}create_task`,
        tool_input: { planId: 'cw-plan-1', goal: 'x' },
        tool_response: envelope({ id: '7', plan_id: 'cw-plan-1' }),
      });
      assert.ok(row, `${prefix} filed nothing — the gate would read this session as idle`);
      assert.equal(row.kind, 'create_task', 'kind must not keep the registered prefix');
      assert.equal(row.task, '7');
    });
  }

  // The widening is a prefix alternation, so assert the boundary rather than trusting it.
  test('an unrelated mcp tool is still ignored', () => {
    assert.equal(record({ session_id: SID, tool_name: 'mcp__style__create_task', tool_input: {} }), null);
  });
});

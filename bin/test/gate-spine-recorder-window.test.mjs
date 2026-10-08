// gate-spine must not assert a zero it cannot see.
//
// Hooks load at SESSION START, so a session already running when spine-ledger.mjs was wired has
// none of its earlier MCP calls recorded. The gate's first real firing (2026-08-13) blocked a
// session with "filed 0 overwatch-layer records" which had in fact filed a plan and six tasks. The block
// was self-healing — the next filing is recorded — but a gate that states a false zero teaches its
// reader to discount the true ones, which is the failure mode this whole gate exists to avoid.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const GATE = fileURLToPath(new URL('../gate-spine.mjs', import.meta.url));
const SESSION = 'aaaaaaaa-1111-2222-3333-444444444444';

// Drive the gate the way Claude Code does: session id on stdin, ledgers via CW_* overrides.
function runGate({ touches, spine, minEdits = 1 }) {
  const d = mkdtempSync(join(tmpdir(), 'cw-gspine-'));
  const t = join(d, 'touches.jsonl'), s = join(d, 'spine.jsonl');
  writeFileSync(t, touches.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(s, spine.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync('node', [GATE], {
    input: JSON.stringify({ session_id: SESSION }),
    encoding: 'utf8',
    // Seam the OUTPUTS too, or the gate journals into the real .claude/verdicts and hook-emit —
    // both symlinks into the sidecar. bin/test/store-contamination.test.mjs pins this.
    env: { ...process.env, CW_TOUCH_LEDGER: t, CW_SPINE_LEDGER: s, CW_SPINE_MIN_EDITS: String(minEdits),
      CW_VERDICT_DIR: join(d, 'verdicts'),
      CW_HOOK_STATE: join(d, 'state'),
      SPINE_TASKS_DB: undefined, // outranks the fixture below when inherited
      SUBSTRATE_TASKS_DB: join(d, 'no-such.db') },
  });
  rmSync(d, { recursive: true, force: true });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

const edit = (at, f = 'a.mjs') => ({ s: SESSION, f, at });
const filed = (at, s = 'someone-else') => ({ s, kind: 'create_task', plan: 'p', task: '1', at });

describe('gate-spine: the recorder window', () => {
  test('a session editing BEFORE the recorder existed is told so, not told it filed nothing', () => {
    const out = runGate({
      touches: [edit('2026-08-13T08:00:00.000Z'), edit('2026-08-13T08:20:00.000Z', 'b.mjs')],
      spine: [filed('2026-08-13T08:28:04.981Z')], // recorder's earliest row is LATER than the edits
    });
    assert.match(out, /NOT VISIBLE|not visible/i,
      'must say the count is bounded by when the recorder started');
    assert.match(out, /08:00/, 'must name WHEN the session started editing — an unbounded hedge gets skipped');
    assert.match(out, /08:28/, 'must name when the recorder began');
  });

  test('a session that started AFTER the recorder gets no excuse — its zero is real', () => {
    const out = runGate({
      touches: [edit('2026-08-13T09:00:00.000Z')],
      spine: [filed('2026-08-13T08:28:04.981Z')], // recorder predates the session
    });
    assert.doesNotMatch(out, /NOT VISIBLE|not visible/i,
      'the caveat must not fire when the recorder was running the whole time — that would excuse every block');
  });

  test('a session that DID file records is never given the caveat', () => {
    const out = runGate({
      touches: [edit('2026-08-13T08:00:00.000Z')],
      spine: [{ s: SESSION, kind: 'create_task', plan: 'p', task: '1', at: '2026-08-13T08:30:00.000Z' }],
      minEdits: 99, // well above the edit count, so the gate passes and emits nothing to match on
    });
    assert.doesNotMatch(out, /NOT VISIBLE|not visible/i);
  });
});

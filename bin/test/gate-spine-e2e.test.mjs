// The spine gate's I/O half, driving the REAL script: spawns bin/gate-spine.mjs against scratch
// ledgers (env seams read at CALL time) and reads its exit code and stdout — the entire contract
// Claude Code consumes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'gate-spine.mjs');
const SID = '07002350-f868-4dbf-84ed-573507ad7ff4';

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-spine-e2e-'));
  mkdirSync(join(dir, 'state'), { recursive: true });
  mkdirSync(join(dir, 'verdicts'), { recursive: true });
  return {
    dir,
    touches: join(dir, 'touches.jsonl'),
    spine: join(dir, 'spine.jsonl'),
    /** EMPTY spine ledger = recorder running, nothing filed (a real block); ABSENT = the hook is
     *  not firing, which must fail open. Each case below states which it tests. */
    recorderRunning() { writeFileSync(this.spine, ''); return this; },
    edits(n, session = SID) {
      const rows = Array.from({ length: n }, (_, i) =>
        JSON.stringify({ s: session, f: `bin/f${i}.mjs`, at: '2026-08-12T01:00:00Z' }));
      writeFileSync(this.touches, `${rows.join('\n')}\n`);
    },
    filed(task = '1', at = '2026-08-12T02:00:00Z', session = SID) {
      writeFileSync(this.spine, `${JSON.stringify({ s: session, kind: 'create_task', plan: 'p1', task, at })}\n`);
    },
    /** Run the real gate. Returns { code, out } — never throws on a nonzero exit. */
    run(env = {}) {
      try {
        const out = execFileSync(process.execPath, [GATE], {
          input: JSON.stringify({ session_id: SID }),
          encoding: 'utf8',
          env: {
            ...process.env,
            CW_TOUCH_LEDGER: this.touches,
            CW_SPINE_LEDGER: this.spine,
            CW_HOOK_STATE: join(this.dir, 'state'),
            CW_VERDICT_DIR: join(this.dir, 'verdicts'),
            SPINE_TASKS_DB: undefined,                          // outranks the fixture below when inherited
            SUBSTRATE_TASKS_DB: join(this.dir, 'no-such.db'),   // absent ⇒ store unreadable
            ...env,
          },
        });
        return { code: 0, out };
      } catch (e) {
        return { code: e.status ?? 1, out: `${e.stdout || ''}` };
      }
    },
    cleanup() { rmSync(this.dir, { recursive: true, force: true }); },
  };
}

describe('gate-spine, end to end', () => {
  test('substantive edits with nothing filed → exit 2, and the message names the fix', () => {
    const c = ctx();
    c.recorderRunning();
    c.edits(6);
    const r = c.run();
    assert.equal(r.code, 2, 'a blocking gate that does not block is the whole failure being fixed');
    assert.match(r.out, /nothing filed in the fleet's task spine/);
    assert.match(r.out, /list_plans/, 'a block must name the action that clears it');
    assert.match(r.out, /CW_SPINE_MIN_EDITS=7/, 'and offer the escape hatch, computed for THIS session');
    c.cleanup();
  });

  test('the session id is displayed truncated but matched in FULL', () => {
    const c = ctx();
    c.recorderRunning();
    c.edits(6);
    const r = c.run();
    assert.match(r.out, /07002350-f868…/, 'display truncates with an ellipsis');
    assert.ok(!r.out.includes(`${SID} edited`), 'the whole 36-char id is not dumped into the headline');
    c.cleanup();
  });

  test('SAY-ONCE: an identical second run is completely silent', () => {
    // without say-once the gate becomes the wallpaper it was built to escape
    const c = ctx();
    c.recorderRunning();
    c.edits(6);
    assert.equal(c.run().code, 2);
    const second = c.run();
    assert.equal(second.code, 0, 'an unchanged fact must not re-block');
    assert.equal(second.out.trim(), '', 'and must not re-print');
    c.cleanup();
  });

  test('filing a task clears it, and the change is spoken', () => {
    const c = ctx();
    c.recorderRunning();
    c.edits(6);
    assert.equal(c.run().code, 2);
    c.filed();
    const r = c.run();
    assert.equal(r.code, 0);
    assert.match(r.out, /1 spine record/);
    c.cleanup();
  });

  test('below the threshold, nothing is required', () => {
    const c = ctx();
    c.edits(6);
    assert.equal(c.run({ CW_SPINE_MIN_EDITS: '99' }).code, 0);
    c.cleanup();
  });

  test('another session\'s edits are not counted as mine', () => {
    const c = ctx();
    c.edits(6, 'c1b09246-75db-4e8f-819c-a8e105452306');
    assert.equal(c.run().code, 0, 'attribution is the point — a co-session\'s work must not block me');
    c.cleanup();
  });

  test('an 8-char historical ledger row still attributes to a full live id', () => {
    // migration case: old rows stored session.slice(0, 8); matching is width-agnostic (bin/session-id.mjs)
    const c = ctx();
    c.recorderRunning();
    c.edits(6, '07002350');
    assert.equal(c.run().code, 2, 'an old-format row belongs to me and must still count');
    c.cleanup();
  });

  test('an UNREADABLE ledger fails OPEN and says UNKNOWN — never a silent clean', () => {
    // a session the gate cannot see is not a session that did nothing
    const c = ctx();
    c.edits(6);
    chmodSync(c.touches, 0o000);
    const r = c.run();
    chmodSync(c.touches, 0o644);
    assert.equal(r.code, 0, 'a blind sensor must never block');
    assert.match(r.out, /UNKNOWN/, 'but it must SAY it is blind — explicit uncertainty');
    c.cleanup();
  });

  test('an ABSENT spine ledger fails open — the gate must never be unsatisfiable', () => {
    // if the PostToolUse matcher never fires the ledger is never created; read as "filed nothing"
    // that is a permanent block nothing clears — absent recorder ⇒ grey
    const c = ctx();
    c.edits(6);                       // deliberately NOT recorderRunning()
    const r = c.run();
    assert.equal(r.code, 0, 'a broken recorder must not block work it cannot see');
    assert.match(r.out, /UNKNOWN/);
    assert.match(r.out, /recorder is not running/, 'and must name the hook, not blame the session');
    c.cleanup();
  });

  test('the verdict is journalled, with the full session id, on a silent path too', () => {
    // the feedback channel: if this stops writing, assess()'s decoy arm goes blind silently
    const c = ctx();
    c.edits(6);
    c.run();
    const log = join(c.dir, 'verdicts', 'gate-spine.jsonl');
    const rows = readJsonl(log);
    assert.ok(rows.length >= 1, 'a verdict that is not recorded is a control action with no sensor');
    assert.equal(rows[0].gate, 'gate-spine');
    assert.equal(rows[0].session, SID, 'the JOURNAL keeps the whole id — truncation is display-only');
    assert.equal(typeof rows[0].block, 'boolean');
    c.cleanup();
  });

  // P1-EXTEND (cw-adjudication-integrity task 10): provenance is an artifact read — the digest is
  // of raw ledger bytes before parsing.
  test('records carry measurement provenance over the ledgers, and the digest tracks the ledgers', () => {
    const c = ctx();
    c.recorderRunning();
    c.edits(6);
    c.run();
    c.run();                          // same ledgers, run again
    c.edits(7);                       // the touch ledger moves
    c.run();
    const rows = readJsonl(join(c.dir, 'verdicts', 'gate-spine.jsonl'));
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.ok(row.measured, 'a record with no measured block cannot prove the ledgers were read');
      assert.match(row.measured.digest, /^sha256:[0-9a-f]{16}$/);
      assert.match(row.measured.source, /^artifact:/, 'a file read must be visible as one');
      assert.equal(row.measured.ok, true);
    }
    assert.equal(rows[0].measured.digest, rows[1].measured.digest,
      'unchanged ledgers must digest equal — a steady reading over a steady source');
    assert.notEqual(rows[1].measured.digest, rows[2].measured.digest,
      'a ledger that moved must move the digest');
    c.cleanup();
  });

  test('both ledgers absent still yields a measured block — attempted, nothing obtained, ok:false', () => {
    const c = ctx();                  // no recorderRunning(), no edits: neither ledger exists
    c.run();
    const rows = readJsonl(join(c.dir, 'verdicts', 'gate-spine.jsonl'));
    assert.equal(rows.length, 1);
    const m = rows[0].measured;
    assert.ok(m, 'blindness is a measurement outcome, not an excuse to record nothing');
    assert.equal(m.ok, false, 'nothing was read — that is not a fine run');
    assert.equal(m.digest, null, 'and nothing obtained has no digest');
    c.cleanup();
  });
});

// narrow catch: a broad one once turned a ReferenceError into "no journal rows"
function readJsonl(p) {
  try {
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

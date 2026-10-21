// Rotation, asserted at the CALL SITES rather than in the module.
//
// bin/test/ledger-rotate.test.mjs exercises lib/ledger-rotate.mjs in isolation. That is necessary
// and not sufficient: an independent witness pointed out that all three readers and both writers
// could be reverted to the old fixed `[f.1, f]` window and the module test would stay green, because
// nothing in the repository drove a real hook through a real rotation. `CW_LEDGER_MAX_BYTES` was
// added "so a test can reach the rotation path" and then had no test reader — the seam and the
// claim about the seam, with nothing between them.
//
// So this drives bin/touch-ledger.mjs as the harness does — a PostToolUse event on stdin — past a
// seamed threshold, and then asks the READERS what they can see.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generations } from '../lib/ledger-rotate.mjs';
import { attributeFiles } from '../gate-tests-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', 'touch-ledger.mjs');

const fixture = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-rot-e2e-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return join(d, 'touches.jsonl');
};

/** One PostToolUse edit event through the real hook, with the ledger and threshold seamed. */
function touch(ledger, { session, file, maxBytes }) {
  execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: session, tool_name: 'Edit', tool_input: { file_path: file } }),
    encoding: 'utf8',
    env: { ...process.env, CW_TOUCH_LEDGER: ledger, CW_LEDGER_MAX_BYTES: String(maxBytes) },
  });
}

describe('ledger rotation, end to end through the real hook', () => {
  test('the writer rotates past the seamed threshold and keeps every generation', (t) => {
    const ledger = fixture(t);
    const repoFile = 'bin/touch-ledger.mjs';   // must exist in this repo — the hook drops paths outside it
    // A threshold of 1 byte forces a rotation on every call after the first.
    for (let i = 0; i < 4; i++) touch(ledger, { session: `sess${i}aa-0000`, file: join(HERE, '..', '..', repoFile), maxBytes: 1 });

    const gens = generations(ledger);
    assert.ok(gens.length >= 4, `expected the live file plus three generations, got ${gens.length}`);
    // Every generation must be non-empty and distinct — a rotation that produced empty files, or
    // the same file twice, would satisfy a count-only assertion.
    const bodies = gens.map((p) => readFileSync(p, 'utf8'));
    for (const b of bodies) assert.ok(b.trim().length, 'a rotation produced an empty generation');
    assert.equal(new Set(bodies).size, bodies.length, 'two generations hold identical content');
  });

  test('CW_LEDGER_MAX_BYTES actually gates rotation — the seam is not decorative', (t) => {
    const ledger = fixture(t);
    const f = join(HERE, '..', '..', 'bin', 'touch-ledger.mjs');
    for (let i = 0; i < 3; i++) touch(ledger, { session: `big${i}aaa-0000`, file: f, maxBytes: 10_000_000 });
    assert.equal(existsSync(`${ledger}.1`), false, 'rotated below the threshold — the seam is not read');
    assert.ok(readFileSync(ledger, 'utf8').trim().split('\n').length >= 3, 'all three rows are in the live file');
  });

  test('a READER attributes a row that lives in the OLDEST generation', (t) => {
    // The reader half, and the reason ordering mattered. With the pre-fix fixed `[f.1, f]` window a
    // row in `.3` is unreachable, so the ledger reports "nobody touched this" while holding the
    // proof that somebody did — preserved and invisible, which reads as fixed.
    const ledger = fixture(t);
    writeFileSync(`${ledger}.3`, `${JSON.stringify({ f: 'old.mjs', s: 'oldsess1', at: '2026-01-01T00:00:00Z', r: 'tree-1' })}\n`);
    writeFileSync(`${ledger}.2`, `${JSON.stringify({ f: 'mid.mjs', s: 'midsess1', at: '2026-01-02T00:00:00Z', r: 'tree-1' })}\n`);
    writeFileSync(`${ledger}.1`, `${JSON.stringify({ f: 'new.mjs', s: 'newsess1', at: '2026-01-03T00:00:00Z', r: 'tree-1' })}\n`);
    writeFileSync(ledger, `${JSON.stringify({ f: 'live.mjs', s: 'livesess', at: '2026-01-04T00:00:00Z', r: 'tree-1' })}\n`);

    const lines = generations(ledger).flatMap((p) => readFileSync(p, 'utf8').split('\n').filter(Boolean));
    const r = attributeFiles(['old.mjs', 'live.mjs'], 'oldsess1', { ledgerLines: lines, myTree: 'tree-1' });
    assert.deepEqual(r.mine, ['old.mjs'], 'a row in the oldest generation must still attribute');
    assert.deepEqual(r.theirs, ['live.mjs']);

    // And the control: the pre-fix two-file window cannot see it.
    const narrow = [`${ledger}.1`, ledger].flatMap((p) => readFileSync(p, 'utf8').split('\n').filter(Boolean));
    const r2 = attributeFiles(['old.mjs'], 'oldsess1', { ledgerLines: narrow, myTree: 'tree-1' });
    assert.deepEqual(r2.mine, [], 'fixture drift: the narrow window was supposed to MISS the old row');
    assert.deepEqual(r2.unknown, ['old.mjs']);
  });
});

// bin/test/ledger-backfill-tree.test.mjs — the backfill must recover only what evidence supports.
//
// The danger this file exists to catch is not "it fails to fill rows". It is the opposite: a
// backfill that fills a row it cannot justify converts an honest `unknown` into a false
// attribution, which bin/lib/store-paths.mjs names as worse than the gap. So the refusals are
// asserted as hard as the fills, and a positive control proves the filling arm works at all — a
// tool that fills nothing would pass every refusal test while being useless.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO, 'bin', 'ledger-backfill-tree.mjs');

const rows = (a) => a.map((o) => JSON.stringify(o)).join('\n') + '\n';

/** Run the CLI against fixture ledgers. Rotations are what it will actually rewrite. */
function run(touchRows, { apply = true, spineRows = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-backfill-'));
  const live = join(dir, 'touches.jsonl');
  const gen1 = `${live}.1`;
  const spine = join(dir, 'spine-touches.jsonl');
  writeFileSync(live, '');                       // live file: skipped by default, must stay empty
  writeFileSync(gen1, touchRows);
  writeFileSync(spine, rows(spineRows));
  const r = spawnSync(process.execPath, [CLI, ...(apply ? ['--apply'] : [])], {
    encoding: 'utf8',
    env: { ...process.env, CW_TOUCH_LEDGER: live, CW_SPINE_LEDGER: spine },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = readFileSync(gen1, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { __torn: l }; }
  });
  return { out, stdout: r.stdout };
}

test('POSITIVE CONTROL: a row whose session is stamped elsewhere IS filled, and marked as derived', () => {
  const { out } = run(rows([
    { s: 'aaa11111', r: 'tree-A', at: '2026-08-01T00:00:00Z', x: 'a.mjs' },   // the evidence
    { s: 'aaa11111', at: '2026-08-01T00:00:01Z', x: 'b.mjs' },                // fillable
  ]));
  assert.equal(out[1].r, 'tree-A', 'the join did not fill a row it had evidence for');
  assert.equal(out[1].rsrc, 'session-join', 'a derived value must not be indistinguishable from a measured one');
  assert.equal(out[0].rsrc, undefined, 'a natively-stamped row must not be relabelled as derived');
});

test('A SESSION SEEN IN TWO TREES IS REFUSED — never a best guess', () => {
  const { out } = run(rows([
    { s: 'bbb22222', r: 'tree-A', at: '2026-08-01T00:00:00Z', x: 'a.mjs' },
    { s: 'bbb22222', r: 'tree-B', at: '2026-08-01T00:00:01Z', x: 'b.mjs' },
    { s: 'bbb22222', at: '2026-08-01T00:00:02Z', x: 'c.mjs' },                // ambiguous
  ]));
  assert.equal(out[2].r, undefined, 'an ambiguous session was stamped — this is the false-attribution defect');
  assert.equal(out[2].rsrc, undefined);
});

test('A SESSION WITH NO STAMPED ROW ANYWHERE IS LEFT UNKNOWN', () => {
  const { out } = run(rows([
    { s: 'ccc33333', at: '2026-08-01T00:00:00Z', x: 'a.mjs' },
  ]));
  assert.equal(out[0].r, undefined, 'a row with no evidence was stamped');
});

test('the tool does not learn from its own backfills', () => {
  // A derived row must not become evidence for a third row; otherwise one join propagates outward.
  const { out } = run(rows([
    { s: 'ddd44444', r: 'tree-A', at: '2026-08-01T00:00:00Z', x: 'a.mjs' },
    { s: 'ddd44444', at: '2026-08-01T00:00:01Z', x: 'b.mjs' },
    { s: 'ddd4', at: '2026-08-01T00:00:02Z', x: 'c.mjs' },
  ]));
  const derived = out.filter((o) => o.rsrc === 'session-join');
  for (const d of derived) assert.equal(d.r, 'tree-A');
  // Re-running must be a no-op: nothing left to fill, and no new evidence invented.
  assert.match(run(rows(out.map((o) => o))).stdout, /filled=0/);
});

test('DRY RUN WRITES NOTHING', () => {
  const before = rows([
    { s: 'eee55555', r: 'tree-A', at: '2026-08-01T00:00:00Z', x: 'a.mjs' },
    { s: 'eee55555', at: '2026-08-01T00:00:01Z', x: 'b.mjs' },
  ]);
  const { out, stdout } = run(before, { apply: false });
  assert.equal(out[1].r, undefined, 'a dry run modified the ledger');
  assert.match(stdout, /DRY RUN/);
});

test('a torn line is preserved verbatim, never dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-backfill-torn-'));
  const live = join(dir, 'touches.jsonl');
  const gen1 = `${live}.1`;
  writeFileSync(live, '');
  writeFileSync(gen1, `{"s":"fff66666","r":"tree-A","at":"2026-08-01T00:00:00Z"}\n{ not json\n{"s":"fff66666","at":"2026-08-01T00:00:01Z"}\n`);
  writeFileSync(join(dir, 'spine-touches.jsonl'), '');
  const r = spawnSync(process.execPath, [CLI, '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, CW_TOUCH_LEDGER: live, CW_SPINE_LEDGER: join(dir, 'spine-touches.jsonl') },
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(gen1, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 3, 'a line was dropped');
  assert.equal(lines[1], '{ not json', 'the torn line was not preserved verbatim');
});

test('THE LIVE APPEND TARGET IS SKIPPED — a rewrite races concurrent appenders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-backfill-live-'));
  const live = join(dir, 'touches.jsonl');
  const spine = join(dir, 'spine-touches.jsonl');
  const body = rows([
    { s: 'ggg77777', r: 'tree-A', at: '2026-08-01T00:00:00Z' },
    { s: 'ggg77777', at: '2026-08-01T00:00:01Z' },
  ]);
  writeFileSync(live, body);
  writeFileSync(spine, '');
  const r = spawnSync(process.execPath, [CLI, '--apply'], {
    encoding: 'utf8', env: { ...process.env, CW_TOUCH_LEDGER: live, CW_SPINE_LEDGER: spine },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(live, 'utf8'), body, 'the live file was rewritten despite being an append target');
  assert.match(r.stdout, /SKIPPED \(live append target\)/);
});

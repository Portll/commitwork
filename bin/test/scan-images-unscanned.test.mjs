// An image whose scan did not produce a report must never render as a clean image. R14.
//
// THE DEFECT, measured 2026-08-30. `parseReport` was already correct — an absent report returns
// `{ ok: false, summary: 'no report' }`, failing closed exactly as the house rule demands. Both
// consumers then threw that signal away:
//
//   · the console switched on `sev` alone. `sev` is UNDEFINED for a failed parse, so it fell past
//     the 'high' and 'med' arms into the final `green(...)` — a scan that never ran printed green.
//
//   · the index rendered `${p.crit || ''}` and `${p.total || 0}`. An absent report has no `crit`;
//     a CLEAN image has `crit: 0`. Both are falsy, so both produced `''` and `0`, and the two rows
//     came out BYTE-IDENTICAL. The failed scan also contributed 0 to every fleet total.
//
// That second one is the reason this file asserts the INDEX rather than the console: the index is
// the published artifact a human reads and quotes, and "byte-identical" is a property only a
// comparison can catch. A reviewer reading either code path would have seen plausible code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeImageIndex } from '../commitwork.mjs';

const CLEAN = { ok: true, sev: 'ok', crit: 0, high: 0, med: 0, low: 0, total: 0, summary: '0 vulnerabilities' };
const UNSCANNED = { ok: false, summary: 'no report' };
const DIRTY = { ok: true, sev: 'high', crit: 2, high: 5, med: 1, low: 0, total: 8, summary: '8 vulnerabilities' };

/** Render an index into a scratch dir and hand back its text. */
function render(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-imgidx-'));
  try {
    writeImageIndex(dir, rows);
    return readFileSync(join(dir, 'index.md'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('THE DEFECT: an unscanned image does not render identically to a clean one', () => {
  const clean = render([{ img: 'x:1', slug: 'x_1', rep: CLEAN }]);
  const unscanned = render([{ img: 'x:1', slug: 'x_1', rep: UNSCANNED }]);

  const rowOf = (md) => md.split('\n').find((l) => l.includes('[x:1]'));
  assert.notEqual(rowOf(clean), rowOf(unscanned),
    'a scan that never ran is rendering byte-identically to a clean image — this is the R14 defect');
  assert.match(rowOf(unscanned), /UNSCANNED/, 'the unscanned row must say so in the table itself');
});

test('the unscanned count is disclosed beside the totals, and names the images', () => {
  const md = render([
    { img: 'ok:1', slug: 'ok_1', rep: CLEAN },
    { img: 'broken:2', slug: 'broken_2', rep: UNSCANNED },
  ]);
  assert.match(md, /1 of 2 image\(s\) UNSCANNED/, 'the count must appear');
  assert.match(md, /NOT known to be clean/, 'and must say what it means');
  assert.match(md, /broken:2/, 'and must name which image');
});

test('a fully scanned run carries no unscanned disclosure — the warning is not permanent furniture', () => {
  const md = render([
    { img: 'a:1', slug: 'a_1', rep: CLEAN },
    { img: 'b:1', slug: 'b_1', rep: DIRTY },
  ]);
  assert.doesNotMatch(md, /UNSCANNED/,
    'a warning that always fires teaches its reader to stop reading it');
  assert.match(md, /Fleet totals: 2 CRITICAL/, 'and the real totals must still be computed');
});

test('an unscanned image is excluded from the counted rows but not from the table', () => {
  const md = render([
    { img: 'a:1', slug: 'a_1', rep: DIRTY },
    { img: 'b:1', slug: 'b_1', rep: UNSCANNED },
  ]);
  // It must still be LISTED — dropping the row would hide the image entirely, which is a worse
  // failure than miscounting it: a reader cannot ask about what they cannot see.
  assert.match(md, /\[b:1\]/, 'the unscanned image must still appear in the table');
  assert.match(md, /Fleet totals: 2 CRITICAL · 5 HIGH/, 'totals come from the scanned rows');
});

// THE SECOND WITNESS. Every assertion above passes if `render` silently produced nothing, so prove
// the harness is actually exercising the renderer before trusting a green run.
test('the renderer is actually being exercised — not vacuously green', () => {
  const md = render([{ img: 'z:9', slug: 'z_9', rep: CLEAN }]);
  assert.ok(md.length > 100, 'an index was produced');
  assert.match(md, /Container-image CVE scan/, 'it is the index we think it is');
  assert.match(md, /\[z:9\]\(z_9\/trivy\.txt\)/, 'and it rendered the row we passed in');
});

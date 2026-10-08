// The Rollups view's render helpers, lifted from the assembled panel and run on a fixture payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelSource } from './lib/panel-source.mjs';

const SRC = panelSource('index.html');
function braceMatch(startIdx) {
  const open = SRC.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(startIdx, i + 1); }
  }
  assert.fail('unbalanced braces');
}
const fn = (name) => {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `function ${name}() not found in the panel`);
  return braceMatch(at);
};
const constLine = (name) => {
  const line = SRC.split('\n').find((l) => l.startsWith(`const ${name}=`));
  assert.ok(line, `const ${name} not found in the panel`);
  return line;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R = new Function('esc', 'ABS', 'AGO', 'COUNTDOWN', [constLine('RU_STATES'), constLine('RU_LABEL'), constLine('WORST_LABEL'),
  fn('cadenceIcon'), fn('dayTitle'), fn('dayStrip'), fn('projectName'), fn('nextCell'), fn('rollupChartSvg'), fn('rollupClockSvg'),
  fn('canaryRateText'), fn('canaryText'), fn('canaryCell'), fn('canaryHeadline'),
  'return {cadenceIcon,dayTitle,dayStrip,projectName,nextCell,rollupChartSvg,rollupClockSvg,canaryText,canaryCell,canaryHeadline};'].join('\n'))(
  esc, (d) => d.toISOString(), (ms) => `${Math.round(ms / 60000)}m ago`, () => '01:00:00');

const day = (k, state, extra = {}) => ({ day: k, state, runs: state && state !== 'none' ? 1 : 0, ...extra });

test('the cadence icon fills seven weekday cells for daily and one for weekly', () => {
  const on = (svg) => (svg.match(/class="on"/g) || []).length;
  assert.equal(on(R.cadenceIcon('daily')), 7);
  assert.equal(on(R.cadenceIcon('weekly')), 1);
  assert.equal(on(R.cadenceIcon('none')), 0);
  assert.match(R.cadenceIcon('weekly'), /<title>weekly scans<\/title>/);
});

test('a day names its outcome and its CVE and KEV counts on hover, and an unscheduled day is blank', () => {
  const strip = R.dayStrip([day('2026-09-20', 'good', { exposure: { cve: 12, kev: 1, crit: 0, high: 2 } }), day('2026-09-21', null), day('2026-09-22', 'none')]);
  assert.match(strip, /class="ru-d good" title="2026-09-20 · good · 1 run · CVE 12 · KEV 1"/);
  assert.match(strip, /class="ru-d na" title="2026-09-21 · not scheduled · no slice that day"/);
  assert.match(strip, /class="ru-d none" title="2026-09-22 · did not run · no slice that day"/);
});

test('a project name takes the colour of its worst exposure, and unknown is its own colour', () => {
  assert.match(R.projectName({ label: 'clientD', worst: 'kev' }), /class="ru-name w-kev" title="known-exploited \(KEV\) open"/);
  assert.match(R.projectName({ label: 'x' }), /w-unknown/);
});

test('no installed job is said, never a time', () => {
  assert.match(R.nextCell({ schedule: { state: 'absent', next: null } }), /no job installed/);
  assert.match(R.nextCell({ schedule: { state: 'scheduled', next: '2026-09-26T17:00:00.000Z' } }), /data-countdown="2026-09-26T17:00:00.000Z"/);
});

test('the clock draws one wedge band per outcome present each day, and an empty day as an outline', () => {
  const fleet = { totals: { good: 3, warn: 1, broken: 0, none: 1, empty: 0 },
    days: [{ day: 'a', ran: 2, runs: 2, good: 2, warn: 1, broken: 0, none: 0, empty: 0, cve: 5, kev: 0 },
      { day: 'b', ran: 0, runs: 0, good: 0, warn: 0, broken: 0, none: 0, empty: 0, cve: 0, kev: 0 },
      { day: 'c', ran: 1, runs: 1, good: 1, warn: 0, broken: 0, none: 1, empty: 0, cve: 0, kev: 0 }] };
  const svg = R.rollupClockSvg(fleet);
  assert.equal((svg.match(/class="seg good"/g) || []).length, 2);
  assert.equal((svg.match(/class="seg warn"/g) || []).length, 1);
  assert.equal((svg.match(/class="seg none"/g) || []).length, 1);
  assert.equal((svg.match(/class="seg na"/g) || []).length, 1, 'a day nothing was scheduled for is an outline, not a colour');
  assert.match(svg, /<title>a · good 2 · warn 1 · broken 0 · did not run 0 · CVE 5 · KEV 0<\/title>/);
  assert.match(svg, />3\/5</, 'the centre reads good over all graded project-days');
  const bars = R.rollupChartSvg(fleet, 4);
  assert.equal((bars.match(/class="bar"/g) || []).length, 3);
  assert.match(bars, /a · 2 of 4 projects ran · 2 runs · CVE 5 · KEV 0/);
});

test('the gate error rate shows n/of beside each rate, and an unmeasured one as words, never 0%', () => {
  const c = { state: 'measured', at: '2026-09-20T02:00:00Z', requiredSkipped: [],
    falseClean: { state: 'measured', n: 1, of: 4, rate: 0.25 }, falseAlarm: { state: 'not-measured', n: 0, of: 0, rate: null } };
  assert.equal(R.canaryText(c), 'false-clean 1/4 (25%) · false-alarm not measured');
  assert.match(R.canaryCell(c), /class="pk-err"/, 'a false-clean is shown as a failure');
  assert.match(R.canaryCell(c), /FC 1\/4 \(25%\) · FA not measured/);
  for (const off of [null, { state: 'not-measured', why: 'the canary was switched off' }, { state: 'failed', why: 'harness crashed' }, { state: 'unreadable', why: 'EACCES' }]) {
    const t = R.canaryText(off) + R.canaryCell(off) + R.canaryHeadline(off);
    assert.ok(!/0%/.test(t), `${JSON.stringify(off)} must not render as a percentage`);
    assert.match(R.canaryCell(off), /class="mut"/);
  }
  assert.match(R.canaryHeadline({ ...c, area: 'alpha' }), /Gate error rate.*alpha.*false-clean 1\/4/);
});

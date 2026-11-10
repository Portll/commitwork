// The runner status page as one HTML document string (admin/lib/runner-page.mjs renderRunnerPage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRunnerPage } from '../lib/runner-page.mjs';

const D = '\u00b7';
const M = '\u2014';
const tail = (r) => r.slice(r.indexOf('</style>'));
const hd = (id, t, n) => `<div class="hd"><h2 id="${id}">${t}</h2><span class="n">${n}</span></div>`;
const ab = (w) => `<div class="absent"><b>UNMEASURED</b>${w}</div>`;
const tw = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
  + `<tbody>${rows.join('\n')}</tbody></table></div>`;
const page = (apiB, kpiB, slotsS, decS, vm, con, job) => '</style></head><body><main>\n<h1>Actions runner</h1>\n'
  + '<p class="stamp">The portll-stack dispatcher\'s slots, admission decisions and resource use, from its stack API. Refreshes every 15 s.</p>\n'
  + `${apiB}\n${kpiB}\n<section aria-labelledby="h-slots">${slotsS}</section>\n`
  + `<section aria-labelledby="h-decisions">${decS}</section>\n`
  + `<section aria-labelledby="h-resources"><div class="hd"><h2 id="h-resources">Resources</h2><span class="n">Docker VM ${D} containers ${D} jobs</span></div>\n`
  + `${vm}\n${con}\n${job}\n</section>\n</main>\n<div data-theme-switch></div></body></html>`;
const F = (text) => ({ text });

const base = () => ({
  api: { url: 'u', state: 'measured', verifiedAt: 'T', sources: [{ tone: 'live', id: 's', status: 'ok', reason: '' }] },
  kpis: [{ k: 'K', v: F('V') }],
  slots: { state: 'measured', verifiedAt: 'T', rows: [] },
  decisions: { state: 'measured', verifiedAt: 'T', rows: [] },
  layers: {
    vm: { label: 'VM', at: 'A', state: 'measured', figures: [] },
    containers: { label: 'C', state: 'measured', rows: [] },
    jobs: { label: 'J', state: 'measured', rows: [] },
  },
});

test('The document opens with the doctype, charset meta and the refresh and title lines', () => {
  const r = renderRunnerPage(base());
  const prefix = '<!doctype html><html lang="en"><head><meta charset="utf-8">';
  assert.equal(r.slice(0, prefix.length), prefix);
  assert.equal(r.charAt(prefix.length), '<');
  const i = r.indexOf('\n<meta name="viewport"');
  assert.equal(r.slice(i, r.indexOf('</title>') + 9),
    '\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="refresh" content="15">\n'
    + `<title>Actions runner ${D} commitwork</title>\n`);
});

test('A fully measured model with empty tables renders the empty-table notes', () => {
  const r = renderRunnerPage(base());
  assert.equal(tail(r), page(
    `<div class="api"><span class="pill live">reachable</span> <code>u</code> <span class="stamp">read T</span> <span class="pill live">s ok</span></div>`,
    '<div class="kpis"><div class="kpi"><div class="k">K</div><div class="v">V</div></div></div>',
    hd('h-slots', 'Slots', `0 slots ${D} read T`) + '<p class="stamp">The slot table is empty.</p>',
    hd('h-decisions', 'Admission decisions', `newest 50 ${D} read T`) + '<p class="stamp">No admission decision is recorded yet.</p>',
    '<div class="layer">VM<span class="at">sampled A</span></div><div class="card figs"></div>',
    '<div class="layer">C</div><p class="stamp">The container map names no service.</p>',
    '<div class="layer">J</div><p class="stamp">No job has finished yet.</p>',
  ));
});

test('Every section that is not measured renders an UNMEASURED block with its reason', () => {
  const m = {
    api: { url: 'u', state: 'down', why: 'W', remedy: 'R' },
    kpis: [{ k: 'K', v: { unknown: true, why: 'Y', text: 'na' } }],
    slots: { state: 'stale', why: 'S' },
    decisions: { state: 'stale', why: 'D' },
    layers: {
      vm: { label: 'VM', state: 'x', why: 'V' },
      containers: { label: 'C', state: 'x', why: 'Cw' },
      jobs: { label: 'J', state: 'x', why: 'Jw' },
    },
  };
  assert.equal(tail(renderRunnerPage(m)), page(
    '<div class="api"><span class="pill unk">UNMEASURED</span> <code>u</code></div><div class="absent"><b>UNMEASURED</b>W<div class="remedy">R</div></div>',
    '<div class="kpis"><div class="kpi"><div class="k">K</div><div class="v"><span class="unm" title="Y">na</span></div></div></div>',
    hd('h-slots', 'Slots', 'UNMEASURED') + ab('S'),
    hd('h-decisions', 'Admission decisions', 'UNMEASURED') + ab('D'),
    `<div class="layer">VM</div>${ab('V')}`,
    `<div class="layer">C</div>${ab('Cw')}`,
    `<div class="layer">J</div>${ab('Jw')}`,
  ));
});

test('Measured rows render as table rows with job subjects, unknown cells and source titles', () => {
  const m = base();
  m.api.sources = [{ tone: 'live', id: 'a', status: 'ok', reason: 'fine' }, { tone: 'warn', id: 'b', status: 'slow', reason: '' }];
  m.slots.rows = [
    { id: 's1', tone: 'live', state: 'busy', since: 't1', job: { repo: 'r', runId: null, jobId: null, runner: 'rn' } },
    { id: 's2', tone: 'idle', state: 'free', since: 't2', job: null },
  ];
  m.decisions.rows = [{ at: 'a', repo: null, runId: '7', jobId: null, tone: 'bad', outcome: 'denied', code: 'C1', reason: null, seen: '3' }];
  m.layers.vm.figures = [{ k: 'cpu', v: F('2') }, { k: 'mem', v: { unknown: true, why: 'w', text: 'm' } }];
  m.layers.containers.at = '';
  m.layers.containers.rows = [{ service: 'svc', id: 'c1', tone: 'live', state: 'up', cpuPct: F('1'), cpuSec: F('2'),
    mem: F('3'), memPeak: F('4'), memMax: { unknown: true, why: 'nl', text: 'u' }, pids: F('6') }];
  m.layers.jobs.at = 'B';
  m.layers.jobs.rows = [{ at: 'f', repo: 'r', runId: null, jobId: '9', runner: null, exit: { tone: 'bad', text: '1' },
    wall: F('w'), cpuSec: F('c'), memPeak: F('p'), io: F('i') }];
  assert.equal(tail(renderRunnerPage(m)), page(
    '<div class="api"><span class="pill live">reachable</span> <code>u</code> <span class="stamp">read T</span> '
      + '<span class="pill live" title="fine">a ok</span> <span class="pill warn">b slow</span></div>',
    '<div class="kpis"><div class="kpi"><div class="k">K</div><div class="v">V</div></div></div>',
    hd('h-slots', 'Slots', `2 slots ${D} read T`) + tw(['Slot', 'State', 'Since', 'Job'], [
      '<tr><td class="name">s1</td><td><span class="pill live">busy</span></td><td>t1</td><td>r<span class="sub">whole repository</span><span class="sub">rn</span></td></tr>',
      '<tr><td class="name">s2</td><td><span class="pill idle">free</span></td><td>t2</td><td><span class="stamp">no job</span></td></tr>',
    ]),
    hd('h-decisions', 'Admission decisions', `newest 50 ${D} read T`) + tw(['Last seen', 'Repository', 'Outcome', 'Code', 'Reason', 'Seen'], [
      `<tr><td>a</td><td>${M}<span class="sub">run 7 ${D} job ${M}</span></td><td><span class="pill bad">denied</span></td>`
        + '<td><code>C1</code></td><td></td><td class="num">3</td></tr>',
    ]),
    '<div class="layer">VM<span class="at">sampled A</span></div><div class="card figs">'
      + '<div class="kv"><span class="mut">cpu</span><span>2</span></div>'
      + '<div class="kv"><span class="mut">mem</span><span><span class="unm" title="w">m</span></span></div></div>',
    '<div class="layer">C</div>' + tw(['Service', 'State', 'CPU', 'CPU-seconds', 'Memory', 'Peak memory', 'Memory limit', 'Pids'], [
      '<tr><td class="name">svc<span class="sub">c1</span></td><td><span class="pill live">up</span></td>'
        + '<td class="num">1</td><td class="num">2</td><td class="num">3</td><td class="num">4</td>'
        + '<td class="num"><span class="unm" title="nl">u</span></td><td class="num">6</td></tr>',
    ]),
    '<div class="layer">J<span class="at">sampled B</span></div>' + tw(['Finished', 'Repository', 'Exit', 'Wall time', 'CPU-seconds', 'Peak memory', 'I/O'], [
      `<tr><td>f</td><td>r<span class="sub">run ${M} ${D} job 9</span><span class="sub"></span></td><td><span class="pill bad">1</span></td>`
        + '<td class="num">w</td><td class="num">c</td><td class="num">p</td><td class="num">i</td></tr>',
    ]),
  ));
});

test('A model without an api section throws a TypeError reading its url', () => {
  assert.throws(() => renderRunnerPage({}), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'url')",
  });
});

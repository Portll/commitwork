// The Scanners view's scan-a-path section (admin/static/perf-console.js), lifted from the served
// panel source. On the published port the control must be ABSENT: no markup, no element, not a
// disabled button. The server's canAct decides; the static page carries nothing to hide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelHtml, panelScript } from './lib/panel-source.mjs';

const SRC = panelScript('index.html');
const line = (prefix) => {
  const l = SRC.split('\n').find((x) => x.startsWith(prefix));
  assert.ok(l, `${prefix} is not in the served panel source`);
  return l;
};
const fnSrc = (name) => {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is not in the served panel source`);
  return SRC.slice(at, SRC.indexOf('\n}\n', at) + 2);
};
const ui = new Function('document', [line('const pcEl = '), line('const esc='), line('const pcEsc = '),
  fnSrc('ansiHtml'), fnSrc('pcScanPathState'), fnSrc('pcScanPathJobHtml'), fnSrc('pcScanPathHtml'), fnSrc('pcScanPathMount'),
  'return { pcScanPathHtml, pcScanPathMount };'].join('\n'));

function fakeDocument({ detailHidden = true, existing = false } = {}) {
  const els = new Map();
  const created = [];
  const el = (id) => ({ id, hidden: false, innerHTML: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { els.delete(this.id); this.removed = true; },
    after(n) { this.next = n; els.set(n.id, n); } });
  els.set('perf-scanner', { ...el('perf-scanner'), hidden: detailHidden });
  if (existing) els.set('perf-scanpath', el('perf-scanpath'));
  return { els, created, getElementById: (id) => els.get(id) || null,
    createElement: (tag) => { const e = el(''); e.tag = tag; created.push(e); return e; } };
}

const JOB = { running: false, phase: 'done', exitCode: 0, signal: null, stoppedAt: null, seq: 3,
  label: 'scan: /work/repos/acme', startedAt: '2026-09-28T01:02:03.000Z', lines: ['[serve] starting: node …', 'scan complete'] };

test('no canAct, no control: an empty string for every answer that is not canAct:true', () => {
  const { pcScanPathHtml } = ui(fakeDocument());
  for (const d of [null, undefined, {}, { canAct: false, job: null }, { canAct: 'true' }, { canAct: false, job: JOB }]) {
    assert.equal(pcScanPathHtml(d), '', JSON.stringify(d));
  }
  const html = pcScanPathHtml({ canAct: true, job: null });
  assert.match(html, /<input[^>]*id="pc-sp-path"/);
  assert.match(html, /<button[^>]*id="pc-sp-run"[^>]*>scan<\/button>/);
  assert.doesNotMatch(html, /id="pc-sp-run" disabled/);
});

test('canAct:false creates no element, and removes one left from an earlier answer', () => {
  const doc = fakeDocument();
  ui(doc).pcScanPathMount({ canAct: false, job: null });
  assert.equal(doc.created.length, 0);
  assert.equal(doc.getElementById('perf-scanpath'), null);
  const had = fakeDocument({ existing: true });
  ui(had).pcScanPathMount(null);
  assert.equal(had.getElementById('perf-scanpath'), null, 'a failed read left a control on the page');
});

test('canAct:true mounts an overview section after the scanner detail, hidden with the overview', () => {
  const doc = fakeDocument({ detailHidden: true });
  ui(doc).pcScanPathMount({ canAct: true, job: null });
  const sec = doc.getElementById('perf-scanpath');
  assert.ok(sec, 'no section was mounted on the operator port');
  assert.equal(doc.getElementById('perf-scanner').next, sec);
  assert.equal(sec.attrs['data-pc-overview'], '');
  assert.equal(sec.hidden, false);
  assert.match(sec.innerHTML, /id="pc-sp-path"/);
  const onScanner = fakeDocument({ detailHidden: false });
  ui(onScanner).pcScanPathMount({ canAct: true, job: null });
  assert.equal(onScanner.getElementById('perf-scanpath').hidden, true, 'shown over a single scanner\'s page');
});

test('the page as served carries no scan-a-path control of its own', () => {
  assert.doesNotMatch(panelHtml('index.html'), /pc-sp-path|pc-sp-run|perf-scanpath/);
});

test('the job reads running, complete, stopped or exited, and the button waits for a running one', () => {
  const { pcScanPathHtml } = ui(fakeDocument());
  const state = (job) => /<span class="pill (\w+)">([^<]+)<\/span>/.exec(pcScanPathHtml({ canAct: true, job })).slice(1);
  assert.deepEqual(state({ ...JOB, running: true, phase: 'starting' }), ['part', 'running']);
  assert.match(pcScanPathHtml({ canAct: true, job: { ...JOB, running: true } }), /id="pc-sp-run" disabled/);
  assert.deepEqual(state(JOB), ['live', 'complete']);
  assert.deepEqual(state({ ...JOB, phase: 'starting', exitCode: 2 }), ['crit', 'exited 2']);
  assert.deepEqual(state({ ...JOB, phase: 'stopped', exitCode: null, signal: 'SIGTERM', stoppedAt: '2026-09-28T01:03:00Z' }), ['crit', 'stopped']);
  assert.deepEqual(state({ ...JOB, phase: 'starting', exitCode: null, signal: 'SIGKILL' }), ['crit', 'exited SIGKILL']);
});

test('a running scan has a stop control, a finished one does not, and it posts to the stop route with CSRF', () => {
  const { pcScanPathHtml } = ui(fakeDocument());
  assert.match(pcScanPathHtml({ canAct: true, job: { ...JOB, running: true, phase: 'starting' } }), /<button type="button" id="pc-sp-stop">stop<\/button>/);
  assert.doesNotMatch(pcScanPathHtml({ canAct: true, job: JOB }), /pc-sp-stop/);
  assert.match(fnSrc('pcScanPathStop'), /cwPost\('\/api\/sweep\/stop\?kind=scan-path'\)/);
  assert.match(SRC, /if \(t\.id === 'pc-sp-stop'\) return t\.disabled \? undefined : pcScanPathStop\(t\);/);
  assert.match(SRC, /closest\('[^']*#pc-sp-stop'\)/, 'the click delegate does not reach the stop button');
});

test('the label and the log are escaped: both carry names from the scanned tree', () => {
  const { pcScanPathHtml } = ui(fakeDocument());
  const html = pcScanPathHtml({ canAct: true, job: { ...JOB, label: 'scan: /x/<img src=x onerror=alert(1)>', lines: ['<script>alert(2)</script>'] } });
  assert.ok(!html.includes('<img'), 'an unescaped label reached the markup');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!html.includes('<script>'), 'an unescaped log line reached the markup');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the start is a CSRF-carrying POST, and progress rides the existing job feed', () => {
  assert.match(SRC, /cwPost\('\/api\/scan-path', \{ headers: \{ 'content-type': 'application\/json' \}, body: JSON\.stringify\(pc \? \{ pc: true \} : \{ path \}\) \}\)/);
  assert.match(fnSrc('cwPost'), /'x-cw-csrf':await csrf\(\)/);
  assert.match(SRC, /new EventSource\(`\/api\/status\/events\?kind=scan-path&from=\$\{SP\.seq\}`\)/);
});

// ── the whole machine and the remediation brief ──
const briefUi = new Function([line('const esc='), line('const pcEsc = '), line('const PC_BRIEF_ROWS = '), line('const pcSevCls = '),
  line('const pcBriefTarget = '), line('const pcPlural = '), fnSrc('pcBriefPickHtml'), fnSrc('pcBriefHtml'),
  'return { pcBriefHtml };'].join('\n'))();

const BRIEF = {
  generatedAt: '2026-10-04T00:00:00.000Z', target: { mode: 'path', root: '/work/repos' },
  enrichment: { kev: { consulted: true, catalogVersion: '2026.10.03', freshness: 'fresh' }, epss: { scored: 2, of: 3 } },
  counts: { repos: 2, actions: 2, kevActions: 1, advisories: 3, kev: 1, issues: 1, suppressed: 4, undetermined: 1, notMeasured: 1 },
  actions: [
    { repo: 'acme', package: 'lodash', version: '4.17.20', fix: '4.17.21', kev: 1, worst: 'high', epss: 0.91, findings: [{ id: 'GHSA-kev', kev: true }, { id: 'CVE-2', kev: false }] },
    { repo: 'acme', package: '<img src=x onerror=alert(1)>', version: '1', fix: '', kev: 0, worst: 'crit', epss: null, findings: [{ id: '<b>x</b>', kev: false }] },
  ],
  issues: [{ repo: 'acme', label: 'Static analysis', counts: { high: 2, low: 1 }, top: [{ rule: 'js/xss', file: 'a.js', line: 3 }] }],
  notMeasured: [{ repo: 'beta', check: 'deps-osv', kind: 'void', reason: 'osv-scanner not installed' }],
};

test('the whole-machine control exists only with canAct, and arms before it starts', () => {
  const { pcScanPathHtml } = ui(fakeDocument());
  assert.match(pcScanPathHtml({ canAct: true, job: null }), /<button type="button" id="pc-sp-pc">scan this machine<\/button>/);
  assert.match(pcScanPathHtml({ canAct: true, job: { ...JOB, running: true } }), /id="pc-sp-pc" disabled/);
  assert.equal(pcScanPathHtml({ canAct: false, job: null }), '');
  assert.match(fnSrc('pcScanPathArmPc'), /if \(btn\.dataset\.armed === '1'\) return pcScanPathRun\(btn, true\);/);
  assert.match(SRC, /if \(t\.id === 'pc-sp-pc'\) return t\.disabled \? undefined : pcScanPathArmPc\(t\);/);
  assert.match(SRC, /closest\('[^']*#pc-sp-pc[,']/, 'the click delegate does not reach the whole-machine button');
});

test('the brief renders KEV first as written, says what was not measured, and links the full brief', () => {
  const html = briefUi.pcBriefHtml(BRIEF, [{ id: 'run-2' }, { id: 'run-1', error: 'brief.json could not be read' }], 'run-2');
  assert.ok(html.indexOf('GHSA-kev') < html.indexOf('&lt;b&gt;x&lt;/b&gt;'), 'the KEV upgrade is not listed first');
  assert.match(html, /<b class="txt-crit">KEV ×1<\/b>/);
  assert.match(html, /lodash@4\.17\.20 → 4\.17\.21/);
  assert.match(html, /\(no fixed version published\)/);
  assert.match(html, /1 undetermined, not counted/);
  assert.match(html, /4 suppressed in source, not listed/);
  assert.match(html, /osv-scanner not installed/);
  assert.match(html, /href="\/api\/scan-path\/brief\?id=run-2&amp;format=html"/);
  assert.match(html, /<option value="run-1">run-1 · unreadable: brief\.json could not be read<\/option>/);
});

test('every brief string is escaped: package names, advisory ids and paths come from scanned trees', () => {
  const html = briefUi.pcBriefHtml(BRIEF, [{ id: 'run-2' }], 'run-2');
  assert.ok(!html.includes('<img'), 'an unescaped package name reached the markup');
  assert.ok(!/<b>x<\/b>/.test(html), 'an unescaped advisory id reached the markup');
});

test('a brief with the KEV catalogue unread says KEV is unknown, never that nothing is KEV', () => {
  const html = briefUi.pcBriefHtml({ ...BRIEF, enrichment: { kev: { consulted: false } } }, [], 'run-2');
  assert.match(html, /KEV not consulted: every KEV field is unknown, not false/);
});

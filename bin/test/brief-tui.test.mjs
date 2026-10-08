// bin/test/brief-tui.test.mjs — the terminal view of a remediation brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBrief } from '../lib/brief.mjs';
import { SECTIONS, sectionItems, initialState, reduce, parseKeys, renderScreen, runBriefTui } from '../lib/brief-tui.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
const write = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); };

const helpFor = (rows) => `### Fixed Versions\n\n| Vulnerability ID | Package Name | Fixed Version |\n| --- | --- | --- |\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\nend\n`;
const osvSarif = (advs) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'osv-scanner', rules: advs.map((a) => ({ id: a.id, shortDescription: { text: `${a.id}: a flaw in ${a.pkg}` },
    properties: { 'security-severity': String(a.cvss) }, help: { text: helpFor([[a.id, a.pkg, a.fixed]]) } })) } },
  invocations: [{ executionSuccessful: true }],
  results: advs.map((a) => ({ ruleId: a.id, message: { text: `Package '${a.pkg}@${a.version}' is vulnerable to '${a.id}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri: a.uri || 'package-lock.json' } } }] })),
}] });
const semgrepSarif = (results) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'semgrep', rules: [...new Set(results.map((r) => r.rule))].map((id) => ({ id })) } },
  invocations: [{ executionSuccessful: true }],
  results: results.map((r) => ({ ruleId: r.rule, level: r.level, message: { text: r.message },
    locations: [{ physicalLocation: { artifactLocation: { uri: r.file }, region: { startLine: r.line } } }] })),
}] });

function fixtureRun() {
  const run = mkdtempSync(join(tmpdir(), 'cw-brief-tui-'));
  const dir = join(run, 'app');
  write(join(dir, 'summary.md'), '# Security report — app\n\nRepo: `/src/app`\n');
  write(join(dir, 'osv.sarif'), osvSarif([
    { id: 'CVE-2020-0001', pkg: 'big', version: '1.0.0', cvss: 9.8, fixed: '1.0.1' },
    { id: 'CVE-2020-0002', pkg: 'small', version: '2.0.0', cvss: 5.0, fixed: '2.0.5' },
    { id: 'CVE-2020-0004', pkg: 'loose', version: '0.1.0', cvss: 9.1, fixed: '0.2.0', uri: 'requirements.txt' },
  ]));
  write(join(dir, 'osv-declared.json'), { ran: true, manifests: { 'requirements.txt': { resolved: ['loose@0.1.0'] } } });
  write(join(dir, 'semgrep.sarif'), semgrepSarif([
    { rule: 'r.open', level: 'error', file: 'src/a.js', line: 3, message: 'tainted input reaches eval\x1b[2J\x1b]0;owned\x07 here' },
  ]));
  const rows = [{ repo: '/src/app', slug: 'app', commit: 'abc123', cells: {
    'deps-osv': { sev: 'high', summary: '3 advisories' },
    sast: { sev: 'high', summary: '1 (1e/0w)' },
    'dast-nuclei': { sev: 'noscan', summary: 'runtime scanner did not run — no live URL' },
  } }];
  return { run, rows };
}
const KEV = { set: new Set(['CVE-2020-0002']), usable: true, freshness: { catalogVersion: '2026.10.01', state: 'fresh', ageDays: 3 } };
const EPSS = { 'CVE-2020-0001': 0.5, 'CVE-2020-0002': 0.1 };
const brief = () => { const { run, rows } = fixtureRun(); return buildBrief({ runDir: run, rows, manifest, kev: KEV, epss: EPSS, generatedAt: '2026-10-04T00:00:00.000Z' }); };

const width = (s) => [...s].length;
const press = (b, keys, rows = 24, state = initialState()) => keys.reduce((s, k) => reduce(s, k, b, { rows }), state);

test('each section lists what the brief holds, the KEV upgrade first', () => {
  const b = brief();
  const fixes = sectionItems(b, 'fixes');
  assert.deepEqual(fixes.map((f) => f.kev), [true, false]);
  assert.match(fixes[0].text, /KEV×1 .*small@2\.0\.0 → 2\.0\.5/);
  assert.equal(sectionItems(b, 'findings').length, b.issues.length);
  assert.equal(sectionItems(b, 'undetermined').length, 1);
  assert.match(sectionItems(b, 'undetermined')[0].text, /CVE-2020-0004/);
  assert.deepEqual(sectionItems(b, 'unmeasured').map((n) => n.text.trim()), ['void     app: dast-nuclei']);
  const tabs = renderScreen(initialState(), b)[2];
  for (const [i, sec] of SECTIONS.entries()) assert.ok(tabs.includes(`${i + 1} ${sec.title} (${sectionItems(b, sec.key).length})`), tabs);
});

test('every screen is exactly the terminal size and says nothing undefined, at every size and in every view', () => {
  const b = brief();
  for (const [cols, rows] of [[20, 8], [80, 24], [132, 50], [60, 11]]) {
    for (const section of SECTIONS.keys()) {
      for (const expanded of [false, true]) {
        for (const help of [false, true]) {
          const lines = renderScreen({ ...initialState(), section, expanded, help }, b, { cols, rows });
          assert.equal(lines.length, rows, `${cols}x${rows} s${section}`);
          for (const l of lines) {
            assert.equal(width(l), cols, `${cols}x${rows} s${section} e${expanded}: ${JSON.stringify(l)}`);
            assert.doesNotMatch(l, /undefined|NaN|\[object/);
          }
        }
      }
    }
  }
});

test('a control sequence a scanner reported is drawn as text, never sent to the terminal', () => {
  const b = brief();
  const at = SECTIONS.findIndex((s) => s.key === 'findings');
  for (const color of [false, true]) {
    const screen = renderScreen({ ...initialState(), section: at, expanded: true }, b, { cols: 100, rows: 30, color }).join('\n');
    assert.match(screen, /tainted input reaches eval/);
    assert.doesNotMatch(screen, /\x07|\x1b\]|\x1b\[2J/);
    if (!color) assert.doesNotMatch(screen, /\x1b/);
  }
});

test('colour is SGR only and only when asked for', () => {
  const b = brief();
  const plain = renderScreen(initialState(), b, { color: false });
  const lit = renderScreen(initialState(), b, { color: true });
  assert.ok(lit.some((l) => l.includes('\x1b[')));
  for (const l of lit) assert.doesNotMatch(l.replace(/\x1b\[[0-9;]*m/g, ''), /\x1b/);
  assert.deepEqual(lit.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '')), plain);
});

test('the cursor stays inside its list and on screen, and each section keeps its own place', () => {
  const many = { ...brief(), notMeasured: Array.from({ length: 50 }, (_, i) => ({ repo: `r${String(i).padStart(2, '0')}`, check: 'sast', kind: 'void', reason: 'tool absent' })) };
  const unmeasured = SECTIONS.findIndex((s) => s.key === 'unmeasured');
  let s = press(many, [`section${unmeasured + 1}`, ...Array(30).fill('down')]);
  assert.equal(s.cursor[unmeasured], 30);
  const screen = renderScreen(s, many);
  assert.ok(screen.some((l) => l.startsWith('› ') && l.includes('r30')), screen.join('\n'));
  const rowOf = (st) => renderScreen(st, many).findIndex((l) => l.startsWith('› '));
  assert.equal(rowOf(press(many, ['up', 'up'], 24, s)), rowOf(s) - 2, 'moving up holds the view until the cursor reaches its top');
  const tall = press(many, [`section${unmeasured + 1}`, ...Array(40).fill('down')], 60);
  assert.ok(renderScreen(tall, many, { rows: 14 }).some((l) => l.startsWith('› ') && l.includes('r40')), 'a shrunk terminal still shows the cursor');
  s = press(many, ['end', 'down'], 24, s);
  assert.equal(s.cursor[unmeasured], 49);
  s = press(many, ['home', 'up', 'pgdn'], 24, s);
  assert.ok(s.cursor[unmeasured] > 1);
  s = press(many, ['next'], 24, s);
  assert.equal(s.section, 0);
  assert.equal(s.cursor[0], 0);
  s = press(many, ['prev'], 24, s);
  assert.equal(s.section, unmeasured);
  assert.ok(s.cursor[unmeasured] > 1);
  assert.equal(press(many, ['down', 'down', 'down'], 24).cursor[0], 1);
  assert.equal(press(many, ['section9']).section, 0);
});

test('Enter gives the detail the whole screen and back; help closes on any key; q quits', () => {
  const b = brief();
  let s = press(b, ['enter']);
  assert.equal(s.expanded, true);
  assert.ok(renderScreen(s, b).some((l) => l.includes('CVE-2020-0002  med')), renderScreen(s, b).join('\n'));
  s = press(b, ['enter'], 24, s);
  assert.equal(s.expanded, false);
  s = press(b, ['help'], 24, s);
  assert.ok(renderScreen(s, b).some((l) => l.includes('previous / next section')));
  s = press(b, ['down'], 24, s);
  assert.equal(s.help, false);
  assert.equal(s.cursor[0], 0);
  assert.equal(reduce(s, 'quit', b), null);
});

test('raw keys are read as a terminal sends them, several to a chunk', () => {
  assert.deepEqual(parseKeys('\x1b[A\x1b[B\x1bOC\x1b[D'), ['up', 'down', 'next', 'prev']);
  assert.deepEqual(parseKeys('jjk\r'), ['down', 'down', 'up', 'enter']);
  assert.deepEqual(parseKeys('\x1b[5~\x1b[6~\x1b[Z\t'), ['pgup', 'pgdn', 'prev', 'next']);
  assert.deepEqual(parseKeys('2'), ['section2']);
  assert.deepEqual(parseKeys('\x1b'), ['quit']);
  assert.deepEqual(parseKeys('\x03'), ['quit']);
  assert.deepEqual(parseKeys('\x1b[15~zx'), []);
});

test('an empty brief names why each list is empty rather than drawing nothing', () => {
  const b = { ...brief(), actions: [], issues: [], undetermined: [], notMeasured: [] };
  const lines = SECTIONS.map((_, section) => renderScreen({ ...initialState(), section }, b)[3].trim());
  assert.deepEqual(lines, ['none found', 'none open', 'none', 'every in-scope lane ran']);
});

test('the viewer refuses a stream that is not a terminal', async () => {
  await assert.rejects(runBriefTui(brief(), { stdin: { isTTY: false }, stdout: { isTTY: true } }), /interactive terminal/);
});

test('brief --tui with no terminal prints the brief and says why', () => {
  const { run, rows } = fixtureRun();
  write(join(run, 'scan.json'), { repos: rows });
  try {
    const r = spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'brief', '--from', run, '--tui'],
      { encoding: 'utf8', env: { ...process.env, CW_NOW: '2026-10-04T00:00:00.000Z', NO_COLOR: '1' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /--tui needs an interactive terminal/);
    assert.match(r.stdout, /1\. Dependency fixes, CVE\/KEV first/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

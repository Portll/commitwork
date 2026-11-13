// Schedulers and what they trigger (flow/triggers.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify } from '../lexer.mjs';
import { maskFrom } from '../verify.mjs';
import {
  functionBody, timerSites, inRanges, parseLaunchdSchedule, loadLaunchdAgents, argvModule, launchdSchedulers,
  nodeScripts, parseWorkflow, parseCrontab, isCrontab, triggerFiles, analyseTriggers, LAUNCHD_GENERATOR,
} from '../triggers.mjs';

const masked = (src) => maskFrom(src, classify(src).spans).masked;
const tmp = () => mkdtempSync(join(tmpdir(), 'flow-trig-'));
const put = (root, f, text) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), text); };

test('functionBody finds declarations and arrow bindings, and null when absent or unclosed', () => {
  // arrange
  const m = masked('function tick(a) { go(); }\nconst poll = async () => { x(); };\nconst one = v => { y(); };\nfunction broken() { ');
  // act
  const got = ['tick', 'poll', 'one'].map((n) => { const b = functionBody(m, n); return m.slice(b.start, b.end + 1); });
  // assert
  assert.deepEqual(got, ['{ go(); }', '{ x(); }', '{ y(); }']);
  assert.equal(functionBody(m, 'nope'), null);
  assert.equal(functionBody(m, 'broken'), null);
  assert.equal(functionBody('function f(a { }', 'f'), null);
  assert.equal(functionBody('const g = (a) => 1;\nif (x) { y(); }', 'g'), null);
});

test('timerSites: setInterval and a self-rescheduling setTimeout are timers; a delay is not', () => {
  // arrange
  const m = masked([
    'setInterval(tick, 1000);',
    'function tick() { readFileSync(P); }',
    'function loop() { work(); setTimeout(loop, 50); }',
    'await new Promise((r) => setTimeout(r, 10));',
    'setTimeout(later, 5); function later() {}',
    'setInterval(() => { poll(); }, 5);',
  ].join('\n'));
  // act
  const t = timerSites(m);
  // assert
  assert.deepEqual(t.timers.map((x) => x.how), ['setInterval', 'setInterval', 'setTimeout-loop loop']);
  assert.ok(inRanges(t.pollRanges, m.indexOf('readFileSync')));
  assert.ok(inRanges(t.pollRanges, m.indexOf('work')));
  assert.ok(inRanges(t.pollRanges, m.indexOf('poll()')));
  assert.equal(inRanges(t.pollRanges, m.indexOf('Promise')), false);
});

test('timerSites: fs.watch / watchFile through a namespace or a named import; other .watch is ignored', () => {
  // arrange
  const m = masked("fs.watch(P); fsp.watch(Q); promises.watch(R); w(S); watchFile(T); chokidar.watch(U); setInterval(");
  // act
  const t = timerSites(m, { fsNamed: new Map([['w', 'watch'], ['watchFile', 'watchFile']]) });
  // assert
  assert.deepEqual(t.watches.map((x) => x.how), ['fs.watch', 'fsp.watch', 'promises.watch', 'w', 'watchFile']);
  assert.equal(t.timers.length, 1);
});

test('parseLaunchdSchedule reads KeepAlive, StartInterval and calendar dicts', () => {
  // arrange
  const frags = [
    '  <key>KeepAlive</key><true/>',
    '  <key>StartInterval</key><integer>3600</integer>',
    '  <key>StartCalendarInterval</key>\n  <array>\n<dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict><dict><key>Weekday</key><integer>0</integer></dict></array>',
    undefined,
  ];
  // act
  const got = frags.map(parseLaunchdSchedule);
  // assert
  assert.deepEqual(got, [
    { type: 'KeepAlive' }, { type: 'StartInterval', seconds: 3600 },
    { type: 'StartCalendarInterval', at: [{ Hour: 2, Minute: 30 }, { Weekday: 0 }] }, { type: 'unknown' },
  ]);
});

test('argvModule takes the first non-flag after node, relative to the generator root', () => {
  // arrange
  const cases = [
    [['/opt/homebrew/bin/node', '/r/monitor/sweep.mjs', 'all'], '/r'],
    [['node', '--x', 'bin/a.mjs'], '/r'],
    [[process.execPath, '/elsewhere/a.mjs'], '/r'],
    [['/bin/sh', '/r/a.sh'], '/r'],
    [['node', '--only-flags'], '/r'],
    [['node'], '/r'],
    ['nope', '/r'],
  ];
  // act
  const got = cases.map(([a, r]) => argvModule(a, r));
  // assert
  assert.deepEqual(got, ['monitor/sweep.mjs', 'bin/a.mjs', null, null, null, null, null]);
});

test('launchdSchedulers: tracked targets become triggers; the rest and a load error are sites', () => {
  // arrange
  const loaded = { cw: '/r', agents: [
    { label: 'com.x.sweep-a', argv: ['node', '/r/monitor/sweep.mjs'], schedule: '<key>StartInterval</key><integer>60</integer>', service: false },
    { label: 'com.x.panel', argv: ['node', '/r/admin/serve.mjs'], schedule: '<key>KeepAlive</key><true/>', service: true },
    { label: 'com.x.gone', argv: ['node', '/r/bin/gone.mjs'], schedule: '' },
  ] };
  const src = "const A = { label: `com.x.sweep-${s}`, argv: [NODE, join(CW, 'monitor', 'sweep.mjs')] };\nconst P = { label: 'com.x.panel' };\n";
  // act
  const r = launchdSchedulers(loaded, { root: '/r', generatorSource: src, tracked: new Set(['monitor/sweep.mjs', 'admin/serve.mjs']) });
  const bad = launchdSchedulers({ error: 'boom' }, { root: '/r' });
  // assert
  assert.deepEqual(r.schedulers.map((s) => [s.key, s.extra.schedule.type, s.targets.map((t) => `${t.module} ${t.evidence}`)]), [
    ['launchd:com.x.sweep-a', 'StartInterval', [`monitor/sweep.mjs ${LAUNCHD_GENERATOR}:1 launchd`]],
    ['launchd:com.x.panel', 'KeepAlive', [`admin/serve.mjs ${LAUNCHD_GENERATOR}:2 launchd`]],
    ['launchd:com.x.gone', 'unknown', []],
  ]);
  assert.equal(r.schedulers[1].extra.service, true);
  assert.deepEqual(r.sites.map((s) => s.reason), ['com.x.gone runs no tracked module (bin/gone.mjs)']);
  assert.deepEqual(bad.sites.map((s) => s.reason), ['boom']);
});

test('loadLaunchdAgents imports the generator in a child; a throwing or silent one is an error', () => {
  // arrange
  const ok = tmp();
  put(ok, LAUNCHD_GENERATOR, "export const CW = '/cw';\nexport const AGENTS = [{ label: 'l', argv: ['node', '/cw/a.mjs'], schedule: 's', extra: 1 }];\n");
  const bad = tmp();
  put(bad, LAUNCHD_GENERATOR, "throw new Error('no areas');\n");
  const odd = tmp();
  put(odd, LAUNCHD_GENERATOR, "process.stdout.write('not json'); export const AGENTS = [];\n");
  // act
  const a = loadLaunchdAgents(ok, { env: { ...process.env, NODE_TEST_CONTEXT: 'x' } });
  const b = loadLaunchdAgents(bad);
  const c = loadLaunchdAgents(odd);
  // assert
  assert.deepEqual(a, { cw: '/cw', agents: [{ label: 'l', argv: ['node', '/cw/a.mjs'], schedule: 's', service: false }] });
  assert.match(b.error, /^generator import failed: .*no areas/);
  assert.match(c.error, /^generator output unreadable/);
  for (const d of [ok, bad, odd]) rmSync(d, { recursive: true, force: true });
});

test('nodeScripts finds node <script> past options', () => {
  // arrange
  const sh = 'set -e; node --test-reporter=spec --x ./bin/a.mjs --json && (node lib/b.cjs) | node -e "x"';
  // act
  const got = nodeScripts(sh);
  // assert
  assert.deepEqual(got, ['bin/a.mjs', 'lib/b.cjs']);
});

test('parseWorkflow: cron entries under on.schedule and node scripts in run steps', () => {
  // arrange
  const yml = [
    'name: x',
    'on:',
    '  push:',
    '  schedule:   # weekly',
    "    - cron: '17 4 * * 1'",
    '    - cron: "0 0 * * *"',
    '  workflow_dispatch:',
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: node bin/one.mjs --x',
    '      - name: two',
    '        run: |',
    '          echo hi',
    '          node bin/two.mjs',
    '',
    '      - run: echo no',
  ].join('\n');
  // act
  const wf = parseWorkflow(yml);
  const none = parseWorkflow('on:\n  push:\njobs: {}\n');
  // assert
  assert.deepEqual(wf, { cron: ['17 4 * * 1', '0 0 * * *'], runs: [{ line: 11, script: 'bin/one.mjs' }, { line: 15, script: 'bin/two.mjs' }] });
  assert.equal(none, null);
});

test('parseCrontab reads schedule lines that run node and skips comments and env lines', () => {
  // arrange
  const tab = '# c\nPATH=/bin\n\n*/5 * * * * cd /r && node bin/a.mjs\n@daily node monitor/b.mjs\nbad line\n0 1 * * * echo x\n';
  // act
  const got = parseCrontab(tab);
  // assert
  assert.deepEqual(got, [{ line: 4, schedule: '*/5 * * * *', script: 'bin/a.mjs' }, { line: 5, schedule: '@daily', script: 'monitor/b.mjs' }]);
  assert.deepEqual(['crontab', 'ops/x.cron', 'a/b.crontab', 'cron.md'].map(isCrontab), [true, true, true, false]);
});

test('triggerFiles: from git ls-files in a checkout, from the two directories otherwise', () => {
  // arrange
  const plain = tmp();
  put(plain, '.github/workflows/a.yml', 'on: push\n');
  put(plain, 'workflows/b.yaml', 'on: push\n');
  put(plain, 'workflows/c.md', '');
  const repo = tmp();
  put(repo, '.github/workflows/w.yml', 'on: push\n');
  put(repo, 'ops/crontab', '');
  put(repo, 'untracked/x.cron', '');
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'add', '.github', 'ops']);
  // act
  const lister = () => execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const a = triggerFiles(plain);
  const b = triggerFiles(repo, lister);
  const c = triggerFiles(plain, () => { throw new Error('not a checkout'); });
  // assert
  assert.deepEqual(a, { workflows: ['.github/workflows/a.yml', 'workflows/b.yaml'], crontabs: [] });
  assert.deepEqual(b, { workflows: ['.github/workflows/w.yml'], crontabs: ['ops/crontab'] });
  assert.deepEqual(c, a);
  for (const d of [plain, repo]) rmSync(d, { recursive: true, force: true });
});

test('analyseTriggers assembles every source into schedulers with targets and sites', () => {
  // arrange
  const root = tmp();
  put(root, '.github/workflows/s.yml', "on:\n  schedule:\n    - cron: '1 2 * * *'\njobs:\n  a:\n    steps:\n      - run: node bin/a.mjs && node bin/missing.mjs\n");
  put(root, '.github/workflows/p.yml', 'on: push\n');
  put(root, 'ops/crontab', '0 * * * * node bin/a.mjs\n0 * * * * node bin/nope.mjs\n');
  put(root, 'ops/empty.cron', '# nothing\n');
  const modules = [
    { path: 'bin/a.mjs', state: 'analysed', triggers: { timers: [{ evidence: 'bin/a.mjs:3 setInterval' }], watches: [] } },
    { path: 'bin/w.mjs', state: 'analysed', triggers: { timers: [], watches: [{ evidence: 'bin/w.mjs:1 fs.watch' }] } },
    { path: 'bin/u.mjs', state: 'unparseable' },
    { path: 'bin/n.mjs', state: 'analysed' },
  ];
  const launchd = { agents: [{ label: 'l', argv: ['node', join(root, 'bin/a.mjs')], schedule: '' }] };
  // act
  const r = analyseTriggers({ root, files: ['bin/a.mjs', 'bin/w.mjs'], modules, launchd,
    workflows: ['.github/workflows/s.yml', '.github/workflows/p.yml', '.github/workflows/absent.yml'], crontabs: ['ops/crontab', 'ops/empty.cron'] });
  const discovered = analyseTriggers({ root, files: [] });
  // assert
  assert.deepEqual(r.schedulers.map((s) => [s.key, s.targets.map((t) => t.evidence)]), [
    ['launchd:l', ['monitor/install-agents.mjs:1 launchd']],
    ['workflow:.github/workflows/s.yml#schedule', ['.github/workflows/s.yml:7 workflow-run']],
    ['cron:ops/crontab', ['ops/crontab:1 cron']],
    ['timer:bin/a.mjs', ['bin/a.mjs:3 setInterval']],
    ['watch:bin/w.mjs', ['bin/w.mjs:1 fs.watch']],
  ]);
  assert.deepEqual(r.schedulers[1].extra, { cron: ['1 2 * * *'] });
  assert.deepEqual(r.sites.map((s) => `${s.kind} ${s.reason}`), ['workflow node bin/missing.mjs is not a tracked module', 'cron node bin/nope.mjs is not a tracked module']);
  assert.deepEqual(discovered.schedulers.map((s) => s.key), ['workflow:.github/workflows/s.yml#schedule']);
  rmSync(root, { recursive: true, force: true });
});

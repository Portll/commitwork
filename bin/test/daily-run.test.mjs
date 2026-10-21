// bin/daily-run.mjs end to end on a synthetic area: a fake claude (refused once, then right), a fake
// veld, the report envelope, the run record, the todos, and a second run that files nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyFixture, AREA } from '../../monitor/test/lib/daily-fixture.mjs';
import { rows } from '../../monitor/test/lib/daily-fixture.mjs';
import { clearFailure, envelopeFor, main, noticeFailure, resolveSkill, syncTodos } from '../daily-run.mjs';
import { validateReport } from '../../monitor/daily-validate.mjs';
import { acquireLock, inspectLock } from '../../monitor/lockfile.mjs';

const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('--version')) { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const counter = process.env.FAKE_COUNTER;
const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
fs.writeFileSync(counter, String(n));
fs.appendFileSync(process.env.FAKE_ARGS, JSON.stringify(process.argv.slice(2)) + '\\n');
fs.appendFileSync(process.env.FAKE_CWD, process.cwd() + ' ' + fs.readdirSync(process.cwd()).length + '\\n');
const input = fs.readFileSync(0, 'utf8');
const digest = JSON.parse(input.split('<digest>\\n')[1].split('\\n</digest>')[0]);
const items = digest.repos.flatMap((r) => r.items.map((i) => ({ ...i, repo: r.name })));
const [first, ...rest] = items;
const out = {
  headline: 'One new injection; fix it first.',
  suggestions: first ? [{ id: 'S1', repo: first.repo, findingIds: [first.id], priority: 'p0', title: 'Fix it', why: 'w', where: [{ file: first.file, line: first.lines[0] }], change: 'c', verify: { lane: first.lane, expect: 'gone' }, effort: 'S', confidence: 'high' }] : [],
  notActioned: rest.map((i) => ({ findingId: i.id, reason: 'low-value', note: 'n' })),
};
if (n === 1) out.notActioned.push({ findingId: '0123456789abcdef', reason: 'low-value', note: 'invented' });
console.log(JSON.stringify({ is_error: false, subtype: 'success', structured_output: out, total_cost_usd: 0.25, usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 10 }, modelUsage: { 'claude-test': { outputTokens: 10 } } }));
`;

function fakeVeld() {
  const todos = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (req.headers.authorization !== 'Bearer test-key') { res.writeHead(401); res.end('{}'); return; }
      let out = { success: true };
      if (req.url === '/api/todos/list') out = { success: true, todos };
      else if (req.url === '/api/todos/add') { const t = { id: `t${todos.length + 1}`, status: 'todo', tags: b.tags, external_id: b.external_id, content: b.content, priority: b.priority, project: b.project }; todos.push(t); out = { success: true, todo: t }; }
      else if (/\/complete$/.test(req.url)) { const t = todos.find((x) => req.url.includes(x.id)); if (t) t.status = 'done'; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, todos, url: `http://127.0.0.1:${server.address().port}` })));
}

test('envelopeFor counts from the digest and lists every lane that did not run', () => {
  const env = envelopeFor({
    gapDays: 1,
    repos: [{ name: 'r', baseline: null, items: [{ state: 'new' }, { state: 'persisting' }], fixed: [{}], carried: ['x'], omittedIds: ['y'],
      lanes: [{ lane: 'a', state: 'ran', toolChanged: false }, { lane: 'b', state: 'failed' }, { lane: 'c', state: 'ran', toolChanged: true, previousToolVersion: '1', toolVersion: '2' }] }],
  });
  assert.deepEqual(env.summary, { new: 1, persisting: 1, fixed: 1, carried: 1, omitted: 1, voidLanes: 1, gapDays: 1, baselineRepos: [] });
  assert.deepEqual(env.coverage.map((c) => c.state), ['failed', 'tool-changed']);
});

test('a scheduled run writes a validated report after one refusal, files the todos, and a re-run does nothing', async (t) => {
  const fx = dailyFixture({ previousRows: { sastSemgrep: [rows.gone] }, currentRows: { sastSemgrep: [rows.exec, rows.renamed] } });
  const bin = join(fx.root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE); chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(bin, 'osascript'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'osascript'), 0o755);
  const skill = join(fx.root, 'daily.md');
  writeFileSync(skill, 'skill text');
  const veld = await fakeVeld();
  t.after(() => veld.server.close());
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, {
    CW_REGISTRY: fx.registry, CW_DAILY_CONFIG: fx.configPath, CW_CLAUDE_BIN: join(bin, 'claude'), CW_DAILY_SKILL: skill,
    CW_NOW: '2026-10-02T01:00:00Z', CW_VELD_URL: veld.url, CW_VELD_USER: 'tester', VELD_API_KEY: 'test-key',
    FAKE_COUNTER: join(fx.root, 'count'), FAKE_ARGS: join(fx.root, 'args'), FAKE_CWD: join(fx.root, 'cwd'), PATH: `${bin}:${process.env.PATH}`,
  });

  assert.equal(await main(['--area', AREA]), 0);
  const daily = join(fx.areaOut, 'daily');
  const report = JSON.parse(readFileSync(join(daily, 'sweep-20261002000000.json'), 'utf8'));
  assert.deepEqual(validateReport(report), []);
  assert.equal(report.run.attempts, 2, 'the first answer was refused and the second accepted');
  assert.equal(report.run.costUsd, 0.5);
  assert.equal(report.run.cli, '9.9.9 (Claude Code)');
  assert.equal(report.summary.new, 2);
  assert.equal(report.summary.fixed, 1);
  assert.deepEqual(report.coverage.map((c) => [c.lane, c.state, c.note ?? null]), [['sast-joern', 'void', 'the tool exited 2'], ['sbom-syft', 'failed', null]], 'a lane that does not apply is not a gap');
  const args = readFileSync(join(fx.root, 'args'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const a of args) {
    assert.equal(a[a.indexOf('--tools') + 1], '', 'the model runs with no tools');
    assert.ok(a.includes('--strict-mcp-config') && a.includes('--json-schema') && a.includes('--no-session-persistence'));
    assert.equal(a[a.indexOf('--append-system-prompt-file') + 1], skill);
    assert.equal(a[a.indexOf('--max-budget-usd') + 1], '8', 'every attempt carries a spend cap');
  }
  for (const line of readFileSync(join(fx.root, 'cwd'), 'utf8').trim().split('\n')) {
    const [dir, entries] = line.split(' ');
    assert.match(dir, /cw-daily-run-/, 'the model runs in its own empty directory');
    assert.equal(entries, '0');
    assert.ok(!existsSync(dir), 'and the directory is removed');
  }
  assert.equal(report.run.skillSha256, createHash('sha256').update('skill text').digest('hex'));
  const run = JSON.parse(readFileSync(join(daily, 'sweep-20261002000000.run.json'), 'utf8'));
  assert.deepEqual(run.attempts[1].tokens, { input: 100, cacheRead: 50, cacheWrite: null, output: 10 });
  assert.equal(veld.todos.length, 1);
  assert.equal(veld.todos[0].priority, 'urgent');
  const todos = JSON.parse(readFileSync(join(daily, 'sweep-20261002000000.todos.json'), 'utf8'));
  assert.deepEqual(todos.created, ['t1']);
  assert.ok(existsSync(join(daily, 'sweep-20261002000000.digest.json')));
  assert.ok(existsSync(join(daily, 'ledger.json')));
  assert.ok(!existsSync(join(daily, '.lock')));

  assert.equal(await main(['--area', AREA]), 0);
  assert.equal(Number(readFileSync(join(fx.root, 'count'), 'utf8')), 2, 'a reported batch is not sent to the model again');
  assert.equal(veld.todos.length, 1);
});

test('a model that never answers within the schema leaves a failed run record and no report', async (t) => {
  // The stubs drain stdin before answering. A stub that exits first races the prompt write, and the
  // run then fails on EPIPE instead of on the missing schema.
  const fx = dailyFixture({ previousRows: {}, currentRows: { sastSemgrep: [rows.exec] } });
  const bin = join(fx.root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat >/dev/null\necho x >> ${join(fx.root, 'calls')}\necho '{"is_error":true,"subtype":"error_max_turns","result":"no"}'\n`); chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(bin, 'osascript'), `#!/bin/sh\necho "$2" >> ${join(fx.root, 'notices')}\n`); chmodSync(join(bin, 'osascript'), 0o755);
  writeFileSync(join(fx.root, 'daily.md'), 'skill');
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, { CW_REGISTRY: fx.registry, CW_DAILY_CONFIG: fx.configPath, CW_CLAUDE_BIN: join(bin, 'claude'), CW_DAILY_SKILL: join(fx.root, 'daily.md'), PATH: `${bin}:${process.env.PATH}` });
  assert.equal(await main(['--area', AREA, '--no-todos']), 1);
  const daily = join(fx.areaOut, 'daily');
  assert.ok(!existsSync(join(daily, 'sweep-20261002000000.json')));
  const run = JSON.parse(readFileSync(join(daily, 'sweep-20261002000000.run.json'), 'utf8'));
  assert.equal(run.ok, false);
  assert.match(run.attempts[0].error, /no structured output/);
  const calls = () => readFileSync(join(fx.root, 'calls'), 'utf8').trim().split('\n').length;
  const notices = () => readFileSync(join(fx.root, 'notices'), 'utf8').trim().split('\n').length;
  assert.equal(calls(), 1, 'the failed attempt is not retried within the run when claude itself errored');
  assert.equal(await main(['--area', AREA, '--no-todos']), 0, 'the next pass skips a batch whose model run failed');
  assert.equal(calls(), 1);
  assert.equal(notices(), 1, 'and does not notify again');
  assert.equal(await main(['--area', AREA, '--no-todos', '--force']), 1);
  assert.equal(calls(), 2, '--force tries again');
  assert.equal(notices(), 1, 'the same failure within a day does not notify twice');
});

test('a run the area lock is held against does nothing, and leaves the holder its lock', async (t) => {
  const fx = dailyFixture({ previousRows: {}, currentRows: { sastSemgrep: [rows.exec] } });
  const bin = join(fx.root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat >/dev/null\necho x >> ${join(fx.root, 'calls')}\necho '{"is_error":true,"subtype":"error_max_turns","result":"no"}'\n`); chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(bin, 'osascript'), '#!/bin/sh\n'); chmodSync(join(bin, 'osascript'), 0o755);
  writeFileSync(join(fx.root, 'daily.md'), 'skill');
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, { CW_REGISTRY: fx.registry, CW_DAILY_CONFIG: fx.configPath, CW_CLAUDE_BIN: join(bin, 'claude'), CW_DAILY_SKILL: join(fx.root, 'daily.md'), PATH: `${bin}:${process.env.PATH}` });
  const held = acquireLock(join(fx.areaOut, 'daily', '.lock'), { label: 'another daily run' });
  assert.ok(held.ok);
  assert.equal(await main(['--area', AREA, '--no-todos']), 0);
  assert.ok(!existsSync(join(fx.root, 'calls')), 'the model is not called');
  assert.equal(inspectLock(held.path).holder.nonce, held.token.nonce, 'the holder keeps its lock');
  held.release();
  assert.equal(await main(['--area', AREA, '--no-todos']), 1);
  assert.equal(readFileSync(join(fx.root, 'calls'), 'utf8').trim().split('\n').length, 1, 'once released, the run goes ahead');
  assert.ok(!inspectLock(held.path).held, 'and releases the lock it took');
});

test('a refused suggestions file leaves no run record, and one for a reported batch is refused', async (t) => {
  const fx = dailyFixture({ previousRows: {}, currentRows: { sastSemgrep: [rows.exec] } });
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, { CW_REGISTRY: fx.registry, CW_DAILY_CONFIG: fx.configPath });
  const bad = join(fx.root, 'bad.json');
  writeFileSync(bad, JSON.stringify({ headline: 'h', suggestions: [], notActioned: [] }));
  assert.equal(await main(['--area', AREA, '--no-todos', '--suggestions', bad]), 1);
  const daily = join(fx.areaOut, 'daily');
  assert.ok(!existsSync(join(daily, 'sweep-20261002000000.run.json')));
  const digest = JSON.parse(readFileSync(join(daily, 'sweep-20261002000000.digest.json'), 'utf8'));
  const id = digest.repos[0].items[0].id;
  const good = join(fx.root, 'good.json');
  writeFileSync(good, JSON.stringify({ headline: 'h', suggestions: [], notActioned: [{ findingId: id, reason: 'low-value', note: 'n' }] }));
  assert.equal(await main(['--area', AREA, '--no-todos', '--suggestions', good]), 0);
  assert.equal(await main(['--area', AREA, '--no-todos', '--suggestions', good]), 1, 'a second file for a reported batch needs --force');
  assert.equal(await main(['--area', AREA, '--no-todos', '--suggestions', good, '--force']), 0);
});

test('a failure notifies when it appears, when it changes, and once a day while it lasts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-daily-notice-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'osascript'), `#!/bin/sh\necho "$2" >> ${join(root, 'notices')}\n`); chmodSync(join(bin, 'osascript'), 0o755);
  const saved = process.env.PATH;
  t.after(() => { process.env.PATH = saved; });
  process.env.PATH = `${bin}:${saved}`;
  const state = join(root, 'state.json');
  const t0 = new Date('2026-10-03T00:00:00Z');
  assert.equal(noticeFailure(state, 'ar', 'skill not committed', t0), true);
  assert.equal(noticeFailure(state, 'ar', 'skill not committed', new Date(t0.getTime() + 30 * 60_000)), false);
  assert.equal(noticeFailure(state, 'ar', 'anchor moved', new Date(t0.getTime() + 60 * 60_000)), true);
  assert.equal(noticeFailure(state, 'ar', 'anchor moved', new Date(t0.getTime() + 25 * 3_600_000)), true);
  clearFailure(state, 'ar');
  assert.equal(noticeFailure(state, 'ar', 'anchor moved', new Date(t0.getTime() + 26 * 3_600_000)), true);
  assert.equal(readFileSync(join(root, 'notices'), 'utf8').trim().split('\n').length, 4);
});

test('a plain-http veld URL off this machine is refused before the key is read', async () => {
  const r = await syncTodos({ report: {}, digest: {}, dailyDir: '/nonexistent', areaConfig: {}, reportPath: '/x', env: { CW_VELD_URL: 'http://veld.example.com:3030', VELD_API_KEY: 'k' } });
  assert.match(r.errors[0], /plain http off this machine/);
});

test('the skill text comes from the linked repository\'s HEAD, never its working tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-daily-skill-test-'));
  const repo = join(root, 'spine');
  mkdirSync(join(repo, 'cmds'), { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'f', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'f', GIT_COMMITTER_EMAIL: 'f@example.invalid' };
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env, stdio: 'pipe' });
  git('init', '-q');
  writeFileSync(join(repo, 'cmds', 'daily.md'), 'committed text');
  git('add', '-A'); git('commit', '-q', '-m', 'seed');
  writeFileSync(join(repo, 'cmds', 'daily.md'), 'half-written edit');
  const link = join(root, 'daily.md');
  symlinkSync(join(repo, 'cmds', 'daily.md'), link);
  const s = resolveSkill({}, link);
  try {
    assert.equal(readFileSync(s.path, 'utf8'), 'committed text');
    assert.match(s.source, /^cmds\/daily.md@[0-9a-f]{12}$/);
  } finally { s.cleanup(); }
  assert.ok(!existsSync(s.path));
  writeFileSync(join(repo, 'cmds', 'new.md'), 'x');
  const link2 = join(root, 'new.md');
  symlinkSync(join(repo, 'cmds', 'new.md'), link2);
  assert.throws(() => resolveSkill({}, link2), /is not committed/);
});

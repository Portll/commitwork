// cobolwork remediation: the edit contract, the engines at their seams, the route's refusals, and
// the whole draft -> gate -> apply -> verify path on a scratch repository. cobolwork is a stand-in,
// fixtures/cobolwork-fake.mjs, so every host gets the same answers; CW_COBOLWORK_TEST_BIN names a
// real cobolwork to run the same tests against instead.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorsFrom, validateEdits, renderEdits, columnsFor, draftPrompt, remediate, jobIdFor, refFor, applyLodged, commitMessage, verifyApplied } from '../cobolwork-remediation.mjs';
import { runCobolwork } from '../cobolwork-bridge.mjs';
import { lmStudioDrafter, resolveLocalModel, claudeReviewer } from '../cobolwork-remediation-engines.mjs';
import { draftingAllowed, newJob, runJob, applyJob, verifyJob, readJob } from '../cobolwork-remediation-jobs.mjs';
import { routes } from '../../admin/routes/cobolwork-remediation.mjs';
import { isUnknown } from '../../monitor/unknown.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-cobolremed-'));
const COBOLWORK = process.env.CW_COBOLWORK_TEST_BIN || join(CW, 'lib', 'test', 'fixtures', 'cobolwork-fake.mjs');
const ENV_KEYS = ['CW_COBOLWORK_BIN', 'COBOLWORK_FREE_MEMORY_MB', 'CW_REMEDIATION_POLICY', 'CW_VERDICT_DIR', 'CW_NOW'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

before(() => {
  process.env.CW_COBOLWORK_BIN = COBOLWORK;
  // cobolwork's memory guard reads the whole machine; a test pins it so a busy box cannot stop a scan.
  process.env.COBOLWORK_FREE_MEMORY_MB = '4096';
  process.env.CW_VERDICT_DIR = join(TMP, 'verdicts');
});
after(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const cobol = (lines) => lines.map((l) => { if (l.length > 72) throw new Error(`past column 72: ${l}`); return l; }).join('\n') + '\n';
const PROGRAM = cobol([
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. P.',
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01 WS-IN               PIC X(8).',
  '       01 WS-CMD              PIC X(80).',
  '       PROCEDURE DIVISION.',
  '           ACCEPT WS-IN FROM COMMAND-LINE',
  '           MOVE WS-IN TO WS-CMD',
  "           CALL 'SYSTEM' USING WS-CMD",
  '           GOBACK.',
]);
const ACCEPT_LINE = 8, MOVE_LINE = 9, CALL_LINE = 10;

function repo(name) {
  const root = join(TMP, name);
  git(TMP, 'init', '-q', name);
  for (const [k, v] of [['user.email', 'operator@example.invalid'], ['user.name', 'operator'], ['core.autocrlf', 'false']]) git(root, 'config', k, v);
  writeFileSync(join(root, 'P.cbl'), PROGRAM);
  writeFileSync(join(root, 'README.txt'), 'a repository under remediation\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  return root;
}
async function fingerprintIn(root) {
  const r = await runCobolwork(['scan', root, '--only', 'flow']);
  assert.ok(r.ok, `cobolwork scan ran: ${r.reason || r.stderr}`);
  return r.json.findings.find((f) => f.rule === 'argv-or-env-to-os-command').fingerprint;
}
// A drafter that answers from a script, one entry per attempt, and keeps every prompt it was shown.
function scripted(drafts) {
  const prompts = [];
  const fn = async ({ prompt, attempt }) => { prompts.push(prompt); return { ok: true, draft: drafts[attempt - 1], engine: { engine: 'script' } }; };
  fn.prompts = prompts;
  return fn;
}
const ALLOW = ['     EVALUATE WS-IN', "        WHEN 'DAILY'", "        WHEN 'MONTHLY'", '           CONTINUE', '        WHEN OTHER', '           GOBACK', '     END-EVALUATE'];
const LETTERS = ['     IF WS-IN IS NOT ALPHABETIC', '        GOBACK', '     END-IF'];

// ── the edit contract, without the scanner ───────────────────────────────────────────────────────
const PACKET = {
  finding: { rule: 'argv-or-env-to-os-command', path: 'P.cbl', line: CALL_LINE },
  hops: [{ n: 1, path: 'P.cbl', line: ACCEPT_LINE, code: '     ACCEPT WS-IN FROM COMMAND-LINE', via: 'source' },
    { n: 2, path: 'P.cbl', line: MOVE_LINE, code: '     MOVE WS-IN TO WS-CMD', via: 'MOVE' }],
  sink: { path: 'P.cbl', line: CALL_LINE, code: "     CALL 'SYSTEM' USING WS-CMD" },
  related: [{ path: 'P.cbl', line: 3, code: null, withheld: 'agent-directive-in-comment' }],
  declarations: [{ path: 'P.cbl', line: 6, item: 'WS-CMD', level: 1, picture: 'X(80)', section: 'WORKING-STORAGE' }],
};

test('only a line the packet quotes is edited; a named declaration takes lines beside it; a withheld line takes nothing', () => {
  const a = anchorsFrom(PACKET);
  const check = (e) => validateEdits({ edits: [e] }, a);
  assert.equal(check({ path: 'P.cbl', line: CALL_LINE, op: 'delete', code: [] }).ok, true);
  assert.match(check({ path: 'P.cbl', line: 2, op: 'delete', code: [] }).reasons[0], /not a line the packet quotes/);
  assert.match(check({ path: 'P.cbl', line: 3, op: 'insert-after', code: ['     CONTINUE'] }).reasons[0], /withheld/);
  assert.match(check({ path: 'P.cbl', line: 6, op: 'replace', code: ['       01 X PIC X.'] }).reasons[0], /not quote/);
  assert.equal(check({ path: 'P.cbl', line: 6, op: 'insert-after', code: ['     01 WS-OK PIC X.'] }).ok, true);
  assert.match(check({ path: 'OTHER.cbl', line: CALL_LINE, op: 'delete', code: [] }).reasons[0], /not a line the packet quotes/);
  assert.match(check({ path: 'P.cbl', line: CALL_LINE, op: 'replace', code: [`     CALL ${String.fromCharCode(0x202e)}`] }).reasons[0], /printable ASCII/);
  assert.match(validateEdits({ edits: [{ path: 'P.cbl', line: CALL_LINE, op: 'delete', code: [] }, { path: 'P.cbl', line: CALL_LINE, op: 'replace', code: ['     GOBACK'] }] }, a).reasons[0], /already replaced/);
});

test('new lines take the file\'s columns and line endings, and a line past column 72 or in the indicator column is refused', () => {
  const a = anchorsFrom(PACKET);
  const crlf = PROGRAM.split('\n').join('\r\n');
  const r = renderEdits('P.cbl', crlf, [{ path: 'P.cbl', line: ACCEPT_LINE, op: 'insert-after', code: ['     IF WS-IN IS NOT ALPHABETIC', '        GOBACK', '     END-IF'] }], a);
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(r.columns, 'fixed');
  const lines = r.text.split('\r\n');
  assert.equal(lines[ACCEPT_LINE], '           IF WS-IN IS NOT ALPHABETIC');
  assert.equal(lines[ACCEPT_LINE + 1], '              GOBACK');
  assert.ok(r.text.endsWith('GOBACK.\r\n'), 'the trailing line ending is kept');
  assert.ok(!/[^\r]\n/.test(r.text), 'no bare LF in a CRLF file');
  assert.match(renderEdits('P.cbl', PROGRAM, [{ path: 'P.cbl', line: CALL_LINE, op: 'replace', code: [`     ${'X'.repeat(62)}`] }], a).reasons[0], /past column 72/);
  assert.match(renderEdits('P.cbl', PROGRAM, [{ path: 'P.cbl', line: CALL_LINE, op: 'replace', code: ['*    HIDDEN'] }], a).reasons[0], /indicator column/);
  assert.match(columnsFor('P.cbl', PROGRAM.split('\n'), [{ line: CALL_LINE, code: 'something else' }]).reason, /do not match the base/);
});

// ── the engines, at their seams ──────────────────────────────────────────────────────────────────
function stubServer(handler) {
  return new Promise((res) => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
}
function withEnv(vars, fn) {
  const held = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return Promise.resolve().then(fn).finally(() => { for (const [k, v] of Object.entries(held)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('the drafter does not go through fetch, which drops an answer slower than 300 s, and its own timeout still ends a wait', async () => {
  const server = await stubServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/slow/v1/chat/completions') return;
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ rationale: 'r', edits: [] }) } }] }));
    });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fetch was called'); };
  try {
    await withEnv({ LM_BASE: base, CW_LLM_URL_LMSTUDIO: undefined, CW_LMSTUDIO_URL: undefined, CW_COBOLWORK_LOCAL_TIMEOUT_MS: '300' }, async () => {
      const r = await lmStudioDrafter({ model: 'm' })({ prompt: { system: 's', user: 'u' } });
      assert.equal(r.ok, true, r.error);
      process.env.LM_BASE = `${base}/slow`;
      const slow = await lmStudioDrafter({ model: 'm' })({ prompt: { system: 's', user: 'u' } });
      assert.equal(slow.ok, false);
      assert.match(slow.error, /did not answer within/);
    });
  } finally { globalThis.fetch = realFetch; server.closeAllConnections(); server.close(); }
});

test('the drafter asks LM Studio at LM_BASE with the launcher\'s token, temperature 0, reasoning none and the draft schema, and the token is never echoed', async () => {
  const token = `token-${Date.now()}`;
  const seen = [];
  const server = await stubServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'text-embedding-x' }, { id: 'qwen/qwen3.8-27b' }] })); return; }
      if (seen.length > 3) { res.statusCode = 401; res.end('{}'); return; }
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ rationale: 'r', edits: [{ path: 'P.cbl', line: CALL_LINE, op: 'delete', code: [] }] }) } }] }));
    });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await withEnv({ LM_BASE: base, LM_API_TOKEN: token, CW_LLM_URL_LMSTUDIO: undefined, CW_LMSTUDIO_URL: undefined, CW_COBOLWORK_LOCAL_MODEL: undefined, CW_CODEQL_LOCAL_MODEL: undefined, CW_COBOLWORK_LOCAL_REASONING: undefined }, async () => {
      const m = await resolveLocalModel();
      assert.deepEqual(m, { ok: true, model: 'qwen/qwen3.8-27b', pinned: false });
      const draft = lmStudioDrafter({ model: m.model });
      const r = await draft({ prompt: { system: 's', user: 'u' } });
      assert.equal(r.ok, true);
      assert.equal(r.draft.edits[0].op, 'delete');
      const call = seen.find((s) => s.url === '/v1/chat/completions');
      assert.equal(call.auth, `Bearer ${token}`);
      assert.equal(call.body.temperature, 0);
      assert.equal(call.body.reasoning_effort, 'none');
      assert.equal(call.body.response_format.json_schema.name, 'cobolwork_remediation_draft');
      await draft({ prompt: { system: 's', user: 'u' } });
      const refused = await draft({ prompt: { system: 's', user: 'u' } });
      assert.equal(refused.ok, false);
      assert.match(refused.error, /launcher/);
      assert.equal(JSON.stringify(refused).includes(token), false);
    });
  } finally { server.close(); }
});

test('the reviewer runs claude -p at its seam and reads {agrees, concerns}', async () => {
  const stub = join(TMP, 'claude-stub.mjs');
  writeFileSync(stub, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({result:JSON.stringify({agrees:s.includes('drafted diff'),concerns:'none'})})));\n");
  await withEnv({ CW_COBOLWORK_CLAUDE_CMD: `"${process.execPath}" "${stub}"` }, async () => {
    const r = await claudeReviewer()({ prompt: 'the drafted diff' });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.review, { agrees: true, concerns: 'none' });
  });
});

// ── policy and the route's refusals ──────────────────────────────────────────────────────────────
function policy(mode) {
  const p = join(TMP, `policy-${mode}.json`);
  writeFileSync(p, JSON.stringify({ mode }));
  process.env.CW_REMEDIATION_POLICY = p;
}
const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
function call(r, body, { loopback = false } = {}) {
  return new Promise((done) => {
    const ctx = {
      req: {}, isLoopbackReq: loopback, adminSession: () => null, knownProjects: () => new Set(), query: new URLSearchParams(),
      readJsonBody: (req, cb) => cb(body, null), send: (status, json) => done({ status, json }),
    };
    r.handle(ctx);
  });
}

test('report mode drafts nothing, an absent policy is report mode, a malformed one refuses, and hitl-item allows a draft', () => {
  policy('report');
  assert.match(draftingAllowed().error, /report mode/);
  process.env.CW_REMEDIATION_POLICY = join(TMP, 'no-policy-here.json');
  assert.match(draftingAllowed().error, /report mode \(default\)/);
  const broken = join(TMP, 'policy-broken.json');
  writeFileSync(broken, '{ "mode": "hitl-item", ');
  process.env.CW_REMEDIATION_POLICY = broken;
  assert.throws(() => draftingAllowed(), /corrupt/);
  policy('hitl-item');
  assert.equal(draftingAllowed().ok, true);
});

test('the route refuses to run without a session or the operator port, and refuses a draft in report mode', async () => {
  const start = route('POST', '/api/cobolwork/remediate');
  assert.equal((await call(start, { repo: 'r', fingerprint: 'a'.repeat(32) })).status, 401);
  policy('report');
  const r = await call(start, { repo: 'r', fingerprint: 'a'.repeat(32) }, { loopback: true });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /report mode/);
  assert.equal((await call(route('POST', '/api/cobolwork/remediate/apply'), { id: 'nope' }, { loopback: true })).status, 400);
  assert.equal((await call(route('POST', '/api/cobolwork/remediate/apply'), { id: 'a'.repeat(16) })).status, 401);
});

// ── the pipeline, through cobolwork's commands───────────────────────────────────────────────────
test('a fingerprint the base does not hold is refused, and a missing cobolwork leaves the finding unscanned rather than drafted',  async () => {
  const root = repo('unknown');
  const d = scripted([]);
  const r = await remediate({ repoPath: root, fingerprint: '0'.repeat(32), jobId: 'a'.repeat(16), drafter: d });
  assert.equal(r.state, 'refused');
  assert.match(r.error, /no finding with fingerprint/, 'refused because the base holds no such finding, not because cobolwork could not look');
  assert.equal(d.prompts.length, 0);
  await withEnv({ CW_COBOLWORK_BIN: join(TMP, 'no-such-cobolwork') }, async () => {
    const u = await remediate({ repoPath: root, fingerprint: '0'.repeat(32), jobId: 'a'.repeat(16), drafter: d });
    assert.equal(u.state, 'unscanned');
    assert.match(u.error, /not drafted/);
  });
});

let main;
test('a refused edit and a failed draft feed their reasons to the next attempt, and the third attempt passes',  async () => {
  const root = repo('main');
  // The operator's own uncommitted work, which nothing before apply may touch.
  writeFileSync(join(root, 'README.txt'), 'the operator is editing this\n');
  writeFileSync(join(root, 'notes.txt'), 'untracked\n');
  const head = git(root, 'rev-parse', 'HEAD');
  const status = git(root, 'status', '--porcelain');
  const fp = await fingerprintIn(root);
  const drafter = scripted([
    { rationale: 'edits a line it was not shown', edits: [{ path: 'P.cbl', line: 2, op: 'delete', code: [] }] },
    { rationale: 'rewords the call', edits: [{ path: 'P.cbl', line: CALL_LINE, op: 'replace', code: ['     CALL "SYSTEM" USING WS-CMD'] }] },
    { rationale: 'allows two reports and ends the run otherwise', edits: [{ path: 'P.cbl', line: ACCEPT_LINE, op: 'insert-after', code: ALLOW }] },
  ]);
  policy('hitl-item');
  const dir = join(TMP, 'jobs');
  const job = newJob({ repo: 'main', fingerprint: fp, maxAttempts: 3, engines: { drafter: { engine: 'script' } } });
  await runJob(dir, job, { repoPath: root, drafter });
  main = { root, fp, dir, job, head };

  assert.equal(job.state, 'lodged', job.error);
  assert.deepEqual(job.attempts.map((a) => a.rejected ? 'refused' : a.verdict), ['refused', 'fail', 'pass']);
  assert.equal(job.attempts[1].outcome, 'still-reported');
  assert.equal(job.final.outcome, 'cleared-by-check');
  assert.deepEqual(job.final.files, ['P.cbl']);
  assert.match(drafter.prompts[1].user, /not a line the packet quotes/, 'the refusal reached attempt 2');
  assert.match(drafter.prompts[2].user, /UNTRUSTED-DATA [0-9a-f]+ origin="cobolwork:gate"/, 'the gate\'s reasons reached attempt 3, fenced');
  assert.match(drafter.prompts[2].user, /still reported/);
  assert.equal(git(root, 'rev-parse', refFor(job.id)), job.final.draftSha);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head, 'HEAD did not move');
  assert.equal(git(root, 'status', '--porcelain'), status, 'the working tree and index are as the operator left them');
  assert.equal(job.review.skipped !== undefined, true, 'no reviewer: the source did not leave the machine');
});

test('apply refuses a dirty copy of the file it changes, then lands exactly the gated draft as a fast-forward',  async () => {
  assert.ok(main, 'the drafting test ran');
  const { root, dir, job, head } = main;
  writeFileSync(join(root, 'P.cbl'), PROGRAM.replace('GOBACK.', 'STOP RUN.'));
  const dirty = await applyJob(dir, job, { repoPath: root });
  assert.equal(dirty.ok, false);
  assert.match(dirty.error, /uncommitted changes in P\.cbl/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  git(root, 'checkout', '--', 'P.cbl');

  const r = await applyJob(dir, job, { repoPath: root });
  assert.equal(r.ok, true, r.error);
  assert.equal(git(root, 'rev-parse', 'HEAD'), r.commit);
  assert.equal(git(root, 'rev-parse', 'HEAD^'), head);
  assert.equal(git(root, 'rev-parse', 'HEAD^{tree}'), git(root, 'rev-parse', `${job.final.draftSha}^{tree}`));
  assert.match(readFileSync(join(root, 'P.cbl'), 'utf8'), /           EVALUATE WS-IN\n/);
  const msg = git(root, 'log', '-1', '--format=%B');
  assert.match(msg, /^fix: argv-or-env-to-os-command in P\.cbl, passed by the cobolwork gate/);
  assert.doesNotMatch(msg, /Co-Authored-By/i);
  assert.equal(readFileSync(join(root, 'README.txt'), 'utf8'), 'the operator is editing this\n', 'other uncommitted work is untouched');
  assert.equal((await applyJob(dir, readJob(dir, job.id).job, { repoPath: root })).conflict, true);
});

test('verify finds the finding gone at HEAD and records verified-fixed in the adjudication journal',  async () => {
  assert.ok(main, 'the drafting test ran');
  const { root, dir, job } = main;
  const r = await verifyJob(dir, readJob(dir, job.id).job, { repoPath: root, artifact: 'reports/cobolwork-remediation/test.json' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.outcome, 'verified-fixed');
  assert.equal(r.recorded, true);
  const journal = readFileSync(join(TMP, 'verdicts', 'adjudications.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const rec = journal.find((x) => x.claimSource === 'cobolwork-remediation');
  assert.equal(rec.outcome, 'verified-fixed');
  assert.equal(rec.category, 'sastCobol');
});

test('a job cobolwork could not run carries the shared not-run unknown, beside its own unscanned state', async () => {
  const root = repo('notrun');
  const dir = join(TMP, 'jobs-notrun');
  const job = newJob({ repo: 'notrun', fingerprint: 'b'.repeat(32), engines: {} });
  await withEnv({ CW_COBOLWORK_BIN: join(TMP, 'no-such-cobolwork') }, () => runJob(dir, job, { repoPath: root, drafter: scripted([]) }));
  assert.equal(job.state, 'unscanned');
  assert.equal(isUnknown(job), true);
  assert.equal(job.unknownReason, 'not-run');
  assert.equal(readJob(dir, job.id).job.unknownReason, 'not-run', 'and the record on disk says so');
});

// cobolwork 0.2.0's answers, measured 2026-09-26: it reads options before the command, so gate's
// --target is refused as an option it does not know, and explain as a command it does not have. It
// has no capabilities command either, and that is where the bridge now stops.
const COBOLWORK_0_2 = [
  "const known = ['--format', '--out', '--repos', '--only', '--quiet', '--full-trace', '--base', '--head'];",
  'const args = process.argv.slice(2);',
  "const opt = args.find((a) => a.startsWith('-') && !known.includes(a));",
  "process.stderr.write(opt ? `cobolwork: unknown option ${opt}\\n` : `cobolwork: unknown command ${args[0]}\\n`);",
  'process.exitCode = 2;',
].join('\n');

test('a cobolwork that cannot state its capabilities judged nothing: the draft is unscanned and the verify did not run, and neither is refused', async () => {
  const root = repo('old-cobolwork');
  const old = join(TMP, 'cobolwork-0.2.mjs');
  writeFileSync(old, COBOLWORK_0_2);
  const head = git(root, 'rev-parse', 'HEAD');
  await withEnv({ CW_COBOLWORK_BIN: old }, async () => {
    const d = scripted([]);
    const r = await remediate({ repoPath: root, fingerprint: 'c'.repeat(32), jobId: 'c'.repeat(16), drafter: d });
    assert.equal(r.state, 'unscanned', r.error);
    assert.match(r.error, /not drafted: cobolwork capabilities --json exited 2: cobolwork: unknown option --json/);
    assert.equal(d.prompts.length, 0);
    const v = await verifyApplied({ repoPath: root, job: { baseSha: head, fingerprint: 'c'.repeat(32) } });
    assert.equal(v.ok, false);
    assert.equal(v.unavailable, true, 'a gate whose capabilities cannot be read did not run');
    assert.match(v.error, /the gate did not run: cobolwork capabilities --json exited 2/);
  });
});

test('a cobolwork that crashes judged nothing either: the draft is unscanned and carries not-run, never refused', async () => {
  const root = repo('crashed-cobolwork');
  const crash = join(TMP, 'cobolwork-crash.mjs');
  // What a checkout left mid-merge does, measured on this box 2026-09-26: the module does not load, and node exits 1.
  writeFileSync(crash, "throw new SyntaxError(\"Unexpected token '<<'\");\n");
  const dir = join(TMP, 'jobs-crash');
  const job = newJob({ repo: 'crashed', fingerprint: 'd'.repeat(32), engines: {} });
  await withEnv({ CW_COBOLWORK_BIN: crash }, () => runJob(dir, job, { repoPath: root, drafter: scripted([]) }));
  assert.equal(job.state, 'unscanned', job.error);
  assert.match(job.error, /not drafted: cobolwork capabilities --json exited 1/);
  assert.equal(job.unknownReason, 'not-run');
});

test('a value replaced by literals comes back with what to change, and a repeated draft ends the run without another gate',  async () => {
  const root = repo('repeat');
  const fp = await fingerprintIn(root);
  const literal = { rationale: 'a fixed command', edits: [{ path: 'P.cbl', line: MOVE_LINE, op: 'replace', code: ["     MOVE 'DAILY' TO WS-CMD"] }] };
  const d = scripted([literal, literal, literal]);
  const r = await remediate({ repoPath: root, fingerprint: fp, jobId: jobIdFor('repeat', fp), drafter: d, maxAttempts: 3 });
  assert.equal(r.attempts[0].outcome, 'gone-unexplained');
  assert.equal(r.attempts[1].repeatOf, 1);
  assert.equal(r.attempts.length, 2, 'no third draft was asked for');
  assert.match(d.prompts[1].user, /What to change: the gate cannot see why the finding went/);
  assert.equal(r.final.verdict, 'undecided');
});

test('a statement quoted past its first line is edited as a whole: inserts go around it, and it is deleted whole or not at all', () => {
  const call = { path: 'P.cbl', line: 11, endLine: 13, code: '     CALL "SYSTEM"',
    rest: [{ line: 12, code: '         USING WS-CMD' }, { line: 13, code: '         RETURNING WS-RC' }] };
  const anchors = anchorsFrom({ sink: call });
  assert.deepEqual([...anchors.values()].map((a) => [a.line, a.code, a.stmt]), [
    [11, '     CALL "SYSTEM"', [11, 13]], [12, '         USING WS-CMD', [11, 13]], [13, '         RETURNING WS-RC', [11, 13]]]);
  const edits = (list) => validateEdits({ edits: list }, anchors);
  const around = edits([{ path: 'P.cbl', line: 11, op: 'insert-after', code: ['     CONTINUE'] }, { path: 'P.cbl', line: 12, op: 'insert-before', code: ['     CONTINUE'] }]);
  assert.deepEqual(around.edits.map((e) => [e.op, e.line]), [['insert-after', 13], ['insert-before', 11]]);
  const part = edits([{ path: 'P.cbl', line: 11, op: 'delete', code: [] }]);
  assert.equal(part.ok, false);
  assert.match(part.reasons[0], /lines 11 to 13 of P.cbl are one statement; delete every one of them or none, not lines 11/);
  assert.equal(edits([11, 12, 13].map((line) => ({ path: 'P.cbl', line, op: 'delete', code: [] }))).ok, true);
  const ragged = anchorsFrom({ sink: { ...call, rest: call.rest.slice(0, 1) } });
  assert.equal(ragged.get('P.cbl:11').stmt, undefined, 'an extent whose lines are not all quoted is not trusted');
  const retry = draftPrompt({ packet: { sink: call }, anchors, previous: [{ edits: [], verdict: 'fail', outcome: 'statement-removed',
    reasons: ['P.cbl compiled before the patch and does not after', 'the compiler: P.cbl:12: error: syntax error, unexpected EVALUATE, expecting TO'] }] });
  assert.match(retry.user, /P\.cbl:12 \[sink, continued from line 11\]/);
  assert.match(retry.user, /the compiler: P\.cbl:12: error/);
  assert.match(retry.user, /does not compile: the compiler lines above give the line/);
});

test('a replace that writes a quoted line back as it reads is dropped, and is not counted against the limit', () => {
  const lines = Array.from({ length: 14 }, (_, i) => ({ path: 'P.cbl', line: i + 1, code: i === 4 ? '' : `     DISPLAY ${i + 1}` }));
  const anchors = anchorsFrom({ hops: lines.map((l, i) => ({ ...l, n: i + 1 })) });
  const echo = lines.map((l) => ({ path: 'P.cbl', line: l.line, op: 'replace', code: [l.code] }));
  const real = { path: 'P.cbl', line: 2, op: 'insert-after', code: ['     CONTINUE'] };
  const v = validateEdits({ edits: [real, ...echo] }, anchors);
  assert.equal(v.ok, true, (v.reasons || []).join('; '));
  assert.deepEqual(v.edits, [{ path: 'P.cbl', line: 2, op: 'insert-after', code: ['     CONTINUE'] }]);
  const none = validateEdits({ edits: echo }, anchors);
  assert.deepEqual(none.reasons, ['the draft changes nothing: every edit writes a line back as it reads']);
});

test('a draft that deletes the flagged statement fails and is told to keep it', async () => {
  const root = repo('deleted-sink');
  const fp = await fingerprintIn(root);
  const gone = { rationale: 'no command, no injection', edits: [{ path: 'P.cbl', line: CALL_LINE, op: 'delete', code: [] }] };
  const d = scripted([gone, gone]);
  const r = await remediate({ repoPath: root, fingerprint: fp, jobId: jobIdFor('deleted-sink', fp), drafter: d, maxAttempts: 2 });
  assert.equal(r.attempts[0].outcome, 'statement-removed');
  assert.equal(r.attempts[0].verdict, 'fail');
  assert.match(d.prompts[1].user, /What to change: you deleted the statement the finding names\. Keep it as it was/);
  assert.doesNotMatch(d.prompts[0].user, /statement, is removed and not written back/);
  assert.match(d.prompts[0].user, /do not invent literals/);
});

test('a draft that differs from an earlier one only in spacing is a repeat',  async () => {
  const root = repo('repeat-spacing');
  const fp = await fingerprintIn(root);
  const literal = (pad) => ({ rationale: 'a fixed command', edits: [{ path: 'P.cbl', line: MOVE_LINE, op: 'replace', code: [`${pad}MOVE 'DAILY'  TO WS-CMD`] }] });
  const r = await remediate({ repoPath: root, fingerprint: fp, jobId: jobIdFor('repeat-spacing', fp), drafter: scripted([literal('     '), literal('         ')]), maxAttempts: 3 });
  assert.equal(r.attempts[1].repeatOf, 1);
  assert.equal(r.attempts.length, 2);
});

test('an undecided draft is applied only on a stated judgement, and never over a HEAD that moved',  async () => {
  const root = repo('lowered');
  const fp = await fingerprintIn(root);
  const r = await remediate({ repoPath: root, fingerprint: fp, jobId: jobIdFor('lowered', fp), maxAttempts: 1,
    drafter: scripted([{ rationale: 'letters only', edits: [{ path: 'P.cbl', line: ACCEPT_LINE, op: 'insert-after', code: LETTERS }] }]) });
  assert.equal(r.final.verdict, 'undecided');
  assert.equal(r.final.outcome, 'lowered-by-check');
  const job = { id: jobIdFor('lowered', fp), fingerprint: fp, ...r };
  assert.match((await applyLodged({ repoPath: root, job })).error, /person's judgement/);
  writeFileSync(join(root, 'README.txt'), 'moved on\n');
  git(root, 'commit', '-qam', 'someone else committed');
  const moved = await applyLodged({ repoPath: root, job, acknowledgeUndecided: true });
  assert.equal(moved.ok, false);
  assert.match(moved.error, /re-run the remediation/);
  assert.match(commitMessage({ ...job, attempts: r.attempts }), /left undecided by the cobolwork gate[\s\S]*Applied by the operator with the gate undecided/);
});

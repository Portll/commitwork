// bin/ab-loop.mjs end to end against a stub OpenAI-compatible endpoint: both variants dispatched,
// every artefact written under the runs directory, and the refusals that keep a loop from running
// on a missing input. The child gets a scratch HOME and a minimal environment, so the memory-layer
// key cannot resolve and its writes degrade to the backfill file, as they do on a box without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AB_LOOP = join(REPO, 'bin', 'ab-loop.mjs');

function stubLlm() {
  const prompts = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const body = JSON.parse(raw);
        const prompt = body.messages[0].content;
        prompts.push({ model: body.model, prompt });
        const tag = prompt.includes('VARIANT-A') ? 'answer A' : prompt.includes('VARIANT-B') ? 'answer B' : 'answer ?';
        return res.end(JSON.stringify({ choices: [{ message: { content: tag }, finish_reason: 'stop' }], usage: { total_tokens: 7 } }));
      }
      res.statusCode = 404;
      return res.end('{}');
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, prompts, url: `http://127.0.0.1:${server.address().port}/v1` })));
}

function run(args, env) {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [AB_LOOP, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => ok({ code, out, err }));
  });
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-ab-loop-'));
  const a = join(dir, 'a.md'); const b = join(dir, 'b.md');
  writeFileSync(a, 'VARIANT-A: summarise the finding in one line.\n');
  writeFileSync(b, 'VARIANT-B: summarise the finding in one paragraph.\n');
  const env = { PATH: process.env.PATH, HOME: join(dir, 'home'), CW_AB_RUNS_DIR: join(dir, 'runs'), CW_SELF_SWEEP: '0' };
  return { dir, a, b, env };
}

test('ab-loop.mjs dispatches both variants and writes the run record, prompts, responses and report', async (t) => {
  const llm = await stubLlm();
  const s = scratch();
  t.after(() => { llm.server.close(); rmSync(s.dir, { recursive: true, force: true }); });
  const r = await run(['--a', s.a, '--b', s.b, '--no-judge', '--label', 'unit'], { ...s.env, CW_AB_LLM_URL: llm.url });
  assert.equal(r.code, 0, r.err);
  // The result is the pretty-printed object that ends stdout.
  const { runId, runDir } = JSON.parse(r.out.slice(r.out.lastIndexOf('\n{') + 1));
  assert.ok(runDir.startsWith(join(s.dir, 'runs')), `the run was written outside the runs directory: ${runDir}`);
  assert.equal(llm.prompts.length, 2, 'one completion per variant, and no judge call');
  assert.ok(llm.prompts.every((p) => p.model === 'stub-model'));
  assert.equal(readFileSync(join(runDir, 'response-a.md'), 'utf8'), 'answer A');
  assert.equal(readFileSync(join(runDir, 'response-b.md'), 'utf8'), 'answer B');
  assert.match(readFileSync(join(runDir, 'prompt-a.md'), 'utf8'), /VARIANT-A/);
  const record = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(record.schema, 'ab-run/v1');
  assert.equal(record.runId, runId);
  assert.equal(record.model, 'stub-model');
  assert.ok(existsSync(join(runDir, 'report.md')));
  assert.ok(existsSync(join(runDir, 'memory-layer-backfill.json')), 'a run with no key must leave the writes it could not make');
  assert.equal(readFileSync(join(s.dir, 'runs', 'LATEST'), 'utf8').trim(), runId);
});

test('ab-loop.mjs refuses to run without --a, and a judged run without the rubric templates', async (t) => {
  const llm = await stubLlm();
  const s = scratch();
  t.after(() => { llm.server.close(); rmSync(s.dir, { recursive: true, force: true }); });
  const noA = await run(['--b', s.b], { ...s.env, CW_AB_LLM_URL: llm.url });
  assert.equal(noA.code, 1);
  assert.match(noA.err, /--a is required/);
  const judged = await run(['--a', s.a, '--b', s.b], { ...s.env, CW_AB_LLM_URL: llm.url });
  assert.notEqual(judged.code, 0, 'a judged run with no rubric reported success');
  assert.match(judged.err, /CW_AB_PROMPTS_DIR/);
});

test('the judge sees both responses whole, whatever comment or replacement syntax they carry', async (t) => {
  const A = 'answer A opens <!-- and keeps going';
  const B = "answer B closes --> and quotes $' and $& verbatim";
  const prompts = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
      const prompt = JSON.parse(raw).messages[0].content;
      prompts.push(prompt);
      const content = prompt.includes('VARIANT-A') ? A : prompt.includes('VARIANT-B') ? B : 'no verdict';
      return res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { total_tokens: 7 } }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const s = scratch();
  t.after(() => { server.close(); rmSync(s.dir, { recursive: true, force: true }); });
  const promptsDir = join(s.dir, 'prompts');
  mkdirSync(promptsDir);
  writeFileSync(join(promptsDir, 'compare_ab.md'), '<!-- maintainer note -->\nJudge these.\n\n{{context}}\n');
  const r = await run(['--a', s.a, '--b', s.b, '--label', 'unit'],
    { ...s.env, CW_AB_LLM_URL: `http://127.0.0.1:${server.address().port}/v1`, CW_AB_PROMPTS_DIR: promptsDir });
  assert.equal(r.code, 0, r.err);
  const judge = prompts.find((p) => p.startsWith('Judge these.'));
  assert.ok(judge, `no judge prompt among ${prompts.length}`);
  assert.ok(judge.includes(A), 'response A was cut');
  assert.ok(judge.includes(B), 'response B was cut or had its $ patterns expanded');
  assert.ok(!judge.includes('maintainer note'));
});

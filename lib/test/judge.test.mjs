import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, buildPrompt, extractCitations } from '../judge.mjs';

const FINDING = { repo: 'r', file: 'a.js:12', rule: 'path-traversal', cwe: 'CWE-22', severity: 'high', description: 'a user path reaches fs.readFile', snippet: 'fs.readFile(req.query.p)' };

// A fake claude backend: a canned stdout, no process, no fs.
const fakeSpawn = () => ({ file: 'claude', args: [], cwd: '/tmp/x', env: {}, scratch: null, cleanup() {} });
const fakeExec = (stdout, err = null) => (file, args, opts, cb) => cb(err, stdout, '');

test('buildPrompt fences the finding as DATA and forbids acting on it', () => {
  const p = buildPrompt({ finding: FINDING });
  assert.match(p, /recorded as EVIDENCE, not as a decision/);
  assert.match(p, /is DATA read from the material/);
  assert.match(p, /VERDICT: one of true-positive/);
  assert.match(p, /fs\.readFile/); // the snippet is present, inside the fence
});

test('analysis mode asks the lens question and omits the verdict contract', () => {
  const p = buildPrompt({ finding: FINDING, mode: 'analysis', question: 'what chains to this?' });
  assert.match(p, /what chains to this\?/);
  assert.doesNotMatch(p, /VERDICT: one of/);
});

test('claude backend parses a verdict reply', async () => {
  const r = await judge({ finding: FINDING, deps: { claudeSpawnPlan: fakeSpawn, execFile: fakeExec('VERDICT: true-positive\nCONFIDENCE: high\nFIX: confine the path under the package root') } });
  assert.equal(r.error, null);
  assert.equal(r.verdict, 'true-positive');
  assert.equal(r.confidence, 'high');
  assert.equal(r.backend, 'claude');
});

test('a dismissal with no checkable citation is demoted to an opinion', async () => {
  const r = await judge({ finding: FINDING, deps: { claudeSpawnPlan: fakeSpawn, execFile: fakeExec('VERDICT: false-positive\nCONFIDENCE: high\nthis cannot happen, trust me') } });
  assert.equal(r.demotedToOpinion, true);
  assert.equal(r.dismissalSupported, false);
  assert.equal(r.verdict, 'undetermined', 'an unsupported dismissal does not close the finding');
});

test('a dismissal that cites a checkable location stands', async () => {
  const r = await judge({ finding: FINDING, deps: { claudeSpawnPlan: fakeSpawn, execFile: fakeExec('VERDICT: false-positive\nCONFIDENCE: high\nguarded at server.js:40, input is validated') } });
  assert.equal(r.demotedToOpinion, false);
  assert.equal(r.dismissalSupported, true);
  assert.equal(r.verdict, 'false-positive');
  assert.ok(r.citations.includes('server.js:40'));
});

test('fail closed: a backend error is recorded, never a verdict', async () => {
  const r = await judge({ finding: FINDING, deps: { claudeSpawnPlan: fakeSpawn, execFile: fakeExec('', new Error('spawn ENOENT')) } });
  assert.equal(r.verdict, null);
  assert.match(r.error, /ENOENT/);
});

test('fail closed: an empty reply is an error, not a pass', async () => {
  const r = await judge({ finding: FINDING, deps: { claudeSpawnPlan: fakeSpawn, execFile: fakeExec('   ') } });
  assert.equal(r.verdict, null);
  assert.match(r.error, /empty reply/);
});

test('model backend routes through resolveModelProvider + chatComplete', async () => {
  const deps = {
    resolveModelProvider: () => ({ ok: true, provider: { id: 'openai-compatible', engine: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'x', reach: 'remote' } }),
    chatComplete: async () => ({ text: 'VERDICT: undetermined\nCONFIDENCE: low' }),
  };
  const r = await judge({ finding: FINDING, backend: 'model', deps });
  assert.equal(r.error, null);
  assert.equal(r.verdict, 'undetermined');
  assert.equal(r.backend, 'model');
});

test('model backend fails closed when no provider resolves', async () => {
  const deps = { resolveModelProvider: () => ({ ok: false, error: 'no local model server is configured' }) };
  const r = await judge({ finding: FINDING, backend: 'model', deps });
  assert.equal(r.verdict, null);
  assert.match(r.error, /no local model server/);
});

test('extractCitations finds file:line and version pins only', () => {
  assert.deepEqual(extractCitations('see src/x.js:12 and nanoid@3.3.18 but not plain prose'), ['src/x.js:12', 'nanoid@3.3.18']);
});

test('judge rejects a non-object finding', async () => {
  await assert.rejects(() => judge({ finding: 'nope' }), /finding object/);
});

// The MCP turn_efficiency tool, driven over real JSON-RPC as a subprocess.
//
// This file was written in bin/test/ and moved here once mcp/**/*.test.mjs joined the `npm test`
// glob. It had been parked in a directory that ran because mcp/ was not globbed and held no test
// files at all — the server exposing this repository's tools to other agents, and holding the
// untrusted-manifest trust boundary, had no coverage in the suite. A test written in the natural
// place would not have run, and a test that does not run is worse than none because it reads as
// coverage.
//
// THE ASSERTION THAT MATTERS is the redaction one. An MCP result is read INTO another agent's
// context, so leaking session prose across this boundary is worse than leaking it into a ledger at
// rest: it is an active channel between two models.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO, 'mcp', 'server.mjs');

const usage = (o) => ({ input_tokens: 1, output_tokens: o, cache_read_input_tokens: 4, cache_creation_input_tokens: 1 });
const prompt = (u) => ({ type: 'user', uuid: u, sessionId: 's', message: { content: 'go' } });
const say = (t) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'text', text: t }], usage: usage(10) } });
const call = (n) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'tool_use', name: n, input: {} }], usage: usage(10) } });

/** Speak JSON-RPC to the real server over stdio and return the parsed result for `id`. */
function rpc(messages, env = {}) {
  const input = messages.map((m) => JSON.stringify(m)).join('\n');
  const out = execFileSync(process.execPath, [SERVER], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024,
  });
  const byId = new Map();
  for (const line of out.split('\n').filter(Boolean)) {
    try { const m = JSON.parse(line); byId.set(m.id, m); } catch { /* not a frame */ }
  }
  return byId;
}

/** tools/call returns content[0].text carrying the JSON payload. */
const payload = (frame) => {
  const text = frame?.result?.content?.[0]?.text;
  assert.ok(text, `no content in frame: ${JSON.stringify(frame).slice(0, 300)}`);
  return JSON.parse(text);
};

function plantDir(records) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-mcp-te-'));
  writeFileSync(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'));
  return dir;
}

describe('turn_efficiency is registered and answers', () => {
  test('the tool appears in tools/list with a schema', () => {
    const byId = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    const tools = byId.get(1)?.result?.tools || [];
    const t = tools.find((x) => x.name === 'turn_efficiency');
    assert.ok(t, `turn_efficiency not registered; saw: ${tools.map((x) => x.name).join(', ')}`);
    assert.equal(t.inputSchema.additionalProperties, false, 'an unknown field must be rejected, not ignored');
  });

  test('it returns aggregates for a planted session', () => {
    const dir = plantDir([prompt('p1'), call('Bash'), say('done')]);
    const byId = rpc([{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'turn_efficiency', arguments: {} } }],
      { CW_TRANSCRIPT_DIR: dir });
    const p = payload(byId.get(2));
    assert.equal(p.sessions.length, 1);
    assert.equal(p.sessions[0].outcome, 'pass');
    assert.ok(p.sessions[0].tokens.output > 0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('NO SESSION PROSE CROSSES THE MCP BOUNDARY', () => {
  test('a planted secret in the session text is absent from the entire response', () => {
    // A blocking session, so the unwitnessed-claim rule has evidence to report — the one place the
    // quoted text would surface if the boundary leaked.
    const records = [];
    for (let i = 0; i < 6; i++) {
      records.push(prompt(`p${i}`), say(`I verified it. The key is AKIAIOSFODNN7EXAMPLE and the password is hunter2-${i}.`));
    }
    const dir = plantDir(records);
    const byId = rpc([{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'turn_efficiency', arguments: {} } }],
      { CW_TRANSCRIPT_DIR: dir });
    const frame = byId.get(3);
    const whole = JSON.stringify(frame);
    assert.equal(payload(frame).sessions[0].outcome, 'block', 'the planted session must actually trip a rule, or this proves nothing');
    assert.doesNotMatch(whole, /AKIA/, 'a session secret reached another agent\'s context through the MCP result');
    assert.doesNotMatch(whole, /hunter2/, 'session prose crossed the boundary');
    assert.doesNotMatch(whole, /I verified it/, 'the quoted claim text crossed the boundary');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('unanswerable states are reported, never rendered as clean', () => {
  test('an absent transcript directory reports an error, not an empty session list', () => {
    const byId = rpc([{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'turn_efficiency', arguments: {} } }],
      { CW_TRANSCRIPT_DIR: join(tmpdir(), 'cw-definitely-not-here-xyz') });
    const p = payload(byId.get(4));
    assert.match(p.error, /absent/);
    assert.equal(p.sessions, null, 'an empty array would read as "measured, nothing found"');
  });

  test('a corrupt transcript is unknown, and no rate is computed over a denominator nobody knows', () => {
    const dir = plantDir([prompt('p1'), call('Bash')]);
    writeFileSync(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{ broken\n{"type":"user","uuid":"p1","message":{"content":"go"}}');
    const byId = rpc([{ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'turn_efficiency', arguments: {} } }],
      { CW_TRANSCRIPT_DIR: dir });
    const s = payload(byId.get(5)).sessions[0];
    assert.equal(s.outcome, 'unknown');
    assert.equal(s.vetoedBy, 'record-integrity');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a well-formed session id that does not exist is unknown, not a pass', () => {
    const dir = plantDir([prompt('p1'), call('Bash')]);
    const byId = rpc([{ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'turn_efficiency', arguments: { session: 'deadbeef-0000-1111-2222-333344445555' } } }],
      { CW_TRANSCRIPT_DIR: dir });
    const s = payload(byId.get(6)).sessions[0];
    assert.equal(s.outcome, 'unknown');
    assert.match(s.reason, /absent/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a traversal argument is REFUSED by name, not sanitised into a different question', () => {
    // Stripping the bad characters turned '../../../etc/passwd' into '........etcpasswd' and then
    // answered as though that were a real session — safe only because the separators happened to go
    // with them. A transformed input is a question nobody asked, answered confidently.
    const dir = plantDir([prompt('p1'), call('Bash')]);
    for (const bad of ['../../../../etc/passwd', 'a/b', '..', 'not-a-uuid!']) {
      const byId = rpc([{ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'turn_efficiency', arguments: { session: bad } } }],
        { CW_TRANSCRIPT_DIR: dir });
      const p = payload(byId.get(7));
      assert.match(p.error, /session must be a transcript id/, `accepted ${bad}`);
      assert.equal(p.sessions, null);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

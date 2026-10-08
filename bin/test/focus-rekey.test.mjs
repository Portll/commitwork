// focus-rekey — the historical gate-focus records join to a transcript by timestamp, or say why not.
// The states that must not collapse: one candidate (re-keyed), none (no transcript), several (tie —
// dropped, never picked), already a session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexTranscripts, rekeyRecord, readRekeys, rekeyPath } from '../focus-rekey.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'focus-rekey.mjs');
const line = (ts, cwd, sessionId, content = 'continue') => JSON.stringify({ type: 'user', timestamp: ts, cwd, sessionId, message: { role: 'user', content } });

function fx(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-rekey-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projects = join(root, 'projects'); const verdicts = join(root, 'verdicts');
  mkdirSync(join(projects, '-x-commitwork'), { recursive: true }); mkdirSync(join(projects, '-x-client-d'), { recursive: true }); mkdirSync(verdicts);
  const A = 'aaaaaaaa-0000-0000-0000-000000000000'; const B = 'bbbbbbbb-0000-0000-0000-000000000000'; const Z = 'cccccccc-0000-0000-0000-000000000000';
  writeFileSync(join(projects, '-x-commitwork', `${A}.jsonl`), [line('2026-09-01T10:00:00.500Z', '/x/commitwork', A), line('2026-09-01T11:00:00.000Z', '/x/commitwork', A)].join('\n') + '\n');
  // B: a nudge in the same second as A's (a genuine tie), and later a REAL instruction in the same
  // second as A's nudge at 13:00 (the nudge witness resolves that one to A).
  writeFileSync(join(projects, '-x-commitwork', `${B}.jsonl`), [line('2026-09-01T11:00:00.800Z', '/x/commitwork', B), line('2026-09-01T13:00:00.900Z', '/x/commitwork', B, 'please refactor the parser')].join('\n') + '\n');
  writeFileSync(join(projects, '-x-commitwork', `${A}.jsonl`), readFileSync(join(projects, '-x-commitwork', `${A}.jsonl`), 'utf8') + line('2026-09-01T13:00:00.200Z', '/x/commitwork', A, '??') + '\n');
  writeFileSync(join(projects, '-x-client-d', `${Z}.jsonl`), [line('2026-09-01T12:00:00.000Z', '/x/client-d', Z)].join('\n') + '\n');
  return { root, projects, verdicts, A, B, Z };
}

test('indexTranscripts: one entry per transcript with repo, session and sorted prompt times', (t) => {
  const f = fx(t);
  const idx = indexTranscripts(f.projects);
  assert.equal(idx.length, 3);
  const a = idx.find((x) => x.session === f.A);
  assert.equal(a.repo, 'commitwork');
  assert.deepEqual(a.times, [Date.parse('2026-09-01T10:00:00.500Z'), Date.parse('2026-09-01T11:00:00.000Z'), Date.parse('2026-09-01T13:00:00.200Z')]);
  assert.deepEqual(a.nudges, a.times, 'every one of A\'s prompts is a nudge');
  assert.equal(indexTranscripts(join(f.root, 'nope')).length, 0, 'an absent root is an empty index, not a throw');
});

test('one candidate re-keys; none is no-transcript; two in the window is a TIE and no session is picked', (t) => {
  const f = fx(t);
  const idx = indexTranscripts(f.projects);
  const one = rekeyRecord({ at: '2026-09-01T10:00:01.000Z', session: '12345678', repo: 'commitwork' }, idx, { window: 3000 });
  assert.equal(one.how, 'timestamp-join'); assert.equal(one.session, 'aaaaaaaa'); assert.equal(one.candidates, 1);
  const none = rekeyRecord({ at: '2026-09-01T10:30:00.000Z', session: '12345678', repo: 'commitwork' }, idx, { window: 3000 });
  assert.equal(none.how, 'no-transcript'); assert.equal(none.session, null);
  const tie = rekeyRecord({ at: '2026-09-01T11:00:00.400Z', session: '12345678', repo: 'commitwork' }, idx, { window: 3000 });
  assert.equal(tie.how, 'tie'); assert.equal(tie.session, null); assert.deepEqual(tie.tied, ['aaaaaaaa', 'bbbbbbbb']);
  // Two prompts in the window, only one of them a bare nudge: the nudge witness breaks the tie.
  const resolved = rekeyRecord({ at: '2026-09-01T13:00:00.500Z', session: '12345678', repo: 'commitwork' }, idx, { window: 3000 });
  assert.equal(resolved.how, 'timestamp-join+nudge'); assert.equal(resolved.session, 'aaaaaaaa'); assert.equal(resolved.candidates, 2);
});

test('isNudgeLine matches the hook\'s list and nothing else, for string AND text-block prompts', async () => {
  const { isNudgeLine, promptText } = await import('../focus-rekey.mjs');
  assert.equal(isNudgeLine(line('t', '/x', 's', 'continue')), true);
  assert.equal(isNudgeLine(line('t', '/x', 's', 'Carry on.')), true);
  assert.equal(isNudgeLine(line('t', '/x', 's', '???')), true);
  assert.equal(isNudgeLine(line('t', '/x', 's', 'continue through')), false);
  const blocks = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'continue' }] } });
  assert.equal(promptText(blocks), 'continue', 'the live corpus carries prompts as text-block lists');
  assert.equal(isNudgeLine(blocks), true);
  const toolResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'continue' }] } });
  assert.equal(promptText(toolResult), null, 'a tool result is not a prompt');
  assert.equal(isNudgeLine(toolResult), false);
});

test('a tool-result user line never joins: it is not a prompt', (t) => {
  const f = fx(t);
  const T = 'dddddddd-0000-0000-0000-000000000000';
  writeFileSync(join(f.projects, '-x-commitwork', `${T}.jsonl`), JSON.stringify({ type: 'user', timestamp: '2026-09-01T14:00:00.000Z', cwd: '/x/commitwork', sessionId: T, message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }) + '\n');
  const idx = indexTranscripts(f.projects);
  assert.equal(idx.find((x) => x.session === T), undefined, 'a transcript with no prompts is not indexed');
  assert.equal(rekeyRecord({ at: '2026-09-01T14:00:00.200Z', session: '1', repo: 'commitwork' }, idx).how, 'no-transcript');
});

test('the repo scopes the pool: a client-d firing never joins to a commitwork transcript', (t) => {
  const f = fx(t);
  const idx = indexTranscripts(f.projects);
  const z = rekeyRecord({ at: '2026-09-01T12:00:00.100Z', session: '99999999', repo: 'client-d' }, idx);
  assert.equal(z.session, 'cccccccc');
  const wrong = rekeyRecord({ at: '2026-09-01T12:00:00.100Z', session: '99999999', repo: 'commitwork' }, idx);
  assert.equal(wrong.how, 'no-transcript');
});

test('a record already keyed on a real session is kept as already-session; an unparseable at is its own state', (t) => {
  const f = fx(t);
  const idx = indexTranscripts(f.projects);
  const a = rekeyRecord({ at: '2026-09-01T10:00:01.000Z', session: 'aaaaaaaa', repo: 'commitwork' }, idx);
  assert.equal(a.how, 'already-session'); assert.equal(a.session, 'aaaaaaaa');
  assert.equal(rekeyRecord({ at: 'garbage', session: '1', repo: 'commitwork' }, idx).how, 'unparseable-at');
});

test('CLI: dry run writes nothing; --write appends one row per record, idempotently; the journal is untouched', (t) => {
  const f = fx(t);
  const journal = join(f.verdicts, 'gate-focus.jsonl');
  const recs = [
    { v: 1, gate: 'gate-focus', at: '2026-09-01T10:00:01.000Z', session: '12345678', verdict: 'refocus-fired', streak: 2, repo: 'commitwork' },
    { v: 1, gate: 'gate-focus', at: '2026-09-01T11:00:00.400Z', session: '12345678', verdict: 'refocus-fired', streak: 3, repo: 'commitwork' },
  ];
  writeFileSync(journal, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const before = readFileSync(journal, 'utf8');
  const env = { ...process.env, CW_VERDICT_DIR: f.verdicts, CW_TRANSCRIPT_ROOT: f.projects };
  const dry = execFileSync(process.execPath, [CLI], { encoding: 'utf8', env });
  assert.match(dry, /2 record\(s\) against 3 transcript\(s\) — timestamp-join 1 · tie 1/);
  assert.equal(existsSync(rekeyPath(f.verdicts)), false);
  execFileSync(process.execPath, [CLI, '--write'], { encoding: 'utf8', env });
  const map = readRekeys(f.verdicts);
  assert.equal(map.size, 2);
  assert.equal(map.get('2026-09-01T10:00:01.000Z').session, 'aaaaaaaa');
  assert.equal(map.get('2026-09-01T11:00:00.400Z').how, 'tie');
  const again = execFileSync(process.execPath, [CLI, '--write'], { encoding: 'utf8', env });
  assert.match(again, /0 row\(s\) appended/);
  assert.equal(readFileSync(journal, 'utf8'), before, 'append-only, hash-chained: never rewritten');
});

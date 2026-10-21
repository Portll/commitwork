// The drafter's prompt from the advice document: the advice item for the target puts its text, steps
// and fix-location test in place of the rule's remedy; without one the prompt is as it was. The stored
// document is `cobolwork advise` over cobolwork's bench/cases/001-argv-reaches-os-command, trimmed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorsFrom, draftPrompt, remediate } from '../cobolwork-remediation.mjs';

const STORED = JSON.parse(readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures'), 'cobolwork-advice-001.json'), 'utf8'));
const FINDING = STORED.items[0];
const FP = FINDING.fingerprint;
const REMEDY = 'let through only a fixed list of values before the call, and end the run on anything else';
const PACKET = {
  finding: { rule: FINDING.ref, path: 'P2.cbl', line: 10, remedy: REMEDY },
  hops: [{ n: 1, path: 'P2.cbl', line: 9, code: '     MOVE LK-CMD TO WS-LOCAL', via: 'MOVE' }],
  sink: { path: 'P2.cbl', line: 10, code: "     CALL 'SYSTEM' USING WS-LOCAL" },
  related: [], declarations: [],
};
const TMP = mkdtempSync(join(tmpdir(), 'cw-remediation-advice-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

test('the advice item for the target puts its text, steps and fix-location test in place of the rule remedy, fenced', () => {
  const { user } = draftPrompt({ packet: PACKET, anchors: anchorsFrom(PACKET), advice: FINDING });
  assert.doesNotMatch(user, /The standard fix for this rule/);
  assert.match(user, /The fix cobolwork advises for this finding:/);
  assert.ok(user.includes(FINDING.remediation.text));
  FINDING.remediation.steps.forEach((s, i) => assert.ok(user.includes(`${i + 1}. ${s}`), `step ${i + 1}`));
  assert.ok(user.includes(`Where the check goes: ${FINDING.remediation.fixAt.test}`));
  const open = user.indexOf('origin="cobolwork:advise"');
  const at = user.indexOf(FINDING.remediation.text);
  assert.ok(open > 0 && open < at && at < user.indexOf('<<<END-UNTRUSTED-DATA', open), 'inside the untrusted-text envelope');
});

test('without an advice item the prompt keeps the rule remedy, and a test-less fix location says why', () => {
  const plain = draftPrompt({ packet: PACKET, anchors: anchorsFrom(PACKET) });
  assert.ok(plain.user.includes(`The standard fix for this rule: ${REMEDY}.`));
  assert.doesNotMatch(plain.user, /cobolwork advises/);
  const why = { ...FINDING, remediation: { ...FINDING.remediation, text: null, steps: [], fixAt: { ...FINDING.remediation.fixAt, test: null, why: 'the command is built at run time' } } };
  const u = draftPrompt({ packet: PACKET, anchors: anchorsFrom(PACKET), advice: why }).user;
  assert.ok(u.includes(REMEDY), 'a null text falls back to the rule remedy');
  assert.ok(u.includes('No check makes this safe: the command is built at run time'));
});

function repo() {
  const root = join(TMP, `r${Math.random().toString(16).slice(2, 8)}`);
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
  spawnSync('git', ['init', '-q', root]);
  for (const [k, v] of [['user.email', 'operator@example.invalid'], ['user.name', 'operator']]) git('config', k, v);
  writeFileSync(join(root, 'P2.cbl'), "       PROCEDURE DIVISION.\n           CALL 'SYSTEM' USING WS-LOCAL\n");
  git('add', '-A'); git('commit', '-qm', 'base');
  return root;
}
// A drafter that keeps the prompt and stops the run, and a bridge whose advise answers as given.
const stopAfterOne = () => { const prompts = []; const fn = async ({ prompt }) => { prompts.push(prompt); return { ok: false, error: 'stopped by the test' }; }; fn.prompts = prompts; return fn; };
const bridgeWith = (advise) => ({ explain: async () => ({ ok: true, packet: PACKET }), gate: async () => { throw new Error('not gated'); }, ...(advise ? { advise } : {}) });

test('remediate drafts from the advice item whose fingerprint is the target, and says which', async () => {
  const d = stopAfterOne(), events = [];
  let asked = null;
  await remediate({ repoPath: repo(), fingerprint: FP, jobId: 'a'.repeat(16), drafter: d, onEvent: (m) => events.push(m),
    bridge: bridgeWith(async (dir) => { asked = dir; return { ok: true, doc: STORED }; }) });
  assert.ok(asked, 'advise ran over the base read from objects');
  assert.ok(d.prompts[0].user.includes(FINDING.remediation.fixAt.test));
  assert.ok(events.includes(`advice: ${FINDING.id}`));
});

test('remediate keeps the rule remedy when advice is unavailable, holds no item for the target, or the bridge has no advise', async () => {
  for (const [bridge, said] of [
    [bridgeWith(async () => ({ ok: false, unavailable: 'cobolwork 0.9.0 has no advise command', reason: 'cobolwork 0.9.0 has no advise command' })), 'advice unavailable, drafting from the rule remedy: cobolwork 0.9.0 has no advise command'],
    [bridgeWith(async () => ({ ok: true, doc: { ...STORED, items: STORED.items.slice(1) } })), 'advice: the document holds no item for this finding; drafting from the rule remedy'],
    [bridgeWith(async () => { throw new Error('advise blew up'); }), 'advice unavailable, drafting from the rule remedy: advise blew up'],
    [bridgeWith(null), 'advice unavailable, drafting from the rule remedy: the bridge has no advise'],
  ]) {
    const d = stopAfterOne(), events = [];
    const r = await remediate({ repoPath: repo(), fingerprint: FP, jobId: 'b'.repeat(16), drafter: d, onEvent: (m) => events.push(m), bridge });
    assert.equal(r.state, 'failed', 'the drafter stopped the run, not the advice');
    assert.ok(d.prompts[0].user.includes(`The standard fix for this rule: ${REMEDY}.`));
    assert.ok(events.includes(said), `${said} in ${JSON.stringify(events)}`);
  }
});

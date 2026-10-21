// monitor/issue-escalate.mjs — the issue-store pager. Fixture-driven via CW_* overrides, no network
// (transport injected), no keychain (CW_SECRETS_FILE points at an empty table BEFORE import, as
// cra/test/escalate.test.mjs does). Proves: opaque payload, https-only, POST-then-record, chain-
// covered fire-once de-dup, loud exit 5, --dry touches nothing, byte-identical re-runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SCHEMA = join(ROOT, 'schema', 'issue.schema.json');
const CLI = join(ROOT, 'monitor', 'issue-escalate.mjs');

const TMP = mkdtempSync(join(tmpdir(), 'cw-issue-escalate-'));
const SECRETS = join(TMP, 'secrets.json');
writeFileSync(SECRETS, JSON.stringify({ version: 1, secrets: {} }));
process.env.CW_SECRETS_FILE = SECRETS;

const { escalateIssues, pageRef, overdueUnpaged, projectEscalation, formatReport, EVENT_TYPE } = await import('../issue-escalate.mjs');
const { emptyIssuesDoc, mintIssue, claimIssue, releaseIssue, loadIssues, verifyChain } = await import('../issue-store.mjs');

const T0 = '2026-07-01T00:00:00.000Z';          // created → crit SLA due 2026-07-08
const NOW = '2026-08-23T00:00:00.000Z';         // 46 d past due
const HOOK = 'https://example.test/hook';
const ENV = { CW_ISSUE_WEBHOOK_URL: HOOK, CW_SECRETS_FILE: SECRETS };

const keyed = (key, o = {}) => ({
  area: 'fixture-area', repo: 'r1', kind: 'vuln', title: 'lodash@4.17.20 GHSA-xxxx (r1)', severity: 'crit',
  source: { kind: 'finding', key, tool: 'osv', rule: null }, ...o,
});

let n = 0;
// One crit issue, overdue and untouched, unless the caller mutates the doc first.
function fixture(mutate = () => {}) {
  const doc = Object.assign(emptyIssuesDoc(), { organisation: 'PORTLL' });
  const { id } = mintIssue(doc, keyed('f:r1|lodash|GHSA-xxxx'), T0);
  mutate(doc, id);
  const path = join(TMP, `issues-${n++}.json`);
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  return { path, id };
}

function recorder(impl = async () => ({ ok: true })) {
  const calls = [];
  const post = async (url, body) => { calls.push({ url, body: JSON.parse(JSON.stringify(body)) }); return impl(url, body); };
  return { calls, post };
}

const run = (o) => escalateIssues({ env: ENV, now: NOW, schemaPath: SCHEMA, logger: { error() {}, log() {} }, ...o });

test('overdue + untouched ⇒ posted once with an OPAQUE body; paged event appended AFTER success; chain verifies; store reloads', async () => {
  const { path, id } = fixture();
  const { calls, post } = recorder();
  const r = await run({ post, issuesPath: path });
  assert.equal(r.exit, 0);
  assert.equal(r.reason, 'paged');
  assert.equal(r.overdue, 1);
  assert.equal(r.paged, 1);
  assert.equal(calls.length, 1, 'one POST per issue');
  assert.equal(calls[0].url, HOOK);
  const s = JSON.stringify(calls[0].body);
  assert.doesNotMatch(s, new RegExp(id), 'issue id must never be on the wire');
  assert.doesNotMatch(s, /lodash|GHSA|r1|fixture-area/, 'title/package/repo/area must never be on the wire');
  assert.equal(calls[0].body.ref, pageRef(id));
  assert.match(calls[0].body.ref, /^[0-9a-f]{16}$/);
  assert.equal(calls[0].body.severity, 'crit');
  assert.equal(calls[0].body.overdueByDays, 46);
  assert.equal(calls[0].body.count, 1);

  // The store loads through the schema gate — the exact thing a new event type / field can break.
  const doc = loadIssues({ path, schemaPath: SCHEMA });
  assert.deepEqual(verifyChain(doc), []);
  const paged = doc.events.filter((e) => e.type === EVENT_TYPE);
  assert.equal(paged.length, 1);
  assert.equal(paged[0].issueId, id);
  assert.equal(paged[0].at, NOW);
  assert.deepEqual(paged[0].data, {
    slaDueAt: doc.issues[id].slaDueAt, severity: 'crit', ref: pageRef(id), overdueByDays: 46, target: 'webhook',
  });
  assert.ok(paged[0].hash && paged[0].prevHash !== undefined, 'paged event is on the hash chain');
  // Projection on the record, derived from the event.
  assert.equal(doc.issues[id].escalated, true);
  assert.equal(doc.issues[id].escalatedAt, NOW);
  assert.equal(doc.issues[id].updatedAt, NOW);
});

test('second run over the same slaDueAt ⇒ nothing posted, nothing written (idempotent)', async () => {
  const { path } = fixture();
  await run({ post: recorder().post, issuesPath: path });
  const before = readFileSync(path, 'utf8');
  const { calls, post } = recorder();
  const r = await run({ post, issuesPath: path });
  assert.equal(r.exit, 0);
  assert.equal(r.reason, 'nothing-overdue-unpaged');
  assert.equal(r.overdue, 0);
  assert.equal(calls.length, 0);
  assert.equal(readFileSync(path, 'utf8'), before, 'store bytes unchanged');
});

test('a moved slaDueAt re-arms the page (de-dup key is {issueId, slaDueAt}, not the record field)', async () => {
  const { path, id } = fixture();
  await run({ post: recorder().post, issuesPath: path });
  // Simulate a reopen that re-based the SLA: still in the past, different instant.
  const doc = loadIssues({ path, schemaPath: SCHEMA });
  doc.issues[id].slaDueAt = '2026-08-01T00:00:00.000Z';
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  // The projection reads false for the new due until it is paged again.
  assert.equal(projectEscalation(doc.issues[id], doc.events), false);
  const { calls, post } = recorder();
  const r = await run({ post, issuesPath: path });
  assert.equal(r.paged, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.overdueByDays, 22);
  const after = loadIssues({ path, schemaPath: SCHEMA });
  assert.equal(after.events.filter((e) => e.type === EVENT_TYPE).length, 2);
  assert.deepEqual(verifyChain(after), []);
});

test('post failure ⇒ no event written, no projection, exit 5 surfaced', async () => {
  const { path, id } = fixture();
  const before = readFileSync(path, 'utf8');
  const { calls, post } = recorder(async () => ({ ok: false, why: 'http-500' }));
  const r = await run({ post, issuesPath: path });
  assert.equal(r.exit, 5);
  assert.equal(r.reason, 'delivery-failure');
  assert.equal(r.failed, 1);
  assert.equal(r.paged, 0);
  assert.equal(calls.length, 1);
  assert.equal(readFileSync(path, 'utf8'), before, 'a failed page writes nothing');
  const doc = loadIssues({ path, schemaPath: SCHEMA });
  assert.equal(doc.events.filter((e) => e.type === EVENT_TYPE).length, 0);
  assert.equal(doc.issues[id].escalated, undefined);
});

test('a transport that throws is one failed page, not an aborted run — delivered siblings still record; exit 5', async () => {
  const doc = Object.assign(emptyIssuesDoc(), { organisation: 'PORTLL' });
  const first = mintIssue(doc, keyed('f:a'), T0).id;
  const second = mintIssue(doc, keyed('f:b'), T0).id;
  const path = join(TMP, `issues-${n++}.json`);
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  const [lo, hi] = [first, second].sort();
  let i = 0;
  const { calls, post } = recorder(async () => { if (i++ === 0) throw new Error('boom'); return { ok: true }; });
  const r = await run({ post, issuesPath: path });
  assert.equal(r.exit, 5);
  assert.equal(r.reason, 'delivery-failure');
  assert.equal(r.failed, 1);
  assert.equal(r.paged, 1);
  assert.equal(calls.length, 2);
  const after = loadIssues({ path, schemaPath: SCHEMA });
  const paged = after.events.filter((e) => e.type === EVENT_TYPE);
  assert.equal(paged.length, 1);
  assert.equal(paged[0].issueId, hi, 'the second (delivered) page is recorded; the thrown one is not');
  assert.equal(after.issues[lo].escalated, undefined);
  assert.equal(after.issues[hi].escalated, true);
  assert.deepEqual(verifyChain(after), []);
});

test('claimed issue ⇒ not paged; released-after-attempt issue ⇒ not paged', async () => {
  const claimed = fixture((doc, id) => claimIssue(doc, id, { by: 'loop', sessionId: 's1', at: T0, ttlHours: 24 * 365 }));
  const attempted = fixture((doc, id) => {
    claimIssue(doc, id, { by: 'loop', sessionId: 's1', at: T0, ttlHours: 1 });
    releaseIssue(doc, id, { at: '2026-07-01T01:00:00.000Z', sessionId: 's1' });
  });
  for (const { path } of [claimed, attempted]) {
    const { calls, post } = recorder();
    const r = await run({ post, issuesPath: path });
    assert.equal(r.overdue, 0);
    assert.equal(r.exit, 0);
    assert.equal(calls.length, 0);
  }
  const att = loadIssues({ path: attempted.path, schemaPath: SCHEMA });
  assert.equal(Object.values(att.issues)[0].state, 'open', 'the released issue is open — attemptCount alone excluded it');
});

test('not yet due ⇒ not paged', async () => {
  const { path } = fixture();
  const { calls, post } = recorder();
  const r = await run({ post, issuesPath: path, now: '2026-07-05T00:00:00.000Z' });
  assert.equal(r.overdue, 0);
  assert.equal(calls.length, 0);
});

test('--dry ⇒ lists what would page, posts nothing, writes nothing, does not resolve the webhook', async () => {
  const { path, id } = fixture();
  const before = readFileSync(path, 'utf8');
  const { calls, post } = recorder();
  const r = await run({ post, issuesPath: path, dry: true, env: { CW_SECRETS_FILE: SECRETS } });
  assert.equal(r.exit, 0);
  assert.equal(r.reason, 'dry-run');
  assert.equal(r.overdue, 1);
  assert.equal(r.pending[0].issueId, id);
  assert.equal(r.pending[0].ref, pageRef(id));
  assert.equal(calls.length, 0);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.match(formatReport(r), /\(dry\): 1 overdue/);
});

test('overdue with no resolvable CW_ISSUE_WEBHOOK_URL is LOUD — exit 5, names the env var, nothing written', async () => {
  const { path } = fixture();
  const before = readFileSync(path, 'utf8');
  const errs = [];
  const { calls, post } = recorder();
  const r = await run({ post, issuesPath: path, env: { CW_SECRETS_FILE: SECRETS }, logger: { error: (m) => errs.push(String(m)), log() {} } });
  assert.equal(r.exit, 5);
  assert.equal(r.reason, 'no-target');
  assert.equal(r.failed, 1);
  assert.equal(calls.length, 0);
  assert.ok(errs.some((m) => m.includes('CW_ISSUE_WEBHOOK_URL')), `stderr names the env var: ${errs.join(' | ')}`);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('a non-https webhook is refused in the core — exit 5, the injected transport is never called', async () => {
  const { path } = fixture();
  const { calls, post } = recorder();
  const r = await run({ post, issuesPath: path, env: { CW_ISSUE_WEBHOOK_URL: 'http://insecure.test/hook', CW_SECRETS_FILE: SECRETS } });
  assert.equal(r.exit, 5);
  assert.equal(r.reason, 'webhook-url-not-https');
  assert.equal(calls.length, 0);
});

test('a corrupt store fails closed — the run throws rather than reading "no issues"', async () => {
  const path = join(TMP, 'corrupt.json');
  writeFileSync(path, '{"note": "truncated mid-wri');
  await assert.rejects(() => run({ post: recorder().post, issuesPath: path }), /not valid JSON/);
});

test('overdueUnpaged is sorted by issue id and reads the store, not the record projection', () => {
  const doc = Object.assign(emptyIssuesDoc(), { organisation: 'PORTLL' });
  const b = mintIssue(doc, keyed('f:b'), T0).id;
  const a = mintIssue(doc, keyed('f:a'), T0).id;
  // A stale projection (escalated:true with no event) must NOT suppress a page: the chain is truth.
  doc.issues[a].escalated = true; doc.issues[a].escalatedAt = T0;
  const out = overdueUnpaged(doc, NOW);
  assert.deepEqual(out.map((p) => p.issueId), [a, b].sort());
});

test('CLI: --dry --json is byte-identical across two runs under a fixed CW_NOW; exit 0', () => {
  const { path } = fixture();
  const env = { ...process.env, CW_ISSUES: path, CW_ISSUE_SCHEMA: SCHEMA, CW_SECRETS_FILE: SECRETS, CW_NOW: NOW };
  delete env.CW_ISSUE_WEBHOOK_URL; delete env.CW_ESCALATE_NOW;
  const one = execFileSync(process.execPath, [CLI, '--dry', '--json'], { env, encoding: 'utf8' });
  const two = execFileSync(process.execPath, [CLI, '--dry', '--json'], { env, encoding: 'utf8' });
  assert.equal(one, two);
  const parsed = JSON.parse(one);
  assert.equal(parsed.at, NOW);
  assert.equal(parsed.overdue, 1);
  assert.equal(parsed.exit, 0);
});

test('CLI: overdue + no webhook ⇒ exit 5 naming CW_ISSUE_WEBHOOK_URL; unknown flag ⇒ exit 2, no page', () => {
  const { path } = fixture();
  const before = readFileSync(path, 'utf8');
  const env = { ...process.env, CW_ISSUES: path, CW_ISSUE_SCHEMA: SCHEMA, CW_SECRETS_FILE: SECRETS, CW_NOW: NOW };
  delete env.CW_ISSUE_WEBHOOK_URL; delete env.CW_ESCALATE_NOW;
  let status = null, stderr = '';
  try { execFileSync(process.execPath, [CLI], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { status = e.status; stderr = String(e.stderr); }
  assert.equal(status, 5);
  assert.match(stderr, /CW_ISSUE_WEBHOOK_URL/);
  assert.equal(readFileSync(path, 'utf8'), before);

  let status2 = null;
  try { execFileSync(process.execPath, [CLI, '--fire'], { env: { ...env, CW_ISSUE_WEBHOOK_URL: HOOK }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { status2 = e.status; }
  assert.equal(status2, 2);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));

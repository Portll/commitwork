// cra/escalate.mjs — the pager. Fixture-driven, no network (fetch mocked), no keychain (empty
// secrets table via CW_SECRETS_FILE set before import). Proves: opaque payload, https-only,
// POST-then-record, fire-once dedup, loud exit-5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hermetic secrets: point CW_SECRETS_FILE at an empty table BEFORE importing escalate (which
// imports lib/secrets.mjs, capturing SECRETS_FILE at load), so resolveInto never touches the
// operator's real keychain.
const TMP = mkdtempSync(join(tmpdir(), 'cw-escalate-'));
const SECRETS = join(TMP, 'secrets.json');
writeFileSync(SECRETS, JSON.stringify({ version: 1, secrets: {} }));
process.env.CW_SECRETS_FILE = SECRETS;
const { escalate, pageRef } = await import('../escalate.mjs');

const AT = '2026-09-20T00:00:00.000Z';
const CASE_ID = 'client-a--cve-2026-9999';
const VULN = 'CVE-2026-9999';

let fixtureN = 0;
function fixture({ early = '2026-09-19T14:00:00.000Z', notif = '2026-09-19T19:00:00.000Z', final = '2026-12-01T00:00:00.000Z', status = 'open' } = {}) {
  const cases = join(TMP, `cases-${fixtureN++}.json`);
  writeFileSync(cases, JSON.stringify({
    note: 'test', events: [],
    cases: {
      [CASE_ID]: {
        caseId: CASE_ID, productId: 'client-a', vulnId: VULN, kind: 'vulnerability', status,
        clocks: { earlyWarningDue: early, notificationDue: notif, finalDue: final },
      },
    },
  }));
  return cases;
}

function mockFetch(impl) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return impl(); };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('overdue clocks page once, with an OPAQUE payload, and a chain-covered paged event', async () => {
  const cases = fixture();                       // early + notification are before AT (overdue); final is future
  const m = mockFetch(() => ({ ok: true, status: 200 }));
  try {
    const r = await escalate({ paths: { cases }, at: AT, env: { CRA_WEBHOOK_URL: 'https://example.test/hook' } });
    assert.equal(r.exit, 0);
    assert.equal(r.paged, 2, 'early-warning + notification are both overdue');
    assert.equal(m.calls.length, 2);
    for (const c of m.calls) {
      const s = JSON.stringify(c.body);
      assert.doesNotMatch(s, new RegExp(CASE_ID), 'caseId must never be on the wire');
      assert.doesNotMatch(s, new RegExp(VULN), 'vulnId must never be on the wire');
      assert.doesNotMatch(s, /client-a/, 'product must never be on the wire');
      assert.equal(c.body.ref, pageRef(CASE_ID));
      assert.match(c.body.ref, /^[0-9a-f]{16}$/);
      assert.ok(c.body.clock && c.body.due);
    }
    const doc = JSON.parse(readFileSync(cases, 'utf8'));
    const paged = doc.events.filter((e) => e.type === 'paged');
    assert.equal(paged.length, 2, 'two paged events recorded, on the hash chain');
    assert.ok(paged.every((e) => e.hash && e.prevHash !== undefined), 'paged events are chained');

    // Re-run: everything is already paged → nothing fires.
    const m2 = mockFetch(() => ({ ok: true, status: 200 }));
    try {
      const r2 = await escalate({ paths: { cases }, at: AT, env: { CRA_WEBHOOK_URL: 'https://example.test/hook' } });
      assert.equal(r2.paged, 0);
      assert.equal(r2.exit, 0);
      assert.equal(m2.calls.length, 0, 'no re-page for an already-paged clock');
    } finally { m2.restore(); }
  } finally { m.restore(); }
});

test('a non-https webhook is refused — exit 5, no delivery, no paged event', async () => {
  const cases = fixture();
  const m = mockFetch(() => ({ ok: true, status: 200 }));
  try {
    const r = await escalate({ paths: { cases }, at: AT, env: { CRA_WEBHOOK_URL: 'http://insecure.test/hook' } });
    assert.equal(r.exit, 5);
    assert.equal(r.paged, 0);
    assert.equal(m.calls.length, 0, 'a non-https target must never be POSTed to');
    const doc = JSON.parse(readFileSync(cases, 'utf8'));
    assert.equal(doc.events.filter((e) => e.type === 'paged').length, 0);
  } finally { m.restore(); }
});

test('overdue with no resolvable CRA_WEBHOOK_URL is LOUD — exit 5, nothing recorded', async () => {
  const cases = fixture();
  const r = await escalate({ paths: { cases }, at: AT, env: {} });
  assert.equal(r.exit, 5);
  assert.equal(r.reason, 'no-target');
  const doc = JSON.parse(readFileSync(cases, 'utf8'));
  assert.equal(doc.events.length, 0);
});

test('nothing overdue ⇒ quiet exit 0', async () => {
  const cases = fixture({ early: '2026-12-01T00:00:00.000Z', notif: '2026-12-02T00:00:00.000Z' }); // all future
  const m = mockFetch(() => ({ ok: true, status: 200 }));
  try {
    const r = await escalate({ paths: { cases }, at: AT, env: { CRA_WEBHOOK_URL: 'https://example.test/hook' } });
    assert.equal(r.exit, 0);
    assert.equal(r.overdue, 0);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));

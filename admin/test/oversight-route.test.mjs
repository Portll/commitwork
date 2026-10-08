// The oversight route's whole value is that the name on a record is the name of whoever was
// authenticated when it was written, and that signing changes nothing else. These pin both.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/oversight.mjs';

const GET = routes.find((r) => r.method === 'GET');
const POST = routes.find((r) => r.method === 'POST');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cw-oversight-'));
  process.env.CW_VERDICT_DIR = TMP;
});
after(() => { delete process.env.CW_VERDICT_DIR; rmSync(TMP, { recursive: true, force: true }); });

function call(route, { session = { user: 'op@example.com', provider: 'local' }, body, query = '' } = {}) {
  let out = null;
  const ctx = {
    req: {},
    query: new URLSearchParams(query),
    adminSession: () => session,
    send: (status, payload) => { out = { status, payload }; },
    readJsonBody: (_req, cb) => cb(body, null),
  };
  route.handle(ctx);
  return out;
}

const SUBJECT = { repo: 'commitwork', file: 'monitor/rollup.mjs', rule: 'js/insecure-object-assign' };
const VALID = { stance: 'corroborate', basis: 'read the SARIF and the annotation; the suppression reason matches the code', subject: SUBJECT };
const q = (s) => `repo=${s.repo}&file=${encodeURIComponent(s.file)}&rule=${encodeURIComponent(s.rule)}`;

describe('gate', () => {
  test('both routes exist for the dispatcher and refuse without a session — loopback included', () => {
    assert.ok(GET && POST, 'routes must be exported for the serve.mjs dispatcher');
    for (const r of [GET, POST]) {
      assert.equal(call(r, { session: null, body: VALID }).status, 401);
    }
  });
});

describe('attribution — the control the ledger exists for', () => {
  test('THE DEFECT: a body naming its own `who` must NOT win over the session', () => {
    const res = call(POST, { body: { ...VALID, who: 'somebody-else@evil.example' } });
    assert.equal(res.status, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.recorded.who, 'op@example.com (local)',
      'who must come from the session; a caller that can name itself can sign as anybody');
  });

  test('the provider travels with the identity — SSO is not the same evidence as a local password', () => {
    const res = call(POST, { session: { user: 'a@b.c', provider: 'github' }, body: VALID });
    assert.match(res.payload.recorded.who, /\(github\)$/);
  });
});

describe('write contract', () => {
  test('a write says it suppresses NOTHING, every time', () => {
    const res = call(POST, { body: VALID });
    assert.equal(res.payload.suppresses, false,
      'a UI that renders ok:true as "handled" is how an attestation starts doing a suppression job');
    assert.match(res.payload.effect, /changes no severity/);
  });

  test('an invalid record is refused with every reason, not just the first', () => {
    const res = call(POST, { body: { stance: 'lgtm', subject: {} } });
    assert.equal(res.status, 400);
    assert.ok(res.payload.errors.length >= 3, `expected several reasons, got ${JSON.stringify(res.payload.errors)}`);
  });

  test('a line-keyed subject is refused at the transport too, not only in the library', () => {
    const res = call(POST, { body: { ...VALID, subject: { ...SUBJECT, line: 12 } } });
    assert.equal(res.status, 400);
    assert.match(res.payload.error, /subject\.line/);
  });

  test('a malformed body is a 400, never a silent no-op', () => {
    assert.equal(call(POST, { body: null }).status, 400);
  });

  test('IT LANDS IN THE HASH CHAIN — the record carries prev, and the first one is genesis', () => {
    const file = join(TMP, 'oversight.jsonl');
    assert.ok(existsSync(file), 'the journal file must exist after a write');
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.length >= 1);
    assert.equal(lines[0].prev, 'genesis', 'a fresh ledger opens at genesis');
    assert.ok(lines.every((l) => typeof l.prev === 'string' && l.prev), 'every record must carry prev');
    assert.equal(lines[0].gate, 'oversight');
  });
});

describe('reading it back', () => {
  test('a subject folds to a state, and the CHAIN VERDICT travels with it', () => {
    const res = call(GET, { query: q(SUBJECT) });
    assert.equal(res.status, 200);
    assert.ok(['corroborated', 'disputed', 'mixed'].includes(res.payload.oversight.state));
    assert.ok(res.payload.chain, 'a caller must see whether the chain it is trusting still verifies');
    assert.equal(typeof res.payload.chain.verified, 'number');
  });

  test('a subject nobody signed is `none` — never an empty-but-clean-looking answer', () => {
    const res = call(GET, { query: 'repo=commitwork&file=never/touched.mjs&rule=x' });
    assert.equal(res.payload.oversight.state, 'none');
    assert.deepEqual(res.payload.records, []);
  });

  test('no subject named returns the ledger and a NULL fold, not a fold over everything', () => {
    const res = call(GET, {});
    assert.equal(res.payload.oversight, null,
      'a fold with no subject would be a verdict about nothing in particular');
    assert.ok(Array.isArray(res.payload.records));
  });

  test('a dispute is visible as a dispute, and outranks nothing silently', () => {
    call(POST, { session: { user: 'reviewer@x.y', provider: 'local' }, body: { ...VALID, stance: 'dispute', basis: 'the annotation cites literal keys but the call takes a request field' } });
    const res = call(GET, { query: q(SUBJECT) });
    assert.equal(res.payload.oversight.state, 'mixed', 'one corroboration and one dispute is MIXED, not averaged away');
    assert.ok(res.payload.oversight.disputed.includes('reviewer@x.y (local)'));
  });
});

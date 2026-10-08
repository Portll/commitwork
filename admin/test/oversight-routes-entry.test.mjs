// admin/routes/oversight.mjs — GET/POST /api/oversight against the ledger file itself.
//
// oversight-route.test.mjs pins attribution and the fold through the responses. These read the
// journal on disk (CW_VERDICT_DIR → TMP): what a signature writes, that a refusal writes nothing,
// and that a ledger which exists but cannot be read is a 503 rather than "nobody has signed".
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-oversight-entry-'));
const DIR = join(TMP, 'verdicts');
process.env.CW_VERDICT_DIR = DIR;
process.env.HOME = TMP;

const { routes } = await import('../routes/oversight.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const LEDGER = join(DIR, 'oversight.jsonl');
const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/oversight');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/oversight');
const OPERATOR = { user: 'reviewer@example.test', provider: 'local' };

function call(route, { query = '', body = null, readErr = null, session = OPERATOR } = {}) {
  let out = null;
  route.handle({
    req: {}, query: new URLSearchParams(query), adminSession: () => session,
    send: (status, payload) => { out = { status, body: payload }; },
    readJsonBody: (_req, cb) => (readErr ? cb(null, readErr) : cb(body, null)),
  });
  assert.ok(out, 'the handler answered nothing');
  return out;
}
const lines = () => (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const SUBJECT = { repo: 'fixrepo', file: 'src/db.js', rule: 'js/sql-injection' };
const SIGN = { stance: 'corroborate', basis: 'read the flagged query; the input is a fixture constant', subject: SUBJECT };
const q = (s) => `repo=${s.repo}&file=${encodeURIComponent(s.file)}&rule=${encodeURIComponent(s.rule)}`;

beforeEach(() => rmSync(DIR, { recursive: true, force: true }));

describe('POST /api/oversight', () => {
  test('no session: refused, and no ledger is created', () => {
    const res = call(POST, { body: SIGN, session: null });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /no authenticated author attests nothing/);
    assert.equal(existsSync(LEDGER), false);
  });

  test('a body that is not an object, or that the reader refused, is a 400 and writes nothing', () => {
    assert.deepEqual(call(POST, { body: null }), { status: 400, body: { ok: false, error: 'body must be a JSON object' } });
    assert.equal(call(POST, { readErr: 'body is not valid JSON' }).status, 400);
    assert.equal(existsSync(LEDGER), false);
  });

  test('a signature lands as one chained line carrying the session\'s identity and the subject', () => {
    const res = call(POST, { body: SIGN });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [rec] = lines();
    assert.equal(rec.gate, 'oversight');
    assert.equal(rec.prev, 'genesis', 'the first record of a fresh ledger opens the chain');
    assert.equal(rec.stance, 'corroborate');
    assert.equal(rec.who, 'reviewer@example.test (local)');
    assert.equal(rec.session, 'reviewer@example.test (local)');
    assert.deepEqual(rec.subject, SUBJECT);
    assert.equal(rec.basis, SIGN.basis);
  });

  test('a second signature chains onto the first rather than restarting it', () => {
    call(POST, { body: SIGN });
    call(POST, { body: { ...SIGN, stance: 'dispute', basis: 'the query is reachable from the public handler' } });
    const recs = lines();
    assert.equal(recs.length, 2);
    assert.notEqual(recs[1].prev, 'genesis');
    assert.match(String(recs[1].prev), /^[0-9a-f]{16,}$/);
  });

  test('an invalid stance is refused with the reasons and the ledger is not touched', () => {
    call(POST, { body: SIGN });
    const before = readFileSync(LEDGER, 'utf8');
    const res = call(POST, { body: { ...SIGN, stance: 'lgtm' } });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.body.errors) && res.body.errors.length >= 1);
    assert.equal(readFileSync(LEDGER, 'utf8'), before);
  });
});

describe('GET /api/oversight', () => {
  test('no session, no ledger', () => {
    const res = call(GET, { session: null });
    assert.equal(res.status, 401);
    assert.equal(res.body.records, undefined);
  });

  test('an absent ledger says absent, with no records and a null fold', () => {
    const res = call(GET);
    assert.equal(res.status, 200);
    assert.equal(res.body.absent, true);
    assert.deepEqual(res.body.records, []);
    assert.equal(res.body.oversight, null);
  });

  test('a named subject returns only its own records, read back from the file that was written', () => {
    call(POST, { body: SIGN });
    call(POST, { body: { ...SIGN, subject: { ...SUBJECT, file: 'src/other.js' } } });
    const res = call(GET, { query: q(SUBJECT) });
    assert.equal(res.status, 200);
    assert.equal(res.body.absent, false);
    assert.equal(res.body.records.length, 1);
    assert.equal(res.body.records[0].subject.file, 'src/db.js');
    assert.deepEqual(res.body.subject, { ...SUBJECT, package: undefined });
    assert.ok(res.body.oversight, 'a signed subject folds to a state');
    assert.equal(res.body.chain.broken, 0);
  });

  test('a ledger that exists and cannot be read is a 503, never an empty ledger', () => {
    mkdirSync(LEDGER, { recursive: true });            // a directory where the journal should be
    const res = call(GET);
    assert.equal(res.status, 503);
    assert.match(res.body.error, /oversight ledger unreadable/);
    assert.equal(res.body.records, undefined);
  });
});

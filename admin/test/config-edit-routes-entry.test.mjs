// admin/routes/config-edit.mjs — GET/POST /api/config/file, the refusals config-edit.test.mjs does
// not reach: inherited object keys and traversal strings as the key, an unreadable target, and the
// create-from-absent path whose only valid base version is the empty string.
//
// Every editable record is pointed into TMP twice over: CW_CONFIG_ROOT moves the resolver root, and
// each record's own CW_* override names the same file, so neither alone can send a write to the
// sidecar. Every refusal asserts the disk afterwards, not only the status.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-cfgedit-entry-'));
const ROOT = join(TMP, 'root');
const PRIV = join(ROOT, 'monitor', 'private');
process.env.CW_CONFIG_ROOT = ROOT;
process.env.CW_REGISTRY = join(PRIV, 'projects.json');
process.env.CW_ANNOTATIONS = join(PRIV, 'annotations.json');
process.env.CW_GATE_EXEMPTIONS = join(PRIV, 'gate-exemptions.json');
process.env.CW_STUB_ALLOWLIST = join(PRIV, 'stub-allowlist.json');
process.env.HOME = TMP;

const { routes, hashOf } = await import('../routes/config-edit.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/config/file');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/config/file');
const EXEMPT = join(PRIV, 'gate-exemptions.json');

function call(route, { query = {}, body = null, readErr = null, authed = true } = {}) {
  let out = null;
  route.handle({
    req: {},
    query: new URLSearchParams(query),
    adminSession: () => (authed ? { user: 'op@example.test' } : null),
    send: (status, payload) => { out = { status, body: payload }; },
    readJsonBody: (_req, cb) => (readErr ? cb(null, readErr) : cb(body, null)),
  });
  assert.ok(out, 'the handler answered nothing');
  return out;
}
/** Every file under TMP, so a refusal can be shown to have written nothing anywhere. */
const tree = () => readdirSync(TMP, { recursive: true }).map(String).sort();

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(PRIV, { recursive: true });
});

describe('GET /api/config/file', () => {
  test('no session, no bytes', () => {
    writeFileSync(EXEMPT, '{"exemptions":[]}');
    const res = call(GET, { query: { name: 'gateExemptions' }, authed: false });
    assert.equal(res.status, 401);
    assert.equal(res.body.text, undefined);
  });

  test('a traversal string or an inherited object key is not an editable name', () => {
    for (const name of ['../../../etc/passwd', 'monitor/private/projects.json', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const res = call(GET, { query: { name } });
      assert.equal(res.status, 400, name);
      assert.equal(res.body.error, `not an editable config file: '${name}'`);
    }
  });

  test('an absent record is missing:true with no text and no version, not an empty file', () => {
    const res = call(GET, { query: { name: 'gateExemptions' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.missing, true);
    assert.equal(res.body.text, null);
    assert.equal(res.body.hash, null);
    assert.equal(res.body.file, join('monitor', 'private', 'gate-exemptions.json'));
    assert.equal(res.body.label, 'gate exemptions');
  });

  test('a target that exists and cannot be read is a 500, never an empty editor', () => {
    mkdirSync(EXEMPT);                       // a directory where the file should be: EISDIR on read
    const res = call(GET, { query: { name: 'gateExemptions' } });
    assert.equal(res.status, 500);
    assert.match(res.body.error, /could not read monitor\/private\/gate-exemptions\.json/);
    assert.equal(res.body.text, undefined);
  });
});

describe('POST /api/config/file', () => {
  const TEXT = '{\n  "exemptions": []\n}\n';

  test('no session: refused, and nothing is created', () => {
    const before = tree();
    const res = call(POST, { body: { name: 'gateExemptions', text: TEXT, baseHash: '' }, authed: false });
    assert.equal(res.status, 401);
    assert.deepEqual(tree(), before);
  });

  test('a body the reader refused is a 400 carrying its reason', () => {
    const res = call(POST, { readErr: 'body too large' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'body too large');
  });

  test('a traversal string as the name writes nothing, anywhere', () => {
    const before = tree();
    for (const name of ['../../escape.json', '/etc/hosts', '__proto__']) {
      const res = call(POST, { body: { name, text: '{}', baseHash: '' } });
      assert.equal(res.status, 400, name);
      assert.match(res.body.error, /not an editable config file/);
    }
    assert.deepEqual(tree(), before);
    assert.equal(existsSync(join(TMP, 'escape.json')), false);
  });

  test('text that is not a string is refused before any parse or write', () => {
    const res = call(POST, { body: { name: 'gateExemptions', text: { exemptions: [] }, baseHash: '' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'text must be a string');
    assert.equal(existsSync(EXEMPT), false);
  });

  test('creating an absent record with no baseHash is refused: absence is a version too', () => {
    const res = call(POST, { body: { name: 'gateExemptions', text: TEXT } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /baseHash is required/);
    assert.equal(existsSync(EXEMPT), false);
  });

  test('creating an absent record with a non-empty baseHash conflicts and hands back null bytes', () => {
    const res = call(POST, { body: { name: 'gateExemptions', text: TEXT, baseHash: hashOf('{}') } });
    assert.equal(res.status, 409);
    assert.equal(res.body.currentHash, null);
    assert.equal(res.body.currentText, null);
    assert.equal(existsSync(EXEMPT), false);
  });

  test('creating an absent record with baseHash "" writes exactly the bytes sent, and GET then serves them', () => {
    const res = call(POST, { body: { name: 'gateExemptions', text: TEXT, baseHash: '' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ok: true, name: 'gateExemptions', file: join('monitor', 'private', 'gate-exemptions.json'), hash: hashOf(TEXT), bytes: Buffer.byteLength(TEXT) });
    assert.equal(readFileSync(EXEMPT, 'utf8'), TEXT);
    const read = call(GET, { query: { name: 'gateExemptions' } });
    assert.equal(read.body.missing, false);
    assert.equal(read.body.text, TEXT);
    assert.equal(read.body.hash, res.body.hash);
  });

  test('a write against an unreadable target is a 500 and leaves it in place', () => {
    mkdirSync(EXEMPT);
    const res = call(POST, { body: { name: 'gateExemptions', text: TEXT, baseHash: '' } });
    assert.equal(res.status, 500);
    assert.match(res.body.error, /could not read the current file/);
    assert.deepEqual(readdirSync(EXEMPT), []);
  });
});

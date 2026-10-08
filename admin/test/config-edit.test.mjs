// The config editor's guards. This route can rewrite the files that decide what is scanned and
// which findings are suppressed, and it is reachable on the PUBLISHED port by an explicit operator
// decision — so the guards below are standing in for the port boundary that used to do this job.
//
// Every test asserts an EFFECT on disk, not a status code. A 400 proves the handler returned early;
// it does not prove the file was left alone, and only one of those is the property that matters.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { routes, EDITABLE, hashOf } from '../routes/config-edit.mjs';
import { registryPathFor, annotationsPathFor, gateExemptionsPathFor, stubAllowlistPathFor } from '../../monitor/store-paths.mjs';

const GET = routes.find((r) => r.method === 'GET');
const POST = routes.find((r) => r.method === 'POST');

let root;
const ORIGINAL = JSON.stringify({ projects: [{ name: 'a', area: 'x' }] }, null, 2);

/** Where the registry lives under `root` — through the resolver, never a literal. See the guard below. */
const registryIn = (r) => registryPathFor(r);

beforeEach(() => {
  // CW_REGISTRY is honoured by registryPathFor, so a value inherited from the surrounding shell
  // would point this suite's writes at the LIVE registry. That is not hypothetical: it is how a
  // sandboxed fixture reached monitor/private/projects.json on 2026-09-01.
  delete process.env.CW_REGISTRY;
  root = mkdtempSync(join(tmpdir(), 'cw-cfg-'));
  mkdirSync(dirname(registryIn(root)), { recursive: true });
  writeFileSync(registryIn(root), ORIGINAL);
  process.env.CW_CONFIG_ROOT = root;
});

const onDisk = () => readFileSync(registryIn(root), 'utf8');

/** A ctx that records what was sent, with a session unless told otherwise. */
function ctx({ authed = true, query = {}, body = null } = {}) {
  const out = {};
  return {
    out,
    req: {},
    adminSession: () => (authed ? { user: 'op@example.com' } : null),
    query: new Map(Object.entries(query).map(([k, v]) => [k, String(v)])),
    send: (status, payload) => { out.status = status; out.payload = payload; },
    readJsonBody: (_req, cb) => cb(body, null),
  };
}

describe('config editor — it edits the file the fleet reads', () => {
  // The defect this pins, found 2026-09-01: EDITABLE named the literal 'monitor/projects.json'
  // while monitor/registry.mjs resolved monitor/private/projects.json (a symlink to the sidecar).
  // The panel saved successfully, the bytes landed, and the fleet went on scanning a registry the
  // operator had never edited. Nothing failed — which is why only an equality between the two
  // resolvers can catch it, not any assertion about the write succeeding.

  test('the registry entry resolves to the same path the registry loader does', () => {
    assert.equal(EDITABLE.projects.resolvePath(root), registryPathFor(root),
      'the editor and monitor/registry.mjs must reach the registry through the SAME resolver');
  });

  test('and it is NOT the declared literal — the direction that lies', () => {
    // Asserted separately and in the opposite direction. If the registry ever moves back, the test
    // above still passes while this one fails, which is the signal that the two have re-diverged.
    assert.notEqual(EDITABLE.projects.resolvePath(root), join(root, 'monitor', 'projects.json'),
      'resolving to the literal means the resolver was copied rather than called');
    assert.ok(!existsSync(join(root, 'monitor', 'projects.json')),
      'the fixture must not also exist at the old path, or both readings would look correct');
  });

  test('the judgment ledgers resolve through the same resolvers their readers use', () => {
    // Same defect class as the registry: these moved to monitor/private/ on 2026-09-30.
    assert.equal(EDITABLE.annotations.resolvePath(root), annotationsPathFor(root));
    assert.equal(EDITABLE.gateExemptions.resolvePath(root), gateExemptionsPathFor(root));
    assert.equal(EDITABLE.stubAllowlist.resolvePath(root), stubAllowlistPathFor(root));
  });

  test('a write lands where the loader would look for it', () => {
    const c = ctx({ body: { name: 'projects', text: '{"projects":[]}', baseHash: hashOf(ORIGINAL) } });
    POST.handle(c);
    assert.equal(c.out.status, 200, JSON.stringify(c.out.payload));
    assert.equal(readFileSync(registryPathFor(root), 'utf8'), '{"projects":[]}',
      'the bytes must be at the resolved path, not merely written somewhere successfully');
  });
});

describe('config editor — reading', () => {
  test('an unauthenticated caller gets nothing, on either port', () => {
    const c = ctx({ authed: false, query: { name: 'projects' } });
    GET.handle(c);
    assert.equal(c.out.status, 401);
    assert.equal(c.out.payload.text, undefined, 'a 401 must not carry the file');
  });

  test('a key outside the allowlist is refused', () => {
    const c = ctx({ query: { name: 'passwords' } });
    GET.handle(c);
    assert.equal(c.out.status, 400);
  });

  test('a path in place of a key cannot escape — there is no path to give', () => {
    for (const name of ['../../etc/passwd', 'monitor/../../.ssh/id_rsa', '/etc/hosts']) {
      const c = ctx({ query: { name } });
      GET.handle(c);
      assert.equal(c.out.status, 400, `${name} was not refused`);
      assert.equal(c.out.payload.text, undefined);
    }
  });

  test('a real key returns the bytes and the version they are', () => {
    const c = ctx({ query: { name: 'projects' } });
    GET.handle(c);
    assert.equal(c.out.status, 200);
    assert.equal(c.out.payload.text, ORIGINAL);
    assert.equal(c.out.payload.hash, hashOf(ORIGINAL));
  });
});

describe('config editor — writing', () => {
  test('an unauthenticated write changes nothing on disk', () => {
    const c = ctx({ authed: false, body: { name: 'projects', text: '{}', baseHash: hashOf(ORIGINAL) } });
    POST.handle(c);
    assert.equal(c.out.status, 401);
    assert.equal(onDisk(), ORIGINAL, 'the file was written despite a 401');
  });

  test('invalid JSON is refused and the file is left exactly as it was', () => {
    const c = ctx({ body: { name: 'projects', text: '{ not json', baseHash: hashOf(ORIGINAL) } });
    POST.handle(c);
    assert.equal(c.out.status, 400);
    assert.match(c.out.payload.error, /nothing was written/);
    assert.equal(onDisk(), ORIGINAL,
      'these files are read by the sweep — saving something that does not parse takes scanning down');
  });

  test('a write with no baseHash is refused: it could not have detected a conflict', () => {
    const c = ctx({ body: { name: 'projects', text: '{}' } });
    POST.handle(c);
    assert.equal(c.out.status, 400);
    assert.equal(onDisk(), ORIGINAL);
  });

  test('a STALE baseHash conflicts rather than clobbers, and hands back the current bytes', () => {
    const c = ctx({ body: { name: 'projects', text: '{"projects":[]}', baseHash: 'deadbeefdeadbeef' } });
    POST.handle(c);
    assert.equal(c.out.status, 409);
    assert.equal(onDisk(), ORIGINAL, 'a concurrent change was overwritten');
    assert.equal(c.out.payload.currentText, ORIGINAL, 'a conflict must return what is actually there');
  });

  test('a matching baseHash writes, and the bytes on disk are exactly what was sent', () => {
    const next = JSON.stringify({ projects: [{ name: 'b', area: 'y' }] }, null, 2);
    const c = ctx({ body: { name: 'projects', text: next, baseHash: hashOf(ORIGINAL) } });
    POST.handle(c);
    assert.equal(c.out.status, 200);
    assert.equal(onDisk(), next);
    assert.equal(c.out.payload.hash, hashOf(next));
  });

  test('the operator\'s own formatting survives — the file is not re-serialised', () => {
    const spaced = '{\n    "projects":   [],\n    "note": "kept"\n}\n';
    const c = ctx({ body: { name: 'projects', text: spaced, baseHash: hashOf(ORIGINAL) } });
    POST.handle(c);
    assert.equal(c.out.status, 200);
    assert.equal(onDisk(), spaced, 'reformatting an operator\'s file loses comments-as-fields and diffs badly');
  });

  test('writing an unlisted key touches nothing', () => {
    const c = ctx({ body: { name: 'authStore', text: '{}', baseHash: hashOf(ORIGINAL) } });
    POST.handle(c);
    assert.equal(c.out.status, 400);
    assert.equal(onDisk(), ORIGINAL);
  });

  test('the allowlist is a closed set and has not silently grown', () => {
    assert.deepEqual(Object.keys(EDITABLE).sort(),
      ['annotations', 'gateExemptions', 'projects', 'stubAllowlist'],
      'a new editable file is a security decision and must be made deliberately, not by addition');
    for (const v of Object.values(EDITABLE)) {
      assert.ok(!v.file.includes('..'), 'no allowlist entry may contain a traversal');
      assert.ok(v.file.startsWith('monitor/'), 'the editable set is scoped to the monitor config');
    }
  });
});

// authz-bola — a cross-tenant read is only a leak if the ATTACKER GOT THE OWNER'S BODY.
// A critical that fires on correct behaviour trains the reader to discount the tool, so all three
// origins are real HTTP servers and the probe is the real CLI — the composition is under test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE = join(dirname(fileURLToPath(import.meta.url)), '..', 'authz-bola.mjs');

const TA = 'aaaaaaaa-0000-0000-0000-000000000001';
const TB = 'bbbbbbbb-0000-0000-0000-000000000002';
const TOK = { 'tok-A': TA, 'tok-B': TB };
const ROWS = { [TA]: [{ id: 1, owner: 'A', secret: 'alpha' }], [TB]: [{ id: 2, owner: 'B', secret: 'bravo' }] };
const SHARED = [{ id: 0, owner: 'shared' }];

/**
 * @param mode 'good' — tenant from the TOKEN, forged X-Tenant-Id ignored (correct)
 *             'leak' — the gateway TRUSTS X-Tenant-Id and serves whatever it names (real BOLA)
 *             'same' — both tenants see identical content (undecidable by comparison)
 */
async function withGateway(mode, fn) {
  const srv = createServer((req, res) => {
    // everything but the probed path 404s — otherwise OpenAPI discovery "succeeds" on nonsense
    if ((req.url || '').split('?')[0] !== '/api/orders/1') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not found"}');
    }
    const own = TOK[(req.headers.authorization || '').replace(/^Bearer\s+/i, '')];
    if (!own) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"unauthenticated"}'); }
    const asked = req.headers['x-tenant-id'];
    const body = mode === 'same' ? SHARED : mode === 'leak' ? (ROWS[asked] || ROWS[own]) : ROWS[own];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(srv.address().port); }
  finally { try { srv.closeAllConnections?.(); } catch { /* older node */ } srv.close(); srv.unref?.(); }
}

// ASYNC deliberately: execFileSync blocks the event loop running the gateway, deadlocking both
// sides until the timeout fires.
const probe = (port) => new Promise((resolve, reject) => {
  execFile(process.execPath, [PROBE, `http://127.0.0.1:${port}`], {
    encoding: 'utf8',
    env: { ...process.env, CW_BOLA_PATHS: '/api/orders/1', CW_BEARER_A: 'tok-A', CW_BEARER_B: 'tok-B' },
    timeout: 30_000,
  }, (err, stdout) => {
    // The probe exits 0 on a void and nonzero on nothing we provoke here, so an error IS a failure.
    if (err && !stdout) return reject(err);
    try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`probe output was not JSON: ${e.message}\n${stdout.slice(0, 300)}`)); }
  });
});

const crit = (d) => (d.findings || []).filter((f) => f.severity === 'critical');
const types = (d) => (d.findings || []).map((f) => f.type);

describe('authz-bola — whose body came back', () => {
  test('THE REGRESSION: a CORRECT gateway produces no critical at all', async () => {
    // correct gateway: 401 unauthenticated, tenant from the token, forged header ignored
    await withGateway('good', async (port) => {
      const d = await probe(port);
      assert.deepEqual(crit(d), [], `a correct gateway must yield no critical: ${JSON.stringify(types(d))}`);
      assert.equal(d.summary.bySeverity.critical, 0);
      assert.ok(!types(d).includes('cross-tenant-read'), 'no cross-tenant-read against a correct origin');
    });
  });

  test('a genuinely LEAKY gateway still fires — the fix must not be a mute button', async () => {
    // a discriminator that silences everything is not an improvement
    await withGateway('leak', async (port) => {
      const d = await probe(port);
      assert.equal(crit(d).length, 2, 'both directions of a real cross-tenant read must be reported');
      for (const f of crit(d)) {
        assert.equal(f.type, 'cross-tenant-read');
        assert.match(f.detail, /byte-for-byte/, 'the detail must say WHY it is a leak, not just that it is');
      }
      assert.deepEqual(crit(d).map((f) => f.direction).sort(), ['A->B', 'B->A']);
    });
  });

  test('IDENTICAL baselines are a VOID, not a pass and not a critical', async () => {
    // identical bytes for A and B — no comparison can separate a leak from correct behaviour
    await withGateway('same', async (port) => {
      const d = await probe(port);
      assert.deepEqual(crit(d), [], 'an undecidable path must not be scored critical');
      const void_ = (d.findings || []).find((f) => f.type === 'cross-tenant-indeterminate');
      assert.ok(void_, 'the undecidable case must be REPORTED, not silently dropped');
      assert.equal(void_.severity, 'medium');
      assert.match(void_.detail, /coverage void, not a pass/i);
    });
  });

  test('the void names what to do about it — a void with no remedy is just a shrug', async () => {
    await withGateway('same', async (port) => {
      const v = ((await probe(port)).findings || []).find((f) => f.type === 'cross-tenant-indeterminate');
      assert.match(v.detail, /CW_BOLA_PATHS/, 'it must name the knob that resolves the ambiguity');
    });
  });
});

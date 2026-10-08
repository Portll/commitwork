// monitor/test/deploy-state-units.test.mjs — case tests for explainDrift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explainDrift } from '../deploy-state.mjs';

const SVC = 'http://10.0.0.1:8080';
const CASES = [
  [{ state: 'ROUTED-NOT-DECLARED', service: SVC }, [SVC]],
  [{ state: 'ROUTED-BUT-DECLARED-PRIVATE', area: 'myapp', service: SVC }, ['myapp', SVC]],
  [{ state: 'PAGES-BUT-ROUTED', area: 'docs', service: SVC }, ['docs', SVC]],
  [{ state: 'DECLARED-NOT-ROUTED', area: 'api' }, ['api']],
  [{ state: 'ROUTED-NO-DNS', service: SVC }, [SVC]],
  [{ state: 'ORIGIN-DOWN', service: SVC }, [SVC]],
  [{ state: 'PRIVATE-BUT-RESOLVES' }, []],
];

test('every drift state has its own explanation, naming the area and service it concerns', () => {
  const seen = new Set();
  for (const [r, mentions] of CASES) {
    const text = explainDrift(r);
    assert.ok(text.length > 0, r.state);
    for (const m of mentions) assert.ok(text.includes(m), `${r.state} names ${m}`);
    seen.add(text);
  }
  assert.equal(seen.size, CASES.length, 'no two states share a message');
});

test('a failed auth attestation outranks the routing state and names the status the origin gave', () => {
  const text = explainDrift({ state: 'ok', authAt: 'origin', authAttested: false, authProbe: 200 });
  assert.match(text, /authAt:'origin'/);
  assert.match(text, /HTTP 200/);
  assert.notEqual(text, explainDrift({ state: 'ORIGIN-DOWN', service: SVC, authAt: 'origin', authAttested: true }));
});

test('an attested or undeclared auth adds nothing to a clean state', () => {
  assert.equal(explainDrift({ state: 'ok' }), '');
  assert.equal(explainDrift({ state: 'ok', authAt: 'origin', authAttested: true }), '');
});

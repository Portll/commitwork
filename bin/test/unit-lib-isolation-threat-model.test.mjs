// Per-command isolation threat model and overall verdict for a check (bin/lib/isolation.mjs threatModel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threatModel } from '../lib/isolation.mjs';

const result = (over) => ({ schemaVersion: 1, check: null, scanner: null, adapter: null, executesRepoCode: null,
  executesRepoCodeBasis: 'undeclared', probes: [], state: 'unmeasured', reason: 'malformed-input', findingSource: null, commands: [], ...over });
const loopback = (declared, measured, status) => ({ threat: 'local-service-reach', control: 'loopback', declared, measured, status });
const p = (probe, outcome) => ({ probe, outcome });
const REACHES = { kind: 'repo-code-reaches-loopback', source: 'measured', field: 'measured.loopbackDenied' };
const READABLE = { kind: 'repo-code-with-readable-credentials', source: 'declared', field: 'declared.credentialsMounted' };
const roots = { repoPath: '/w/repo', reportDir: '/w/report', tmpDir: '/w/tmp' };

test('input without a record check carrying a non-empty string id is malformed', () => {
  const inputs = [null, [], 'check', { check: 'c1' }, { check: Object.assign([], { id: 'c1' }) }, { check: { id: 7 } }, { check: { id: '' } }];
  for (const input of inputs) assert.deepEqual(threatModel(input), result({}));
});

test('an adapter outside host-sandbox and container is malformed but keeps the check id', () => {
  assert.deepEqual(threatModel({ check: { id: 'c1', local: ['run-checks'], requires: { tools: 'x' } }, adapter: 'vm' }), result({ check: 'c1' }));
});

test('a check with no local commands is unmeasured and records how repo code execution was decided', () => {
  assert.deepEqual(threatModel({ check: { id: 'b' } }), result({ check: 'b', reason: 'no-commands' }));
  assert.deepEqual(threatModel({ check: { id: 'b', executesRepoCode: false, local: 'run-checks' }, buildsTree: 'yes' }),
    result({ check: 'b', reason: 'no-commands', executesRepoCode: false, executesRepoCodeBasis: 'declared' }));
  assert.deepEqual(threatModel({ check: { id: 'b', executesRepoCode: false, local: [] }, buildsTree: true, adapter: 'container' }),
    result({ check: 'b', reason: 'no-commands', adapter: 'container', executesRepoCode: true, executesRepoCodeBasis: 'contradicted-by-command' }));
  assert.deepEqual(threatModel({ check: { id: 'b', executesRepoCode: true }, buildsTree: true, adapter: 'host-sandbox' }),
    result({ check: 'b', reason: 'no-commands', adapter: 'host-sandbox', executesRepoCode: true, executesRepoCodeBasis: 'declared' }));
  assert.deepEqual(threatModel({ check: { id: 'b', executesRepoCode: 'yes' }, buildsTree: true }),
    result({ check: 'b', reason: 'no-commands', executesRepoCode: true, executesRepoCodeBasis: 'command-builds-tree' }));
});

test('without an adapter each command is judged on its declaration and loopback stays unmeasured', () => {
  const r = threatModel({ check: { id: 'plain', local: ['run-checks'], executesRepoCode: true, requires: { tools: ['not-a-scanner'] } } });
  assert.equal(r.reason, 'no-enforcement-adapter');
  assert.equal(r.scanner, null);
  assert.deepEqual(r.probes, []);
  assert.deepEqual(r.commands.map((c) => [c.posture, c.phase]), [[null, 'execute']]);
  assert.equal(r.commands[0].measured.loopbackDenied, null);
  assert.deepEqual(r.commands[0].threats[4], loopback('unknown', 'unknown', 'unmeasured'));
  const u = threatModel({ check: { id: 'u', local: ['run-checks'] } }).commands[0];
  assert.deepEqual([u.phase, u.threats[3].declared, u.threats[3].status], [null, 'unknown', 'unmeasured']);
});

test('a container command is judged once per distinct posture it names and unknown postures get none', () => {
  const r = threatModel({
    check: { id: 'ctr', local: ['scan --posture nonesuch --posture bogus-posture --posture nonesuch', 'plain-run'], executesRepoCode: false },
    adapter: 'container',
    effects: { byPosture: { nonesuch: { probes: [] } } },
  });
  assert.deepEqual([r.adapter, r.executesRepoCode, r.executesRepoCodeBasis], ['container', false, 'declared']);
  assert.deepEqual(r.probes, []);
  assert.deepEqual(r.commands.map((c) => [c.posture, c.phase, c.threats[3].declared, c.threats[3].status]), [
    [null, 'read', 'read', 'not-applicable'],
    [null, 'read', 'read', 'not-applicable'],
    [null, 'read', 'read', 'not-applicable'],
  ]);
  assert.deepEqual(r.commands.map((c) => c.threats[4]), Array.from({ length: 3 }, () => loopback('unknown', 'unknown', 'unmeasured')));
});

test('repo code whose declared reads cover home exposes the declarable credential stores', () => {
  const r = threatModel({
    check: { id: 'cred', local: ['run-checks'], executesRepoCode: true },
    adapter: 'host-sandbox',
    spec: { home: '/home/dev/', repoPath: '/home/dev/repo', reportDir: '/home/dev/report', tmpDir: '/tmp/cw', cwRoot: '/home/dev', platform: 'linux', egress: 'none' },
  });
  const c = r.commands[0];
  assert.deepEqual([r.state, r.reason, r.findingSource], ['finding', 'violations-found', 'declared']);
  assert.deepEqual(r.probes, []);
  assert.deepEqual([c.posture, c.phase, c.state, c.reason], [null, 'execute', 'finding', 'violations-found']);
  assert.deepEqual(c.violations.at(-1), READABLE);
  assert.deepEqual([c.threats[0].declared, c.threats[0].status], ['declarable-stores-readable', 'exposed']);
  assert.deepEqual(c.threats[4], loopback('none', 'unknown', 'unmeasured'));
});

test('repo code that reaches loopback in the sandbox is a measured finding, other code is accepted', () => {
  const probes = [p('permitted-read', 'allowed'), { probe: 'loopback', outcome: 'allowed', reason: 'connected' },
    p('mystery', 'allowed'), { probe: 'egress', outcome: 'maybe', reason: 7 }, 'junk'];
  const run = (executesRepoCode) => threatModel({ check: { id: 'lb', local: ['run-checks'], executesRepoCode }, adapter: 'host-sandbox',
    spec: { ...roots, platform: 'darwin', egress: 'none' }, effects: { probes } });
  const r = run(true);
  const c = r.commands[0];
  assert.deepEqual([r.state, r.reason, r.findingSource], ['finding', 'violations-found', 'measured']);
  assert.deepEqual(r.probes, [
    { probe: 'permitted-read', outcome: 'allowed', reason: null },
    { probe: 'loopback', outcome: 'allowed', reason: 'connected' },
    { probe: 'egress', outcome: 'error', reason: null },
  ]);
  assert.deepEqual([c.phase, c.state, c.measured.loopbackDenied], ['execute', 'finding', false]);
  assert.deepEqual(c.violations.at(-1), REACHES);
  assert.deepEqual(c.threats[4], loopback('none', 'not-denied', 'exposed'));
  const q = run(false).commands[0];
  assert.equal(q.phase, 'read');
  assert.deepEqual(q.threats[4], loopback('none', 'not-denied', 'accepted'));
});

test('declared loopback reach follows platform and target ports, measured reach needs a working control', () => {
  const run = (spec, probes) => threatModel({ check: { id: 'net', local: ['run-checks'], executesRepoCode: false }, adapter: 'host-sandbox',
    spec: { ...roots, ...spec }, effects: { probes } }).commands[0].threats[4];
  assert.deepEqual(run({ platform: 'linux' }, [p('permitted-read', 'allowed'), p('loopback', 'denied'), p('loopback-control', 'allowed')]),
    loopback('not-filtered', 'denied', 'mitigated'));
  assert.deepEqual(run({ platform: 'darwin', loopbackPorts: [] }, [p('permitted-read', 'allowed'), p('loopback', 'denied'), p('loopback-control', 'denied')]),
    loopback('denied', 'unknown', 'unmeasured'));
  assert.deepEqual(run({ platform: 'darwin', loopbackPorts: [8080] }, [p('permitted-read', 'allowed'), p('loopback', 'allowed'), p('loopback', 'denied')]),
    loopback('target-ports-only', 'unknown', 'unmeasured'));
  assert.deepEqual(run({ platform: 'darwin', loopbackPorts: 'x' }, [p('permitted-read', 'denied'), p('loopback', 'allowed')]),
    loopback('denied', 'unknown', 'unmeasured'));
});

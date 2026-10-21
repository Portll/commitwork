// Tests for the workflow reader and converter: schema validation, expression sites, the model,
// step ids, needs, cron and matrix expansion
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflow, readWorkflowTokens, serializeToken, tokenToPlain, expandMatrix, isValidCron, actionStepId, ensureStatusFunction } from '../actions-workflow.mjs';

const messages = (r) => r.errors.map((e) => e.message);

const CI = `name: ci
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 3 * * 1'
env:
  A: 1
jobs:
  build:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest]
        node: [18, 20]
        include:
          - node: 22
            extra: yes
    steps:
      - uses: actions/checkout@v4
      - name: "n-\${{ github.sha }}"
        run: |
          echo \${{ github.sha }}
          echo done
        env:
          N: \${{ matrix.node }}
      - run: echo
        id: given
      - uses: ./local/action
      - uses: docker://alpine:3
      - run: echo
        if: failure()
      - run: echo
        if: github.ref == 'x' && !cancelled()
      - run: echo
        if: \${{ github.event_name == 'push' }}
  release:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
  call:
    uses: ./.github/workflows/x.yml
    with: { a: 1 }
    secrets: inherit
`;

test('a workflow reads with no errors and models events, jobs and steps', () => {
  const r = parseWorkflow(CI);
  assert.deepEqual(messages(r), []);
  assert.deepEqual(r.model.events, { push: { branches: ['main'] }, pull_request: {}, schedule: [{ cron: '0 3 * * 1' }] });
  assert.deepEqual(r.model.env, { type: 2, map: [{ Key: 'A', Value: '1' }] });
  const [build, release, call] = r.model.jobs;
  assert.equal(build.type, 'job');
  assert.equal(build.name, 'build');
  assert.equal(build.if, 'success()');
  assert.deepEqual(build.runsOn, { type: 3, expr: 'matrix.os' });
  assert.equal(release.if, "success() && (github.ref == 'refs/heads/main')");
  assert.deepEqual(release.needs, ['build']);
  assert.equal(call.type, 'reusableWorkflowJob');
  assert.equal(call.ref, './.github/workflows/x.yml');
  assert.equal(call.inheritSecrets, true);
  assert.deepEqual(call.inputValues, { type: 2, map: [{ Key: 'a', Value: 1 }] });
  assert.deepEqual(call.needs, []);
});

test('step ids follow GitHub: given ids, action names, self, docker and numbered runs', () => {
  const steps = parseWorkflow(CI).model.jobs[0].steps;
  assert.deepEqual(steps.map((s) => s.id), ['__actions_checkout', '__run', 'given', '__self', '__alpine_3', '__run_2', '__run_3', '__run_4']);
  assert.deepEqual(steps.map((s) => s.if), ['success()', 'success()', 'success()', 'success()', 'success()', 'failure()', "github.ref == 'x' && !cancelled()", "success() && (github.event_name == 'push')"]);
  assert.deepEqual(steps[1].name, { type: 3, expr: "format('n-{0}', github.sha)" });
  assert.deepEqual(steps[1].run, { type: 3, expr: "format('echo {0}\necho done\n', github.sha)" });
  assert.deepEqual(steps[1].env, { type: 2, map: [{ Key: 'N', Value: { type: 3, expr: 'matrix.node' } }] });
  assert.equal(steps[0].uses, 'actions/checkout@v4');
});

test('expression sites are collected with their lines', () => {
  const r = parseWorkflow(CI);
  assert.deepEqual(r.expressions.map((e) => [e.line, e.expression]).slice(0, 3), [[12, 'matrix.os'], [22, "format('n-{0}', github.sha)"], [23, "format('echo {0}\necho done\n', github.sha)"]]);
});

test('serialized tokens follow the Key/Value shape, and tokenToPlain marks expressions', () => {
  const r = readWorkflowTokens('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: ${{ github.sha }}\n');
  const plain = tokenToPlain(r.tokens);
  assert.deepEqual(plain.jobs.a.steps[0], { run: { $expr: 'github.sha' } });
  assert.deepEqual(serializeToken(r.tokens).map[0], { Key: 'on', Value: 'push' });
});

test('schema validation reports what GitHub reports', () => {
  const r = (text) => messages(parseWorkflow(text));
  assert.deepEqual(r('on: push\njobs:\n  a:\n    runs-on: x\n    nope: 1\n    steps: [{ run: echo }]\n'), ["Unexpected value 'nope'"]);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    steps: [{ run: echo }]\n'), ['Required property is missing: runs-on']);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    name: x\n'), ["There's not enough info to determine what you meant. Add one of these properties: cancel-timeout-minutes, container, continue-on-error, defaults, env, environment, outputs, runs-on, secrets, services, snapshot, steps, timeout-minutes, uses, with"]);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    runs-on: x\n    Runs-On: y\n    steps: [{ run: echo }]\n'), ["'Runs-On' is already defined"]);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ uses: "${{ x }}" }]\n'), ["Unrecognized named-value: 'x'. Located at position 1 within expression: x"]);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ uses: "a@${{ github.sha }}" }]\n'), ["Unrecognized named-value: 'github'. Located at position 1 within expression: github.sha"]);
  assert.deepEqual(r("on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ uses: \"${{ format('x') }}\" }]\n"), ['A template expression is not allowed in this context']);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    runs-on: x\n    if: ${{ nope }}\n    steps: [{ run: echo }]\n'), ["Unrecognized named-value: 'nope'. Located at position 1 within expression: nope"]);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ run: echo, continue-on-error: maybe }]\n'), ["Unexpected value 'maybe'"]);
  assert.deepEqual(r('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - name: n\n'), ["There's not enough info to determine what you meant. Add one of these properties: run, shell, uses, with, working-directory"]);
  assert.deepEqual(r('on: [push, pull_request]\njobs: {}\n'), ['The workflow must contain at least one job with no dependencies.']);
  assert.deepEqual(r('jobs:\n  a:\n    runs-on: x\n    steps: [{ run: echo }]\n'), ['Required property is missing: on']);
  assert.deepEqual(r(''), ['Expected a scalar value, a sequence, or a mapping']);
});

test('numbers and booleans are accepted where strings are expected', () => {
  const r = parseWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - uses: actions/setup-node@v4\n        with: { node-version: 20, cache: true }\n');
  assert.deepEqual(messages(r), []);
  assert.deepEqual(r.model.jobs[0].steps[0].with, { type: 2, map: [{ Key: 'node-version', Value: '20' }, { Key: 'cache', Value: 'true' }] });
  assert.deepEqual(messages(parseWorkflow('on: push\njobs:\n  a:\n    runs-on: 7\n    steps: [{ run: echo }]\n')), []);
});

test('needs are checked for unknown jobs and cycles', () => {
  const text = (needs) => `on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ run: echo }]\n  b:\n    needs: ${needs}\n    runs-on: x\n    steps: [{ run: echo }]\n`;
  assert.deepEqual(messages(parseWorkflow(text('zzz'))), ["Job 'b' depends on unknown job 'zzz'."]);
  assert.deepEqual(messages(parseWorkflow(text('[a]'))), []);
  const cycle = 'on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ run: echo }]\n  b:\n    needs: c\n    runs-on: x\n    steps: [{ run: echo }]\n  c:\n    needs: b\n    runs-on: x\n    steps: [{ run: echo }]\n';
  assert.deepEqual(messages(parseWorkflow(cycle)), ["Job 'b' depends on job 'c' which creates a cycle in the dependency graph.", "Job 'c' depends on job 'b' which creates a cycle in the dependency graph."]);
});

test('a parallel group models its inner steps with GitHub ids', () => {
  const r = parseWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: one\n      - parallel:\n          - run: two\n          - name: Three\n            run: three\n');
  assert.deepEqual(messages(r), []);
  const [first, group] = r.model.jobs[0].steps;
  assert.equal(first.id, '__run');
  assert.equal(group.id, '__parallel');
  assert.equal(group.name, 'Parallel group');
  assert.deepEqual(group.parallel.map((s) => [s.id, s.run]), [['__run', 'two'], ['__run_2', 'three']]);
  assert.deepEqual(messages(parseWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - parallel:\n          - parallel:\n              - run: x\n')), ["Nested 'parallel' blocks are not allowed."]);
});

test('identifiers are validated for jobs and steps', () => {
  assert.deepEqual(messages(parseWorkflow('on: push\njobs:\n  1a:\n    runs-on: x\n    steps: [{ run: echo }]\n')), ["The identifier '1a' is invalid. IDs may only contain alphanumeric characters, '_', and '-'. IDs must start with a letter or '_' and and must be less than 100 characters."]);
  assert.deepEqual(messages(parseWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ run: echo, id: __x }]\n')), ["The identifier '__x' is invalid. IDs starting with '__' are reserved."]);
  assert.deepEqual(messages(parseWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ run: echo, id: s }, { run: echo, id: s }]\n')), ["The identifier 's' may not be used more than once within the same scope."]);
});

test('events: dispatch inputs, call inputs, filters and cron', () => {
  const r = parseWorkflow(`on:
  workflow_dispatch:
    inputs:
      level:
        type: choice
        options: [a, b]
        default: a
      flag:
        type: boolean
        default: true
  workflow_call:
    inputs:
      who:
        type: string
        required: true
  push:
    tags-ignore: v*
    paths: [src/**]
  schedule:
    - cron: '*/5 * * * *'
    - cron: 'bad'
jobs:
  a:
    runs-on: x
    steps: [{ run: echo }]
`);
  assert.deepEqual(messages(r), ["Invalid cron expression. Expected format: '* * * * *' (minute hour day month weekday)"]);
  assert.deepEqual(r.model.events.workflow_dispatch, { inputs: { level: { type: 'choice', options: ['a', 'b'], default: 'a' }, flag: { type: 'boolean', default: true } } });
  assert.deepEqual(r.model.events.workflow_call, { inputs: { who: { type: 'string', required: true } } });
  assert.deepEqual(r.model.events.push, { 'tags-ignore': ['v*'], paths: ['src/**'] });
  assert.deepEqual(r.model.events.schedule, [{ cron: '*/5 * * * *' }, { cron: 'bad' }]);
  assert.deepEqual(messages(parseWorkflow('on:\n  workflow_dispatch:\n    inputs:\n      x:\n        type: choice\njobs:\n  a:\n    runs-on: x\n    steps: [{ run: echo }]\n')), ["Missing 'options' for choice input"]);
});

test('isValidCron follows the five-field rules', () => {
  assert.equal(isValidCron('0 3 * * 1'), true);
  assert.equal(isValidCron('*/15 0-23 1,15 jan-dec mon'), true);
  assert.equal(isValidCron('60 * * * *'), false);
  assert.equal(isValidCron('* * * *'), false);
  assert.equal(isValidCron('*/0 * * * *'), false);
  assert.equal(isValidCron('1-2-3 * * * *'), false);
  assert.equal(isValidCron('* * * * SUN'), true);
});

test('actionStepId and ensureStatusFunction', () => {
  assert.equal(actionStepId('actions/checkout@v4'), 'actions/checkout');
  assert.equal(actionStepId('octo/repo/path@main'), 'octo/repo');
  assert.equal(actionStepId('docker://alpine:3'), 'alpine:3');
  assert.equal(actionStepId('./x'), 'self');
  assert.equal(actionStepId('bad'), '');
  const allowed = ['github', 'always(0,0)', 'failure(0,MAX)', 'cancelled(0,0)', 'success(0,MAX)'];
  assert.equal(ensureStatusFunction("github.ref == 'x'", allowed), "success() && (github.ref == 'x')");
  assert.equal(ensureStatusFunction('always()', allowed), 'always()');
  assert.equal(ensureStatusFunction('nope', allowed), 'nope');
});

test('expandMatrix follows the documented include and exclude rules', () => {
  const docs = expandMatrix({ fruit: ['apple', 'pear'], animal: ['cat', 'dog'], include: [{ color: 'green' }, { color: 'pink', animal: 'cat' }, { fruit: 'apple', shape: 'circle' }, { fruit: 'banana' }, { fruit: 'banana', animal: 'cat' }] });
  assert.deepEqual(docs, [
    { fruit: 'apple', animal: 'cat', color: 'pink', shape: 'circle' },
    { fruit: 'apple', animal: 'dog', color: 'green', shape: 'circle' },
    { fruit: 'pear', animal: 'cat', color: 'pink' },
    { fruit: 'pear', animal: 'dog', color: 'green' },
    { fruit: 'banana' },
    { fruit: 'banana', animal: 'cat' },
  ]);
  assert.deepEqual(expandMatrix({ os: ['macos', 'windows'], version: [12, 14], exclude: [{ os: 'macos', version: 12 }] }), [{ os: 'macos', version: 14 }, { os: 'windows', version: 12 }, { os: 'windows', version: 14 }]);
  assert.deepEqual(expandMatrix({ include: [{ a: 1 }, { a: 2, b: 3 }] }), [{ a: 1 }, { a: 2, b: 3 }]);
  assert.deepEqual(expandMatrix({ node: [{ v: 1 }, { v: 2 }], exclude: [{ node: { v: 1 } }] }), [{ node: { v: 2 } }]);
  assert.deepEqual(expandMatrix({}), []);
  assert.deepEqual(expandMatrix(null), []);
});

// compares a workflow against an oracle, reporting agreement or differences (lib/actions-oracle-compare.mjs compareWorkflow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWorkflow } from '../actions-oracle-compare.mjs';

function makeFakeOracle({ readValue = undefined, readErrors = [] } = {}) {
  const context = {
    errors: {
      getErrors: () => readErrors.map((msg) => ({ message: msg })),
    },
    error: () => {},
  };
  return {
    workflowParser: {
      parseWorkflow: () => ({
        value: readValue,
        context,
      }),
      convertWorkflowTemplate: async () => ({}),
      NoOperationTraceWriter: class {},
    },
  };
}

test('both parsers refuse the workflow', async () => {
  const text = 'invalid: yaml';
  const oracle = makeFakeOracle({ readValue: undefined, readErrors: ['oracle error'] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "both-refused", detail: "line 1: Unexpected value 'invalid' | oracle error" });
});

test('only mine refuses the workflow', async () => {
  const text = 'invalid: yaml';
  const oracle = makeFakeOracle({ readValue: {}, readErrors: [] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "mine-refused", detail: "line 1: Unexpected value 'invalid'" });
});

test('only oracle refuses the workflow', async () => {
  const text = 'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []';
  const oracle = makeFakeOracle({ readValue: undefined, readErrors: ['oracle error'] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "oracle-refused", detail: "oracle error" });
});

test('tokens differ between mine and oracle', async () => {
  const text = 'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []';
  const oracle = makeFakeOracle({ readValue: {}, readErrors: [] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "disagree", detail: "tokens $.type: 2 vs undefined" });
});

test('read.value true and no errors (original true branch)', async () => {
  const text = 'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []';
  const oracle = makeFakeOracle({ readValue: {}, readErrors: [] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "disagree", detail: "tokens $.type: 2 vs undefined" });
});

test('read.value false and no errors (edited true branch)', async () => {
  const text = 'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []';
  const oracle = makeFakeOracle({ readValue: undefined, readErrors: [] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "disagree", detail: "tokens $: {\"type\":2,\"map\":[{\"Key\":\"name\",\"Value\":\"test\"},{\"Key\":\"on\",\"Value\":\"push\"},{\"... vs undefined" });
});

test('read.value true with one error (edited true branch)', async () => {
  const text = 'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []';
  const oracle = makeFakeOracle({ readValue: {}, readErrors: ['one error'] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "oracle-refused", detail: "one error" });
});

test('both parsers refuse, original && branch', async () => {
  const text = 'invalid: yaml';
  const oracle = makeFakeOracle({ readValue: undefined, readErrors: ['oracle error'] });
  const result = await compareWorkflow(text, 'wf.yml', oracle);
  assert.deepEqual(result, { status: "both-refused", detail: "line 1: Unexpected value 'invalid' | oracle error" });
});

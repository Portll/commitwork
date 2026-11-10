// Aggregates rule-level engine failures from SARIF invocations (monitor/sarif-read.mjs ruleFailures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleFailures } from '../sarif-read.mjs';

test('returns an empty array when there are no invocations', () => {
  assert.deepEqual(ruleFailures([]), []);
});

test('returns an empty array when a notification has no descriptor or message', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{}] }]), []);
});

test('returns an empty array when the rule cannot be extracted from the text', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{ descriptor: { id: 'Internal matching error' }, message: { text: 'no rule here' } }] }]), []);
});

test('counts one notice for a rule named in a running clause', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{ descriptor: { id: 'Internal matching error' }, message: { text: 'Internal matching error when running cw-x on file.js' } }] }]), [{ rule: "cw-x", notices: 1, reason: "Internal matching error when running cw-x on file.js" }]);
});

test('counts one notice for a rule named in a rule clause', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{ descriptor: { id: 'Internal matching error' }, message: { text: "Internal matching error in rule 'cw-y'" } }] }]), [{ rule: "cw-y", notices: 1, reason: "Internal matching error in rule 'cw-y'" }]);
});

test('counts one notice for a file partial id with a snippet', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{ descriptor: { id: 'Timeout' }, message: { text: 'Timeout when parsing a snippet as Bash' } }] }]), []);
});

test('skips a file partial id without a snippet', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{ descriptor: { id: 'Timeout' }, message: { text: 'Timeout reading file' } }] }]), []);
});

test('skips a non-partial id without a snippet', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{ descriptor: { id: 'Other syntax error' }, message: { text: 'Other syntax error in file' } }] }]), []);
});

test('accumulates notices for the same rule across invocations', () => {
  assert.deepEqual(ruleFailures([
    { toolExecutionNotifications: [{ descriptor: { id: 'Internal matching error' }, message: { text: 'Internal matching error when running cw-z on a.js' } }] },
    { toolExecutionNotifications: [{ descriptor: { id: 'Internal matching error' }, message: { text: 'Internal matching error when running cw-z on b.js' } }] }
  ]), [{ rule: "cw-z", notices: 2, reason: "Internal matching error when running cw-z on a.js" }]);
});

test('uses the last non-empty line of the message as the reason', () => {
  assert.deepEqual(ruleFailures([{ toolExecutionNotifications: [{ descriptor: { id: 'Internal matching error' }, message: { text: 'first line\n  second line  ' } }] }]), []);
});

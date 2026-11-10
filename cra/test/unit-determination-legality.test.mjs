// Validates that a determination object uses only declared axis values and that cross-axis combinations are coherent (cra/determination.mjs legality).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legality } from '../determination.mjs';

test('returns an empty array for a fully coherent determination', () => {
  const d = {
    presence: 'component_present_code_present',
    reachability: 'reachable',
    exploitability: 'exploitable',
    remediation: 'fix_available_not_applied',
  };
  assert.deepEqual(legality(d), []);
});

test('flags an undeclared value on the presence axis', () => {
  const d = { presence: 'component_maybe' };
  assert.deepEqual(legality(d), ["presence: 'component_maybe' is not a declared value"]);
});

test('flags an undeclared value on the reachability axis', () => {
  const d = { reachability: 'unreachable_maybe' };
  assert.deepEqual(legality(d), ["reachability: 'unreachable_maybe' is not a declared value"]);
});

test('flags an undeclared value on the exploitability axis', () => {
  const d = { exploitability: 'exploitable_maybe' };
  assert.deepEqual(legality(d), ["exploitability: 'exploitable_maybe' is not a declared value"]);
});

test('flags an undeclared value on the remediation axis', () => {
  const d = { remediation: 'fixed_maybe' };
  assert.deepEqual(legality(d), ["remediation: 'fixed_maybe' is not a declared value"]);
});

test('flags a specific reachability claim when the component is absent', () => {
  const d = { presence: 'component_absent', reachability: 'reachable' };
  assert.deepEqual(legality(d), ["presence=component_absent with a reachability claim: an absent component has no call graph \u2014 use reachability_unknown"]);
});

test('flags a specific exploitability claim when the component is absent', () => {
  const d = { presence: 'component_absent', exploitability: 'exploitable' };
  assert.deepEqual(legality(d), ["presence=component_absent with an exploitability claim: nothing is deployed to exploit"]);
});

test('allows the unknown reachability value when the component is absent', () => {
  const d = { presence: 'component_absent', reachability: 'reachability_unknown' };
  assert.deepEqual(legality(d), []);
});

test('flags reachable code when the vulnerable code is absent from the shipped component', () => {
  const d = { presence: 'component_present_code_absent', reachability: 'reachable' };
  assert.deepEqual(legality(d), ["code_absent with reachability=reachable: the vulnerable code is not shipped, so nothing reaches it"]);
});

test('flags exploitable code when it is statically unreachable', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'exploitable' };
  assert.deepEqual(legality(d), ["unreachable_static with exploitability=exploitable: unreachable code cannot be driven"]);
});

test('flags a verified fix while the component is still present, reachable, and exploitable', () => {
  const d = {
    presence: 'component_present_code_present',
    reachability: 'reachable',
    exploitability: 'exploitable',
    remediation: 'fixed_verified',
  };
  assert.deepEqual(legality(d), ["fixed_verified while still present, reachable and exploitable \u2014 one of these is stale"]);
});

test('allows a verified fix when the component is absent', () => {
  const d = {
    presence: 'component_absent',
    reachability: 'reachability_unknown',
    exploitability: 'exploitability_unknown',
    remediation: 'fixed_verified',
  };
  assert.deepEqual(legality(d), []);
});

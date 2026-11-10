// classification of a scan record into confirmation and signals (monitor/nuclei-solve.mjs classify)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../nuclei-solve.mjs';

test('returns undetermined when rule is missing or invalid', () => {
  const rec = {};
  const result = classify(rec, null);
  assert.deepStrictEqual(result, { confirmation: "undetermined", signals: [], rule: null, why: "no rule could be derived" });
});

test('adds TAUTOLOGICAL when matcher has no content predicate and no discriminating extractor', () => {
  const rec = {};
  const rule = {
    ok: true,
    id: 'r1',
    digest: 'd1',
    hasMatchers: true,
    matcherHasContentPredicate: false,
    extractorDiscriminating: false,
    transports: [],
    declaredPorts: [],
  };
  const result = classify(rec, rule);
  assert.deepStrictEqual(result.confirmation, 'refuted');
  assert.deepStrictEqual(result.signals, ['matcher-tautological']);
  assert.deepStrictEqual(result.rule, { id: 'r1', digest: 'd1' });
});

test('adds SELF_REFERENTIAL when the only extracted result equals the whole response', () => {
  const resp = 'payload';
  const rec = {
    response: resp,
    'extracted-results': [resp],
  };
  const rule = {
    ok: true,
    id: 'r2',
    digest: 'd2',
    hasMatchers: false,
    matcherHasContentPredicate: false,
    extractorDiscriminating: false,
    transports: [],
    declaredPorts: [],
  };
  const result = classify(rec, rule);
  assert.deepStrictEqual(result.confirmation, 'refuted');
  assert.deepStrictEqual(result.signals, ['self-referential']);
  assert.deepStrictEqual(result.rule, { id: 'r2', digest: 'd2' });
});

test('detects CONTRADICTED when a raw transport receives an HTTP status line without declaring HTTP', () => {
  const resp = 'HTTP/1.1 500 Internal Server Error';
  const rec = { response: resp };
  const rule = {
    ok: true,
    id: 'r3',
    digest: 'd3',
    hasMatchers: false,
    matcherHasContentPredicate: false,
    extractorDiscriminating: false,
    transports: ['tcp'],
    declaredPorts: [],
  };
  const result = classify(rec, rule);
  assert.deepStrictEqual(result.confirmation, 'refuted');
  assert.deepStrictEqual(result.signals, ['contradicted']);
  assert.deepStrictEqual(result.contradictor, 'http-status-line');
  assert.deepStrictEqual(result.rule, { id: 'r3', digest: 'd3' });
});

test('adds PORT_DISPLACED when the record port is not among declared ports', () => {
  const rec = { port: 8080 };
  const rule = {
    ok: true,
    id: 'r4',
    digest: 'd4',
    hasMatchers: false,
    matcherHasContentPredicate: false,
    extractorDiscriminating: false,
    transports: [],
    declaredPorts: [80, 443],
  };
  const result = classify(rec, rule);
  assert.deepStrictEqual(result.confirmation, 'undetermined');
  assert.deepStrictEqual(result.signals, ['port-displaced']);
  assert.deepStrictEqual(result.rule, { id: 'r4', digest: 'd4' });
});

test('adds TRANSPORT_UNVERIFIABLE for isUDPPortOpen gate', () => {
  const rec = {};
  const rule = {
    ok: true,
    id: 'r5',
    digest: 'd5',
    hasMatchers: false,
    matcherHasContentPredicate: false,
    extractorDiscriminating: false,
    transports: ['udp'],
    declaredPorts: [],
    gate: 'isUDPPortOpen',
  };
  const result = classify(rec, rule);
  assert.deepStrictEqual(result.confirmation, 'undetermined');
  assert.deepStrictEqual(result.signals, ['transport-unverifiable']);
  assert.deepStrictEqual(result.rule, { id: 'r5', digest: 'd5' });
});

test('confirms when declared HTTP template receives an HTTP status line', () => {
  const resp = 'HTTP/2.0 200 OK';
  const rec = { response: resp, type: 'http' };
  const rule = {
    ok: true,
    id: 'r6',
    digest: 'd6',
    hasMatchers: false,
    matcherHasContentPredicate: false,
    extractorDiscriminating: false,
    transports: [],
    declaredPorts: [],
  };
  const result = classify(rec, rule);
  assert.deepStrictEqual(result.confirmation, 'confirmed');
  assert.deepStrictEqual(result.signals, ['protocol-matched']);
  assert.deepStrictEqual(result.rule, { id: 'r6', digest: 'd6' });
});

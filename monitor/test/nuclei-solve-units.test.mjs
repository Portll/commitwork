// monitor/test/nuclei-solve-units.test.mjs — case tests for solvedRecord.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solvedRecord } from '../nuclei-solve.mjs';

test('solvedRecord maps basic fields and omits optional keys', () => {
  const rec = { 'template-id': 'tpl1', host: 'h1', port: 80, type: 'http', info: { severity: 'high' } };
  const verdict = { confirmation: 'confirmed', signals: ['protocol-matched'], rule: { id: 'tpl1', digest: 'abc' } };
  const r = solvedRecord(rec, verdict);
  assert.equal(r.templateId, 'tpl1');
  assert.equal(r.host, 'h1');
  assert.equal(r.port, '80');
  assert.equal(r.proto, 'http');
  assert.equal(r.severity, 'high');
  assert.equal(r.confirmation, 'confirmed');
  assert.deepEqual(r.signals, ['protocol-matched']);
  assert.equal(r.ruleId, 'tpl1');
  assert.equal(r.ruleDigest, 'abc');
  assert.equal('contradictor' in r, false);
  assert.equal('why' in r, false);
});

test('solvedRecord includes contradictor and why when present in verdict', () => {
  const rec = { 'template-id': 'tpl2', host: 'h2', port: 443, type: 'tcp' };
  const verdict = { confirmation: 'refuted', signals: ['contradicted'], rule: { id: 'tpl2', digest: 'def' }, contradictor: 'http-status-line', why: 'bad' };
  const r = solvedRecord(rec, verdict);
  assert.equal(r.contradictor, 'http-status-line');
  assert.equal(r.why, 'bad');
  assert.equal(r.ruleId, 'tpl2');
  assert.equal(r.ruleDigest, 'def');
});

test('solvedRecord handles missing optional rec fields as empty strings', () => {
  const rec = { 'template-id': 'tpl3' };
  const verdict = { confirmation: 'undetermined', signals: [], rule: null };
  const r = solvedRecord(rec, verdict);
  assert.equal(r.templateId, 'tpl3');
  assert.equal(r.host, '');
  assert.equal(r.port, '');
  assert.equal(r.proto, '');
  assert.equal(r.severity, '');
  assert.equal(r.ruleId, '');
  assert.equal(r.ruleDigest, null);
});

test('solvedRecord sorts signals alphabetically', () => {
  const rec = { 'template-id': 'tpl4', host: 'h4', port: 1, type: 'http' };
  const verdict = { confirmation: 'refuted', signals: ['port-displaced', 'matcher-tautological'], rule: { id: 'tpl4', digest: 'ghi' } };
  const r = solvedRecord(rec, verdict);
  assert.deepEqual(r.signals, ['matcher-tautological', 'port-displaced']);
});

test('solvedRecord uses templateID fallback when template-id is missing', () => {
  const rec = { templateID: 'tpl5', host: 'h5', port: 2, type: 'http' };
  const verdict = { confirmation: 'confirmed', signals: [], rule: { id: 'tpl5', digest: 'jkl' } };
  const r = solvedRecord(rec, verdict);
  assert.equal(r.templateId, 'tpl5');
});

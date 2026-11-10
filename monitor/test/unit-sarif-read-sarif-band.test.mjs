// Maps a SARIF result and rule to a severity band (monitor/sarif-read.mjs sarifBand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sarifBand } from '../sarif-read.mjs';

test('returns crit when rule security-severity is 9', () => {
  const res = { level: 'error' };
  const rule = { properties: { 'security-severity': '9' } };
  assert.equal(sarifBand(res, rule), "crit");
});

test('returns high when rule security-severity is 7', () => {
  const res = { level: 'error' };
  const rule = { properties: { 'security-severity': '7' } };
  assert.equal(sarifBand(res, rule), "high");
});

test('returns med when rule security-severity is 4', () => {
  const res = { level: 'error' };
  const rule = { properties: { 'security-severity': '4' } };
  assert.equal(sarifBand(res, rule), "med");
});

test('returns low when rule security-severity is 3', () => {
  const res = { level: 'error' };
  const rule = { properties: { 'security-severity': '3' } };
  assert.equal(sarifBand(res, rule), "low");
});

test('returns high when result level is error and no severity', () => {
  const res = { level: 'error' };
  const rule = {};
  assert.equal(sarifBand(res, rule), "high");
});

test('returns med when result level is warning and no severity', () => {
  const res = { level: 'warning' };
  const rule = {};
  assert.equal(sarifBand(res, rule), "med");
});

test('returns low when result level is note and no severity', () => {
  const res = { level: 'note' };
  const rule = {};
  assert.equal(sarifBand(res, rule), "low");
});

test('returns med when no level and no severity', () => {
  const res = {};
  const rule = {};
  assert.equal(sarifBand(res, rule), "med");
});

test('returns high when rule defaultConfiguration level is error and no severity', () => {
  const res = {};
  const rule = { defaultConfiguration: { level: 'error' } };
  assert.equal(sarifBand(res, rule), "high");
});

test('returns med when rule defaultConfiguration level is warning and no severity', () => {
  const res = {};
  const rule = { defaultConfiguration: { level: 'warning' } };
  assert.equal(sarifBand(res, rule), "med");
});

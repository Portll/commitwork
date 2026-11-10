// Summarises scanner notifications into known and unexplained counts (monitor/scanner-quirks.mjs summariseNotifications).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseNotifications } from '../scanner-quirks.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('empty notifications list returns zero counts and empty note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [] }));
    const r = summariseNotifications([], { doc: { state: 'present', quirks: [] } });
    assert.deepEqual(r, { enabled: true, registryState: "present", total: 0, known: {}, knownTotal: 0, unexplained: 0, unexplainedRules: [], note: "" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one unexplained notification increments unexplained count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [] }));
    const n = { descriptor: { id: 'unknown-id' }, message: { text: 'running myrule' } };
    const r = summariseNotifications([n], { doc: { state: 'present', quirks: [] } });
    assert.deepEqual(r, { enabled: true, registryState: "present", total: 1, known: {}, knownTotal: 0, unexplained: 1, unexplainedRules: ["myrule"], note: "1 scanner error notifications: 0 match a declared upstream defect, 1 are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one known notification increments known count for that quirk id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [{ id: 'q1', match: { notificationId: 'known-id' } }] }));
    const n = { descriptor: { id: 'known-id' }, message: { text: 'running myrule' } };
    const r = summariseNotifications([n], { doc: { state: 'present', quirks: [{ id: 'q1', match: { notificationId: 'known-id' } }] } });
    assert.deepEqual(r, { enabled: true, registryState: "present", total: 1, known: { q1: 1 }, knownTotal: 1, unexplained: 0, unexplainedRules: [], note: "1 scanner error notifications: 1 match a declared upstream defect, 0 are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two identical known notifications accumulate count to two', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [{ id: 'q1', match: { notificationId: 'known-id' } }] }));
    const n1 = { descriptor: { id: 'known-id' }, message: { text: 'running myrule' } };
    const n2 = { descriptor: { id: 'known-id' }, message: { text: 'running myrule' } };
    const r = summariseNotifications([n1, n2], { doc: { state: 'present', quirks: [{ id: 'q1', match: { notificationId: 'known-id' } }] } });
    assert.deepEqual(r, { enabled: true, registryState: "present", total: 2, known: { q1: 2 }, knownTotal: 2, unexplained: 0, unexplainedRules: [], note: "2 scanner error notifications: 2 match a declared upstream defect, 0 are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unexplained notification with rule extracts rule name into unexplainedRules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [] }));
    const n = { descriptor: { id: 'x' }, message: { text: 'running alpha.beta' } };
    const r = summariseNotifications([n], { doc: { state: 'present', quirks: [] } });
    assert.deepEqual(r, { enabled: true, registryState: "present", total: 1, known: {}, knownTotal: 0, unexplained: 1, unexplainedRules: ["alpha.beta"], note: "1 scanner error notifications: 0 match a declared upstream defect, 1 are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unexplained notification without rule leaves unexplainedRules empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [] }));
    const n = { descriptor: { id: 'x' }, message: { text: 'no rule here' } };
    const r = summariseNotifications([n], { doc: { state: 'present', quirks: [] } });
    assert.deepEqual(r, { enabled: true, registryState: "present", total: 1, known: {}, knownTotal: 0, unexplained: 1, unexplainedRules: [], note: "1 scanner error notifications: 0 match a declared upstream defect, 1 are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mixed known and unexplained notifications produce correct totals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [{ id: 'q1', match: { notificationId: 'known-id' } }] }));
    const known = { descriptor: { id: 'known-id' }, message: { text: 'running myrule' } };
    const unexplained = { descriptor: { id: 'other' }, message: { text: 'running other.rule' } };
    const r = summariseNotifications([known, unexplained], { doc: { state: 'present', quirks: [{ id: 'q1', match: { notificationId: 'known-id' } }] } });
    assert.deepEqual(r, { enabled: true, registryState: "present", total: 2, known: { q1: 1 }, knownTotal: 1, unexplained: 1, unexplainedRules: ["other.rule"], note: "2 scanner error notifications: 1 match a declared upstream defect, 1 are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registryState reflects doc state when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summariseNotifications-'));
  try {
    const path = join(dir, 'quirks.json');
    writeFileSync(path, JSON.stringify({ version: 1, quirks: [] }));
    const n = { descriptor: { id: 'x' }, message: { text: 'running r' } };
    const r = summariseNotifications([n], { doc: { state: 'absent', quirks: [] } });
    assert.deepEqual(r, { enabled: true, registryState: "absent", total: 1, known: {}, knownTotal: 0, unexplained: 1, unexplainedRules: ["r"], note: "1 scanner error notifications: 0 match a declared upstream defect, 1 are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

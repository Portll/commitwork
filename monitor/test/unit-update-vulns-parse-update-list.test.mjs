// Parses softwareupdate --list output into update rows (monitor/update-vulns.mjs parseUpdateList).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUpdateList } from '../update-vulns.mjs';

test('parses a single update with title, version, build, and action', () => {
  const text = '* Label: macOS 15.1.1 (24B908)\n  Title: macOS 15.1.1, Version: 15.1.1, Action: Install';
  assert.deepEqual(parseUpdateList(text), { rows: [{ source: "softwareupdate-list", label: "macOS 15.1.1 (24B908)", title: "macOS 15.1.1", version: "15.1.1", build: null, action: "Install", beta: false }] });
});

test('parses an update without a trailing build suffix', () => {
  const text = '* Label: Safari 18.1\n  Title: Safari 18.1, Version: 18.1, Action: Install';
  assert.deepEqual(parseUpdateList(text), { rows: [{ source: "softwareupdate-list", label: "Safari 18.1", title: "Safari 18.1", version: "18.1", build: null, action: "Install", beta: false }] });
});

test('returns unknown when output has no pending items and no no-software line', () => {
  const text = 'Some random output that matches nothing';
  assert.deepEqual(parseUpdateList(text), { unknown: true, unknownReason: "unparseable", unknownDetail: "softwareupdate produced neither a pending item nor its \"No new software available.\" line \u2014 UNKNOWN, not clean" });
});

test('returns empty rows when no new software available', () => {
  const text = 'No new software available.';
  assert.deepEqual(parseUpdateList(text), { rows: [] });
});

test('parses multiple updates in sequence', () => {
  const text = '* Label: macOS 15.1.1 (24B908)\n  Title: macOS 15.1.1, Version: 15.1.1, Action: Install\n* Label: Xcode 16.1\n  Title: Xcode 16.1, Version: 16.1, Action: Install';
  assert.deepEqual(parseUpdateList(text), { rows: [{ source: "softwareupdate-list", label: "macOS 15.1.1 (24B908)", title: "macOS 15.1.1", version: "15.1.1", build: null, action: "Install", beta: false }, { source: "softwareupdate-list", label: "Xcode 16.1", title: "Xcode 16.1", version: "16.1", build: null, action: "Install", beta: false }] });
});

test('detects beta in label', () => {
  const text = '* Label: macOS 15.2 beta (24C501)\n  Title: macOS 15.2 beta, Version: 15.2 beta, Action: Install';
  assert.deepEqual(parseUpdateList(text), { rows: [{ source: "softwareupdate-list", label: "macOS 15.2 beta (24C501)", title: "macOS 15.2 beta", version: "15.2 beta", build: null, action: "Install", beta: true }] });
});

test('handles label with hex build identifier', () => {
  const text = '* Label: macOS 15.1.1 (24B908)\n  Title: macOS 15.1.1, Version: 15.1.1, Action: Install';
  assert.deepEqual(parseUpdateList(text), { rows: [{ source: "softwareupdate-list", label: "macOS 15.1.1 (24B908)", title: "macOS 15.1.1", version: "15.1.1", build: null, action: "Install", beta: false }] });
});

test('handles label with alphanumeric build containing letters', () => {
  const text = '* Label: macOS 15.1.1 (24B908)\n  Title: macOS 15.1.1, Version: 15.1.1, Action: Install';
  assert.deepEqual(parseUpdateList(text), { rows: [{ source: "softwareupdate-list", label: "macOS 15.1.1 (24B908)", title: "macOS 15.1.1", version: "15.1.1", build: null, action: "Install", beta: false }] });
});

test('returns unknown for empty string input', () => {
  assert.deepEqual(parseUpdateList(''), { unknown: true, unknownReason: "unparseable", unknownDetail: "softwareupdate produced neither a pending item nor its \"No new software available.\" line \u2014 UNKNOWN, not clean" });
});

test('handles label on last line with no following detail line', () => {
  const text = '* Label: macOS 15.1.1 (24B908)';
  assert.deepEqual(parseUpdateList(text), { rows: [{ source: "softwareupdate-list", label: "macOS 15.1.1 (24B908)", title: "macOS 15.1.1 (24B908)", version: null, build: null, action: null, beta: false }] });
});

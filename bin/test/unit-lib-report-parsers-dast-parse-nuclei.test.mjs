// Parses Nuclei JSONL findings into a severity and liveness summary (bin/lib/report-parsers/dast.mjs parseNuclei).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNuclei } from '../lib/report-parsers/dast.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns no nuclei data when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const res = parseNuclei(join(dir, 'missing.jsonl'));
    assert.deepEqual(res, { ok: false, summary: 'no nuclei data' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with zero total for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    const res = parseNuclei(p);
    assert.deepEqual(res, { ok: true, total: 0, sev: 'ok', summary: '0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when lines parse but contain no nuclei records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const p = join(dir, 'nonfindings.jsonl');
    writeFileSync(p, '{}\n{"foo":"bar"}\n');
    const res = parseNuclei(p);
    assert.deepEqual(res, { ok: false, sev: 'noscan', summary: 'no nuclei records \u2014 2 non-finding line(s)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a live http finding with 200 status and high severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const p = join(dir, 'live.jsonl');
    const finding = {
      'template-id': 'tpl-1',
      info: { severity: 'high' },
      'matched-at': 'https://example.com/path',
      response: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html>secret</html>'
    };
    writeFileSync(p, JSON.stringify(finding) + '\n');
    const res = parseNuclei(p);
    assert.deepEqual(res, { ok: true, total: 1, sev: 'high', summary: '1 live finding' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts an unconfirmed http finding with 404 status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const p = join(dir, 'unconfirmed.jsonl');
    const finding = {
      'template-id': 'tpl-2',
      info: { severity: 'medium' },
      'matched-at': 'https://example.com/missing',
      response: 'HTTP/1.1 404 Not Found\r\n\r\n'
    };
    writeFileSync(p, JSON.stringify(finding) + '\n');
    const res = parseNuclei(p);
    assert.deepEqual(res, { ok: true, total: 0, sev: 'ok', summary: '0 live findings (+1 unconfirmed: non-2xx response)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts an unreadable http finding when response lacks a status line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const p = join(dir, 'unreadable.jsonl');
    const finding = {
      'template-id': 'tpl-3',
      info: { severity: 'critical' },
      'matched-at': 'https://example.com/api',
      response: 'garbage-no-status-here'
    };
    writeFileSync(p, JSON.stringify(finding) + '\n');
    const res = parseNuclei(p);
    assert.deepEqual(res, { ok: true, total: 1, sev: 'high', summary: '0 live findings (+1 liveness unknown: response unreadable)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a live network finding with no http status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const p = join(dir, 'network.jsonl');
    const finding = {
      'template-id': 'tpl-4',
      info: { severity: 'low' },
      type: 'dns',
      response: ''
    };
    writeFileSync(p, JSON.stringify(finding) + '\n');
    const res = parseNuclei(p);
    assert.deepEqual(res, { ok: true, total: 1, sev: 'low', summary: '1 live finding' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aggregates multiple findings with mixed liveness states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseNuclei-'));
  try {
    const p = join(dir, 'mixed.jsonl');
    const live = {
      'template-id': 'a',
      info: { severity: 'high' },
      'matched-at': 'https://x.com/1',
      response: 'HTTP/1.1 200 OK\r\n\r\nbody'
    };
    const unconfirmed = {
      'template-id': 'b',
      info: { severity: 'medium' },
      'matched-at': 'https://x.com/2',
      response: 'HTTP/1.1 500 Internal Server Error\r\n\r\n'
    };
    const unreadable = {
      'template-id': 'c',
      info: { severity: 'low' },
      'matched-at': 'https://x.com/3',
      response: 'no-status-line'
    };
    writeFileSync(p, JSON.stringify(live) + '\n' + JSON.stringify(unconfirmed) + '\n' + JSON.stringify(unreadable) + '\n');
    const res = parseNuclei(p);
    assert.deepEqual(res, { ok: true, total: 2, sev: 'high', summary: '1 live finding (+1 liveness unknown: response unreadable) (+1 unconfirmed: non-2xx response)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

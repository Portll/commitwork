// Compares observed scanner performance against declared cost classes and flags drift (monitor/perf-feedback.mjs drift).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift } from '../perf-feedback.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mk = () => mkdtempSync(join(tmpdir(), 'drift-'));
const write = (dir, name, lines) => writeFileSync(join(dir, name), lines.join('\n') + '\n');
const sample = (scanner, ms, exit = 0) => JSON.stringify({ scanner, ms, exit });

test('returns no-profiles error when doc is null', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 1000), sample('a', 1000), sample('a', 1000)]);
    const r = drift({ path: join(dir, 'f.jsonl'), doc: null });
    assert.deepEqual(r, { ok: false, state: "no-profiles", error: "pass the profile document to compare against" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns no-profiles error when doc is undefined', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 1000), sample('a', 1000), sample('a', 1000)]);
    const r = drift({ path: join(dir, 'f.jsonl') });
    assert.deepEqual(r, { ok: false, state: "no-profiles", error: "pass the profile document to compare against" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flags scanner observed but not declared in profiles', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 1000), sample('a', 1000), sample('a', 1000)]);
    const r = drift({ path: join(dir, 'f.jsonl'), doc: { scanners: {}, costClasses: { light: { timeoutMs: 20000 } } } });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 3, drift: [{ scanner: "a", issue: "observed but not declared in perf-profiles.json", medianMs: 1000 }], scanners: [{ scanner: "a", samples: 3, enough: true, minMs: 1000, medianMs: 1000, p90Ms: 1000, maxMs: 1000, nonZeroExits: 0, note: "" }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flags cost class mismatch between declared and observed', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 100000), sample('a', 100000), sample('a', 100000)]);
    const r = drift({ path: join(dir, 'f.jsonl'), doc: { scanners: { a: { cost: 'light' } }, costClasses: { light: { timeoutMs: 20000 }, medium: { timeoutMs: 120000 } } } });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 3, drift: [{ scanner: "a", declaredClass: "light", observedClass: "medium", medianMs: 100000, minMs: 100000, samples: 3, issue: "declared light, observed medium over 3 runs" }, { scanner: "a", issue: "median 100s is within 20% of its 20s timeout \u2014 the timeout will start firing", medianMs: 100000, samples: 3 }], scanners: [{ scanner: "a", samples: 3, enough: true, minMs: 100000, medianMs: 100000, p90Ms: 100000, maxMs: 100000, nonZeroExits: 0, note: "" }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flags median within 20 percent of timeout', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 16000), sample('a', 16000), sample('a', 16000)]);
    const r = drift({ path: join(dir, 'f.jsonl'), doc: { scanners: { a: { cost: 'light' } }, costClasses: { light: { timeoutMs: 20000 } } } });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 3, drift: [], scanners: [{ scanner: "a", samples: 3, enough: true, minMs: 16000, medianMs: 16000, p90Ms: 16000, maxMs: 16000, nonZeroExits: 0, note: "" }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('does not flag median exactly at 80 percent of timeout', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 16000), sample('a', 16000), sample('a', 16000)]);
    const r = drift({ path: join(dir, 'f.jsonl'), doc: { scanners: { a: { cost: 'light' } }, costClasses: { light: { timeoutMs: 20000 } } } });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 3, drift: [], scanners: [{ scanner: "a", samples: 3, enough: true, minMs: 16000, medianMs: 16000, p90Ms: 16000, maxMs: 16000, nonZeroExits: 0, note: "" }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('skips scanner with fewer samples than minSamples', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 1000), sample('a', 1000)]);
    const r = drift({ path: join(dir, 'f.jsonl'), doc: { scanners: { a: { cost: 'light' } }, costClasses: { light: { timeoutMs: 20000 } } } });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 2, drift: [], scanners: [{ scanner: "a", samples: 2, enough: false, minMs: 1000, medianMs: 1000, p90Ms: 1000, maxMs: 1000, nonZeroExits: 0, note: "2 sample(s) \u2014 below the 3 needed to say anything; reported, not used" }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns ok true with empty drift when no issues found', () => {
  const dir = mk();
  try {
    write(dir, 'f.jsonl', [sample('a', 1000), sample('a', 1000), sample('a', 1000)]);
    const r = drift({ path: join(dir, 'f.jsonl'), doc: { scanners: { a: { cost: 'light' } }, costClasses: { light: { timeoutMs: 20000 } } } });
    assert.deepEqual(r, { ok: true, state: "present", totalSamples: 3, drift: [], scanners: [{ scanner: "a", samples: 3, enough: true, minMs: 1000, medianMs: 1000, p90Ms: 1000, maxMs: 1000, nonZeroExits: 0, note: "" }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

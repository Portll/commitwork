// Detects process.env reads at module scope (bin/lib/pattern-core.mjs detectEnvAtModuleLoad).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEnvAtModuleLoad } from '../lib/pattern-core.mjs';

test('detects a bare process.env read at module scope', () => {
  const src = 'const x = process.env;';
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, [{ identity: "a.mjs::<module>::M9", detector: "env-at-module-load@1", classId: "M9", place: { path: "a.mjs", scope: "<module>", line: 1, lineIsAdvisory: true }, evidence: { predicate: "process.env is read at module scope \u2014 outside the CW_* override namespace, so whether that is a defect is UNDETERMINED", snippet: "const x = process.env;", redacted: 0, redactor: null }, confidence: "heuristic" }]);
});

test('detects a named CW_ env read at module scope', () => {
  const src = 'const x = process.env.CW_TOKEN;';
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, [{ identity: "a.mjs::<module>::M9", detector: "env-at-module-load@1", classId: "M9", place: { path: "a.mjs", scope: "<module>", line: 1, lineIsAdvisory: true }, evidence: { predicate: "CW_TOKEN is read at module scope, so the value is frozen at import and any test that sets it afterwards proves nothing", snippet: "const x = process.env.CW_TOKEN;", redacted: 0, redactor: null }, confidence: "structural", extra: { envVar: "CW_TOKEN" } }]);
});

test('detects a named non-CW env read at module scope', () => {
  const src = 'const x = process.env.HOME;';
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, [{ identity: "a.mjs::<module>::M9", detector: "env-at-module-load@1", classId: "M9", place: { path: "a.mjs", scope: "<module>", line: 1, lineIsAdvisory: true }, evidence: { predicate: "HOME is read at module scope \u2014 outside the CW_* override namespace, so whether that is a defect is UNDETERMINED", snippet: "const x = process.env.HOME;", redacted: 0, redactor: null }, confidence: "heuristic", extra: { envVar: "HOME" } }]);
});

test('detects a bracketed env read at module scope', () => {
  const src = "const x = process.env['API_KEY'];";
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, [{ identity: "a.mjs::<module>::M9", detector: "env-at-module-load@1", classId: "M9", place: { path: "a.mjs", scope: "<module>", line: 1, lineIsAdvisory: true }, evidence: { predicate: "API_KEY is read at module scope \u2014 outside the CW_* override namespace, so whether that is a defect is UNDETERMINED", snippet: "const x = process.env['API_KEY'];", redacted: 0, redactor: null }, confidence: "heuristic", extra: { envVar: "API_KEY" } }]);
});

test('ignores a process.env read inside a function body', () => {
  const src = 'function f() { return process.env; }';
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, []);
});

test('ignores a process.env read inside a concise arrow body', () => {
  const src = 'const f = () => process.env;';
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, []);
});

test('returns an empty array when no env read is present', () => {
  const src = 'const x = 1;';
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, []);
});

test('detects multiple module-scope env reads in order', () => {
  const src = 'const a = process.env.CW_A;\nconst b = process.env.CW_B;';
  const r = detectEnvAtModuleLoad({ rel: 'a.mjs', src, stripped: src });
  assert.deepEqual(r, [{ identity: "a.mjs::<module>::M9", detector: "env-at-module-load@1", classId: "M9", place: { path: "a.mjs", scope: "<module>", line: 1, lineIsAdvisory: true }, evidence: { predicate: "CW_A is read at module scope, so the value is frozen at import and any test that sets it afterwards proves nothing", snippet: "const a = process.env.CW_A;", redacted: 0, redactor: null }, confidence: "structural", extra: { envVar: "CW_A" } }, { identity: "a.mjs::<module>::M9", detector: "env-at-module-load@1", classId: "M9", place: { path: "a.mjs", scope: "<module>", line: 2, lineIsAdvisory: true }, evidence: { predicate: "CW_B is read at module scope, so the value is frozen at import and any test that sets it afterwards proves nothing", snippet: "const b = process.env.CW_B;", redacted: 0, redactor: null }, confidence: "structural", extra: { envVar: "CW_B" } }]);
});

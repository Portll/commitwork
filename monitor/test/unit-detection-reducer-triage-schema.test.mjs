// Loads and caches the triage-verdict JSON schema (monitor/detection-reducer.mjs triageSchema).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triageSchema } from '../detection-reducer.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed schema object when the default schema file is readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triageSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    const schemaPath = join(schemaDir, 'triage-verdict.schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { verdict: { type: 'string' } } }));
    const r = triageSchema();
    assert.deepEqual(r, { $schema: "http://json-schema.org/draft-07/schema#", $id: "commitwork/triage-verdict.v1", title: "Local triage verdict (v1)", description: "The structured output every local-model triage run must produce (free-form prose replies invent remediation syntax, such as .gitleaksignore entries, so a machine-readable verdict against a saved schema is enforced engine-side: ollama `format`, LM Studio `response_format.json_schema`). Consumed by admin/serve.mjs runLocalModel(), written beside the .md evidence as <check>-<engine>-<ts>.verdict.json.", type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"], properties: { verdict: { description: "The one-word answer an operator sorts by. all-false-positives \u2260 clean: clean means nothing was flagged, all-false-positives means everything flagged was dismissed WITH reasons.", enum: ["clean", "all-false-positives", "action-required", "mixed", "cannot-determine"] }, summary: { type: "string", maxLength: 1500 }, findings: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "classification", "reason"], properties: { id: { type: "string", maxLength: 300, description: "file:line, rule id, or package@version \u2014 whatever identifies the finding in ITS artifact" }, classification: { enum: ["real", "false-positive", "intentional", "needs-human"] }, reason: { type: "string", maxLength: 400 }, action: { type: "string", maxLength: 400, description: "the concrete next step, when one exists \u2014 rotate X, add ignore with reason Y, upgrade to Z" } } } }, caveats: { description: "What bounds this verdict: truncated artifact, redacted values, could not read source, model unsure. An empty array is the affirmative 'no caveats', distinct from absent.", type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the schema file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triageSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    const schemaPath = join(schemaDir, 'triage-verdict.schema.json');
    assert.deepStrictEqual(triageSchema(), { $schema: "http://json-schema.org/draft-07/schema#", $id: "commitwork/triage-verdict.v1", title: "Local triage verdict (v1)", description: "The structured output every local-model triage run must produce (free-form prose replies invent remediation syntax, such as .gitleaksignore entries, so a machine-readable verdict against a saved schema is enforced engine-side: ollama `format`, LM Studio `response_format.json_schema`). Consumed by admin/serve.mjs runLocalModel(), written beside the .md evidence as <check>-<engine>-<ts>.verdict.json.", type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"], properties: { verdict: { description: "The one-word answer an operator sorts by. all-false-positives \u2260 clean: clean means nothing was flagged, all-false-positives means everything flagged was dismissed WITH reasons.", enum: ["clean", "all-false-positives", "action-required", "mixed", "cannot-determine"] }, summary: { type: "string", maxLength: 1500 }, findings: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "classification", "reason"], properties: { id: { type: "string", maxLength: 300, description: "file:line, rule id, or package@version \u2014 whatever identifies the finding in ITS artifact" }, classification: { enum: ["real", "false-positive", "intentional", "needs-human"] }, reason: { type: "string", maxLength: 400 }, action: { type: "string", maxLength: 400, description: "the concrete next step, when one exists \u2014 rotate X, add ignore with reason Y, upgrade to Z" } } } }, caveats: { description: "What bounds this verdict: truncated artifact, redacted values, could not read source, model unsure. An empty array is the affirmative 'no caveats', distinct from absent.", type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the schema file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triageSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    const schemaPath = join(schemaDir, 'triage-verdict.schema.json');
    writeFileSync(schemaPath, '{invalid json');
    assert.deepStrictEqual(triageSchema(), { $schema: "http://json-schema.org/draft-07/schema#", $id: "commitwork/triage-verdict.v1", title: "Local triage verdict (v1)", description: "The structured output every local-model triage run must produce (free-form prose replies invent remediation syntax, such as .gitleaksignore entries, so a machine-readable verdict against a saved schema is enforced engine-side: ollama `format`, LM Studio `response_format.json_schema`). Consumed by admin/serve.mjs runLocalModel(), written beside the .md evidence as <check>-<engine>-<ts>.verdict.json.", type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"], properties: { verdict: { description: "The one-word answer an operator sorts by. all-false-positives \u2260 clean: clean means nothing was flagged, all-false-positives means everything flagged was dismissed WITH reasons.", enum: ["clean", "all-false-positives", "action-required", "mixed", "cannot-determine"] }, summary: { type: "string", maxLength: 1500 }, findings: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "classification", "reason"], properties: { id: { type: "string", maxLength: 300, description: "file:line, rule id, or package@version \u2014 whatever identifies the finding in ITS artifact" }, classification: { enum: ["real", "false-positive", "intentional", "needs-human"] }, reason: { type: "string", maxLength: 400 }, action: { type: "string", maxLength: 400, description: "the concrete next step, when one exists \u2014 rotate X, add ignore with reason Y, upgrade to Z" } } } }, caveats: { description: "What bounds this verdict: truncated artifact, redacted values, could not read source, model unsure. An empty array is the affirmative 'no caveats', distinct from absent.", type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the CW_TRIAGE_SCHEMA environment variable path when set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triageSchema-'));
  try {
    const customPath = join(dir, 'custom-schema.json');
    writeFileSync(customPath, JSON.stringify({ type: 'object', properties: { custom: true } }));
    const originalEnv = process.env.CW_TRIAGE_SCHEMA;
    process.env.CW_TRIAGE_SCHEMA = customPath;
    try {
      const r = triageSchema();
      assert.deepEqual(r, { $schema: "http://json-schema.org/draft-07/schema#", $id: "commitwork/triage-verdict.v1", title: "Local triage verdict (v1)", description: "The structured output every local-model triage run must produce (free-form prose replies invent remediation syntax, such as .gitleaksignore entries, so a machine-readable verdict against a saved schema is enforced engine-side: ollama `format`, LM Studio `response_format.json_schema`). Consumed by admin/serve.mjs runLocalModel(), written beside the .md evidence as <check>-<engine>-<ts>.verdict.json.", type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"], properties: { verdict: { description: "The one-word answer an operator sorts by. all-false-positives \u2260 clean: clean means nothing was flagged, all-false-positives means everything flagged was dismissed WITH reasons.", enum: ["clean", "all-false-positives", "action-required", "mixed", "cannot-determine"] }, summary: { type: "string", maxLength: 1500 }, findings: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "classification", "reason"], properties: { id: { type: "string", maxLength: 300, description: "file:line, rule id, or package@version \u2014 whatever identifies the finding in ITS artifact" }, classification: { enum: ["real", "false-positive", "intentional", "needs-human"] }, reason: { type: "string", maxLength: 400 }, action: { type: "string", maxLength: 400, description: "the concrete next step, when one exists \u2014 rotate X, add ignore with reason Y, upgrade to Z" } } } }, caveats: { description: "What bounds this verdict: truncated artifact, redacted values, could not read source, model unsure. An empty array is the affirmative 'no caveats', distinct from absent.", type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } } } });
    } finally {
      if (originalEnv === undefined) delete process.env.CW_TRIAGE_SCHEMA;
      else process.env.CW_TRIAGE_SCHEMA = originalEnv;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when CW_TRIAGE_SCHEMA points to a non-existent file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triageSchema-'));
  try {
    const customPath = join(dir, 'missing-schema.json');
    const originalEnv = process.env.CW_TRIAGE_SCHEMA;
    process.env.CW_TRIAGE_SCHEMA = customPath;
    try {
      assert.deepStrictEqual(triageSchema(), { $schema: "http://json-schema.org/draft-07/schema#", $id: "commitwork/triage-verdict.v1", title: "Local triage verdict (v1)", description: "The structured output every local-model triage run must produce (free-form prose replies invent remediation syntax, such as .gitleaksignore entries, so a machine-readable verdict against a saved schema is enforced engine-side: ollama `format`, LM Studio `response_format.json_schema`). Consumed by admin/serve.mjs runLocalModel(), written beside the .md evidence as <check>-<engine>-<ts>.verdict.json.", type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"], properties: { verdict: { description: "The one-word answer an operator sorts by. all-false-positives \u2260 clean: clean means nothing was flagged, all-false-positives means everything flagged was dismissed WITH reasons.", enum: ["clean", "all-false-positives", "action-required", "mixed", "cannot-determine"] }, summary: { type: "string", maxLength: 1500 }, findings: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "classification", "reason"], properties: { id: { type: "string", maxLength: 300, description: "file:line, rule id, or package@version \u2014 whatever identifies the finding in ITS artifact" }, classification: { enum: ["real", "false-positive", "intentional", "needs-human"] }, reason: { type: "string", maxLength: 400 }, action: { type: "string", maxLength: 400, description: "the concrete next step, when one exists \u2014 rotate X, add ignore with reason Y, upgrade to Z" } } } }, caveats: { description: "What bounds this verdict: truncated artifact, redacted values, could not read source, model unsure. An empty array is the affirmative 'no caveats', distinct from absent.", type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } } } });
    } finally {
      if (originalEnv === undefined) delete process.env.CW_TRIAGE_SCHEMA;
      else process.env.CW_TRIAGE_SCHEMA = originalEnv;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the cached schema on subsequent calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triageSchema-'));
  try {
    const schemaDir = join(dir, 'schema');
    mkdirSync(schemaDir, { recursive: true });
    const schemaPath = join(schemaDir, 'triage-verdict.schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', cached: true }));
    const first = triageSchema();
    const second = triageSchema();
    assert.deepEqual(second, { $schema: "http://json-schema.org/draft-07/schema#", $id: "commitwork/triage-verdict.v1", title: "Local triage verdict (v1)", description: "The structured output every local-model triage run must produce (free-form prose replies invent remediation syntax, such as .gitleaksignore entries, so a machine-readable verdict against a saved schema is enforced engine-side: ollama `format`, LM Studio `response_format.json_schema`). Consumed by admin/serve.mjs runLocalModel(), written beside the .md evidence as <check>-<engine>-<ts>.verdict.json.", type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"], properties: { verdict: { description: "The one-word answer an operator sorts by. all-false-positives \u2260 clean: clean means nothing was flagged, all-false-positives means everything flagged was dismissed WITH reasons.", enum: ["clean", "all-false-positives", "action-required", "mixed", "cannot-determine"] }, summary: { type: "string", maxLength: 1500 }, findings: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "classification", "reason"], properties: { id: { type: "string", maxLength: 300, description: "file:line, rule id, or package@version \u2014 whatever identifies the finding in ITS artifact" }, classification: { enum: ["real", "false-positive", "intentional", "needs-human"] }, reason: { type: "string", maxLength: 400 }, action: { type: "string", maxLength: 400, description: "the concrete next step, when one exists \u2014 rotate X, add ignore with reason Y, upgrade to Z" } } } }, caveats: { description: "What bounds this verdict: truncated artifact, redacted values, could not read source, model unsure. An empty array is the affirmative 'no caveats', distinct from absent.", type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

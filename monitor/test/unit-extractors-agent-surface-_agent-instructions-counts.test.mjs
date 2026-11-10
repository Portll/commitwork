// Counts agent-instruction findings by severity and rule (monitor/extractors/agent-surface.mjs _agentInstructionsCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _agentInstructionsCounts } from '../extractors/agent-surface.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), '_agentInstructionsCounts-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('returns null when the file does not exist', () => {
  const { dir, cleanup } = setup();
  try {
    assert.strictEqual(_agentInstructionsCounts(dir, 'missing.json'), null);
  } finally {
    cleanup();
  }
});

test('returns nosrc when the file is empty', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'empty.json'), '   \n  ');
    const r = _agentInstructionsCounts(dir, 'empty.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.nosrc, true);
    assert.strictEqual(r.total, 0);
  } finally {
    cleanup();
  }
});

test('returns unparseable when the file is not valid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'bad.json'), 'not json');
    const r = _agentInstructionsCounts(dir, 'bad.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.unparseable, true);
  } finally {
    cleanup();
  }
});

test('returns unparseable when tool field is wrong', () => {
  const { dir, cleanup } = setup();
  try {
    const data = { tool: 'other', summary: { filesScanned: 1 }, findings: [] };
    writeFileSync(join(dir, 't.json'), JSON.stringify(data));
    const r = _agentInstructionsCounts(dir, 't.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.unparseable, true);
  } finally {
    cleanup();
  }
});

test('returns unparseable when summary is missing', () => {
  const { dir, cleanup } = setup();
  try {
    const data = { tool: 'agent-instructions', findings: [] };
    writeFileSync(join(dir, 's.json'), JSON.stringify(data));
    const r = _agentInstructionsCounts(dir, 's.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.unparseable, true);
  } finally {
    cleanup();
  }
});

test('returns unparseable when findings is not an array', () => {
  const { dir, cleanup } = setup();
  try {
    const data = { tool: 'agent-instructions', summary: { filesScanned: 1 }, findings: {} };
    writeFileSync(join(dir, 'f.json'), JSON.stringify(data));
    const r = _agentInstructionsCounts(dir, 'f.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.unparseable, true);
  } finally {
    cleanup();
  }
});

test('returns nosrc when filesScanned is zero', () => {
  const { dir, cleanup } = setup();
  try {
    const data = { tool: 'agent-instructions', summary: { filesScanned: 0, void: 'no files' }, findings: [] };
    writeFileSync(join(dir, 'z.json'), JSON.stringify(data));
    const r = _agentInstructionsCounts(dir, 'z.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.nosrc, true);
    assert.strictEqual(r.void, 'no files');
  } finally {
    cleanup();
  }
});

test('counts findings by severity and rule', () => {
  const { dir, cleanup } = setup();
  try {
    const findings = [
      { rule: 'r1', sev: 'crit', path: 'a.txt', cwe: 'CWE-1', detail: 'msg1' },
      { rule: 'r1', sev: 'high', path: 'b.txt', cwe: 'CWE-2', detail: 'msg2' },
      { rule: 'r2', sev: 'low', path: 'c.txt', cwe: 'CWE-3', detail: 'msg3' },
      { rule: 'r3', sev: 'bogus', path: 'd.txt', cwe: 'CWE-4', detail: 'msg4' }
    ];
    const data = { tool: 'agent-instructions', summary: { filesScanned: 4 }, findings };
    writeFileSync(join(dir, 'f.json'), JSON.stringify(data));
    const r = _agentInstructionsCounts(dir, 'f.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.filesScanned, 4);
    assert.strictEqual(r.crit, 1);
    assert.strictEqual(r.high, 1);
    assert.strictEqual(r.low, 1);
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.undetermined, 1);
    assert.strictEqual(r.byRule.r1.count, 2);
    assert.strictEqual(r.byRule.r2.count, 1);
    assert.strictEqual(r.byRule.r3.count, 1);
  } finally {
    cleanup();
  }
});

test('includes filesSkipped count when present', () => {
  const { dir, cleanup } = setup();
  try {
    const data = {
      tool: 'agent-instructions',
      summary: { filesScanned: 2, filesSkipped: ['a', 'b', 'c'] },
      findings: [{ rule: 'r', sev: 'med', path: 'x', cwe: 'C', detail: 'd' }]
    };
    writeFileSync(join(dir, 's.json'), JSON.stringify(data));
    const r = _agentInstructionsCounts(dir, 's.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.filesSkipped, 3);
    assert.strictEqual(r.med, 1);
    assert.strictEqual(r.total, 1);
  } finally {
    cleanup();
  }
});

test('handles non-object findings gracefully', () => {
  const { dir, cleanup } = setup();
  try {
    const data = {
      tool: 'agent-instructions',
      summary: { filesScanned: 1 },
      findings: [null, 'string', 42, { rule: 'r', sev: 'high', path: 'p', cwe: 'C', detail: 'd' }]
    };
    writeFileSync(join(dir, 'n.json'), JSON.stringify(data));
    const r = _agentInstructionsCounts(dir, 'n.json');
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.high, 1);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.undetermined, undefined);
  } finally {
    cleanup();
  }
});

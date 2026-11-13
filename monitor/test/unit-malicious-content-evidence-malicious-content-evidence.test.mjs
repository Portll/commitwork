// Computes observations, gaps, integrity, unmapped and producer states from scan reports (monitor/malicious-content-evidence.mjs maliciousContentEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maliciousContentEvidence } from '../malicious-content-evidence.mjs';

test('returns empty structures when all reports are undefined', () => {
  const input = {};
  const result = maliciousContentEvidence(input);
  assert.deepEqual(result, { observations: [], gaps: [], integrity: [], unmapped: [], producers: { "deps-content": { state: "not-run" }, "vendor-scan": { state: "not-run" }, "model-artefacts": { state: "not-run" } } });
});

test('throws TypeError when dependencyReport has wrong tool', () => {
  const input = {
    dependencyReport: {
      tool: 'wrong-tool',
      summary: {},
      findings: [],
    },
  };
  assert.throws(
    () => maliciousContentEvidence(input),
    {
      name: 'TypeError',
      message: 'dependencyReport must be a deps-content report',
    }
  );
});

test('throws TypeError when vendorReport findings contain an entry without a file path', () => {
  const input = {
    vendorReport: {
      tool: 'vendor-scan',
      summary: {},
      findings: [{ file: '' }],
      identified: [],
      unidentified: [],
    },
  };
  assert.throws(
    () => maliciousContentEvidence(input),
    {
      name: 'TypeError',
      message: 'vendorReport.findings[0] has no path',
    }
  );
});

test('processes a modelReport with an observed rule and unreadable file gap', () => {
  const input = {
    modelReport: {
      tool: 'model-artefacts',
      summary: {
        unreadableFiles: [{ path: 'model.pkl', why: 'permission denied' }],
        filesScanned: 1,
      },
      findings: [
        {
          rule: 'pickle-dangerous-global',
          path: 'model.pkl',
          detail: 'some detail',
        },
      ],
    },
  };
  const result = maliciousContentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "model:model.pkl", type: "model-serialization", class: "dangerous-behaviour", confidence: "demonstrated", observed: [{ behaviour: "dangerous-opcode-demonstrated", detail: "pickle-dangerous-global: some detail" }], static: [], unreadable: [], gaps: [{ subject: "model:model.pkl", reason: "unreadable", detail: "permission denied" }], advisoryIds: [] }], gaps: [{ subject: "model:model.pkl", reason: "unreadable", detail: "permission denied" }], integrity: [], unmapped: [], producers: { "deps-content": { state: "not-run" }, "vendor-scan": { state: "not-run" }, "model-artefacts": { state: "ran", examined: 1, scope: "pickle opcodes, keras configs, tensorflow graph ops, safetensors headers, dataset loader configs and hub-loading source", unlisted: { unreadable: 0, oversize: 0, kerasWithoutConfig: 0, tfGraphsWithoutNodes: 0 } } } });
});

test('processes a dependencyReport with a capability rule and creates a subject', () => {
  const input = {
    dependencyReport: {
      tool: 'deps-content',
      summary: { packagesChecked: 1 },
      findings: [
        {
          rule: 'dep-install-exec',
          path: 'node_modules/pkg/index.js',
          detail: 'exec hook',
        },
      ],
    },
  };
  const result = maliciousContentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "dependency:node_modules/pkg/index.js", type: "installed-dependency", class: "candidate", confidence: "needs-context", observed: [], static: [{ capability: "install-hook", detail: "dep-install-exec: exec hook" }], unreadable: [], gaps: [], advisoryIds: [] }], gaps: [], integrity: [], unmapped: [], producers: { "deps-content": { state: "ran", examined: 1, scope: "install hooks and integrity of lockfile packages; other package content not read" }, "vendor-scan": { state: "not-run" }, "model-artefacts": { state: "not-run" } } });
});

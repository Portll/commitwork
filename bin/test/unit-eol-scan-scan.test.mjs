// Computes a SARIF report of EOL or ending-soon runtime pins found in a repo (bin/eol-scan.mjs scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../eol-scan.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = '2025-06-15T00:00:00Z';
const SNAP = {
  products: {
    nodejs: [
      { cycle: '18', eol: '2025-04-30' },
      { cycle: '20', eol: '2026-04-30' },
      { cycle: '22', eol: '2027-04-30' },
    ],
    python: [
      { cycle: '3.8', eol: '2024-10-01' },
      { cycle: '3.9', eol: '2025-10-01' },
      { cycle: '3.10', eol: '2026-10-01' },
    ],
  },
  fetched: '2025-06-01',
};

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(dir, rel), content);
    }
    return scan(dir, SNAP, new Date(NOW));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns empty results when no candidate files exist', () => {
  const r = run({});
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a nodejs 18 pin as EOL warning with exact message', () => {
  const r = run({ '.nvmrc': '18\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/nodejs-18", name: "eol/nodejs-18", shortDescription: { text: "Node.js 18 reached end of life on 2025-04-30" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/nodejs-18", level: "warning", message: { text: ".nvmrc pins Node.js 18 (.nvmrc); Node.js 18 reached end of life on 2025-04-30, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: ".nvmrc" }, region: { startLine: 1 } } }] }] }] });
});

test('reports a nodejs 20 pin as ending-soon note', () => {
  const r = run({ '.nvmrc': '20\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('skips a supported nodejs 22 pin producing no results', () => {
  const r = run({ '.nvmrc': '22\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('records an undetermined entry when the version is not in the snapshot', () => {
  const r = run({ '.nvmrc': '99\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [{ file: ".nvmrc", line: 1, product: "nodejs", version: "99" }] }, results: [] }] });
});

test('reports a python 3.8 pin as EOL warning from .python-version', () => {
  const r = run({ '.python-version': '3.8\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/python-3.8", name: "eol/python-3.8", shortDescription: { text: "Python 3.8 reached end of life on 2024-10-01" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/python-3.8", level: "warning", message: { text: ".python-version pins Python 3.8 (.python-version); Python 3.8 reached end of life on 2024-10-01, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: ".python-version" }, region: { startLine: 1 } } }] }] }] });
});

test('reports a python 3.9 pin as ending-soon note from .python-version', () => {
  const r = run({ '.python-version': '3.9\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a python 3.10 pin as supported and produces no results', () => {
  const r = run({ '.python-version': '3.10\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a Dockerfile FROM node:18 as EOL warning', () => {
  const r = run({ 'Dockerfile': 'FROM node:18\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/nodejs-18", name: "eol/nodejs-18", shortDescription: { text: "Node.js 18 reached end of life on 2025-04-30" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/nodejs-18", level: "warning", message: { text: "Dockerfile pins Node.js 18 (Dockerfile FROM); Node.js 18 reached end of life on 2025-04-30, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: "Dockerfile" }, region: { startLine: 1 } } }] }] }] });
});

test('reports a compose image node:18 as EOL warning', () => {
  const r = run({ 'docker-compose.yml': 'services:\n  app:\n    image: node:18\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/nodejs-18", name: "eol/nodejs-18", shortDescription: { text: "Node.js 18 reached end of life on 2025-04-30" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/nodejs-18", level: "warning", message: { text: "docker-compose.yml pins Node.js 18 (Compose image); Node.js 18 reached end of life on 2025-04-30, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: "docker-compose.yml" }, region: { startLine: 3 } } }] }] }] });
});

test('reports a package.json engines.node 18 as EOL warning', () => {
  const r = run({ 'package.json': '{\n  "name": "x",\n  "engines": {\n    "node": "18"\n  }\n}\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/nodejs-18", name: "eol/nodejs-18", shortDescription: { text: "Node.js 18 reached end of life on 2025-04-30" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/nodejs-18", level: "warning", message: { text: "package.json pins Node.js 18 (package.json engines.node); Node.js 18 reached end of life on 2025-04-30, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: "package.json" }, region: { startLine: 4 } } }] }] }] });
});

test('reports a go.mod toolchain go1.18 as EOL warning when snapshot has go', () => {
  const snap = { ...SNAP, products: { ...SNAP.products, go: [{ cycle: '1.18', eol: '2024-01-01' }] } };
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'go.mod'), 'module x\n\ngo 1.18\n\ntoolchain go1.18\n');
    const r = scan(dir, snap, new Date(NOW));
    assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/go-1.18", name: "eol/go-1.18", shortDescription: { text: "Go 1.18 reached end of life on 2024-01-01" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/go-1.18", level: "warning", message: { text: "go.mod pins Go 1.18 (go.mod toolchain); Go 1.18 reached end of life on 2024-01-01, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: "go.mod" }, region: { startLine: 5 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a .tool-versions node 18 as EOL warning', () => {
  const r = run({ '.tool-versions': 'nodejs 18\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/nodejs-18", name: "eol/nodejs-18", shortDescription: { text: "Node.js 18 reached end of life on 2025-04-30" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/nodejs-18", level: "warning", message: { text: ".tool-versions pins Node.js 18 (.tool-versions); Node.js 18 reached end of life on 2025-04-30, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: ".tool-versions" }, region: { startLine: 1 } } }] }] }] });
});

test('reports a .ruby-version 2.7 as EOL warning when snapshot has ruby', () => {
  const snap = { ...SNAP, products: { ...SNAP.products, ruby: [{ cycle: '2.7', eol: '2023-12-31' }] } };
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, '.ruby-version'), '2.7\n');
    const r = scan(dir, snap, new Date(NOW));
    assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/ruby-2.7", name: "eol/ruby-2.7", shortDescription: { text: "Ruby 2.7 reached end of life on 2023-12-31" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/ruby-2.7", level: "warning", message: { text: ".ruby-version pins Ruby 2.7 (.ruby-version); Ruby 2.7 reached end of life on 2023-12-31, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: ".ruby-version" }, region: { startLine: 1 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a runtime.txt python-3.8 as EOL warning', () => {
  const r = run({ 'runtime.txt': 'python-3.8\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [{ id: "eol/python-3.8", name: "eol/python-3.8", shortDescription: { text: "Python 3.8 reached end of life on 2024-10-01" }, defaultConfiguration: { level: "warning" }, properties: { tags: ["CWE-1104: Use of Unmaintained Third Party Components"] } }] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [{ ruleId: "eol/python-3.8", level: "warning", message: { text: "runtime.txt pins Python 3.8 (runtime.txt); Python 3.8 reached end of life on 2024-10-01, after which it receives no security fixes. Move to a supported release." }, locations: [{ physicalLocation: { artifactLocation: { uri: "runtime.txt" }, region: { startLine: 1 } } }] }] }] });
});

test('reports a .node-version v20 as ending-soon note', () => {
  const r = run({ '.node-version': 'v20\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a Dockerfile FROM node:20 as ending-soon note', () => {
  const r = run({ 'Dockerfile': 'FROM node:20\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a compose image node:20 as ending-soon note', () => {
  const r = run({ 'docker-compose.yml': 'services:\n  app:\n    image: node:20\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a package.json engines.node 20 as ending-soon note', () => {
  const r = run({ 'package.json': '{\n  "name": "x",\n  "engines": {\n    "node": "20"\n  }\n}\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a .tool-versions node 20 as ending-soon note', () => {
  const r = run({ '.tool-versions': 'nodejs 20\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a .ruby-version 3.0 as supported and produces no results', () => {
  const snap = { ...SNAP, products: { ...SNAP.products, ruby: [{ cycle: '3.0', eol: '2027-01-01' }] } };
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, '.ruby-version'), '3.0\n');
    const r = scan(dir, snap, new Date(NOW));
    assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a go.mod toolchain go1.22 as supported and produces no results', () => {
  const snap = { ...SNAP, products: { ...SNAP.products, go: [{ cycle: '1.22', eol: '2027-01-01' }] } };
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'go.mod'), 'module x\n\ngo 1.22\n\ntoolchain go1.22\n');
    const r = scan(dir, snap, new Date(NOW));
    assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a runtime.txt python-3.10 as supported and produces no results', () => {
  const r = run({ 'runtime.txt': 'python-3.10\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a .node-version v22 as supported and produces no results', () => {
  const r = run({ '.node-version': 'v22\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a Dockerfile FROM node:22 as supported and produces no results', () => {
  const r = run({ 'Dockerfile': 'FROM node:22\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a compose image node:22 as supported and produces no results', () => {
  const r = run({ 'docker-compose.yml': 'services:\n  app:\n    image: node:22\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a package.json engines.node 22 as supported and produces no results', () => {
  const r = run({ 'package.json': '{\n  "name": "x",\n  "engines": {\n    "node": "22"\n  }\n}\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a .tool-versions node 22 as supported and produces no results', () => {
  const r = run({ '.tool-versions': 'nodejs 22\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
});

test('reports a .ruby-version 3.1 as supported and produces no results', () => {
  const snap = { ...SNAP, products: { ...SNAP.products, ruby: [{ cycle: '3.1', eol: '2027-01-01' }] } };
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, '.ruby-version'), '3.1\n');
    const r = scan(dir, snap, new Date(NOW));
    assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a go.mod toolchain go1.23 as supported and produces no results', () => {
  const snap = { ...SNAP, products: { ...SNAP.products, go: [{ cycle: '1.23', eol: '2027-01-01' }] } };
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'go.mod'), 'module x\n\ngo 1.23\n\ntoolchain go1.23\n');
    const r = scan(dir, snap, new Date(NOW));
    assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [] }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a runtime.txt python-3.11 as supported and produces no results', () => {
  const r = run({ 'runtime.txt': 'python-3.11\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [{ file: "runtime.txt", line: 1, product: "python", version: "3.11" }] }, results: [] }] });
});

test('reports a .node-version v23 as supported and produces no results', () => {
  const r = run({ '.node-version': 'v23\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [{ file: ".node-version", line: 1, product: "nodejs", version: "v23" }] }, results: [] }] });
});

test('reports a Dockerfile FROM node:23 as supported and produces no results', () => {
  const r = run({ 'Dockerfile': 'FROM node:23\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [{ file: "Dockerfile", line: 1, product: "nodejs", version: "23" }] }, results: [] }] });
});

test('reports a compose image node:23 as supported and produces no results', () => {
  const r = run({ 'docker-compose.yml': 'services:\n  app:\n    image: node:23\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [{ file: "docker-compose.yml", line: 3, product: "nodejs", version: "23" }] }, results: [] }] });
});

test('reports a package.json engines.node 23 as supported and produces no results', () => {
  const r = run({ 'package.json': '{\n  "name": "x",\n  "engines": {\n    "node": "23"\n  }\n}\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [{ file: "package.json", line: 4, product: "nodejs", version: "23" }] }, results: [] }] });
});

test('reports a .tool-versions node 23 as supported and produces no results', () => {
  const r = run({ '.tool-versions': 'nodejs 23\n' });
  assert.deepEqual(r, { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "commitwork-eol", rules: [] } }, invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }], properties: { snapshotFetched: "2025-06-01", asOf: "2025-06-15", undetermined: [{ file: ".tool-versions", line: 1, product: "nodejs", version: "23" }] }, results: [] }] });
});

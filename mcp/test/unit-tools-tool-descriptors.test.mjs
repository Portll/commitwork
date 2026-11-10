// Frozen map from each MCP tool name to its descriptor of name, description and input schema (mcp/tools.mjs toolDescriptors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolDescriptors } from '../tools.mjs';

const EMPTY = { type: 'object', properties: {}, additionalProperties: false };

function runSchema(manifests) {
  return {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'absolute path to the repo to check' },
      group: { type: 'string', description: 'quick | standard | all | fast | \u2026 (default quick)' },
      manifest: { type: 'string', description: `bundled manifest name (default security-baseline). One of: ${manifests}` },
    },
    required: ['repo'],
    additionalProperties: false,
  };
}

test('returns a frozen map of the nineteen tools in declaration order with frozen descriptors', () => {
  const r = toolDescriptors();
  assert.deepEqual(Object.keys(r), [
    'list_products', 'coverage', 'open_cases', 'poam', 'findings', 'readiness',
    'run_checks', 'run_checks_start', 'run_checks_result', 'issues_ready', 'issue_claim',
    'issue_close', 'issue_dispositions', 'issue_judge', 'turn_efficiency', 'code_about',
    'code_blast_radius', 'code_dead_exports', 'graph_neighbours',
  ]);
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.poam), true);
  assert.equal(Object.isFrozen(r.poam.inputSchema), false);
  assert.deepEqual(Object.keys(r.poam), ['name', 'description', 'inputSchema']);
  assert.equal(r.poam.name, 'poam');
});

test('tools without parameters take an empty object schema that forbids extra properties', () => {
  const r = toolDescriptors();
  assert.deepEqual(r.list_products.inputSchema, EMPTY);
  assert.deepEqual(r.open_cases.inputSchema, EMPTY);
  assert.deepEqual(r.code_dead_exports.inputSchema, EMPTY);
});

test('run_checks and run_checks_start list the bundled manifests in the manifest description', () => {
  const r = toolDescriptors({ bundledManifests: ['security-baseline', 'supply-chain'] });
  assert.deepEqual(r.run_checks.inputSchema, runSchema('security-baseline, supply-chain'));
  assert.deepEqual(r.run_checks_start.inputSchema, runSchema('security-baseline, supply-chain'));
  const d = toolDescriptors();
  assert.deepEqual(d.run_checks.inputSchema, runSchema(''));
  assert.deepEqual(d.run_checks_start.inputSchema, runSchema(''));
});

test('run_checks_result describes job states, retention and the jobId schema', () => {
  const r = toolDescriptors();
  assert.equal(r.run_checks_result.description, 'Collect a run_checks_start job: `state` is queued | running | done | failed | interrupted. `done` carries a run_checks result whose gate is PASS or FAIL; `failed` carries `reason` (and `result` with gate ERROR, plus the runner log tail, when the runner got that far); `interrupted` means the server stopped or exited before the job finished, says why in `reason`, and the job is never re-run \u2014 treat anything but a done PASS as not-safe. A job from an earlier server process is answered from the job store with `restored: true`, without the log tail or matched text. `injection` records prompt-injection-shaped text seen in the inputs and the run output: descriptive, never a severity; each signal carries a `span` hash, and `ledger.rows` counts the rows written to the emission ledger for it. Finished jobs are kept for CW_MCP_JOB_RETAIN_MS (default 1 h) and at most CW_MCP_JOB_RETAIN (default 50); an expired id says so.');
  assert.deepEqual(r.run_checks_result.inputSchema, {
    type: 'object',
    properties: { jobId: { type: 'string', description: 'the jobId run_checks_start returned' } },
    required: ['jobId'],
    additionalProperties: false,
  });
});

test('issues_ready and turn_efficiency take optional parameters and forbid extra properties', () => {
  const r = toolDescriptors();
  assert.deepEqual(r.issues_ready.inputSchema, {
    type: 'object',
    properties: { area: { type: 'string', description: 'area slug (e.g. commitwork)' } },
    additionalProperties: false,
  });
  assert.deepEqual(r.turn_efficiency.inputSchema, {
    type: 'object',
    properties: { session: { type: 'string' }, limit: { type: 'number' } },
    additionalProperties: false,
  });
});

test('issue_close copies closedAs into its as enum and defaults to an empty enum', () => {
  const closedAs = ['refuted', 'superseded'];
  const r = toolDescriptors({ closedAs });
  assert.deepEqual(r.issue_close.inputSchema, {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ISS-XXXXXX' },
      as: { type: 'string', enum: ['refuted', 'superseded'] },
      evidence: { type: 'string', description: 'what you verified \u2014 a close without evidence is an assertion' },
      sessionId: { type: 'string' },
    },
    required: ['id', 'as', 'evidence'],
    additionalProperties: false,
  });
  assert.notStrictEqual(r.issue_close.inputSchema.properties.as.enum, closedAs);
  assert.deepEqual(toolDescriptors().issue_close.inputSchema.properties.as.enum, []);
});

test('issue_judge describes the return path and embeds dispositions and the rescan none word', () => {
  const r = toolDescriptors({ dispositions: ['false-positive', 'remediated'], rescanNone: 'skip' });
  assert.equal(r.issue_judge.description, 'THE RETURN PATH: push a human judgement back at a finding \u2014 false-positive, remediated, or not-applicable \u2014 and name the re-scan that should verify it. The finding is NEVER deleted and never closed as `fixed`: the ruling is appended with who/when/why and the issue stays visible as human-greened. Suppressing rulings (false-positive / not-applicable) EXPIRE, and every ruling is invalidated automatically once the thing it judged changes (a version bump, an anchored line edit, a re-score). `remediated` does NOT suppress \u2014 it is a claim awaiting scan evidence. Identity is MANDATORY: pass `by` (you) and `authorizedBy` (the person who asked for this). An MCP ingest is recorded as MACHINE-attributed by construction, whatever names it supplies.');
  assert.deepEqual(r.issue_judge.inputSchema.properties.disposition, { type: 'string', enum: ['false-positive', 'remediated'] });
  assert.equal(r.issue_judge.inputSchema.properties.rescan.description, "re-scan depth \u2014 REQUIRED, no default is picked for you. A sweep group (all | fast | supply-chain | deep), a single check id, or 'skip'.");
  assert.equal(toolDescriptors().issue_judge.inputSchema.properties.rescan.description, "re-scan depth \u2014 REQUIRED, no default is picked for you. A sweep group (all | fast | supply-chain | deep), a single check id, or 'none'.");
  assert.deepEqual(r.issue_judge.inputSchema.required, ['id', 'disposition', 'reason', 'rescan', 'by', 'authorizedBy']);
  assert.equal(r.issue_judge.inputSchema.additionalProperties, false);
});

test('code_blast_radius requires path and allows maxDepth from 1', () => {
  const r = toolDescriptors();
  assert.deepEqual(r.code_blast_radius.inputSchema, {
    type: 'object',
    properties: { path: { type: 'string' }, maxDepth: { type: 'integer', minimum: 1 } },
    required: ['path'],
    additionalProperties: false,
  });
});

test('graph_neighbours describes node ids and relations and bounds depth from 1 to 4', () => {
  const r = toolDescriptors();
  assert.equal(r.graph_neighbours.description, 'Findings, lanes, repositories, areas, weakness classes and sessions as one graph: every node within `depth` hops of `id` (both directions), optionally along one relation. Ids are <kind>:<key> \u2014 finding:ISS-\u2026, lane:<category>, repo:<name>, area:<slug>, class:<weakness class>, session:<hash>. Relations: found-by, in-repo, in-area, covers, ran-on, claimed. `graph.status` says which edge kinds were built and why any were not; an edge kind not built is unknown, not empty. Rebuilds the store first when its inputs changed. Read-only over the sources.');
  assert.deepEqual(r.graph_neighbours.inputSchema, {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'a node id, e.g. repo:example-service' },
      rel: { type: 'string', description: 'follow only this relation' },
      depth: { type: 'integer', minimum: 1, maximum: 4 },
    },
    required: ['id'],
    additionalProperties: false,
  });
});

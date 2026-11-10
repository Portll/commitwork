// Pools every declared area's defect-signature artifact from the registry into one fleet artifact (monitor/defect-signature.mjs gatherFleetSignatures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherFleetSignatures } from '../defect-signature.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ENV_KEYS = ['CW_DEFECT_SIGNATURE_RATE', 'CW_DEFECT_SIGNATURE_MIN_REPOS'];
const CONSOLE_KEYS = ['log', 'info', 'warn', 'error', 'debug'];
const NOTE = 'A detector positive on this share of the repositories it scanned is a defect signature in the detector, '
  + 'not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. '
  + 'rate and population are fields to read, never factors to multiply. '
  + "Pooled over every declared area's artifact; the population floor applies to this pooled population.";

function capture(fn) {
  const out = [];
  const sink = (...a) => { out.push(a.map(String).join(' ')); return true; };
  const keep = { stdout: process.stdout.write, stderr: process.stderr.write, emitWarning: process.emitWarning };
  const cons = Object.fromEntries(CONSOLE_KEYS.map((k) => [k, console[k]]));
  process.stdout.write = sink;
  process.stderr.write = sink;
  process.emitWarning = sink;
  for (const k of CONSOLE_KEYS) console[k] = sink;
  try {
    return { value: fn(), out: out.join('') };
  } finally {
    process.stdout.write = keep.stdout;
    process.stderr.write = keep.stderr;
    process.emitWarning = keep.emitWarning;
    for (const k of CONSOLE_KEYS) console[k] = cons[k];
  }
}

function run(opts, vars = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gatherFleetSignatures-'));
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    return capture(() => gatherFleetSignatures(opts));
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

const expectedArtifact = (at, thresholds) => ({
  at,
  scope: 'fleet',
  note: NOTE,
  thresholds,
  areas: { declared: 4, read: 0, absent: 4, failed: 0 },
  pooledFrom: [],
  population: {},
  detectors: [],
  signatures: [],
  undetermined: [],
  unkeyed: {},
  registry: 'example',
});

test('loads the registry quietly without writing anything to stdout or stderr', () => {
  const { out } = run({ at: '2024-01-01T00:00:00.000Z' });
  assert.equal(out, '');
});

test('pools the example registry into an empty fleet artifact with every declared area absent', () => {
  const { value, out } = run({ at: '2024-01-01T00:00:00.000Z' });
  assert.equal(out, '');
  assert.deepEqual(value.artifact, expectedArtifact('2024-01-01T00:00:00.000Z', { rate: 0.95, minRepos: 20 }));
});

test('returns the loaded example registry alongside the artifact', () => {
  const { value, out } = run({ at: '2024-01-01T00:00:00.000Z' });
  assert.equal(out, '');
  assert.equal(value.reg.$schema, '../schema/projects.schema.json');
  assert.equal(value.reg.areas.length, 4);
  assert.equal(value.reg.areas[0].slug, 'example-area');
  assert.equal(value.reg.areas[0].out, 'example-area');
  assert.deepEqual(value.reg.areas[0].members, ['example-service']);
  assert.deepEqual(value.reg.areas[0].prefixes, ['ex-']);
  assert.equal(value.reg.areas[0].primary, true);
  assert.equal(value.reg.areas[1].slug, 'example-corpus');
  assert.equal(value.reg.areas[1].cadenceMs, 604800000);
  assert.equal(value.reg.areas[1].thirdParty, true);
});

test('keeps an explicit null at instead of falling back to the clock', () => {
  const { value, out } = run({ at: null });
  assert.equal(out, '');
  assert.deepEqual(value.artifact, expectedArtifact(null, { rate: 0.95, minRepos: 20 }));
});

test('passes a caller-supplied at string through unchanged', () => {
  const { value, out } = run({ at: '2030-05-06T07:08:09.010Z' });
  assert.equal(out, '');
  assert.equal(value.artifact.at, '2030-05-06T07:08:09.010Z');
});

test('takes rate and minRepos from the environment at their inclusive bounds', () => {
  const { value, out } = run({ at: '2024-01-01T00:00:00.000Z' }, {
    CW_DEFECT_SIGNATURE_RATE: '1',
    CW_DEFECT_SIGNATURE_MIN_REPOS: '1',
  });
  assert.equal(out, '');
  assert.deepEqual(value.artifact, expectedArtifact('2024-01-01T00:00:00.000Z', { rate: 1, minRepos: 1 }));
});

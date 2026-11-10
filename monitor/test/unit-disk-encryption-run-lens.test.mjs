// Per-volume disk encryption state checked against the declared baseline (monitor/disk-encryption.mjs runLens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLens } from '../disk-encryption.mjs';
import { loadBaseline } from '../disk-encryption.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';

delete process.env.CW_FDE_BASELINE;
const SHIPPED = loadBaseline();
const AT = '2024-01-01T00:00:00.000Z';
const KEYS = ['CW_FDE_BASELINE', 'CW_FDE_PLATFORM', 'CW_NOW', 'PATH'];
const CRYPT = 'dm-crypt/LUKS mapping present';
const PLAIN = 'no crypt-type device-mapper node';
const declared = (volume) => ({ ...SHIPPED.required[0], volume });
const row = (volume, state, detail) => ({ ...declared(volume), state, detail });

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'runLens-'));
  const saved = KEYS.map((k) => [k, process.env[k]]);
  try {
    return fn(dir);
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function baseline(dir, volumes) {
  const p = join(dir, 'baseline.json');
  writeFileSync(p, JSON.stringify({ ...SHIPPED, required: volumes.map(declared) }));
  process.env.CW_FDE_BASELINE = p;
}

function linux(dir, lines) {
  writeFileSync(join(dir, 'lsblk'), `#!/bin/sh\ncat <<'EOF'\n${lines.join('\n')}\nEOF\n`, { mode: 0o755 });
  process.env.PATH = `${dir}${delimiter}${process.env.PATH}`;
  process.env.CW_FDE_PLATFORM = 'linux';
}

test('a missing baseline file reports no-reference and takes its time stamp from CW_NOW', () => {
  inDir((dir) => {
    const p = resolve(join(dir, 'missing.json'));
    process.env.CW_FDE_BASELINE = p;
    process.env.CW_NOW = '2020-02-02T02:02:02.000Z';
    assert.deepEqual(runLens(), {
      at: '2020-02-02T02:02:02.000Z', unknown: true, unknownReason: 'no-reference',
      unknownDetail: `no FDE baseline at ${p} \u2014 nothing declares what this fleet requires`,
      rows: [], findings: [],
    });
  });
});

test('an empty baseline file reports unparseable with the JSON parser error', () => {
  inDir((dir) => {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, '');
    process.env.CW_FDE_BASELINE = p;
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, unknown: true, unknownReason: 'unparseable',
      unknownDetail: 'baseline did not parse: Unexpected end of JSON input',
      rows: [], findings: [],
    });
  });
});

test('a baseline path that is a directory reports not-permitted with the error code', () => {
  inDir((dir) => {
    const p = resolve(dir);
    process.env.CW_FDE_BASELINE = p;
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, unknown: true, unknownReason: 'not-permitted',
      unknownDetail: `cannot read ${p}: EISDIR`,
      rows: [], findings: [],
    });
  });
});

test('a platform without an adapter still lists every required volume as unknown', () => {
  inDir((dir) => {
    baseline(dir, ['root']);
    process.env.CW_FDE_PLATFORM = 'plan9';
    const detail = "no FDE adapter for platform 'plan9' \u2014 this box is unmeasured, which is not the same as compliant";
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, unknown: true, unknownReason: 'not-run', unknownDetail: detail, platform: 'plan9',
      rows: [row('root', 'unknown', detail)], findings: [],
    });
  });
});

test('an encrypted required volume with nothing undeclared is ok', () => {
  inDir((dir) => {
    baseline(dir, ['root']);
    linux(dir, ['sda disk', 'cryptroot crypt']);
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, platform: 'linux', unknown: false,
      rows: [row('root', 'protected', CRYPT)],
      undeclared: [], findings: [], state: 'ok',
    });
  });
});

test('an unencrypted required volume is a finding', () => {
  inDir((dir) => {
    baseline(dir, ['root']);
    linux(dir, ['sda disk', 'sda1 part']);
    const bad = row('root', 'UNPROTECTED', PLAIN);
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, platform: 'linux', unknown: false,
      rows: [bad], undeclared: [], findings: [bad], state: 'findings',
    });
  });
});

test('a required volume the probe did not report makes the result grey', () => {
  inDir((dir) => {
    baseline(dir, ['root', 'system']);
    linux(dir, ['sda disk', 'cryptroot crypt']);
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, platform: 'linux', unknown: false,
      rows: [
        row('root', 'protected', CRYPT),
        row('system', 'unknown', "the probe reported no volume 'system'"),
      ],
      undeclared: [], findings: [], state: 'grey',
    });
  });
});

test('a probed volume that no baseline row claims is listed as undeclared and grey', () => {
  inDir((dir) => {
    baseline(dir, ['system']);
    linux(dir, ['sda disk', 'cryptroot crypt']);
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, platform: 'linux', unknown: false,
      rows: [row('system', 'unknown', "the probe reported no volume 'system'")],
      undeclared: [{ volume: 'root', encrypted: true, detail: CRYPT }],
      findings: [], state: 'grey',
    });
  });
});

test('findings take precedence over grey rows', () => {
  inDir((dir) => {
    baseline(dir, ['root', 'system']);
    linux(dir, ['sda disk', 'sda1 part']);
    const bad = row('root', 'UNPROTECTED', PLAIN);
    assert.deepEqual(runLens({ at: AT }), {
      at: AT, platform: 'linux', unknown: false,
      rows: [bad, row('system', 'unknown', "the probe reported no volume 'system'")],
      undeclared: [], findings: [bad], state: 'findings',
    });
  });
});

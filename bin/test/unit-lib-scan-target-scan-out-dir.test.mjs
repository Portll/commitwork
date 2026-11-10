// The private directory a path scan writes to, or why it refuses one (bin/lib/scan-target.mjs scanOutDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanOutDir } from '../lib/scan-target.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEYS = ['CW_SCAN_PATH_OUT', 'CW_SIDECAR'];
const TAIL = ". Scan output is private and is never written into the checkout's reports/; set CW_SCAN_PATH_OUT to an existing private directory";
const refused = (why, sidecar) => `refusing to start a scan: ${why}${TAIL}${sidecar === undefined ? '' : ` or create the sidecar at ${sidecar} (CW_SIDECAR)`}`;

function inTmp(fn) {
  const saved = KEYS.map((k) => process.env[k]);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'scanOutDir-')));
  try {
    for (const k of KEYS) delete process.env[k];
    fn(dir);
  } finally {
    KEYS.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a relative CW_SCAN_PATH_OUT is refused and its dir is the path as given', () => {
  inTmp((dir) => {
    process.env.CW_SCAN_PATH_OUT = 'relative/path';
    assert.deepEqual(scanOutDir({ checkout: join(dir, 'checkout') }), {
      ok: false,
      dir: 'relative/path',
      error: refused('CW_SCAN_PATH_OUT is not an absolute path: relative/path'),
    });
  });
});

test('a relative CW_SIDECAR is refused and its dir gains reports/scan-path', () => {
  inTmp((dir) => {
    process.env.CW_SIDECAR = 'relative/sidecar';
    assert.deepEqual(scanOutDir({ checkout: join(dir, 'checkout') }), {
      ok: false,
      dir: 'relative/sidecar/reports/scan-path',
      error: refused('CW_SIDECAR is not an absolute path: relative/sidecar', 'relative/sidecar'),
    });
  });
});

test('a CW_SCAN_PATH_OUT naming a file is refused as not a directory', () => {
  inTmp((dir) => {
    const file = join(dir, 'out.txt');
    writeFileSync(file, 'x');
    process.env.CW_SCAN_PATH_OUT = file;
    assert.deepEqual(scanOutDir({ checkout: join(dir, 'checkout') }), {
      ok: false,
      dir: file,
      error: refused(`${file} is not a directory`),
    });
  });
});

test('a missing CW_SCAN_PATH_OUT is refused with the ENOENT code', () => {
  inTmp((dir) => {
    const out = join(dir, 'missing');
    process.env.CW_SCAN_PATH_OUT = out;
    assert.deepEqual(scanOutDir({ checkout: join(dir, 'checkout') }), {
      ok: false,
      dir: out,
      error: refused(`${out} is not an existing directory (ENOENT)`),
    });
  });
});

test('a directory nested inside the checkout is refused', () => {
  inTmp((dir) => {
    const checkout = join(dir, 'checkout');
    const out = join(checkout, 'inside');
    mkdirSync(out, { recursive: true });
    process.env.CW_SCAN_PATH_OUT = out;
    assert.deepEqual(scanOutDir({ checkout }), {
      ok: false,
      dir: out,
      error: refused(`${out} is inside the commitwork checkout ${checkout}`),
    });
  });
});

test('the checkout itself is refused as the output directory', () => {
  inTmp((dir) => {
    const checkout = join(dir, 'checkout');
    mkdirSync(checkout);
    process.env.CW_SCAN_PATH_OUT = checkout;
    assert.deepEqual(scanOutDir({ checkout }), {
      ok: false,
      dir: checkout,
      error: refused(`${checkout} is inside the commitwork checkout ${checkout}`),
    });
  });
});

test('a sibling whose name only starts with the checkout name is accepted and CW_SCAN_PATH_OUT wins over CW_SIDECAR', () => {
  inTmp((dir) => {
    const checkout = join(dir, 'checkout');
    const out = join(dir, 'checkout2');
    const side = join(dir, 'side');
    for (const d of [checkout, out, side]) mkdirSync(d);
    process.env.CW_SCAN_PATH_OUT = out;
    process.env.CW_SIDECAR = side;
    assert.deepEqual(scanOutDir({ checkout }), { ok: true, base: out, dir: out });
  });
});

test('with neither variable set the sidecar next to the checkout is used under reports/scan-path', () => {
  inTmp((dir) => {
    const side = join(dir, 'commitwork-sidecar');
    mkdirSync(side);
    assert.deepEqual(scanOutDir({ checkout: join(dir, 'checkout') }), {
      ok: true,
      base: side,
      dir: join(side, 'reports', 'scan-path'),
    });
  });
});

test('with neither variable set a missing sidecar is refused and the message names it', () => {
  inTmp((dir) => {
    const side = join(dir, 'commitwork-sidecar');
    assert.deepEqual(scanOutDir({ checkout: join(dir, 'checkout') }), {
      ok: false,
      dir: join(side, 'reports', 'scan-path'),
      error: refused(`${side} is not an existing directory (ENOENT)`, side),
    });
  });
});

test('CW_SIDECAR overrides the default sidecar next to the checkout', () => {
  inTmp((dir) => {
    const side = join(dir, 'elsewhere');
    mkdirSync(side);
    mkdirSync(join(dir, 'commitwork-sidecar'));
    process.env.CW_SIDECAR = side;
    assert.deepEqual(scanOutDir({ checkout: join(dir, 'checkout') }), {
      ok: true,
      base: side,
      dir: join(side, 'reports', 'scan-path'),
    });
  });
});

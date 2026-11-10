// Null when the web root path exists, otherwise a missing-input message naming that path (lib/web-root.mjs missingWebRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingWebRoot } from '../web-root.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const message = (root) => `missing input: the commitwork-web we/ pages are not at ${root}; check out Portll/commitwork-web beside this repository or set CW_WEB_ROOT to its we/public`;

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'missingWebRoot-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const withEnv = (value, fn) => {
  const saved = process.env.CW_WEB_ROOT;
  process.env.CW_WEB_ROOT = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.CW_WEB_ROOT;
    else process.env.CW_WEB_ROOT = saved;
  }
};

test('returns null when the root directory exists', () => {
  withDir((dir) => {
    const root = join(dir, 'we', 'public');
    mkdirSync(root, { recursive: true });
    assert.equal(missingWebRoot(root), null);
  });
});

test('returns the missing-input message naming a nested root that does not exist', () => {
  withDir((dir) => {
    const root = join(dir, 'no', 'such', 'dir');
    assert.equal(missingWebRoot(root), message(root));
  });
});

test('returns null when the root path is an existing regular file', () => {
  withDir((dir) => {
    const root = join(dir, 'afile.txt');
    writeFileSync(root, 'x');
    assert.equal(missingWebRoot(root), null);
  });
});

test('keeps a trailing slash on a missing root verbatim in the message', () => {
  withDir((dir) => {
    const root = join(dir, 'trailing', 'slash') + '/';
    assert.equal(missingWebRoot(root), message(root));
  });
});

test('returns null when the root is a symlink to an existing directory', () => {
  withDir((dir) => {
    const target = join(dir, 'target');
    const link = join(dir, 'link');
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link);
    assert.equal(missingWebRoot(link), null);
  });
});

test('returns the message when the root is a symlink whose target is missing', () => {
  withDir((dir) => {
    const link = join(dir, 'dangling');
    symlinkSync(join(dir, 'gone'), link);
    assert.equal(missingWebRoot(link), message(link));
  });
});

test('returns the message with a long missing directory name in full', () => {
  withDir((dir) => {
    const root = join(dir, 'x'.repeat(200));
    assert.equal(missingWebRoot(root), message(root));
  });
});

test('defaults to CW_WEB_ROOT and returns null when that directory exists', () => {
  withDir((dir) => {
    const root = join(dir, 'public');
    mkdirSync(root, { recursive: true });
    withEnv(root, () => {
      assert.equal(missingWebRoot(), null);
    });
  });
});

test('defaults to CW_WEB_ROOT and names it in the message when it is missing', () => {
  withDir((dir) => {
    const root = join(dir, 'absent');
    withEnv(root, () => {
      assert.equal(missingWebRoot(), message(root));
    });
  });
});

test('resolves dot-dot segments in CW_WEB_ROOT before naming the missing root', () => {
  withDir((dir) => {
    withEnv(`${dir}/a/../absent`, () => {
      assert.equal(missingWebRoot(), message(join(dir, 'absent')));
    });
  });
});

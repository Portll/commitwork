// Credential store paths under a home directory, each followed by its symlink-resolved real path, deduplicated (bin/lib/scan-target.mjs credentialStores).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialStores } from '../lib/scan-target.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SEGS = ['.ssh', '.aws', '.gnupg', '.docker', '.kube', 'Keychains', '.netrc'];
const DECL = ['.config/gh', '.config/gcloud', '.azure', '.git-credentials', '.npmrc', '.pypirc', '.cargo/credentials', '.cargo/credentials.toml'];
const stores = (h) => [...SEGS.map((s) => `${h}/${s}`), `${h}/Library/Keychains`, '/Library/Keychains', ...DECL.map((s) => `${h}/${s}`)];

const inDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'credentialStores-'));
  try {
    fn(dir, realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('An existing home directory yields every store under its real path', () => {
  inDir((dir, base) => {
    mkdirSync(join(dir, 'home'));
    assert.deepEqual(credentialStores(join(dir, 'home')), stores(`${base}/home`));
  });
});

test('A symlinked home directory is replaced by the directory it points to', () => {
  inDir((dir, base) => {
    mkdirSync(join(dir, 'realhome'));
    symlinkSync(join(dir, 'realhome'), join(dir, 'linkhome'));
    assert.deepEqual(credentialStores(join(dir, 'linkhome')), stores(`${base}/realhome`));
  });
});

test('A home that does not exist is used exactly as given', () => {
  inDir((dir) => {
    const home = join(dir, 'missing');
    assert.deepEqual(credentialStores(home), stores(home));
  });
});

test('A missing home with a trailing slash keeps the slash and produces double slashes', () => {
  inDir((dir) => {
    const home = `${join(dir, 'missing')}/`;
    const r = credentialStores(home);
    assert.equal(r[0], `${dir}/missing//.ssh`);
    assert.deepEqual(r, stores(home));
  });
});

test('An existing home with a trailing slash is normalised by resolving its real path', () => {
  inDir((dir, base) => {
    mkdirSync(join(dir, 'home'));
    assert.deepEqual(credentialStores(`${join(dir, 'home')}/`), stores(`${base}/home`));
  });
});

test('A home that is a regular file still yields the unresolved store paths beneath it', () => {
  inDir((dir, base) => {
    writeFileSync(join(dir, 'homefile'), 'x');
    assert.deepEqual(credentialStores(join(dir, 'homefile')), stores(`${base}/homefile`));
  });
});

test('A store that is a symlink is followed by its real target', () => {
  inDir((dir, base) => {
    const h = `${base}/home`;
    mkdirSync(join(dir, 'home'));
    mkdirSync(join(dir, 'keys'));
    symlinkSync(join(dir, 'keys'), join(dir, 'home', '.ssh'));
    const want = stores(h);
    want.splice(1, 0, `${base}/keys`);
    assert.deepEqual(credentialStores(join(dir, 'home')), want);
  });
});

test('A store linking to a later store moves that later store up to its first appearance', () => {
  inDir((dir, base) => {
    const h = `${base}/home`;
    mkdirSync(join(dir, 'home', '.config', 'gh'), { recursive: true });
    symlinkSync(join(dir, 'home', '.config', 'gh'), join(dir, 'home', '.netrc'));
    const want = stores(h).filter((p) => p !== `${h}/.config/gh`);
    want.splice(7, 0, `${h}/.config/gh`);
    assert.equal(want.length, 17);
    assert.deepEqual(credentialStores(join(dir, 'home')), want);
  });
});

test('A store linking to an earlier store adds no duplicate entry', () => {
  inDir((dir, base) => {
    const h = `${base}/home`;
    mkdirSync(join(dir, 'home'));
    writeFileSync(join(dir, 'home', '.aws'), 'k');
    symlinkSync(join(dir, 'home', '.aws'), join(dir, 'home', '.npmrc'));
    const r = credentialStores(join(dir, 'home'));
    assert.equal(r.length, 17);
    assert.deepEqual(r, stores(h));
  });
});

test('A symlinked parent directory resolves only the stores that exist inside it', () => {
  inDir((dir, base) => {
    const h = `${base}/home`;
    mkdirSync(join(dir, 'home'));
    mkdirSync(join(dir, 'cfg', 'gh'), { recursive: true });
    symlinkSync(join(dir, 'cfg'), join(dir, 'home', '.config'));
    const want = stores(h);
    want.splice(10, 0, `${base}/cfg/gh`);
    assert.deepEqual(credentialStores(join(dir, 'home')), want);
  });
});

// The outside-repo symlink targets a sandbox may read, and the links it refuses (bin/lib/sandbox.mjs symlinkReads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkReads } from '../lib/sandbox.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'symlinkReads-'));
  try { fn(realpathSync(dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const dirs = (...ps) => { for (const p of ps) mkdirSync(p, { recursive: true }); };

test('a repository with only plain files and directories yields no reads and no refusals', () => {
  withDir((base) => {
    const repo = join(base, 'repo');
    dirs(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.txt'), 'a');
    assert.deepEqual(symlinkReads(repo, [], { home: '' }), { reads: [], refused: [] });
  });
});

test('links to the repository and inside it are skipped while a sibling sharing its name prefix is read', () => {
  withDir((base) => {
    const repo = join(base, 'repo');
    dirs(join(repo, 'sub'), join(base, 'repo2'));
    symlinkSync(repo, join(repo, 'self'));
    symlinkSync(join(repo, 'sub'), join(repo, 'inner'));
    symlinkSync(join(base, 'repo2'), join(repo, 'sibling'));
    assert.deepEqual(symlinkReads(repo, [], { home: '' }), { reads: [join(base, 'repo2')], refused: [] });
  });
});

test('reads are deduplicated and sorted, found at any depth, and skipped dirs and broken links add nothing', () => {
  withDir((base) => {
    const repo = join(base, 'repo');
    dirs(join(repo, 'deep', 'er'), join(repo, 'node_modules'), join(repo, '.git'), join(base, 'a'), join(base, 'b'), join(base, 'c'));
    symlinkSync(join(base, 'b'), join(repo, 'deep', 'er', 'one'));
    symlinkSync(join(base, 'a'), join(repo, 'two'));
    symlinkSync(join(base, 'b'), join(repo, 'three'));
    symlinkSync(join(base, 'c'), join(repo, 'node_modules', 'four'));
    symlinkSync(join(base, 'c'), join(repo, '.git', 'five'));
    symlinkSync(join(base, 'missing'), join(repo, 'broken'));
    assert.deepEqual(symlinkReads(repo, [], { home: '' }), { reads: [join(base, 'a'), join(base, 'b')], refused: [] });
  });
});

test('a link to the home directory is refused as overlapping its first credential store', () => {
  withDir((base) => {
    const repo = join(base, 'repo');
    const home = join(base, 'home');
    dirs(repo, home);
    symlinkSync(home, join(repo, 'link'));
    assert.deepEqual(symlinkReads(repo, [], { home }), {
      reads: [],
      refused: [`${repo}/link -> ${home}: it overlaps the credential store ${home}/.ssh`],
    });
  });
});

test('a link to a declarable store is refused naming that exact store, not one sharing its prefix', () => {
  withDir((base) => {
    const home = join(base, 'home');
    const a = join(base, 'a');
    const b = join(base, 'b');
    dirs(a, b, join(home, '.config', 'gh'), join(home, '.cargo'));
    writeFileSync(join(home, '.cargo', 'credentials.toml'), 'token');
    symlinkSync(join(home, '.config', 'gh'), join(a, 'link'));
    symlinkSync(join(home, '.cargo', 'credentials.toml'), join(b, 'link'));
    assert.deepEqual(symlinkReads(a, [], { home }), {
      reads: [],
      refused: [`${a}/link -> ${home}/.config/gh: it overlaps the credential store ${home}/.config/gh`],
    });
    assert.deepEqual(symlinkReads(b, [], { home }), {
      reads: [],
      refused: [`${b}/link -> ${home}/.cargo/credentials.toml: it overlaps the credential store ${home}/.cargo/credentials.toml`],
    });
  });
});

test('a link into a forbidden segment is refused for its credential material with or without a home', () => {
  withDir((base) => {
    const home = join(base, 'home');
    const a = join(base, 'a');
    const b = join(base, 'b');
    dirs(a, b, join(home, '.ssh'), join(base, 'other', '.aws'));
    symlinkSync(join(home, '.ssh'), join(a, 'link'));
    symlinkSync(join(base, 'other', '.aws'), join(b, 'link'));
    assert.deepEqual(symlinkReads(a, [], { home }), {
      reads: [],
      refused: [`${a}/link -> ${home}/.ssh: it contains credential material (.ssh)`],
    });
    assert.deepEqual(symlinkReads(b, [], { home: '' }), {
      reads: [],
      refused: [`${b}/link -> ${base}/other/.aws: it contains credential material (.aws)`],
    });
  });
});

test('extra reads expand home and repo prefixes, follow only symlinks, skip missing paths and reach skipped dirs', () => {
  withDir((base) => {
    const repo = join(base, 'repo');
    const home = join(base, 'home');
    dirs(join(repo, 'dist'), join(home, 'docs'), join(base, 'data'), join(base, 'built'));
    symlinkSync(join(base, 'data'), join(home, 'ln'));
    symlinkSync(join(base, 'built'), join(repo, 'dist', 'out'));
    const r = symlinkReads(repo, ['~/ln', '~/docs', '~/missing', './dist/out'], { home });
    assert.deepEqual(r, { reads: [join(base, 'built'), join(base, 'data')], refused: [] });
  });
});

test('home is resolved through a symlink, and a home that cannot be resolved still guards its given path', () => {
  withDir((base) => {
    const a = join(base, 'a');
    const b = join(base, 'b');
    const home = join(base, 'home');
    dirs(a, b, join(home, '.config', 'gcloud'));
    symlinkSync(home, join(base, 'homelink'));
    symlinkSync(join(home, '.config', 'gcloud'), join(a, 'link'));
    symlinkSync(base, join(b, 'link'));
    assert.deepEqual(symlinkReads(a, [], { home: join(base, 'homelink') }), {
      reads: [],
      refused: [`${a}/link -> ${home}/.config/gcloud: it overlaps the credential store ${home}/.config/gcloud`],
    });
    assert.deepEqual(symlinkReads(b, [], { home: join(base, 'nohome') }), {
      reads: [],
      refused: [`${b}/link -> ${base}: it overlaps the credential store ${base}/nohome/.ssh`],
    });
  });
});

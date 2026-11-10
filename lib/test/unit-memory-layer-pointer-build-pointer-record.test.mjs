// A pointer record that locates files by repo, commit and path, plus a check of what survives summarising (lib/memory-layer-pointer.mjs buildPointerRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPointerRecord } from '../memory-layer-pointer.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPointerRecord-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const put = (dir, name, data) => {
  const f = join(dir, name);
  writeFileSync(f, data);
  const sha256 = createHash('sha256').update(data).digest('hex');
  return { f, d: { path: name, bytes: Buffer.byteLength(data), sha256, mtime: statSync(f).mtime.toISOString() } };
};

const gitObject = (gitDir, type, body) => {
  const data = Buffer.concat([Buffer.from(`${type} ${body.length}\x00`), body]);
  const hex = createHash('sha1').update(data).digest('hex');
  mkdirSync(join(gitDir, 'objects', hex.slice(0, 2)), { recursive: true });
  writeFileSync(join(gitDir, 'objects', hex.slice(0, 2), hex.slice(2)), deflateSync(data));
  return hex;
};

const makeRepo = (dir, pushed) => {
  const g = join(dir, '.git');
  mkdirSync(join(g, 'refs', 'heads'), { recursive: true });
  mkdirSync(join(g, 'refs', 'remotes', 'origin'), { recursive: true });
  writeFileSync(join(g, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(g, 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = false\n[remote "origin"]\n\turl = https://example.com/r.git\n');
  const tree = gitObject(g, 'tree', Buffer.alloc(0));
  const sign = 'A <a@example.com> 1700000000 +0000';
  const commit = gitObject(g, 'commit', Buffer.from(`tree ${tree}\nauthor ${sign}\ncommitter ${sign}\n\nm\n`));
  writeFileSync(join(g, 'refs', 'heads', 'main'), `${commit}\n`);
  if (pushed) writeFileSync(join(g, 'refs', 'remotes', 'origin', 'main'), `${commit}\n`);
  return commit;
};

test('a missing repo is rejected before the file list is checked', () => {
  assert.throws(() => buildPointerRecord({ repo: undefined, files: [] }), {
    name: 'Error',
    message: 'buildPointerRecord: repo is required \u2014 a locator without a repository locates nothing',
  });
});

test('an empty file list and a non-array file list are both rejected', () => {
  withDir((dir) => {
    const expected = { name: 'Error', message: 'buildPointerRecord: at least one file is required' };
    assert.throws(() => buildPointerRecord({ repo: dir, files: [] }), expected);
    assert.throws(() => buildPointerRecord({ repo: dir, files: 'a.txt' }), expected);
  });
});

test('a given remote heads the locator and is found in the surviving summary', () => {
  withDir((dir) => {
    const { f } = put(dir, 'a.txt', 'hello');
    const remote = 'git@example.com:o/r.git';
    const r = buildPointerRecord({ repo: dir, files: [f], label: 'L', externalId: 'x1', remote });
    assert.equal(r.origin, remote);
    assert.equal(r.commit, '');
    assert.equal(r.onRemote, false);
    assert.equal(r.record.content.split('\n')[0], `POINTER not content. 1 file(s), 5 bytes, in repo ${remote} at commit UNKNOWN (LOCAL ONLY - not on any remote). Paths: a.txt.`);
    assert.deepEqual(r.verify, { budget: 50, totalWords: 74, survives: { repo: true, commit: true, paths: true }, lostToSummary: true, locatorSurvives: true });
  });
});

test('a remote whose whitespace the summary collapses fails the repo check and so the locator', () => {
  withDir((dir) => {
    const { f } = put(dir, 'a.txt', 'hello');
    const r = buildPointerRecord({ repo: dir, files: [f], label: 'L', remote: 'x\ty' });
    assert.deepEqual(r.verify, { budget: 50, totalWords: 75, survives: { repo: false, commit: true, paths: true }, lostToSummary: true, locatorSurvives: false });
  });
});

test('without a remote or git the repo path, UNKNOWN commit, default label and local-only warning are used', () => {
  withDir((dir) => {
    const a = put(dir, 'a.txt', 'hello');
    const b = put(dir, 'b.txt', 'abc');
    const r = buildPointerRecord({ repo: dir, files: [a.f, b.f], externalId: 'x2' });
    const row = ({ d }) => `  ${d.path}  ${d.bytes} B  sha256:${d.sha256}  mtime:${d.mtime}`;
    const content = [
      `POINTER not content. 2 file(s), 8 bytes, in repo ${dir} at commit UNKNOWN (LOCAL ONLY - not on any remote). Paths: a.txt b.txt.`,
      '',
      'Label: (none)',
      '',
      'The memory layer summarises long records to their first 50 words, so this record deliberately',
      'holds no content. Read the files at the paths above. Verify each against its digest:',
      '',
      row(a),
      row(b),
      '',
      'WARNING: the commit is NOT on any remote. These paths resolve on one machine only.',
    ].join('\n');
    assert.deepEqual(r, {
      record: { external_id: 'x2', content, memory_type: 'Context', tags: ['pointer', 'handoff-locator'] },
      files: [a.d, b.d],
      commit: '',
      origin: '',
      onRemote: false,
      verify: { budget: 50, totalWords: 80, survives: { repo: true, commit: true, paths: true }, lostToSummary: true, locatorSurvives: true },
    });
  });
});

test('a commit on a remote-tracking branch is reported as pushed under the origin url from git', () => {
  withDir((dir) => {
    const commit = makeRepo(dir, true);
    const { f } = put(dir, 'a.txt', 'hello');
    const r = buildPointerRecord({ repo: dir, files: [f], label: 'L' });
    const lines = r.record.content.split('\n');
    assert.equal(r.commit, commit);
    assert.equal(r.origin, 'https://example.com/r.git');
    assert.equal(r.onRemote, true);
    assert.equal(lines[0], `POINTER not content. 1 file(s), 5 bytes, in repo https://example.com/r.git at commit ${commit} (pushed). Paths: a.txt.`);
    assert.equal(lines.at(-1), 'The commit is on a remote, so a fresh clone resolves these paths.');
    assert.deepEqual(r.record.tags, ['pointer', 'handoff-locator', `commit:${commit.slice(0, 12)}`]);
    assert.deepEqual(r.verify, { budget: 50, totalWords: 66, survives: { repo: true, commit: true, paths: true }, lostToSummary: true, locatorSurvives: true });
  });
});

test('a seven-character commit prefix kept by the summary passes while paths pushed past the budget fail the locator', () => {
  withDir((dir) => {
    const commit = makeRepo(dir, false);
    const { f } = put(dir, 'a.txt', 'hello');
    const remote = [commit.slice(0, 7), ...Array.from({ length: 40 }, (_, i) => `w${i}`)].join(' ');
    const r = buildPointerRecord({ repo: dir, files: [f], label: 'L', remote });
    assert.equal(r.commit, commit);
    assert.equal(r.onRemote, false);
    assert.equal(r.record.content.split('\n').at(-1), 'WARNING: the commit is NOT on any remote. These paths resolve on one machine only.');
    assert.deepEqual(r.verify, { budget: 50, totalWords: 114, survives: { repo: true, commit: true, paths: false }, lostToSummary: true, locatorSurvives: false });
  });
});

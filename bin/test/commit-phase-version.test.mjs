// The version stamp: every commit bumps the semver patch in package.json (operator decision
// 2026-09-26). The pure decisions first, then the CLI against real git in scratch repos: all three
// commit paths, the refusals, and the three states the checkout's package.json can be in afterwards.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSemver, bumpPatch, compareSemver, readVersion, setVersion, sameModuloVersion,
  versionStamp, replayStamps, versionFileCollides, worktreeAction, replayVerdict, VERSION_FILE,
} from '../commit-phase-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'commit-phase.mjs');

// Nine lines, the version on line 3 and scripts.test on line 7, so an edit to one and a stamp of
// the other are separate hunks. The description carries a — escape that JSON.stringify would
// not write back, which is what makes a byte-for-byte comparison worth asserting.
const pkg = (version, { test: script = 'true' } = {}) =>
  `{\n  "name": "fixture",\n  "version": "${version}",\n  "private": true,\n  "description": "scratch \\u2014 escaped",\n  "scripts": {\n    "test": "${script}"\n  }\n}\n`;

describe('semver', () => {
  test('parse is strict', () => {
    for (const ok of ['0.1.0', '10.20.30', '1.0.0-rc.1', '1.0.0-alpha.beta+exp.sha.5114f85', '1.2.3+build.7']) {
      assert.ok(parseSemver(ok), ok);
    }
    for (const bad of ['1.2', 'v1.2.3', '01.2.3', '1.02.3', '1.2.3-', '1.2.3-01', '1.2.3.4', '', ' 1.2.3', null, undefined, 123]) {
      assert.equal(parseSemver(bad), null, String(bad));
    }
  });

  test('bumpPatch is npm inc patch', () => {
    assert.equal(bumpPatch('0.1.0'), '0.1.1');
    assert.equal(bumpPatch('0.1.9'), '0.1.10');
    assert.equal(bumpPatch('1.2.3-rc.1'), '1.2.3', 'a prerelease bumps to the release it precedes');
    assert.equal(bumpPatch('1.2.3+build.7'), '1.2.4', 'build metadata is dropped');
    assert.equal(bumpPatch('0.0.9007199254740993'), '0.0.9007199254740994', 'exact past 2^53');
    assert.equal(bumpPatch('latest'), null);
  });

  test('compare follows semver precedence, numerically', () => {
    const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2',
      '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    for (let i = 0; i < order.length - 1; i++) {
      assert.equal(compareSemver(order[i], order[i + 1]), -1, `${order[i]} < ${order[i + 1]}`);
      assert.equal(compareSemver(order[i + 1], order[i]), 1, `${order[i + 1]} > ${order[i]}`);
    }
    assert.equal(compareSemver('0.10.0', '0.9.0'), 1, 'numeric, never lexical');
    assert.equal(compareSemver('1.2.3+a', '1.2.3+b'), 0, 'build metadata has no precedence');
    assert.equal(compareSemver('1.2.3', 'x'), null);
  });
});

describe('the rewrite touches the version token and nothing else', () => {
  test('CRLF, tabs, odd spacing, escapes, nested versions and a missing final newline survive', () => {
    const src = '{\r\n\t"name": "x",\r\n\t"dependencies": { "a": { "version": "9.9.9" } },\r\n\t"version" :  "0.1.0",'
      + '\r\n\t"note": "a \\u2014 b \\"q\\" }{",\r\n\t"list": [1, {"version": "7.7.7"}]\r\n}';
    const out = setVersion(src, '0.1.1');
    assert.equal(out.ok, true, out.why);
    assert.equal(out.text, src.replace('"version" :  "0.1.0"', '"version" :  "0.1.1"'));
    assert.equal(JSON.parse(out.text).dependencies.a.version, '9.9.9', 'a nested version is not the package version');
  });

  test("this repository's own package.json differs from its stamp in the version and nowhere else", () => {
    const text = readFileSync(resolve(HERE, '..', '..', 'package.json'), 'utf8');
    const r = readVersion(text);
    assert.equal(r.ok, true, r.why);
    const next = bumpPatch(r.version);
    const out = setVersion(text, next);
    assert.equal(out.text.replace(`"version": "${next}"`, `"version": "${r.version}"`), text);
    assert.equal(sameModuloVersion(text, out.text), true);
  });

  test('what the reader refuses, and what it does not', () => {
    for (const bad of [null, '{', '[1]', '{"name":"x"}', '{"version":1}', '{"version":"one"}', '{"a":{"version":"1.0.0"}}']) {
      assert.equal(readVersion(bad).ok, false, String(bad));
    }
    assert.match(readVersion('{"version":"0.1.0","version":"0.2.0"}').why, /2 times/, 'a duplicate is ambiguous, never a guess');
    assert.equal(readVersion('{"v\\u0065rsion":"1.2.3"}').version, '1.2.3', 'an escaped key is still the key');
  });
});

describe('versionStamp: bumpPatch(parent), or max with the change set', () => {
  const P = pkg('0.1.5');

  test('no package.json in the change set: the parent bytes with the patch bumped', () => {
    const s = versionStamp({ parentText: P });
    assert.deepEqual([s.ok, s.from, s.version, s.kept], [true, '0.1.5', '0.1.6', false]);
    assert.equal(s.text, pkg('0.1.6'));
  });

  test("the change set's deliberate minor or major bump wins", () => {
    assert.equal(versionStamp({ parentText: P, authorText: pkg('0.2.0') }).version, '0.2.0');
    const s = versionStamp({ parentText: P, authorText: pkg('1.0.0', { test: 'x' }) });
    assert.deepEqual([s.version, s.kept, s.text], ['1.0.0', true, pkg('1.0.0', { test: 'x' })]);
  });

  test("a stale or equal version is raised, and the change set's other bytes are kept", () => {
    const s = versionStamp({ parentText: P, authorText: pkg('0.1.2', { test: 'node --test' }) });
    assert.deepEqual([s.version, s.kept, s.text], ['0.1.6', false, pkg('0.1.6', { test: 'node --test' })]);
    assert.equal(versionStamp({ parentText: P, authorText: pkg('0.1.6') }).version, '0.1.6');
    assert.equal(versionStamp({ parentText: P, authorText: pkg('0.1.6-rc.1') }).version, '0.1.6', 'a prerelease of the bump sorts below it');
  });

  test('a parent without package.json gets no stamp, and a set that adds one keeps its bytes', () => {
    for (const parentText of [null, undefined]) {
      assert.deepEqual(versionStamp({ parentText }), { ok: true, none: true, text: null });
    }
    assert.deepEqual(versionStamp({ parentText: null, authorText: pkg('0.0.1') }), { ok: true, none: true, text: pkg('0.0.1') });
  });

  test('fail closed: a parent that is unparseable or not semver; a set that deletes it or breaks it', () => {
    for (const parentText of ['{ nope', '{"name":"x"}', pkg('latest')]) {
      const s = versionStamp({ parentText });
      assert.equal(s.ok, false, String(parentText));
      assert.match(s.why, /parent commit/);
    }
    assert.match(versionStamp({ parentText: P, authorText: null }).why, /deletes package\.json/);
    assert.match(versionStamp({ parentText: P, authorText: pkg('soon') }).why, /in this change set/);
  });
});

describe('replay: one bump per commit, and when package.json really collides', () => {
  test('version-only steps carry the new parent forward, one bump each', () => {
    const r = replayStamps({ baseText: pkg('0.1.4'), steps: [
      { before: pkg('0.1.0'), after: pkg('0.1.1') },
      { before: pkg('0.1.1'), after: pkg('0.1.2') },
      { before: pkg('0.1.2'), after: pkg('0.1.2') },          // a commit that never touched it
    ] });
    assert.deepEqual(r.stamps.map((s) => s.version), ['0.1.5', '0.1.6', '0.1.7']);
    assert.equal(r.stamps[2].text, pkg('0.1.7'));
  });

  test('a step that changed content keeps its bytes, and its minor bump carries forward', () => {
    const r = replayStamps({ baseText: pkg('0.1.4'), steps: [
      { before: pkg('0.1.0'), after: pkg('0.2.0', { test: 'mine' }) },
      { before: pkg('0.2.0', { test: 'mine' }), after: pkg('0.2.1', { test: 'mine' }) },
    ] });
    assert.deepEqual(r.stamps.map((s) => s.text), [pkg('0.2.0', { test: 'mine' }), pkg('0.2.1', { test: 'mine' })]);
  });

  test('an unstampable base refuses the whole plan and names the commit', () => {
    const r = replayStamps({ baseText: pkg('latest'), steps: [{ before: null, after: null }] });
    assert.deepEqual([r.ok, r.at], [false, 0]);
  });

  test('a collision needs both sides to have changed more than the version', () => {
    const base = pkg('0.1.0');
    const bumpOnly = [{ before: pkg('0.1.0'), after: pkg('0.1.1') }];
    const content = [{ before: pkg('0.1.0'), after: pkg('0.1.1', { test: 'mine' }) }];
    const theirBump = pkg('0.1.3');
    const theirContent = pkg('0.1.3', { test: 'theirs' });
    assert.equal(versionFileCollides({ baseText: base, theirText: theirBump, steps: bumpOnly }), false);
    assert.equal(versionFileCollides({ baseText: base, theirText: theirBump, steps: content }), false);
    assert.equal(versionFileCollides({ baseText: base, theirText: theirContent, steps: bumpOnly }), false);
    assert.equal(versionFileCollides({ baseText: base, theirText: theirContent, steps: content }), true);
    const changeThenRevert = [content[0], { before: pkg('0.1.1', { test: 'mine' }), after: pkg('0.1.2') }];
    assert.equal(versionFileCollides({ baseText: base, theirText: theirContent, steps: changeThenRevert }), true,
      'a change and its revert still assign over theirs on the way through');
  });

  test('replayVerdict: an exempt path does not refuse, and every other overlap still does', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((x) => x.repeat(40));
    const exempt = [VERSION_FILE];
    assert.equal(replayVerdict({ base: a, head: b, commits: [c], mineFiles: ['package.json', 'm'], theirFiles: ['package.json', 't'], exempt }).verdict, 'replay');
    assert.deepEqual(replayVerdict({ base: a, head: b, commits: [c], mineFiles: ['package.json', 's'], theirFiles: ['package.json', 's'], exempt }).overlap, ['s']);
    assert.deepEqual(replayVerdict({ base: a, head: b, commits: [c], mineFiles: ['package.json'], theirFiles: ['package.json'] }).overlap, ['package.json']);
  });

  test('worktreeAction', () => {
    assert.equal(worktreeAction({ worktree: undefined, before: 'a', after: 'b' }), 'absent');
    assert.equal(worktreeAction({ worktree: 'b', before: 'a', after: 'b' }), 'current');
    assert.equal(worktreeAction({ worktree: 'a', before: 'a', after: 'b' }), 'fast-forward');
    assert.equal(worktreeAction({ worktree: 't', before: 'a', after: 'b', taken: 't' }), 'fast-forward', 'the copy the land took');
    assert.equal(worktreeAction({ worktree: 'p', before: 'a', after: 'b', taken: 't' }), 'merge');
  });
});

// ── end to end, against real git ─────────────────────────────────────────────

const g = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
const blob = (dir, rev = 'HEAD') => execFileSync('git', ['show', `${rev}:package.json`], { cwd: dir, encoding: 'utf8' });
const ver = (dir, rev = 'HEAD') => JSON.parse(blob(dir, rev)).version;
const disk = (dir) => readFileSync(join(dir, 'package.json'), 'utf8');
const names = (dir, rev = 'HEAD') => g(dir, ['show', '--name-only', '--format=', rev]).split('\n').filter(Boolean);

function cli(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8',
    env: {
      ...process.env, CW_COMMIT_REPO: cwd, CW_TOUCH_LEDGER: join(cwd, '.cw-test-touches.jsonl'),
      CW_ALLOW_UNSIGNED: '1', CW_COMMIT_SESSION: 'ver81', ...env,
    },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

function scratch(t, { packageJson = pkg('0.1.0') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-commit-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  writeFileSync(join(dir, 'mine.txt'), 'base\n');
  if (packageJson !== null) writeFileSync(join(dir, 'package.json'), packageJson);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-q', '-m', 'test: base']);
  return dir;
}

const land = (dir, file, text, msg) => {
  writeFileSync(join(dir, file), text);
  const r = cli(dir, ['-m', msg, '--', file]);
  assert.equal(r.code, 0, r.err);
  return r;
};

describe('every commit path stamps', () => {
  test('each land bumps the patch once, and the commit carries package.json', (t) => {
    const dir = scratch(t);
    land(dir, 'mine.txt', 'one\n', 'test: add the first');
    assert.equal(blob(dir), pkg('0.1.1'), 'every byte but the version is the parent\'s');
    assert.deepEqual(names(dir), ['mine.txt', 'package.json']);
    const r = land(dir, 'mine.txt', 'two\n', 'test: add the second');
    assert.equal(ver(dir), '0.1.2');
    assert.match(r.out, /package\.json 0\.1\.1 → 0\.1\.2/);
  });

  test('the ledger records package.json under the sha that carried it', (t) => {
    const dir = scratch(t);
    const r = land(dir, 'mine.txt', 'one\n', 'test: record it');
    const sha = r.out.split('\n')[0].trim();
    const rows = readFileSync(join(dir, '.cw-test-touches.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((x) => [x.f, x.via, x.sha]), [['mine.txt', 'commit', sha], ['package.json', 'commit', sha]]);
  });

  test('--check prints the version it would stamp and writes nothing', (t) => {
    const dir = scratch(t);
    writeFileSync(join(dir, 'mine.txt'), 'one\n');
    const head = g(dir, ['rev-parse', 'HEAD']);
    const r = cli(dir, ['--check', '--', 'mine.txt']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /would stamp package\.json 0\.1\.0 → 0\.1\.1/);
    assert.equal(g(dir, ['rev-parse', 'HEAD']), head);
    assert.equal(disk(dir), pkg('0.1.0'), 'a pre-flight does not touch the checkout');
    const would = execFileSync('git', ['hash-object', '--stdin'], { cwd: dir, input: pkg('0.1.1'), encoding: 'utf8' }).trim();
    assert.throws(() => g(dir, ['cat-file', '-e', would]), 'the stamped blob was never written');
  });

  test('--from-blob stamps, and its own path still reads and writes no working tree', (t) => {
    const dir = scratch(t);
    const src = join(dir, '..', `${dir.split('/').pop()}-content`);
    writeFileSync(src, 'from a blob\n');
    t.after(() => rmSync(src, { force: true }));
    const r = cli(dir, ['--from-blob', `mine.txt=${src}`, '-m', 'test: commit content only']);
    assert.equal(r.code, 0, r.err);
    assert.equal(ver(dir), '0.1.1');
    assert.deepEqual(names(dir), ['mine.txt', 'package.json']);
    assert.equal(readFileSync(join(dir, 'mine.txt'), 'utf8'), 'base\n');
    assert.equal(disk(dir), blob(dir), 'package.json alone follows HEAD');
  });

  test("a declared package.json keeps the author's minor bump", (t) => {
    const dir = scratch(t);
    const r = land(dir, 'package.json', pkg('0.2.0'), 'test: bump the minor by hand');
    assert.equal(ver(dir), '0.2.0');
    assert.match(r.out, /ahead of the patch bump/);
    land(dir, 'mine.txt', 'one\n', 'test: commit after the minor');
    assert.equal(ver(dir), '0.2.1', 'and the next commit bumps from it');
  });

  test("a declared package.json with a stale version is raised, keeping the author's other edits", (t) => {
    const dir = scratch(t);
    land(dir, 'mine.txt', 'one\n', 'test: add the first');                               // HEAD at 0.1.1
    land(dir, 'package.json', pkg('0.1.0', { test: 'node --test' }), 'test: commit a stale version');
    assert.equal(blob(dir), pkg('0.1.2', { test: 'node --test' }));
    assert.equal(disk(dir), blob(dir), 'the checkout held exactly what the land took, so it follows HEAD');
  });
});

describe('--onto', () => {
  /** main carries two stamped commits, upstream one; both bumped package.json from 0.1.0. */
  function diverged(t, { mine = null, theirs = null } = {}) {
    const dir = scratch(t);
    writeFileSync(join(dir, 'theirs.txt'), 'base\n');
    g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'test: add their base']);
    g(dir, ['branch', 'upstream']);
    land(dir, 'mine.txt', 'one\n', 'test: add mine one');
    if (mine) land(dir, 'package.json', mine, 'test: edit package.json in mine');
    else land(dir, 'mine.txt', 'two\n', 'test: add mine two');
    g(dir, ['checkout', '-q', 'upstream']);
    if (theirs) land(dir, 'package.json', theirs, 'test: edit package.json in theirs');
    else land(dir, 'theirs.txt', 'theirs\n', 'test: add theirs');
    g(dir, ['checkout', '-q', 'main']);
    return dir;
  }

  test('one bump per replayed commit, on top of theirs; bumps on both sides do not collide', (t) => {
    const dir = diverged(t);
    assert.deepEqual([ver(dir, 'main'), ver(dir, 'upstream')], ['0.1.2', '0.1.1']);
    const pre = cli(dir, ['--check', '--onto', 'upstream']);
    assert.equal(pre.code, 0, pre.err);
    assert.match(pre.out, /would stamp package\.json 0\.1\.1 → 0\.1\.3 over 2 commit\(s\)/);
    const r = cli(dir, ['--onto', 'upstream']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(g(dir, ['log', '--format=%s', '-3', 'main']).split('\n'), ['test: add mine two', 'test: add mine one', 'test: add theirs']);
    assert.deepEqual([ver(dir, 'main~1'), ver(dir, 'main')], ['0.1.2', '0.1.3']);
    assert.equal(g(dir, ['show', 'main:theirs.txt']), 'theirs', 'their change survived');
    assert.equal(disk(dir), blob(dir, 'main'), 'the checkout follows the replayed tip');
  });

  test('one side editing package.json content is not a collision: that edit is carried', (t) => {
    const dir = diverged(t, { mine: pkg('0.1.1', { test: 'mine' }) });
    const r = cli(dir, ['--onto', 'upstream']);
    assert.equal(r.code, 0, r.err);
    assert.equal(blob(dir, 'main'), pkg('0.1.3', { test: 'mine' }));
  });

  test('both sides editing package.json content is REFUSED, and nothing moves', (t) => {
    const dir = diverged(t, { mine: pkg('0.1.1', { test: 'mine' }), theirs: pkg('0.1.0', { test: 'theirs' }) });
    const before = g(dir, ['rev-parse', 'main']);
    const r = cli(dir, ['--onto', 'upstream']);
    assert.equal(r.code, 2, `${r.out}${r.err}`);
    assert.match(r.err, /REFUSED — .*package\.json/);
    assert.equal(g(dir, ['rev-parse', 'main']), before);
  });
});

describe('a repository without package.json', () => {
  test('a land and --check carry no version stamp', (t) => {
    const dir = scratch(t, { packageJson: null });
    writeFileSync(join(dir, 'mine.txt'), 'one\n');
    const pre = cli(dir, ['--check', '--', 'mine.txt']);
    assert.equal(pre.code, 0, pre.err);
    assert.match(pre.out, /no package\.json at the parent, no version stamp/);
    const r = cli(dir, ['-m', 'test: add one', '--', 'mine.txt']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(names(dir), ['mine.txt']);
    assert.ok(!existsSync(join(dir, 'package.json')), 'no package.json is written to the checkout');
  });

  test('a change set that adds package.json commits it as written, and the next commit stamps from it', (t) => {
    const dir = scratch(t, { packageJson: null });
    land(dir, 'package.json', pkg('0.0.1'), 'test: add a package.json');
    assert.equal(blob(dir), pkg('0.0.1'));
    land(dir, 'mine.txt', 'one\n', 'test: add one');
    assert.equal(ver(dir), '0.0.2');
  });

  test('--onto replays with no stamp', (t) => {
    const dir = scratch(t, { packageJson: null });
    g(dir, ['branch', 'upstream']);
    land(dir, 'mine.txt', 'one\n', 'test: add mine one');
    g(dir, ['checkout', '-q', 'upstream']);
    land(dir, 'theirs.txt', 'theirs\n', 'test: add theirs');
    g(dir, ['checkout', '-q', 'main']);
    const r = cli(dir, ['--onto', 'upstream']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /no package\.json, no version stamp/);
    assert.deepEqual(g(dir, ['log', '--format=%s', '-2', 'main']).split('\n'), ['test: add mine one', 'test: add theirs']);
    assert.deepEqual(names(dir, 'main'), ['mine.txt']);
  });
});

describe('refusals: nothing lands, nothing is left behind', () => {
  for (const [name, packageJson] of [['unparseable', '{ "version": "0.1.0",\n'], ['not semver', pkg('latest')]]) {
    test(`a parent package.json that is ${name}`, (t) => {
      const dir = scratch(t, { packageJson });
      writeFileSync(join(dir, 'mine.txt'), 'one\n');
      const head = g(dir, ['rev-parse', 'HEAD']);
      for (const args of [['-m', 'test: expect a refusal', '--', 'mine.txt'], ['--check', '--', 'mine.txt']]) {
        const r = cli(dir, args);
        assert.equal(r.code, 2, `${args[0]}: ${r.out}${r.err}`);
        assert.match(r.err, /REFUSED — package\.json at the parent commit/);
        assert.equal(g(dir, ['rev-parse', 'HEAD']), head, 'HEAD did not move');
        assert.ok(!existsSync(join(dir, '.git', 'index.ver81')), 'no private index is left behind');
      }
    });
  }

  test('a change set that deletes package.json', (t) => {
    const dir = scratch(t);
    rmSync(join(dir, 'package.json'));
    const head = g(dir, ['rev-parse', 'HEAD']);
    const r = cli(dir, ['-m', 'test: drop it', '--', 'package.json']);
    assert.equal(r.code, 2, `${r.out}${r.err}`);
    assert.match(r.err, /deletes package\.json/);
    assert.equal(g(dir, ['rev-parse', 'HEAD']), head);
  });

  test('a HEAD that moved since the read-tree still refuses exactly as before', (t) => {
    const dir = scratch(t);
    const head0 = g(dir, ['rev-parse', 'HEAD']);
    land(dir, 'mine.txt', 'a peer\n', 'test: commit as a peer first');             // HEAD at 0.1.1
    const moved = g(dir, ['rev-parse', 'HEAD']);
    writeFileSync(join(dir, 'mine.txt'), 'mine\n');
    const r = cli(dir, ['-m', 'test: commit from a stale index', '--', 'mine.txt'], { CW_COMMIT_TEST_HEAD_NOW: head0 });
    assert.equal(r.code, 2);
    assert.match(r.err, /STALE-INDEX/);
    assert.deepEqual([g(dir, ['rev-parse', 'HEAD']), ver(dir)], [moved, '0.1.1']);
  });
});

describe("the checkout's package.json after a land", () => {
  test('untouched since the parent: fast-forwarded, file and index agree with HEAD', (t) => {
    const dir = scratch(t);
    land(dir, 'mine.txt', 'one\n', 'test: add one');
    assert.equal(disk(dir), pkg('0.1.1'));
    assert.equal(g(dir, ['status', '--porcelain', '--', 'package.json']), '', 'no diff in either direction');
  });

  test("a peer's uncommitted edit elsewhere in the file: merged, the edit kept, the version stamped", (t) => {
    const dir = scratch(t);
    writeFileSync(join(dir, 'package.json'), pkg('0.1.0', { test: 'peer edit' }));
    land(dir, 'mine.txt', 'one\n', 'test: add one');
    assert.equal(blob(dir), pkg('0.1.1'), 'the peer edit is not committed');
    assert.equal(disk(dir), pkg('0.1.1', { test: 'peer edit' }), 'and it survives in the checkout at the new version');
    assert.equal(g(dir, ['diff', '--cached', '--name-only']), '', 'the shared index agrees with HEAD');
    const diff = g(dir, ['diff', '--', 'package.json']);
    assert.match(diff, /peer edit/);
    assert.doesNotMatch(diff, /0\.1\.0/, 'the checkout no longer reverts the stamp');
  });

  test("a peer's edit that conflicts with the stamp: left byte for byte, and named", (t) => {
    const dir = scratch(t);
    const theirs = pkg('0.3.0-dev');                                            // mid-edit on the version line
    writeFileSync(join(dir, 'package.json'), theirs);
    const r = land(dir, 'mine.txt', 'one\n', 'test: add one');
    assert.equal(ver(dir), '0.1.1');
    assert.equal(disk(dir), theirs, 'the working copy is untouched');
    assert.match(r.err, /WARNING — .*package\.json was NOT updated/);
    assert.match(r.err, /HEAD carries version 0\.1\.1/);
  });

  test("a peer's STAGED package.json stays staged, and is named", (t) => {
    const dir = scratch(t);
    writeFileSync(join(dir, 'package.json'), pkg('0.1.0', { test: 'staged by a peer' }));
    g(dir, ['add', 'package.json']);
    const r = land(dir, 'mine.txt', 'one\n', 'test: add one');
    assert.equal(blob(dir), pkg('0.1.1'), 'their staging is not committed');
    assert.match(g(dir, ['diff', '--cached', '--', 'package.json']), /staged by a peer/, 'and is not unstaged either');
    assert.match(r.err, /shared index holds a staged package\.json/);
  });

  test('no other working-tree file is written', (t) => {
    const dir = scratch(t);
    writeFileSync(join(dir, 'other.txt'), 'untracked\n');
    writeFileSync(join(dir, 'mine.txt'), 'one\n');
    const r = cli(dir, ['--from-blob', `mine.txt=${join(dir, 'other.txt')}`, '-m', 'test: commit from a blob']);
    assert.equal(r.code, 0, r.err);
    assert.equal(readFileSync(join(dir, 'mine.txt'), 'utf8'), 'one\n');
    assert.equal(readFileSync(join(dir, 'other.txt'), 'utf8'), 'untracked\n');
  });
});

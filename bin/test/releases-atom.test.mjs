// fact: every assertion here is an EFFECT on emitted bytes, never a marker / a test that asserts a helper was called passes while the feed it produces is unreadable (expiry: never, prev: wrong)
// fact: the escaping witness strips well-formed entities and asserts no markup residue / the first cut used a lookahead that no < or > could ever satisfy and reported a bug that did not exist (expiry: never, prev: wrong)
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildFeed, readTags, writeAtomic, xmlEscape, isSafePattern, releasePattern,
  FEED_ID, NO_RELEASE_UPDATED, DEFAULT_PATTERN,
} from '../releases-atom.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** a throwaway repo carrying exactly `tags`, so the population is test INPUT and no shared ref store is touched */
function repoTagged(tags) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-atom-tags-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'c0');
  for (const t of tags) git(dir, 'tag', '-a', t, '-m', `release ${t}`);
  return dir;
}

const TAG = (over = {}) => ({
  tag: 'v1.0.0', sha: 'deadbeef', date: '2026-01-01T00:00:00Z', subject: 'first release', ...over,
});

test('no releases is a state, not an error: deterministic and self-describing', () => {
  const a = buildFeed({ tags: [], now: '2026-08-26T12:00:00Z' });
  const b = buildFeed({ tags: [], now: '2099-01-01T00:00:00Z' });
  assert.equal(a, b, 'an untagged repo must emit identical bytes whatever the clock says');
  assert.match(a, /<updated>1970-01-01T00:00:00Z<\/updated>/);
  assert.match(a, /No releases are tagged/);
  assert.ok(!a.includes('<entry>'), 'no entries when nothing is tagged');
});

test('the feed ends with a newline whether or not it has entries', () => {
  assert.ok(buildFeed({ tags: [] }).endsWith('</feed>\n'));
  assert.ok(buildFeed({ tags: [TAG()] }).endsWith('</feed>\n'));
});

test('updated tracks the newest release, never the clock', () => {
  const f = buildFeed({ tags: [TAG({ date: '2026-05-05T00:00:00Z' }), TAG({ tag: 'v0.1.0', date: '2020-01-01T00:00:00Z' })] });
  assert.match(f, /<updated>2026-05-05T00:00:00Z<\/updated>/);
  assert.notEqual(NO_RELEASE_UPDATED, '2026-05-05T00:00:00Z');
});

test('markup in a tag or subject cannot break the document', () => {
  const f = buildFeed({ tags: [TAG({ tag: 'v1&<x>', subject: `a & b <c> "d" it's` })] });
  const content = f.split('<content type="text">')[1].split('</content>')[0];
  // strip every well-formed entity; anything markup-ish left is unescaped input
  const residue = content.replace(/&(amp|lt|gt|quot|apos);/g, '');
  assert.ok(!/[<>&]/.test(residue), `unescaped markup survived: ${residue}`);
  assert.ok(!f.includes('<c>'), 'a raw element from tag text must not reach the feed');
});

test('control characters illegal in XML are dropped, legal whitespace is kept', () => {
  const f = buildFeed({ tags: [TAG({ subject: 'a\u0000b\u0008c\u001Fd\te' })] });
  const content = f.split('<content type="text">')[1].split('</content>')[0];
  assert.equal(content, 'abcd\te');
});

test('entry id is keyed on tag and sha, so reordering does not renumber it', () => {
  const one = buildFeed({ tags: [TAG(), TAG({ tag: 'v0.9.0', sha: 'cafe' })] });
  const two = buildFeed({ tags: [TAG({ tag: 'v0.9.0', sha: 'cafe' }), TAG()] });
  const ids = (s) => [...s.matchAll(/<id>(urn:portll:commitwork:release:[^<]+)<\/id>/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids(one), ids(two), 'the same releases must carry the same ids in any order');
});

test('a capped feed names what it dropped instead of silently truncating', () => {
  const tags = Array.from({ length: 5 }, (_, i) => TAG({ tag: `v0.0.${i}`, sha: `sha${i}` }));
  const f = buildFeed({ tags, limit: 2 });
  assert.match(f, /2 of 5 releases shown; 3 older entries omitted/);
  assert.equal([...f.matchAll(/<entry>/g)].length, 2);
});

test('a pattern may not leave refs/tags', () => {
  assert.equal(isSafePattern('v*'), true);
  assert.equal(isSafePattern(null), true);
  assert.equal(isSafePattern('../heads/*'), false);
  assert.equal(isSafePattern('a/b'), false);
  assert.throws(() => readTags({ pattern: '../heads/*' }), /unsafe tag pattern/);
});

test('git failing is an exception, never an empty release list', () => {
  const notARepo = mkdtempSync(join(tmpdir(), 'cw-atom-'));
  assert.throws(() => readTags({ cwd: notARepo }), /git exited/,
    'an unreadable ref store must not read as a repository with no releases');
});

test('writing is atomic and idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-atom-out-'));
  const out = join(dir, 'nested', 'releases.atom');   // nested: the directory must be created
  const body = buildFeed({ tags: [TAG()] });
  writeAtomic(out, body);
  const first = readFileSync(out, 'utf8');
  writeAtomic(out, buildFeed({ tags: [TAG()] }));
  assert.equal(readFileSync(out, 'utf8'), first, 're-running must not change a byte');
});

test('xmlEscape covers all five predefined entities', () => {
  assert.equal(xmlEscape(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
});

test('the feed id carries no host, so moving the feed does not renotify', () => {
  assert.ok(FEED_ID.startsWith('urn:'), 'an http id bakes in a hosting decision not yet made');
  assert.ok(!buildFeed({ tags: [] }).includes(`<id>http`));
});

test('a release is a v* tag: the retired counted tag is outside the population', () => {
  const dir = repoTagged(['0.1108', 'v0.2.0']);
  assert.deepEqual(readTags({ cwd: dir }).map((t) => t.tag), ['v0.2.0'],
    'a commit count a rebase renumbers must not be republished as a release');
  assert.equal(DEFAULT_PATTERN, 'v*');
  assert.deepEqual(readTags({ cwd: dir, pattern: '*' }).map((t) => t.tag).sort(), ['0.1108', 'v0.2.0'],
    'the retired tag is still THERE and readable -- it is excluded, not deleted');
});

test('the feed built from a v* tag set carries that tag and not the interim one', () => {
  const dir = repoTagged(['0.1108', 'v0.2.0']);
  const f = buildFeed({ tags: readTags({ cwd: dir }), pattern: releasePattern() });
  assert.match(f, /<title>v0\.2\.0<\/title>/);
  assert.ok(!f.includes('0.1108'), 'the retired interim tag must not appear as a feed entry');
  assert.equal([...f.matchAll(/<entry>/g)].length, 1);
});

test('the release pattern is env-overridable at call time', () => {
  const prev = process.env.CW_RELEASES_PATTERN;
  const dir = repoTagged(['0.1108', 'v0.2.0']);
  try {
    process.env.CW_RELEASES_PATTERN = '0.*';
    assert.equal(releasePattern(), '0.*');
    assert.deepEqual(readTags({ cwd: dir }).map((t) => t.tag), ['0.1108'],
      'an override set after module load must still select the population');
  } finally {
    if (prev === undefined) delete process.env.CW_RELEASES_PATTERN; else process.env.CW_RELEASES_PATTERN = prev;
  }
});

test('an empty feed names the population it read, so no releases cannot read as no tags', () => {
  const a = buildFeed({ tags: [], pattern: 'v*', now: '2026-10-03T00:00:00Z' });
  const b = buildFeed({ tags: [], pattern: 'v*', now: '2099-01-01T00:00:00Z' });
  assert.equal(a, b, 'the named population must not make the feed clock-dependent');
  assert.match(a, /No tag matches v\*\./);
  assert.ok(!a.includes('<entry>'));
});

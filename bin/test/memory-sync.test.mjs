// bin/test/memory-sync.test.mjs — the canary half is the point: a coverage run that cannot find its
// own record reports every slug ABSENT, which reads exactly like a store nobody has written to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  harnessSlug, harnessMemoryDir, parseMemoryFile, groupsFromIndex, groupTag,
  recordFor, readMemoryDir, canary, coverage, main, CANARY_SLUG,
} from '../memory-sync.mjs';

const FILE = (name, description, body = 'the fact.') =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: project\n---\n\n${body}\n`;

const fixtureDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'memsync-'));
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'alpha-fact.md'), FILE('alpha-fact', 'the alpha description'));
  writeFileSync(join(d, 'beta-fact.md'), FILE('beta-fact', 'the beta description'));
  writeFileSync(join(d, 'no-frontmatter.md'), 'just prose, no header\n');
  writeFileSync(join(d, 'MEMORY.md'), '# Memory index\n\n## Group One\n- [alpha](alpha-fact.md)\n\n## Group Two\n- [beta](beta-fact.md)\n');
  return d;
};

test('the memory directory is derived, and the env override is read at call time', () => {
  assert.equal(harnessSlug('/home/user/src/commitwork'), '-home-user-src-commitwork');
  const env = { HOME: '/home/u' };
  assert.equal(harnessMemoryDir({ env, root: '/a/b' }), '/home/u/.claude/projects/-a-b/memory');
  env.CW_HARNESS_MEMORY_DIR = '/elsewhere/memory';
  assert.equal(harnessMemoryDir({ env, root: '/a/b' }), '/elsewhere/memory');
});

test('a file with no description is an error, not a record with an empty one', () => {
  const ok = parseMemoryFile(FILE('a-slug', 'a hook'));
  assert.deepEqual([ok.name, ok.description, ok.type, ok.body], ['a-slug', 'a hook', 'project', 'the fact.']);
  assert.throws(() => parseMemoryFile('no header at all'), /no frontmatter/);
  assert.throws(() => parseMemoryFile('---\nname: x\n---\nbody'), /no description/);
  assert.throws(() => parseMemoryFile('---\nname: x\ndescription: d\n---\n\n   \n'), /body is empty/);
});

test('the index headings become a group tag, first heading wins', () => {
  const groups = groupsFromIndex('## A Heading\n- [x](one.md) · [y](two.md)\n## Another One!\n- [z](three.md)\n- [x again](one.md)\n');
  assert.equal(groups.get('one'), 'A Heading');
  assert.equal(groups.get('three'), 'Another One!');
  assert.equal(groupTag('Another One!'), 'memory-group:another-one');
});

test('the record is addressable by name and carries no frontmatter', () => {
  const rec = recordFor(parseMemoryFile(FILE('a-slug', 'a hook')), { project: 'commitwork', group: 'Git and the shared tree' });
  assert.equal(rec.external_id, 'claude-memory/commitwork/a-slug');
  assert.ok(rec.tags.includes('memory:a-slug'));
  assert.ok(rec.tags.includes('harness-memory'));
  assert.ok(rec.tags.includes('memory-group:git-and-the-shared-tree'));
  assert.ok(rec.content.startsWith('a hook'));
  assert.ok(!rec.content.includes('---'));
});

test('readMemoryDir separates the unreadable from the parsed and never counts MEMORY.md', () => {
  const r = readMemoryDir(fixtureDir());
  assert.deepEqual(r.parsed.map((p) => p.name).sort(), ['alpha-fact', 'beta-fact']);
  assert.equal(r.unreadable.length, 1);
  assert.equal(r.unreadable[0].file, 'no-frontmatter.md');
  assert.equal(r.parsed.find((p) => p.name === 'alpha-fact').group, 'Group One');
  assert.ok(!r.files.includes('MEMORY.md'));
});

test('a negative control that returns rows refuses the run, and nothing is written', async () => {
  let upserts = 0;
  const recallImpl = async () => ({ ok: true, memories: [{ id: 'x' }] });
  const upsertImpl = async () => { upserts++; return { state: 'verified' }; };
  const c = await canary({ recallImpl, upsertImpl, write: true, env: { CW_NOW: '2026-10-11' } });
  assert.equal(c.ok, false);
  assert.match(c.reason, /negative control returned 1 row/);
  assert.equal(upserts, 0);

  const lines = [];
  const code = await main(['--coverage'], {
    env: { CW_NOW: '2026-10-11' }, out: (s) => lines.push(s),
    deps: { readMemoryDir: () => ({ files: [], parsed: [], unreadable: [], indexed: 0 }), recallImpl, upsertImpl },
  });
  assert.equal(code, 20);
  assert.match(lines.join('\n'), /REFUSED/);
  assert.equal(upserts, 0);
});

test('a canary written but not retrievable refuses the run', async () => {
  const recallImpl = async (tags) => ({ ok: true, memories: tags[0].includes(CANARY_SLUG) ? [] : [] });
  const upsertImpl = async () => ({ state: 'verified', id: 'id-1', version: 1 });
  const c = await canary({ recallImpl, upsertImpl, write: true, env: { CW_NOW: '2026-10-11' } });
  assert.equal(c.ok, false);
  assert.match(c.reason, /does not come back under its own tag/);
});

test('coverage holds present, absent and unmeasured apart', async () => {
  const recallImpl = async (tags) => {
    if (tags[0] === 'memory:here') return { ok: true, memories: [{ id: '1' }] };
    if (tags[0] === 'memory:broken') return { ok: false, reason: 'HTTP 500', memories: null };
    return { ok: true, memories: [] };
  };
  const r = await coverage(['here', 'gone', 'broken'], { recallImpl });
  assert.deepEqual(r.present, ['here']);
  assert.deepEqual(r.absent, ['gone']);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.unknown[0].slug, 'broken');
});

test('--dry builds every record and calls nothing', async () => {
  const dir = fixtureDir();
  let calls = 0;
  const bump = async () => { calls++; return { ok: true, memories: [] }; };
  const lines = [];
  const code = await main(['--dry', '--json', '--dir', dir], {
    env: {}, out: (s) => lines.push(s), deps: { recallImpl: bump, upsertImpl: bump },
  });
  const report = JSON.parse(lines.join('\n'));
  assert.equal(calls, 0);
  assert.equal(code, 21, 'the fixture has one unreadable file, and that is reported, not swallowed');
  assert.equal(report.records.length, 2);
  assert.ok(report.records.every((r) => r.external_id.startsWith('claude-memory/')));
});

test('a failed write exits 21 and names the slug', async () => {
  const dir = fixtureDir();
  const recallImpl = async () => ({ ok: true, memories: [{ id: 'canary' }] });
  const upsertImpl = async (rec) => (rec.external_id.includes(CANARY_SLUG)
    ? { state: 'verified', id: 'c', version: 1 }
    : { state: 'failed', reason: 'HTTP 500', storedForm: 'unknown' });
  const lines = [];
  const code = await main(['--apply', '--json', '--dir', dir], {
    env: { CW_NOW: '2026-10-11' }, out: (s) => lines.push(s),
    deps: {
      recallImpl: async (tags) => (tags[0].includes('absent-control') ? { ok: true, memories: [] } : recallImpl()),
      upsertImpl,
    },
  });
  const report = JSON.parse(lines.join('\n'));
  assert.equal(code, 21);
  assert.equal(report.broken.length, 2);
  assert.ok(report.broken.every((b) => b.state === 'failed'));
});

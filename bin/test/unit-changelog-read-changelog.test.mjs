// readChangelog: an absent file is null, any other read failure throws, and a file without the mark in its first ten lines is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChangelogError, GENERATED_MARK, readChangelog } from '../changelog.mjs';
import { REFUSED_ERRNO, ignoresPermissions, withUnreadable } from '../../lib/fs-unreadable.mjs';

let dir;
test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'readChangelog-')); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p; };
const markOnLine = (n) => [...Array.from({ length: n - 1 }, () => 'x'), GENERATED_MARK, 'tail'].join('\n');
const refusal = (p) => `${p} does not carry "${GENERATED_MARK}" in its head -- refusing to overwrite a file this tool did not write`;
const changelogError = (message) => (e) => e instanceof ChangelogError && (typeof message === 'string' ? e.message === message : message.test(e.message));

test('an absent file is null', () => {
  assert.equal(readChangelog(join(dir, 'missing.md')), null);
});

test('a path that cannot be read as a file throws a ChangelogError naming the errno', () => {
  const p = join(dir, 'subdir');
  mkdirSync(p);
  assert.throws(() => readChangelog(p), changelogError(`${p} could not be read (EISDIR)`));
});

test('an unreadable file throws rather than reading as absent', (t) => {
  if (ignoresPermissions()) return t.skip('elevated process ignores read denial');
  const p = write('locked.md', markOnLine(1));
  const r = withUnreadable(p, () => assert.throws(() => readChangelog(p), changelogError(new RegExp(`could not be read \\((${REFUSED_ERRNO.source})\\)$`))));
  if (!r.ran) return t.skip(r.why);
});

test('the mark on line one, two or ten returns the whole text', () => {
  for (const n of [1, 2, 10]) {
    const content = markOnLine(n);
    assert.equal(readChangelog(write(`line${n}.md`, content)), content, `line ${n}`);
  }
});

test('a file without the mark is refused with a ChangelogError', () => {
  const p = write('bad.md', 'no mark here\nline2\nline3');
  assert.throws(() => readChangelog(p), changelogError(refusal(p)));
});

test('the mark only on line eleven is refused', () => {
  const p = write('late.md', markOnLine(11));
  assert.throws(() => readChangelog(p), changelogError(refusal(p)));
});

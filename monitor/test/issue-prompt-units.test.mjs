// monitor/test/issue-prompt-units.test.mjs — case tests for codeContext.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeContext, composeIssuePrompt } from '../issue-prompt.mjs';

test('returns null when issue is null', () => {
  assert.equal(codeContext(null), null);
});

test('returns null when anchor is missing', () => {
  assert.equal(codeContext({}), null);
});

test('returns null when anchor.file is not a string', () => {
  assert.equal(codeContext({ anchor: { file: 123, line: 1 } }), null);
});

test('returns null when anchor.file is empty string', () => {
  assert.equal(codeContext({ anchor: { file: '', line: 1 } }), null);
});

test('returns null when anchor.line is not an integer', () => {
  assert.equal(codeContext({ anchor: { file: 'a.js', line: 1.5 } }), null);
});

test('returns null when anchor.line is less than 1', () => {
  assert.equal(codeContext({ anchor: { file: 'a.js', line: 0 } }), null);
});

test('returns null when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
  try {
    const result = codeContext({ anchor: { file: 'nonexistent.js', line: 1 } }, { root: dir });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns excerpt with marked line for existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
  try {
    const content = 'line1\nline2\nline3\nline4\nline5';
    writeFileSync(join(dir, 'test.js'), content);
    const result = codeContext({ anchor: { file: 'test.js', line: 3 } }, { root: dir });
    assert.equal(result.file, 'test.js');
    assert.ok(result.excerpt.includes('3 >> line3'));
    assert.ok(result.excerpt.includes('1   line1'));
    assert.ok(result.excerpt.includes('5   line5'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── anchoring is confined to the repository root ─────────────────────────────
const OUTSIDE = 'x-test-outside-content-x';

function tempBase(run) {
  const base = mkdtempSync(join(tmpdir(), 'ctx-'));
  try {
    run(base, join(base, 'root'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('refuses ../outside.txt', () => {
  tempBase((base, root) => {
    mkdirSync(root);
    writeFileSync(join(base, 'outside.txt'), OUTSIDE);
    const result = codeContext({ anchor: { file: '../outside.txt', line: 1 } }, { root });
    assert.deepEqual(result, {
      file: '../outside.txt',
      excerpt: null,
      refused: 'path resolves outside the repository root',
    });
    assert.ok(!JSON.stringify(result).includes(OUTSIDE), 'outside content must not leak');
  });
});

test('refuses sub/../../outside.txt', () => {
  tempBase((base, root) => {
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(base, 'outside.txt'), OUTSIDE);
    const result = codeContext({ anchor: { file: 'sub/../../outside.txt', line: 1 } }, { root });
    assert.deepEqual(result, {
      file: 'sub/../../outside.txt',
      excerpt: null,
      refused: 'path resolves outside the repository root',
    });
  });
});

test('refuses an absolute path outside the root', () => {
  tempBase((base, root) => {
    mkdirSync(root);
    writeFileSync(join(base, 'outside.txt'), OUTSIDE);
    const outside = join(base, 'outside.txt');
    const result = codeContext({ anchor: { file: outside, line: 1 } }, { root });
    assert.deepEqual(result, {
      file: outside,
      excerpt: null,
      refused: 'path resolves outside the repository root',
    });
  });
});

test('accepts an absolute path inside the root', () => {
  tempBase((_base, root) => {
    mkdirSync(root);
    const file = join(root, 'inside.js');
    writeFileSync(file, 'a\nb\nc');
    const result = codeContext({ anchor: { file, line: 2 } }, { root });
    assert.deepEqual(result, { file, excerpt: '1   a\n2 >> b\n3   c' });
  });
});

test('accepts ..foo.js at the root', () => {
  tempBase((_base, root) => {
    mkdirSync(root);
    writeFileSync(join(root, '..foo.js'), 'a\nb\nc');
    const result = codeContext({ anchor: { file: '..foo.js', line: 2 } }, { root });
    assert.deepEqual(result, { file: '..foo.js', excerpt: '1   a\n2 >> b\n3   c' });
  });
});

test('refuses a symlink that resolves outside the root', (t) => {
  tempBase((base, root) => {
    mkdirSync(root);
    writeFileSync(join(base, 'outside.txt'), OUTSIDE);
    try {
      symlinkSync(join(base, 'outside.txt'), join(root, 'link.js'));
    } catch (e) {
      if (e.code === 'EPERM') {
        t.skip('symlinks need privileges on this platform');
        return;
      }
      throw e;
    }
    const result = codeContext({ anchor: { file: 'link.js', line: 1 } }, { root });
    assert.deepEqual(result, {
      file: 'link.js',
      excerpt: null,
      refused: 'path is a link that resolves outside the repository root',
    });
  });
});

test('reads a symlink that resolves inside the root through its target', () => {
  tempBase((_base, root) => {
    mkdirSync(root);
    writeFileSync(join(root, 'target.js'), 'a\nb\nc');
    symlinkSync(join(root, 'target.js'), join(root, 'inner.js'));
    const result = codeContext({ anchor: { file: 'inner.js', line: 2 } }, { root });
    assert.deepEqual(result, { file: 'inner.js', excerpt: '1   a\n2 >> b\n3   c' });
  });
});

test('composeIssuePrompt states a refusal instead of the outside file text', () => {
  tempBase((base, root) => {
    mkdirSync(root);
    writeFileSync(join(base, 'outside.txt'), OUTSIDE);
    const issue = {
      anchor: { file: '../outside.txt', line: 1 },
      severity: 'high',
      source: { tool: 'test-tool' },
    };
    const result = composeIssuePrompt(issue, { root });
    assert.ok(result.includes('(source refused: path resolves outside the repository root)'));
    assert.ok(!result.includes(OUTSIDE), 'outside content must not leak into the prompt');
  });
});

test('composeIssuePrompt still says source unavailable for a missing file', () => {
  tempBase((_base, root) => {
    mkdirSync(root);
    const issue = {
      anchor: { file: 'missing.js', line: 1 },
      severity: 'high',
      source: { tool: 'test-tool' },
    };
    const result = composeIssuePrompt(issue, { root });
    assert.ok(result.includes('(source unavailable)'));
  });
});

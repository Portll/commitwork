// Renders a changelog section with commit counts and grouped entries (bin/changelog.mjs renderSection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSection } from '../changelog.mjs';

test('renders a single commit with no merges and no groups', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [{ sha: 'abc123', message: 'feat: add feature' }], merges: 0,
  });
  assert.equal(out, "## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 1 commit\n\n### Features\n\n- add feature (`abc123`)\n");
});

test('renders two commits with plural commits and no merges', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [
      { sha: 'abc123', message: 'feat: add feature' },
      { sha: 'def456', message: 'fix: correct bug' },
    ], merges: 0,
  });
  assert.equal(out, "## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 2 commits\n\n### Features\n\n- add feature (`abc123`)\n\n### Fixes\n\n- correct bug (`def456`)\n");
});

test('renders one merge commit in the note', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [{ sha: 'abc123', message: 'feat: add feature' }], merges: 1,
  });
  assert.equal(out, "## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 1 commit \u00b7 1 merge commit not listed\n\n### Features\n\n- add feature (`abc123`)\n");
});

test('renders two merge commits in the note', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [{ sha: 'abc123', message: 'feat: add feature' }], merges: 2,
  });
  assert.equal(out, "## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 1 commit \u00b7 2 merge commits not listed\n\n### Features\n\n- add feature (`abc123`)\n");
});

test('renders no commits message when commits array is empty', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [], merges: 0,
  });
  assert.equal(out, '## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 0 commits\n\nNo commits in this range.\n');
});

test('renders breaking change with note and type label', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [{ sha: 'abc123', message: 'feat!: drop old api\n\nBREAKING CHANGE: removed api' }], merges: 0,
  });
  assert.equal(out, '## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 1 commit\n\n### Breaking changes\n\n- **feat:** drop old api BREAKING CHANGE: removed api (`abc123`)\n');
});

test('renders non-conventional commit under Not conventional', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [{ sha: 'abc123', message: 'update stuff' }], merges: 0,
  });
  assert.equal(out, '## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 1 commit\n\n### Not conventional\n\n- update stuff (`abc123`)\n');
});

test('renders scoped commit with scope label', () => {
  const out = renderSection({
    label: 'v1.0.0', date: '2024-01-01', fromLabel: 'v0.9.0', toLabel: 'v1.0.0',
    commits: [{ sha: 'abc123', message: 'fix(core): correct bug' }], merges: 0,
  });
  assert.equal(out, '## v1.0.0 \u2014 2024-01-01\n\n`v0.9.0..v1.0.0` \u00b7 1 commit\n\n### Fixes\n\n- **core:** correct bug (`abc123`)\n');
});

// Renders a disclosure review as a Markdown document (bin/disclosure-review.mjs renderMarkdown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../disclosure-review.mjs';

test('renders header with project name and generation metadata', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 0, undetermined: 0, dismissed: 0, total: 0 },
    confirmed: [],
    undetermined: [],
    dismissed: []
  };
  const result = renderMarkdown(review, { project: 'my-project' });
  assert.equal(result, "# Disclosure review \u2014 my-project\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**0 confirmed \u00b7 0 undetermined \u00b7 0 dismissed** (of 0)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| \u2014 | none confirmed | | | |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| \u2014 | | none |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| \u2014 | | none |\n");
});

test('renders confirmed findings with fix and citations', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 2, undetermined: 0, dismissed: 0, total: 2 },
    confirmed: [
      { id: 'F1', axes: { severity: 'high', urgency: 'now', size: 'small' }, fix: 'patch it', citations: ['c1', 'c2'] },
      { id: 'F2', axes: { severity: 'med', urgency: 'soon', size: 'large' }, fix: null, citations: [] }
    ],
    undetermined: [],
    dismissed: []
  };
  const result = renderMarkdown(review);
  assert.equal(result, "# Disclosure review \u2014 findings\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**2 confirmed \u00b7 0 undetermined \u00b7 0 dismissed** (of 2)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| 1 | F1 | high/now/small | patch it | c1, c2 |\n| 2 | F2 | med/soon/large | \u2014 | \u2014 |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| \u2014 | | none |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| \u2014 | | none |\n");
});

test('renders undetermined findings with error reason', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 0, undetermined: 1, dismissed: 0, total: 1 },
    confirmed: [],
    undetermined: [
      { id: 'U1', claimedSeverity: 'high', error: 'timeout' }
    ],
    dismissed: []
  };
  const result = renderMarkdown(review);
  assert.equal(result, "# Disclosure review \u2014 findings\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**0 confirmed \u00b7 1 undetermined \u00b7 0 dismissed** (of 1)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| \u2014 | none confirmed | | | |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| U1 | high | judge error: timeout |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| \u2014 | | none |\n");
});

test('renders undetermined findings demoted to opinion', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 0, undetermined: 1, dismissed: 0, total: 1 },
    confirmed: [],
    undetermined: [
      { id: 'U2', claimedSeverity: 'low', demotedToOpinion: true }
    ],
    dismissed: []
  };
  const result = renderMarkdown(review);
  assert.equal(result, "# Disclosure review \u2014 findings\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**0 confirmed \u00b7 1 undetermined \u00b7 0 dismissed** (of 1)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| \u2014 | none confirmed | | | |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| U2 | low | dismissal had nothing checkable (demoted to opinion) |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| \u2014 | | none |\n");
});

test('renders undetermined findings with verdict only', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 0, undetermined: 1, dismissed: 0, total: 1 },
    confirmed: [],
    undetermined: [
      { id: 'U3', claimedSeverity: 'med', verdict: 'inconclusive' }
    ],
    dismissed: []
  };
  const result = renderMarkdown(review);
  assert.equal(result, "# Disclosure review \u2014 findings\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**0 confirmed \u00b7 1 undetermined \u00b7 0 dismissed** (of 1)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| \u2014 | none confirmed | | | |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| U3 | med | verdict inconclusive |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| \u2014 | | none |\n");
});

test('renders dismissed findings with verdict and citations', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 0, undetermined: 0, dismissed: 1, total: 1 },
    confirmed: [],
    undetermined: [],
    dismissed: [
      { id: 'D1', verdict: 'false-positive', citations: ['ref1'] }
    ]
  };
  const result = renderMarkdown(review);
  assert.equal(result, "# Disclosure review \u2014 findings\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**0 confirmed \u00b7 0 undetermined \u00b7 1 dismissed** (of 1)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| \u2014 | none confirmed | | | |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| \u2014 | | none |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| D1 | false-positive | ref1 |\n");
});

test('renders empty sections with placeholder rows', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 0, undetermined: 0, dismissed: 0, total: 0 },
    confirmed: [],
    undetermined: [],
    dismissed: []
  };
  const result = renderMarkdown(review);
  assert.equal(result, "# Disclosure review \u2014 findings\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**0 confirmed \u00b7 0 undetermined \u00b7 0 dismissed** (of 0)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| \u2014 | none confirmed | | | |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| \u2014 | | none |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| \u2014 | | none |\n");
});

test('escapes pipe characters in fix and why fields', () => {
  const review = {
    generatedAt: '2024-01-01T00:00:00Z',
    backend: 'test-backend',
    counts: { confirmed: 1, undetermined: 1, dismissed: 0, total: 2 },
    confirmed: [
      { id: 'F3', axes: { severity: 'low', urgency: 'later', size: 'tiny' }, fix: 'a|b', citations: ['x'] }
    ],
    undetermined: [
      { id: 'U4', claimedSeverity: 'high', error: 'err|or' }
    ],
    dismissed: []
  };
  const result = renderMarkdown(review);
  assert.equal(result, "# Disclosure review \u2014 findings\n\nGenerated 2024-01-01T00:00:00Z \u00b7 backend `test-backend`\n\n**1 confirmed \u00b7 1 undetermined \u00b7 0 dismissed** (of 2)\n\n> `undetermined` is its own state \u2014 a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.\n\n## Confirmed \u2014 remediation order\n\n| # | id | sev/urg/size | fix must confine | cites |\n|---|---|---|---|---|\n| 1 | F3 | low/later/tiny | a\\|b | x |\n\n## Undetermined \u2014 triage, do not close\n\n| id | claimed sev | why undetermined |\n|---|---|---|\n| U4 | high | judge error: err\\|or |\n\n## Dismissed \u2014 supported false-positive / unreachable\n\n| id | verdict | citations |\n|---|---|---|\n| \u2014 | | none |\n");
});

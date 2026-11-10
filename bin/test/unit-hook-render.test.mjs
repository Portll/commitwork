// Multi-line pre-commit report text built from a verdict and per-lane results (bin/hook.mjs render).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../hook.mjs';

const D = '\u2014';
const M = '\u00b7';
const FIX = [
  '  Remove the credential from the staged file, re-stage it, and commit again. A credential that',
  '  was ever committed or pushed must be rotated at its issuer as well.',
];
const INSTALL = [
  '  Install the missing scanner, drop the lane (commitwork hook install --lanes secrets), or',
  '  reinstall with --unrun warn to let commits through marked unchecked.',
];

test('a clean verdict with no lanes renders only the clean headline', () => {
  assert.equal(
    render({ verdict: 'clean', unrun: [], lanes: [] }),
    `commitwork pre-commit: clean ${D} every lane ran over the staged content`,
  );
});

test('a result without an unrun array throws because every headline is built', () => {
  assert.throws(() => render({ verdict: 'clean', lanes: [] }), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'join')",
  });
});

test('one blocking finding in one scanned file uses singular nouns and appends the fix advice', () => {
  const r = render({
    verdict: 'blocked-findings',
    blocking: 1,
    unrun: [],
    lanes: [{
      lane: 'secrets', ran: true, scannedFiles: 1, unscanned: [],
      findings: [{ file: 'a.txt', line: 1, col: 2, cls: 'aws', match: 'AKIAX' }],
    }],
  });
  assert.equal(r, [
    `commitwork pre-commit: BLOCKED ${D} 1 finding in the staged content`,
    `  secrets  ran ${M} 1 staged file scanned ${M} 0 unscanned ${M} 1 added secret`,
    '    a.txt:1:2  aws  AKIAX',
    ...FIX,
  ].join('\n'));
});

test('two blocking findings in two scanned files use plural nouns and omit a missing column and match', () => {
  const r = render({
    verdict: 'blocked-findings',
    blocking: 2,
    unrun: [],
    lanes: [{
      lane: 'secrets', ran: true, scannedFiles: 2, unscanned: [],
      findings: [
        { file: 'a.txt', line: 1, col: 2, cls: 'aws', match: 'AKIAX' },
        { file: 'b.txt', line: 3, cls: 'github' },
      ],
    }],
  });
  assert.equal(r, [
    `commitwork pre-commit: BLOCKED ${D} 2 findings in the staged content`,
    `  secrets  ran ${M} 2 staged files scanned ${M} 0 unscanned ${M} 2 added secrets`,
    '    a.txt:1:2  aws  AKIAX',
    '    b.txt:3  github',
    ...FIX,
  ].join('\n'));
});

test('existing, sensitive-context and unscanned entries each get their own line after the lane summary', () => {
  const r = render({
    verdict: 'clean',
    unrun: [],
    lanes: [{
      lane: 'secrets', ran: true, scannedFiles: 0,
      unscanned: [{ file: 'big.bin', reason: 'too large' }],
      findings: [],
      existing: [{ file: 'old.txt', line: 10, cls: 'aws' }],
      context: [{ file: 'ctx.txt', line: 20, cls: 'token' }],
    }],
  });
  assert.equal(r, [
    `commitwork pre-commit: clean ${D} every lane ran over the staged content`,
    `  secrets  ran ${M} 0 staged files scanned ${M} 1 unscanned ${M} 0 added secrets`,
    `    already in HEAD, not added by this commit: old.txt:10  aws ${D} rotate it`,
    '    SENSITIVE-CONTEXT ctx.txt:20  token',
    '    UNSCANNED big.bin  too large',
  ].join('\n'));
});

test('a non-secrets lane has no scanned-file count and tolerates missing optional lists', () => {
  const r = render({
    verdict: 'clean',
    unrun: [],
    lanes: [{ lane: 'lint', ran: true, findings: [{ file: 'x.js', line: 5, col: 3, cls: 'indent' }] }],
  });
  assert.equal(r, [
    `commitwork pre-commit: clean ${D} every lane ran over the staged content`,
    `  lint  ran ${M} 1 added secret`,
    '    x.js:5:3  indent',
  ].join('\n'));
});

test('a blocked-unrun verdict lists the lane that did not run and appends the install advice', () => {
  const r = render({
    verdict: 'blocked-unrun',
    unrun: ['secrets'],
    lanes: [
      { lane: 'secrets', ran: false, error: 'scanner not installed' },
      { lane: 'lint', ran: true, findings: [] },
    ],
  });
  assert.equal(r, [
    `commitwork pre-commit: BLOCKED ${D} secrets could not run, so this commit is unchecked (--unrun block)`,
    `  secrets  NOT RUN ${D} scanner not installed`,
    `  lint  ran ${M} 0 added secrets`,
    ...INSTALL,
  ].join('\n'));
});

test('an allowed-unchecked verdict joins the unrun lanes with commas and adds no advice', () => {
  const r = render({
    verdict: 'allowed-unchecked',
    unrun: ['secrets', 'style'],
    lanes: [
      { lane: 'secrets', ran: false, error: 'missing' },
      { lane: 'style', ran: false, error: 'missing' },
    ],
  });
  assert.equal(r, [
    `commitwork pre-commit: ALLOWED UNCHECKED ${D} secrets, style could not run (--unrun warn); this is not a pass`,
    `  secrets  NOT RUN ${D} missing`,
    `  style  NOT RUN ${D} missing`,
  ].join('\n'));
});

test('an unknown verdict renders an empty headline', () => {
  assert.equal(render({ verdict: 'unknown', unrun: [], lanes: [] }), '');
});

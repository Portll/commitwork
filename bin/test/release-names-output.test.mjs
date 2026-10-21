// The redaction map is going into CI as a secret, and CI logs are public once the repository is. So
// every report the release-name gates build must be safe to print: a path masked to the source that
// scopes it, a row that carries a line and a source but never the matched text. This plants each
// scoped name into a filename and into content, then reads what the formatters would print.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { findNames, mask, offenderRows } from '../lib/release-scope.mjs';
import { loadScope, scanEntries, SIDECAR } from '../lib/release-names-head-scan.mjs';
import { identityReport } from '../release-candidate.mjs';

const needsScope = () => (process.env.CW_RELEASE_REDACTIONS || existsSync(SIDECAR())
  ? {}
  : { skip: `no sidecar at ${SIDECAR()} and no CW_RELEASE_REDACTIONS: the scope is private, so this cannot run here` });

test('no report the release-name gates print contains a scoped name', needsScope(), () => {
  const scope = loadScope();
  assert.ok(scope, 'the release scope did not load');
  const planted = scope.words.map((w) => w.key)
    .map((key, i) => ({ key, path: `notes/n${i}-${key}.md`, text: `a ${key} b\n` }))
    .filter((p) => findNames(p.text, scope).length > 0 && findNames(p.path, scope).length > 0);
  assert.ok(planted.length > 0, 'no scoped name was detected when planted, so nothing below would be read');
  const r = scanEntries(planted.map(({ path, text }) => ({ path, text })), scope);
  assert.equal(r.content.length, planted.length, 'every planted file must be flagged');
  const printed = [
    ...offenderRows(r.content, scope),
    ...r.paths.map((p) => mask(p, findNames(p, scope))),
    JSON.stringify(identityReport(r, scope)),
  ].join('\n').toLowerCase();
  // Count only: an assertion message that listed the leaks would itself be the leak.
  const leaked = planted.filter((p) => printed.includes(p.key.toLowerCase())).length;
  assert.equal(leaked, 0, `${leaked} of ${planted.length} planted names appear in what the gates print`);
});

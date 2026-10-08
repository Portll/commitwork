// bin/test/format-phase.test.mjs — #19's guarantees, asserted against scratch repos.
//
// The load-bearing assertions are the REFUSALS: mixed staged+unstaged state is never touched
// (the hunk-holder rule), fixtures are never touched, an undeclared staged file is never touched
// (the shared-index rule), and --write restages exactly what it formatted (the closure rule).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatBytes, classify } from '../format-phase.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'format-phase.mjs');

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'cw-fmt-'));
  const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 'fmt@test');
  g('config', 'user.name', 'fmt test');
  return { d, g };
}
const run = (d, ...args) => {
  // spawnSync, not execFileSync: the refusals and shared-index warnings go to STDERR by design,
  // and execFileSync discards stderr on a zero exit — the first cut of this helper asserted
  // against half the output and failed two tests that the module was passing.
  const r = spawnSync('node', [BIN, ...args], { cwd: d, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

describe('the transform', () => {
  test('strips trailing whitespace and normalises the EOF newline', () => {
    const r = formatBytes(Buffer.from('a  \nb\t\nc'));
    assert.equal(r.out.toString(), 'a\nb\nc\n');
    assert.equal(r.changed, true);
  });

  test('markdown keeps its line interiors — trailing double-space is syntax, not dirt', () => {
    const r = formatBytes(Buffer.from('line one  \nline two\n\n\n'), { markdown: true });
    assert.equal(r.out.toString(), 'line one  \nline two\n');
  });

  test('a clean file is byte-identical and idempotence holds', () => {
    const clean = Buffer.from('a\nb\n');
    assert.equal(formatBytes(clean).changed, false);
    const once = formatBytes(Buffer.from('a  \nb')).out;
    assert.deepEqual(formatBytes(once).out, once, 'formatting a formatted file changes nothing');
  });

  test('CRLF files keep their CRs — v1 does not relitigate line endings', () => {
    const r = formatBytes(Buffer.from('a \r\nb\r\n'));
    assert.equal(r.out.toString(), 'a\r\nb\r\n');
  });
});

describe('classification — the refusals are the product', () => {
  test('mixed staged+unstaged is REFUSED with the hunk-holder reason', () => {
    const rows = classify(['x.js'], new Set(['x.js']), new Set(['x.js']), () => Buffer.from('a \n'));
    assert.equal(rows[0].verdict, 'refused');
    assert.match(rows[0].reason, /writer holds uncommitted work/);
  });

  test('fixtures are refused even when cleanly staged', () => {
    const f = 'monitor/test/fixtures/lane/x.json';
    const rows = classify([f], new Set([f]), new Set(), () => Buffer.from('a \n'));
    assert.equal(rows[0].verdict, 'refused');
    assert.match(rows[0].reason, /changes what the test proves/);
  });

  test('binary is refused; unreadable is refused, never guessed clean', () => {
    const bin = classify(['b'], new Set(['b']), new Set(), () => Buffer.from([0x61, 0x00, 0x62]));
    assert.equal(bin[0].verdict, 'refused');
    const err = Object.assign(new Error('nope'), { code: 'EACCES' });
    const unread = classify(['u'], new Set(['u']), new Set(), () => { throw err; });
    assert.equal(unread[0].verdict, 'refused');
    assert.match(unread[0].reason, /could not be read/);
  });

  test('declared-but-unstaged is its own verdict — nothing to protect yet, nothing touched', () => {
    const rows = classify(['y.js'], new Set(), new Set(), () => Buffer.from('a\n'));
    assert.equal(rows[0].verdict, 'not-staged');
  });
});

describe('the CLI against a real repo', () => {
  test('no declared paths is an ERROR naming the shared-index reason — never an implicit all-staged', () => {
    const { d, g } = repo();
    writeFileSync(join(d, 'a.js'), 'x \n');
    g('add', '--', 'a.js');
    const r = run(d, '--check');
    assert.equal(r.code, 2);
    assert.match(r.out, /index is shared/);
  });

  test('--check flags a declared dirty file and exits 1; --write fixes and RESTAGES it', () => {
    const { d, g } = repo();
    writeFileSync(join(d, 'a.js'), 'x  \ny');
    g('add', '--', 'a.js');
    assert.equal(run(d, '--check', '--', 'a.js').code, 1);
    assert.equal(run(d, '--write', '--', 'a.js').code, 0);
    assert.equal(readFileSync(join(d, 'a.js'), 'utf8'), 'x\ny\n');
    // the closure rule: what was formatted is exactly what is staged — no formatted-after-staging drift
    assert.equal(g('diff', '--name-only').trim(), '', 'no unstaged remainder on the formatted file');
    assert.equal(run(d, '--check', '--', 'a.js').code, 0, 'and the re-check is green');
  });

  test('a staged file OUTSIDE the declaration is warned about and never touched — the shared-index rule', () => {
    const { d, g } = repo();
    writeFileSync(join(d, 'mine.js'), 'ok\n');
    writeFileSync(join(d, 'theirs.js'), 'dirty  \n');   // another session's staging
    g('add', '--', 'mine.js', 'theirs.js');
    const r = run(d, '--write', '--', 'mine.js');
    assert.equal(r.code, 0);
    assert.match(r.out, /OUTSIDE your declared set/);
    assert.equal(readFileSync(join(d, 'theirs.js'), 'utf8'), 'dirty  \n', 'their staged bytes are untouched');
  });

  test('mixed staged+unstaged is refused end-to-end and the file is untouched', () => {
    const { d, g } = repo();
    writeFileSync(join(d, 'half.js'), 'staged  \n');
    g('add', '--', 'half.js');
    writeFileSync(join(d, 'half.js'), 'staged  \nunstaged-hunk  \n');   // a writer still holds hunks
    const r = run(d, '--write', '--', 'half.js');
    assert.equal(r.code, 0, 'refusals never fail the phase — sequencing is a human decision');
    assert.match(r.out, /REFUSED half\.js/);
    assert.equal(readFileSync(join(d, 'half.js'), 'utf8'), 'staged  \nunstaged-hunk  \n');
  });

  test('a green check says format-clean is not commit-safe — the pass never over-claims', () => {
    const { d, g } = repo();
    writeFileSync(join(d, 'ok.js'), 'clean\n');
    g('add', '--', 'ok.js');
    const r = run(d, '--check', '--', 'ok.js');
    assert.equal(r.code, 0);
    assert.match(r.out, /not commit-safe|closure over the change set is a separate gate/);
  });
});

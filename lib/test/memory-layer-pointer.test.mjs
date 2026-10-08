import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPointerRecord, describeFile, SUMMARY_WORD_BUDGET } from '../memory-layer-pointer.mjs';

function fixtureRepo({ commit = true, remote = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-pointer-'));
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
  g('init', '-q');
  g('config', 'user.email', 't@example.invalid');
  g('config', 'user.name', 'T');
  mkdirSync(join(dir, 'evaluations'), { recursive: true });
  const files = ['evaluations/HANDOFF.md', 'evaluations/PROMPT.md'];
  for (const f of files) writeFileSync(join(dir, f), `# ${f}\n\n${'body '.repeat(200)}`);
  if (remote) g('remote', 'add', 'origin', remote);
  if (commit) { g('add', '-A'); g('commit', '-q', '-m', 'fixture'); }
  return { dir, files: files.map((f) => join(dir, f)), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the locator survives the 50-word summary budget', () => {
  const r = fixtureRepo({ remote: 'https://example.invalid/x.git' });
  try {
    const p = buildPointerRecord({ repo: r.dir, files: r.files, label: 'handoff', externalId: 'x/1' });
    assert.equal(p.verify.locatorSurvives, true);
    assert.equal(p.verify.survives.repo, true);
    assert.equal(p.verify.survives.commit, true);
    assert.equal(p.verify.survives.paths, true, 'EVERY path, not just the first');
  } finally { r.cleanup(); }
});

test('EVERY path must survive — a partial locator reads like a complete index', () => {
  const r = fixtureRepo({ remote: 'https://example.invalid/x.git' });
  try {
    // Enough files that the path list alone overruns the budget.
    const many = [];
    for (let i = 0; i < 40; i++) {
      const f = join(r.dir, `evaluations/extra-${i}-with-a-fairly-long-name.md`);
      writeFileSync(f, 'x');
      many.push(f);
    }
    const p = buildPointerRecord({ repo: r.dir, files: [...r.files, ...many], externalId: 'x/2' });
    assert.equal(p.verify.survives.paths, false, 'must REPORT the overrun, not quietly point at a subset');
    assert.equal(p.verify.locatorSurvives, false);
  } finally { r.cleanup(); }
});

test('a local-only commit is named as such, in the surviving head', () => {
  const r = fixtureRepo();
  try {
    const p = buildPointerRecord({ repo: r.dir, files: r.files, externalId: 'x/3' });
    assert.equal(p.onRemote, false);
    const surviving = p.record.content.split(/\s+/).slice(0, SUMMARY_WORD_BUDGET).join(' ');
    assert.match(surviving, /LOCAL ONLY/, 'the warning is useless if the summariser eats it');
    assert.match(p.record.content, /NOT on any remote/);
  } finally { r.cleanup(); }
});

test('digests are present but deliberately outside the budget', () => {
  const r = fixtureRepo({ remote: 'https://example.invalid/x.git' });
  try {
    const p = buildPointerRecord({ repo: r.dir, files: r.files, externalId: 'x/4' });
    for (const f of p.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
    // They verify content once found; they do not find it. Losing them costs integrity, not access.
    assert.equal(p.verify.lostToSummary, true);
  } finally { r.cleanup(); }
});

test('the record says POINTER, so it cannot be mistaken for the document', () => {
  const r = fixtureRepo({ remote: 'https://example.invalid/x.git' });
  try {
    const p = buildPointerRecord({ repo: r.dir, files: r.files, externalId: 'x/5' });
    assert.match(p.record.content.slice(0, 40), /POINTER not content/);
    assert.ok(p.record.tags.includes('pointer'));
  } finally { r.cleanup(); }
});

test('an unreadable file throws rather than yielding a plausible row', () => {
  const r = fixtureRepo();
  try {
    assert.throws(() => describeFile(r.dir, join(r.dir, 'evaluations/does-not-exist.md')), /ENOENT/);
    assert.throws(() => buildPointerRecord({ repo: r.dir, files: [join(r.dir, 'nope.md')], externalId: 'x/6' }), /ENOENT/);
  } finally { r.cleanup(); }
});

test('a record with no files, or no repo, is refused', () => {
  assert.throws(() => buildPointerRecord({ repo: '/tmp', files: [], externalId: 'x' }), /at least one file/);
  assert.throws(() => buildPointerRecord({ repo: '', files: ['/tmp/x'], externalId: 'x' }), /repo is required/);
});

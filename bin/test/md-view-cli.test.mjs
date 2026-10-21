import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'md-view.mjs');

function run(args, env = {}) {
  const reports = env.CW_REPORTS_DIR ?? mkdtempSync(join(tmpdir(), 'md-view-reports-'));
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CW_MD_VIEW_NO_OPEN: '1', ...env, CW_REPORTS_DIR: reports },
  });
  return { ...r, reports };
}

const fixture = (md) => {
  const dir = mkdtempSync(join(tmpdir(), 'md-view-src-'));
  const file = join(dir, 'Sample.md');
  writeFileSync(file, md);
  return { dir, file };
};

describe('bin/md-view.mjs', () => {
  test('writes the page and prints its path; a file outside the repo lands under external/', () => {
    const { file } = fixture('# Sample\n\n`#c9a227`\n');
    const r = run([file]);
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout.trim();
    assert.equal(out, join(r.reports, 'md-view', 'external', 'Sample.html'));
    assert.match(readFileSync(out, 'utf8'), /<title>Sample<\/title>/);
  });

  test('--out writes exactly where it is told', () => {
    const { dir, file } = fixture('# x\n');
    const target = join(dir, 'nested', 'page.html');
    const r = run([file, '--out', target]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(target));
  });

  test('a missing input exits 2 and writes nothing', () => {
    const r = run([join(tmpdir(), 'md-view-no-such-file.md')]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read .*ENOENT/);
    assert.equal(existsSync(join(r.reports, 'md-view')), false);
  });

  test('an unknown flag is a usage error, never a run', () => {
    const { file } = fixture('# x\n');
    const r = run([file, '--frobnicate']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown option --frobnicate/);
    assert.equal(existsSync(join(r.reports, 'md-view')), false);
  });

  test('--help prints usage and does nothing else', () => {
    const r = run(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^usage: node bin\/md-view\.mjs/);
    assert.equal(existsSync(join(r.reports, 'md-view')), false);
  });

  test('an absent fonts directory is a legitimate absence: the page renders on the system stack', () => {
    const { file } = fixture('# x\n');
    const empty = mkdtempSync(join(tmpdir(), 'md-view-fonts-'));
    const r = run([file], { CW_MD_VIEW_FONTS_DIR: join(empty, 'missing') });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(readFileSync(r.stdout.trim(), 'utf8'), /@font-face/);
  });

  test('a relative image beside the document is inlined; a relative link becomes a file:// URL', () => {
    const { dir, file } = fixture('![dot](img/dot.png)\n\n[sibling](other.md#part)\n');
    mkdirSync(join(dir, 'img'));
    writeFileSync(join(dir, 'img', 'dot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const r = run([file]);
    const html = readFileSync(r.stdout.trim(), 'utf8');
    assert.match(html, /<img alt="dot" src="data:image\/png;base64,iVBORw==">/);
    assert.match(html, /href="file:\/\/[^"]*\/other\.md#part"/);
  });

  test('writes atomically: no temp file is left beside the page', () => {
    const { file } = fixture('# x\n');
    const r = run([file]);
    const dir = dirname(r.stdout.trim());
    assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  });
});

test('the opener hands the path to a program as one argument, never to a shell', async () => {
  const { openerFor } = await import('../md-view.mjs');
  const path = 'C:\\out\\a&calc.html';
  for (const platform of ['darwin', 'win32', 'linux']) {
    const [cmd, args] = openerFor(path, platform);
    assert.ok(!/^(cmd|sh|bash|powershell)(\.exe)?$/i.test(cmd), `${platform} opens through ${cmd}`);
    assert.deepEqual(args, [path], platform);
  }
});

// bin/lib/webroot.mjs and `commitwork brief --webroot`: a deployed site or a backup scanned in
// place, git or not, with what the tree cannot show listed rather than read as clean.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeWebroot, wordpressLayout, wordpressCoreVersion } from '../lib/webroot.mjs';
import { buildBrief, renderBriefMarkdown } from '../lib/brief.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function tree(files, name = 'site') {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cw-webroot-')));
  roots.push(base);
  const root = join(base, name);
  mkdirSync(root, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

describe('describeWebroot', () => {
  test('a wp-content backup names the absent core and the unexamined web root', () => {
    const root = tree({ 'plugins/index.php': '<?php', 'themes/t/style.css': '', 'index.php': '<?php' }, 'wp-content');
    const d = describeWebroot(root);
    assert.equal(d.git, false);
    assert.equal(d.platform, 'wordpress');
    assert.deepEqual(d.wordpress, { layout: 'wp-content', core: 'absent', version: null });
    assert.ok(d.notMeasured.some((n) => /core is not in the scanned tree/.test(n.reason)));
    assert.ok(d.notMeasured.some((n) => /not a git repository/.test(n.reason)));
  });

  test('a site root reads the core version from wp-includes/version.php', () => {
    const root = tree({ 'wp-includes/version.php': "<?php\n$wp_version = '6.9.0';\n", 'wp-content/plugins/index.php': '' });
    const d = describeWebroot(root);
    assert.deepEqual(d.wordpress, { layout: 'site-root', core: 'present', version: '6.9.0' });
    assert.ok(!d.notMeasured.some((n) => /core/.test(n.reason)));
  });

  test('a site root whose version file says nothing is a void, not a version', () => {
    const root = tree({ 'wp-includes/version.php': '<?php // emptied', 'wp-config.php': '<?php' });
    const d = describeWebroot(root);
    assert.equal(d.wordpress.core, 'unreadable');
    assert.ok(d.notMeasured.some((n) => n.kind === 'void'));
    assert.equal(wordpressCoreVersion(tree({})), null, 'absent is null, never a guess');
  });

  test('a git repository that is not a CMS adds nothing', () => {
    const root = tree({ '.git/HEAD': 'ref: refs/heads/main\n', 'src/a.js': '' });
    assert.deepEqual(describeWebroot(root), { git: true, platform: null, notMeasured: [] });
    assert.equal(wordpressLayout(root), null);
  });
});

describe('the brief carries target-level gaps', () => {
  test('target.notMeasured rows reach notMeasured and the markdown', () => {
    const run = mkdtempSync(join(tmpdir(), 'cw-webroot-run-'));
    roots.push(run);
    mkdirSync(join(run, 'site'), { recursive: true });
    const b = buildBrief({ runDir: run, rows: [{ repo: '/x/site', slug: 'site', cells: {} }], kev: { usable: false }, epss: new Map(),
      generatedAt: '2026-10-08T00:00:00.000Z',
      target: { mode: 'webroot', name: 'site', notMeasured: [{ check: 'target', kind: 'scope', reason: 'core is not in the scanned tree' }] } });
    assert.deepEqual(b.notMeasured, [{ repo: 'site', check: 'target', kind: 'scope', reason: 'core is not in the scanned tree' }]);
    assert.equal(b.counts.notMeasured, 1);
    assert.match(renderBriefMarkdown(b), /\| site \| target \| scope \| core is not in the scanned tree \|/);
  });
});

describe('commitwork brief --webroot', () => {
  const cli = (args, env = {}) => spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } });

  test('a directory with no .git is refused without --webroot and named with it', () => {
    const root = tree({ 'plugins/index.php': '<?php', 'themes/t/style.css': '', 'index.php': '' }, 'wp-content');
    const out = mkdtempSync(join(tmpdir(), 'cw-webroot-out-'));
    roots.push(out);
    const without = cli(['brief', root, '--out', join(out, 'a'), '--dry-run']);
    assert.notEqual(without.status, 0);
    assert.match(without.stderr + without.stdout, /--webroot/);
    const withIt = cli(['brief', root, '--webroot', '--out', join(out, 'b'), '--dry-run']);
    assert.equal(withIt.status, 0, withIt.stderr);
    assert.ok(withIt.stdout.includes(root), withIt.stdout);
    assert.match(withIt.stdout, /not measured: WordPress wp-content only/);
  });

  test('--webroot needs one named directory', () => {
    const r = cli(['brief', '--webroot', '--dry-run']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /scans one named directory/);
  });
});

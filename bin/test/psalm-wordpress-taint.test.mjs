// The sast-php-psalm lane's WordPress taint stub, driven through the lane's own command with the
// real psalm. Measured 2026-10-08: without the stub psalm reports nothing on this fixture; with it,
// the injectable query and only that one.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CMD = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8')).checks.find((c) => c.id === 'sast-php-psalm').local[0];
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const PLUGIN = `<?php
/*
 * Plugin Name: commitwork taint canary
 */
function cw_canary_injectable() {
    global $wpdb;
    $id = wp_unslash($_GET['id']);
    $wpdb->query("DELETE FROM {$wpdb->prefix}t WHERE id = $id");
}
function cw_canary_prepared() {
    global $wpdb;
    $id = $_GET['id'];
    $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->prefix}t WHERE id = %s", $id));
    echo esc_html($_GET['n']);
}
`;

const psalmPresent = () => ['psalm', join(process.env.HOME || '', '.composer/vendor/bin/psalm')].some((b) => spawnSync(b, ['--version'], { encoding: 'utf8' }).status === 0);

function runLane(files, cwRoot, extraEnv = {}) {
  const base = mkdtempSync(join(tmpdir(), 'cw-psalm-wp-'));
  roots.push(base);
  const tree = join(base, 'tree'); const report = join(base, 'report');
  mkdirSync(tree); mkdirSync(report);
  for (const [name, body] of Object.entries(files)) { mkdirSync(join(tree, name, '..'), { recursive: true }); writeFileSync(join(tree, name), body); }
  spawnSync('sh', ['-c', CMD], { cwd: tree, encoding: 'utf8', timeout: 240000, env: { ...process.env, CW_REPO_TRUSTED: '0', CW_ROOT: cwRoot, CW_REPORT_DIR: report, ...extraEnv } });
  const log = readFileSync(join(report, 'psalm.log'), 'utf8');
  const autoloadRan = (() => { try { readFileSync(join(report, 'autoload-ran')); return true; } catch { return false; } })();
  let results = null;
  try {
    const s = JSON.parse(readFileSync(join(report, 'psalm.sarif'), 'utf8'));
    const names = Object.fromEntries((s.runs[0].tool.driver.rules || []).map((r) => [r.id, r.name]));
    results = s.runs[0].results.map((r) => [names[r.ruleId] || r.ruleId, r.locations[0].physicalLocation.region.startLine]);
  } catch { results = null; }
  return { log, results, autoloadRan };
}

describe('psalm on a WordPress tree loads commitwork\'s taint stub', { skip: process.platform === 'win32' ? 'needs a POSIX sh' : false }, () => {
  test('the injectable query is found through wp_unslash; prepare() and esc_html() are escapes', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — the lane is NOT measured, which is not a pass');
    const { log, results } = runLane({ 'canary.php': PLUGIN }, ROOT);
    assert.match(log, /^WORDPRESS: commitwork taint stub loaded/m);
    assert.deepEqual(results, [['TaintedSql', 8]]);
  });

  test('without the stub the same tree yields nothing — the stub is what finds it', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const { log, results } = runLane({ 'canary.php': PLUGIN }, join(tmpdir(), 'cw-no-such-root'));
    assert.doesNotMatch(log, /WORDPRESS:/);
    assert.deepEqual(results, []);
  });

  test('a PHP tree with no WordPress marker does not get the stub', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const { log } = runLane({ 'app.php': '<?php\nfunction f() { return 1; }\n' }, ROOT);
    assert.doesNotMatch(log, /WORDPRESS:/);
  });
});

// Full mode requires the scanned tree's vendor/autoload.php, and composer's autoloader runs code the
// tree supplies. That is the operator's call (--trust-repo-manifest), never the default: a scanned
// WordPress theme's own autoloader crashed psalm on 2026-10-08, and a compromised tree's would run.
describe('psalm full mode runs the tree\'s autoloader only with the operator\'s consent', { skip: process.platform === 'win32' ? 'needs a POSIX sh' : false }, () => {
  const THEME = {
    'style.css': '/*\nTheme Name: commitwork canary theme\n*/\n',
    'functions.php': PLUGIN,
  };
  const withAutoload = (tree) => ({ ...tree, 'vendor/autoload.php': "<?php file_put_contents(getenv('CW_REPORT_DIR') . '/autoload-ran', '1');\n" });

  test('untrusted: the autoloader is never executed, the run is degraded with the reason, and the stub still finds the injection', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const { log, results, autoloadRan } = runLane(withAutoload(THEME), ROOT);
    assert.equal(autoloadRan, false, 'the scanned tree\'s autoloader ran without consent');
    assert.match(log, /^UNTRUSTED: vendor\/autoload\.php is present/m);
    assert.match(log, /^WORDPRESS:/m);
    assert.deepEqual(results, [['TaintedSql', 8]]);
  });

  test('trusted: full mode, and the autoloader runs — which is exactly why it needs consent', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const { log, autoloadRan } = runLane(withAutoload(THEME), ROOT, { CW_REPO_TRUSTED: '1' });
    assert.match(log, /^MODE: full/m);
    assert.equal(autoloadRan, true);
  });
});

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

  test('REST params, shortcode attributes and maybe_unserialize are traced; a prepare() template is the sink', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const src = `<?php
/* Plugin Name: commitwork wp sources canary */
function cw_rest(WP_REST_Request $request) { global $wpdb; $id = $request->get_param('id'); $wpdb->query("DELETE FROM t WHERE id = $id"); }
function cw_sc($atts) { $a = shortcode_atts(array('t' => ''), $atts); echo $a['t']; }
function cw_mu() { maybe_unserialize($_COOKIE['c']); }
function cw_tpl() { global $wpdb; $o = $_GET['o']; $wpdb->get_results($wpdb->prepare("SELECT * FROM t ORDER BY $o LIMIT %d", 5)); }
function cw_const() { global $wpdb; $wpdb->query($wpdb->prepare("SELECT 1 WHERE a = %s", $_GET['a'])); }
`;
    const { results } = runLane({ 'wp.php': src }, ROOT);
    assert.deepEqual(results.filter(([r]) => r !== 'TaintedTextWithQuotes'), [['TaintedSql', 3], ['TaintedHtml', 4], ['TaintedUnserialize', 5], ['TaintedSql', 6]]);
  });

  const SINKS = `<?php
/* Plugin Name: commitwork wp sinks canary */
function cw_key() { update_option($_POST['k'], 1); }
function cw_key_value_only() { update_option('cw_fixed', wp_unslash($_POST['v'])); }
function cw_key_prefixed() { update_option('cw_' . sanitize_key($_POST['k']), 1); }
function cw_key_suffixed() { update_option($_POST['k'] . '_cw', 1); }
function cw_meta() { update_user_meta(get_current_user_id(), $_GET['m'], 1); }
function cw_rest_key(WP_REST_Request $request) { update_option($request->get_param('name'), 1); }
function cw_redirect() { wp_redirect(wp_unslash($_GET['to'])); }
function cw_redirect_validated() { wp_redirect(wp_validate_redirect(wp_unslash($_GET['to']), '/')); }
function cw_redirect_admin() { wp_redirect(admin_url('admin.php?page=' . $_GET['p'])); }
function cw_redirect_same_origin() { wp_redirect('/wp-admin/admin.php?page=' . $_GET['p']); }
function cw_redirect_protocol_relative() { wp_redirect('/' . $_GET['p']); }
function cw_redirect_open_host() { wp_redirect('https://fixed.example' . $_GET['p']); }
function cw_ssrf() { wp_remote_get(esc_url_raw($_GET['u'])); }
function cw_ssrf_pinned() { wp_remote_get('https://api.fixed.example/v1/' . $_GET['u']); }
function cw_hook() { do_action($_REQUEST['hook']); }
function cw_sql_esc_sql() { global $wpdb; $wpdb->query("DELETE FROM t WHERE s = '" . esc_sql(wp_unslash($_GET['s'])) . "'"); }
function cw_html_after_esc_sql() { echo esc_sql(wp_unslash($_GET['s'])); }
function cw_post_meta() { update_post_meta(1, $_POST['k'], 1); }
function cw_post_meta_prefixed() { update_post_meta(1, 'cw_' . $_POST['k'], 1); }
`;

  test('request-chosen option names, user and post meta keys, redirect targets, remote URLs and hook names are traced', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const { log, results } = runLane({ 'wp.php': SINKS }, ROOT);
    assert.match(log, /^WORDPRESS: taint plugin loaded/m);
    assert.deepEqual(results.filter(([r]) => r !== 'TaintedTextWithQuotes'), [
      ['TaintedCustom', 3], ['TaintedCustom', 6], ['TaintedCustom', 7], ['TaintedCustom', 8], ['TaintedCustom', 9],
      ['TaintedCustom', 13], ['TaintedCustom', 14], ['TaintedSSRF', 15], ['TaintedCallable', 17], ['TaintedHtml', 19], ['TaintedCustom', 20],
    ]);
  });

  test('a stub pass-through is specialized per call site: one call\'s input never leaves another, and every path to a sink is reported', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const src = `<?php
/* Plugin Name: commitwork call-site canary */
function cw_a() { $x = wp_unslash($_GET['q']); echo esc_html($x); }
function cw_b() { echo wp_unslash('constant'); }
function cw_c() { global $wpdb; $wpdb->query('SELECT 1 FROM t WHERE a = ' . wp_unslash($_GET['a'])); }
function cw_d() { global $wpdb; $wpdb->query('SELECT 1 FROM t WHERE b = ' . wp_unslash($_POST['b'])); }
function cw_e() { global $wpdb; $wpdb->query('SELECT 1 FROM t WHERE c = ' . sanitize_text_field($_GET['c'])); }
function cw_f() { echo sanitize_text_field('constant'); }
`;
    const { results } = runLane({ 'wp.php': src }, ROOT);
    assert.deepEqual(results.filter(([r]) => r !== 'TaintedTextWithQuotes'), [['TaintedSql', 5], ['TaintedSql', 6], ['TaintedSql', 7]]);
  });

  test('a stub without its plugin says the superglobal option and redirect flows are NOT traced', (t) => {
    if (!psalmPresent()) return t.skip('psalm is not installed here — NOT measured');
    const partial = mkdtempSync(join(tmpdir(), 'cw-psalm-wp-root-'));
    roots.push(partial);
    mkdirSync(join(partial, 'manifests', 'psalm'), { recursive: true });
    writeFileSync(join(partial, 'manifests', 'psalm', 'wordpress-taint.phpstub'), readFileSync(join(ROOT, 'manifests', 'psalm', 'wordpress-taint.phpstub')));
    const { log, results } = runLane({ 'wp.php': SINKS }, partial);
    assert.match(log, /^WORDPRESS: taint plugin MISSING .* NOT traced$/m);
    assert.ok(results.some(([r, line]) => r === 'TaintedCustom' && line === 8), 'the REST source carries its kinds from the stub alone');
    assert.ok(!results.some(([r, line]) => r === 'TaintedCustom' && line === 3), 'a superglobal option name was reported without the plugin');
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

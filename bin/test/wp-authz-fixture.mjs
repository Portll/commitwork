// A synthetic WordPress plugin for bin/test/wp-authz.test.mjs, written to a temporary directory at test
// time. Each handler is a planted access-control defect or its guarded twin; the comment beside each
// registration names what bin/wp-authz.mjs must make of it. Nothing here is ever loaded by PHP: the
// lane parses it as data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAIN = `<?php
/*
 * Plugin Name: CW Authz Fixture
 * Description: Synthetic and inert.
 */
class CwAuthzFixture {
    const NONCE = 'cw_fx_settings';
    public function __construct() {
        add_action('wp_ajax_nopriv_cw_fx_vote', array($this, 'vote'));          // nopriv-unguarded
        add_action('wp_ajax_cw_fx_store', [$this, 'store']);                     // ajax-unguarded (option name from the request)
        add_action('wp_ajax_cw_fx_store_safe', [$this, 'store_safe']);           // set aside: capability
        add_action('wp_ajax_cw_fx_settings', [$this, 'save_settings']);          // set aside: nonce minted on a manage_options page
        add_action('wp_ajax_cw_fx_profile', [$this, 'save_profile']);            // nonce-only, the nonce is minted in a shortcode
        add_action('wp_ajax_cw_fx_toggle', [$this, 'toggle']);                   // ajax-unguarded (allowlisted option name)
        add_action('wp_ajax_nopriv_cw_fx_ping', [$this, 'ping']);                // set aside: a server-keyed cache is not a write
        add_action('wp_ajax_nopriv_cw_fx_flush', [$this, 'flush']);              // triggered-write, the one rule that publishes (low)
        add_action('admin_init', [$this, 'maybe_reset']);                        // hook-request-write
        add_action('admin_init', [$this, 'maybe_reset_safe']);                   // set aside: capability
        add_action('load-settings_page_cw-fx', [$this, 'on_load']);              // set aside: core checks the page first
        add_action('admin_menu', [$this, 'menu']);
        add_shortcode('cw_fx_profile', [$this, 'profile_form']);
        add_action('rest_api_init', [$this, 'routes']);
    }
    public function vote() { $id = absint($_POST['poll']); update_option('cw_fx_votes_' . $id, sanitize_text_field(wp_unslash($_POST['choice']))); wp_die(); }
    public function store() { $this->persist($_POST['name'], $_POST['value']); }
    private function persist($name, $value) { CwAuthzStore::put($name, $value); }
    public function store_safe() { check_ajax_referer('cw_fx_store'); if (!current_user_can('manage_options')) { wp_die(); } update_option('cw_fx_store', sanitize_text_field($_POST['value'])); }
    public function save_settings() { check_ajax_referer(self::NONCE); update_option('cw_fx_settings', $_POST['settings']); }
    public function save_profile() { check_ajax_referer('cw_fx_profile'); update_user_meta(get_current_user_id(), 'cw_fx_bio', $_POST['bio']); }
    public function toggle() { $allowed = array('cw_fx_a' => 1, 'cw_fx_b' => 1); $k = $_POST['key']; if (!isset($allowed[$k])) { wp_die(); } update_option($k, $_POST['on'] ? 'yes' : 'no'); }
    public function flush() { delete_option('cw_fx_settings'); wp_die(); }
    public function ping() { set_transient('cw_fx_last_ping', time(), 60); wp_send_json_success(); }
    public function maybe_reset() { if (isset($_GET['cw_fx_reset'])) { delete_option('cw_fx_settings'); } }
    public function maybe_reset_safe() { if (isset($_GET['cw_fx_reset2']) && current_user_can('manage_options')) { delete_option('cw_fx_other'); } }
    public function on_load() { if (isset($_POST['cw_fx_import'])) { update_option('cw_fx_settings', $_POST['cw_fx_import']); } }
    public function menu() { add_options_page('CW', 'CW', 'manage_options', 'cw-fx', [$this, 'page']); }
    public function page() { wp_nonce_field(self::NONCE); }
    public function profile_form() { return wp_create_nonce('cw_fx_profile'); }
    public function routes() {
        register_rest_route('cw-fx/v1', '/color', array('methods' => 'POST', 'callback' => array($this, 'set_color')));   // rest-unguarded
        register_rest_route('cw-fx/v1', '/note', array('methods' => 'POST', 'callback' => array($this, 'add_note'), 'permission_callback' => '__return_true'));   // rest-public-write
        register_rest_route('cw-fx/v1', '/color-safe', array('methods' => 'POST', 'callback' => array($this, 'set_color'), 'permission_callback' => array($this, 'can_manage')));   // set aside
        register_rest_route('cw-fx/v1', '/status', array('methods' => 'GET', 'callback' => array($this, 'status')));   // rest-no-permission-callback
    }
    public function set_color($request) { global $wpdb; $wpdb->update($wpdb->prefix . 'cw_fx', array('color' => $request->get_param('color')), array('id' => 1)); }
    public function add_note($request) { wp_insert_post(array('post_title' => $request['title'], 'post_status' => 'draft')); }
    public function can_manage() { return current_user_can('manage_options'); }
    public function status() { return array('ok' => true); }
}
new CwAuthzFixture();
function cw_fx_discarded() { wp_verify_nonce($_POST['n'], 'cw_fx'); if (!check_ajax_referer('cw_fx_checked', 'n', false)) { return; } }
`;

// a second file, so the option write is reached across a file boundary
export const STORE = `<?php
class CwAuthzStore {
    public static function put($name, $value) { update_option($name, $value); }
}
`;

/** Write the plugin under dir/cw-authz-fixture; returns that directory. */
export function writeFixture(dir) {
  const root = join(dir, 'cw-authz-fixture');
  mkdirSync(join(root, 'includes'), { recursive: true });
  writeFileSync(join(root, 'cw-authz-fixture.php'), MAIN);
  writeFileSync(join(root, 'includes', 'class-store.php'), STORE);
  return root;
}

// Expected rows as (rule, handler, hook); severity is checked separately because it depends on which
// rules publish.
export const EXPECTED = [
  ['wp-ajax-unguarded-write', 'CwAuthzFixture::store', 'wp_ajax_cw_fx_store'],
  ['wp-ajax-unguarded-write', 'CwAuthzFixture::toggle', 'wp_ajax_cw_fx_toggle'],
  ['wp-check-discarded', 'cw_fx_discarded', 'wp_verify_nonce'],
  ['wp-hook-request-write', 'CwAuthzFixture::maybe_reset', 'admin_init'],
  ['wp-nonce-only-write', 'CwAuthzFixture::save_profile', 'wp_ajax_cw_fx_profile'],
  ['wp-nopriv-unguarded-write', 'CwAuthzFixture::vote', 'wp_ajax_nopriv_cw_fx_vote'],
  ['wp-rest-no-permission-callback', 'CwAuthzFixture::status', 'cw-fx/v1/status'],
  ['wp-rest-public-write', 'CwAuthzFixture::add_note', 'cw-fx/v1/note'],
  ['wp-rest-unguarded-write', 'CwAuthzFixture::set_color', 'cw-fx/v1/color'],
  ['wp-triggered-write', 'CwAuthzFixture::flush', 'wp_ajax_nopriv_cw_fx_flush'],
];

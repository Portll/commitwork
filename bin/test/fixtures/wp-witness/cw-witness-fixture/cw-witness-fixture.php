<?php
/**
 * Plugin Name: CW Witness Fixture
 * Description: Synthetic runnable fixture for bin/wp-dynamic-witness.mjs. Carries the broken- and
 *   correct-access-control shapes the witness must separate: unauthenticated and no-capability
 *   mutations that MUST confirm, and nonce/capability-gated twins that MUST NOT. Synthetic data
 *   only — no customer material. Unlike a static-analysis fixture this one actually registers its
 *   hooks, so a disposable WordPress exposes a real attack surface to drive.
 */
if (!defined('ABSPATH')) { exit; }

class CW_Witness_Fixture {
    public function __construct() {
        // BROKEN: unauthenticated ajax writes an option.
        add_action('wp_ajax_nopriv_cw_save', array($this, 'unauth_save'));
        // BROKEN: any logged-in user (subscriber+) writes a request-CHOSEN option — no capability.
        add_action('wp_ajax_cw_nocap', array($this, 'nocap_save'));
        // CORRECT twin: nonce + manage_options before the identical write.
        add_action('wp_ajax_cw_safe', array($this, 'safe_save'));
        // BROKEN: a GET on an admin hook deletes an option with no nonce or capability.
        add_action('admin_init', array($this, 'maybe_reset'));
        add_action('rest_api_init', array($this, 'routes'));
    }

    public function unauth_save() {
        update_option('cw_fx_setting', isset($_POST['v']) ? $_POST['v'] : 'set');
        wp_die('ok');
    }

    public function nocap_save() {
        $k = isset($_POST['key']) ? $_POST['key'] : '';
        if ($k !== '') { update_option($k, isset($_POST['v']) ? $_POST['v'] : 'set'); }
        wp_die('ok');
    }

    public function safe_save() {
        check_ajax_referer('cw_safe');
        if (!current_user_can('manage_options')) { wp_die('nope'); }
        update_option('cw_fx_setting', sanitize_text_field($_POST['v']));
        wp_die('ok');
    }

    public function maybe_reset() {
        if (isset($_GET['cw_reset'])) { delete_option('cw_fx_setting'); }
    }

    public function routes() {
        // BROKEN: open REST write (permission_callback __return_true).
        register_rest_route('cwfx/v1', '/save', array(
            'methods' => 'POST',
            'callback' => array($this, 'rest_save'),
            'permission_callback' => '__return_true',
        ));
        // CORRECT twin: same write behind manage_options.
        register_rest_route('cwfx/v1', '/safe', array(
            'methods' => 'POST',
            'callback' => array($this, 'rest_save'),
            'permission_callback' => function () { return current_user_can('manage_options'); },
        ));
    }

    public function rest_save($request) {
        $v = $request->get_param('value');
        update_option('cw_rest_opt', is_null($v) ? 'set' : $v);
        return array('ok' => true);
    }
}

new CW_Witness_Fixture();

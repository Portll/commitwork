<?php
/**
 * commitwork dynamic access-control witness — trusted snapshot/helper mu-plugin.
 *
 * bin/wp-dynamic-witness.mjs mounts this into wp-content/mu-plugins of a DISPOSABLE WordPress. It is
 * commitwork's own trusted code, NOT part of the scanned plugin: it takes the before/after state
 * snapshots the oracle (lib/wp-witness-oracle.mjs) diffs, and sets up the subscriber role and nonces
 * the witness needs. Every control request is gated by a per-run token so nothing here is reachable
 * except from the driver that minted it.
 *
 * Plugin Name: CW Witness Oracle
 */
if (!defined('ABSPATH')) { exit; }

function cw_oracle_token() { return defined('CW_WITNESS_TOKEN') ? CW_WITNESS_TOKEN : ''; }

// Early, but after pluggable functions exist, so wp_create_nonce / current_user reflect the caller's
// cookies. A request without __cw falls straight through to normal WordPress.
add_action('init', 'cw_oracle_router', 0);

function cw_oracle_router() {
    if (!isset($_GET['__cw'])) { return; }
    $tok = isset($_GET['__cwtoken']) ? (string) $_GET['__cwtoken'] : '';
    if (cw_oracle_token() === '' || !hash_equals(cw_oracle_token(), $tok)) {
        status_header(403);
        header('Content-Type: application/json');
        echo json_encode(array('error' => 'token'));
        exit;
    }
    header('Content-Type: application/json');
    $op = (string) $_GET['__cw'];
    switch ($op) {
        case 'ping':
            echo json_encode(array('ok' => 1, 'wp' => get_bloginfo('version')));
            break;
        case 'setup':
            echo json_encode(cw_oracle_setup());
            break;
        case 'snapshot':
            echo json_encode(cw_oracle_snapshot());
            break;
        case 'nonce':
            $a = isset($_GET['action']) ? (string) $_GET['action'] : '-1';
            echo json_encode(array('nonce' => wp_create_nonce($a), 'uid' => get_current_user_id()));
            break;
        case 'whoami':
            $u = wp_get_current_user();
            echo json_encode(array('uid' => $u->ID, 'roles' => $u->roles));
            break;
        default:
            status_header(400);
            echo json_encode(array('error' => 'op'));
    }
    exit;
}

function cw_oracle_setup() {
    $out = array('steps' => array());
    $u = get_user_by('login', 'cwsubscriber');
    if (!$u) {
        $id = wp_insert_user(array(
            'user_login' => 'cwsubscriber',
            'user_pass'  => 'cwsubscriberpass!23',
            'role'       => 'subscriber',
            'user_email' => 'cwsub@example.invalid',
        ));
        $out['subUid'] = is_wp_error($id) ? null : (int) $id;
        $out['steps'][] = is_wp_error($id) ? ('subscriber-error:' . $id->get_error_message()) : 'created-subscriber';
    } else {
        $out['subUid'] = (int) $u->ID;
        $out['steps'][] = 'subscriber-exists';
    }
    global $wp_rewrite;
    update_option('permalink_structure', '/%postname%/');
    if ($wp_rewrite) { $wp_rewrite->set_permalink_structure('/%postname%/'); $wp_rewrite->flush_rules(false); }
    $out['steps'][] = 'permalinks';
    if (defined('CW_WITNESS_PLUGIN') && CW_WITNESS_PLUGIN) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        $r = activate_plugin(CW_WITNESS_PLUGIN);
        $out['activate'] = is_wp_error($r) ? $r->get_error_message() : 'ok';
        $out['active'] = get_option('active_plugins');
    }
    if (!get_page_by_path('cw-witness-post', OBJECT, 'post')) {
        wp_insert_post(array('post_title' => 'cw-witness-post', 'post_name' => 'cw-witness-post', 'post_status' => 'publish', 'post_content' => 'x'));
    }
    return $out;
}

// A scalar per value: md5 of the whole value (so any change is detected) plus a short preview for
// evidence, joined by \x01. The oracle compares the scalar; the driver splits the preview out.
function cw_oracle_enc($v) {
    $s = is_null($v) ? '' : (string) $v;
    // A sentinel anywhere in the value is named in the preview, so a long value whose sentinel sits
    // past the first 160 bytes is still attributable by the driver.
    $hit = (stripos($s, 'cwprobe') !== false || stripos($s, 'cwwitness') !== false || stripos($s, 'cwssrf') !== false) ? 'cwprobe-in-value ' : '';
    return md5($s) . "\x01" . $hit . substr($s, 0, 160);
}

function cw_oracle_snapshot() {
    global $wpdb;
    $snap = array('options' => array(), 'usermeta' => array(), 'posts' => array(), 'postmeta' => array(), 'tables' => array(), 'files' => array(), '_meta' => array());

    foreach ($wpdb->get_results("SELECT option_name, option_value FROM {$wpdb->options}", ARRAY_A) as $r) {
        $snap['options'][$r['option_name']] = cw_oracle_enc($r['option_value']);
    }
    foreach ($wpdb->get_results("SELECT user_id, meta_key, meta_value FROM {$wpdb->usermeta}", ARRAY_A) as $r) {
        $snap['usermeta'][$r['user_id'] . "\t" . $r['meta_key']] = cw_oracle_enc($r['meta_value']);
    }
    foreach ($wpdb->get_results("SELECT ID, post_type, post_status, post_author, post_title, post_content FROM {$wpdb->posts}", ARRAY_A) as $r) {
        $snap['posts'][$r['ID']] = $r['post_type'] . '|' . $r['post_status'] . '|' . $r['post_author'] . '|' . md5($r['post_title'] . $r['post_content']);
    }
    foreach ($wpdb->get_results("SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta}", ARRAY_A) as $r) {
        $snap['postmeta'][$r['post_id'] . "\t" . $r['meta_key']] = cw_oracle_enc($r['meta_value']);
    }

    // Non-core tables: a plugin that keeps state in its own table shows up here as a rowcount+hash.
    // Fail closed — if the table list cannot be enumerated we SAY SO rather than imply zero.
    $snap['_meta']['tablesEnumerated'] = false;
    $core = array($wpdb->options, $wpdb->usermeta, $wpdb->posts, $wpdb->postmeta, $wpdb->users,
        $wpdb->terms, $wpdb->term_taxonomy, $wpdb->term_relationships, $wpdb->termmeta,
        $wpdb->comments, $wpdb->commentmeta, $wpdb->links);
    $names = array();
    $rows = $wpdb->get_results("SHOW TABLES", ARRAY_N);
    if (is_array($rows) && count($rows)) {
        foreach ($rows as $row) { $names[] = $row[0]; }
        $snap['_meta']['tablesEnumerated'] = true;
    } else {
        $alt = $wpdb->get_results("SELECT name FROM sqlite_master WHERE type='table'", ARRAY_N);
        if (is_array($alt) && count($alt)) { foreach ($alt as $row) { $names[] = $row[0]; } $snap['_meta']['tablesEnumerated'] = true; }
    }
    foreach ($names as $t) {
        if (in_array($t, $core, true)) { continue; }
        if (strpos($t, 'sqlite_') === 0 || $t === '_mysql_data_types') { continue; }
        // One entry per ROW, keyed by a hash of its content: an UPDATE then shows as a row removed
        // and a row added (a rowcount/rowid hash cannot see a value change at all).
        $rows = $wpdb->get_results("SELECT * FROM `" . str_replace('`', '', $t) . "` LIMIT 2001", ARRAY_A);
        if (!is_array($rows)) { $snap['_meta']['tableErrors'][] = $t; continue; }
        if (count($rows) > 2000) { $snap['_meta']['tablesCapped'][] = $t; $rows = array_slice($rows, 0, 2000); }
        foreach ($rows as $row) {
            $j = json_encode($row);
            $snap['tables'][$t . "\t" . md5($j)] = cw_oracle_enc($j);
        }
    }

    // Files under wp-content. The static, large and binary subtrees are excluded by prefix: our own
    // mu-plugin, the SQLite database, caches and the WordPress/plugin SOURCE. What remains is where a
    // request-driven write actually lands (uploads, generated config), kept small enough to re-hash
    // on every snapshot. The exclusions are declared in _meta so a missed write is not read as clean.
    $base = defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR : (ABSPATH . 'wp-content');
    $excl = array('/mu-plugins/', '/database/', '/cache/', '/upgrade/', '/plugins/', '/themes/');
    // WordPress's own logging sinks are NOT plugin state: a handler that errors writes debug.log,
    // which is a crash symptom, not the privileged mutation the witness is asking about. Excluding
    // these by BASENAME (anywhere under wp-content) stops the oracle confirming on a logged notice.
    $exclNames = array('debug.log', 'error_log', '.maintenance', 'object-cache.php', 'advanced-cache.php');
    $snap['_meta']['fileExcludedPrefixes'] = $excl;
    $snap['_meta']['fileExcludedNames'] = $exclNames;
    $snap['_meta']['fileBase'] = $base;
    $count = 0; $capped = false;
    if (is_dir($base)) {
        try {
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS));
            foreach ($it as $f) {
                if (!$f->isFile()) { continue; }
                $rel = substr($f->getPathname(), strlen($base));
                $rel = str_replace('\\', '/', $rel);
                $skip = false;
                foreach ($excl as $p) { if (strpos($rel, $p) === 0) { $skip = true; break; } }
                if (!$skip && in_array($f->getFilename(), $exclNames, true)) { $skip = true; }
                if ($skip) { continue; }
                if ($count >= 20000) { $capped = true; break; }
                $snap['files'][$rel] = sha1_file($f->getPathname());
                $count++;
            }
        } catch (Exception $e) {
            $snap['_meta']['fileError'] = $e->getMessage();
        }
    }
    $snap['_meta']['fileCount'] = $count;
    $snap['_meta']['fileCapped'] = $capped;
    return $snap;
}

<?php
// Annotated fixture for manifests/semgrep-classes/php-wordpress.yaml: WordPress request sources, sinks and sanitizers.

// ruleid: cw-wp-request-to-sql
function cw_rest_del($request) { global $wpdb; $id = $request->get_param('id'); $wpdb->query("DELETE FROM t WHERE id = $id"); }
// ruleid: cw-wp-request-to-sql
function cw_typed_rest(WP_REST_Request $request) { global $wpdb; return $wpdb->get_row('SELECT * FROM t WHERE id = ' . $request['id']); }
// ruleid: cw-wp-request-to-sql
function cw_json_body(WP_REST_Request $request) { global $wpdb; $p = $request->get_json_params(); $wpdb->query('DELETE FROM t WHERE id = ' . $p['id']); }
// ruleid: cw-wp-request-to-sql
function cw_agent() { global $wpdb; return $wpdb->get_var("SELECT n FROM t WHERE ua = '" . $_SERVER['HTTP_USER_AGENT'] . "'"); }
// ruleid: cw-wp-request-to-sql
function cw_db_alias() { $db = $GLOBALS['wpdb']; return $db->get_results('SELECT * FROM t WHERE a = ' . $_POST['a']); }
// ruleid: cw-wp-request-to-sql
class CwRepo { private $wpdb; public function find() { return $this->wpdb->get_col('SELECT id FROM t WHERE s = ' . filter_input(INPUT_GET, 's')); } }
// ruleid: cw-wp-request-to-sql
function cw_sql_escaped_input() { global $wpdb; return $wpdb->get_row('SELECT * FROM t WHERE id = ' . filter_input(INPUT_GET, 'id', FILTER_SANITIZE_SPECIAL_CHARS)); }
// ruleid: cw-wp-request-to-sql
function cw_sql_number_int() { global $wpdb; return $wpdb->get_row('SELECT * FROM t WHERE id = ' . filter_input(INPUT_GET, 'id', FILTER_SANITIZE_NUMBER_INT) . ' AND owner = 1'); }
// ok: cw-wp-request-to-sql
function cw_sql_flag() { global $wpdb; $wpdb->query('UPDATE t SET flag = ' . (int) ($_GET['on'] === '1') . ', seen = ' . (isset($_GET['s']) && !empty($_GET['s'])) . ' WHERE id = 1'); }
// ruleid: cw-wp-request-to-sql
function cw_sql_after_compare() { global $wpdb; if ($_GET['id'] != '') { $wpdb->query('DELETE FROM t WHERE id = ' . $_GET['id']); } }
// ok: cw-wp-request-to-sql
function cw_sql_validated_int() { global $wpdb; return $wpdb->get_row('SELECT * FROM t WHERE id = ' . filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT)); }
// ok: cw-wp-request-to-sql
function cw_prepared() { global $wpdb; $wpdb->query($wpdb->prepare('DELETE FROM t WHERE id = %d', $_GET['id'])); }
// ok: cw-wp-request-to-sql
function cw_absint() { global $wpdb; $wpdb->query('DELETE FROM t WHERE id = ' . absint($_GET['id'])); }
// ok: cw-wp-request-to-sql
function cw_esc_sql_quoted() { global $wpdb; $wpdb->query("DELETE FROM t WHERE s = '" . esc_sql($_GET['s']) . "'"); }
// ok: cw-wp-request-to-sql
function cw_filtered() { global $wpdb; $wpdb->query('DELETE FROM t WHERE id = ' . filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT)); }
// ok: cw-wp-request-to-sql
class CwOwnGetter { public function del() { global $wpdb; $wpdb->query('DELETE FROM t WHERE id = ' . $this->get_param('id')); } }

// ruleid: cw-wp-esc-sql-unquoted
function cw_esc_sql_bare() { global $wpdb; $wpdb->query('DELETE FROM t WHERE id = ' . esc_sql($_GET['id'])); }
// ruleid: cw-wp-esc-sql-unquoted
function cw_esc_sql_in() { global $wpdb; return $wpdb->get_results('SELECT * FROM t WHERE id IN (' . esc_sql($_GET['ids']) . ')'); }
// ruleid: cw-wp-esc-sql-unquoted
function cw_esc_sql_order() { global $wpdb; return $wpdb->get_results('SELECT * FROM t ORDER BY ' . esc_sql($_GET['o'])); }
// ok: cw-wp-esc-sql-unquoted
// ruleid: cw-wp-request-to-html
function cw_esc_sql_in_markup() { return '<option value="' . esc_sql($_GET['v']) . '">'; }

// ruleid: cw-wp-request-to-prepare-template
function cw_orderby() { global $wpdb; $o = $_GET['o']; return $wpdb->get_results($wpdb->prepare("SELECT * FROM t ORDER BY $o LIMIT %d", 5)); }
// ok: cw-wp-request-to-prepare-template
function cw_orderby_allowed() { global $wpdb; $o = $_GET['o']; if (!in_array($o, array('a', 'b'), true)) { return null; } return $wpdb->get_results($wpdb->prepare("SELECT * FROM t ORDER BY $o LIMIT %d", 5)); }
// ok: cw-wp-request-to-prepare-template, cw-wp-request-to-sql
function cw_prepare_args() { global $wpdb; return $wpdb->get_results($wpdb->prepare('SELECT * FROM t WHERE a = %s', $_GET['a'])); }
// ok: cw-wp-request-to-prepare-template
function cw_order_guarded() { global $wpdb; $order = 'asc'; if (isset($_REQUEST['order'])) { if (in_array($_REQUEST['order'], array('asc', 'desc'), true)) { $order = $_REQUEST['order']; } } return $wpdb->get_results($wpdb->prepare("SELECT * FROM t ORDER BY id $order LIMIT %d", 5)); }
// ok: cw-wp-request-to-prepare-template
function cw_orderby_guarded_prefix() { global $wpdb; $by = 'id'; if (in_array('col_' . $_REQUEST['orderby'], array('col_id', 'col_name'), true)) { $by = $_REQUEST['orderby']; } return $wpdb->get_results($wpdb->prepare("SELECT * FROM t ORDER BY $by LIMIT %d", 5)); }
// ruleid: cw-wp-request-to-prepare-template
function cw_order_guard_other() { global $wpdb; $order = 'asc'; if (in_array($_REQUEST['dir'], array('asc', 'desc'), true)) { $order = $_REQUEST['order']; } return $wpdb->get_results($wpdb->prepare("SELECT * FROM t ORDER BY id $order LIMIT %d", 5)); }
// ruleid: cw-wp-request-to-prepare-template
function cw_order_guard_else() { global $wpdb; $order = 'asc'; if (in_array($_REQUEST['order'], array('asc', 'desc'), true)) { $order = 'desc'; } else { $order = $_REQUEST['order']; } return $wpdb->get_results($wpdb->prepare("SELECT * FROM t ORDER BY id $order LIMIT %d", 5)); }

// ruleid: cw-wp-request-to-option-key
function cw_helper() { $k = $_POST['key']; update_option($k, $_POST['v']); }
// ruleid: cw-wp-request-to-option-key
function cw_key_sanitized() { update_option(sanitize_key($_POST['k']), 1); }
// ruleid: cw-wp-request-to-option-key
function cw_key_suffixed() { delete_option($_POST['k'] . '_cw'); }
// ruleid: cw-wp-request-to-option-key
function cw_user_meta() { update_user_meta(get_current_user_id(), $_GET['m'], 1); }
// ruleid: cw-wp-request-to-option-key
function cw_post_meta($request) { update_post_meta(1, $request->get_param('key'), $request->get_param('value')); }
// ok: cw-wp-request-to-option-key
function cw_value_only() { update_option('fx_setting', $_POST['v']); }
// ok: cw-wp-request-to-option-key
function cw_key_prefixed() { update_option('cw_' . sanitize_key($_POST['k']), 1); }
// ok: cw-wp-request-to-option-key
function cw_key_interpolated() { update_option("cw_{$_POST['k']}", 1); }
// ok: cw-wp-request-to-option-key
function cw_key_allowed() { $k = $_POST['k']; if (in_array($k, array('cw_a', 'cw_b'), true)) { update_option($k, 1); } }
// ok: cw-wp-request-to-option-key
function cw_key_mapped() { $map = array('a' => 'cw_a'); update_option($map[$_POST['k']], 1); }

// ruleid: cw-wp-request-to-redirect
function cw_redirect() { wp_redirect(esc_url_raw($_GET['to'])); exit; }
// ruleid: cw-wp-request-to-redirect
function cw_redirect_root() { wp_redirect('/' . $_GET['p']); }
// ruleid: cw-wp-request-to-redirect
function cw_redirect_open_host() { wp_redirect('https://fixed.example' . $_GET['p']); }
// ruleid: cw-wp-request-to-redirect
function cw_redirect_referer() { wp_redirect(wp_get_raw_referer()); }
// ruleid: cw-wp-request-to-redirect
function cw_location() { header('Location: ' . $_GET['to']); }
// ruleid: cw-wp-request-to-redirect
function cw_location_uri() { header("Location: {$_SERVER['REQUEST_URI']}"); }
// ok: cw-wp-request-to-redirect
function cw_safe_redirect() { wp_safe_redirect($_GET['to']); }
// ok: cw-wp-request-to-redirect
function cw_redirect_validated() { wp_redirect(wp_validate_redirect($_GET['to'], admin_url())); }
// ok: cw-wp-request-to-redirect
function cw_redirect_admin() { wp_redirect(admin_url('admin.php?page=' . $_GET['p'])); }
// ok: cw-wp-request-to-redirect
function cw_redirect_same_origin() { wp_redirect('/wp-admin/admin.php?page=' . $_GET['p']); }
// ok: cw-wp-request-to-redirect
function cw_redirect_pinned_host() { wp_redirect('https://fixed.example/' . $_GET['p']); }
// ok: cw-wp-request-to-redirect
function cw_redirect_sprintf() { wp_redirect(sprintf('/wp-admin/admin.php?page=%s', $_GET['p'])); }
// ok: cw-wp-request-to-redirect
function cw_redirect_interpolated() { wp_redirect("admin.php?page={$_GET['p']}"); }
// ok: cw-wp-request-to-redirect
function cw_redirect_query_arg() { wp_redirect(add_query_arg('msg', $_GET['m'], admin_url('options.php'))); }
// ok: cw-wp-request-to-redirect
function cw_location_pinned() { header('Location: /wp-admin/admin.php?page=' . $_GET['p']); }
// ok: cw-wp-request-to-redirect
function cw_redirect_query_args_stored() { wp_redirect(add_query_arg(array('m' => $_GET['m']), get_option('cw_return'))); }
// ok: cw-wp-request-to-redirect
function cw_redirect_filter_context() { wp_redirect(apply_filters('cw_to', admin_url(), $_GET['g'])); }
// ruleid: cw-wp-request-to-redirect
function cw_redirect_filter_value() { wp_redirect(apply_filters('cw_to', $_GET['to'], 1)); }
// ok: cw-wp-request-to-redirect
function cw_redirect_attachment() { wp_redirect(wp_get_attachment_url($_GET['id'])); }
// ruleid: cw-wp-request-to-redirect
function cw_redirect_query_arg_base() { wp_redirect(add_query_arg('m', 1, $_GET['to'])); }
// ruleid: cw-wp-request-to-redirect
function cw_redirect_escaped_input() { wp_redirect(filter_input(INPUT_GET, 'to', FILTER_SANITIZE_STRING)); }
// ruleid: cw-wp-request-to-redirect
function cw_redirect_current_url() { wp_redirect(remove_query_arg('msg')); }
// ok: cw-wp-request-to-redirect
function cw_redirect_admin_query_arg() { wp_redirect(add_query_arg('msg', 1, admin_url('admin.php'))); }

// ruleid: cw-wp-request-to-remote-url
function cw_ssrf() { return wp_remote_get(esc_url_raw($_GET['u'])); }
// ruleid: cw-wp-request-to-remote-url
function cw_ssrf_curl() { $ch = curl_init(); curl_setopt($ch, CURLOPT_URL, $_POST['u']); return curl_exec($ch); }
// ruleid: cw-wp-request-to-remote-url
function cw_ssrf_rest(WP_REST_Request $request) { return download_url($request->get_param('src')); }
// ok: cw-wp-request-to-remote-url
function cw_ssrf_safe() { return wp_safe_remote_get($_GET['u']); }
// ok: cw-wp-request-to-remote-url
function cw_ssrf_pinned() { return wp_remote_get('https://api.fixed.example/v1/' . rawurlencode($_GET['u'])); }
// ok: cw-wp-request-to-remote-url
function cw_ssrf_validated() { $u = $_GET['u']; if (!wp_http_validate_url($u)) { return null; } return wp_remote_get($u); }
// ok: cw-wp-request-to-remote-url
function cw_ssrf_validated_inline() { return wp_remote_get(wp_http_validate_url($_GET['u'])); }
// ok: cw-wp-request-to-remote-url
function cw_ssrf_query_args() { return wp_remote_get(add_query_arg(array('k' => $_GET['k']), get_option('cw_server'))); }
// ruleid: cw-wp-request-to-remote-url
function cw_ssrf_query_arg_base() { return wp_remote_get(add_query_arg('k', 1, $_GET['u'])); }
// ruleid: cw-wp-request-to-remote-url
function cw_ssrf_escaped_input() { $d = filter_input(INPUT_POST, 'd', FILTER_SANITIZE_FULL_SPECIAL_CHARS, FILTER_REQUIRE_ARRAY); return wp_remote_get($d['url']); }
// ruleid: cw-wp-request-to-remote-url
function cw_ssrf_input_array() { $d = filter_input_array(INPUT_POST, FILTER_UNSAFE_RAW); return wp_remote_get($d['url']); }
// ruleid: cw-wp-request-to-remote-url
function cw_ssrf_input_referer() { return wp_remote_get(filter_input(INPUT_SERVER, 'HTTP_REFERER', FILTER_SANITIZE_FULL_SPECIAL_CHARS)); }

// ruleid: cw-wp-request-to-unserialize
function cw_cookie() { return unserialize(base64_decode($_COOKIE['c'])); }
// ruleid: cw-wp-request-to-unserialize
function cw_maybe() { return maybe_unserialize(file_get_contents('php://input')); }
// ok: cw-wp-request-to-unserialize
function cw_unser_escaped_input() { return maybe_unserialize(filter_input(INPUT_POST, 'd', FILTER_SANITIZE_FULL_SPECIAL_CHARS)); }
// ok: cw-wp-request-to-unserialize
function cw_no_classes() { return unserialize($_COOKIE['c'], array('allowed_classes' => false)); }
// ok: cw-wp-request-to-unserialize
function cw_no_classes_short() { return unserialize($_COOKIE['c'], ['allowed_classes' => false]); }
// ok: cw-wp-request-to-unserialize
function cw_unser_remote_body() { $r = wp_remote_post('https://api.fixed.example/v1', array('body' => array('q' => $_POST['q']))); return maybe_unserialize(wp_remote_retrieve_body($r)); }
// ruleid: cw-wp-request-to-unserialize, cw-wp-request-to-remote-url
function cw_unser_remote_url() { $r = wp_remote_get($_GET['u']); return maybe_unserialize(wp_remote_retrieve_body($r)); }
// ok: cw-wp-request-to-unserialize
function cw_unser_option() { return maybe_unserialize(get_option(sanitize_text_field($_POST['view']))); }
// ok: cw-wp-request-to-unserialize
function cw_unser_meta() { return maybe_unserialize(get_user_meta(get_current_user_id(), $_GET['k'], true)); }
// ok: cw-wp-request-to-unserialize
function cw_unser_db() { global $wpdb; return maybe_unserialize($wpdb->get_var($wpdb->prepare('SELECT v FROM t WHERE k = %s', $_GET['k']))); }
// ok: cw-wp-request-to-unserialize
function cw_unser_session($wc_session) { $cart = $wc_session->get_session($_GET['key']); return maybe_unserialize($cart['cart']); }
// ok: cw-wp-request-to-unserialize
class CwUpdater { private $api_url; public function info() { $key = md5('p_' . sanitize_key($_REQUEST['plugin'])); $info = $this->cached($key); if (false === $info) { $params = array('slug' => $_REQUEST['slug']); $r = wp_remote_post($this->api_url, array('body' => $params)); $info = json_decode(wp_remote_retrieve_body($r)); } return maybe_unserialize($info->sections); } }

// ruleid: cw-wp-shortcode-attribute-to-html
function cw_sc($atts) { $a = shortcode_atts(array('title' => ''), $atts); return '<h2>' . $a['title'] . '</h2>'; }
// ruleid: cw-wp-shortcode-attribute-to-html
function cw_sc_echo($atts) { echo $atts['title']; }
// ruleid: cw-wp-shortcode-attribute-to-html
function cw_sc_interp($atts = array()) { $a = shortcode_atts(array('url' => ''), $atts); return "<a href=\"{$a['url']}\">link</a>"; }
// ruleid: cw-wp-shortcode-attribute-to-html
class CwBlock { public function render($attributes, $content) { return sprintf('<div class="%s">%s</div>', $attributes['className'], $content); } }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_escaped($atts) { $a = shortcode_atts(array('title' => ''), $atts); return '<h2>' . esc_html($a['title']) . '</h2>'; }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_attr($attr) { $a = shortcode_atts(array('url' => ''), $attr); return sprintf('<a href="%s">', esc_url($a['url'])); }
// ruleid: cw-wp-shortcode-attribute-to-html
function cw_sc_attr_first(array $attr = array()) { return '<b>' . $attr['t'] . '</b>'; }
// ok: cw-wp-shortcode-attribute-to-html
function cw_helper_attr($style, $value, $attr = array()) { return '<span ' . $attr['x'] . '>'; }
// ok: cw-wp-shortcode-attribute-to-html
function cw_helper_attributes($type, $name, $attributes) { return '<input ' . $attributes['x'] . '>'; }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_json_wrapper($atts) { return '<script>var c = ' . Cw_Utils::safe_json_encode($atts) . ';</script>'; }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_width($atts) { return sprintf('<img width="%d">', (int) $atts['w']); }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_attachment($atts) { return '<img src="' . wp_get_attachment_url($atts['id']) . '">'; }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_preg($atts, $c) { return preg_replace('/<p>' . preg_quote($atts['s'], '/') . '<\/p>/', '', $c); }
// ruleid: cw-wp-shortcode-attribute-to-html
function cw_sc_preg_replacement($atts, $c) { return preg_replace('/x/', '<b>' . $atts['r'] . '</b>', $c); }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_remote_body($atts) { $r = wp_remote_get('https://api.fixed.example/v1/' . rawurlencode($atts['id'])); return '<div>' . wp_remote_retrieve_body($r) . '</div>'; }
// ok: cw-wp-shortcode-attribute-to-html
function cw_sc_filter_context($atts) { return '<div>' . apply_filters('cw_title', 'x', $atts) . '</div>'; }

// ruleid: cw-wp-request-to-html
function cw_reflect() { return '<a href="' . $_GET['u'] . '">x</a>'; }
// ruleid: cw-wp-request-to-html
function cw_reflect_interp() { $q = $_REQUEST['q']; return "<p>Results for $q</p>"; }
// ruleid: cw-wp-request-to-html
function cw_reflect_printf() { printf('<input value="%s">', $_GET['v']); }
// ok: cw-wp-request-to-html
function cw_reflect_escaped() { return '<a href="' . esc_url($_GET['u']) . '">x</a>'; }
// ruleid: cw-wp-request-to-html
function cw_echoed() { echo '<b>' . $_GET['q'] . '</b>'; }
// ok: cw-wp-request-to-html
function cw_html_email() { return '<input value="' . sanitize_email($_GET['e']) . '">'; }
// ok: cw-wp-request-to-html
function cw_html_closed_comment() { $p = WP_CONTENT_DIR . '/<!--prefix-->fallback.' . $_GET['t']; return $p; }
// ruleid: cw-wp-request-to-html
function cw_html_open_comment() { return '<!-- debug ' . $_GET['d']; }
// ok: cw-wp-request-to-html
function cw_html_permalink() { return '<a href="' . get_permalink($_GET['p']) . '">x</a>'; }
// ok: cw-wp-request-to-html
function cw_html_filter_context() { return '<p>' . apply_filters('cw_msg', 'done', $_GET['s']) . '</p>'; }
// ok: cw-wp-request-to-html
function cw_html_int() { return '<td>' . (int) $_GET['n'] . '</td>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_uri_template() { $u = preg_replace('#&action=[^&]+&?#', '&', $_SERVER['REQUEST_URI']); ?><a href="<?php echo $u ?>&amp;action=x">x</a><?php }
// ruleid: cw-wp-request-to-html
function cw_echo_referer() { echo $_SERVER['HTTP_REFERER']; }
// ruleid: cw-wp-request-to-html
function cw_echo_upload_name() { echo $_FILES['f']['name']; }
// ruleid: cw-wp-request-to-html
function cw_print_get() { $v = $_GET['v']; print $v; }
// ruleid: cw-wp-request-to-html
function cw_printf_plain() { printf('%s', $_GET['v']); }
// ruleid: cw-wp-request-to-html
function cw_e_get() { _e($_GET['v'], 'cw'); }
// ruleid: cw-wp-request-to-html
function cw_wp_die_get() { wp_die('Unknown item ' . $_GET['item']); }
// ruleid: cw-wp-request-to-html
function cw_echo_list() { echo '<b>', $_GET['m'], '</b>'; }
// ruleid: cw-wp-request-to-html
function cw_short_echo() { ?><p><?= $_GET['m'] ?></p><?php }
// ruleid: cw-wp-request-to-html
function cw_echo_current_url() { echo '<a href="' . add_query_arg('tab', 'x') . '">x</a>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_removed_arg() { echo remove_query_arg('msg'); }
// ruleid: cw-wp-request-to-html
function cw_echo_validated_url() { echo '<a href="' . filter_input(INPUT_GET, 'u', FILTER_VALIDATE_URL) . '">x</a>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_input_array() { $d = filter_input_array(INPUT_POST); echo $d['m']; }
// ruleid: cw-wp-request-to-html
function cw_echo_no_encode_quotes() { echo "<i title='" . filter_input(INPUT_GET, 't', FILTER_SANITIZE_FULL_SPECIAL_CHARS, FILTER_FLAG_NO_ENCODE_QUOTES) . "'></i>"; }
// ruleid: cw-wp-request-to-html
function cw_echo_filter_var_no_encode() { echo "<i title='" . filter_var($_GET['t'], FILTER_SANITIZE_FULL_SPECIAL_CHARS, FILTER_FLAG_NO_ENCODE_QUOTES) . "'></i>"; }
// ruleid: cw-wp-request-to-html
function cw_echo_search_raw() { echo '<p>' . get_search_query(false) . '</p>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_header() { $h = getallheaders(); echo $h['X-Cw']; }
// ruleid: cw-wp-request-to-html
function cw_print_r_post() { print_r($_POST); }
// ruleid: cw-wp-request-to-html
function cw_die_get() { die('Bad ' . $_GET['x']); }
// ok: cw-wp-request-to-html
function cw_echo_uri_escaped() { echo esc_url($_SERVER['REQUEST_URI']); }
// ok: cw-wp-request-to-html
function cw_echo_current_url_escaped() { echo esc_url(add_query_arg('tab', 'x')); }
// ok: cw-wp-request-to-html
function cw_echo_query_arg_fixed_url() { echo add_query_arg(array('tab' => 'x'), admin_url('admin.php')); }
// ok: cw-wp-request-to-html
function cw_echo_escaped_input() { echo '<p>' . filter_input(INPUT_GET, 'm', FILTER_SANITIZE_FULL_SPECIAL_CHARS) . '</p>'; }
// ok: cw-wp-request-to-html
function cw_echo_filter_var_int() { echo filter_var($_GET['n'], FILTER_VALIDATE_INT); }
// ok: cw-wp-request-to-html
function cw_echo_filter_var_special() { echo '<p>' . filter_var($_GET['m'], FILTER_SANITIZE_SPECIAL_CHARS) . '</p>'; }
// ok: cw-wp-request-to-html
function cw_echo_int() { echo (int) $_GET['n']; }
// ok: cw-wp-request-to-html
function cw_e_escaped() { esc_html_e($_GET['v'], 'cw'); }
// ok: cw-wp-request-to-html
function cw_echo_search_escaped() { echo '<p>' . get_search_query() . '</p>'; }
// ok: cw-wp-request-to-html
function cw_echo_filter_input_int_ns() { echo '<p>' . filter_input(INPUT_GET, 'n', \FILTER_VALIDATE_INT) . '</p>'; }
// ok: cw-wp-request-to-html
function cw_echo_input_array_escaped() { $d = filter_input_array(INPUT_POST, FILTER_SANITIZE_SPECIAL_CHARS); echo $d['m']; }
// ok: cw-wp-request-to-html
function cw_print_r_returned() { return strlen(print_r($_GET, true)); }
// ok: cw-wp-request-to-html
function cw_echo_number_int() { echo '<p>' . filter_input(INPUT_GET, 'n', FILTER_SANITIZE_NUMBER_INT) . '</p>'; }
// ok: cw-wp-request-to-html
function cw_echo_filter_var_number_int() { echo '<p>' . filter_var($_GET['n'], FILTER_SANITIZE_NUMBER_INT) . '</p>'; }
// ok: cw-wp-request-to-html
function cw_echo_paginate_base() { echo paginate_links(array('base' => add_query_arg('paged', '%#%'), 'format' => '', 'current' => max(1, $_GET['pg']), 'total' => 3)); }
// ok: cw-wp-request-to-html
function cw_echo_paginate_short() { echo paginate_links(['base' => str_replace('99', '%#%', remove_query_arg('pg')), 'add_args' => array('s' => $_GET['s'])]); }
// ruleid: cw-wp-request-to-html
function cw_echo_paginate_prev_text() { echo paginate_links(array('base' => '%_%', 'prev_text' => $_GET['p'])); }
// ok: cw-wp-request-to-html
function cw_echo_nonce_url() { $u = wp_nonce_url(add_query_arg(array('a' => $_GET['a'])), 'cw'); echo "<a href='$u'>x</a>"; }
// ok: cw-wp-request-to-html
function cw_echo_posts_found() { $posts = get_posts(array('s' => $_GET['s'])); foreach ($posts as $p) { printf('<li>%d</li>', $p->ID); } }
// ok: cw-wp-request-to-html
function cw_echo_terms_found() { $t = get_terms('category', 'include=' . get_query_var('id')); echo '<b>' . $t[0]->name . '</b>'; }
// ok: cw-wp-request-to-html
function cw_echo_flag() { $partial = isset($_GET['partial']) && ($_GET['partial'] == '1'); echo '<i data-p="' . $partial . '"></i>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_after_compare() { if ($_GET['m'] == 'a') { echo $_GET['m']; } }
// ruleid: cw-wp-request-to-html
function cw_echo_assigned_in_compare() { if (($v = $_GET['v']) !== '') { echo $v; } }
// ruleid: cw-wp-request-to-html
function cw_echo_assigned_or_die() { $id = $_GET['id'] or die('missing'); echo $id; }
// ruleid: cw-wp-request-to-html
function cw_echo_coalesce() { echo '<p>' . ($_GET['m'] ?? '') . '</p>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_elvis() { echo '<p>' . ($_GET['m'] ?: 'none') . '</p>'; }
// ok: cw-wp-request-to-html
function cw_echo_remote_changelog() { $r = wp_remote_post('https://api.fixed.example/v1', array('body' => array('slug' => $_REQUEST['slug']))); $info = json_decode(wp_remote_retrieve_body($r)); echo $info->sections->changelog; }
// ok: cw-wp-request-to-html
function cw_echo_query_string() { echo '<a href="https://fixed.example/?' . http_build_query(array('q' => $_GET['q'])) . '">x</a>'; }
// ok: cw-wp-request-to-html
function cw_echo_urlencoded() { echo '<a href="/s?q=' . urlencode($_GET['q']) . '">x</a>'; }
// ok: cw-wp-request-to-html
function cw_echo_textarea() { echo '<textarea>' . sanitize_textarea_field($_POST['t']) . '</textarea>'; }
// ok: cw-wp-request-to-html
function cw_echo_paged() { echo '<span>' . get_query_var('paged') . '</span>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_query_var_page() { echo '<span>' . get_query_var('page') . '</span>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_query_var_search() { echo '<span>' . get_query_var('s') . '</span>'; }
// ruleid: cw-wp-request-to-html
function cw_echo_input_server_uri() { echo filter_input(INPUT_SERVER, 'REQUEST_URI'); }
// ruleid: cw-wp-request-to-html
function cw_echo_input_server_referer() { echo filter_input(\INPUT_SERVER, 'HTTP_REFERER', FILTER_UNSAFE_RAW); }
// ruleid: cw-wp-request-to-html
function cw_echo_input_env_header() { echo filter_input(INPUT_ENV, 'HTTP_X_CW'); }
// ok: cw-wp-request-to-html
function cw_echo_input_server_root() { echo filter_input(INPUT_SERVER, 'DOCUMENT_ROOT'); }

// ruleid: cw-wp-input-to-include
function cw_tpl() { include $_GET['tpl'] . '.php'; }
// ruleid: cw-wp-input-to-include
function cw_tpl_dir() { include plugin_dir_path(__FILE__) . 'views/' . $_GET['view'] . '.php'; }
// ruleid: cw-wp-input-to-include
function cw_sc_tpl($atts) { $a = shortcode_atts(array('layout' => 'list'), $atts); require __DIR__ . '/layouts/' . $a['layout'] . '.php'; }
// ruleid: cw-wp-input-to-include
function cw_part() { get_template_part('parts/' . $_GET['part']); }
// ok: cw-wp-input-to-include
function cw_tpl_key() { include __DIR__ . '/views/' . sanitize_key($_GET['view']) . '.php'; }
// ok: cw-wp-input-to-include
function cw_tpl_docroot() { include filter_input(INPUT_SERVER, 'DOCUMENT_ROOT', FILTER_SANITIZE_FULL_SPECIAL_CHARS) . '/wp-load.php'; }
// ruleid: cw-wp-input-to-include
function cw_tpl_path_info() { include __DIR__ . '/views/' . filter_input(INPUT_SERVER, 'PATH_INFO', FILTER_SANITIZE_FULL_SPECIAL_CHARS) . '.php'; }
// ok: cw-wp-input-to-include
function cw_tpl_allowed() { $v = $_GET['view']; if (!in_array($v, array('list', 'grid'), true)) { return; } include __DIR__ . "/views/$v.php"; }

// ruleid: cw-wp-request-to-file-path
function cw_delete() { wp_delete_file(WP_CONTENT_DIR . '/uploads/' . $_POST['file']); }
// ruleid: cw-wp-request-to-file-path
function cw_upload($dir) { move_uploaded_file($_FILES['f']['tmp_name'], $dir . '/' . $_FILES['f']['name']); }
// ruleid: cw-wp-request-to-file-path
function cw_fs() { global $wp_filesystem; return $wp_filesystem->get_contents(ABSPATH . $_GET['path']); }
// ok: cw-wp-request-to-file-path
function cw_delete_base() { wp_delete_file(WP_CONTENT_DIR . '/uploads/' . basename($_POST['file'])); }
// ok: cw-wp-request-to-file-path
function cw_upload_named($dir) { move_uploaded_file($_FILES['f']['tmp_name'], $dir . '/' . sanitize_file_name($_FILES['f']['name'])); }
// ok: cw-wp-request-to-file-path
function cw_validated() { $f = $_GET['f']; if (validate_file($f) !== 0) { return; } readfile(WP_CONTENT_DIR . '/exports/' . $f); }
// ok: cw-wp-request-to-file-path
function cw_rest_upload_tmp($request) { $files = $request->get_file_params(); $file = $files['f']; $tmp = (string) $file['tmp_name']; if (!is_uploaded_file($tmp)) { return null; } return file_get_contents($tmp); }
// ok: cw-wp-request-to-file-path
function cw_rest_upload_tmp_or($request) { $files = $request->get_file_params(); $file = $files['f'] ?? array(); $tmp = (string) ($file['tmp_name'] ?? ''); if ('' === $tmp || !is_uploaded_file($tmp)) { return null; } return file_get_contents($tmp); }
// ruleid: cw-wp-request-to-file-path
function cw_tmp_name_from_get() { return file_get_contents($_GET['f']['tmp_name']); }
// ruleid: cw-wp-request-to-file-path
function cw_rest_upload_name($request) { $files = $request->get_file_params(); return file_get_contents('/tmp/' . $files['f']['name']); }
// ruleid: cw-wp-request-to-file-path
function cw_path_escaped_input() { return file_get_contents(WP_CONTENT_DIR . '/exports/' . filter_input(INPUT_GET, 'f', FILTER_SANITIZE_FULL_SPECIAL_CHARS)); }

// ruleid: cw-wp-request-to-hook-or-callable
function cw_hook() { do_action($_REQUEST['hook']); }
// ruleid: cw-wp-request-to-hook-or-callable
function cw_callback() { return call_user_func($_POST['cb'], $_POST['arg']); }
// ruleid: cw-wp-request-to-hook-or-callable
class CwAjax { public function route() { $m = $_GET['do']; return $this->$m(); } }
// ruleid: cw-wp-request-to-hook-or-callable
function cw_new() { $c = sanitize_key($_GET['cls']); return new $c(); }
// ruleid: cw-wp-request-to-hook-or-callable
function cw_variable_function() { $fn = $_GET['f']; return $fn(); }
// ruleid: cw-wp-request-to-hook-or-callable
function cw_static_on_request_class() { $cls = $_GET['cls']; return $cls::instance(); }
// ok: cw-wp-request-to-hook-or-callable
function cw_hook_prefixed() { do_action('cw_ajax_' . sanitize_key($_REQUEST['hook'])); }
// ok: cw-wp-request-to-hook-or-callable
class CwAjaxChecked { public function route() { $m = $_GET['do']; if (!method_exists($this, $m)) { return null; } return $this->$m(); } }
// ok: cw-wp-request-to-hook-or-callable
function cw_mapped() { $map = array('a' => 'cw_a'); return call_user_func($map[$_GET['a']]); }
// ok: cw-wp-request-to-hook-or-callable
function cw_method_on_tainted_object() { $q = new WP_Query(array('s' => $_GET['s'])); return $q->get_posts(); }
// ok: cw-wp-request-to-hook-or-callable
function cw_static_on_tainted_class() { $d = DateTime::createFromFormat('Y-m-d', $_GET['d']); return $d->modify('+1 day'); }

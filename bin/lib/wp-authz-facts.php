<?php
// Facts for bin/wp-authz.mjs: WordPress entry points, the guards on the path from each to a state
// write, and who can obtain each nonce those guards verify. Parses PHP as data with nikic/php-parser
// 5; the scanned tree is never included, required or executed. Decisions (rule, severity,
// undetermined) are made in bin/wp-authz.mjs, never here.
//
// usage: php wp-authz-facts.php <php-parser dir> <root>   (relative file paths on stdin, one a line)
declare(strict_types=1);

$parserDir = $argv[1] ?? '';
$root = rtrim($argv[2] ?? '', '/');
spl_autoload_register(function (string $c) use ($parserDir): void {
    if (!str_starts_with($c, 'PhpParser\\')) return;
    $p = $parserDir . '/lib/' . str_replace('\\', '/', $c) . '.php';
    if (is_file($p)) require $p;
});
if (!class_exists('PhpParser\\ParserFactory') || !method_exists('PhpParser\\ParserFactory', 'createForNewestSupportedVersion')) {
    fwrite(STDERR, "nikic/php-parser 5 not found under $parserDir\n");
    exit(127);
}

use PhpParser\Node;
use PhpParser\Node\Expr;
use PhpParser\Node\Stmt;

const MAX_BYTES = 2_000_000;
const LIB_DIRS = '#(^|/)(lib|libs|library|libraries|third-party|third_party|external|bundled|packages)/#i';
const WP_TOKENS = '/\\b(?:add_action|add_filter|do_action|apply_filters|register_rest_route|add_shortcode|add_menu_page|add_submenu_page|add_options_page|current_user_can|user_can|check_ajax_referer|check_admin_referer|wp_verify_nonce|wp_create_nonce|wp_nonce_field|wp_nonce_url|update_option|add_option|delete_option|get_option|wp_die|wp_send_json\\w*|wpdb|WP_REST_\\w+|is_admin|get_current_user_id|wp_redirect|wp_safe_redirect)\\b/';
const MAX_DEPTH = 10;
const MAX_AMBIGUOUS = 3;
const SUPERGLOBALS = ['_GET', '_POST', '_REQUEST', '_COOKIE', '_FILES', '_SERVER'];
const SERVER_REQUEST_KEYS = ['REQUEST_URI', 'QUERY_STRING', 'PATH_INFO', 'PHP_SELF', 'ORIG_PATH_INFO'];
const CAP_FUNCS = ['current_user_can', 'user_can', 'current_user_can_for_blog', 'is_super_admin', 'author_can', 'current_user_can_for_site'];
const CAP_METHODS = ['current_user_can', 'user_can', 'has_cap'];
const WEAK_CAPS = ['read', 'exist', 'level_0', ''];
const NONCE_FUNCS = ['check_ajax_referer', 'check_admin_referer', 'wp_verify_nonce'];
// Names the guard heuristic would match that issue or read a token rather than check one.
const NOT_GUARDS = ['wp_create_nonce', 'wp_nonce_field', 'wp_nonce_url', 'wp_nonce_tick', 'wp_get_referer', 'wp_get_raw_referer', 'wp_referer_field',
    'wp_get_original_referer', 'wp_original_referer_field', 'map_meta_cap', 'get_role_caps', 'wp_signon'];
const MINT_FUNCS =['wp_create_nonce' => 0, 'wp_nonce_field' => 0, 'wp_nonce_url' => 1];
// weight: high = site-wide state (options, users, roles, files, direct SQL writes, plugins/themes);
// med = content (posts, meta, terms, comments, mail, cron); low = caches. Key = index of the argument
// that names WHAT is written (an option name, a meta key, a path), or null.
const MUTATIONS = [
    'update_option' => ['high', 0], 'add_option' => ['high', 0], 'delete_option' => ['high', 0],
    'update_site_option' => ['high', 0], 'add_site_option' => ['high', 0], 'delete_site_option' => ['high', 0],
    'update_network_option' => ['high', 1], 'add_network_option' => ['high', 1], 'delete_network_option' => ['high', 1],
    'update_blog_option' => ['high', 1], 'add_blog_option' => ['high', 1], 'delete_blog_option' => ['high', 1],
    'wp_insert_user' => ['high', null], 'wp_update_user' => ['high', null], 'wp_delete_user' => ['high', null], 'wpmu_delete_user' => ['high', null],
    'wp_create_user' => ['high', null], 'wp_set_password' => ['high', null], 'set_role' => ['high', null], 'add_role' => ['high', null],
    'remove_role' => ['high', null], 'add_cap' => ['high', null], 'remove_cap' => ['high', null], 'wp_set_auth_cookie' => ['high', null],
    'wp_set_current_user' => ['high', null], 'grant_super_admin' => ['high', null],
    'update_user_meta' => ['high', 1], 'add_user_meta' => ['high', 1], 'delete_user_meta' => ['high', 1], 'update_user_option' => ['high', 1], 'delete_user_option' => ['high', 1],
    'file_put_contents' => ['high', 0], 'fwrite' => ['high', null], 'fputs' => ['high', null], 'unlink' => ['high', 0], 'wp_delete_file' => ['high', 0],
    'move_uploaded_file' => ['high', 1], 'wp_handle_upload' => ['high', null], 'wp_handle_sideload' => ['high', null], 'media_handle_upload' => ['high', null],
    'media_handle_sideload' => ['high', null], 'wp_upload_bits' => ['high', 0], 'rename' => ['high', 1], 'copy' => ['high', 1], 'rmdir' => ['high', 0],
    'download_url' => ['high', null], 'unzip_file' => ['high', 1], 'activate_plugin' => ['high', 0], 'activate_plugins' => ['high', 0],
    'deactivate_plugins' => ['high', 0], 'delete_plugins' => ['high', 0], 'switch_theme' => ['high', 0], 'delete_theme' => ['high', 0],
    'wp_delete_post' => ['high', null], 'wp_trash_post' => ['high', null], 'wp_delete_attachment' => ['high', null], 'wp_delete_comment' => ['high', null],
    'wp_delete_term' => ['high', null], 'wp_delete_site' => ['high', null], 'wp_insert_site' => ['high', null],
    'wp_insert_post' => ['med', null], 'wp_update_post' => ['med', null], 'update_post_meta' => ['med', 1], 'add_post_meta' => ['med', 1],
    'delete_post_meta' => ['med', 1], 'wp_insert_term' => ['med', null], 'wp_update_term' => ['med', null], 'wp_set_object_terms' => ['med', null],
    'wp_set_post_terms' => ['med', null], 'wp_insert_comment' => ['med', null], 'wp_new_comment' => ['med', null], 'wp_update_comment' => ['med', null],
    'update_term_meta' => ['med', 1], 'add_term_meta' => ['med', 1], 'delete_term_meta' => ['med', 1], 'update_comment_meta' => ['med', 1],
    'add_comment_meta' => ['med', 1], 'wp_mail' => ['med', null], 'wp_schedule_event' => ['med', null], 'wp_schedule_single_event' => ['med', null],
    'wp_insert_attachment' => ['med', null], 'update_metadata' => ['med', 2], 'add_metadata' => ['med', 2], 'delete_metadata' => ['med', 2],
    'set_transient' => ['low', 0], 'delete_transient' => ['low', 0], 'set_site_transient' => ['low', 0], 'delete_site_transient' => ['low', 0],
];
const WPDB_WRITES = ['insert' => null, 'update' => null, 'delete' => null, 'replace' => null, 'query' => 0];
const FS_WRITES = ['put_contents' => 0, 'delete' => 0, 'move' => 1, 'copy' => 1, 'mkdir' => 0, 'rmdir' => 0];
const REQUEST_METHODS = ['get_param', 'get_params', 'get_json_params', 'get_body_params', 'get_query_params', 'get_url_params', 'get_file_params', 'get_body', 'get_header', 'get_headers', 'offsetget'];
const MENU_FUNCS = ['add_menu_page' => [2, 4], 'add_submenu_page' => [3, 5], 'add_options_page' => [2, 4], 'add_management_page' => [2, 4],
    'add_theme_page' => [2, 4], 'add_plugins_page' => [2, 4], 'add_users_page' => [2, 4], 'add_dashboard_page' => [2, 4], 'add_posts_page' => [2, 4],
    'add_media_page' => [2, 4], 'add_pages_page' => [2, 4], 'add_comments_page' => [2, 4], 'add_links_page' => [2, 4], 'add_object_page' => [2, 4], 'add_utility_page' => [2, 4]];
// Who reaches a hook's callbacks, for deciding who can obtain a nonce minted beneath them.
const PUBLIC_HOOKS = ['wp_enqueue_scripts', 'wp_head', 'wp_footer', 'wp_body_open', 'the_content', 'the_excerpt', 'init', 'wp', 'wp_loaded',
    'template_redirect', 'template_include', 'parse_request', 'login_enqueue_scripts', 'login_form', 'login_footer', 'comment_form',
    'widget_text', 'wp_print_scripts', 'wp_print_footer_scripts', 'enqueue_block_assets', 'register_form', 'lostpassword_form', 'plugins_loaded', 'after_setup_theme'];
const LOGGEDIN_HOOKS = ['(meta-box)', 'admin_enqueue_scripts', 'admin_notices', 'all_admin_notices', 'network_admin_notices', 'user_admin_notices', 'admin_footer',
    'admin_head', 'admin_init', 'admin_menu', 'admin_print_scripts', 'admin_print_footer_scripts', 'admin_bar_menu', 'enqueue_block_editor_assets',
    'add_meta_boxes', 'in_admin_footer', 'in_admin_header', 'show_user_profile', 'edit_user_profile', 'dashboard_glance_items', 'wp_dashboard_setup'];
const ENTRY_HOOKS = ['init', 'admin_init', 'wp_loaded', 'template_redirect', 'plugins_loaded', 'wp', 'parse_request', 'current_screen', 'admin_menu', 'send_headers', 'after_setup_theme'];

$parser = (new PhpParser\ParserFactory())->createForNewestSupportedVersion();
$rels = array_values(array_filter(array_map('trim', explode("\n", (string) stream_get_contents(STDIN))), fn($s) => $s !== ''));
sort($rels, SORT_STRING);

function lc($n): ?string {
    if ($n instanceof Node\Name || $n instanceof Node\Identifier) $n = $n->toString();
    if (!is_string($n)) return null;
    $n = strtolower(ltrim($n, '\\'));
    $p = strrpos($n, '\\');
    return $p === false ? $n : substr($n, $p + 1);
}
function callName(Node $c): ?string {
    if ($c instanceof Expr\FuncCall || $c instanceof Expr\MethodCall || $c instanceof Expr\NullsafeMethodCall || $c instanceof Expr\StaticCall) return lc($c->name);
    return null;
}
function argsOf(Node $c): array { return ($c instanceof Expr\CallLike && !$c->isFirstClassCallable()) ? $c->getArgs() : []; }
function argAt(Node $c, int $i): ?Node { $a = argsOf($c); return isset($a[$i]) ? $a[$i]->value : null; }

// ── the index ────────────────────────────────────────────────────────────────────────────────────
$FN = [];          // id => [file, node, cls, label, kind]
$byNode = [];      // spl_object_id(node) => fn id
$functions = [];   // lc name => [ids]
$classes = [];     // lc name => [extends, uses[], methods[mn=>id], consts[name=>string]]
$methodsByName = [];
$defines = [];
$parseErrors = [];
$parsed = 0;
$notWp = 0;

function newFn(string $file, Node $node, ?string $cls, string $label, string $kind): int {
    global $FN, $byNode;
    $id = count($FN);
    $FN[$id] = ['file' => $file, 'node' => $node, 'cls' => $cls, 'label' => $label, 'kind' => $kind];
    $byNode[spl_object_id($node)] = $id;
    return $id;
}
function litOf(?Node $v): ?string {
    global $defines, $classes;
    if ($v instanceof Node\Arg) $v = $v->value;
    if ($v === null) return null;
    if ($v instanceof Node\Scalar\String_) return $v->value;
    if ($v instanceof Node\Scalar\Int_) return (string) $v->value;
    if ($v instanceof Expr\UnaryMinus && $v->expr instanceof Node\Scalar\Int_) return '-' . $v->expr->value;
    if ($v instanceof Expr\ConstFetch) { $n = $v->name->toString(); return $defines[$n] ?? null; }
    if ($v instanceof Expr\Variable && is_string($v->name)) { global $CURCONST; return $CURCONST[$v->name] ?? null; }
    if ($v instanceof Expr\ClassConstFetch && $v->name instanceof Node\Identifier) {
        $c = lc($v->class instanceof Node\Name ? $v->class : null);
        $k = $v->name->toString();
        if ($c !== null && isset($classes[$c]['consts'][$k])) return $classes[$c]['consts'][$k];
        foreach ($classes as $cl) if (isset($cl['consts'][$k]) && in_array($c, ['self', 'static'], true)) return $cl['consts'][$k];
        return null;
    }
    if ($v instanceof Expr\BinaryOp\Concat) {
        $l = litOf($v->left); $r = litOf($v->right);
        if ($l === null && $r === null) return null;
        return ($l ?? '*') . ($r ?? '*');
    }
    if ($v instanceof Node\Scalar\InterpolatedString) {
        $s = '';
        foreach ($v->parts as $p) $s .= $p instanceof Node\InterpolatedStringPart ? $p->value : '*';
        return $s;
    }
    return null;
}
// The literal prefix of a string expression ('' when it starts with a variable part).
function strPrefix(?Node $v): string {
    if ($v instanceof Node\Scalar\String_) return $v->value;
    if ($v instanceof Expr\BinaryOp\Concat) { $l = strPrefix($v->left); return $l !== '' && ($v->left instanceof Node\Scalar\String_) ? $l . strPrefix($v->right) : $l; }
    if ($v instanceof Node\Scalar\InterpolatedString && $v->parts && $v->parts[0] instanceof Node\InterpolatedStringPart) return $v->parts[0]->value;
    if ($v instanceof Expr\ConstFetch || $v instanceof Expr\ClassConstFetch) return (string) litOf($v);
    return '';
}

$asts = [];
foreach ($rels as $rel) {
    $abs = $root . '/' . $rel;
    $size = @filesize($abs);
    if ($size === false) { $parseErrors[] = ['file' => $rel, 'why' => 'unreadable']; continue; }
    if ($size > MAX_BYTES) { $parseErrors[] = ['file' => $rel, 'why' => 'over ' . MAX_BYTES . ' bytes']; continue; }
    $code = @file_get_contents($abs);
    if ($code === false) { $parseErrors[] = ['file' => $rel, 'why' => 'unreadable']; continue; }
    // A file under a bundled-library directory that names no WordPress API cannot register an entry
    // point, check a guard or mint a nonce, and parsing thousands of them exhausts memory. First-party
    // files are always parsed: a helper class with no WordPress call is still on the path to a write.
    if (preg_match(LIB_DIRS, $rel) && !preg_match(WP_TOKENS, $code)) { $notWp++; continue; }
    try { $ast = $parser->parse($code); } catch (Throwable $e) { $parseErrors[] = ['file' => $rel, 'why' => 'parse error']; continue; }
    if ($ast === null) { $parseErrors[] = ['file' => $rel, 'why' => 'parse error']; continue; }
    $asts[$rel] = $ast;
    $parsed++;
}

// Declarations first (classes, functions, constants), so string values resolve during the walk.
$finder = new PhpParser\NodeFinder();
foreach ($asts as $rel => $ast) {
    foreach ($finder->find($ast, fn($n) => $n instanceof Expr\FuncCall && lc($n->name) === 'define') as $d) {
        $k = argAt($d, 0); $v = argAt($d, 1);
        if ($k instanceof Node\Scalar\String_ && $v instanceof Node\Scalar\String_ && !isset($defines[$k->value])) $defines[$k->value] = $v->value;
    }
    foreach ($finder->find($ast, fn($n) => $n instanceof Stmt\ClassLike) as $cls) {
        if (!$cls->name) continue;
        $cn = strtolower($cls->name->toString());
        if (isset($classes[$cn])) continue; // first declaration wins; a duplicate name is reported by name lookups
        $c = ['extends' => null, 'uses' => [], 'methods' => [], 'consts' => [], 'file' => $rel];
        if ($cls instanceof Stmt\Class_ && $cls->extends) $c['extends'] = lc($cls->extends);
        foreach ($cls->stmts as $s) {
            if ($s instanceof Stmt\TraitUse) foreach ($s->traits as $t) $c['uses'][] = lc($t);
            if ($s instanceof Stmt\ClassConst) foreach ($s->consts as $k) if ($k->value instanceof Node\Scalar\String_) $c['consts'][$k->name->toString()] = $k->value->value;
        }
        $classes[$cn] = $c;
    }
}
foreach ($asts as $rel => $ast) {
    foreach ($finder->find($ast, fn($n) => $n instanceof Stmt\Function_) as $fn) {
        $id = newFn($rel, $fn, null, $fn->name->toString(), 'function');
        $functions[strtolower($fn->name->toString())][] = $id;
    }
    foreach ($finder->find($ast, fn($n) => $n instanceof Stmt\ClassLike) as $cls) {
        $cn = $cls->name ? strtolower($cls->name->toString()) : null;
        foreach ($cls->getMethods() as $m) {
            $mn = strtolower($m->name->toString());
            $id = newFn($rel, $m, $cn, ($cls->name ? $cls->name->toString() : 'class@anonymous') . '::' . $m->name->toString(), 'method');
            if ($cn !== null && ($classes[$cn]['file'] ?? null) === $rel && !isset($classes[$cn]['methods'][$mn])) $classes[$cn]['methods'][$mn] = $id;
            $methodsByName[$mn][] = $id;
        }
    }
    $top = [];
    $collect = function (array $stmts) use (&$top, &$collect) {
        foreach ($stmts as $s) {
            if ($s instanceof Stmt\Namespace_) { $collect($s->stmts ?? []); continue; }
            if ($s instanceof Stmt\Function_ || $s instanceof Stmt\ClassLike) continue;
            $top[] = $s;
        }
    };
    $collect($ast);
    newFn($rel, new Stmt\Function_('(file)', ['stmts' => $top], ['startLine' => 1]), null, '(file)', 'file');
}
foreach ($asts as $rel => $ast) {
    foreach ($finder->find($ast, fn($n) => $n instanceof Stmt\ClassLike) as $cls) {
        if (!$cls->name) continue;
        $cn = strtolower($cls->name->toString());
        if (($classes[$cn]['file'] ?? null) !== $rel) continue;
        $pt = [];
        foreach ($cls->stmts as $st) if ($st instanceof Stmt\Property && ($t = typeName($st->type))) foreach ($st->props as $pp) $pt[$pp->name->toString()] = $t;
        foreach ($cls->getMethods() as $m) {
            foreach ($m->getParams() as $p) if ($p->flags && $p->var instanceof Expr\Variable && ($t = typeName($p->type))) $pt[$p->var->name] = $t;
            $ptypes = [];
            foreach ($m->getParams() as $p) if ($p->var instanceof Expr\Variable && ($t = typeName($p->type))) $ptypes[$p->var->name] = $t;
            foreach ($finder->find($m->stmts ?? [], fn($n) => $n instanceof Expr\Assign && $n->var instanceof Expr\PropertyFetch && $n->var->var instanceof Expr\Variable && $n->var->var->name === 'this' && $n->var->name instanceof Node\Identifier) as $a) {
                $prop = $a->var->name->toString();
                $t = null;
                if ($a->expr instanceof Expr\New_ && $a->expr->class instanceof Node\Name) $t = lc($a->expr->class);
                elseif ($a->expr instanceof Expr\Variable && is_string($a->expr->name) && isset($ptypes[$a->expr->name])) $t = $ptypes[$a->expr->name];
                if ($t !== null) { if (array_key_exists($prop, $pt) && $pt[$prop] !== $t) $pt[$prop] = null; elseif (!array_key_exists($prop, $pt)) $pt[$prop] = $t; }
            }
        }
        $PROPTYPES[$cn] = $pt;
    }
}
$fileFn = [];
foreach ($FN as $id => $f) if ($f['kind'] === 'file') $fileFn[$f['file']] = $id;

// ── per-function own-body index (nested functions, classes and closures are their own owners) ─────
$OWN = [];
function bodyOf(Node $fn): array {
    if ($fn instanceof Expr\ArrowFunction) return [new Stmt\Return_($fn->expr, $fn->getAttributes())];
    return $fn->stmts ?? [];
}
function own(int $id): array {
    global $OWN, $FN, $byNode;
    if (isset($OWN[$id])) return $OWN[$id];
    $o = ['calls' => [], 'assigns' => [], 'includes' => [], 'exprStmts' => [], 'superReads' => false, 'screen' => false, 'strings' => []];
    $stack = bodyOf($FN[$id]['node']);
    while ($stack) {
        $n = array_pop($stack);
        if (!$n instanceof Node) continue;
        if ($n instanceof Expr\Closure || $n instanceof Expr\ArrowFunction) {
            if (!isset($byNode[spl_object_id($n)])) newFn($FN[$id]['file'], $n, $FN[$id]['cls'], '{closure}', 'closure');
            continue;
        }
        if ($n instanceof Stmt\Function_ || $n instanceof Stmt\ClassLike) continue;
        if ($n instanceof Expr\CallLike) $o['calls'][] = $n;
        if ($n instanceof Expr\Assign || $n instanceof Expr\AssignOp || $n instanceof Expr\AssignRef || $n instanceof Stmt\Foreach_) $o['assigns'][] = $n;
        if ($n instanceof Expr\Include_) $o['includes'][] = $n;
        if ($n instanceof Node\Scalar\String_ && strlen($n->value) <= 200 && preg_match('#^[A-Za-z0-9_./-]+$#', $n->value)) $o['strings'][strtolower($n->value)] = true;
        if ($n instanceof Stmt\Expression) $o['exprStmts'][] = $n;
        if ($n instanceof Expr\Variable && is_string($n->name) && in_array($n->name, ['_GET', '_POST', '_REQUEST', '_FILES', '_COOKIE'], true)) $o['superReads'] = true;
        if ($n instanceof Expr\FuncCall && lc($n->name) === 'get_current_screen') $o['screen'] = true;
        if ($n instanceof Expr\Variable && in_array($n->name, ['pagenow', 'typenow', 'hook_suffix', 'current_screen'], true)) $o['screen'] = true;
        foreach ($n->getSubNodeNames() as $sn) {
            $c = $n->$sn;
            if ($c instanceof Node) $stack[] = $c;
            elseif (is_array($c)) foreach (array_reverse($c) as $cc) if ($cc instanceof Node) $stack[] = $cc;
        }
    }
    // calls in source order, so everything downstream is order-stable
    usort($o['calls'], fn($a, $b) => [$a->getStartLine(), $a->getStartFilePos()] <=> [$b->getStartLine(), $b->getStartFilePos()]);
    usort($o['assigns'], fn($a, $b) => [$a->getStartLine(), $a->getStartFilePos()] <=> [$b->getStartLine(), $b->getStartFilePos()]);
    return $OWN[$id] = $o;
}
// Touch every function once so closures nested anywhere are registered.
for ($i = 0; $i < count($FN); $i++) own($i);

// ── resolution ───────────────────────────────────────────────────────────────────────────────────
function lookupMethod(?string $cls, string $mn, int $guard = 0): ?int {
    global $classes;
    if ($cls === null || $guard > 12 || !isset($classes[$cls])) return null;
    $c = $classes[$cls];
    if (isset($c['methods'][$mn])) return $c['methods'][$mn];
    foreach ($c['uses'] as $t) { $r = lookupMethod($t, $mn, $guard + 1); if ($r !== null) return $r; }
    return lookupMethod($c['extends'], $mn, $guard + 1);
}
function byName(string $mn, int $max = 1): array {
    global $methodsByName;
    $c = $methodsByName[$mn] ?? [];
    return count($c) >= 1 && count($c) <= $max ? $c : [];
}
// The class a property holds: a typed declaration, a promoted constructor parameter, or `new X` /
// a typed parameter assigned to it in any method of the class.
$PROPTYPES = [];
function propType(?string $cls, string $prop, int $guard = 0): ?string {
    global $PROPTYPES, $classes;
    if ($cls === null || $guard > 12) return null;
    if (isset($PROPTYPES[$cls]) && array_key_exists($prop, $PROPTYPES[$cls])) return $PROPTYPES[$cls][$prop];
    return propType($classes[$cls]['extends'] ?? null, $prop, $guard + 1);
}
function typeName($t): ?string {
    if ($t instanceof Node\NullableType) $t = $t->type;
    if ($t instanceof Node\Name) { $n = lc($t); return in_array($n, ['self', 'static', 'array', 'string', 'int', 'bool', 'mixed', 'object', 'callable', 'iterable'], true) ? null : $n; }
    return null;
}
function paramType(int $owner, string $var): ?string {
    global $FN;
    $n = $FN[$owner]['node'];
    if ($n instanceof Node\FunctionLike) foreach ($n->getParams() as $p) if ($p->var instanceof Expr\Variable && $p->var->name === $var) return typeName($p->type);
    return null;
}
// The class a variable was last assigned `new X` in this function, if any.
function newClassOf(int $owner, string $var): ?string {
    $cls = null;
    foreach (own($owner)['assigns'] as $a) {
        if ($a instanceof Expr\Assign && $a->var instanceof Expr\Variable && $a->var->name === $var && $a->expr instanceof Expr\New_ && $a->expr->class instanceof Node\Name) $cls = lc($a->expr->class);
    }
    return $cls;
}
function lastAssign(int $owner, string $var): ?Node {
    $v = null;
    foreach (own($owner)['assigns'] as $a) if ($a instanceof Expr\Assign && $a->var instanceof Expr\Variable && $a->var->name === $var) $v = $a->expr;
    return $v;
}
/** [ids, how] for a call site. */
function resolveCall(Node $c, int $owner): array {
    global $functions, $FN;
    $cls = $FN[$owner]['cls'];
    $n = callName($c);
    if ($n === null) return [[], 'dynamic'];
    if ($c instanceof Expr\FuncCall) return isset($functions[$n]) ? [$functions[$n], 'function'] : [[], 'external'];
    if ($c instanceof Expr\MethodCall || $c instanceof Expr\NullsafeMethodCall) {
        if ($c->var instanceof Expr\Variable && $c->var->name === 'this') { $r = lookupMethod($cls, $n); if ($r !== null) return [[$r], 'this']; }
        elseif ($c->var instanceof Expr\Variable && is_string($c->var->name) && ($k = newClassOf($owner, $c->var->name) ?? paramType($owner, $c->var->name)) !== null) { $r = lookupMethod($k, $n); if ($r !== null) return [[$r], 'new']; }
        elseif ($c->var instanceof Expr\PropertyFetch && $c->var->var instanceof Expr\Variable && $c->var->var->name === 'this' && $c->var->name instanceof Node\Identifier && ($k = propType($cls, $c->var->name->toString())) !== null) { $r = lookupMethod($k, $n); if ($r !== null) return [[$r], 'property']; }
        $b = byName($n);
        if ($b) return [$b, 'by-name'];
        $b = byName($n, MAX_AMBIGUOUS);
        return $b ? [$b, 'ambiguous'] : [[], 'unresolved'];
    }
    if ($c instanceof Expr\StaticCall) {
        $k = $c->class instanceof Node\Name ? lc($c->class) : null;
        if (in_array($k, ['self', 'static'], true)) $k = $cls;
        elseif ($k === 'parent') { global $classes; $k = $classes[$cls]['extends'] ?? null; }
        $r = lookupMethod($k, $n);
        if ($r !== null) return [[$r], 'static'];
        $b = byName($n);
        if ($b) return [$b, 'by-name'];
        $b = byName($n, MAX_AMBIGUOUS);
        return $b ? [$b, 'ambiguous'] : [[], 'unresolved'];
    }
    return [[], 'dynamic'];
}
/** [ids, how] for a value used as a callback. */
function resolveCallable(?Node $e, int $owner, int $guard = 0): array {
    global $functions, $byNode, $FN, $classes;
    if ($e instanceof Node\Arg) $e = $e->value;
    if ($e === null || $guard > 2) return [[], 'none'];
    $cls = $FN[$owner]['cls'];
    if ($e instanceof Expr\Closure || $e instanceof Expr\ArrowFunction) return isset($byNode[spl_object_id($e)]) ? [[$byNode[spl_object_id($e)]], 'closure'] : [[], 'closure-unindexed'];
    if ($e instanceof Node\Scalar\String_) {
        $s = $e->value;
        if (str_contains($s, '::')) { [$k, $m] = explode('::', $s, 2); $r = lookupMethod(lc($k), strtolower($m)); return $r !== null ? [[$r], 'static-string'] : [byName(strtolower($m)), 'by-name']; }
        $f = lc($s);
        return isset($functions[$f]) ? [$functions[$f], 'function'] : [[], 'external:' . $f];
    }
    if ($e instanceof Expr\Array_ && count($e->items) === 2 && $e->items[0] && $e->items[1]) {
        $t = $e->items[0]->value;
        $mn = litOf($e->items[1]->value);
        if ($mn === null || str_contains($mn, '*')) return [[], 'dynamic-method'];
        $mn = strtolower($mn);
        $k = null;
        if ($t instanceof Expr\Variable && $t->name === 'this') $k = $cls;
        elseif ($t instanceof Node\Scalar\MagicConst\Class_) $k = $cls;
        elseif ($t instanceof Expr\ClassConstFetch && lc($t->name) === 'class') { $k = lc($t->class instanceof Node\Name ? $t->class : null); if (in_array($k, ['self', 'static'], true)) $k = $cls; }
        elseif ($t instanceof Node\Scalar\String_) $k = lc($t->value);
        elseif ($t instanceof Expr\New_ && $t->class instanceof Node\Name) $k = lc($t->class);
        elseif ($t instanceof Expr\Variable && is_string($t->name)) $k = newClassOf($owner, $t->name);
        if ($k !== null) { $r = lookupMethod($k, $mn); if ($r !== null) return [[$r], 'method']; }
        $b = byName($mn);
        return $b ? [$b, 'by-name'] : [[], 'unresolved'];
    }
    if ($e instanceof Expr\Variable && is_string($e->name)) { $v = lastAssign($owner, $e->name); return $v ? resolveCallable($v, $owner, $guard + 1) : [[], 'variable']; }
    if (($e instanceof Expr\MethodCall || $e instanceof Expr\StaticCall || $e instanceof Expr\FuncCall) && $e->isFirstClassCallable()) return resolveCall($e, $owner);
    return [[], 'dynamic'];
}

// ── taint: what the request can influence ────────────────────────────────────────────────────────
function paramNames(int $id): array {
    global $FN;
    $n = $FN[$id]['node'];
    $out = [];
    if ($n instanceof Node\FunctionLike) foreach ($n->getParams() as $p) $out[] = ($p->var instanceof Expr\Variable && is_string($p->var->name)) ? $p->var->name : null;
    return $out;
}
function isSource(Node $n, bool $forKey): bool {
    if ($n instanceof Expr\ArrayDimFetch && $n->var instanceof Expr\Variable && is_string($n->var->name)) {
        if ($n->var->name === '_SERVER') {
            $k = litOf($n->dim);
            return $k !== null && (in_array($k, SERVER_REQUEST_KEYS, true) || str_starts_with($k, 'HTTP_'));
        }
    }
    if ($n instanceof Expr\Variable && is_string($n->name) && in_array($n->name, ['_GET', '_POST', '_REQUEST', '_COOKIE', '_FILES'], true)) return true;
    if ($n instanceof Expr\FuncCall) {
        $f = lc($n->name);
        if ($f === 'file_get_contents') return litOf(argAt($n, 0)) === 'php://input';
        if ($f === 'filter_input' || $f === 'filter_input_array') return true;
        if ($f === 'get_query_var') return !$forKey;
    }
    return false;
}
function exprTainted(?Node $n, array $tv, bool $forKey = false): bool {
    if ($n === null) return false;
    if ($n instanceof Node\Arg) return exprTainted($n->value, $tv, $forKey);
    if ($n instanceof Expr\Closure || $n instanceof Expr\ArrowFunction) return false;
    if ($forKey && $n instanceof Expr\ArrayDimFetch && $n->var instanceof Expr\ArrayDimFetch && litOf($n->dim) === 'tmp_name') return false;
    if (isSource($n, $forKey)) return true;
    if ($n instanceof Expr\Variable && is_string($n->name)) return isset($tv[$n->name]);
    if ($n instanceof Expr\PropertyFetch && $n->var instanceof Expr\Variable && $n->var->name === 'this' && $n->name instanceof Node\Identifier) return isset($tv['this->' . $n->name->toString()]);
    if ($forKey) {
        // A key with a literal prefix names the plugin's own option, not an arbitrary one; a value that
        // passed an allowlist is no longer chosen freely.
        if (($n instanceof Expr\BinaryOp\Concat || $n instanceof Node\Scalar\InterpolatedString) && strPrefix($n) !== '') return false;
        if ($n instanceof Expr\FuncCall && in_array(lc($n->name), ['absint', 'intval', 'get_current_user_id', 'count', 'md5', 'sha1', 'wp_hash', 'hash', 'uniqid', 'wp_generate_password', 'time', 'gmdate', 'date'], true)) return false;
        if ($n instanceof Expr\Cast\Int_ || $n instanceof Expr\Cast\Bool_ || $n instanceof Expr\Cast\Double) return false;
        if ($n instanceof Expr\Ternary || $n instanceof Expr\BinaryOp\Coalesce) {
            $parts = $n instanceof Expr\Ternary ? [$n->if ?? $n->cond, $n->else] : [$n->left, $n->right];
            foreach ($parts as $p) if (exprTainted($p, $tv, true)) return true;
            return false;
        }
    }
    foreach ($n->getSubNodeNames() as $sn) {
        $c = $n->$sn;
        if ($c instanceof Node) { if (exprTainted($c, $tv, $forKey)) return true; }
        elseif (is_array($c)) foreach ($c as $cc) if ($cc instanceof Node && exprTainted($cc, $tv, $forKey)) return true;
    }
    return false;
}
function targetOf(Node $v): array {
    if ($v instanceof Expr\Variable && is_string($v->name)) return [$v->name];
    if ($v instanceof Expr\ArrayDimFetch) return $v->var ? targetOf($v->var) : [];
    if ($v instanceof Expr\PropertyFetch && $v->var instanceof Expr\Variable && $v->var->name === 'this' && $v->name instanceof Node\Identifier) return ['this->' . $v->name->toString()];
    if ($v instanceof Expr\List_ || $v instanceof Expr\Array_) { $o = []; foreach ($v->items as $i) if ($i && $i->value) $o = array_merge($o, targetOf($i->value)); return $o; }
    return [];
}
/** Variables a value from the request reaches, for each key mode. */
function taintVars(int $id, array $taintedIdx, bool $forKey): array {
    $names = paramNames($id);
    $tv = [];
    foreach ($taintedIdx as $i) if (isset($names[$i])) $tv[$names[$i]] = true;
    $assigns = own($id)['assigns'];
    for ($pass = 0; $pass < 4; $pass++) {
        $before = count($tv);
        foreach ($assigns as $a) {
            if ($a instanceof Stmt\Foreach_) {
                if (exprTainted($a->expr, $tv, $forKey)) foreach ([$a->valueVar, $a->keyVar] as $vv) if ($vv) foreach (targetOf($vv) as $t) $tv[$t] = true;
                continue;
            }
            if (exprTainted($a->expr, $tv, $forKey)) foreach (targetOf($a->var) as $t) $tv[$t] = true;
        }
        if (count($tv) === $before) break;
    }
    if ($forKey) {
        // allowlist lookups: isset($map[$x]), array_key_exists($x, …), in_array($x, …), method_exists(…, $x), $x === 'literal'
        foreach (own($id)['calls'] as $c) {
            $f = callName($c);
            $needle = null;
            if ($f === 'array_key_exists' || $f === 'in_array') $needle = argAt($c, 0);
            elseif ($f === 'method_exists' || $f === 'property_exists') $needle = argAt($c, 1);
            if ($needle instanceof Expr\Variable && is_string($needle->name)) unset($tv[$needle->name]);
        }
        $stack = bodyOf($GLOBALS['FN'][$id]['node']);
        while ($stack) {
            $n = array_pop($stack);
            if (!$n instanceof Node || $n instanceof Expr\Closure || $n instanceof Stmt\Function_ || $n instanceof Stmt\ClassLike) continue;
            if ($n instanceof Expr\Isset_) foreach ($n->vars as $v) if ($v instanceof Expr\ArrayDimFetch && $v->dim instanceof Expr\Variable && is_string($v->dim->name)) unset($tv[$v->dim->name]);
            if (($n instanceof Expr\BinaryOp\Identical || $n instanceof Expr\BinaryOp\Equal) && $n->left instanceof Expr\Variable && is_string($n->left->name) && $n->right instanceof Node\Scalar\String_) unset($tv[$n->left->name]);
            if ($n instanceof Stmt\Switch_ && $n->cond instanceof Expr\Variable && is_string($n->cond->name)) unset($tv[$n->cond->name]);
            foreach ($n->getSubNodeNames() as $sn) { $c = $n->$sn; if ($c instanceof Node) $stack[] = $c; elseif (is_array($c)) foreach ($c as $cc) $stack[] = $cc; }
        }
    }
    return $tv;
}

// ── call-site classification ─────────────────────────────────────────────────────────────────────
function isWpdb(?Node $v): bool {
    if ($v instanceof Expr\Variable) return $v->name === 'wpdb';
    if ($v instanceof Expr\PropertyFetch && $v->name instanceof Node\Identifier) return strtolower($v->name->toString()) === 'wpdb';
    if ($v instanceof Expr\ArrayDimFetch && $v->var instanceof Expr\Variable && $v->var->name === 'GLOBALS') return litOf($v->dim) === 'wpdb';
    return false;
}
function isWpFs(?Node $v): bool {
    if ($v instanceof Expr\Variable) return $v->name === 'wp_filesystem';
    if ($v instanceof Expr\ArrayDimFetch && $v->var instanceof Expr\Variable && $v->var->name === 'GLOBALS') return litOf($v->dim) === 'wp_filesystem';
    return false;
}
/** [call label, weight, key arg index] when the call writes state, else null. */
function mutationOf(Node $c): ?array {
    $n = callName($c);
    if ($n === null) return null;
    if ($c instanceof Expr\FuncCall && isset(MUTATIONS[$n])) {
        if ($n === 'wp_set_current_user') { $a = argAt($c, 0); if ($a instanceof Node\Scalar\Int_) return null; }
        return [$n, MUTATIONS[$n][0], MUTATIONS[$n][1]];
    }
    if (($c instanceof Expr\MethodCall || $c instanceof Expr\NullsafeMethodCall) && isWpdb($c->var) && array_key_exists($n, WPDB_WRITES)) {
        if ($n === 'query') {
            $q = argAt($c, 0);
            if ($q instanceof Expr\MethodCall && lc($q->name) === 'prepare') $q = argAt($q, 0);
            $p = ltrim(strtoupper(strPrefix($q)));
            if ($p !== '' && preg_match('/^(SELECT|SHOW|DESCRIBE|EXPLAIN|SET\s+(SESSION|NAMES))/', $p)) return null;
        }
        return ['$wpdb->' . $n, 'high', WPDB_WRITES[$n]];
    }
    if (($c instanceof Expr\MethodCall || $c instanceof Expr\NullsafeMethodCall) && isWpFs($c->var) && array_key_exists($n, FS_WRITES)) return ['$wp_filesystem->' . $n, 'high', FS_WRITES[$n]];
    return null;
}
function capOf(Node $c, string $how): ?array {
    $n = callName($c);
    if ($c instanceof Expr\FuncCall && in_array($n, CAP_FUNCS, true)) {
        $cap = $n === 'user_can' || $n === 'author_can' || $n === 'current_user_can_for_blog' || $n === 'current_user_can_for_site' ? litOf(argAt($c, 1)) : litOf(argAt($c, 0));
        if ($n === 'is_super_admin') $cap = 'super_admin';
        return ['cap' => $cap ?? '?', 'weak' => $cap !== null && in_array(strtolower($cap), WEAK_CAPS, true)];
    }
    if (!($c instanceof Expr\FuncCall) && in_array($n, CAP_METHODS, true)) { $cap = litOf(argAt($c, 0)); return ['cap' => $cap ?? '?', 'weak' => $cap !== null && in_array(strtolower($cap), WEAK_CAPS, true)]; }
    return null;
}
// A callee we cannot read whose name says it decides access, or verifies a token: never proven a
// guard, never proven absent.
function guardishName(string $n): ?string {
    if (preg_match('/capabilit|permission|(^|_)can(_|$)|_can$|^can|has_access|check_access|_access$|authori[sz]|is_allowed|user_can|is_admin_user|require_cap|verify_user|current_user_has/', $n)) return 'cap';
    if (preg_match('/nonce|referer|referrer|csrf|verify_request|validate_request|check_token|verify_token|signature/', $n)) return 'nonce';
    return null;
}

// ── transitive summary from an entry ────────────────────────────────────────────────────────────
// Calls that run only when the request says so: under a branch whose condition reads the request, or
// after an early return taken on one.
function exitsEarly(array $stmts): bool {
    foreach ($stmts as $s) {
        if ($s instanceof Stmt\Return_) return true;
        if ($s instanceof Stmt\Expression && ($s->expr instanceof Expr\Exit_ || ($s->expr instanceof Expr\FuncCall && in_array(lc($s->expr->name), ['wp_die', 'wp_send_json', 'wp_send_json_error', 'wp_send_json_success', 'die', 'exit'], true)))) return true;
    }
    return false;
}
function condCalls(int $id, array $tv): array {
    global $FN;
    $under = [];
    $mark = function (array $nodes) use (&$under): void {
        $st = $nodes;
        while ($st) {
            $n = array_pop($st);
            if (!$n instanceof Node || $n instanceof Expr\Closure || $n instanceof Expr\ArrowFunction || $n instanceof Stmt\Function_ || $n instanceof Stmt\ClassLike) continue;
            if ($n instanceof Expr\CallLike) $under[spl_object_id($n)] = true;
            foreach ($n->getSubNodeNames() as $sn) { $c = $n->$sn; if ($c instanceof Node) $st[] = $c; elseif (is_array($c)) foreach ($c as $cc) $st[] = $cc; }
        }
    };
    $walk = function (array $stmts) use (&$walk, $mark, $tv): void {
        $after = false;
        foreach ($stmts as $s) {
            if (!$s instanceof Node) continue;
            if ($after) { $mark([$s]); continue; }
            if ($s instanceof Stmt\If_) {
                if (exprTainted($s->cond, $tv)) { $mark(array_merge($s->stmts, $s->elseifs, $s->else ? [$s->else] : [])); if (exitsEarly($s->stmts)) $after = true; continue; }
                $walk($s->stmts); foreach ($s->elseifs as $ei) { if (exprTainted($ei->cond, $tv)) $mark($ei->stmts); else $walk($ei->stmts); } if ($s->else) $walk($s->else->stmts);
                continue;
            }
            if ($s instanceof Stmt\Switch_ && exprTainted($s->cond, $tv)) { $mark($s->cases); continue; }
            foreach (['stmts'] as $k) if (property_exists($s, $k) && is_array($s->$k) && !($s instanceof Stmt\Function_) && !($s instanceof Stmt\ClassLike)) $walk($s->$k);
        }
    };
    $walk(bodyOf($FN[$id]['node']));
    return $under;
}

$MEMO = [];
$CURCONST = [];
function summarize(int $id, array $taintedIdx, int $depth, array $stack, array $consts = []): array {
    global $MEMO, $FN, $CURCONST;
    sort($taintedIdx);
    ksort($consts);
    $key = $id . '|' . implode(',', $taintedIdx) . '|' . json_encode($consts);
    if (isset($MEMO[$key])) return $MEMO[$key];
    $S = ['cap' => [], 'capByName' => [], 'nonce' => [], 'nonceByName' => [], 'muts' => [], 'reads' => false, 'unresolved' => [], 'truncated' => false, 'screen' => false, 'nonceNoDie' => false, 'ambiguous' => false, 'cut' => false];
    // a recursion cut leaves this summary incomplete for every caller above it, so it is never memoised
    if (isset($stack[$id])) { $S['cut'] = true; return $S; }
    if ($depth > MAX_DEPTH) { $S['truncated'] = true; return $S; }
    $stack[$id] = true;
    $o = own($id);
    $names = paramNames($id);
    $saved = $CURCONST;
    $mine = [];
    foreach ($consts as $i => $v) if (isset($names[$i])) $mine[$names[$i]] = $v;
    $CURCONST = $mine;
    $tv = taintVars($id, $taintedIdx, false);
    $tk = taintVars($id, $taintedIdx, true);
    $under = condCalls($id, $tv);
    $S['reads'] = $o['superReads'] || count($taintedIdx) > 0;
    $S['screen'] = $o['screen'];
    $fn = $FN[$id];
    foreach ($o['calls'] as $c) {
        $n = callName($c);
        if ($n !== null && ($cap = capOf($c, ''))) $S['cap'][] = $cap;
        if ($c instanceof Expr\FuncCall && in_array($n, NONCE_FUNCS, true)) {
            $act = $n === 'wp_verify_nonce' ? argAt($c, 1) : argAt($c, 0);
            $a = $act === null ? '-1' : litOf($act);
            $S['nonce'][] = $a ?? '?';
            if ($n === 'check_ajax_referer' || $n === 'check_admin_referer') { $d = argAt($c, 2); if ($d instanceof Expr\ConstFetch && lc($d->name) === 'false') $S['nonceNoDie'] = true; }
        }
        $m = mutationOf($c);
        if ($m) {
            [$label, $weight, $keyIdx] = $m;
            $args = argsOf($c);
            $infl = false;
            foreach ($args as $ar) if (exprTainted($ar->value, $tv)) { $infl = true; break; }
            $keyFromReq = $keyIdx !== null && isset($args[$keyIdx]) && exprTainted($args[$keyIdx]->value, $tk, true);
            if ($label === '$wpdb->update' || $label === '$wpdb->delete') { $w = $label === '$wpdb->update' ? 2 : 1; $keyFromReq = isset($args[$w]) && exprTainted($args[$w]->value, $tk, true); }
            $S['muts'][] = ['call' => $label, 'weight' => $weight, 'influenced' => $infl, 'keyFromRequest' => $keyFromReq, 'triggered' => $infl || isset($under[spl_object_id($c)]),
                'file' => $fn['file'], 'fn' => $fn['label'], 'line' => $c->getStartLine()];
        }
        [$callees, $how] = resolveCall($c, $id);
        if (!$callees) {
            if ($n !== null && !in_array($n, NOT_GUARDS, true) && !in_array($n, CAP_FUNCS, true) && !in_array($n, NONCE_FUNCS, true)) {
                $g = guardishName($n);
                if ($g === 'cap') $S['capByName'][] = $n;
                if ($g === 'nonce') $S['nonceByName'][] = $n;
            }
            if ($how !== 'external' && $n !== null && !in_array($n, REQUEST_METHODS, true)) $S['unresolved'][] = $n;
            continue;
        }
        $args = argsOf($c);
        $cargs = [];
        foreach ($args as $i => $ar) if (!$ar->name && ($lv = litOf($ar->value)) !== null && !str_contains($lv, '*')) $cargs[$i] = $lv;
        foreach ($callees as $ce) {
            $idx = [];
            foreach ($args as $i => $ar) if (!$ar->name && exprTainted($ar->value, $tv)) $idx[] = $i;
            $sub = summarize($ce, $idx, $depth + 1, $stack, $cargs);
            $CURCONST = $mine;
            if ($how === 'ambiguous' || $sub['ambiguous']) { foreach ($sub['muts'] as &$am) $am['viaAmbiguous'] = true; unset($am); $S['ambiguous'] = true; }
            if (isset($under[spl_object_id($c)])) foreach ($sub['muts'] as &$sm) $sm['triggered'] = true;
            unset($sm);
            foreach (['cap', 'capByName', 'nonce', 'nonceByName', 'muts', 'unresolved'] as $k) $S[$k] = array_merge($S[$k], $sub[$k]);
            $S['reads'] = $S['reads'] || $sub['reads'];
            $S['truncated'] = $S['truncated'] || $sub['truncated'];
            $S['cut'] = $S['cut'] || $sub['cut'];
            $S['nonceNoDie'] = $S['nonceNoDie'] || $sub['nonceNoDie'];
        }
    }
    $CURCONST = $saved;
    foreach (['capByName', 'nonce', 'nonceByName', 'unresolved'] as $k) { $S[$k] = array_values(array_unique($S[$k])); sort($S[$k]); }
    $caps = []; foreach ($S['cap'] as $cp) $caps[$cp['cap'] . '|' . ($cp['weak'] ? 1 : 0)] = $cp; ksort($caps); $S['cap'] = array_values($caps);
    $mu = []; foreach ($S['muts'] as $mm) { $mm['viaAmbiguous'] = !empty($mm['viaAmbiguous']); $mu[$mm['file'] . '|' . $mm['fn'] . '|' . $mm['call'] . '|' . ($mm['influenced'] ? 1 : 0) . ($mm['keyFromRequest'] ? 1 : 0) . ($mm['triggered'] ? 1 : 0) . ($mm['viaAmbiguous'] ? 1 : 0)] = $mm; } ksort($mu); $S['muts'] = array_values($mu);
    if (!$S['truncated'] && !$S['cut']) $MEMO[$key] = $S;
    return $S;
}

// ── registrations ────────────────────────────────────────────────────────────────────────────────
$entries = [];
$menuRoots = [];   // fn id => capability ('?' when dynamic)
$hookCallbacks = []; // hook => [fn ids]
$doActions = [];   // owner fn id => [hook names]
$mints = [];       // action => [fn ids]
$discarded = [];
$restGuard = [];
$unresolvedEntries = [];
$counts = ['routes' => 0];
$ids = array_keys($FN);
foreach ($ids as $owner) {
    foreach (own($owner)['calls'] as $c) {
        if (!($c instanceof Expr\FuncCall) || !($c->name instanceof Node\Name)) continue;
        $f = lc($c->name);
        $args = argsOf($c);
        $line = $c->getStartLine();
        $file = $FN[$owner]['file'];
        if (($f === 'add_action' || $f === 'add_filter') && count($args) >= 2) {
            $hook = litOf($args[0]->value);
            if ($hook === null) continue;
            [$cb, $how] = resolveCallable($args[1]->value, $owner);
            foreach ($cb as $x) $hookCallbacks[$hook][] = $x;
            if (in_array($hook, ['rest_authentication_errors', 'rest_pre_dispatch', 'rest_request_before_callbacks'], true)) $restGuard[] = $hook;
            $kind = null;
            if (str_starts_with($hook, 'wp_ajax_nopriv_')) $kind = 'ajax-nopriv';
            elseif (str_starts_with($hook, 'wp_ajax_')) $kind = 'ajax';
            elseif (str_starts_with($hook, 'admin_post_nopriv_')) $kind = 'admin-post-nopriv';
            elseif (str_starts_with($hook, 'admin_post_') || $hook === 'admin_post') $kind = 'admin-post';
            elseif (in_array($hook, ENTRY_HOOKS, true) || str_starts_with($hook, 'load-')) $kind = 'hook';
            if ($kind === null) continue;
            if (!$cb) { $unresolvedEntries[] = ['kind' => $kind, 'hook' => $hook, 'file' => $file, 'line' => $line, 'how' => $how]; continue; }
            foreach ($cb as $x) $entries[] = ['kind' => $kind, 'hook' => $hook, 'file' => $file, 'line' => $line, 'fn' => $x, 'how' => $how, 'owner' => $owner];
        } elseif ($f === 'add_shortcode' && count($args) >= 2) {
            [$cb] = resolveCallable($args[1]->value, $owner);
            foreach ($cb as $x) $hookCallbacks['(shortcode)'][] = $x;
        } elseif (($f === 'do_action' || $f === 'apply_filters' || $f === 'do_action_ref_array' || $f === 'apply_filters_ref_array') && count($args) >= 1) {
            $h = litOf($args[0]->value);
            if ($h !== null && !str_contains($h, '*')) $doActions[$owner][] = $h;
        } elseif (($f === 'add_settings_field' || $f === 'add_settings_section') && count($args) >= 3) {
            [$cb] = resolveCallable($args[2]->value, $owner);
            foreach ($cb as $x) $menuRoots[$x][] = 'manage_options';
        } elseif ($f === 'add_meta_box' && count($args) >= 3) {
            [$cb] = resolveCallable($args[2]->value, $owner);
            foreach ($cb as $x) $hookCallbacks['(meta-box)'][] = $x;
        } elseif (isset(MENU_FUNCS[$f])) {
            [$ci, $bi] = MENU_FUNCS[$f];
            if (!isset($args[$bi])) continue;
            $cap = isset($args[$ci]) ? (litOf($args[$ci]->value) ?? '?') : '?';
            [$cb] = resolveCallable($args[$bi]->value, $owner);
            foreach ($cb as $x) $menuRoots[$x][] = $cap;
        } elseif (isset(MINT_FUNCS[$f])) {
            $a = $args[MINT_FUNCS[$f]] ?? null;
            $act = $a === null ? '-1' : (litOf($a->value) ?? '?');
            $mints[$act][] = $owner;
        } elseif ($f === 'register_rest_route' && count($args) >= 3) {
            $counts['routes']++;
            $route = (litOf($args[0]->value) ?? '?') . (litOf($args[1]->value) ?? '?');
            $spec = $args[2]->value;
            if ($spec instanceof Expr\Variable && is_string($spec->name)) $spec = lastAssign($owner, $spec->name);
            if (!$spec instanceof Expr\Array_) { $unresolvedEntries[] = ['kind' => 'rest', 'hook' => $route, 'file' => $file, 'line' => $line, 'how' => 'spec']; continue; }
            $first = $spec->items[0] ?? null;
            $isList = $first && $first->key === null && ($first->value instanceof Expr\Array_);
            $specs = $isList ? array_map(fn($i) => $i?->value, $spec->items) : [$spec];
            foreach ($specs as $s) {
                if (!$s instanceof Expr\Array_) continue;
                $cbE = null; $permE = null; $hasPerm = false; $methods = '';
                foreach ($s->items as $it) {
                    if (!$it || !$it->key) continue;
                    $k = litOf($it->key);
                    if ($k === 'callback') $cbE = $it->value;
                    elseif ($k === 'permission_callback') { $permE = $it->value; $hasPerm = true; }
                    elseif ($k === 'methods') {
                        $mv = $it->value;
                        if ($mv instanceof Expr\Array_) $methods = implode(',', array_map(fn($i) => $i ? (litOf($i->value) ?? (($i->value instanceof Expr\ClassConstFetch) ? lc($i->value->name) : '?')) : '?', $mv->items));
                        elseif ($mv instanceof Expr\ClassConstFetch) $methods = (string) lc($mv->name);
                        else $methods = litOf($mv) ?? '?';
                    }
                }
                if ($cbE === null) continue;
                [$cb, $how] = resolveCallable($cbE, $owner);
                $perm = 'missing';
                $permFacts = null;
                if ($hasPerm) {
                    if ($permE instanceof Node\Scalar\String_ && strtolower($permE->value) === '__return_true') $perm = 'return-true';
                    elseif ($permE instanceof Node\Scalar\String_ && strtolower($permE->value) === '__return_false') $perm = 'closed';
                    elseif ($permE instanceof Expr\ConstFetch && lc($permE->name) === 'true') $perm = 'return-true';
                    else {
                        [$pc] = resolveCallable($permE, $owner);
                        if (!$pc) $perm = 'unresolved';
                        else {
                            $perm = 'callback';
                            $pn = $FN[$pc[0]]['node'];
                            $body = bodyOf($pn);
                            if (count($body) === 1 && $body[0] instanceof Stmt\Return_ && $body[0]->expr instanceof Expr\ConstFetch && lc($body[0]->expr->name) === 'true') $perm = 'return-true';
                            else {
                                $ps = summarize($pc[0], [0], 0, []);
                                $strong = array_filter($ps['cap'], fn($x) => !$x['weak']);
                                $permFacts = ['cap' => array_map(fn($x) => $x['cap'], $ps['cap']), 'strong' => (bool) $strong, 'byName' => array_merge($ps['capByName'], $ps['nonceByName']), 'nonce' => $ps['nonce']];
                            }
                        }
                    }
                }
                if (!$cb) { $unresolvedEntries[] = ['kind' => 'rest', 'hook' => $route, 'file' => $file, 'line' => $line, 'how' => $how]; continue; }
                foreach ($cb as $x) $entries[] = ['kind' => 'rest', 'hook' => $route, 'file' => $file, 'line' => $line, 'fn' => $x, 'how' => $how, 'owner' => $owner,
                    'rest' => ['methods' => $methods, 'perm' => $perm, 'permFacts' => $permFacts]];
            }
        }
    }
    foreach (own($owner)['exprStmts'] as $st) {
        $e = $st->expr;
        if (!($e instanceof Expr\FuncCall)) continue;
        $f = lc($e->name);
        $bare = in_array($f, ['wp_verify_nonce', 'current_user_can', 'user_can', 'is_user_logged_in'], true);
        if ($f === 'check_ajax_referer' || $f === 'check_admin_referer') { $d = argAt($e, 2); $bare = $d instanceof Expr\ConstFetch && lc($d->name) === 'false'; }
        if ($bare) $discarded[] = ['call' => $f, 'file' => $FN[$owner]['file'], 'fn' => $FN[$owner]['label'], 'line' => $st->getStartLine()];
    }
}

// ── who can obtain a nonce: the context each minting function runs in ─────────────────────────
// Edges: calls we can resolve, includes of a file we can name, and do_action → registered callbacks.
$CALLERS = [];
foreach ($ids as $owner) {
    $o = own($owner);
    foreach ($o['calls'] as $c) { [$ce] = resolveCall($c, $owner); foreach ($ce as $x) $CALLERS[$x][$owner] = true; }
    foreach ($o['includes'] as $inc) {
        $s = litOf($inc->expr);
        if ($s === null) continue;
        $tail = ltrim((string) preg_replace('/^.*\*/', '', $s), '/');
        if ($tail === '' || !str_ends_with($tail, '.php')) continue;
        $hits = [];
        foreach ($fileFn as $rel => $fid) if ($rel === $tail || str_ends_with($rel, '/' . $tail)) $hits[] = $fid;
        if (count($hits) === 1) $CALLERS[$hits[0]][$owner] = true;
    }
    foreach ($doActions[$owner] ?? [] as $h) foreach ($hookCallbacks[$h] ?? [] as $x) $CALLERS[$x][$owner] = true;
}
// A template no include names literally is usually loaded by a helper given its name: a function
// holding the template's file name as a string is taken to be what renders it.
$byBase = [];
foreach ($fileFn as $rel => $fid) if (!isset($CALLERS[$fid])) { $b = strtolower(basename($rel, '.php')); if (strlen($b) >= 6 && $b !== 'index') $byBase[$b][] = [$fid, strtolower($rel)]; }
if ($byBase) {
    $hits = [];
    foreach ($ids as $owner) foreach (own($owner)['strings'] as $str => $_) {
        $str = (string) $str;
        $b = strtolower(basename($str, '.php'));
        if (!isset($byBase[$b])) continue;
        foreach ($byBase[$b] as [$fid, $rel]) if ($fid !== $owner && ($str === $b || $str === "$b.php" || str_ends_with($rel, ltrim($str, './')))) $hits[$fid][$owner] = true;
    }
    foreach ($hits as $fid => $owners) if (count($owners) <= 5) foreach ($owners as $o => $_) $CALLERS[$fid][$o] = true;
}
$ROOTCTX = [];
foreach ($hookCallbacks as $h => $xs) {
    $ctx = null;
    if ($h === '(shortcode)' || in_array($h, PUBLIC_HOOKS, true) || str_starts_with($h, 'wp_ajax_nopriv_') || str_starts_with($h, 'admin_post_nopriv_')) $ctx = 'public';
    elseif (in_array($h, LOGGEDIN_HOOKS, true) || str_starts_with($h, 'wp_ajax_') || str_starts_with($h, 'admin_post_')) $ctx = 'loggedin';
    // a page-specific admin hook fires only on that screen, after core has checked the page's capability
    elseif (preg_match('/^(load|admin_print_styles|admin_print_scripts|admin_head|admin_footer|admin_action)-./', $h)) $ctx = 'cap';
    if ($ctx) foreach ($xs as $x) $ROOTCTX[$x][] = $ctx;
}
foreach ($menuRoots as $x => $caps) foreach ($caps as $cap) $ROOTCTX[$x][] = in_array(strtolower($cap), WEAK_CAPS, true) ? 'loggedin' : 'cap';
$RANK = ['public' => 0, 'unknown' => 1, 'loggedin' => 2, 'cap' => 3];
$CTXMEMO = [];
function directCap(int $id): bool {
    foreach (own($id)['calls'] as $c) { $cp = capOf($c, ''); if ($cp && !$cp['weak']) return true; }
    return false;
}
function ctxOf(int $id, array $stack = []): string {
    global $CTXMEMO, $ROOTCTX, $CALLERS, $RANK;
    if (isset($CTXMEMO[$id])) return $CTXMEMO[$id];
    if (directCap($id)) return $CTXMEMO[$id] = 'cap';
    if (isset($stack[$id]) || count($stack) > 10) return 'unknown';
    $stack[$id] = true;
    $seen = $ROOTCTX[$id] ?? [];
    foreach (array_keys($CALLERS[$id] ?? []) as $caller) $seen[] = ctxOf($caller, $stack);
    if (!$seen) $r = 'unknown';
    else { usort($seen, fn($a, $b) => $RANK[$a] <=> $RANK[$b]); $r = $seen[0]; }
    if ($r === 'loggedin' && own($id)['screen']) $r = 'cap';
    if (count($stack) === 1) $CTXMEMO[$id] = $r;
    return $r;
}
function issuedTo(string $action): string {
    global $mints, $RANK;
    if ($action === '?' || str_contains($action, '*')) return 'unknown';
    if (!isset($mints[$action])) return $action === 'wp_rest' ? 'loggedin' : 'not-found';
    $all = array_map(fn($id) => ctxOf($id), array_values(array_unique($mints[$action])));
    usort($all, fn($a, $b) => $RANK[$a] <=> $RANK[$b]);
    return $all[0];
}

function mintSites(string $action): array {
    global $mints, $FN;
    $o = [];
    foreach (array_values(array_unique($mints[$action] ?? [])) as $id) $o[] = ['file' => $FN[$id]['file'], 'fn' => $FN[$id]['label'], 'ctx' => ctxOf($id)];
    usort($o, fn($a, $b) => [$a['file'], $a['fn']] <=> [$b['file'], $b['fn']]);
    return array_slice($o, 0, 5);
}

// ── emit ─────────────────────────────────────────────────────────────────────────────────────────
$out = [];
$seenEntry = [];
foreach ($entries as $e) {
    $id = $e['fn'];
    $fn = $FN[$id];
    $label = $fn['label'] === '{closure}' ? '{closure}' : $fn['label'];
    $k = $e['kind'] . '|' . $e['hook'] . '|' . $fn['file'] . '|' . $label . '|' . json_encode($e['rest'] ?? null);
    if (isset($seenEntry[$k])) continue;
    $seenEntry[$k] = true;
    $taint = $e['kind'] === 'rest' ? [0] : [];
    $S = summarize($id, $taint, 0, []);
    $nonces = array_map(fn($a) => ['action' => $a, 'issuedTo' => issuedTo($a), 'mintedIn' => mintSites($a)], $S['nonce']);
    $row = ['kind' => $e['kind'], 'hook' => $e['hook'], 'file' => $e['file'], 'line' => $e['line'], 'how' => $e['how'],
        'handler' => $label, 'handlerFile' => $fn['file'], 'handlerLine' => $fn['node']->getStartLine(),
        'cap' => $S['cap'], 'capByName' => $S['capByName'], 'nonce' => $nonces, 'nonceByName' => $S['nonceByName'], 'nonceNoDie' => $S['nonceNoDie'],
        'muts' => $S['muts'], 'reads' => $S['reads'], 'screen' => $S['screen'], 'unresolvedCalls' => count($S['unresolved']), 'truncated' => $S['truncated']];
    if (isset($e['rest'])) $row['rest'] = $e['rest'];
    $out[] = $row;
}
usort($out, fn($a, $b) => [$a['handlerFile'], $a['handler'], $a['kind'], $a['hook']] <=> [$b['handlerFile'], $b['handler'], $b['kind'], $b['hook']]);
usort($unresolvedEntries, fn($a, $b) => [$a['file'], $a['line'], $a['hook']] <=> [$b['file'], $b['line'], $b['hook']]);
usort($discarded, fn($a, $b) => [$a['file'], $a['fn'], $a['call'], $a['line']] <=> [$b['file'], $b['fn'], $b['call'], $b['line']]);
usort($parseErrors, fn($a, $b) => strcmp($a['file'], $b['file']));
$restGuard = array_values(array_unique($restGuard)); sort($restGuard);

echo json_encode([
    'tool' => 'wp-authz-facts', 'parser' => 'nikic/php-parser 5',
    'files' => count($rels), 'parsed' => $parsed, 'notWordPress' => $notWp, 'parseErrors' => $parseErrors,
    'functions' => count($FN), 'routes' => $counts['routes'],
    'entries' => $out, 'unresolvedEntries' => $unresolvedEntries, 'discarded' => $discarded, 'restGuard' => $restGuard,
], JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR) . "\n";

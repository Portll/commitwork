// bin/test/wp-authz-spread.test.mjs — a REST spec's `...$spread` supplies keys; an unreadable one makes them unknown.
// Needs php and nikic/php-parser 5; without them it SKIPS with that reason stated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanTree, parserDir } from '../wp-authz.mjs';

const phpRuns = () => { const r = spawnSync(process.env.CW_PHP_BIN || 'php', ['-r', 'echo 1;'], { encoding: 'utf8' }); return !r.error && r.status === 0; };
const NO_ANALYSER = !phpRuns() ? 'php is not runnable here, so the analyser is unmeasured, not passed'
  : !parserDir() ? 'nikic/php-parser 5 is not installed here, so the analyser is unmeasured, not passed' : false;

const PLUGIN = `<?php
/*
 * Plugin Name: CW Spread
 */
class CwSpreadRoutes {
    public function __construct() { add_action('rest_api_init', [$this, 'routes']); }
    public function routes() {
        $guard = ['permission_callback' => [$this, 'can_manage']];
        $open = ['permission_callback' => '__return_true'];
        register_rest_route('cw-sp/v1', '/held', ['methods' => 'POST', 'callback' => [$this, 'save_held'], ...$guard]);
        register_rest_route('cw-sp/v1', '/inline', ['methods' => 'POST', 'callback' => [$this, 'save_inline'], ...['permission_callback' => [$this, 'can_manage']]]);
        register_rest_route('cw-sp/v1', '/opaque', ['methods' => 'POST', ...$this->guard_args(), 'callback' => [$this, 'save_opaque']]);
        register_rest_route('cw-sp/v1', '/later', ['methods' => 'POST', ...$this->guard_args(), 'callback' => [$this, 'save_later'], 'permission_callback' => '__return_true']);
        register_rest_route('cw-sp/v1', '/override', ['methods' => 'POST', 'callback' => [$this, 'save_override'], ...$open, 'permission_callback' => [$this, 'can_manage']]);
        register_rest_route('cw-sp/v1', '/handler', ['methods' => 'POST', 'callback' => [$this, 'save_shadowed'], 'permission_callback' => '__return_true', ...$this->route_args()]);
    }
    public function guard_args() { return ['permission_callback' => [$this, 'can_manage']]; }
    public function route_args() { return ['callback' => [$this, 'save_held']]; }
    public function can_manage() { return current_user_can('manage_options'); }
    public function save_held($request) { update_option('cw_sp_held', $request->get_param('v')); }
    public function save_inline($request) { update_option('cw_sp_inline', $request->get_param('v')); }
    public function save_opaque($request) { update_option('cw_sp_opaque', $request->get_param('v')); }
    public function save_later($request) { update_option('cw_sp_later', $request->get_param('v')); }
    public function save_override($request) { update_option('cw_sp_override', $request->get_param('v')); }
    public function save_shadowed($request) { update_option('cw_sp_shadowed', $request->get_param('v')); }
}
new CwSpreadRoutes();
`;

test('a spread permission_callback guards its route, and an unreadable spread is undetermined, never unguarded', { skip: NO_ANALYSER }, () => {
  const d = mkdtempSync(join(tmpdir(), 'wp-authz-spread-'));
  try {
    mkdirSync(join(d, 'cw-sp'));
    writeFileSync(join(d, 'cw-sp', 'cw-sp.php'), PLUGIN);
    const r = scanTree(join(d, 'cw-sp'));
    const rows = [...r.findings, ...r.undetermined];
    const about = (h) => rows.filter((x) => x.handler.endsWith(h));
    for (const h of ['save_held', 'save_inline', 'save_override', 'save_shadowed']) assert.deepEqual(about(h), [], `${h}: ${JSON.stringify(about(h))}`);
    const opaque = about('save_opaque');
    assert.deepEqual(opaque.map((x) => [x.rule, x.sev]), [['wp-unproven-guard-write', '']]);
    assert.match(opaque[0].detail, /could not be resolved/);
    assert.deepEqual(about('save_later').map((x) => [x.rule, x.sev]), [['wp-rest-public-write', '']]);
    assert.ok(r.findings.every((f) => f.rule !== 'wp-rest-unguarded-write'), JSON.stringify(r.findings));
    assert.ok((r.summary.unresolvedSample || []).some((u) => u.hook === 'cw-sp/v1/handler' && u.how === 'spread'), JSON.stringify(r.summary));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

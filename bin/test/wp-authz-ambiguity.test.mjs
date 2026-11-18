// bin/test/wp-authz-ambiguity.test.mjs — an ambiguous method name withholds only the writes reached through it.
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
 * Plugin Name: CW Ambiguity
 */
class CwAmbDb {
    public $helper;
    public function update_row($data) {
        global $wpdb;
        $this->exists();
        $wpdb->update($wpdb->prefix . 'cw_amb', $data, array('id' => 1));
    }
    public function exists() { return $this->helper->refresh(); }
}
class CwAmbOptions { public function update($k, $v) { update_option('cw_amb_opt', $v); } }
class CwAmbQueue { public function update($k, $v) { update_option('cw_amb_queue', $v); } }
class CwAmbA { public function refresh($x = null) { update_option('cw_amb_a', $x); } }
class CwAmbB { public function refresh($x = null) { update_option('cw_amb_b', $x); } }
class CwAmbRoutes {
    public $db;
    public function __construct() { $this->db = new CwAmbDb(); add_action('rest_api_init', array($this, 'routes')); }
    public function routes() {
        register_rest_route('cw-amb/v1', '/row', array('methods' => 'POST', 'callback' => array($this, 'save')));
        register_rest_route('cw-amb/v1', '/sync', array('methods' => 'POST', 'callback' => array($this, 'sync')));
    }
    public function save($request) { $this->db->update_row(array('color' => $request->get_param('color'))); }
    public function sync($request) { $this->db->helper->refresh($request->get_param('x')); }
}
new CwAmbRoutes();
`;

test('a certain write keeps its severity beside an ambiguous call, and $wpdb never resolves to a plugin method', { skip: NO_ANALYSER }, () => {
  const d = mkdtempSync(join(tmpdir(), 'wp-authz-ambiguity-'));
  try {
    mkdirSync(join(d, 'cw-amb'));
    writeFileSync(join(d, 'cw-amb', 'cw-amb.php'), PLUGIN);
    const r = scanTree(join(d, 'cw-amb'));
    const row = r.findings.find((f) => f.handler.endsWith('save'));
    assert.ok(row, JSON.stringify(r.undetermined.map((u) => [u.handler, u.detail])));
    assert.deepEqual([row.rule, row.sev], ['wp-rest-unguarded-write', 'med']);
    assert.match(row.detail, /\$wpdb->update/);
    assert.doesNotMatch(row.detail, /update_option|ambiguous/);
    const sync = r.undetermined.find((u) => u.handler.endsWith('sync'));
    assert.ok(sync && !r.findings.some((f) => f.handler.endsWith('sync')));
    assert.equal(sync.rule, 'wp-rest-unguarded-write');
    assert.match(sync.detail, /ambiguous method name/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

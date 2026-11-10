// bin/wp-posture.mjs and its readers — the PHP serialize reader, the streaming dump reader, catalogue
// validation, every verb and the not-measured / not-applicable states, the joined tree and dump, the
// void, determinism and the CLI, over synthetic sites and dumps written here at test time.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTree, evaluate, loadCatalogue, fieldMatches, DEFAULT_CATALOGUE } from '../wp-posture.mjs';
import { unserialize, tryUnserialize, stringList } from '../lib/php-serialize.mjs';
import { parseValues, readDump, prefixOf } from '../lib/wp-dump.mjs';
import { htaccessDeniesPhp, htaccessDeniesRead, parseWpConfig } from '../lib/wp-observables.mjs';
import { scratch, cleanup, write, pluginMain, themeStyle, versionPhp } from './wp-fixture.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO, 'bin', 'wp-posture.mjs');
after(cleanup);

const SILENCE = '<?php\n// Silence is golden.\n';
// assembled at run time so no secret scanner reads a key-shaped literal in this file
const SECRET = ['sk', 'live', '0123456789abcdefABCDEF'].join('_');
const ser = (list) => `a:${list.length}:{${list.map((s, i) => `i:${i};s:${Buffer.byteLength(s)}:"${s}";`).join('')}}`;
const q = (s) => (s === null ? 'NULL' : typeof s === 'number' ? String(s) : `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
const insert = (table, rows) => `INSERT INTO \`${table}\` VALUES ${rows.map((r) => `(${r.map(q).join(',')})`).join(',')};\n`;

function siteTree(extra = {}) {
  return {
    'index.php': '<?php // front controller\n',
    'wp-includes/version.php': versionPhp('6.4.2'),
    'wp-config.php': "<?php\ndefine('DB_PASSWORD', 'not-read');\ndefine('WP_DEBUG', true);\n$table_prefix = 'wp_';\n",
    'wp-config.php.bak': '<?php // copy\n',
    '.htaccess': 'RewriteEngine On\n',
    'wp-content/index.php': SILENCE,
    'wp-content/plugins/index.php': SILENCE,
    'wp-content/plugins/wordfence/wordfence.php': pluginMain('Wordfence Security', '7.1.0'),
    'wp-content/plugins/acme-forms/acme-forms.php': pluginMain('Acme Forms', '2.1.0'),
    'wp-content/themes/twentyx/style.css': themeStyle('Twenty X', '1.0'),
    'wp-content/themes/twentyx/index.php': '<?php // theme\n',
    'wp-content/uploads/2026/01/photo.jpg': 'jpeg',
    'wp-content/uploads/2026/01/list.csv': 'a,b\n',
    'wp-content/debug.log': "PHP Notice: user_pass='hunter22' in x.php\n",
    ...extra,
  };
}

function dumpText({ users = true } = {}) {
  const head = [
    '-- MySQL dump',
    '/*!40101 SET NAMES utf8mb4 */;',
    'CREATE TABLE `wp_options` (`option_id` bigint, `option_name` varchar(191), `option_value` longtext, `autoload` varchar(20));',
    'CREATE TABLE `wp_users` (`ID` bigint);',
    'CREATE TABLE `wp_usermeta` (`umeta_id` bigint);',
    'CREATE TABLE `wp_simple_history` (`id` bigint);',
    '',
  ].join('\n');
  const options = insert('wp_options', [
    [1, 'siteurl', 'http://example.test', 'yes'],
    [2, 'home', 'https://example.test', 'yes'],
    [3, 'users_can_register', '1', 'yes'],
    [4, 'default_role', 'editor', 'yes'],
    [5, 'active_plugins', ser(['acme-forms/acme-forms.php', 'ghost/ghost.php']), 'yes'],
    [6, 'stylesheet', 'twentyx', 'yes'],
    [7, 'template', 'twentyx', 'yes'],
    [8, 'stripe_settings', `a:1:{s:3:"key";s:${SECRET.length}:"${SECRET}";}`, 'no'],
    [9, 'acme_api_key', 'abc;def', 'yes'],
    [10, 'auto_update_core_minor', 'disabled', 'yes'],
    [11, '_transient_x', 'y', 'no'],
  ]);
  if (!users) return head + options;
  const users_ = insert('wp_users', [
    [1, 'admin', '$P$Babcdefghijklmnopqrstuvwxyz0123', 'admin', 'owner@example.test', '', '2020-01-01 00:00:00'],
    [2, 'ops@example.test', '$wp$2y$10$abcdefghijklmnopqrstuv', 'ops', 'ops@example.test', '', '2024-05-01 00:00:00'],
  ]);
  const meta = insert('wp_usermeta', [
    [1, 1, 'wp_capabilities', 'a:1:{s:13:"administrator";b:1;}'],
    [2, 2, 'wp_capabilities', 'a:1:{s:13:"administrator";b:1;}'],
  ]);
  const history = insert('wp_simple_history', [[40, '2026-01-01 00:00:00'], [41, '2026-01-10 00:00:00'], [42, '2026-03-01 00:00:00']]);
  return head + options + users_ + meta + history;
}

function site({ files = {}, dump = dumpText(), gzip = false } = {}) {
  const root = write(scratch(), siteTree(files));
  if (dump === null) return { root, db: null };
  const db = join(scratch('cw-wp-db-'), gzip ? 'site.sql.gz' : 'site.sql');
  writeFileSync(db, gzip ? gzipSync(dump) : dump);
  return { root, db };
}
const rules = (r) => new Set(r.findings.map((f) => f.rule));

describe('php-serialize', () => {
  test('reads arrays, objects, scalars and byte-counted UTF-8 strings', () => {
    assert.deepEqual({ ...unserialize('a:2:{i:0;s:3:"a/b";s:1:"k";b:1;}') }, { 0: 'a/b', k: true });
    assert.equal(unserialize('s:5:"café";'), 'café');
    assert.throws(() => unserialize('s:4:"café";'), /unserialize/);
    assert.equal(unserialize('d:1.5;'), 1.5);
    assert.equal(unserialize('N;'), null);
    const o = unserialize('O:3:"Foo":2:{s:6:"\0Foo\0p";i:1;s:4:"\0*\0q";i:2;}');
    assert.deepEqual({ ...o }, { __class: 'Foo', p: 1, q: 2 });
  });
  test('malformed input throws; try- and list-forms fall back', () => {
    for (const bad of ['a:1:{i:0;s:9:"short";}', 's:3:"abc"', 'x:1;', 'i:1;trailing']) assert.throws(() => unserialize(bad), /unserialize/);
    assert.equal(tryUnserialize('nope', 'fb'), 'fb');
    assert.equal(stringList('nope'), null);
    assert.deepEqual(stringList(ser(['a.php', 'b/b.php'])), ['a.php', 'b/b.php']);
  });
  test('a __proto__ key from the dump stays data', () => {
    const v = unserialize('a:1:{s:9:"__proto__";a:1:{s:5:"admin";b:1;}}');
    assert.equal(Object.getPrototypeOf(v), null);
    assert.equal(v.admin, undefined);
    assert.deepEqual(Object.keys(v), ['__proto__']);
    assert.equal({}.admin, undefined);
  });
});

describe('wp-dump', () => {
  test('parseValues handles escapes, doubled quotes, NULL, numbers and hex', () => {
    const r = parseValues("INSERT INTO t VALUES (1,'a\\'b','c''d',NULL,-2.5,0x6869,'x;y'),(2,'\\n','',3);");
    assert.equal(r.error, undefined);
    assert.deepEqual(r.rows, [[1, "a'b", "c'd", null, -2.5, 'hi', 'x;y'], [2, '\n', '', 3]]);
  });
  test('parseValues reports a truncated statement instead of returning it as complete', () => {
    const r = parseValues("INSERT INTO t VALUES (1,'open");
    assert.match(r.error, /unterminated/);
  });
  test('prefixOf takes the shortest options table with a users table beside it', () => {
    assert.equal(prefixOf(['wp_options', 'wp_users', 'wp_2_options']), 'wp_');
    assert.equal(prefixOf(['x_options']), null);
  });
  test('readDump streams plain and gzip dumps to the same rows, past comments and quoted semicolons', async () => {
    const { db } = site();
    const { db: gz } = site({ gzip: true });
    const a = await readDump(db);
    const b = await readDump(gz);
    assert.equal(a.prefix, 'wp_');
    assert.deepEqual(a.tableNames, ['wp_options', 'wp_simple_history', 'wp_usermeta', 'wp_users']);
    assert.equal(a.rows.options.length, 11);
    assert.equal(a.rows.options.find((r) => r[1] === 'acme_api_key')[2], 'abc;def');
    assert.deepEqual(b.rows, a.rows);
    assert.deepEqual(a.partial, []);
  });
});

describe('server-text readers', () => {
  test('htaccess php and read denial', () => {
    assert.equal(htaccessDeniesPhp('php_flag engine off\n'), true);
    assert.equal(htaccessDeniesPhp('<FilesMatch "\\.php$">\nRequire all denied\n</FilesMatch>\n'), true);
    assert.equal(htaccessDeniesPhp('Options -Indexes\n'), false);
    assert.equal(htaccessDeniesRead('Require all denied\n'), true);
    assert.equal(htaccessDeniesRead('<Files "*.php">\nRequire all denied\n</Files>\n'), false);
  });
  test('wp-config defines keep the shape of a value, never a string value', () => {
    const c = parseWpConfig("define('DB_PASSWORD', 's3cret');\ndefine( 'WP_DEBUG', false );\ndefine('WP_MEMORY_LIMIT', 256);\n$table_prefix = 'abc_';\n");
    assert.deepEqual(c, { defines: { DB_PASSWORD: 'string', WP_DEBUG: false, WP_MEMORY_LIMIT: 256 }, tablePrefix: 'abc_' });
  });
});

describe('catalogue', () => {
  test('the shipped catalogue loads with no invalid entry and names no incident', () => {
    const c = loadCatalogue(DEFAULT_CATALOGUE);
    assert.deepEqual(c.invalid, []);
    assert.ok(c.entries.length >= 40, `${c.entries.length} entries`);
    for (const e of c.entries) assert.deepEqual(Object.keys(e.refs || {}).filter((k) => k !== 'guideline'), [], e.id);
  });
  test('unknown verbs, operators, types, routes and duplicate ids are refused, not defaulted', () => {
    const p = join(scratch('cw-wp-cat-'), 'c.json');
    const base = { sev: 'low', cwe: 'CWE-1', detail: 'd' };
    writeFileSync(p, JSON.stringify({ routes: { r: 'x' }, entries: [
      { id: 'ok-entry', ...base, predicate: { verb: 'exists', type: 'file', where: {} }, enables: ['r'] },
      { id: 'ok-entry', ...base, predicate: { verb: 'exists', type: 'file' } },
      { id: 'bad-verb', ...base, predicate: { verb: 'maybe', type: 'file' } },
      { id: 'bad-type', ...base, predicate: { verb: 'exists', type: 'nope' } },
      { id: 'bad-op', ...base, predicate: { verb: 'exists', type: 'file', where: { bytes: { approx: 1 } } } },
      { id: 'bad-route', ...base, predicate: { verb: 'exists', type: 'file' }, enables: ['nowhere'] },
      { id: 'bad-count', ...base, predicate: { verb: 'count-gt', type: 'file' } },
    ] }));
    const c = loadCatalogue(p);
    assert.deepEqual(c.entries.map((e) => e.id), ['ok-entry']);
    assert.deepEqual(c.invalid.map((i) => i.id), ['ok-entry', 'bad-verb', 'bad-type', 'bad-op', 'bad-route', 'bad-count']);
  });
  test('field conditions', () => {
    assert.equal(fieldMatches(3, { gt: 2, lt: 4 }), true);
    assert.equal(fieldMatches('3', { gt: 2 }), false);
    assert.equal(fieldMatches(['a', 'b'], { contains: 'a' }), true);
    assert.equal(fieldMatches(['a'], { notContains: 'a' }), false);
    assert.equal(fieldMatches('x', ['x', 'y']), true);
    assert.equal(fieldMatches(undefined, { exists: false }), true);
    assert.throws(() => fieldMatches(1, { nope: 1 }), /unknown operator/);
  });
});

describe('evaluate', () => {
  const cat = (entries) => ({ entries: entries.map((e) => ({ sev: 'low', cwe: 'CWE-1', detail: '{count} {path}', ...e })) });
  const corpus = (observables, measured, unmeasured = []) => ({ observables, measured: new Set(measured), unmeasured, installs: [{ path: '.' }] });
  test('each verb fires and passes, a missing precondition is not applicable, an unread type is not measured', () => {
    const rows = [{ type: 'file', path: 'a', bytes: 5 }, { type: 'file', path: 'b', bytes: 0 }];
    const r = evaluate(cat([
      { id: 'ex-fires', predicate: { verb: 'exists', type: 'file', where: { bytes: { gt: 0 } } } },
      { id: 'ex-passes', predicate: { verb: 'exists', type: 'file', where: { bytes: { gt: 9 } } } },
      { id: 'ab-fires', predicate: { verb: 'absent', type: 'file', where: { path: 'z' } } },
      { id: 'cg-fires', predicate: { verb: 'count-gt', type: 'file', than: 1 } },
      { id: 'cl-passes', predicate: { verb: 'count-lt', type: 'file', than: 1 } },
      { id: 'given-na', predicate: { verb: 'exists', type: 'file', given: { type: 'file', where: { path: 'q' } } } },
      { id: 'unmeasured', predicate: { verb: 'absent', type: 'wp-user' } },
    ]), corpus(rows, ['file'], [{ type: 'wp-user', why: 'needs a database dump' }]));
    assert.deepEqual(r.findings.map((f) => `${f.rule}:${f.path}:${f.detail}`), ['ab-fires:.:0 ?', 'cg-fires:.:2 a', 'ex-fires:a:1 a']);
    assert.deepEqual(r.passed.map((p) => p.rule), ['cl-passes', 'ex-passes']);
    assert.deepEqual(r.notApplicable.map((p) => p.rule), ['given-na']);
    assert.deepEqual(r.notMeasured, [{ rule: 'unmeasured', why: 'wp-user: needs a database dump' }]);
  });
});

describe('scanTree', () => {
  test('tree and dump joined: findings carry keys and counts, never a value, hash or address', async () => {
    const s = site();
    const r = await scanTree(s.root, { dbPath: s.db, now: new Date('2026-06-01T00:00:00Z') });
    const got = rules(r);
    for (const id of ['wp-secrets-in-options', 'wp-site-not-https', 'wp-registration-open', 'wp-default-role-privileged', 'wp-default-admin-username',
      'wp-admin-login-is-email', 'wp-admin-legacy-hash', 'wp-phantom-active-plugin', 'wp-security-plugin-inactive', 'wp-no-active-security-plugin',
      'wp-core-auto-update-off', 'wp-config-debug-on', 'wp-config-backup-in-tree', 'wp-config-file-edit-allowed', 'wp-served-log-holds-credentials',
      'wp-debug-log-present', 'wp-data-files-under-served-path', 'wp-uploads-php-not-denied', 'wp-default-table-prefix', 'wp-audit-coverage-gap',
      'wp-directory-listing-not-disabled']) assert.ok(got.has(id), `${id} missing from ${[...got].join(', ')}`);
    assert.ok(!got.has('wp-many-administrators'));
    assert.deepEqual(r.findings.filter((f) => f.rule === 'wp-secrets-in-options').map((f) => f.path).sort(), ['db/options/acme_api_key', 'db/options/stripe_settings']);
    assert.equal(r.findings.find((f) => f.rule === 'wp-phantom-active-plugin').path, 'wp-content/plugins/ghost/ghost.php');
    const text = JSON.stringify(r);
    for (const leak of [SECRET, 'abc;def', '$P$B', 'owner@example.test', 'hunter22', 'not-read']) assert.ok(!text.includes(leak), `report carries ${leak}`);
    assert.equal(r.summary.sources.db.prefix, 'wp_');
    assert.equal(r.summary.partial, undefined, JSON.stringify(r.summary.partialReasons));
  });

  test('without a dump the database entries are not measured, never passed', async () => {
    const s = site({ dump: null });
    const r = await scanTree(s.root, { dbPath: null });
    const nm = new Set(r.summary.notMeasured.map((n) => n.rule));
    for (const id of ['wp-secrets-in-options', 'wp-default-admin-username', 'wp-many-administrators']) {
      assert.ok(nm.has(id), id);
      assert.ok(!r.summary.passed.some((p) => p.rule === id), id);
    }
    assert.ok(r.summary.unmeasured.some((u) => u.type === 'wp-option' && /database dump/.test(u.why)));
    assert.ok(rules(r).has('wp-config-backup-in-tree'));
  });

  test('a dump beside the tree is found and joined', async () => {
    const root = write(scratch(), siteTree());
    writeFileSync(join(root, 'backup.sql'), dumpText({ users: false }));
    const r = await scanTree(root, {});
    assert.equal(r.summary.sources.db.inTree, 'backup.sql');
    assert.ok(rules(r).has('wp-secrets-in-options'));
  });

  test('a tree with no WordPress is a void, not a clean result', async () => {
    const root = write(scratch(), { 'README.md': '# not a site\n' });
    const r = await scanTree(root, { dbPath: null });
    assert.match(r.summary.voidReason, /no WordPress install/);
    assert.equal(r.findings.length, 0);
    assert.equal(r.summary.passed.length, 0);
  });

  test('a PHP deny under uploads clears the uploads entry', async () => {
    const s = site({ files: { 'wp-content/uploads/.htaccess': 'php_flag engine off\n' }, dump: null });
    const r = await scanTree(s.root, { dbPath: null });
    assert.ok(!rules(r).has('wp-uploads-php-not-denied'));
    assert.ok(r.summary.passed.some((p) => p.rule === 'wp-uploads-php-not-denied'));
  });

  test('an audit table of 300,000 rows is read without exhausting the argument stack', async () => {
    const start = Date.UTC(2020, 0, 1);
    const rows = Array.from({ length: 300000 }, (_, i) => [i + 2, new Date(start + i * 60000).toISOString().slice(0, 19).replace('T', ' ')]);
    const s = site({ dump: dumpText({ users: false }) + 'CREATE TABLE `wp_users` (`ID` bigint);\n' + insert('wp_simple_history', rows) });
    const r = await scanTree(s.root, { dbPath: s.db });
    assert.equal(r.summary.partial, undefined, JSON.stringify(r.summary.partialReasons));
    assert.ok(r.summary.observables['audit-source'] >= 1);
  });
});

describe('CLI', () => {
  test('stdout is byte-identical across runs under CW_NOW; a missing or non-directory root exits 2', () => {
    const s = site();
    const env = { ...process.env, CW_NOW: '2026-06-01T00:00:00Z', CW_WP_DB: s.db };
    const a = execFileSync(process.execPath, [CLI, s.root], { encoding: 'utf8', env, timeout: 60000 });
    const b = execFileSync(process.execPath, [CLI, s.root], { encoding: 'utf8', env, timeout: 60000 });
    assert.equal(a, b);
    assert.equal(JSON.parse(a).tool, 'wp-posture');
    assert.equal(spawnSync(process.execPath, [CLI, join(s.root, 'absent')], { timeout: 60000 }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, join(s.root, 'index.php')], { timeout: 60000 }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, s.root, '--bogus'], { timeout: 60000 }).status, 2);
  });
  test('an unreadable catalogue is a failed run, not an empty one', () => {
    const s = site({ dump: null });
    const r = spawnSync(process.execPath, [CLI, s.root, '--no-db', '--catalogue', join(s.root, 'none.json')], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /could not run/);
    assert.ok(readFileSync(DEFAULT_CATALOGUE, 'utf8').length > 0);
  });
});

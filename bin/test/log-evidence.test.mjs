// bin/log-evidence.mjs — every rule in both directions, over logs written here at test time.
// Payloads are the shapes a scanner sends; nothing here is executed or sent anywhere.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { scanTree, lineRules, lineTimestamp, responseStatus, extractionTargets, isLogFile, RULES } from '../log-evidence.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER = join(REPO, 'bin', 'log-evidence.mjs');
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-logev-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}
const at = (r, path, rule) => r.findings.find((f) => f.path === path && f.rule === rule);

const BLIND = "OR IF(ASCII(SUBSTRING((SELECT option_value FROM wp_options WHERE option_name='canary_secret_key' LIMIT 1),1,1))>79,SLEEP(2.0),0)-- -)";

describe('line rules', () => {
  test('each rule fires on its shape', () => {
    const cases = {
      'sqli-blind-extraction': BLIND,
      'sqli-time-based': "GET /?id=1'%20AND%20SLEEP(5)--",
      'sqli-union': 'GET /?s=x%27%29+UNION+SELECT+1%2C2',
      'sqli-schema-probe': 'select table_name from information_schema.tables',
      'path-traversal': 'GET /f?path=../../../../etc/passwd',
      'jndi-lookup': 'User-Agent: ${jndi:ldap://canary.invalid/a}',
      'php-object-injection': 'cookie=O:8:"stdClass":1:{s:1:"a";}',
      'upload-dir-php-request': '"GET /wp-content/uploads/x.php HTTP/1.1" 404 -',
      'command-injection': '"GET /cgi?x=1;id HTTP/1.1" 400 -',
    };
    assert.deepEqual(Object.keys(cases).sort(), Object.keys(RULES).sort(), 'every rule has a case');
    for (const [rule, line] of Object.entries(cases)) assert.ok(lineRules(line).includes(rule), `${rule} missed: ${line}`);
  });

  test('the everyday shapes that share words with an attack do not fire', () => {
    for (const line of [
      'retrying after time.sleep(5)', 'await sleep(5) before reconnect', 'the union of two sets selected',
      'GET /about HTTP/1.1', 'loaded ../config/app.json', 'GET /wp-content/uploads/2026/10/photo.jpg HTTP/1.1',
    ]) assert.deepEqual(lineRules(line), [], line);
  });

  test('timestamps normalise across ISO, Apache and PHP shapes, and none is invented', () => {
    assert.equal(lineTimestamp('2026-01-02 03:04:05 query'), '2026-01-02 03:04:05');
    assert.equal(lineTimestamp('1.2.3.4 - - [02/Jan/2026:03:04:05 +0000] "GET /"'), '2026-01-02 03:04:05');
    assert.equal(lineTimestamp('[08-Oct-2026 01:02:03 UTC] PHP Warning'), '2026-10-08 01:02:03');
    assert.equal(lineTimestamp('no time here'), null);
  });

  test('response status reads three log shapes and nothing else', () => {
    assert.equal(responseStatus('"GET /x HTTP/1.1" 404 512'), 404);
    assert.equal(responseStatus('GET /x -> 403 0ms'), 403);
    assert.equal(responseStatus('method=GET status=200'), 200);
    assert.equal(responseStatus("WHERE option_name='x'"), null);
  });

  test('extraction targets are named only beside an injection, and only when secret-shaped', () => {
    assert.deepEqual(extractionTargets(BLIND), ['canary_secret_key']);
    assert.deepEqual(extractionTargets("SELECT option_value FROM o WHERE option_name='canary_secret_key'"), []);
    assert.deepEqual(extractionTargets("x' UNION SELECT 1 WHERE option_name='siteurl'"), []);
  });

  test('log filenames', () => {
    for (const n of ['debug.log', 'access.log.1', 'error_log', 'access_log.2.gz', '2026-01-02.log']) assert.ok(isLogFile(n), n);
    for (const n of ['log.txt', 'logo.png', 'login.php']) assert.ok(!isLogFile(n), n);
  });
});

describe('the walk', () => {
  test('a multi-line query log carries first/last time, targets and the rule severity', () => {
    const log = ['2026-01-02 03:04:05 [query]', 'SELECT * FROM posts', `WHERE 1=1 AND post_author NOT IN (0) ${BLIND}`,
      '2026-01-02 03:04:36 [query]', `WHERE 1=1 ${BLIND}`, '2026-01-02 03:05:00 ordinary line'].join('\n');
    const r = scanTree(tree({ 'logs/daily/2026-01-02.log': log }));
    const f = at(r, 'logs/daily/2026-01-02.log', 'sqli-blind-extraction');
    assert.equal(f.sev, 'high');
    assert.equal(f.lines, 2);
    assert.equal(f.first, '2026-01-02 03:04:05');
    assert.equal(f.last, '2026-01-02 03:04:36');
    assert.match(f.detail, /targets canary_secret_key/);
    assert.match(f.detail, /whether it succeeded is not determined/);
    assert.ok(at(r, 'logs/daily/2026-01-02.log', 'sqli-time-based'));
  });

  test('every response refused steps the row to low; one answered keeps the rule severity', () => {
    const refused = '1.2.3.4 - - [02/Jan/2026:03:04:05 +0000] "GET /wp-content/uploads/x.php HTTP/1.1" 404 -\n';
    const answered = '1.2.3.4 - - [02/Jan/2026:03:05:05 +0000] "GET /wp-content/uploads/x.php HTTP/1.1" 200 12\n';
    const r = scanTree(tree({ 'a/access.log': refused + refused, 'b/access.log': refused + answered }));
    const a = at(r, 'a/access.log', 'upload-dir-php-request');
    assert.equal(a.sev, 'low');
    assert.match(a.detail, /every recorded response refused it/);
    const b = at(r, 'b/access.log', 'upload-dir-php-request');
    assert.equal(b.sev, 'high');
    assert.equal(b.answered, 1);
  });

  test('gzipped rotated logs are read; an undated log falls back to the filename date, and says so', () => {
    const r = scanTree(tree({ 'logs/access.log.1.gz': gzipSync("GET /?id=1'%20AND%20SLEEP(5)--\n"), 'logs/2026-03-04.log': 'GET /?s=1+UNION+SELECT+2\n' }));
    assert.equal(r.summary.gzipped, 1);
    assert.ok(at(r, 'logs/access.log.1.gz', 'sqli-time-based'));
    assert.match(at(r, 'logs/2026-03-04.log', 'sqli-union').detail, /at 2026-03-04 \(date from the filename\)/);
  });

  test('no log file is a void; skips are named', () => {
    const r = scanTree(tree({ 'src/a.js': 'x', 'node_modules/p/x.log': "1' AND SLEEP(5)" }));
    assert.equal(r.summary.filesScanned, 0);
    assert.match(r.summary.voidReason, /void/);
    assert.ok(r.summary.skippedPaths.includes('node_modules'));
  });

  test('output is deterministic and carries no payload, address or value', () => {
    const root = tree({ 'access.log': '9.9.9.9 - - [02/Jan/2026:03:04:05 +0000] "GET /?q=needle%27+UNION+SELECT+1 HTTP/1.1" 403 -\n' });
    const one = JSON.stringify(scanTree(root));
    assert.equal(JSON.stringify(scanTree(root)), one);
    assert.ok(!one.includes('needle') && !one.includes('9.9.9.9'));
  });

  test('the CLI prints the report and exits 2 on a path that is not a directory', () => {
    const root = tree({ 'x.log': "1' AND SLEEP(5)--\n" });
    const out = JSON.parse(execFileSync(process.execPath, [SCANNER, root], { encoding: 'utf8' }));
    assert.equal(out.tool, 'log-evidence');
    assert.equal(spawnSync(process.execPath, [SCANNER, join(root, 'x.log')]).status, 2);
  });
});

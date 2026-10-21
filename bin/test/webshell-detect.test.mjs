// bin/webshell-detect.mjs — every rule in both directions, over trees built here at test time.
//
// The hostile shapes are assembled in a temp directory and removed afterwards, never committed:
// the published canary carries only the inert subset (fixtures/scan-canary/dirty/wp-content). The
// shell-family names are produced by rot13 at run time for the same reason the scanner stores them
// that way — a source file holding the names beside sink words reads as a shell to antivirus.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import {
  scanTree, contentRules, childLayers, inertPhp, htaccessLock, execHandlers, autoPrepends, dropperState,
  languagesOf, texty, rot13, RULE_CWE, RULE_SEV,
} from '../webshell-detect.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER = join(REPO, 'bin', 'webshell-detect.mjs');
const b64 = (s) => Buffer.from(s, 'latin1').toString('base64');
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-webshell-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}
const rulesAt = (report, path) => report.findings.filter((f) => f.path === path).map((f) => f.rule).sort();
const scan = (files) => scanTree(tree(files));

describe('rule tables', () => {
  test('every rule has a severity and a CWE, and nothing else does', () => {
    assert.deepEqual(Object.keys(RULE_SEV).sort(), Object.keys(RULE_CWE).sort());
    for (const sev of Object.values(RULE_SEV)) assert.ok(['crit', 'high', 'med', 'low'].includes(sev));
    for (const cwe of Object.values(RULE_CWE)) assert.match(cwe, /^CWE-\d+$/);
  });
});

describe('encoded layers', () => {
  test('a whole-file base64 body that decodes to PHP is read as the PHP it decodes to', () => {
    const r = scan({ 'plugins/x.php.b64': b64('<?php\n@error_reporting(0);\n@set_time_limit(0);\necho 1;\n') });
    assert.deepEqual(rulesAt(r, 'plugins/x.php.b64'), ['double-extension', 'encoded-server-payload', 'silenced-unbounded']);
    const enc = r.findings.find((f) => f.rule === 'encoded-server-payload');
    assert.equal(enc.sev, 'high', 'no sink in the layer, so high rather than crit');
    assert.match(enc.detail, /in layer base64/);
  });

  test('the same payload with an execution sink is crit', () => {
    const r = scan({ 'x.txt': b64('<?php eval($canary);\n// padding so the body clears the length floor of the whole-file decoder\n') });
    assert.equal(r.findings.find((f) => f.rule === 'encoded-server-payload').sev, 'crit');
  });

  test('gzinflate(base64_decode(literal)) and str_rot13(literal) are peeled inside PHP', () => {
    const inner = '<?php system($canary); // inert test payload, long enough to clear the floor';
    const gz = deflateRawSync(Buffer.from(inner)).toString('base64');
    const r1 = scan({ 'a.php': `<?php $p = gzinflate(base64_decode('${gz}'));\n` });
    const enc1 = r1.findings.find((f) => f.rule === 'encoded-server-payload');
    assert.ok(enc1, JSON.stringify(r1.findings));
    assert.match(enc1.detail, /base64 → gzinflate/);
    const r2 = scan({ 'b.php': `<?php $p = str_rot13('${rot13(inner)}');\n` });
    assert.match(r2.findings.find((f) => f.rule === 'encoded-server-payload').detail, /str_rot13/);
  });

  test('base64 that decodes to JSON or to binary is decoded and stays quiet', () => {
    const json = b64(JSON.stringify({ note: 'plain data, nothing executable, long enough to be decoded as a whole body', n: [1, 2, 3] }));
    const bin = Buffer.alloc(300); for (let i = 0; i < bin.length; i++) bin[i] = (i * 37) & 0xff;
    const r = scan({ 'data.txt': json, 'blob.txt': bin.toString('base64') });
    assert.deepEqual(r.findings, []);
    assert.ok(r.summary.layersDecoded >= 1, 'the decoder must have run for the silence to mean anything');
  });

  test('childLayers bounds itself and texty rejects binary', () => {
    assert.equal(texty(Buffer.from('plain text\n')), true);
    assert.equal(texty(Buffer.from([0, 1, 2, 3, 4, 5, 250, 251, 252])), false);
    const many = Array.from({ length: 200 }, () => `base64_decode('${b64('<?php eval($x); // padding padding padding')}')`).join(';');
    assert.ok(childLayers(`<?php ${many}`, true, 1 << 20).length <= 64);
  });
});

describe('content rules', () => {
  test('eval over a decoder fires; a decoder alone does not', () => {
    assert.ok(contentRules('<?php eval(base64_decode($x));').has('webshell-eval-decoder'));
    assert.ok(contentRules('<?php @assert(gzinflate($x));').has('webshell-eval-decoder'));
    assert.ok(!contentRules('<?php $img = base64_decode($data);').has('webshell-eval-decoder'));
  });

  test('request input straight into a sink fires in PHP, ASP and JSP', () => {
    const php = new Set(['php']);
    assert.ok(contentRules('<?php system($_GET["c"]);', { langs: php }).has('webshell-request-exec'));
    assert.ok(contentRules('<?php $_POST["f"]($_POST["a"]);', { langs: php }).has('webshell-request-exec'));
    assert.ok(contentRules('<?php echo `$_GET[d]`;', { langs: php }).has('webshell-request-exec'));
    assert.ok(contentRules('<% Execute(Request("c")) %>', { langs: new Set(['asp']) }).has('webshell-request-exec'));
    assert.ok(contentRules('<% Runtime.getRuntime().exec(request.getParameter("c")); %>', { langs: new Set(['jsp']) }).has('webshell-request-exec'));
    assert.deepEqual([...languagesOf('<%@ page import="java.io.*" %>', 'x.txt')], ['jsp']);
  });

  test('the shapes that fired on real plugins do not', () => {
    const php = new Set(['php']);
    assert.ok(!contentRules('/** @param mixed $raw The raw `$_POST[\'_acf_form\']` value. */', { langs: php }).has('webshell-request-exec'));
    assert.ok(!contentRules('$wpdb->prepare( "`$column` = %s", sanitize_text_field( $_GET[\'filter\'][ $column ] ) );', { langs: php }).has('webshell-request-exec'));
    assert.ok(!contentRules('public function executeRequest(Google_Http_Request $request) {}', { langs: php }).has('webshell-request-exec'));
  });

  test('a shell-family marker fires only beside a sink', () => {
    const marker = rot13('SvyrfZna');
    assert.ok(contentRules(`<?php // ${marker}\neval($x);`).has('webshell-banner'));
    assert.ok(!contentRules(`<?php $signatures = ['${marker}'];`).has('webshell-banner'));
  });

  test('silenced-unbounded needs both halves', () => {
    assert.ok(contentRules('<?php @error_reporting(0); @set_time_limit(0);').has('silenced-unbounded'));
    assert.ok(!contentRules('<?php set_time_limit(0);').has('silenced-unbounded'));
  });

  test('decoded-code-writer fires only inside an encoded layer', () => {
    const writer = "<?php file_put_contents($dir . '/x.php', base64_decode($p));";
    assert.ok(!contentRules(writer, { depth: 0 }).has('decoded-code-writer'));
    assert.ok(contentRules(writer, { depth: 1 }).has('decoded-code-writer'));
  });

  test('languagesOf reads extension and opening tags', () => {
    assert.deepEqual([...languagesOf('', 'a.php')], ['php']);
    assert.deepEqual([...languagesOf('<%@ Page Language="C#" %>', 'a.txt')], ['asp']);
    assert.deepEqual([...languagesOf('plain', 'a.txt')], []);
    assert.deepEqual([...languagesOf('const s = "<?php eval($x);";', 'a.test.mjs')], [], 'a JS file quoting PHP is not PHP');
    assert.deepEqual([...languagesOf('<?php eval($x);', 'favicon.txt')], ['php'], 'a polyglot keeps its content reading');
  });
});

describe('placement rules', () => {
  test('server code under an upload directory fires; inert data files and silence indexes do not', () => {
    const r = scan({
      'wp-content/uploads/2026/10/x.php': '<?php return;\n',
      'wp-content/uploads/a/settings.php': '<?php exit(0); ?>\n{"a":1}\n',
      'wp-content/uploads/b/index.php': '<?php\n// Silence is golden.\n',
      'wp-content/uploads/c/rules.php': '<?php __halt_compiler();\n/* data */\n',
      'sites/default/files/y.php': '<?php return;\n',
      'plugins/foo/media/z.php': '<?php return;\n',
    });
    assert.deepEqual(r.findings.filter((f) => f.rule === 'server-code-in-upload-dir').map((f) => f.path).sort(),
      ['sites/default/files/y.php', 'wp-content/uploads/2026/10/x.php']);
    assert.equal(inertPhp('<?php /* c */ die;'), true);
    assert.equal(inertPhp("<?php defined('ABSPATH') || exit; do_things();"), false, 'a conditional guard runs the code after it');
  });

  test('a server-code tag inside media fires; random <?= bytes in a font do not', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('<?php echo 1; ?>')]);
    const font = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('<?='), Buffer.from([0, 0, 7])]);
    const r = scan({ 'img/a.png': png, 'fonts/b.ttf': font });
    assert.deepEqual(r.findings.map((f) => [f.rule, f.path]), [['server-code-in-media-file', 'img/a.png']]);
  });

  test('double extensions step by shape and skip the benign suffixes', () => {
    const r = scan({ 'a.php.b64': 'x', 'b.php.bak': 'x', 'c.php.dist': 'x', 'd.phar.pubkey': 'x', 'e.php.patch': 'x', 'f.php.in': 'x' });
    assert.deepEqual(r.findings.filter((f) => f.rule === 'double-extension').map((f) => [f.path, f.sev]),
      [['a.php.b64', 'high'], ['b.php.bak', 'med']]);
  });

  test('a dropper state file fires and never carries the credential value', () => {
    const secret = 'canary-value-must-not-leak';
    const r = scan({ 'plugins/.state': JSON.stringify({ pass: secret, name: 'wp-x.php', ax: 'k' }), 'plugins/.ok': JSON.stringify({ name: 'wp-x.php' }) });
    assert.deepEqual(r.findings.map((f) => [f.rule, f.path]), [['dropper-state-file', 'plugins/.state']]);
    assert.ok(!JSON.stringify(r).includes(secret));
    assert.equal(dropperState(JSON.stringify({ password: 'abcdefgh' })), null, 'a credential with no server-code filename is not a dropper');
  });

  test('the php lock is one row for every copy, with the read-only count', () => {
    const lock = "<FilesMatch '.(php|PHP|Php|PHp|pHp|pHP|phP|PhP)$'>\nOrder allow,deny\nDeny from all\n</FilesMatch>\n";
    const root = tree({ '.htaccess': lock, 'a/.htaccess': lock, 'a/b/.htaccess': lock, 'c/.htaccess': '<Files *.php>\ndeny from all\n</Files>\n' });
    const posix = process.platform !== 'win32';
    if (posix) { chmodSync(join(root, 'a/.htaccess'), 0o444); chmodSync(join(root, 'a/b/.htaccess'), 0o444); }
    const r = scanTree(root);
    const rows = r.findings.filter((f) => f.rule === 'htaccess-php-lock');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, '.htaccess');
    assert.equal(r.summary.htaccessLocks.files, 3);
    if (posix) assert.equal(r.summary.htaccessLocks.readOnly, 2);
    assert.equal(htaccessLock('<Files *.php>\ndeny from all\n</Files>'), 0);
  });

  test('a PHP handler mapped onto media fires; one mapped onto .php does not', () => {
    assert.deepEqual(execHandlers('AddType application/x-httpd-php .jpg .php'), [['jpg']]);
    assert.deepEqual(execHandlers('AddHandler application/x-httpd-php81 .php'), []);
  });

  test('auto_prepend_file steps to high for odd targets and ignores comments and empty values', () => {
    const r = scan({
      'a/.user.ini': 'auto_prepend_file = /srv/www/wordfence-waf.php\n',
      'b/.user.ini': 'auto_prepend_file=/srv/www/wp-content/uploads/x.ico\n',
      'c/php.ini': '; auto_prepend_file = /x.php\nauto_prepend_file =\nauto_append_file =\n',
      'd/.htaccess': 'php_value auto_prepend_file "/srv/.hidden"\n',
    });
    assert.deepEqual(r.findings.filter((f) => f.rule === 'php-auto-prepend').map((f) => [f.path, f.sev]),
      [['a/.user.ini', 'med'], ['b/.user.ini', 'high'], ['d/.htaccess', 'high']]);
    assert.deepEqual(autoPrepends('auto_prepend_file =\n'), []);
  });
});

describe('the walk', () => {
  test('an empty tree is a void, not a clean result', () => {
    const r = scanTree(tree({}));
    assert.equal(r.summary.filesScanned, 0);
    assert.match(r.summary.voidReason, /void/);
  });

  test('skips are named, vendor/ is NOT skipped, and the env is read at call time', () => {
    const payload = b64('<?php eval($x); // padding so the whole body clears the decoder floor ok');
    const root = tree({ 'node_modules/p/x.txt': payload, 'vendor/p/x.txt': payload, 'keep/x.txt': payload });
    const r = scanTree(root);
    assert.deepEqual(r.findings.map((f) => f.path).sort(), ['keep/x.txt', 'vendor/p/x.txt']);
    assert.ok(r.summary.skippedPaths.includes('node_modules'));
    process.env.CW_WEBSHELL_SKIP_DIRS = 'keep';
    try {
      const r2 = scanTree(root);
      assert.deepEqual(r2.findings.map((f) => f.path).sort(), ['node_modules/p/x.txt', 'vendor/p/x.txt']);
    } finally { delete process.env.CW_WEBSHELL_SKIP_DIRS; }
  });

  test('a file over the cap is windowed, never skipped — a padded dropper is still found', () => {
    process.env.CW_WEBSHELL_MAX_BYTES = '4096';
    try {
      const padded = `${'A'.repeat(20000)}\n<?php @error_reporting(0); @set_time_limit(0); ?>\n`;
      const png = Buffer.concat([Buffer.alloc(9000, 1), Buffer.from('<?php echo 1; ?>'), Buffer.alloc(9000, 2)]);
      const r = scanTree(tree({ 'big.php': padded, 'big.png': png }));
      assert.equal(r.summary.windowed, 2);
      assert.deepEqual(r.findings.map((f) => [f.rule, f.path]).sort(),
        [['server-code-in-media-file', 'big.png'], ['silenced-unbounded', 'big.php']]);
      assert.equal(r.summary.partial, undefined, 'windowed is examined, not partial');
    } finally { delete process.env.CW_WEBSHELL_MAX_BYTES; }
  });

  test('output is deterministic and carries no file content', () => {
    const files = { 'a.php': '<?php system($_GET["needle-in-content"]);', 'z.php.b64': b64('<?php echo "needle-two"; @error_reporting(0); @set_time_limit(0);') };
    const root = tree(files);
    const one = JSON.stringify(scanTree(root));
    assert.equal(JSON.stringify(scanTree(root)), one);
    assert.ok(!one.includes('needle-in-content') && !one.includes('needle-two'));
  });

  test('the CLI prints the report and exits 2 on a path that is not a directory', () => {
    const root = tree({ 'a.php': '<?php eval(base64_decode($x));' });
    const out = JSON.parse(execFileSync(process.execPath, [SCANNER, root], { encoding: 'utf8' }));
    assert.equal(out.tool, 'webshell-detect');
    assert.deepEqual(out.findings.map((f) => f.rule), ['webshell-eval-decoder']);
    const bad = spawnSync(process.execPath, [SCANNER, join(root, 'a.php')], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
  });
});

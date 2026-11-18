// bin/test/wp-authz.test.mjs — the WordPress access-control lane: the pure decision over synthetic
// facts, the planted fixture end to end, the declared exits, and the two readers of its report.
// The fixture run needs php and nikic/php-parser 5; without them it SKIPS with that reason stated.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, sevFor, scanTree, parserDir, RULES, TOOL } from '../wp-authz.mjs';
import { writeFixture, EXPECTED } from './wp-authz-fixture.mjs';
import { parseRuleCounts } from '../lib/report-parsers/sast-lint.mjs';
import { _wpAuthzCounts } from '../../monitor/extractors/sast-lint.mjs';
import { identityFor } from '../../monitor/detail-schema.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'wp-authz.mjs');
const phpRuns = () => { const r = spawnSync(process.env.CW_PHP_BIN || 'php', ['-r', 'echo 1;'], { encoding: 'utf8' }); return !r.error && r.status === 0; };
const NO_ANALYSER = !phpRuns() ? 'php is not runnable here, so the analyser is unmeasured, not passed'
  : !parserDir() ? 'nikic/php-parser 5 is not installed here, so the analyser is unmeasured, not passed' : false;

const tmp = (tag) => mkdtempSync(join(tmpdir(), `wp-authz-${tag}-`));
const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const PLUGIN_HEAD = '<?php\n/*\n * Plugin Name: CW Probe\n */\n';
const entry = (over) => ({ kind: 'ajax', hook: 'wp_ajax_x', handler: 'h', handlerFile: 'p.php', handlerLine: 3, cap: [], nonce: [], muts: [], ...over });
const write = (over) => ({ call: 'update_option', fn: 'h', file: 'p.php', weight: 'high', ...over });

describe('sevFor', () => {
  test('a request-chosen key on a high-weight write is high', () => assert.equal(sevFor([write({ keyFromRequest: true })]), 'high'));
  test('a high-weight write with a fixed key is med', () => assert.equal(sevFor([write()]), 'med'));
  test('only lower-weight writes is low', () => assert.equal(sevFor([write({ weight: 'med' })]), 'low'));
});

describe('classify', () => {
  test('the triggered write and the four no-guard rules publish; the rest stay undetermined', () => {
    const published = Object.entries(RULES).filter(([, r]) => r.publish).map(([k, r]) => [k, r.sev]);
    assert.deepEqual(published, [['wp-nopriv-unguarded-write', undefined], ['wp-ajax-unguarded-write', undefined],
      ['wp-rest-unguarded-write', undefined], ['wp-check-discarded', undefined], ['wp-triggered-write', 'low']]);
  });

  test('an unauthenticated request-driven write is a finding at the write\'s severity, its claim kept', () => {
    const r = classify({ entries: [entry({ kind: 'ajax-nopriv', hook: 'wp_ajax_nopriv_x', muts: [write({ influenced: true })] })] });
    assert.equal(r.undetermined.length, 0);
    assert.deepEqual(r.findings.map((f) => [f.rule, f.sev, f.cwe]), [['wp-nopriv-unguarded-write', 'med', 'CWE-862']]);
    assert.equal(r.findings[0].claim, RULES['wp-nopriv-unguarded-write'].claim);
  });

  test('a request-chosen key on an unguarded high-weight write is high', () => {
    const r = classify({ entries: [entry({ muts: [write({ influenced: true, keyFromRequest: true })] })] });
    assert.deepEqual(r.findings.map((f) => [f.rule, f.sev]), [['wp-ajax-unguarded-write', 'high']]);
  });

  test('an unguarded REST route write is a finding', () => {
    const r = classify({ entries: [entry({ kind: 'rest', hook: 'x/v1/y', rest: { perm: 'none' }, muts: [write({ influenced: true, weight: 'med' })] })] });
    assert.deepEqual(r.findings.map((f) => [f.rule, f.sev]), [['wp-rest-unguarded-write', 'low']]);
  });

  test('a triggered write with no guard is a low finding', () => {
    const r = classify({ entries: [entry({ kind: 'ajax-nopriv', hook: 'wp_ajax_nopriv_x', muts: [write()] })] });
    assert.deepEqual(r.findings.map((f) => [f.rule, f.sev, f.cwe]), [['wp-triggered-write', 'low', 'CWE-862']]);
  });

  test('a write reached only through an ambiguous method name never carries a severity', () => {
    for (const w of [write({ viaAmbiguous: true }), write({ viaAmbiguous: true, influenced: true })]) {
      const r = classify({ entries: [entry({ kind: 'ajax-nopriv', hook: 'wp_ajax_nopriv_x', muts: [w] })] });
      assert.equal(r.findings.length, 0);
      assert.match(r.undetermined[0].detail, /ambiguous method name/);
    }
  });

  test('guarded and write-free entry points are counted by reason, not reported', () => {
    const r = classify({ entries: [
      entry({ handler: 'a', cap: [{ cap: 'manage_options' }], muts: [write({ influenced: true })] }),
      entry({ handler: 'b' }),
      entry({ kind: 'hook', hook: 'load-tools_page_x', handler: 'c', muts: [write({ triggered: true })] }),
      entry({ kind: 'rest', hook: 'x/v1/y', handler: 'd', rest: { perm: 'closed' }, muts: [write({ influenced: true })] }),
    ] });
    assert.equal(r.findings.length + r.undetermined.length, 0);
    assert.deepEqual(r.setAside, { 'capability check on the path': 1, 'no write on the path': 1,
      'load-* hook: core checks the page capability first': 1, 'route closed (__return_false)': 1 });
  });

  test('a handler registered for both ajax hooks is judged once, as the public one', () => {
    const muts = [write({ influenced: true })];
    const r = classify({ entries: [entry({ muts }), entry({ kind: 'ajax-nopriv', hook: 'wp_ajax_nopriv_x', muts })] });
    assert.deepEqual(r.findings.map((u) => u.rule), ['wp-nopriv-unguarded-write']);
    assert.equal(r.setAside['also registered for unauthenticated users; judged there'], 1);
  });

  test('a weak capability is an unproven guard, not a pass', () => {
    const r = classify({ entries: [entry({ cap: [{ cap: 'read', weak: true }], muts: [write({ influenced: true })] })] });
    assert.deepEqual(r.undetermined.map((u) => u.rule), ['wp-unproven-guard-write']);
  });

  test('a discarded capability check is a low CWE-862 finding and a discarded nonce check CWE-352', () => {
    const r = classify({ entries: [], discarded: [
      { file: 'a.php', fn: 'f', call: 'current_user_can', line: 4 },
      { file: 'a.php', fn: 'g', call: 'wp_verify_nonce', line: 9 },
    ] });
    assert.deepEqual(r.findings.map((u) => [u.handler, u.sev, u.cwe]), [['f', 'low', 'CWE-862'], ['g', 'low', 'CWE-352']]);
  });

  test('identity excludes the line: a second registration elsewhere is the same row', () => {
    const muts = [write({ influenced: true })];
    const r = classify({ entries: [entry({ handlerLine: 3, muts }), entry({ handlerLine: 40, muts })] });
    assert.equal(r.findings.length, 1);
  });

  test('output order does not depend on input order', () => {
    const es = [
      entry({ handlerFile: 'b.php', handler: 'z', muts: [write({ influenced: true })] }),
      entry({ handlerFile: 'a.php', handler: 'y', kind: 'ajax-nopriv', hook: 'wp_ajax_nopriv_y', muts: [write()] }),
      entry({ handlerFile: 'a.php', handler: 'x', muts: [write({ influenced: true })] }),
    ];
    assert.deepEqual(classify({ entries: es }), classify({ entries: [...es].reverse() }));
  });
});

describe('scanTree and the CLI without the analyser', () => {
  test('PHP with no WordPress marker is not applicable, with its reason', () => {
    const d = tmp('plain');
    try {
      writeFileSync(join(d, 'index.php'), '<?php echo 1;\n');
      const r = scanTree(d);
      assert.equal(r.summary.applicable, false);
      assert.match(r.summary.notApplicableReason, /no WordPress marker/);
      assert.equal(r.summary.voidReason, undefined);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a tree with no PHP is a void, not a clean result', () => {
    const d = tmp('empty');
    try {
      writeFileSync(join(d, 'readme.txt'), 'x\n');
      const r = scanTree(d);
      assert.equal(r.summary.filesScanned, 0);
      assert.match(r.summary.voidReason, /no PHP files/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a missing root exits 2 and writes no report', () => {
    const r = run([join(tmpdir(), 'wp-authz-does-not-exist-7f3a')]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cannot read/);
  });

  test('a root that is a file exits 2', () => {
    const d = tmp('file');
    try {
      writeFileSync(join(d, 'f.php'), PLUGIN_HEAD);
      const r = run([join(d, 'f.php')]);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /not a directory/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('php that cannot run exits 127 and says the tree is UNSCANNED', () => {
    const d = tmp('nophp');
    try {
      writeFileSync(join(d, 'probe.php'), PLUGIN_HEAD);
      const r = run([d], { CW_PHP_BIN: join(d, 'no-such-php') });
      assert.equal(r.status, 127);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /UNSCANNED/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a parser directory without nikic/php-parser 5 exits 127', { skip: phpRuns() ? false : 'php is not runnable here, so the parser probe is unmeasured' }, () => {
    const d = tmp('noparser');
    try {
      mkdirSync(join(d, 'parser'));
      writeFileSync(join(d, 'probe.php'), PLUGIN_HEAD);
      const r = run([d], { CW_PHP_PARSER_DIR: join(d, 'parser') });
      assert.equal(r.status, 127);
      assert.match(r.stderr, /nikic\/php-parser 5 was not found/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the planted fixture', () => {
  test('every planted defect is found and no guarded twin is', { skip: NO_ANALYSER }, () => {
    const d = tmp('fixture');
    try {
      const root = writeFixture(d);
      const r = scanTree(root);
      const rows = [...r.findings, ...r.undetermined].map((f) => [f.rule, f.handler, f.hook])
        .sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1));
      assert.deepEqual(rows, [...EXPECTED].sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1)));
      assert.deepEqual(r.findings.map((f) => [f.rule, f.sev]).sort(), [['wp-ajax-unguarded-write', 'high'], ['wp-ajax-unguarded-write', 'med'],
        ['wp-check-discarded', 'low'], ['wp-nopriv-unguarded-write', 'med'], ['wp-rest-unguarded-write', 'med'], ['wp-triggered-write', 'low']]);
      assert.equal(r.summary.filesScanned, 2);
      assert.ok(r.summary.setAside.count > 0);
      assert.notEqual(r.summary.partial, true);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('two runs over the same tree print the same bytes', { skip: NO_ANALYSER }, () => {
    const d = tmp('determinism');
    try {
      const root = writeFixture(d);
      const a = run([root]);
      const b = run([root]);
      assert.equal(a.status, 0, a.stderr);
      assert.equal(a.stdout, b.stdout);
      assert.equal(JSON.parse(a.stdout).tool, TOOL);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

const report = (summary, findings = [], undetermined = []) => ({ tool: 'wp-authz', summary: { findings: findings.length, byRule: {}, filesScanned: 2, ...summary }, findings, undetermined });
const row = (over) => ({ rule: 'wp-ajax-unguarded-write', path: 'p.php', handler: 'h', hook: 'wp_ajax_x', entry: 'ajax', line: 7, sev: '', cwe: 'CWE-862', claim: 'c', detail: 'd', ...over });
const withArtifact = (body, fn, exit) => {
  const d = tmp('artifact');
  try {
    writeFileSync(join(d, 'wp-authz.json'), typeof body === 'string' ? body : JSON.stringify(body));
    if (exit != null) writeFileSync(join(d, 'wp-authz.json.exit'), `${exit}\n`);
    return fn(d);
  } finally { rmSync(d, { recursive: true, force: true }); }
};

describe('_wpAuthzCounts', () => {
  test('no artifact is null', () => {
    const d = tmp('none');
    try { assert.equal(_wpAuthzCounts(d, 'wp-authz.json'), null); } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('an empty artifact beside exit 127 is a failed tool; beside exit 0 it is no subject', () => {
    withArtifact('', (d) => assert.equal(_wpAuthzCounts(d, 'wp-authz.json').toolfailed, true), 127);
    withArtifact('', (d) => assert.equal(_wpAuthzCounts(d, 'wp-authz.json').nosrc, true), 0);
  });

  test('a report it cannot read is unparseable, never empty', () => {
    withArtifact('{', (d) => assert.equal(_wpAuthzCounts(d, 'wp-authz.json').unparseable, true));
    withArtifact({ ...report({}), tool: 'other' }, (d) => assert.equal(_wpAuthzCounts(d, 'wp-authz.json').unparseable, true));
  });

  test('not applicable and void are both no subject, each with its own reason', () => {
    withArtifact(report({ filesScanned: 0, applicable: false, notApplicableReason: 'no WordPress marker' }), (d) => {
      const c = _wpAuthzCounts(d, 'wp-authz.json');
      assert.equal(c.nosrc, true);
      assert.equal(c.nosrcReason, 'no WordPress marker');
    });
    withArtifact(report({ filesScanned: 0, voidReason: 'none of 3 PHP file(s) parsed' }), (d) => {
      assert.equal(_wpAuthzCounts(d, 'wp-authz.json').nosrcReason, 'none of 3 PHP file(s) parsed');
    });
  });

  test('undetermined rows are counted apart and move no severity bucket', () => {
    withArtifact(report({}, [row({ rule: 'wp-triggered-write', sev: 'low' })], [row({}), row({ handler: 'k' })]), (d) => {
      const c = _wpAuthzCounts(d, 'wp-authz.json');
      assert.deepEqual([c.crit, c.high, c.med, c.low, c.total, c.undetermined], [0, 0, 0, 1, 1, 2]);
      assert.deepEqual(c.byRule, { 'wp-triggered-write': { count: 1, sev: 'low' }, 'wp-ajax-unguarded-write': { count: 2, sev: '' } });
      assert.equal(c.findings.length, 3);
      assert.deepEqual(Object.keys(c.findings[0]).sort(), ['cwe', 'entry', 'file', 'handler', 'hook', 'line', 'message', 'rule', 'sev']);
    });
  });

  test('a partial read says its counts are a floor', () => {
    withArtifact(report({ partial: true, partialReasons: ['1 PHP file(s) could not be parsed'] }, [], [row({})]), (d) => {
      assert.match(_wpAuthzCounts(d, 'wp-authz.json').partial.note, /could not be parsed.*a floor/);
    });
  });

  test('rows inside an agent worktree are set aside, not counted', () => {
    withArtifact(report({}, [], [row({}), row({ path: '.claude/worktrees/w1/p.php' })]), (d) => {
      const c = _wpAuthzCounts(d, 'wp-authz.json');
      assert.equal(c.undetermined, 1);
      assert.equal(c.worktrees.total, 1);
    });
  });

  test('the row identity is place, never line', () => {
    const id = identityFor('wpAuthz');
    assert.deepEqual(id, ['rule', 'file', 'handler', 'hook']);
    assert.ok(!id.includes('line'));
  });
});

describe('parseRuleCounts over a wp-authz report', () => {
  const parse = (body) => withArtifact(body, (d) => parseRuleCounts(join(d, 'wp-authz.json')));

  test('not applicable is a skip with its reason', () => {
    const r = parse(report({ filesScanned: 0, applicable: false, notApplicableReason: 'no WordPress marker within 3 directories' }));
    assert.deepEqual([r.ok, r.sev, r.summary], [true, 'skip', 'no WordPress marker within 3 directories']);
  });

  test('undetermined rows are named beside a zero and leave sev at ok', () => {
    const r = parse(report({ undetermined: { count: 9 } }, [], Array.from({ length: 9 }, (_, i) => row({ handler: `h${i}` }))));
    assert.equal(r.sev, 'ok');
    assert.equal(r.undetermined, 9);
    assert.match(r.summary, /^0 \(2 files\); 9 undetermined, no severity$/);
  });

  test('a low finding folds to med', () => {
    const r = parse(report({ findings: 1, undetermined: { count: 1 } }, [row({ rule: 'wp-triggered-write', sev: 'low' })], [row({})]));
    assert.equal(r.sev, 'med');
    assert.equal(r.total, 1);
  });

  test('a partial read with no finding is unmeasured even beside undetermined rows', () => {
    const r = parse(report({ partial: true, partialReasons: ['x'], undetermined: { count: 1 } }, [], [row({})]));
    assert.deepEqual([r.ok, r.sev, r.undetermined], [false, 'noscan', 1]);
  });
});

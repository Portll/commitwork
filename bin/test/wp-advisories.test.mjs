// bin/wp-advisories.mjs — PHP version_compare parity, range evaluation, every rule in both
// directions, the unmeasured core, unknown-to-source, the void, offline, determinism and the CLI.
// Sources are a file:// mirror written here; no test opens a network connection.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTree, applies, impactOf, rowFor, RULES } from '../wp-advisories.mjs';
import { versionCompare, canonVersion } from '../lib/wordpress.mjs';
import { scratch, cleanup, write, advisories, stableCheck, withSource, sourceEnv, pluginMain, themeStyle, versionPhp } from './wp-fixture.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER = join(REPO, 'bin', 'wp-advisories.mjs');
after(cleanup);

const below = (v, extra = {}) => ({ min_version: null, min_operator: null, max_version: v, max_operator: 'lt', unfixed: '0', closed: '0', ...extra });
const rec = (id, op, impact = {}, title = `${id} title`) => ({ uuid: id, name: id, operator: op, source: [{ id, name: title }], impact });
const CVSS = (score) => ({ cvss3: { score: String(score) } });

describe('version_compare parity with PHP', () => {
  test('canonicalisation and ordering', () => {
    assert.deepEqual(canonVersion('1.0rc1'), ['1', '0', 'rc', '1']);
    assert.deepEqual(canonVersion('2.1-beta_3+x'), ['2', '1', 'beta', '3', 'x']);
    const lt = [['1.0', '1.0.0'], ['1.0rc1', '1.0'], ['1.0-beta', '1.0-RC1'], ['1.0-dev', '1.0-alpha'], ['5.3.2', '5.3.10'], ['1.0', '1.0pl1'],
      ['6.9', '6.9.1'], ['1.0-foo', '1.0-dev'], ['1.9.9', '1.10']];
    for (const [a, b] of lt) {
      assert.equal(versionCompare(a, b), -1, `${a} < ${b}`);
      assert.equal(versionCompare(b, a), 1, `${b} > ${a}`);
    }
    assert.equal(versionCompare('1.0.0', '1.0.0'), 0);
    assert.equal(versionCompare('1-0', '1.0'), 0);
  });

  test('a record range applies by its operators; an operator PHP does not know is null, never a guess', () => {
    assert.equal(applies({ operator: below('5.3.2') }, '5.3.1'), true);
    assert.equal(applies({ operator: below('5.3.2') }, '5.3.2'), false);
    assert.equal(applies({ operator: { max_version: '5.3.1', max_operator: 'le' } }, '5.3.1'), true);
    assert.equal(applies({ operator: { min_version: '2.0', min_operator: 'ge', max_version: '3.0', max_operator: 'lt' } }, '1.9'), false);
    assert.equal(applies({ operator: { min_version: '2.0', min_operator: 'ge', max_version: '3.0', max_operator: 'lt' } }, '2.5'), true);
    assert.equal(applies({ operator: { min_version: '2.0', min_operator: 'gt' } }, '2.0.1'), true);
    assert.equal(applies({ operator: { max_version: '3', max_operator: 'below' } }, '1'), null);
    assert.equal(applies({ operator: {} }, '1'), false);
  });

  test('impact: the newest CVSS present sets severity; KEV and active exploitation are flagged', () => {
    assert.deepEqual(impactOf([]), { score: null, sev: '', kev: false, exploited: false, cwes: [] });
    assert.equal(impactOf({ cvss3: { score: '9.8' } }).sev, 'crit');
    assert.equal(impactOf({ cvss4: { score: '6.1' }, cvss3: { score: '9.8' } }).sev, 'med');
    assert.equal(impactOf({ cvss: { score: '7.0' } }).sev, 'high');
    assert.equal(impactOf({ cvss3: { score: '3.1' } }).sev, 'low');
    const k = impactOf({ ssvc: { kev: true }, cwe: [{ cwe: 'CWE-89' }, { cwe: 'junk' }] });
    assert.equal(k.kev, true);
    assert.equal(k.exploited, true);
    assert.deepEqual(k.cwes, ['CWE-89']);
    assert.equal(impactOf({ ssvc: { exploitation: 'active' } }).exploited, true);
  });

  test('a row: worst severity, ids CVE-first, a fixed version, and undetermined when nothing is scored', () => {
    const r = rowFor({ rule: 'wp-plugin-vulnerable', path: 'p', slug: 'acme', version: '1.0', records: [
      rec('CVE-2026-0002', below('1.2'), CVSS(5)), rec('ZZ-1', below('1.5'), { ...CVSS(8.1), ssvc: { kev: true } }), rec('CVE-2026-0001', below('1.1')),
    ] });
    assert.equal(r.sev, 'high');
    assert.deepEqual(r.ids, ['CVE-2026-0001', 'CVE-2026-0002', 'ZZ-1']);
    assert.equal(r.fixedIn, '1.5');
    assert.equal(r.kev, true);
    assert.match(r.detail, /3 advisory record\(s\) apply to acme 1\.0/);
    const u = rowFor({ rule: 'wp-plugin-vulnerable', path: 'p', slug: 'acme', version: '1.0', records: [rec('X', { ...below('2'), unfixed: '1' })] });
    assert.equal(u.sev, '');
    assert.equal(u.fixedIn, null);
    assert.match(u.detail, /severity is undetermined.*1 record\(s\) name no fixed version/);
    assert.equal(rowFor({ rule: 'wp-plugin-vulnerable', path: 'p', slug: 'a', version: '1', records: [] }), null);
  });
});

// A site with core 6.0.1, plugin acme-forms 2.1.0, plugin quiet 1.0 (no records), plugin custom-thing
// (unknown to the source) and theme simple 1.0 (vulnerable below 1.1).
function site({ coreVersion = '6.0.1', files = {}, release = { '6.0.1': 'insecure', '6.0.2': 'latest' } } = {}) {
  const root = write(scratch(), {
    'wp-includes/version.php': versionPhp(coreVersion),
    'wp-content/plugins/acme-forms/acme-forms.php': pluginMain('Acme Forms', '2.1.0'),
    'wp-content/plugins/quiet/quiet.php': pluginMain('Quiet', '1.0'),
    'wp-content/plugins/custom-thing/custom-thing.php': pluginMain('Custom', '0.1'),
    'wp-content/themes/simple/style.css': themeStyle('Simple', '1.0'),
    ...files,
  });
  const src = scratch('cw-wp-src-');
  stableCheck(src, release);
  advisories(src, 'core', '6.0.1', { core: '6.0.1', vulnerability: [
    rec('CVE-2026-1000', undefined, { ...CVSS(9.8), ssvc: { kev: true } }), rec('VENDOR-1', undefined, {}, 'Core 6.0 - 6.0.1 - Unauthenticated SQL Injection'),
  ] });
  advisories(src, 'core', '6.0.2', { core: '6.0.2', vulnerability: null });
  advisories(src, 'plugin', 'acme-forms', { name: 'Acme Forms', closed: 0, vulnerability: [rec('CVE-2026-2000', below('2.2.0'), CVSS(7.5)), rec('CVE-2026-2001', below('2.0'), CVSS(9))] });
  advisories(src, 'plugin', 'quiet', { name: 'Quiet', closed: 0, vulnerability: null });
  advisories(src, 'plugin', 'custom-thing', { name: null, vulnerability: null });
  advisories(src, 'theme', 'simple', { name: 'Simple', closed: 0, vulnerability: [rec('CVE-2026-3000', below('1.1'), CVSS(5.4))] });
  return { root, src };
}
const run = ({ root, src }, extra) => withSource(src, () => scanTree(root), extra);
const at = (r, rule, path) => r.findings.find((f) => f.rule === rule && f.path === path);

describe('wp-advisories: the rules', () => {
  test('core, plugin and theme rows; only records whose range includes the version count', async () => {
    const r = await run(site());
    assert.deepEqual(Object.keys(RULES).sort(), ['wp-core-vulnerable', 'wp-plugin-closed', 'wp-plugin-vulnerable', 'wp-theme-closed', 'wp-theme-vulnerable']);
    const core = at(r, 'wp-core-vulnerable', 'wp-includes/version.php');
    assert.equal(core.sev, 'crit');
    assert.equal(core.kev, true);
    assert.match(core.detail, /api\.wordpress\.org lists WordPress 6\.0\.1 as insecure/);
    assert.match(core.detail, /records from different sources overlap/);
    assert.match(core.detail, /Unauthenticated SQL Injection/);
    const plugin = at(r, 'wp-plugin-vulnerable', 'wp-content/plugins/acme-forms/acme-forms.php');
    assert.equal(plugin.advisories, 1, 'the record fixed in 2.0 does not apply to 2.1.0');
    assert.equal(plugin.sev, 'high');
    assert.equal(plugin.fixedIn, '2.2.0');
    assert.equal(at(r, 'wp-theme-vulnerable', 'wp-content/themes/simple/style.css').sev, 'med');
    assert.ok(!r.findings.some((f) => f.component === 'quiet'));
    assert.equal(r.summary.installs[0].core.releaseStatus, 'insecure');
    assert.equal(r.summary.partial, undefined);
  });

  test('the fixed versions produce no rows: a patched site reads clean', async () => {
    const r = await run(site({ coreVersion: '6.0.2', files: {
      'wp-content/plugins/acme-forms/acme-forms.php': pluginMain('Acme Forms', '2.2.0'), 'wp-content/themes/simple/style.css': themeStyle('Simple', '1.1'),
    } }));
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.components.checked, 4);
  });

  test('a release wordpress.org calls insecure is a row even when the advisory source holds no record', async () => {
    const r = await run(site({ coreVersion: '6.0.2', release: { '6.0.1': 'insecure', '6.0.2': 'insecure' } }));
    const core = at(r, 'wp-core-vulnerable', 'wp-includes/version.php');
    assert.equal(core.sev, '');
    assert.equal(core.advisories, 0);
    assert.match(core.detail, /lists WordPress 6\.0\.2 as insecure/);
  });

  test('wp-plugin-closed and wp-theme-closed: a security closure is med, any other low; an open one is no row', async () => {
    const s = site();
    advisories(s.src, 'plugin', 'quiet', { name: 'Quiet', closed: 1, closed_reason: 'Security Issue', closed_date: '2026-01-02', vulnerability: null });
    advisories(s.src, 'theme', 'simple', { name: 'Simple', closed: 1, closed_reason: 'Author Request', vulnerability: null });
    const r = await run(s);
    assert.equal(at(r, 'wp-plugin-closed', 'wp-content/plugins/quiet/quiet.php').sev, 'med');
    assert.equal(at(r, 'wp-theme-closed', 'wp-content/themes/simple/style.css').sev, 'low');
    assert.ok(!r.findings.some((f) => f.rule === 'wp-plugin-closed' && f.component === 'acme-forms'));
  });
});

describe('wp-advisories: what is not measured is said so', () => {
  test('a plugin the source has no record of is listed as unknown, not checked', async () => {
    const r = await run(site());
    assert.deepEqual(r.summary.unknownToSource.map((u) => u.slug), ['custom-thing']);
    assert.ok(!r.summary.checked.some((c) => c.slug === 'custom-thing'));
  });

  test('a wp-content-only tree: the core version is unknown, never guessed, and the run is partial', async () => {
    const s = site();
    const r = await withSource(s.src, () => scanTree(join(s.root, 'wp-content')));
    assert.match(r.summary.notMeasured.find((n) => n.component === 'core').reason, /core version is unknown.*never guessed/);
    assert.equal(r.summary.partial, true);
    assert.ok(!r.findings.some((f) => f.rule === 'wp-core-vulnerable'));
    assert.ok(r.findings.some((f) => f.rule === 'wp-plugin-vulnerable'));
  });

  test('a core version that is not a listed release is unmeasured, not looked up', async () => {
    for (const v of ['6.0.1-src', '6.0.9']) {
      const r = await run(site({ coreVersion: v }));
      assert.ok(r.summary.notMeasured.some((n) => n.component === 'core'), v);
      assert.ok(!r.findings.some((f) => f.rule === 'wp-core-vulnerable'), v);
      assert.equal(r.summary.partial, true, v);
    }
  });

  test('a plugin without a Version header is listed as not matched', async () => {
    const r = await run(site({ files: { 'wp-content/plugins/noversion/noversion.php': '<?php\n/* Plugin Name: No Version */\n' } }));
    assert.match(r.summary.notMeasured.find((n) => n.slug === 'noversion').reason, /no Version header: advisories not matched/);
    assert.equal(r.summary.components.versionUnknown, 1);
  });

  test('no WordPress is a void', async () => {
    const r = await withSource(scratch('cw-wp-src-'), () => scanTree(write(scratch(), { 'a.txt': 'x' })));
    assert.equal(r.summary.filesScanned, 0);
    assert.match(r.summary.voidReason, /no WordPress install/);
  });

  test('offline with no cache is a void that names why, never an empty clean result', async () => {
    const s = site();
    const r = await withSource(s.src, () => scanTree(s.root), { CW_WPVULN_URL: 'https://www.wpvulnerability.net', CW_WP_API_URL: 'https://api.wordpress.org' });
    assert.equal(r.summary.filesScanned, 0);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.partial, true);
    assert.match(r.summary.voidReason, /no component could be looked up.*offline/);
    assert.ok(r.summary.components.unavailable >= 4);
  });
});

describe('wp-advisories: output', () => {
  test('deterministic, sorted, dated from the data, and naming no file contents', async () => {
    const s = site({ files: { 'wp-content/plugins/quiet/notes.php': '<?php // NEEDLE-ADV-5521\n' } });
    const one = JSON.stringify(await run(s));
    assert.equal(JSON.stringify(await run(s)), one);
    assert.ok(!one.includes('NEEDLE-ADV-5521'));
    const r = JSON.parse(one);
    assert.deepEqual(r.summary.advisoryData, { oldest: '2026-01-01', newest: '2026-01-01' });
    const keys = r.findings.map((f) => `${f.path}\u0000${f.rule}`);
    assert.deepEqual(keys, [...keys].sort());
  });

  test('the CLI prints the report and exits 2 on a path that is not a directory', () => {
    const s = site();
    const out = JSON.parse(execFileSync(process.execPath, [SCANNER, s.root], { encoding: 'utf8', env: sourceEnv(s.src), timeout: 60000 }));
    assert.equal(out.tool, 'wp-advisories');
    assert.ok(out.findings.length >= 3);
    assert.equal(spawnSync(process.execPath, [SCANNER, join(s.root, 'wp-includes', 'version.php')], { env: sourceEnv(s.src), timeout: 60000 }).status, 2);
  });
});

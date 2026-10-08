// The mobile manifest lane.
//
// The load-bearing test is "a well-formed application produces ZERO findings". A lane that fires on
// essentially every subject is measuring the platform rather than the application — GuardDog's
// capability-* rules published 602 of 675 rows for "this package can open a socket", and Prowler
// asserted 1,067 FAILs about a field GitHub never returned. Both looked like a fleet in crisis and
// were defects in the detector. Every positive assertion below is paired with a negative control so
// neither direction can pass vacuously.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withUnreadable, ignoresPermissions } from '../../lib/fs-unreadable.mjs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { scan, scanAndroid, scanPlist, toSarif, findManifests } from '../mobile-manifest.mjs';
import { fileURLToPath } from 'node:url';

const rulesOf = (findings) => findings.map((f) => f.rule).sort();

// A realistic, CORRECT manifest: a launcher activity (must be exported), an internal activity, a
// service and a provider that are properly closed. Nothing here is a defect.
const GOOD_ANDROID = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
  <application android:label="Example" android:networkSecurityConfig="@xml/nsc">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
    <activity android:name=".SettingsActivity" android:exported="false" />
    <service android:name=".SyncService" android:exported="false" />
    <provider android:name=".FileProvider" android:exported="false"
              android:grantUriPermissions="true" android:authorities="com.example.app.files" />
  </application>
</manifest>`;

const BAD_ANDROID = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
  <application android:debuggable="true" android:usesCleartextTraffic="true" android:allowBackup="true">
    <activity android:name=".AdminActivity" android:exported="true" />
    <receiver android:name=".WipeReceiver">
      <intent-filter><action android:name="com.example.WIPE" /></intent-filter>
    </receiver>
    <provider android:name=".LeakyProvider" android:exported="true" android:grantUriPermissions="true" />
  </application>
</manifest>`;

describe('the lane does not fire on a correct application', () => {
  test('a well-formed AndroidManifest produces ZERO findings', () => {
    const f = scanAndroid(GOOD_ANDROID, 'AndroidManifest.xml');
    assert.deepEqual(f, [], `a correct manifest produced ${f.length} finding(s): ${rulesOf(f).join(', ')}`
      + ' — a lane that flags a correct app is measuring the platform, not the code');
  });

  test('...and the same file with the defects added DOES fire — the control', () => {
    const f = scanAndroid(BAD_ANDROID, 'AndroidManifest.xml');
    assert.ok(f.length > 0, 'the bad manifest produced nothing, so the zero above proves nothing');
  });
});

describe('the launcher exemption', () => {
  const launcher = (withCategory) => `<manifest xmlns:android="x"><application>
    <activity android:name=".Main" android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN" />
      ${withCategory ? '<category android:name="android.intent.category.LAUNCHER" />' : ''}
      </intent-filter>
    </activity></application></manifest>`;

  test('an exported LAUNCHER activity is exempt — it must be exported to start the app', () => {
    assert.deepEqual(rulesOf(scanAndroid(launcher(true), 'm.xml')), []);
  });

  test('the identical activity WITHOUT the launcher category is flagged', () => {
    assert.deepEqual(rulesOf(scanAndroid(launcher(false), 'm.xml')), ['mobile/exported-no-permission']);
  });
});

describe('android rules', () => {
  test('the bad manifest yields exactly the expected findings', () => {
    // exported-no-permission twice: .AdminActivity AND .LeakyProvider. Asserting the multiset rather
    // than the set — collapsing duplicates would hide a rule that fires once per manifest instead of
    // once per component.
    assert.deepEqual(rulesOf(scanAndroid(BAD_ANDROID, 'm.xml')), [
      'mobile/allow-backup', 'mobile/cleartext-traffic', 'mobile/debuggable',
      'mobile/exported-no-permission', 'mobile/exported-no-permission',
      'mobile/implicitly-exported', 'mobile/provider-grant-uri',
    ]);
  });

  test('each offending component is reported separately, not once per manifest', () => {
    const named = scanAndroid(BAD_ANDROID, 'm.xml')
      .filter((f) => f.rule === 'mobile/exported-no-permission').map((f) => f.message);
    assert.equal(named.length, 2);
    assert.ok(named.some((m) => m.includes('.AdminActivity')), 'AdminActivity not named');
    assert.ok(named.some((m) => m.includes('.LeakyProvider')), 'LeakyProvider not named');
  });

  test('exported WITH a permission is not a finding', () => {
    const xml = `<manifest xmlns:android="x"><application>
      <service android:name=".S" android:exported="true" android:permission="com.example.PRIV" />
      </application></manifest>`;
    assert.deepEqual(rulesOf(scanAndroid(xml, 'm.xml')), []);
  });

  test('ABSENT allowBackup is not a finding — absence is the platform default, not a decision', () => {
    const absent = `<manifest xmlns:android="x"><application android:label="x" /></manifest>`;
    assert.deepEqual(rulesOf(scanAndroid(absent, 'm.xml')), []);
    const explicit = `<manifest xmlns:android="x"><application android:allowBackup="true" /></manifest>`;
    assert.deepEqual(rulesOf(scanAndroid(explicit, 'm.xml')), ['mobile/allow-backup']);
  });

  test('findings carry a real line number', () => {
    const f = scanAndroid(BAD_ANDROID, 'm.xml');
    for (const x of f) assert.ok(x.line >= 1 && x.line <= BAD_ANDROID.split('\n').length, `bad line ${x.line}`);
    assert.ok(new Set(f.map((x) => x.line)).size > 1, 'every finding reports the same line — the tracker is not working');
  });
});

describe('iOS plist rules', () => {
  test('NSAllowsArbitraryLoads true is an error; false is not a finding', () => {
    const on = `<plist><dict><key>NSAppTransportSecurity</key><dict>
      <key>NSAllowsArbitraryLoads</key>
      <true/></dict></dict></plist>`;
    const off = `<plist><dict><key>NSAppTransportSecurity</key><dict>
      <key>NSAllowsArbitraryLoads</key>
      <false/></dict></dict></plist>`;
    assert.deepEqual(rulesOf(scanPlist(on, 'Info.plist')), ['mobile/ats-arbitrary-loads']);
    assert.deepEqual(rulesOf(scanPlist(off, 'Info.plist')), []);
  });

  test('a custom URL scheme is a note, not a defect', () => {
    const p = `<plist><dict><key>CFBundleURLSchemes</key><array><string>myapp</string></array></dict></plist>`;
    const f = scanPlist(p, 'Info.plist');
    assert.deepEqual(rulesOf(f), ['mobile/custom-url-scheme']);
    assert.equal(f[0].level, 'note', 'registering a scheme is normal; reporting it as a defect would fire on every app with a deep link');
  });
});

describe('discovery and failure modes', () => {
  let dir;
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'cw-mob-'));
    mkdirSync(join(dir, 'app/src/main'), { recursive: true });
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(dir, 'app/src/main/AndroidManifest.xml'), BAD_ANDROID);
    writeFileSync(join(dir, 'node_modules/pkg/AndroidManifest.xml'), BAD_ANDROID);
    return dir;
  };

  test('node_modules is not scanned — a dependency\'s manifest is not this app\'s posture', () => {
    const d = setup();
    try {
      // relative(), not `replace(d + '/', '')`: findManifests correctly returns ABSOLUTE paths, and
      // the test's own POSIX-only strip was what failed on Windows — it left the full
      // `C:\...\app\src\main\AndroidManifest.xml` in place and compared it against a relative
      // expectation. The production function was never wrong here; the fixture's arithmetic was.
      const found = findManifests(d).map((m) => relative(d, m.path).split(sep).join('/'));
      assert.deepEqual(found, ['app/src/main/AndroidManifest.xml']);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a repo with no mobile manifest yields no findings AND records manifestsExamined: 0', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-mob-none-'));
    try {
      const res = scan(d);
      assert.deepEqual(res.findings, []);
      assert.equal(res.manifests, 0);
      const sarif = toSarif(res);
      assert.equal(sarif.runs[0].properties.manifestsExamined, 0,
        'not-applicable must be distinguishable from examined-and-clean');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  // chmod 0o000 is a NO-OP for read access on Windows, so this built a readable manifest, the scan
  // parsed it, and the assertion failed as though the lane were broken. lib/fs-unreadable.mjs makes
  // it unreadable for real on both platforms. This is the load-bearing direction for this lane: an
  // unreadable manifest must be a VOID, and the alternative — silently reporting no findings — is
  // the clean-zero-over-nothing this file's own header is about.
  test('an unreadable manifest fails CLOSED — a void, never an absence of findings', (t) => {
    if (ignoresPermissions()) { t.skip('root reads anything'); return; }
    const d = mkdtempSync(join(tmpdir(), 'cw-mob-perm-'));
    const p = join(d, 'AndroidManifest.xml');
    writeFileSync(p, BAD_ANDROID);
    const out = withUnreadable(p, () => scan(d));
    try {
      if (!out.ran) { t.skip(`could not make the manifest unreadable: ${out.why}`); return; }
      assert.deepEqual(rulesOf(out.value.findings), ['mobile/unreadable-manifest']);
      assert.equal(out.value.findings[0].level, 'error');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('with no manifests the CLI writes NO sarif — not-scanned, never a clean zero', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-mob-empty-'));
    try {
      const cli = fileURLToPath(new URL('../mobile-manifest.mjs', import.meta.url));
      const out = execFileSync('node', [cli, d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(out.trim(), '', 'a sarif was written for a repo with no mobile manifest; zero results '
        + 'parses as sev:ok, so this lane would publish a clean scan of nothing');
      // control: with a manifest present it DOES write one
      writeFileSync(join(d, 'AndroidManifest.xml'), BAD_ANDROID);
      const out2 = execFileSync('node', [cli, d], { encoding: 'utf8' });
      assert.match(out2, /"version": "2.1.0"/, 'no sarif even with a manifest present — the check above proves nothing');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('output is deterministic across runs', () => {
    const d = setup();
    try { assert.equal(JSON.stringify(scan(d)), JSON.stringify(scan(d))); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('SARIF contract', () => {
  test('is parseable SARIF 2.1.0 with levels, severities and locations', () => {
    const s = toSarif(scanAndroid(BAD_ANDROID, 'm.xml').length
      ? { manifests: 1, findings: scanAndroid(BAD_ANDROID, 'm.xml') } : { manifests: 0, findings: [] });
    assert.equal(s.version, '2.1.0');
    assert.equal(s.runs[0].tool.driver.name, 'commitwork-mobile-manifest');
    assert.ok(s.runs[0].rules === undefined);
    for (const r of s.runs[0].results) {
      assert.ok(['error', 'warning', 'note'].includes(r.level));
      assert.ok(r.locations[0].physicalLocation.artifactLocation.uri);
      assert.ok(r.locations[0].physicalLocation.region.startLine >= 1);
      assert.ok(r.message.text.length > 20);
    }
    for (const rule of s.runs[0].tool.driver.rules) {
      assert.match(rule.properties['security-severity'], /^\d+(\.\d+)?$/,
        'no security-severity: parseReport derives severity from it, so the finding would grade as unset');
    }
  });
});

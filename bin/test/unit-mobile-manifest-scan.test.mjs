// Mobile manifest findings under a root, sorted by file, rule and line (bin/mobile-manifest.mjs scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../mobile-manifest.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const DEBUGGABLE = 'android:debuggable="true" ships a build any user can attach a debugger to and read process memory from. Top 100 entry 76.';
const ATS = 'NSAppTransportSecurity \u2192 NSAllowsArbitraryLoads is true, disabling App Transport Security so the app accepts plaintext HTTP. Top 100 entry 108.';
const BACKUP = 'android:allowBackup="true" lets application data be extracted over adb on a debuggable-capable device. Top 100 entry 107. '
  + '(Only an EXPLICIT "true" is reported; the absence of this attribute is the platform default, not an author decision.)';
const EXPORTED = '<activity android:name=".A"> is exported with no android:permission, so any other application on the device can invoke it. Top 100 entry 109.';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir, rel, text) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

test('An empty root yields no manifests and no findings', () => {
  withDir((dir) => {
    assert.deepEqual(scan(dir), { manifests: 0, findings: [] });
  });
});

test('A missing root yields no manifests and no findings', () => {
  withDir((dir) => {
    assert.deepEqual(scan(join(dir, 'absent')), { manifests: 0, findings: [] });
  });
});

test('A dangling AndroidManifest.xml symlink is reported as an unreadable manifest at line 1 with its error code', () => {
  withDir((dir) => {
    symlinkSync(join(dir, 'gone.xml'), join(dir, 'AndroidManifest.xml'));
    assert.deepEqual(scan(dir), {
      manifests: 1,
      findings: [{
        rule: 'mobile/unreadable-manifest', level: 'error', file: 'AndroidManifest.xml', line: 1,
        message: 'manifest could not be read (ENOENT) \u2014 this is a coverage void, not a clean result',
      }],
    });
  });
});

test('A debuggable Android manifest is scanned as android and reported under its slash-joined relative path', () => {
  withDir((dir) => {
    put(dir, join('android', 'app', 'AndroidManifest.xml'),
      '<manifest>\n<application android:debuggable="true"/>\n</manifest>\n');
    assert.deepEqual(scan(dir), {
      manifests: 1,
      findings: [{ rule: 'mobile/debuggable', level: 'error', file: 'android/app/AndroidManifest.xml', line: 2, message: DEBUGGABLE }],
    });
  });
});

test('An Info.plist with arbitrary loads true is reported as ios while one with false is not', () => {
  withDir((dir) => {
    const plist = (v) => `<plist>\n<dict>\n<key>NSAllowsArbitraryLoads</key>\n<${v}/>\n</dict>\n</plist>\n`;
    put(dir, join('ios', 'Info.plist'), plist('true'));
    put(dir, join('mac', 'Info.plist'), plist('false'));
    assert.deepEqual(scan(dir), {
      manifests: 2,
      findings: [{ rule: 'mobile/ats-arbitrary-loads', level: 'error', file: 'ios/Info.plist', line: 3, message: ATS }],
    });
  });
});

test('Findings in one file are ordered by rule before line', () => {
  withDir((dir) => {
    put(dir, join('app', 'AndroidManifest.xml'),
      '<activity android:name=".A" android:exported="true"/>\n<application android:allowBackup="true"/>\n');
    assert.deepEqual(scan(dir), {
      manifests: 1,
      findings: [
        { rule: 'mobile/allow-backup', level: 'warning', file: 'app/AndroidManifest.xml', line: 2, message: BACKUP },
        { rule: 'mobile/exported-no-permission', level: 'error', file: 'app/AndroidManifest.xml', line: 1, message: EXPORTED },
      ],
    });
  });
});

test('Findings across files are ordered by file before rule', () => {
  withDir((dir) => {
    put(dir, join('a', 'AndroidManifest.xml'), '<application android:debuggable="true"/>\n');
    put(dir, join('b', 'Info.plist'), '<key>NSAllowsArbitraryLoads</key>\n<true/>\n');
    assert.deepEqual(scan(dir), {
      manifests: 2,
      findings: [
        { rule: 'mobile/debuggable', level: 'error', file: 'a/AndroidManifest.xml', line: 1, message: DEBUGGABLE },
        { rule: 'mobile/ats-arbitrary-loads', level: 'error', file: 'b/Info.plist', line: 1, message: ATS },
      ],
    });
  });
});

test('Manifests inside skipped and dot-prefixed directories are not scanned', () => {
  withDir((dir) => {
    put(dir, join('node_modules', 'AndroidManifest.xml'), '<application android:debuggable="true"/>\n');
    put(dir, join('.cfg', 'Info.plist'), '<key>NSAllowsArbitraryLoads</key>\n<true/>\n');
    put(dir, join('src', 'AndroidManifest.xml'), '<manifest/>\n');
    assert.deepEqual(scan(dir), { manifests: 1, findings: [] });
  });
});

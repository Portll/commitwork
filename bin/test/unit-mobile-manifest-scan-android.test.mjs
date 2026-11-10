// Detects insecure Android manifest attributes and exported components (bin/mobile-manifest.mjs scanAndroid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanAndroid } from '../mobile-manifest.mjs';

test('reports debuggable, cleartext, and backup flags on the application tag', () => {
  const xml = '<manifest><application android:debuggable="true" android:usesCleartextTraffic="true" android:allowBackup="true"></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), [{ rule: "mobile/debuggable", level: "error", file: "AndroidManifest.xml", line: 1, message: "android:debuggable=\"true\" ships a build any user can attach a debugger to and read process memory from. Top 100 entry 76." }, { rule: "mobile/cleartext-traffic", level: "warning", file: "AndroidManifest.xml", line: 1, message: "android:usesCleartextTraffic=\"true\" permits plaintext HTTP for the whole application. Top 100 entry 108." }, { rule: "mobile/allow-backup", level: "warning", file: "AndroidManifest.xml", line: 1, message: "android:allowBackup=\"true\" lets application data be extracted over adb on a debuggable-capable device. Top 100 entry 107. (Only an EXPLICIT \"true\" is reported; the absence of this attribute is the platform default, not an author decision.)" }]);
});

test('reports exported components without permission and implicitly exported components with filters', () => {
  const xml = '<manifest><application><activity android:name=".Main" android:exported="true"></activity><service android:name=".Svc"><intent-filter></intent-filter></service></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), [{ rule: "mobile/exported-no-permission", level: "error", file: "AndroidManifest.xml", line: 1, message: "<activity android:name=\".Main\"> is exported with no android:permission, so any other application on the device can invoke it. Top 100 entry 109." }, { rule: "mobile/implicitly-exported", level: "warning", file: "AndroidManifest.xml", line: 1, message: "<service android:name=\".Svc\"> declares an intent-filter without an explicit android:exported. Older platforms export it implicitly. Top 100 entry 109." }]);
});

test('reports providers that grant URI permissions when exported', () => {
  const xml = '<manifest><application><provider android:name=".Prov" android:exported="true" android:grantUriPermissions="true"></provider></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), [{ rule: "mobile/exported-no-permission", level: "error", file: "AndroidManifest.xml", line: 1, message: "<provider android:name=\".Prov\"> is exported with no android:permission, so any other application on the device can invoke it. Top 100 entry 109." }, { rule: "mobile/provider-grant-uri", level: "warning", file: "AndroidManifest.xml", line: 1, message: "<provider android:name=\".Prov\"> is exported and grants URI permissions, widening what a caller may read. Top 100 entry 109." }]);
});

test('skips launcher activities even if exported without permission', () => {
  const xml = '<manifest><application><activity android:name=".Main" android:exported="true"><intent-filter><category android:name="android.intent.category.LAUNCHER"></category></intent-filter></activity></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), []);
});

test('reports unnamed exported components with the placeholder name', () => {
  const xml = '<manifest><application><activity android:exported="true"></activity></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), [{ rule: "mobile/exported-no-permission", level: "error", file: "AndroidManifest.xml", line: 1, message: "<activity android:name=\"(unnamed)\"> is exported with no android:permission, so any other application on the device can invoke it. Top 100 entry 109." }]);
});

test('reports implicitly exported components without filters', () => {
  const xml = '<manifest><application><receiver android:name=".Rec"></receiver></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), []);
});

test('reports exported components with permission and no implicit export warning', () => {
  const xml = '<manifest><application><activity android:name=".Main" android:exported="true" android:permission="com.example.PERMISSION"></activity></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), []);
});

test('reports non-exported providers with grantUriPermissions', () => {
  const xml = '<manifest><application><provider android:name=".Prov" android:exported="false" android:grantUriPermissions="true"></provider></application></manifest>';
  assert.deepEqual(scanAndroid(xml, 'AndroidManifest.xml'), []);
});

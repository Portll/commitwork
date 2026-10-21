// bin/codeql-swift-build.sh against a fake xcodebuild (CW_XCODEBUILD): which container it builds,
// what a failed listing reports, and which SDK the build is given. The fake records every
// invocation, so each assertion reads what the script actually asked xcodebuild to do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'codeql-swift-build.sh');
const skip = existsSync('/usr/bin/python3') ? false : 'no /usr/bin/python3 — the script parses xcodebuild JSON with it';

const fake = (dir, { listFails = false, platform = 'iphoneos', listing = { project: { schemes: ['App Main', 'Other'] } } } = {}) => {
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'xcodebuild');
  writeFileSync(bin, `#!/bin/bash
printf '%s\\n' "$*" >> "${log}"
case " $* " in
  *" -list "*)
    ${listFails ? `echo "xcodebuild: error: Could not resolve package dependencies:" >&2
    echo "  the package at '/x/ios/App/CapApp-SPM' cannot be accessed (doesn't exist in file system)" >&2
    exit 74 ;;` : `echo '${JSON.stringify(listing)}' ;;`}
  *" -showBuildSettings "*) echo '[{"target":"App","buildSettings":{"PLATFORM_NAME":"${platform}"}}]' ;;
  *) exit 0 ;;
esac
`);
  chmodSync(bin, 0o755);
  return { bin, log, calls: () => readFileSync(log, 'utf8').trim().split('\n') };
};

const tree = (paths) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-swift-build-'));
  for (const p of paths) mkdirSync(join(root, p), { recursive: true });
  return root;
};

const run = (root, xc, { args = [], env = {} } = {}) => spawnSync('/bin/bash', [SCRIPT, ...args, root], {
  encoding: 'utf8', env: { ...process.env, CW_XCODEBUILD: xc.bin, CW_REPORT_DIR: mkdtempSync(join(tmpdir(), 'cw-swift-report-')), ...env },
});
const calls = (xc) => (existsSync(xc.log) ? xc.calls() : []);

test('a package\'s .swiftpm workspace and vendored workspaces are passed over for the app project', { skip }, () => {
  const root = tree(['Tools/.swiftpm/xcode/package.xcworkspace', 'node_modules/sdk/Sdk.xcworkspace', 'App.xcodeproj']);
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')));
  const r = run(root, xc);
  assert.equal(r.status, 0, r.stderr);
  const build = xc.calls().at(-1);
  assert.match(build, /^clean build -project \.\/App\.xcodeproj -scheme App Main /);
});

test('the shallowest workspace wins over a deeper one', { skip }, () => {
  const root = tree(['b/deep/Deep.xcworkspace', 'App.xcworkspace', 'App.xcodeproj']);
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')));
  assert.equal(run(root, xc).status, 0);
  assert.match(xc.calls().at(-1), /-workspace \.\/App\.xcworkspace /);
});

test('a listing that fails exits 5 with xcodebuild\'s reason, not "no scheme", and builds nothing', { skip }, () => {
  const root = tree(['ios/App/App.xcodeproj']);
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')), { listFails: true });
  const r = run(root, xc);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /xcodebuild -list failed for \.\/ios\/App\/App\.xcodeproj: xcodebuild: error: Could not resolve package dependencies: the package at '\/x\/ios\/App\/CapApp-SPM' cannot be accessed/);
  assert.doesNotMatch(r.stderr, /no scheme/);
  assert.ok(xc.calls().every((c) => !c.startsWith('clean build')));
});

for (const [platform, sdk] of [['macosx', 'macosx'], ['iphoneos', 'iphonesimulator'], ['appletvos', 'appletvsimulator'], ['', 'iphonesimulator']]) {
  test(`platform ${platform || '(unread)'} builds with -sdk ${sdk}`, { skip }, () => {
    const root = tree(['App.xcodeproj']);
    const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')), { platform });
    const r = run(root, xc);
    assert.equal(r.status, 0, r.stderr);
    assert.match(xc.calls().at(-1), new RegExp(` -sdk ${sdk} `));
  });
}

test('--plan prints mode, container, scheme and SDK, and builds nothing', { skip }, () => {
  const root = tree(['App.xcodeproj']);
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')), { platform: 'macosx' });
  const r = run(root, xc, { args: ['--plan'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'xcode\n-project\n./App.xcodeproj\nApp Main\nmacosx\n');
  assert.ok(calls(xc).every((c) => !c.startsWith('clean build')), calls(xc).join('\n'));
});

test('every xcodebuild call turns off its nested package sandboxes and plugin and macro approval', { skip }, () => {
  const root = tree(['App.xcodeproj']);
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')));
  assert.equal(run(root, xc).status, 0);
  const flags = ['-IDEPackageSupportDisableManifestSandbox=YES', '-IDEPackageSupportDisablePluginExecutionSandbox=YES', '-skipPackagePluginValidation', '-skipMacroValidation'];
  assert.equal(calls(xc).length, 3, calls(xc).join('\n'));
  for (const c of calls(xc)) for (const f of flags) assert.ok(c.split(' ').includes(f), `${f} missing from: ${c}`);
  assert.ok(calls(xc).at(-1).endsWith(' ENABLE_USER_SCRIPT_SANDBOXING=NO OTHER_SWIFT_FLAGS=$(inherited) -disable-sandbox'),
    `the build leaves script phases or macro expansion in a nested sandbox: ${calls(xc).at(-1)}`);
});

test('a build given CW_SWIFT_PLAN asks xcodebuild for nothing but the build', { skip }, () => {
  const root = tree(['App.xcodeproj']);
  const dir = mkdtempSync(join(tmpdir(), 'cw-xc-'));
  const plan = join(dir, 'plan');
  writeFileSync(plan, 'xcode\n-workspace\n./W.xcworkspace\nApp Main\nmacosx\n');
  const xc = fake(dir);
  const r = run(root, xc, { env: { CW_SWIFT_PLAN: plan } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(xc).map((c) => c.split(' -IDEPackageSupport')[0]), ['clean build -workspace ./W.xcworkspace -scheme App Main']);
  assert.match(calls(xc)[0], / -sdk macosx /);
});

test('a package root with no Xcode container plans spm and never calls xcodebuild', { skip }, () => {
  const root = tree([]);
  writeFileSync(join(root, 'Package.swift'), '// swift-tools-version:5.9\n');
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')));
  const r = run(root, xc, { args: ['--plan'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'spm\n\n\n\n\n');
  assert.deepEqual(calls(xc), []);
});

test('an unreadable plan exits 6 and builds nothing', { skip }, () => {
  const root = tree(['App.xcodeproj']);
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')));
  const r = run(root, xc, { env: { CW_SWIFT_PLAN: join(root, 'absent.plan') } });
  assert.equal(r.status, 6);
  assert.match(r.stderr, /cannot read the build plan/);
  assert.deepEqual(calls(xc), []);
});

test('a project\'s own target scheme is built, not the alphabetically first package scheme', { skip }, () => {
  const root = tree(['App.xcodeproj']);
  const listing = { project: { targets: ['MarkEditMac', 'QuickLookMac'], schemes: ['AppKitControls', 'DiffKit', 'MarkEditMac', 'QuickLookMac'] } };
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')), { listing, platform: 'macosx' });
  const r = run(root, xc, { args: ['--plan'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n')[3], 'MarkEditMac');
});

test('a workspace listing names no targets, so its first scheme is kept', { skip }, () => {
  const root = tree(['App.xcworkspace']);
  const xc = fake(mkdtempSync(join(tmpdir(), 'cw-xc-')), { listing: { workspace: { schemes: ['First', 'App'] } } });
  const r = run(root, xc, { args: ['--plan'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n')[3], 'First');
});

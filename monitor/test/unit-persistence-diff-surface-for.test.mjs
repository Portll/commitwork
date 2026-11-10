// The per-platform persistence locations to watch (monitor/persistence-diff.mjs surfaceFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceFor } from '../persistence-diff.mjs';

const HOME = '/home/user';
const NULL_HOME = { name: 'TypeError', message: 'The "path" argument must be of type string. Received null' };
const editorRoots = (h) => ['.vscode', '.cursor', '.windsurf'].map((d) => ({ dir: `${h}/${d}/extensions`, kind: 'editor-extension', manifest: ['package.json'] }));
const sshFiles = (h) => ['authorized_keys', 'config', 'rc', 'environment'].map((f) => ({ path: `${h}/.ssh/${f}`, kind: 'ssh' }));
const gitFiles = (h) => [{ path: `${h}/.gitconfig`, kind: 'git-config' }, { path: `${h}/.config/git/config`, kind: 'git-config' }];
const crontab = { key: 'crontab', kind: 'cron', cmd: 'crontab', args: ['-l'], emptyExit: /no crontab for/i };
const gitCommand = (h) => ({
  key: 'git-config-global', kind: 'git-config', cmd: 'git', args: ['config', '--global', '--list'],
  env: { HOME: h }, emptyExit: /unable to read config file/i,
});

const darwinSurface = (h) => ({
  roots: [
    { dir: `${h}/Library/LaunchAgents`, kind: 'launchagent-user' },
    { dir: '/Library/LaunchAgents', kind: 'launchagent-system' },
    { dir: '/Library/LaunchDaemons', kind: 'launchdaemon' },
    ...editorRoots(h),
    { dir: '/etc/sudoers.d', kind: 'sudoers' },
    { dir: '/etc/resolver', kind: 'resolver' },
    { dir: '/Library/Extensions', kind: 'kext', manifest: ['Contents/Info.plist', 'Info.plist'] },
    { dir: `${h}/Library/Application Support/com.apple.backgroundtaskmanagementagent`, kind: 'login-item' },
  ],
  files: [
    { path: '/etc/sudoers', kind: 'sudoers' },
    ...sshFiles(h),
    ...gitFiles(h),
    { path: '/etc/hosts', kind: 'hosts' },
    { path: '/etc/pam.d/sudo', kind: 'pam' },
    { path: '/etc/pam.d/sudo_local', kind: 'pam' },
  ],
  profiles: ['.zshrc', '.zprofile', '.zshenv', '.bash_profile', '.bashrc', '.profile'].map((f) => `${h}/${f}`),
  commands: [
    crontab,
    gitCommand(h),
    { key: 'systemextensionsctl', kind: 'system-extension', cmd: 'systemextensionsctl', args: ['list'] },
    { key: 'profiles-list', kind: 'config-profile', cmd: 'profiles', args: ['list'], emptyOut: /^There are no configuration profiles installed/m },
    { key: 'sfltool-dumpbtm', kind: 'login-item', cmd: 'sfltool', args: ['dumpbtm'], timeoutMs: 20000, notPermitted: /root|privilege|not permitted|Operation not permitted/i },
  ],
});

const win32Surface = (h) => ({
  roots: editorRoots(h),
  files: gitFiles(h),
  profiles: [],
  commands: [
    { key: 'run-hklm', kind: 'runkey', cmd: 'reg', args: ['query', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'] },
    { key: 'run-hkcu', kind: 'runkey', cmd: 'reg', args: ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'] },
    { key: 'services', kind: 'service', cmd: 'sc', args: ['query', 'type=', 'service', 'state=', 'all'] },
    gitCommand(h),
  ],
});

const linuxSurface = (h) => ({
  roots: [
    { dir: '/etc/systemd/system', kind: 'systemd-system' },
    { dir: `${h}/.config/systemd/user`, kind: 'systemd-user' },
    { dir: '/etc/cron.d', kind: 'cron-d' },
    ...editorRoots(h),
    { dir: `${h}/.vscode-server/extensions`, kind: 'editor-extension', manifest: ['package.json'] },
    { dir: '/etc/sudoers.d', kind: 'sudoers' },
  ],
  files: [
    { path: '/etc/sudoers', kind: 'sudoers' },
    ...sshFiles(h),
    ...gitFiles(h),
    { path: '/etc/hosts', kind: 'hosts' },
    { path: '/etc/pam.d/sudo', kind: 'pam' },
    { path: '/etc/ld.so.preload', kind: 'ld-preload' },
  ],
  profiles: ['.zshrc', '.zprofile', '.bash_profile', '.bashrc', '.profile'].map((f) => `${h}/${f}`),
  commands: [crontab, gitCommand(h)],
});

const withEnv = (vars, fn) => {
  const saved = Object.keys(vars).map((k) => [k, process.env[k]]);
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('darwin gets the launchd, kext and login-item surface', () => {
  assert.deepEqual(surfaceFor('darwin', HOME), darwinSurface(HOME));
});

test('win32 gets the registry and service surface with no shell profiles', () => {
  assert.deepEqual(surfaceFor('win32', HOME), win32Surface(HOME));
});

test('linux gets the systemd, cron and ld-preload surface', () => {
  assert.deepEqual(surfaceFor('linux', HOME), linuxSurface(HOME));
});

test('any other platform value falls through to the linux surface and matching is case sensitive', () => {
  for (const platform of ['freebsd', 'Darwin', 'WIN32', '', null]) {
    assert.deepEqual(surfaceFor(platform, HOME), linuxSurface(HOME));
  }
});

test('an undefined platform uses the platform of the running process', () => {
  const surfaces = { darwin: darwinSurface, win32: win32Surface };
  const expected = (surfaces[process.platform] ?? linuxSurface)(HOME);
  assert.deepEqual(surfaceFor(undefined, HOME), expected);
});

test('an omitted home uses CW_PERSIST_HOME when it is set', () => {
  const r = withEnv({ CW_PERSIST_HOME: '/fixture/home' }, () => surfaceFor('linux'));
  assert.deepEqual(r, linuxSurface('/fixture/home'));
});

test('an empty CW_PERSIST_HOME falls back to the home directory of the OS', () => {
  const r = withEnv({ CW_PERSIST_HOME: '', HOME: '/fixture/os-home' }, () => surfaceFor('win32'));
  assert.deepEqual(r, win32Surface('/fixture/os-home'));
});

test('a trailing slash is normalised in paths but kept in the git HOME', () => {
  const expected = { ...linuxSurface(HOME), commands: [crontab, gitCommand('/home/user/')] };
  assert.deepEqual(surfaceFor('linux', '/home/user/'), expected);
});

test('an empty home is kept and produces relative paths', () => {
  const r = surfaceFor('win32', '');
  assert.deepEqual(r.roots.map((root) => root.dir), ['.vscode/extensions', '.cursor/extensions', '.windsurf/extensions']);
  assert.deepEqual(r.files, [{ path: '.gitconfig', kind: 'git-config' }, { path: '.config/git/config', kind: 'git-config' }]);
  assert.deepEqual(r.commands[3], gitCommand(''));
});

test('a null home throws on every platform because the paths cannot be joined', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.throws(() => surfaceFor(platform, null), NULL_HOME);
  }
});

// lib/update/run.mjs: source order and fallback, never installing what is not newer, the size and
// sha256 refusal, the installer call, the update log, and the settings it reads.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findManifest, runUpdate, logEvent, installedVersion, updateSettings, logPath, configDir } from '../update/run.mjs';
import { PORTLL_BASE, GITHUB_API } from '../update/sources.mjs';
import { fakeFetch, makeKey, manifestFor, sha256 } from './lib/update-rig.mjs';

const key = makeKey();
const STABLE = `${PORTLL_BASE}/commitwork/stable/latest.json`;
const BETA = `${PORTLL_BASE}/commitwork/beta/latest.json`;
const GH_LATEST = `${GITHUB_API}/repos/Portll/commitwork/releases/latest`;
const GH_ASSET = `${GITHUB_API}/repos/Portll/commitwork/releases/assets/1`;
const ghRelease = (tag) => ({ tag_name: tag, assets: [{ name: 'portll-update.json', url: GH_ASSET }] });

let dir, root, events, installs;
const installable = () => ({ installable: true, dest: '/opt/cw/lib/commitwork', args: ['--prefix', '/opt/cw', '--dest', '/opt/cw/lib/commitwork'], reason: null });
const run = (o) => runUpdate({
  root, tmp: dir, keys: key.keys, log: (e) => events.push(e), target: installable,
  installer: async (a) => { installs.push(a); return { code: 0 }; }, ...o,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-update-run-'));
  root = dir;
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  events = []; installs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('findManifest', () => {
  test('the Worker answers first, and GitHub is not asked', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: { body: manifestFor({ key, version: '1.1.0' }) } });
    // Act
    const r = await findManifest({ fetch, channel: 'stable', sources: ['portll', 'github'], keys: key.keys });
    // Assert
    assert.equal(r.candidate.source, 'portll');
    assert.equal(fetch.calls.length, 1);
  });

  test('falls back to GitHub when the Worker is unreachable', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: new Error('ENOTFOUND'), [GH_LATEST]: { body: ghRelease('v1.1.0') }, [GH_ASSET]: { body: manifestFor({ key, version: '1.1.0' }) } });
    // Act
    const r = await findManifest({ fetch, channel: 'stable', sources: ['portll', 'github'], keys: key.keys });
    // Assert
    assert.equal(r.candidate.source, 'github');
    assert.match(r.tried[0].errors[0], /ENOTFOUND/);
  });

  test('falls back to GitHub when the Worker serves a manifest that does not verify', async () => {
    // Arrange
    const forged = manifestFor({ key: makeKey('forger'), version: '9.0.0' });
    const fetch = fakeFetch({ [STABLE]: { body: forged }, [GH_LATEST]: { body: ghRelease('v1.1.0') }, [GH_ASSET]: { body: manifestFor({ key, version: '1.1.0' }) } });
    // Act
    const r = await findManifest({ fetch, channel: 'stable', sources: ['portll', 'github'], keys: key.keys });
    // Assert
    assert.equal(r.candidate.manifest.version, '1.1.0');
    assert.match(r.tried[0].errors[0], /refused at signature: unknown keyId "forger"/);
  });

  test('beta takes the higher of beta and stable', async () => {
    // Arrange
    const fetch = fakeFetch({ [BETA]: { body: manifestFor({ key, version: '1.1.0-beta.3', channel: 'beta' }) }, [STABLE]: { body: manifestFor({ key, version: '1.1.0' }) } });
    // Act
    const r = await findManifest({ fetch, channel: 'beta', sources: ['portll'], keys: key.keys });
    // Assert
    assert.equal(r.candidate.manifest.version, '1.1.0');
  });

  test('an unknown source is reported and skipped', async () => {
    // Arrange
    const fetch = fakeFetch({});
    // Act
    const r = await findManifest({ fetch, channel: 'stable', sources: ['ftp'], keys: key.keys });
    // Assert
    assert.equal(r.candidate, null);
    assert.match(r.tried[0].errors[0], /unknown source "ftp"/);
  });
});

describe('runUpdate', () => {
  test('a version that is not newer installs nothing and downloads nothing', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: { body: manifestFor({ key, version: '1.0.0' }) } });
    // Act
    const r = await run({ fetch });
    // Assert
    assert.equal(r.outcome, 'current');
    assert.equal(r.code, 0);
    assert.equal(installs.length, 0);
    assert.equal(fetch.calls.length, 1);
    assert.deepEqual(events.map((e) => [e.event, e.outcome, e.source, e.keyId]), [['check', 'current', 'portll', 'rig-key']]);
  });

  test('an older version is not installed either', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: { body: manifestFor({ key, version: '0.9.0' }) } });
    // Act
    const r = await run({ fetch });
    // Assert
    assert.equal(r.outcome, 'current');
    assert.equal(installs.length, 0);
  });

  test('a newer release is downloaded, checked and handed to the installer with the install args', async () => {
    // Arrange
    const bytes = Buffer.from('new tarball');
    const m = manifestFor({ key, version: '1.1.0', bytes });
    const fetch = fakeFetch({ [STABLE]: { body: m }, [m.artifacts[0].url]: { body: bytes } });
    // Act
    const r = await run({ fetch });
    // Assert
    assert.equal(r.outcome, 'installed');
    assert.equal(installs.length, 1);
    assert.equal(installs[0].sha256, sha256(bytes));
    assert.equal(installs[0].tgz, join(installs[0].workDir, 'commitwork-1.1.0.tgz'));
    assert.deepEqual(installs[0].args, ['--prefix', '/opt/cw', '--dest', '/opt/cw/lib/commitwork']);
    assert.deepEqual(events.map((e) => e.outcome), ['installed']);
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('commitwork-update-')), [], 'the download directory is removed');
  });

  test('a sha256 mismatch is refused before the installer runs', async () => {
    // Arrange
    const m = manifestFor({ key, version: '1.1.0', bytes: Buffer.from('signed bytes') });
    const fetch = fakeFetch({ [STABLE]: { body: m }, [m.artifacts[0].url]: { body: Buffer.from('other bytes!') } });
    // Act
    const r = await run({ fetch });
    // Assert
    assert.equal(r.outcome, 'refused');
    assert.equal(r.code, 20);
    assert.match(r.detail, /the signed manifest says 12 bytes/);
    assert.equal(installs.length, 0);
  });

  test('a short download is refused on size', async () => {
    // Arrange
    const m = manifestFor({ key, version: '1.1.0', bytes: Buffer.from('signed bytes') });
    const fetch = fakeFetch({ [STABLE]: { body: m }, [m.artifacts[0].url]: { body: Buffer.from('short') } });
    // Act
    const r = await run({ fetch });
    // Assert
    assert.equal(r.outcome, 'refused');
    assert.equal(installs.length, 0);
  });

  test('--check reports a newer release and downloads nothing', async () => {
    // Arrange
    const m = manifestFor({ key, version: '1.1.0' });
    const fetch = fakeFetch({ [STABLE]: { body: m } });
    const said = [];
    // Act
    const r = await run({ fetch, mode: 'check', say: (s) => said.push(s) });
    // Assert
    assert.equal(r.outcome, 'available');
    assert.equal(r.code, 10);
    assert.equal(fetch.calls.length, 1);
    assert.match(said[0], /1\.1\.0 is available \(installed 1\.0\.0/);
  });

  test('a checkout is reported, never installed over', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: { body: manifestFor({ key, version: '1.1.0' }) } });
    const checkout = () => ({ installable: false, dest: root, args: [], reason: 'a checkout' });
    // Act
    const r = await run({ fetch, target: checkout });
    // Assert
    assert.equal(r.outcome, 'available');
    assert.equal(r.detail, 'a checkout');
    assert.equal(installs.length, 0);
    assert.equal(events[0].detail, 'a checkout');
  });

  test('a declined confirmation installs nothing', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: { body: manifestFor({ key, version: '1.1.0' }) } });
    // Act
    const r = await run({ fetch, confirm: async () => false });
    // Assert
    assert.equal(r.outcome, 'declined');
    assert.equal(installs.length, 0);
  });

  test('no verified manifest from any source exits 21 and says why per source', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: { status: 503 } });
    // Act
    const r = await run({ fetch, sources: ['portll'] });
    // Assert
    assert.equal(r.outcome, 'no-verified-manifest');
    assert.equal(r.code, 21);
    assert.match(r.detail, /portll: .*HTTP 503/);
  });

  test('a manifest with no tarball is refused', async () => {
    // Arrange
    const fetch = fakeFetch({ [STABLE]: { body: manifestFor({ key, version: '1.1.0', name: 'commitwork-1.1.0.zip' }) } });
    // Act
    const r = await run({ fetch });
    // Assert
    assert.equal(r.outcome, 'refused');
    assert.match(r.detail, /no \.tgz/);
  });

  test('a failed download and a failed installer are reported with their codes', async () => {
    // Arrange
    const m = manifestFor({ key, version: '1.1.0', bytes: Buffer.from('b') });
    const noBytes = fakeFetch({ [STABLE]: { body: m } });
    const bytes = fakeFetch({ [STABLE]: { body: m }, [m.artifacts[0].url]: { body: Buffer.from('b') } });
    // Act
    const a = await run({ fetch: noBytes });
    const b = await run({ fetch: bytes, installer: async () => ({ code: 21 }) });
    const c = await run({ fetch: bytes, installer: async () => ({ code: null, error: 'ENOENT sh' }) });
    // Assert
    assert.deepEqual([a.outcome, a.code], ['download-failed', 21]);
    assert.deepEqual([b.outcome, b.code, b.detail], ['install-failed', 22, 'bin/install.sh exited 21']);
    assert.equal(c.detail, 'bin/install.sh could not run: ENOENT sh');
  });
});

describe('the log and the settings', () => {
  test('logEvent appends one JSON line, and a write failure is reported, not thrown', () => {
    // Arrange
    const path = join(dir, 'logs', 'update.log');
    // Act
    const ok = logEvent({ event: 'check', outcome: 'current' }, { path, now: () => 'T' });
    const bad = logEvent({ event: 'x' }, { path: join(root, 'package.json', 'nested') });
    // Assert
    assert.equal(ok, true);
    assert.equal(bad, false);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { at: 'T', event: 'check', outcome: 'current' });
  });

  test('the log and config paths follow CW_UPDATE_LOG and CW_SETTINGS', () => {
    // Arrange
    const saved = { log: process.env.CW_UPDATE_LOG, set: process.env.CW_SETTINGS };
    process.env.CW_SETTINGS = join(dir, 'cfg', 'settings.json');
    delete process.env.CW_UPDATE_LOG;
    // Act
    const a = [configDir(), logPath()];
    process.env.CW_UPDATE_LOG = join(dir, 'x.log');
    const b = logPath();
    // Assert
    assert.deepEqual(a, [join(dir, 'cfg'), join(dir, 'cfg', 'update.log')]);
    assert.equal(b, join(dir, 'x.log'));
    for (const [k, v] of [['CW_UPDATE_LOG', saved.log], ['CW_SETTINGS', saved.set]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('updateSettings reads update.auto, update.channel and update.sources', () => {
    // Arrange
    const asked = [];
    const get = (k) => { asked.push(k); return { value: k }; };
    // Act
    const s = updateSettings({ get });
    // Assert
    assert.deepEqual(asked, ['update.auto', 'update.channel', 'update.sources']);
    assert.deepEqual(s, { auto: 'update.auto', channel: 'update.channel', sources: 'update.sources' });
  });

  test('the defaults come from the settings registry', () => {
    // Arrange
    const saved = process.env.CW_SETTINGS;
    process.env.CW_SETTINGS = join(dir, 'absent.json');
    // Act
    const s = updateSettings();
    // Assert
    assert.deepEqual(s, { auto: 'install', channel: 'stable', sources: ['portll', 'github'] });
    if (saved === undefined) delete process.env.CW_SETTINGS; else process.env.CW_SETTINGS = saved;
  });

  test('installedVersion reads package.json', () => {
    // Arrange
    const r = root;
    // Act
    const v = installedVersion(r);
    // Assert
    assert.equal(v, '1.0.0');
  });
});

test('runUpdate defaults: confirm and say are optional', async () => {
  // Arrange
  const bytes = Buffer.from('z');
  const m = manifestFor({ key, version: '1.1.0', bytes });
  const fetch = fakeFetch({ [STABLE]: { body: m }, [m.artifacts[0].url]: { body: bytes } });
  // Act
  const r = await runUpdate({ root, tmp: dir, keys: key.keys, fetch, log: () => {}, target: installable, installer: async () => ({ code: 0 }) });
  // Assert
  assert.equal(r.outcome, 'installed');
});

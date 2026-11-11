// lib/update/run.mjs — one update check, and with consent one install, shared by `commitwork
// update` and the panel's daily check (lib/update/scheduler.mjs).
//
// Order (contract section 3): each source in `update.sources` is read until one yields a manifest
// that passes schema, product and signature; the highest such version is taken (a beta install
// also reads stable). It is installed only when newer than package.json's version, after its size
// and sha256 match, by bin/install.sh --from <tgz> --sha256 <hex>, which checks the hash again.
// Every check and install is appended to <config dir>/update.log, one JSON line each, naming the
// source, version, keyId and outcome.
//
// Settings (monitor/settings.mjs): update.auto (install | notify | off), update.channel
// (stable | beta), update.sources (portll, github). Read by the callers and passed in here.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkManifest, compareSemver, pickArtifact } from './contract.mjs';
import { TRUSTED_KEYS } from './keys.mjs';
import { downloadArtifact, fromGithub, fromPortll } from './sources.mjs';
import { installTarget, runInstaller } from './install.mjs';
import { getSetting, settingsPath } from '../../monitor/settings.mjs';

export const PRODUCT = 'commitwork';
export const GITHUB_REPO = 'Portll/commitwork';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const configDir = () => dirname(settingsPath());
export const logPath = () => process.env.CW_UPDATE_LOG || join(configDir(), 'update.log');

/** update.auto, update.channel and update.sources, each env > store > default. */
export function updateSettings({ get = getSetting } = {}) {
  return { auto: get('update.auto').value, channel: get('update.channel').value, sources: get('update.sources').value };
}

/** Append one JSON line; a log that cannot be written never stops an update. */
export function logEvent(entry, { path = logPath(), now = () => new Date().toISOString() } = {}) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ at: now(), ...entry })}\n`, { mode: 0o600 });
    return true;
  } catch { return false; }
}

export const installedVersion = (root = ROOT, readFile = readFileSync) => JSON.parse(readFile(join(root, 'package.json'), 'utf8')).version;

const SOURCE_FNS = { portll: fromPortll, github: fromGithub };

/**
 * The best verified manifest from the first source that has one.
 * @returns {{candidate, check, tried: {source, errors}[]}}
 */
export async function findManifest({ fetch, channel, sources, keys = TRUSTED_KEYS, token = null, product = PRODUCT, repo = GITHUB_REPO }) {
  const tried = [];
  for (const source of sources) {
    const fn = SOURCE_FNS[source];
    if (!fn) { tried.push({ source, errors: [`unknown source ${JSON.stringify(source)}`] }); continue; }
    const { candidates, errors } = await fn({ fetch, product, channel, repo, token });
    const errs = [...errors];
    let best = null;
    for (const c of candidates) {
      const check = checkManifest(c.manifest, { product, keys });
      if (!check.ok) { errs.push(`${c.url}: refused at ${check.step}: ${check.reason}`); continue; }
      if (!best || compareSemver(c.manifest.version, best.candidate.manifest.version) > 0) best = { candidate: c, check };
    }
    tried.push({ source, errors: errs });
    if (best) return { ...best, tried };
  }
  return { candidate: null, check: null, tried };
}

/**
 * One run. `mode` is check (report only) or install. `confirm(version)` resolves true to install.
 * @returns {Promise<{outcome: string, code: number, installed: string, version?: string, source?: string, keyId?: string, detail?: string}>}
 */
export async function runUpdate({
  mode = 'install', channel = 'stable', sources = ['portll', 'github'], fetch = globalThis.fetch,
  keys = TRUSTED_KEYS, token = null, root = ROOT, confirm = async () => true, say = () => {},
  log = logEvent, installer = runInstaller, installerStdio = 'inherit', target = installTarget, tmp = tmpdir(),
} = {}) {
  const installed = installedVersion(root);
  const found = await findManifest({ fetch, channel, sources, keys, token });
  if (!found.candidate) {
    const detail = found.tried.map((t) => `${t.source}: ${t.errors.join('; ') || 'nothing'}`).join(' | ');
    log({ event: 'check', channel, installed, outcome: 'no-verified-manifest', detail });
    return { outcome: 'no-verified-manifest', code: 21, installed, detail };
  }
  const { candidate } = found;
  const m = candidate.manifest;
  const base = { installed, version: m.version, source: candidate.source, keyId: found.check.keyId };
  const newer = checkManifest(m, { product: PRODUCT, keys, installed });
  if (!newer.ok) {
    log({ event: 'check', channel, ...base, outcome: 'current' });
    say(`commitwork ${installed} is current (${channel}: ${m.version} from ${candidate.source}, signed ${base.keyId})`);
    return { outcome: 'current', code: 0, ...base };
  }
  const artifact = pickArtifact(m, { suffix: '.tgz' });
  if (!artifact) {
    log({ event: 'check', channel, ...base, outcome: 'refused', detail: 'no .tgz artifact' });
    return { outcome: 'refused', code: 20, ...base, detail: 'the manifest lists no .tgz artifact' };
  }
  const where = target(root);
  if (mode === 'check' || !where.installable) {
    const detail = where.installable ? null : where.reason;
    log({ event: 'check', channel, ...base, outcome: 'available', ...(detail ? { detail } : {}) });
    say(`commitwork ${m.version} is available (installed ${installed}; ${channel} from ${candidate.source}, signed ${base.keyId})`);
    if (detail) say(detail);
    return { outcome: 'available', code: 10, ...base, ...(detail ? { detail } : {}) };
  }
  if (!(await confirm(m.version))) {
    log({ event: 'check', channel, ...base, outcome: 'declined' });
    return { outcome: 'declined', code: 10, ...base };
  }
  const work = mkdtempSync(join(tmp, 'commitwork-update-'));
  try {
    const dl = await downloadArtifact({ fetch, artifact, candidate, token });
    if (!dl.bytes) {
      const detail = dl.errors.join('; ');
      log({ event: 'install', channel, ...base, outcome: 'download-failed', detail });
      return { outcome: 'download-failed', code: 21, ...base, detail };
    }
    const sha = createHash('sha256').update(dl.bytes).digest('hex');
    if (dl.bytes.length !== artifact.size || sha !== artifact.sha256) {
      const detail = `${artifact.name} is ${dl.bytes.length} bytes with sha256 ${sha}; the signed manifest says ${artifact.size} bytes, ${artifact.sha256}`;
      log({ event: 'install', channel, ...base, outcome: 'refused', detail });
      return { outcome: 'refused', code: 20, ...base, detail };
    }
    const tgz = join(work, artifact.name);
    writeFileSync(tgz, dl.bytes, { mode: 0o600 });
    say(`installing commitwork ${m.version} (${artifact.name}, sha256 ${sha}, from ${dl.from}) into ${where.dest}`);
    const r = await installer({ root, tgz, sha256: sha, args: where.args, workDir: work, stdio: installerStdio });
    if (r.code !== 0) {
      const detail = `bin/install.sh ${r.error ? `could not run: ${r.error}` : `exited ${r.code}`}`;
      log({ event: 'install', channel, ...base, outcome: 'install-failed', detail });
      return { outcome: 'install-failed', code: 22, ...base, detail };
    }
    log({ event: 'install', channel, ...base, outcome: 'installed', dest: where.dest });
    return { outcome: 'installed', code: 0, ...base, dest: where.dest };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

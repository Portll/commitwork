// lib/update/token.mjs — the optional GitHub token `commitwork update` sends to api.github.com.
// commitwork is public, so none is needed; one lifts the anonymous rate limit (60 requests an hour).
//
// Read in this order, first found wins:
//   1 GITHUB_TOKEN · 2 `gh auth token`, when gh is installed · 3 the stored token: the macOS
//   Keychain item PORTLL_UPDATE_TOKEN, or elsewhere a 0600 file `update-token` in commitwork's
//   config directory (the directory of settings.json, ~/.commitwork by default)
// Stored by `commitwork update --login` (GitHub device flow) or `--token-stdin`. The token never
// enters argv: the Keychain is written through `security -i` on stdin.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const KEYCHAIN_ITEM = 'PORTLL_UPDATE_TOKEN';
export const TOKEN_FILE = 'update-token';
export const DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// GitHub token shapes (ghp_, gho_, github_pat_ ...) and update tokens. Anything else is refused,
// so nothing that could end a `security -i` command line is written through it.
const TOKEN_RE = /^[A-Za-z0-9_.-]{20,255}$/;

export const validToken = (t) => typeof t === 'string' && TOKEN_RE.test(t);

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'ignore'], ...opts });

/** { token, source } — source is env, gh, keychain or file; token null when none is found. */
export function resolveToken({ env = process.env, exec = defaultExec, platform = process.platform, configDir, readFile = readFileSync, stat = statSync } = {}) {
  const t = (env.GITHUB_TOKEN || '').trim();
  if (t) return { token: t, source: 'env' };
  try {
    const gh = String(exec('gh', ['auth', 'token'])).trim();
    if (gh) return { token: gh, source: 'gh' };
  } catch { /* gh absent or signed out: the next source */ }
  if (platform === 'darwin') {
    try {
      const k = String(exec('security', ['find-generic-password', '-s', KEYCHAIN_ITEM, '-w'])).trim();
      if (k) return { token: k, source: 'keychain' };
    } catch { /* no Keychain item */ }
    return { token: null, source: null };
  }
  if (!configDir) return { token: null, source: null };
  const file = join(configDir, TOKEN_FILE);
  try {
    // A file others can read is not used: the token in it is no longer only this user's.
    if ((stat(file).mode & 0o077) !== 0) return { token: null, source: null, warning: `${file} is readable by other users; not used (chmod 600 it)` };
    const f = String(readFile(file, 'utf8')).trim();
    if (f) return { token: f, source: 'file' };
  } catch { /* no stored token */ }
  return { token: null, source: null };
}

/** Store a token: the Keychain on macOS, else the 0600 file. Returns where it went. */
export function storeToken(token, { exec = defaultExec, platform = process.platform, configDir } = {}) {
  if (!validToken(token)) throw new Error('that is not a GitHub or update token (20-255 letters, digits, _ . -)');
  if (platform === 'darwin') {
    exec('security', ['-i'], { input: `add-generic-password -U -s ${KEYCHAIN_ITEM} -a ${KEYCHAIN_ITEM} -w ${token}\n` });
    return { where: 'keychain', item: KEYCHAIN_ITEM };
  }
  if (!configDir) throw new Error('no config directory to store the token in');
  const file = join(configDir, TOKEN_FILE);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return { where: 'file', file };
}

/** Remove the stored token. Returns what was removed, or null when nothing was stored. */
export function deleteToken({ exec = defaultExec, platform = process.platform, configDir } = {}) {
  if (platform === 'darwin') {
    try { exec('security', ['delete-generic-password', '-s', KEYCHAIN_ITEM]); return { where: 'keychain' }; }
    catch { return null; }
  }
  const file = join(configDir, TOKEN_FILE);
  try { statSync(file); } catch { return null; }
  rmSync(file, { force: true });
  return { where: 'file', file };
}

const form = (o) => new URLSearchParams(o).toString();
const post = async (fetch, url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'commitwork-update' }, body: form(body) });
  let j;
  try { j = await res.json(); } catch { throw new Error(`${url}: HTTP ${res.status}, not JSON`); }
  if (!res.ok && !j?.error) throw new Error(`${url}: HTTP ${res.status}`);
  return j;
};

/** Step 1 of the device flow: { deviceCode, userCode, verificationUri, interval, expiresIn }. */
export async function requestDeviceCode({ fetch, clientId, scope = '' }) {
  if (!clientId) throw new Error('PORTLL_GITHUB_CLIENT_ID is not set; it names the GitHub OAuth App that signs you in (contract section 9 step 5). Use --token-stdin instead');
  const j = await post(fetch, DEVICE_CODE_URL, { client_id: clientId, scope });
  if (j.error) throw new Error(`GitHub refused the sign-in request: ${j.error_description || j.error}`);
  if (!j.device_code || !j.user_code || !j.verification_uri) throw new Error('GitHub answered the sign-in request without a device code');
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, interval: Number(j.interval) || 5, expiresIn: Number(j.expires_in) || 900 };
}

/** Step 2: poll until GitHub issues the token, the code expires or the user declines. */
export async function pollDeviceToken({ fetch, clientId, deviceCode, interval = 5, expiresIn = 900, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  const deadline = now() + expiresIn * 1000;
  let wait = interval;
  while (now() < deadline) {
    await sleep(wait * 1000);
    const j = await post(fetch, ACCESS_TOKEN_URL, { client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT });
    if (j.access_token) return j.access_token;
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { wait = Number(j.interval) || wait + 5; continue; }
    if (j.error === 'expired_token') throw new Error('the sign-in code expired; run commitwork update --login again');
    if (j.error === 'access_denied') throw new Error('the sign-in was declined');
    throw new Error(`GitHub refused the sign-in: ${j.error_description || j.error || 'no token and no error'}`);
  }
  throw new Error('the sign-in code expired; run commitwork update --login again');
}

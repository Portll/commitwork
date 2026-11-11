#!/usr/bin/env node
// commitwork update — check for, verify and install a newer commitwork (portll-update@1).
//
// usage: commitwork update [--check] [--channel stable|beta] [--source portll|github] [--yes]
//        commitwork update --login | --token-stdin | --logout
//   --check        report only; never downloads the release or installs
//   --channel      this run's channel; default the update.channel setting (stable)
//   --source       read only this source; default the update.sources setting (portll, then github)
//   --yes          install without asking; without it, a terminal is asked and anything else
//                  only reports
//   --login        sign in to GitHub with the device flow (needs PORTLL_GITHUB_CLIENT_ID) and store
//                  the token; it only lifts GitHub's anonymous rate limit, commitwork is public
//   --token-stdin  store a token read from stdin (a GitHub token or an update token)
//   --logout       remove the stored token
// exit: 0 current, installed, or a token stored or removed · 2 usage · 10 a newer release is
//       available and was not installed · 20 refused: a manifest or artifact failed verification ·
//       21 no source answered with a verified manifest, or the download failed ·
//       22 bin/install.sh failed (it undoes itself; the installed tree is as it was) · 23 sign-in failed
// env, read at call time: GITHUB_TOKEN, PORTLL_GITHUB_CLIENT_ID, CW_UPDATE_CHANNEL,
//       CW_UPDATE_SOURCES, CW_UPDATE_LOG, CW_SETTINGS
// output: progress on stderr; one JSON line per check and install in <config dir>/update.log

import { createInterface } from 'node:readline';
import { isMainModule } from '../lib/is-main.mjs';
import { runUpdate, updateSettings, configDir } from '../lib/update/run.mjs';
import { deleteToken, pollDeviceToken, requestDeviceCode, resolveToken, storeToken } from '../lib/update/token.mjs';
import { CHANNELS } from '../lib/update/contract.mjs';
import { SOURCES } from '../lib/update/sources.mjs';

export const EXIT = { OK: 0, USAGE: 2, AVAILABLE: 10, REFUSED: 20, UNREACHABLE: 21, INSTALL_FAILED: 22, LOGIN_FAILED: 23 };

/** { opts } or { error }. */
export function parseUpdateArgs(argv) {
  const opts = { check: false, yes: false, login: false, tokenStdin: false, logout: false, channel: null, source: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (name) => {
      if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
      const v = argv[++i];
      return v === undefined ? null : v;
    };
    if (a === '--check') opts.check = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--login') opts.login = true;
    else if (a === '--token-stdin') opts.tokenStdin = true;
    else if (a === '--logout') opts.logout = true;
    else if (a === '--channel' || a.startsWith('--channel=') || a === '--source' || a.startsWith('--source=')) {
      const name = a.startsWith('--channel') ? '--channel' : '--source';
      const v = value(name);
      if (v === null) return { error: `${name} needs a value` };
      opts[name.slice(2)] = v;
    }
    else if (a === '-h' || a === '--help') opts.help = true;
    else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  if (opts.channel !== null && !CHANNELS.includes(opts.channel)) return { error: '--channel takes stable or beta' };
  if (opts.source !== null && !SOURCES.includes(opts.source)) return { error: '--source takes portll or github' };
  if ([opts.login, opts.tokenStdin, opts.logout].filter(Boolean).length > 1) return { error: '--login, --token-stdin and --logout are separate runs' };
  return { opts };
}

const USAGE = `usage: commitwork update [--check] [--channel stable|beta] [--source portll|github] [--yes]
       commitwork update --login | --token-stdin | --logout`;

async function readStdin(stdin) {
  let s = '';
  for await (const chunk of stdin) s += chunk;
  return s.trim();
}

const askYes = (question, { stdin, stderr }) => new Promise((done) => {
  const rl = createInterface({ input: stdin, output: stderr });
  rl.question(question, (a) => { rl.close(); done(/^y(es)?$/i.test(a.trim())); });
});

/** The CLI. Every effect is injectable; the defaults are the real ones. */
export async function main(argv, {
  env = process.env, stdin = process.stdin, stderr = process.stderr, fetch = globalThis.fetch,
  settings = updateSettings, run = runUpdate, tokens = { resolveToken, storeToken, deleteToken, requestDeviceCode, pollDeviceToken },
  dir = configDir, isTTY = !!(process.stdin.isTTY && process.stderr.isTTY),
} = {}) {
  const say = (m) => stderr.write(`commitwork update: ${m}\n`);
  const parsed = parseUpdateArgs(argv);
  if (parsed.error) { say(parsed.error); stderr.write(`${USAGE}\n`); return EXIT.USAGE; }
  const { opts } = parsed;
  if (opts.help) { stderr.write(`${USAGE}\n`); return EXIT.OK; }

  if (opts.logout) {
    const r = tokens.deleteToken({ configDir: dir() });
    say(r ? `removed the stored token (${r.where})` : 'no token was stored');
    return EXIT.OK;
  }
  if (opts.tokenStdin) {
    try {
      const where = tokens.storeToken(await readStdin(stdin), { configDir: dir() });
      say(`token stored (${where.where === 'keychain' ? `Keychain item ${where.item}` : where.file})`);
      return EXIT.OK;
    } catch (e) { say(e.message); return EXIT.LOGIN_FAILED; }
  }
  if (opts.login) {
    try {
      const clientId = env.PORTLL_GITHUB_CLIENT_ID;
      const code = await tokens.requestDeviceCode({ fetch, clientId });
      // A bare URL: terminals make it clickable.
      say(`open ${code.verificationUri} and enter the code ${code.userCode}`);
      say('waiting for GitHub to confirm the sign-in...');
      const token = await tokens.pollDeviceToken({ fetch, clientId, deviceCode: code.deviceCode, interval: code.interval, expiresIn: code.expiresIn });
      const where = tokens.storeToken(token, { configDir: dir() });
      say(`signed in; token stored (${where.where === 'keychain' ? `Keychain item ${where.item}` : where.file})`);
      return EXIT.OK;
    } catch (e) { say(e.message); return EXIT.LOGIN_FAILED; }
  }

  const s = settings();
  const channel = opts.channel || s.channel;
  const sources = opts.source ? [opts.source] : s.sources;
  const tok = tokens.resolveToken({ env, configDir: dir() });
  if (tok.warning) say(tok.warning);
  const confirm = async (version) => {
    if (opts.yes) return true;
    if (!isTTY) { say(`commitwork ${version} is available; pass --yes to install it without a terminal`); return false; }
    return askYes(`Install commitwork ${version}? [y/N] `, { stdin, stderr });
  };
  const r = await run({ mode: opts.check ? 'check' : 'install', channel, sources, fetch, token: tok.token, confirm, say });
  if (r.outcome === 'installed') say(`installed commitwork ${r.version} in ${r.dest}. Restart the panel and any running commitwork to load it`);
  else if (r.detail && r.outcome !== 'available') say(`${r.outcome}: ${r.detail}`);
  return r.code;
}

if (isMainModule(import.meta.url)) process.exitCode = await main(process.argv.slice(2));

#!/usr/bin/env node
// commitwork panel break-glass — recover an admin panel you cannot log into.
// Authority is filesystem access to the 0600 store; never a network surface (opens no socket,
// nothing in admin/serve.mjs imports it). Secrets never touch argv — read echo-off or from stdin.
//
// usage:
//   node bin/panel-breakglass.mjs status
//   node bin/panel-breakglass.mjs reset-password <email>
//   node bin/panel-breakglass.mjs reissue-totp   <email>
//   node bin/panel-breakglass.mjs disable-totp   <email>
//   node bin/panel-breakglass.mjs unlock
//   node bin/panel-breakglass.mjs reopen-bootstrap --yes-destroy-all-accounts
//
// exit: 0 ok · 1 refused / not found · 2 bad usage
import { createInterface } from 'node:readline';
import { existsSync, statSync } from 'node:fs';
import {
  authStorePath, listUsers, resetPassword, reissueTotp, disableTotp,
  removeAllUsers, inspectStoreLock, releaseStoreLock, needsBootstrap, setEmailFactor } from '../admin/auth.mjs';
import { describeAge } from '../monitor/lockfile.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const die = (code, msg) => { console.error(msg); process.exit(code); };

// Read a secret without echoing; non-TTY falls back to a stdin line (still never argv).
function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin });
      let got = null;
      rl.on('line', (l) => { if (got === null) { got = l; rl.close(); } });
      rl.on('close', () => (got === null ? reject(new Error('no password on stdin')) : resolve(got)));
      return;
    }
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      // Ctrl-C/Ctrl-D abort without writing and must restore the terminal from raw mode
      if (ch === '\u0003' || ch === '\u0004') { cleanup(); process.stdout.write('\n'); process.exit(1); }
      if (ch === '\r' || ch === '\n') { cleanup(); process.stdout.write('\n'); return resolve(buf); }
      if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); return; }
      buf += ch;
    };
    function cleanup() { stdin.removeListener('data', onData); stdin.setRawMode(!!wasRaw); stdin.pause(); }
    stdin.on('data', onData);
  });
}

async function confirmPhrase(phrase) {
  if (!process.stdin.isTTY) return argv.includes('--yes-destroy-all-accounts');
  process.stdout.write(`Type exactly "${phrase}" to proceed: `);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question('', (a) => { rl.close(); r(a); }));
  return answer.trim() === phrase;
}

function storeFacts() {
  const present = existsSync(authStorePath());
  let mode = null;
  if (present) { try { mode = '0' + (statSync(authStorePath()).mode & 0o777).toString(8); } catch { /* ignore */ } }
  return { present, mode };
}

async function main() {
  switch (cmd) {
    case 'status': {
      const { present, mode } = storeFacts();
      console.log(`store      ${authStorePath()}`);
      console.log(`present    ${present}${mode ? `  (mode ${mode})` : ''}`);
      const lock = inspectStoreLock();
      console.log(`lock       ${lock.held ? `HELD ${describeAge(lock.ageMs)}${lock.stale ? ' (STALE)' : ''}` : 'free'}`);
      // loadStore() fails closed — UNREADABLE is not "no users"
      let users;
      try { users = listUsers(); }
      catch (e) {
        console.log('users      UNREADABLE');
        return die(1, `\nthe store could not be read: ${e.message}\n` +
          'This is NOT the same as "no users". The panel is refusing to serve rather than\n' +
          'serving as un-bootstrapped, which is correct. Fix the file, restore it, or run\n' +
          '`reopen-bootstrap` if you accept losing every account.');
      }
      console.log(`users      ${users.length}${users.length === 0 ? '  — panel refuses all non-loopback requests (R8a)' : ''}`);
      for (const u of users) {
        console.log(`  · ${u.email}  [${u.kind}]  totp=${u.totpEnrolled ? (u.totpConfirmed ? 'confirmed' : 'enrolled, unconfirmed') : 'none'}  recovery=${u.recoveryRemaining} left  created=${u.createdAt || '?'}`);
      }
      if (needsBootstrap()) {
        console.log('\nNo operator exists. Create one from the box itself:');
        console.log('  open http://127.0.0.1:7878 and use the bootstrap form.');
      }
      return;
    }

    case 'reset-password': {
      const email = argv[1];
      if (!email) return die(2, 'usage: panel-breakglass.mjs reset-password <email>');
      const pw = await readSecret(`New password for ${email} (min 12 chars, not echoed): `);
      const again = process.stdin.isTTY ? await readSecret('Again: ') : pw;
      if (pw !== again) return die(1, 'passwords did not match; nothing was changed');
      let out;
      try { out = resetPassword(email, pw); } catch (e) { return die(1, `refused: ${e.message}`); }
      console.log(`\npassword reset for ${out.email}`);
      console.log('\nNEW RECOVERY CODES — shown once, stored hashed, single-use.');
      console.log('The old codes were salted with the old password salt and can never validate again.');
      for (const c of out.recovery) console.log(`  ${c}`);
      return;
    }

    case 'reissue-totp': {
      const email = argv[1];
      if (!email) return die(2, 'usage: panel-breakglass.mjs reissue-totp <email>');
      let out;
      try { out = reissueTotp(email); } catch (e) { return die(1, `refused: ${e.message}`); }
      console.log(`new TOTP secret for ${out.email} — add this to an authenticator, then confirm it:`);
      console.log(`\n  ${out.otpauth}\n`);
      console.log('Confirm from the box with:');
      console.log("  curl -sS -X POST http://127.0.0.1:7878/auth/totp/confirm \\");
      console.log("       -H 'content-type: application/json' -H \"x-cw-csrf: $(curl -sS http://127.0.0.1:7878/api/csrf | sed 's/.*\"token\":\"\\([^\"]*\\)\".*/\\1/')\" \\");
      console.log(`       -d '{"email":"${out.email}","password":"…","token":"123456"}'`);
      console.log('\nUntil it is confirmed, login does not demand a code — so you are not locked out mid-way.');
      return;
    }

    case 'disable-totp': {
      const email = argv[1];
      if (!email) return die(2, 'usage: panel-breakglass.mjs disable-totp <email>');
      console.log(`This REMOVES the second factor from ${email}. The account will then be`);
      console.log('protected by its password alone.');
      if (!(await confirmPhrase('disable totp'))) return die(1, 'not confirmed; nothing was changed');
      let out;
      try { out = disableTotp(email); } catch (e) { return die(1, `refused: ${e.message}`); }
      console.log(`second factor removed for ${out.email}. Re-enrol with \`reissue-totp\` when you can.`);
      return;
    }

    case 'email-factor': {
      const email = argv[1]; const mode = argv[2];
      if (!email || !/^(on|off)$/.test(String(mode || ''))) return die(2, 'usage: panel-breakglass.mjs email-factor <email> on|off');
      let out;
      try { out = setEmailFactor(email, mode === 'on'); } catch (e) { return die(1, `refused: ${e.message}`); }
      console.log(`email second factor ${out.emailFactor ? 'ON' : 'off'} for ${out.email}${out.emailFactor ? ' — a 6-digit code is mailed at sign-in (needs a mail transport)' : ''}`);
      return;
    }

    case 'unlock': {
      const lock = inspectStoreLock();
      if (!lock.held) { console.log('no lock present'); return; }
      console.log(`lock at ${lock.path} is ${describeAge(lock.ageMs)}${lock.stale ? ' (stale)' : lock.ageKnown === false ? ' (age UNREADABLE — not treated as stale; use --force if you have confirmed the holder is dead)' : ' (NOT stale — a live process may hold it)'}`);
      if (!lock.stale && !argv.includes('--force')) {
        return die(1, 'refusing to break a fresh lock: withStoreLock() breaks stale locks by itself.\n' +
          'If you are certain the holder is dead, re-run with --force.');
      }
      const out = releaseStoreLock();
      console.log(out.released ? `released ${out.path}` : `nothing to release (${out.reason})`);
      return;
    }

    case 'reopen-bootstrap': {
      console.log('This DELETES EVERY ACCOUNT in the store, reopening the bootstrap window so a new');
      console.log('operator can be created from loopback. Recovery codes, TOTP enrolments and SSO');
      console.log('bindings all go with them. There is no undo.');
      console.log(`store: ${authStorePath()}`);
      if (!(await confirmPhrase('destroy all accounts'))) return die(1, 'not confirmed; nothing was changed');
      let out;
      try { out = removeAllUsers(); } catch (e) { return die(1, `refused: ${e.message}`); }
      console.log(`removed ${out.removed} account(s). Open http://127.0.0.1:7878 on the box to create a new one.`);
      return;
    }

    default:
      console.error('commitwork panel break-glass — recover a panel you cannot log into.\n');
      console.error('  status                                          what the store holds, and whether it is readable');
      console.error('  reset-password <email>                          set a new password + mint new recovery codes');
      console.error('  reissue-totp <email>                            mint a fresh authenticator secret');
      console.error('  disable-totp <email>                            drop the second factor (password only afterwards)');
      console.error('  unlock [--force]                                clear a stranded store lock');
      console.error('  reopen-bootstrap                                delete every account (destructive)');
      console.error('\nPasswords are read from the terminal with echo off — never from argv.');
      process.exit(2);
  }
}

main().catch((e) => die(1, `break-glass failed: ${e.message}`));

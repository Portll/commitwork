#!/usr/bin/env node
// bin/secrets.mjs — declare, inspect and gate on secrets held in the macOS Keychain.
//
// The value is never an argument and never printed — `security` prompts on the tty, and there
// is deliberately no `get`.
//
//   node bin/secrets.mjs set  GOOGLE_OAUTH_CLIENT_SECRET   # prompts; stores + records the ref
//   node bin/secrets.mjs list                              # names, refs, resolvable — no values
//   node bin/secrets.mjs check [NAME...]                   # exit 1 if any is unresolvable (gates)
//   node bin/secrets.mjs ref  NAME keychain:svc/acct        # record a ref you stored yourself
//   node bin/secrets.mjs ref  NAME 'file:/abs/path.toml#key' # …or one another tool already owns
//
// --file <path> overrides the ref table (tests); --service <name> overrides the keychain service.

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { SECRETS_FILE, loadTable, setRef, status, resolveRef, defaultRefFor, parseRef } from '../lib/secrets.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`secrets: ${name} needs a value`); process.exit(2); }
  argv.splice(i, 2);
  return v;
};
const FILE = flag('--file', SECRETS_FILE);
const SERVICE = flag('--service', 'commitwork');
const [cmd, ...rest] = argv;

const usage = () => {
  console.log(`usage:
  node bin/secrets.mjs set   <NAME>                 store the value (prompts) and record the ref
  node bin/secrets.mjs ref   <NAME> <ref>           record a ref for a value stored elsewhere
                                                   keychain:<service>/<account>  (macOS only)
                                                   file:<absolute path>#<key>    (any platform)
  node bin/secrets.mjs list                         declared secrets, refs, resolvable — NO values
  node bin/secrets.mjs check [NAME...]              exit 1 if any declared secret is unresolvable

  --file <path>      ref table (default ${SECRETS_FILE})
  --service <name>   keychain service for new refs (default commitwork)

The ref table holds POINTERS, never values — the value lives in the login keychain, or in a config
file some other tool already owns. There is no \`get\`: printing a credential to a terminal puts it
in scrollback.`);
};

if (!cmd || cmd === 'help' || cmd === '--help') { usage(); process.exit(0); }

if (cmd === 'set') {
  const name = rest[0];
  if (!name) { console.error('secrets set: needs a NAME'); process.exit(2); }
  if (platform() !== 'darwin') { console.error(`secrets set: the keychain backend needs macOS (this is ${platform()})`); process.exit(2); }
  const ref = defaultRefFor(name, SERVICE);
  const { service, account } = parseRef(ref);
  console.log(`Storing ${service}/${account} in the login keychain.`);
  console.log('`security` will prompt for the value — it is typed into security, never passed as an');
  console.log('argument, so it cannot appear in `ps` output or in your shell history.\n');
  try {
    // -w with no value prompts on the tty (stdio inherit) — this process never sees it; -U updates in place.
    execFileSync('security', ['add-generic-password', '-a', account, '-s', service, '-U', '-w'], { stdio: 'inherit' });
  } catch (e) {
    console.error(`\nsecrets set: security exited ${e.status ?? '?'} — nothing was recorded.`);
    process.exit(1);
  }
  const probe = resolveRef(ref);
  if (!probe.ok) {
    console.error(`\nsecrets set: stored, but it does not read back (${probe.reason}: ${probe.detail}).`);
    console.error('The ref was NOT recorded — a ref that cannot resolve is worse than no ref.');
    process.exit(1);
  }
  const out = setRef(name, ref, { file: FILE });
  console.log(`\n✓ ${name} → ${ref}  (recorded in ${out.file}; verified readable, value not shown)`);
  process.exit(0);
}

if (cmd === 'ref') {
  const [name, ref] = rest;
  if (!name || !ref) { console.error('secrets ref: needs NAME and keychain:<service>/<account> or file:<absolute path>#<key>'); process.exit(2); }
  try {
    const out = setRef(name, ref, { file: FILE });
    const probe = resolveRef(ref);
    console.log(`✓ ${name} → ${ref}  (recorded in ${out.file})`);
    if (!probe.ok) console.error(`  warning: it does not resolve yet — ${probe.reason}: ${probe.detail}`);
    process.exit(0);
  } catch (e) { console.error(`secrets ref: ${e.message}`); process.exit(2); }
}

if (cmd === 'list' || cmd === 'check') {
  let rows;
  try { rows = status({ file: FILE }); }
  catch (e) { console.error(`secrets: ${e.message}`); process.exit(2); }

  const wanted = rest.length ? rows.filter((r) => rest.includes(r.name)) : rows;
  // `check NAME` for something never declared is a failure, not an empty pass.
  const undeclared = rest.filter((n) => !rows.some((r) => r.name === n));

  if (!wanted.length && !undeclared.length) {
    console.log(`no secrets declared in ${FILE}`);
    console.log('declare one with:  node bin/secrets.mjs set <NAME>');
    process.exit(cmd === 'check' ? 0 : 0);
  }

  const head = ['name', 'ref', 'resolvable', 'note'];
  const body = wanted.map((r) => [
    r.name, r.ref,
    r.resolvable ? 'yes' : 'NO',
    r.envOverride ? 'env var set — that value wins' : (r.resolvable ? '' : `${r.reason}: ${r.detail}`),
  ]);
  for (const n of undeclared) body.push([n, '—', 'NO', 'undeclared: no ref recorded']);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => String(b[i]).length)));
  const line = (c) => c.map((v, i) => String(v).padEnd(w[i])).join('  ').trimEnd();
  console.log(line(head));
  for (const b of body) console.log(line(b));

  const bad = body.filter((b) => b[2] === 'NO').length;
  if (cmd === 'check' && bad) {
    console.error(`\n${bad} secret(s) unresolvable. Exit 1 so this can gate — a credential that is`);
    console.error('absent must fail loudly rather than degrade into a silent no-op.');
    process.exit(1);
  }
  process.exit(0);
}

console.error(`secrets: unknown command '${cmd}'`);
usage();
process.exit(2);

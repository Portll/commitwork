// monitor/credential-scope.mjs — the credential-store scope lens: every credential commitwork
// holds, joined against every credential the store holds UNDER commitwork's name, with the blast
// radius of each declared beside it. Identity visible, in one place.
//
// Three sources, three failure directions:
//   declared   the ref table (lib/secrets.mjs, ~/.commitwork/secrets.json) — pointers, never values
//   observed   a METADATA-ONLY keychain sweep (`security dump-keychain`, no -d, no -w — this lens
//              never touches a value) filtered to the declared namespaces
//   radius     the private record monitor/private/credential-scope.json — what each credential
//              reaches and what a leak costs (monitor/credential-scope.example.json is the shape)
//
// The joins that matter:
//   undeclared          an item lives under commitwork's namespace that no ref explains — THE
//                       finding. A credential nobody can account for is the compromise shape.
//   unresolvable        declared and not present in the store — loud (bin/secrets.mjs check gates
//                       on the read-ACL form of this; here it is the existence form).
//   radius-undeclared   declared and held, but nobody wrote down what it can reach — the exact gap
//                       this lens exists to close, rendered as unverified, never as a pass.
//   env-exposed         a declared name also rides this process's environment — a keychain-held
//                       secret duplicated into env defeats the keychain (flag, name only).
//   held                declared + observed + radius declared. The good state.
// On a non-darwin box the sweep half is unknown('not-run') — the ref-table half still reports;
// grey is its own state, never an empty pass.
//
// An absent radius file (ENOENT) is UNKNOWN (no-reference), exit 2: nothing declares the namespaces
// to sweep, so there is nothing to join against. Any other read or schema failure throws.
//
// Env (read at call time): CW_SECRETS_FILE (the lib honours it), CW_CRED_SCOPE (radius file),
// CW_CRED_DUMP (fixture dump text — tests run without a keychain), CW_NOW.
//
//   node monitor/credential-scope.mjs [--json]   exit 0 all held, 1 findings, 2 grey

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTable, parseRef, SECRETS_FILE } from '../lib/secrets.mjs';
import { unknown } from './unknown.mjs';
import { validateAgainstSchema } from './registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { credentialScopePathFor } from './store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scopePath = () => credentialScopePathFor(REPO);
const SCOPE_SCHEMA = join(REPO, 'schema', 'credential-scope.schema.json');

/** Read + schema-validate the scope. Throws on an invalid file — the lens must refuse to sweep a
 *  namespace nobody declared or render a radius nobody wrote. */
export function readScope() {
  const s = JSON.parse(readFileSync(scopePath(), 'utf8'));
  const { errors } = validateAgainstSchema(s, { path: SCOPE_SCHEMA });
  if (errors.length) throw new Error(`credential scope invalid (${scopePath()}):\n  - ${errors.join('\n  - ')}`);
  return s;
}

// ── pure: dump-keychain parser (metadata only — the dump itself carries no secret data) ─────────
/** Parse `security dump-keychain` output → [{class, service, account, label}]. */
export function parseKeychainDump(text) {
  const items = [];
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('keychain: ')) { if (cur) items.push(cur); cur = { class: null, service: null, account: null, label: null }; continue; }
    if (!cur) continue;
    let m;
    if ((m = /^class: "?(\w+)"?/.exec(line.trim()))) cur.class = m[1];
    else if ((m = /"svce"<blob>="([^"]*)"/.exec(line))) cur.service = m[1];
    else if ((m = /"srvr"<blob>="([^"]*)"/.exec(line))) cur.service = cur.service ?? m[1];
    else if ((m = /"acct"<blob>="([^"]*)"/.exec(line))) cur.account = m[1];
    else if ((m = /0x00000007 <blob>="([^"]*)"/.exec(line))) cur.label = m[1];
  }
  if (cur) items.push(cur);
  return items.filter((i) => i.account != null && i.service != null);
}

/** Sweep the keychain. CW_CRED_DUMP (a file of dump text) bypasses exec. Throws on failure —
 *  an unsweepable store is never an empty one. Non-darwin returns null: adapter not written. */
export function sweepKeychain({ platform = process.platform, exec = execFileSync } = {}) {
  const fixture = process.env.CW_CRED_DUMP;
  if (fixture) return parseKeychainDump(readFileSync(fixture, 'utf8'));
  if (platform !== 'darwin') return null;
  return parseKeychainDump(exec('security', ['dump-keychain'], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 }));
}

// ── pure: the join ──────────────────────────────────────────────────────────────────────────────
/**
 * @param table    the ref table ({secrets: {NAME: 'keychain:svc/acct'}})
 * @param scope    {namespaces, radius}
 * @param observed keychain items, or null when the store could not be swept (adapter absent)
 * @param envNames names present in the process environment (the caller observes; this stays pure)
 */
export function assessCredentials(table, scope, observed, envNames = new Set()) {
  const inNamespace = observed === null ? null
    : observed.filter((i) => scope.namespaces.includes(i.service));
  const byAcct = inNamespace === null ? null : new Map(inNamespace.map((i) => [`${i.service}/${i.account}`, i]));

  const rows = [];
  for (const [name, ref] of Object.entries(table.secrets).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const r = parseRef(ref);
    const radius = scope.radius[name] ?? null;
    const present = byAcct === null ? null : byAcct.has(`${r.service}/${r.account}`);
    const state = present === false ? 'unresolvable'
      : radius === null ? 'radius-undeclared'
      : present === null ? 'held-unswept'
      : 'held';
    rows.push({
      name, ref, state,
      ...(radius ? { radius } : {}),
      ...(present === null ? unknown('not-run', 'store sweep unavailable on this platform') : {}),
      ...(envNames.has(name) ? { envExposed: true } : {}),
    });
  }

  const declaredKeys = new Set(Object.values(table.secrets).map((ref) => {
    const r = parseRef(ref);
    return `${r.service}/${r.account}`;
  }));
  const undeclared = inNamespace === null ? null
    : inNamespace.filter((i) => !declaredKeys.has(`${i.service}/${i.account}`))
      .map((i) => ({ service: i.service, account: i.account, label: i.label, state: 'undeclared' }))
      .sort((a, b) => (a.account < b.account ? -1 : 1));

  const findings = rows.filter((r) => r.state === 'unresolvable').concat(undeclared ?? []);
  const grey = rows.some((r) => r.state === 'radius-undeclared' || r.state === 'held-unswept') || undeclared === null;
  const state = findings.length ? 'findings' : grey ? 'partial' : 'ok';
  return { rows, undeclared, findings, state, swept: inNamespace !== null, namespaceItems: inNamespace?.length ?? null };
}

export function runLens({ platform, exec } = {}) {
  // CW_SECRETS_FILE read HERE, not via the lib's import-time constant — a const at import defeats
  // the override for any test that sets it afterwards, and the test then proves nothing.
  const table = loadTable(process.env.CW_SECRETS_FILE || SECRETS_FILE);   // throws on a malformed table
  let scope;
  try { scope = readScope(); } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { at: nowISO(), ...unknown('no-reference', `no credential scope at ${scopePath()} (ENOENT); declare one from monitor/credential-scope.example.json`), state: 'unknown' };
    }
    throw e;
  }
  let observed;
  try { observed = sweepKeychain({ platform, exec }); }
  catch (e) {
    return { at: nowISO(), ...unknown('tool-failed', `sweep: ${e.code || e.message}`), state: 'unknown' };
  }
  const envNames = new Set(Object.keys(table.secrets).filter((n) => process.env[n] !== undefined));
  return { at: nowISO(), ...assessCredentials(table, scope, observed, envNames) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/credential-scope.mjs [--json]   join declared refs × keychain namespace sweep × blast radius\n'
      + 'exit 0 all held, 1 findings (undeclared item / unresolvable ref), 2 grey (unswept or radius gaps)');
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.unknown) console.log(`credential-scope: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`);
  else {
    console.log(`credential-scope: ${r.state}  (${r.rows.length} declared, ${r.namespaceItems ?? '?'} in namespace, ${r.at})`);
    for (const row of r.rows) {
      const flags = [row.envExposed ? 'ENV-EXPOSED' : null].filter(Boolean).join(' ');
      console.log(`  ${row.state.toUpperCase().padEnd(18)} ${row.name}${flags ? `  ⚠ ${flags}` : ''}`);
      if (row.radius) console.log(`${' '.repeat(21)}→ ${row.radius.system}; leak: ${row.radius.leak}`);
    }
    for (const u of r.undeclared ?? []) console.log(`  UNDECLARED         ${u.service}/${u.account}${u.label ? `  (${u.label})` : ''} — no ref explains this item`);
  }
  process.exit(r.unknown ? 2 : r.findings?.length ? 1 : r.state === 'ok' ? 0 : 2);
}

// lib/secrets.mjs — secrets by REFERENCE, resolved at spawn time from the macOS Keychain, or from a
// config file another tool already owns (see FILE_REF_RE for why the second backend exists).
// An absent secret must be LOUD, never a silent no-op. Secrets never enter argv: read via
// `security ... -w` (value on stdout), written via a tty prompt. On disk lives only a ref table.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

// Read at call time: a path fixed at import sent a test that set CW_SECRETS_FILE after importing to
// the operator's real table. SECRETS_FILE stays as the import-time value for existing callers.
export const secretsFile = () => process.env.CW_SECRETS_FILE || join(homedir(), '.commitwork', 'secrets.json');
export const SECRETS_FILE = secretsFile();

// keychain:<service>/<account>. Both reach `security`'s argv, so metacharacters and newlines are
// refused (defence in depth — execFileSync uses no shell).
const REF_RE = /^keychain:([A-Za-z0-9._-]{1,64})\/([A-Za-z0-9._-]{1,128})$/;

// file:<absolute path>#<key> — a `key = value` line in a config file another tool already owns.
//
// WHY THIS EXISTS. The keychain backend is macOS-only, so on Windows and Linux this module resolved
// NOTHING and every declared secret came back `unsupported-platform`. That is not a safe default,
// it is a whole platform on which the loud-void machinery below never gets a value to be loud
// about. Measured 2026-09-04: a healthy veld server on 127.0.0.1:3030, its key sitting in its own
// config.toml, and no way for this repository to read it except an env var typed by hand each run —
// which is a habit, not a mechanism.
//
// It is a WEAKER backend than the keychain and the difference is not hidden: a file has no ACL
// prompt and no per-process authorisation, so the guarantee is only that the value stays out of
// argv, out of logs and out of the ref table. `status()` reports the backend so an operator can see
// which one a secret is standing on.
const FILE_REF_RE = /^file:(.+)#([A-Za-z0-9._-]{1,128})$/;

export function parseRef(ref) {
  const s = String(ref || '');
  const m = REF_RE.exec(s);
  if (m) return { backend: 'keychain', service: m[1], account: m[2] };
  const f = FILE_REF_RE.exec(s);
  if (f && isAbsolutePath(f[1])) return { backend: 'file', path: f[1], key: f[2] };
  return null;
}

/** Absolute only. A relative path in a ref resolves against whatever cwd the caller happened to
 *  have, which makes the same ref mean different files in different processes. */
function isAbsolutePath(p) {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

const REF_FORMS = 'keychain:<service>/<account> or file:<absolute path>#<key>';

/**
 * One `key = value` line. Handles the TOML/ini/dotenv shapes that actually occur:
 *   key = "value"   key = 'value'   key=value   key = value  # trailing comment
 *
 * Deliberately NOT a TOML parser: it does not know sections, so a key that appears under two
 * tables resolves to the first occurrence. That limit is stated rather than papered over, because
 * the alternative is a parser this repository would then have to own.
 */
export function valueFromConfig(text, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- esc is the key with every regex metacharacter escaped on the line above
  const re = new RegExp(`^[ \\t]*${esc}[ \\t]*=[ \\t]*(.*)$`, 'm');
  const m = re.exec(String(text));
  if (!m) return null;
  const raw = m[1].trim();
  const quoted = /^(["'])([\s\S]*?)\1/.exec(raw);
  if (quoted) return quoted[2];
  return raw.replace(/\s+[#;].*$/, '').trim();
}

function emptyTable() { return { version: 1, secrets: {} }; }

/** Absent table is a legitimate empty; a table that EXISTS and is malformed throws — a typo must
 *  not read as "nothing is declared". */
export function loadTable(file = secretsFile()) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return emptyTable();
    throw new Error(`secrets table at ${file} is unreadable (${e.code}); refusing to treat it as empty`);
  }
  let t;
  try { t = JSON.parse(raw); }
  catch (e) { throw new Error(`secrets table at ${file} is not valid JSON (${e.message}); refusing to treat it as empty`); }
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error(`secrets table at ${file} is not an object`);
  if (t.secrets === undefined) t.secrets = {};
  if (!t.secrets || typeof t.secrets !== 'object' || Array.isArray(t.secrets)) {
    throw new Error(`secrets table at ${file} has a non-object 'secrets' map`);
  }
  for (const [name, ref] of Object.entries(t.secrets)) {
    if (!parseRef(ref)) throw new Error(`secrets table at ${file}: ${name} has an unparseable ref ${JSON.stringify(ref)} (expected ${REF_FORMS})`);
  }
  return t;
}

export function saveTable(table, file = secretsFile()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(table, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best-effort on odd filesystems */ }
  return file;
}

/**
 * Resolve ONE ref. Returns { ok:true, value } or { ok:false, reason, detail }; never throws for an
 * expected condition, never logs the value. Reasons stay distinct — not-found/locked/denied demand
 * different operator actions.
 */
export function resolveRef(ref, { env = process.env } = {}) {
  const parsed = parseRef(ref);
  if (!parsed) return { ok: false, reason: 'bad-ref', detail: `expected ${REF_FORMS}, got ${JSON.stringify(ref)}` };
  if (parsed.backend === 'file') return resolveFileRef(parsed);
  if (platform() !== 'darwin') {
    return { ok: false, reason: 'unsupported-platform', detail: `the keychain backend needs macOS; this is ${platform()}. Set the environment variable directly, or add a backend.` };
  }
  try {
    // -w prints only the password to stdout; service/account in argv are identifiers, not secrets.
    const out = execFileSync('security',
      ['find-generic-password', '-w', '-s', parsed.service, '-a', parsed.account],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    // security appends a newline; a trailing newline is never part of a credential.
    const value = out.replace(/\n$/, '');
    if (!value) return { ok: false, reason: 'empty', detail: 'the keychain item exists but holds an empty value' };
    return { ok: true, value };
  } catch (e) {
    const stderr = String(e.stderr || '');
    // 44 = SecItemNotFound; 51 = interaction not allowed (locked keychain, or a headless job that
    // cannot answer the ACL prompt).
    if (e.status === 44 || /could not be found/i.test(stderr)) {
      return { ok: false, reason: 'not-found', detail: `no keychain item ${parsed.service}/${parsed.account} — create it with: node bin/secrets.mjs set <NAME>` };
    }
    if (e.status === 51 || /interaction is not allowed/i.test(stderr)) {
      return { ok: false, reason: 'locked', detail: 'the login keychain is locked or this process may not read the item without a prompt. A headless launchd job cannot answer that prompt: unlock the keychain, or grant the item always-allow access for the reading binary.' };
    }
    if (e.code === 'ENOENT') return { ok: false, reason: 'no-security-cli', detail: '`security` not found on PATH' };
    if (e.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout', detail: 'the keychain did not answer within 10s (an unanswered prompt looks exactly like this)' };
    return { ok: false, reason: 'error', detail: `security exited ${e.status ?? '?'}: ${stderr.trim() || e.message}` };
  }
}

/** The file backend. Reasons stay distinct for the same reason the keychain's do: `not-found`,
 *  `no-key` and `empty` demand three different operator actions, and only the first is "absent". */
function resolveFileRef(parsed) {
  let text;
  try {
    text = readFileSync(parsed.path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { ok: false, reason: 'not-found', detail: `no file at ${parsed.path}` };
    }
    // A permission error is NOT an absent secret. Collapsing the two is how a credential failure
    // becomes a silent no-op, which is the one thing this module exists to prevent.
    return { ok: false, reason: 'unreadable', detail: `${parsed.path} is unreadable (${e.code || e.message})` };
  }
  const value = valueFromConfig(text, parsed.key);
  if (value === null) {
    return { ok: false, reason: 'no-key', detail: `${parsed.path} exists but has no \`${parsed.key} = …\` line` };
  }
  if (!value) return { ok: false, reason: 'empty', detail: `${parsed.path} sets ${parsed.key} to an empty value` };
  return { ok: true, value };
}

/**
 * Resolve every declared secret into a CHILD environment. Precedence: an env var already set WINS
 * (source: 'env'), so one-offs keep working.
 * @returns {{env: object, resolved: Array, missing: Array, ok: boolean}} — env is a COPY; values
 *   appear only there.
 */
export function resolveInto(names, { env = process.env, table = null, file = secretsFile() } = {}) {
  const t = table || loadTable(file);
  const out = { ...env };
  const resolved = [];
  const missing = [];
  for (const name of names) {
    if (env[name] !== undefined && env[name] !== '') { resolved.push({ name, source: 'env' }); continue; }
    const ref = t.secrets[name];
    if (!ref) { missing.push({ name, reason: 'undeclared', detail: `no ref for ${name} in ${file}` }); continue; }
    const r = resolveRef(ref, { env });
    // The backend that ACTUALLY supplied it. Hard-coding 'keychain' here would have reported a
    // file-backed secret as keychain-backed, which is a claim about its protection, not its origin.
    if (r.ok) { out[name] = r.value; resolved.push({ name, source: parseRef(ref).backend, ref }); }
    else missing.push({ name, ref, reason: r.reason, detail: r.detail });
  }
  return { env: out, resolved, missing, ok: missing.length === 0 };
}

/** Presence WITHOUT values — no value field at all, not even a redacted one. */
export function status({ table = null, file = secretsFile(), probe = true } = {}) {
  const t = table || loadTable(file);
  return Object.entries(t.secrets).map(([name, ref]) => {
    const row = { name, ref, declared: true, backend: parseRef(ref)?.backend ?? null };
    if (probe) {
      const r = resolveRef(ref);
      row.resolvable = r.ok;
      if (!r.ok) { row.reason = r.reason; row.detail = r.detail; }
    }
    row.envOverride = process.env[name] !== undefined && process.env[name] !== '';
    return row;
  });
}

// Records the ref only — the value is typed interactively via bin/secrets.mjs, never passed.
export function setRef(name, ref, { file = secretsFile() } = {}) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`${name} is not an environment variable name (A-Z, 0-9, _)`);
  if (!parseRef(ref)) throw new Error(`unparseable ref ${JSON.stringify(ref)} (expected ${REF_FORMS})`);
  const t = loadTable(file);
  t.secrets[name] = ref;
  saveTable(t, file);
  return { name, ref, file };
}

export const defaultRefFor = (name, service = 'commitwork') => `keychain:${service}/${name}`;

/** The LOUD VOID. Reports a required-and-absent secret to stderr with one shared wording;
 *  returns the message so a caller can also report it. */
export function reportMissing(missing, { context = '', logger = console } = {}) {
  if (!missing.length) return '';
  const head = `MISSING SECRET${missing.length > 1 ? 'S' : ''}${context ? ` for ${context}` : ''}: ${missing.map((m) => m.name).join(', ')}`;
  const lines = [head];
  for (const m of missing) lines.push(`  - ${m.name}: ${m.reason} — ${m.detail}`);
  lines.push('  This is reported rather than skipped on purpose: a credential that is absent must not');
  lines.push('  degrade into a silent no-op. Declare it with `node bin/secrets.mjs set <NAME>`, or set');
  lines.push('  the environment variable directly for a one-off.');
  const msg = lines.join('\n');
  logger.error(msg);
  return msg;
}

// lib/external-write.mjs — the one writer for material that leaves through an external/ folder.
//
// Source keeps real names, so a lookup key still resolves to a directory that exists. Only what is
// written under external/ is pseudonymised, here, at the boundary. The map is projected from the
// sidecar ledger's `external` boundary and lives with the private stores.
//
// Every failure refuses: an absent, unreadable or malformed map means this writer cannot tell
// whether it is about to disclose a name, and a refusal is the only safe answer.

import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalMapPathFor } from '../monitor/store-paths.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const externalRoot = (env) => resolve(env.CW_EXTERNAL_ROOT || resolve(REPO, 'external'));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function loadExternalMap(env = process.env) {
  const path = env.CW_EXTERNAL_REDACTIONS ? resolve(env.CW_EXTERNAL_REDACTIONS) : externalMapPathFor(REPO, { ambient: false });
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(e.code === 'ENOENT'
      ? `external-write: map is ABSENT at ${path} — refusing to write, because a missing map is not "nothing to redact"`
      : `external-write: cannot read ${path}: ${e.message}`);
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { throw new Error(`external-write: ${path} is not valid JSON (${e.message}) — refusing to write`); }
  const map = doc && doc.map;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`external-write: ${path} has no map{} — refusing to write`);
  const entries = Object.entries(map);
  if (!entries.length) throw new Error(`external-write: ${path} maps nothing — refusing to write`);
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || !/^\S+$/.test(k) || typeof v !== 'string' || !v) {
      throw new Error(`external-write: ${path} has a malformed entry — refusing to write`);
    }
  }
  return entries.sort((a, b) => b[0].length - a[0].length);
}

// A separator inside a name matches any one separator or none, because the same repository is
// written acme-labs, acme_labs and acmelabs. A match is widened to the whole alphanumeric run
// around it, so no part of a name survives beside its token: XACME becomes the token, never X plus it.
const namePattern = (name) => name.split(/[^A-Za-z0-9]+/).filter(Boolean).map(escapeRe).join('[^A-Za-z0-9\\s]?');

export function redactExternal(text, entries) {
  if (typeof text !== 'string') throw new TypeError('external-write: expected a string');
  let out = text;
  for (const [from, to] of entries) {
    const pattern = namePattern(from);
    if (pattern) out = out.replace(new RegExp(`[A-Za-z0-9]*${pattern}[A-Za-z0-9]*`, 'gi'), to);
  }
  return out;
}

// The second witness reads the OUTPUT, not the substitution: each whitespace-delimited token is
// normalised, so separator variants (acme_labs, a-c-m-e-l-a-b-s) cannot pass. Tokens name the residue,
// never the real name, because this message can reach a log.
export function residualTokens(text, entries) {
  const words = text.split(/\s+/).map(norm).filter(Boolean);
  const hits = new Set();
  for (const [from, to] of entries) {
    const n = norm(from);
    if (n && words.some((w) => w.includes(n))) hits.add(to);
  }
  return [...hits].sort();
}

export function writeExternal(relPath, content, env = process.env) {
  if (typeof relPath !== 'string' || !relPath || isAbsolute(relPath)) {
    throw new Error('external-write: path must be relative to the external/ folder');
  }
  const root = externalRoot(env);
  const dest = resolve(root, relPath);
  const rel = relative(root, dest);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`external-write: ${relPath} resolves outside ${root} — refusing to write`);
  }
  const entries = loadExternalMap(env);
  const redacted = redactExternal(String(content), entries);
  const residue = residualTokens(redacted, entries);
  if (residue.length) {
    throw new Error(`external-write: ${residue.length} name(s) survived redaction (residual forms of ${residue.join(', ')}) — refusing to write ${relPath}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeAtomic(dest, redacted);
  return { path: dest, bytes: Buffer.byteLength(redacted) };
}

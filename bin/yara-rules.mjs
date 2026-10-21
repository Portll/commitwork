#!/usr/bin/env node
// usage: yara-rules.mjs --install | --check | --where
// exit: 0 installed and verified (or, for --check, present and verified) · 1 refused or not installed · 2 usage
// env, read at call time: CW_YARA_RULE_PINS (the pin manifest, default manifests/yara-rules.json),
//   CW_TOOLS_ROOT (default ~/.commitwork/tools), CW_YARA_RULES_URL_BASE (replaces
//   https://raw.githubusercontent.com; a file:// base reads a local mirror, which is how tests run offline)
//
// The rule packs are third-party text under their own licences (LGPL-3.0, DRL 1.1), so they are
// fetched into the operator's tool store rather than shipped in this tree. Every file is pinned by
// commit AND by sha256: a byte that differs is refused before it is written, and a store that no
// longer matches its pins is "not installed", never "installed with a warning".
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const pinsPath = () => process.env.CW_YARA_RULE_PINS || join(HERE, '..', 'manifests', 'yara-rules.json');
export const storeRoot = () => join(process.env.CW_TOOLS_ROOT || join(homedir(), '.commitwork', 'tools'), 'yara-rules');
const urlBase = () => (process.env.CW_YARA_RULES_URL_BASE || 'https://raw.githubusercontent.com').replace(/\/+$/, '');
const SAFE_REL = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

export function loadPins(path = pinsPath()) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (!doc || typeof doc.sets !== 'object') throw new Error(`${path}: no "sets" object`);
  for (const [name, s] of Object.entries(doc.sets)) {
    if (!/^[0-9a-f]{40}$/.test(s.commit || '')) throw new Error(`${path}: set ${name} has no 40-hex commit`);
    for (const [rel, sha] of Object.entries(s.files || {})) {
      if (!SAFE_REL.test(rel) || rel.split('/').includes('..')) throw new Error(`${path}: set ${name} names an unsafe path ${rel}`);
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`${path}: set ${name} file ${rel} has no sha256`);
    }
  }
  return doc;
}

export const setDir = (name, set, root = storeRoot()) => join(root, name, set.commit);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// {ok, sets:[{name, dir, entry, relaxedRegex, ...}], problems:[]} — ok only when every pinned file
// is present with its pinned hash. ENOENT is "not installed"; any other read error is a problem too.
export function verifyStore(doc = loadPins(), root = storeRoot()) {
  const problems = [];
  const sets = [];
  for (const [name, s] of Object.entries(doc.sets)) {
    const dir = setDir(name, s, root);
    for (const [rel, want] of Object.entries(s.files)) {
      let buf;
      try { buf = readFileSync(join(dir, rel)); } catch (e) { problems.push(`${name}/${rel}: ${e.code === 'ENOENT' ? 'not installed' : `unreadable (${e.code || e.message})`}`); continue; }
      if (sha256(buf) !== want) problems.push(`${name}/${rel}: sha256 does not match the pin`);
    }
    sets.push({ name, dir, entry: s.entry, relaxedRegex: !!s.relaxedRegex, defaultSev: s.defaultSev ?? 'med', undeterminedReason: s.undeterminedReason || '',
      url: s.url, license: s.license, commit: s.commit, files: Object.keys(s.files) });
  }
  return { ok: problems.length === 0, sets, problems };
}

async function fetchBytes(url) {
  if (url.startsWith('file://')) return readFileSync(fileURLToPath(url));
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function install(doc = loadPins(), root = storeRoot()) {
  const written = [];
  for (const [name, s] of Object.entries(doc.sets)) {
    const dir = setDir(name, s, root);
    for (const [rel, want] of Object.entries(s.files)) {
      const url = `${urlBase()}/${s.repo}/${s.commit}/${s.base ? `${s.base}/` : ''}${rel}`;
      const buf = await fetchBytes(url);
      const got = sha256(buf);
      if (got !== want) throw new Error(`${name}/${rel}: fetched sha256 ${got} does not match the pin ${want} — nothing from this file was written`);
      const dest = join(dir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp-${process.pid}`;
      writeFileSync(tmp, buf);
      renameSync(tmp, dest);
      written.push(`${name}/${rel}`);
    }
  }
  return written;
}

if (isMainModule(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--install', '--check', '--where'].includes(mode)) { process.stderr.write('usage: yara-rules.mjs --install | --check | --where\n'); process.exit(2); }
  if (mode === '--where') { process.stdout.write(`${storeRoot()}\n`); process.exit(0); }
  try {
    const doc = loadPins();
    if (mode === '--install') {
      const written = await install(doc);
      process.stdout.write(`installed ${written.length} rule file(s) under ${storeRoot()}\n`);
    }
    const v = verifyStore(doc);
    if (!v.ok) { process.stderr.write(`yara rule packs not installed or not matching their pins:\n  ${v.problems.join('\n  ')}\n  run: node bin/yara-rules.mjs --install\n`); process.exit(1); }
    if (mode === '--check') process.stdout.write(`verified ${v.sets.length} rule pack(s) under ${storeRoot()}\n`);
  } catch (e) {
    process.stderr.write(`yara-rules: ${e.message}\n`);
    process.exit(1);
  }
}

// Reads manifests/llm-hosts.json — the ONE declaration of which local LLM servers this fleet talks
// to. memory-layer, admin/ and overwatch-layer all resolve a host from here instead of each hardcoding a base URL;
// before it existed, 127.0.0.1:1234 and 127.0.0.1:11434 were written into eight files across three
// repositories.
//
// Fails closed. An unreadable, unparseable or schema-invalid declaration THROWS: a host list that
// silently degrades to {} would make "no local LLM detected" indistinguishable from "the file that
// says which ones to look for is broken", and the panel already renders the first as a normal,
// unalarming state.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from './registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// Env read at CALL time, never at module load: a `const X = process.env.Y` at import silently
// defeats the override for any test that sets it afterwards, so the test passes proving nothing.
const manifestPath = () =>
  process.env.CW_LLM_HOSTS || resolve(REPO, 'manifests', 'llm-hosts.json');
const schemaPath = () =>
  process.env.CW_LLM_HOSTS_SCHEMA || resolve(REPO, 'schema', 'llm-hosts.schema.json');

let cached = null;
let cachedFrom = null;

/** The declaration, validated. Throws rather than returning a degraded default. */
export function loadLlmHosts({ force = false } = {}) {
  const path = manifestPath();
  if (!force && cached && cachedFrom === path) return cached;

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    // Only ENOENT would arguably be "legitimately absent", and it is not: this file is tracked and
    // the fleet cannot resolve a host without it. Every read failure is fatal.
    throw new Error(
      `llm-hosts: ${path} could not be read (${e.message}) — refusing to report an empty host list, ` +
        'which would render as "no local LLM detected" and read as a normal state'
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`llm-hosts: ${path} is not valid JSON (${e.message})`);
  }

  const { errors } = validateAgainstSchema(parsed, { path: schemaPath() });
  if (errors.length) {
    throw new Error(`llm-hosts: ${path} does not satisfy its schema:\n  ${errors.join('\n  ')}`);
  }

  // Referential checks the schema cannot express without $ref (which registry.mjs refuses).
  const ids = new Set(parsed.hosts.map((h) => h.id));
  if (ids.size !== parsed.hosts.length) {
    throw new Error('llm-hosts: duplicate host id — a declaration that names one host twice');
  }
  if (!ids.has(parsed.default)) {
    throw new Error(`llm-hosts: default "${parsed.default}" is not a declared host`);
  }
  const strayProbe = parsed.probeOrder.filter((id) => !ids.has(id));
  if (strayProbe.length) {
    throw new Error(
      `llm-hosts: probeOrder names ${strayProbe.join(', ')}, which no host declares — ` +
        'a probe order pointing at nothing silently shortens detection'
    );
  }

  // `portIsShared` is derivable, so it is CHECKED rather than trusted: a hand-edited false on a
  // shared port is exactly how a consumer starts naming a host its probe cannot identify.
  const byPort = new Map();
  for (const h of parsed.hosts) {
    const port = new URL(h.baseUrl).port || '80';
    byPort.set(port, (byPort.get(port) || 0) + 1);
  }
  for (const h of parsed.hosts) {
    const port = new URL(h.baseUrl).port || '80';
    const shared = byPort.get(port) > 1;
    if (shared !== h.portIsShared) {
      throw new Error(
        `llm-hosts: ${h.id} declares portIsShared=${h.portIsShared} but port ${port} is used by ` +
          `${byPort.get(port)} host(s) — the field decides whether a probe may name this host`
      );
    }
  }

  cached = Object.freeze(parsed);
  cachedFrom = path;
  return cached;
}

/** Hosts in probe order. Anything declared but not in probeOrder is returned last. */
export function hostsInProbeOrder(decl = loadLlmHosts()) {
  const by = new Map(decl.hosts.map((h) => [h.id, h]));
  const ordered = decl.probeOrder.map((id) => by.get(id));
  const rest = decl.hosts.filter((h) => !decl.probeOrder.includes(h.id));
  return [...ordered, ...rest];
}

/** Hosts that declare a capability. Declared is not probed — see the schema's note. */
export function hostsWith(capability, decl = loadLlmHosts()) {
  return decl.hosts.filter((h) => h.capabilities.includes(capability));
}

/**
 * What a successful probe of `port` is allowed to be CALLED.
 *
 * llama.cpp, llamafile, LocalAI and mlx-lm all default to 8080 and all speak the identical
 * protocol, so nothing in a response distinguishes them. Returning the first match would be naming
 * something we did not measure — an unmeasured value presented as a measurement.
 */
export function identifyByPort(port, decl = loadLlmHosts()) {
  const matches = decl.hosts.filter((h) => (new URL(h.baseUrl).port || '80') === String(port));
  if (matches.length === 0) return { id: null, label: `unknown server on :${port}`, certain: false };
  if (matches.length > 1) {
    return {
      id: null,
      label: `unidentified OpenAI-compatible server on :${port}`,
      candidates: matches.map((h) => h.id),
      certain: false,
    };
  }
  return { id: matches[0].id, label: matches[0].label, certain: true };
}

/** The env var that overrides a host's base URL, e.g. CW_LLM_URL_LMSTUDIO. */
export const urlEnvVar = (id) => `CW_LLM_URL_${id.toUpperCase().replace(/[.-]/g, '_')}`;

/**
 * Variables that meant the same thing before this file existed.
 *
 * Renaming the override to a scheme (`CW_LLM_URL_<ID>`) silently orphaned whatever the operator
 * already had exported — a shell profile, a LaunchAgent plist, a CI secret. A rename that ignores
 * the old name does not fail, it just quietly stops honouring a setting that is still there, which
 * is the worst of the three possible outcomes. Honour both; prefer the new one.
 */
const LEGACY_ENV = { lmstudio: 'CW_LMSTUDIO_URL' };

/** A host's base URL, honouring its override. Read at call time. */
export function baseUrlFor(id, decl = loadLlmHosts()) {
  const host = decl.hosts.find((h) => h.id === id);
  if (!host) throw new Error(`llm-hosts: no declared host "${id}"`);
  const legacy = LEGACY_ENV[id] ? process.env[LEGACY_ENV[id]] : undefined;
  return process.env[urlEnvVar(id)] || legacy || host.baseUrl;
}

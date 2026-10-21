// safe-parse.mjs — payload-shape hardening for the artifact parsers (self-security lens). Scanners emit
// SARIF/JSON that a MALICIOUS scanned repo can SHAPE to attack the parser: prototype pollution via a
// __proto__/constructor key, path traversal via a finding's `file` field, or unbounded nesting/size to
// exhaust the process. extractors.mjs takes these bare (JSON.parse(readFileSync(...))); this is the guard
// it adopts. Fail closed: a hostile shape is a REJECTION, never a silent parse into a polluted object.
//
// fact: JSON.parse defines own properties (it does not invoke the __proto__ setter), so it does not
// pollute by itself — the pollution lands when a DOWNSTREAM merge/assign copies a "__proto__" key onto a
// live-proto object. So we refuse the key at the source AND return null-proto objects, defence in depth.
// fact: a finding's path is CONTAINED to a root — a ../ escape is refused, never resolved.

import { resolve, relative, isAbsolute } from 'node:path';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Parse untrusted JSON: refuse pollution keys, strip the prototype chain, bound size and nesting.
export function safeParse(text, { maxBytes = 32 * 1024 * 1024, maxDepth = 200 } = {}) {
  if (typeof text !== 'string') throw new Error('safeParse: input is not a string');
  if (text.length > maxBytes) throw new Error(`safeParse: input ${text.length}B exceeds ${maxBytes}B bound — refusing`);
  // cheap structural depth bound before parse — a billion-laughs-style nest never reaches JSON.parse.
  let run = 0, maxSeen = 0;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '{' || c === '[') { if (++run > maxSeen) maxSeen = run; } else if (c === '}' || c === ']') run--; }
  if (maxSeen > maxDepth) throw new Error(`safeParse: nesting depth ${maxSeen} exceeds ${maxDepth} — refusing`);
  return JSON.parse(text, (key, value) => {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`safeParse: forbidden key ${JSON.stringify(key)} — refusing a prototype-pollution shape`);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const clean = Object.create(null); // null proto — nothing downstream can pollute through it
      for (const k of Object.keys(value)) clean[k] = value[k];
      return clean;
    }
    return value;
  });
}

// safeParseFile — same, from a path. ENOENT is the caller's to distinguish (legitimately absent);
// a hostile shape throws with its reason, never returns a partial.
import { readFileSync } from 'node:fs';
export function safeParseFile(p, opts) { return safeParse(readFileSync(p, 'utf8'), opts); }

// Contain a path to a root — a finding's `file` field that escapes with ../ is refused, never resolved.
export function containPath(p, root) {
  if (typeof p !== 'string' || !p) return { ok: false, why: 'empty path' };
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(resolve(root), abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, why: `path escapes root: ${JSON.stringify(p)}` };
  return { ok: true, path: abs, rel };
}

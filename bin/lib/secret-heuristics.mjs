// contract: secret-candidate heuristics, sweep and pattern-core
// ── placeholder detection ───────────────────────────────────────────────────────────────────
// Applied ONLY to credential material.
const PLACEHOLDER_RE = [
  /example/i, /placeholder/i, /redacted/i, /dummy/i, /sample/i, /changeme/i, /^your[_-]/i,
  /xxxx+/i, /^<.*>$/, /\$\{/, /^\$[A-Z_]{2,}$/, /\bfake\b/i, /^abc123/i, /deadbeef/i,
  /^0+$/, /^(?:1234567890)+/, /notarealkey/i, /^[A-Za-z]+$/,
  // Hyphen/underscore-joined words: prose in the shape of a credential (documentation examples).
  /^[A-Za-z]+(?:[-_][A-Za-z]+)+$/,
  // RFC 4648 alphabets — constants in base32/base64 code, maximum entropy by construction.
  /^ABCDEFGHIJKLMNOPQRSTUVWXYZ(?:234567|abcdef)/,
  /^0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/,   // base36, in monitor/cwx-registry.mjs
];

// A long camelCase identifier is not a key: segment on non-letters and case boundaries; three or
// more fragments that are ≥3 chars and contain a vowel is prose. Applied to the longest
// delimiter-free segment, not the whole run (`sk-ant-api03-<key>` would read as a name).
export function looksLikeIdentifier(run) {
  const words = String(run)
    .split(/[^A-Za-z]+/)
    .flatMap((s) => s.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .filter((s) => s.length >= 3 && /[aeiou]/i.test(s));
  return words.length >= 3;
}
export const isPlaceholder = (secret) => {
  const s = String(secret ?? '');
  if (!s) return true;
  return PLACEHOLDER_RE.some((re) => re.test(s));
};

// ── entropy ─────────────────────────────────────────────────────────────────────────────────
export function shannon(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// 40-hex is a commit SHA and 64-hex a sha256 — this tree is dense with both.
export const isRepoDigest = (s) => /^[0-9a-f]{40}$/i.test(s) || /^[0-9a-f]{64}$/i.test(s);

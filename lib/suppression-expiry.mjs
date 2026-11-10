// lib/suppression-expiry.mjs — buckets suppressions by when they lapse. Identity is
// repo/file/rule/package and never a line number. A suppression with no expiry is undated, not active.

import { isoInstant as instant } from './iso-instant.mjs';

const DAY_MS = 86_400_000;

function text(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

const IDENTITY = ['repo', 'file', 'rule', 'package'];
const byIdentity = (a, b) => {
  for (const f of IDENTITY) {
    const x = a[f] ?? '';
    const y = b[f] ?? '';
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

export function suppressionExpiry({ suppressions, now, windowDays = 14 } = {}) {
  if (!Array.isArray(suppressions)) throw new TypeError('suppressions must be an array');
  const nowMs = instant(now, 'now');
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new TypeError('windowDays must be a positive integer');
  const horizon = nowMs + windowDays * DAY_MS;

  const seen = new Set();
  const out = { active: [], expiringSoon: [], expired: [], undated: [] };
  for (const [i, s] of suppressions.entries()) {
    if (!s || typeof s !== 'object') throw new TypeError(`suppressions[${i}] must be an object`);
    const at = `suppressions[${i}]`;
    const row = {
      repo: text(s.repo, `${at}.repo`),
      file: text(s.file, `${at}.file`),
      rule: text(s.rule, `${at}.rule`),
      package: s.package == null ? null : text(s.package, `${at}.package`),
      reason: text(s.reason, `${at}.reason`),
      createdAt: s.createdAt,
      expiresAt: s.expiresAt ?? null,
    };
    const createdMs = instant(s.createdAt, `${at}.createdAt`);
    const key = JSON.stringify(IDENTITY.map((f) => row[f]));
    if (seen.has(key)) throw new Error(`duplicate suppression identity: ${key}`);
    seen.add(key);

    if (row.expiresAt === null) { out.undated.push(row); continue; }
    const expiresMs = instant(row.expiresAt, `${at}.expiresAt`);
    if (expiresMs < createdMs) throw new RangeError(`${at}.expiresAt is before createdAt`);
    if (expiresMs <= nowMs) out.expired.push(row);
    else if (expiresMs <= horizon) out.expiringSoon.push(row);
    else out.active.push(row);
  }
  for (const list of Object.values(out)) list.sort(byIdentity);
  return out;
}

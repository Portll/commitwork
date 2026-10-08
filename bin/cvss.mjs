// bin/cvss.mjs — CVSS base score from a vector string.
//
// v2.0 + v3.0/v3.1. v4 → null: lookup table, not a formula (advisory-index vendors GitHub's score).
// Unreadable input → null, never a sentinel.

const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC = { L: 0.77, H: 0.44 };
const UI = { N: 0.85, R: 0.62 };
const CIA = { H: 0.56, L: 0.22, N: 0 };
// PR depends on Scope: H is 0.27 unchanged, 0.50 changed.
const PR = { U: { N: 0.85, L: 0.62, H: 0.27 }, C: { N: 0.85, L: 0.68, H: 0.5 } };

// v2 weights; Au and the P/C impact letters exist only in v2.
const V2 = {
  AV: { L: 0.395, A: 0.646, N: 1.0 },
  AC: { H: 0.35, M: 0.61, L: 0.71 },
  Au: { M: 0.45, S: 0.56, N: 0.704 },
  CIA: { N: 0.0, P: 0.275, C: 0.66 },
};
// v2 carries no version prefix; `Au` disambiguates it, v3 has no such metric.
const V2_SHAPE = /^AV:[LAN]\/AC:[HML]\/Au:[MSN]\//;

const fields = (str, from) => {
  const metrics = {};
  for (const part of str.split('/').slice(from)) {
    const i = part.indexOf(':');
    if (i > 0) metrics[part.slice(0, i)] = part.slice(i + 1);
  }
  return metrics;
};

/** `CVSS:3.1/AV:N/...` or a bare v2 `AV:N/AC:M/Au:N/...` → {version, metrics}; null if neither. */
export function parseVector(s) {
  const str = String(s || '').trim();
  const head = str.match(/^CVSS:(\d+\.\d+)\//);
  if (head) return { version: head[1], metrics: fields(str, 1) };
  if (V2_SHAPE.test(str)) return { version: '2.0', metrics: fields(str, 0) };
  return null;
}

// v3.1 rounds up in integer space; v3.0's plain ceil disagrees on floats that land fractionally low.
const roundUp31 = (x) => {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
};

// v2: own scales, flat rounding — no roundUp.
function baseScoreV2(m) {
  const w = [V2.AV[m.AV], V2.AC[m.AC], V2.Au[m.Au], V2.CIA[m.C], V2.CIA[m.I], V2.CIA[m.A]];
  if (w.some((x) => x === undefined)) return null;
  const [av, ac, au, c, i, a] = w;
  const impact = 10.41 * (1 - (1 - c) * (1 - i) * (1 - a));
  const exploitability = 20 * av * ac * au;
  const f = impact === 0 ? 0 : 1.176;
  return Math.round((0.6 * impact + 0.4 * exploitability - 1.5) * f * 10) / 10;
}

/** Base score, or null if the vector is absent, malformed, or a version this cannot score. */
export function baseScore(vector) {
  const p = parseVector(vector);
  if (!p) return null;
  if (p.version === '2.0') return baseScoreV2(p.metrics);
  if (p.version !== '3.0' && p.version !== '3.1') return null;
  const m = p.metrics;
  const s = m.S;
  if (s !== 'U' && s !== 'C') return null;
  const w = [AV[m.AV], AC[m.AC], UI[m.UI], PR[s][m.PR], CIA[m.C], CIA[m.I], CIA[m.A]];
  if (w.some((x) => x === undefined)) return null;
  const [av, ac, ui, pr, c, i, a] = w;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = s === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = Math.min(s === 'U' ? impact + exploitability : 1.08 * (impact + exploitability), 10);
  return p.version === '3.1' ? roundUp31(raw) : Math.ceil(raw * 10) / 10;
}

/** FIRST's scale. v2 ceils at `high` — it has no critical band. 0.0 is `none`, which is not unknown. */
export function band(score, version = '3.1') {
  if (score === null || score === undefined || Number.isNaN(score)) return '';
  if (score >= 9 && !String(version).startsWith('2')) return 'crit';
  if (score >= 7) return 'high';
  if (score >= 4) return 'med';
  if (score > 0) return 'low';
  return 'none';
}

/** The declared version, so a caller bands on the right scale. */
export const versionOf = (vector) => (parseVector(vector) || {}).version || '';

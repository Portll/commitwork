#!/usr/bin/env node
// yarn-audit — npm-audit-shaped (v2 JSON) advisory report for yarn.lock repos, so downstream
// parsers consume it unchanged. Reads the exact versions yarn.lock pins — never re-resolves.
// yarn v1 locks only: a berry lock parses to zero packages and exits as an error, never clean.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

const BULK = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const CHUNK = 400;

/** Parse a yarn v1 lockfile into { name: Set<version> }. */
export function parseYarnLock(text) {
  const pkgs = new Map();
  let current = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.startsWith('#')) continue;
    if (!raw.startsWith(' ')) {
      // Header line: `"a@^1", "a@^2":` — one entry may satisfy several ranges of one package.
      current = [];
      for (let part of raw.replace(/:\s*$/, '').split(', ')) {
        part = part.trim().replace(/^"|"$/g, '');
        // Scoped names start with '@', so search for the separator AFTER index 0.
        const at = part.lastIndexOf('@');
        if (at > 0) current.push(part.slice(0, at));
      }
    } else if (/^\s+version\s/.test(raw)) {
      const v = raw.trim().slice('version'.length).trim().replace(/^"|"$/g, '');
      for (const n of current) {
        if (!pkgs.has(n)) pkgs.set(n, new Set());
        pkgs.get(n).add(v);
      }
    }
  }
  return pkgs;
}

async function bulkQuery(payload) {
  const entries = Object.entries(payload);
  const merged = {};
  for (let i = 0; i < entries.length; i += CHUNK) {
    const body = Object.fromEntries(entries.slice(i, i + CHUNK));
    const res = await fetch(BULK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`advisory endpoint ${res.status} ${res.statusText}`);
    Object.assign(merged, await res.json());
  }
  return merged;
}

const SEVS = ['info', 'low', 'moderate', 'high', 'critical'];
const rank = (s) => SEVS.indexOf(String(s || 'low').toLowerCase());

/** Shape advisories into npm audit v2 JSON. */
export function toNpmAudit(advisories, locked, directDeps) {
  const vulnerabilities = {};
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const [name, items] of Object.entries(advisories)) {
    if (!items?.length) continue;
    let worst = 'low';
    const via = items.map((a) => {
      if (rank(a.severity) > rank(worst)) worst = String(a.severity).toLowerCase();
      return {
        source: a.id ?? a.github_advisory_id ?? name,
        name,
        dependency: name,
        title: a.title || '',
        url: a.url || '',
        severity: String(a.severity || '').toLowerCase(),
        cwe: a.cwe || [],
        cvss: { score: a.cvss?.score ?? 0, vectorString: a.cvss?.vectorString ?? null },
        range: a.vulnerable_versions || '',
      };
    });
    counts[worst] = (counts[worst] ?? 0) + 1;
    counts.total++;
    vulnerabilities[name] = {
      name,
      severity: worst,
      isDirect: directDeps.has(name),
      via,
      effects: [],
      // The exact pinned version(s) — the whole point of reading yarn.lock rather than re-resolving.
      range: [...(locked.get(name) ?? [])].join(' || '),
      nodes: [`node_modules/${name}`],
      // Deliberately false — this tool never computes the resolvable upgrade
      fixAvailable: false,
    };
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: counts,
      dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: locked.size },
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const repo = args.find((a) => !a.startsWith('-')) ?? process.env.COMMITWORK_REPO ?? process.cwd();
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : join(process.env.CW_REPORT_DIR || '.', 'npm-audit.json');

  const lockPath = join(repo, 'yarn.lock');
  if (!existsSync(lockPath)) {
    console.error(`yarn-audit: no yarn.lock at ${lockPath}`);
    process.exit(2);
  }
  const locked = parseYarnLock(readFileSync(lockPath, 'utf8'));
  if (locked.size === 0) {
    // A husk is not a clean scan
    console.error('yarn-audit: parsed 0 packages (yarn berry/v2 lockfiles are not supported)');
    process.exit(2);
  }

  // Workspace roots declare almost nothing themselves — union root deps with every workspace's.
  const direct = new Set();
  const addDeps = (file) => {
    if (!existsSync(file)) return null;
    try {
      const pj = JSON.parse(readFileSync(file, 'utf8'));
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const d of Object.keys(pj[k] || {})) direct.add(d);
      }
      return pj;
    } catch { return null; } // a malformed package.json only costs the isDirect flag
  };
  const root = addDeps(join(repo, 'package.json'));
  const globs = Array.isArray(root?.workspaces) ? root.workspaces : (root?.workspaces?.packages ?? []);
  for (const g of globs) {
    // Only `dir/*` and plain `dir` forms; a missed glob costs a flag, not a finding.
    const base = g.endsWith('/*') ? g.slice(0, -2) : g;
    const baseDir = join(repo, base);
    if (!existsSync(baseDir)) continue;
    if (g.endsWith('/*')) {
      for (const e of readdirSync(baseDir, { withFileTypes: true })) {
        if (e.isDirectory()) addDeps(join(baseDir, e.name, 'package.json'));
      }
    } else {
      addDeps(join(baseDir, 'package.json'));
    }
  }

  const payload = Object.fromEntries([...locked].map(([n, v]) => [n, [...v].sort()]));
  const advisories = await bulkQuery(payload);
  const report = toNpmAudit(advisories, locked, direct);

  writeFileSync(out, JSON.stringify(report, null, 2));
  const c = report.metadata.vulnerabilities;
  console.error(
    `yarn-audit: ${locked.size} locked packages, ${c.total} vulnerable ` +
    `(crit ${c.critical}, high ${c.high}, moderate ${c.moderate}, low ${c.low}) -> ${out}`,
  );
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(`yarn-audit: ${e.message}`); process.exit(1); });
}

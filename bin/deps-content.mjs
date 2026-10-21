#!/usr/bin/env node
// usage: node bin/deps-content.mjs [rootDir]
// env, read at call time: CW_DEPS_LOCKFILE (lockfile path), CW_DEPS_INSTALL_SCRIPTS=1 (audit-list benign hooks)
// exit: 0 ran (an absent lockfile is a declared void, filesScanned 0) · 2 could not run (unparseable or v1 lockfile)
// output: {tool, summary:{findings, byRule, filesScanned, packagesChecked, lockfile, ...void flags}, findings:[{rule, path, sev, cwe, detail}]}
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

export const RULE_CWE = Object.freeze({
  'dep-install-exec': 'CWE-829',
  'dep-install-script': 'CWE-829',
  'dep-missing-integrity': 'CWE-494',
  'dep-weak-integrity': 'CWE-494',
  'dep-version-drift': 'CWE-1357',
});
export const RULE_SEV = Object.freeze({
  'dep-install-exec': 'high',
  'dep-install-script': 'low',
  'dep-missing-integrity': 'med',
  'dep-weak-integrity': 'low',
  'dep-version-drift': 'high',
});

const DANGEROUS_CMD = /curl|wget|\bnc\b|base64|eval|node\s+-e|python\s+-c|\|\s*(?:sh|bash)|>\s*\/dev\/|chmod\s+\+x|\/dev\/tcp/i;
const HOOKS = ['preinstall', 'install', 'postinstall'];

function readJSON(p) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) { return { err: e }; }
  try { return { value: JSON.parse(raw) }; } catch (e) { return { err: e }; }
}

export function scan(rootDir, env = process.env) {
  const root = resolve(rootDir || '.');
  const lockPath = env.CW_DEPS_LOCKFILE || join(root, 'package-lock.json');
  const rel = lockPath.startsWith(`${root}/`) ? lockPath.slice(root.length + 1) : lockPath;
  const base = { tool: 'deps-content', summary: { findings: 0, byRule: {}, filesScanned: 0, packagesChecked: 0, lockfile: rel }, findings: [] };

  const lock = readJSON(lockPath);
  if (lock.err && lock.err.code === 'ENOENT') {
    base.summary.lockfile = 'absent';
    base.summary.noLockfile = true;
    return { report: base, exit: 0 };
  }
  if (lock.err) {
    base.summary.unparseable = true;
    base.summary.couldNotRun = `lockfile unreadable or not JSON (${lock.err.code || lock.err.name})`;
    return { report: base, exit: 2 };
  }
  const packages = lock.value && lock.value.packages;
  if (!packages || typeof packages !== 'object') {
    base.summary.unsupportedLockfile = `lockfileVersion ${lock.value && lock.value.lockfileVersion} — need packages[] (v2/v3)`;
    base.summary.couldNotRun = base.summary.unsupportedLockfile;
    return { report: base, exit: 2 };
  }

  const auditScripts = env.CW_DEPS_INSTALL_SCRIPTS === '1';
  const findings = [];
  const add = (rule, path, detail) => findings.push({ rule, path, sev: RULE_SEV[rule], cwe: RULE_CWE[rule], detail });
  let packagesChecked = 0;
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith('node_modules/') || !entry || typeof entry !== 'object') continue;
    packagesChecked++;
    const { version: locked, resolved, integrity } = entry;

    if (resolved && /^https?:/.test(resolved) && !integrity) add('dep-missing-integrity', key, 'registry-resolved, no integrity hash');
    else if (integrity && /^sha1-/.test(String(integrity))) add('dep-weak-integrity', key, 'integrity is sha1, not sha512');

    let pkg = null;
    if (locked || entry.hasInstallScript) {
      const r = readJSON(join(root, key, 'package.json'));
      pkg = r.value && typeof r.value === 'object' ? r.value : null;
    }
    if (locked && pkg && pkg.version && pkg.version !== locked) add('dep-version-drift', key, `installed ${pkg.version} ≠ locked ${locked}`);

    if (entry.hasInstallScript) {
      const scripts = (pkg && pkg.scripts) || {};
      const declared = HOOKS.filter((h) => scripts[h]);
      const dangerous = declared.filter((h) => DANGEROUS_CMD.test(String(scripts[h])));
      if (dangerous.length) add('dep-install-exec', key, `install hook fetches/execs (${dangerous.join('/')})`);
      else if (auditScripts) add('dep-install-script', key, declared.length ? `hooks: ${declared.join('/')}` : 'declared in lockfile (script body not on disk)');
    }
  }

  findings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule) || a.detail.localeCompare(b.detail));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  base.summary = { findings: findings.length, byRule, filesScanned: packagesChecked + 1, packagesChecked, lockfile: rel };
  base.findings = findings;
  return { report: base, exit: 0 };
}

if (isMainModule(import.meta.url)) {
  const { report, exit } = scan(process.argv[2]);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(exit);
}

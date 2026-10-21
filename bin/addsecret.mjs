#!/usr/bin/env node
// bin/addsecret.mjs — the short form of `secrets set`, scoped to a project.
//
// usage:
//   addsecret <NAME>                  scope inferred from the cwd's git root
//   addsecret <project> <NAME>        explicit project
//   addsecret --global <NAME>         fleet-wide, no project
//
// The value is never an argument — `security` prompts for it, so it never reaches argv, env,
// shell history, or this process.

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { basename, resolve } from 'node:path';
import { parseRef, resolveRef, setRef, defaultRefFor, SECRETS_FILE } from '../lib/secrets.mjs';

const argv = process.argv.slice(2);
const wantGlobal = argv.includes('--global');
const pos = argv.filter((a) => !a.startsWith('--'));

function projectFromCwd() {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return root ? basename(resolve(root)) : null;
  } catch { return null; }
}

let project = null, name = null;
if (pos.length >= 2) { [project, name] = pos; }
else if (pos.length === 1) { name = pos[0]; project = wantGlobal ? null : projectFromCwd(); }

if (!name) {
  console.error('usage: addsecret <NAME> | addsecret <project> <NAME> | addsecret --global <NAME>');
  console.error('');
  console.error('The VALUE is never an argument — `security` prompts for it, so it cannot appear in');
  console.error('`ps` output or your shell history. Pipe it in for automation if you must.');
  process.exit(2);
}
if (wantGlobal) project = null;
if (platform() !== 'darwin') {
  console.error(`addsecret: the keychain backend needs macOS (this is ${platform()})`);
  process.exit(2);
}

// Dot, not colon — ':' is REF_RE's backend delimiter and cannot appear in a service.
const safeProject = project ? String(project).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40) : null;
const service = safeProject ? `commitwork.${safeProject}` : 'commitwork';
const ref = defaultRefFor(name, service);
const { service: svc, account } = parseRef(ref);

console.log(`${name} → ${svc}/${account}`);
console.log(safeProject ? `scope: project ${safeProject}` : 'scope: GLOBAL (fleet-wide)');
console.log('`security` will prompt — the value is typed into it, never passed as an argument.\n');

try {
  execFileSync('security', ['add-generic-password', '-a', account, '-s', svc, '-U', '-w'], { stdio: 'inherit' });
} catch (e) {
  console.error(`\naddsecret: security exited ${e.status ?? '?'} — nothing was recorded.`);
  process.exit(1);
}

// Verify readback before recording — an unresolvable ref is a false green.
const probe = resolveRef(ref);
if (!probe.ok) {
  console.error(`\naddsecret: stored, but it does not read back (${probe.reason}: ${probe.detail}).`);
  console.error('The ref was NOT recorded.');
  process.exit(1);
}

const out = setRef(name, ref, { file: SECRETS_FILE });
console.log(`\n✓ ${name} → ${ref}`);
console.log(`  recorded in ${out.file} · verified readable · value not shown`);

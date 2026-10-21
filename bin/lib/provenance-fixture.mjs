// A synthetic commit history, DESCRIBED in JSON and materialised into a temporary git repository.
// fixtures/scan-canary cannot carry a nested .git, so the provenance canary is a description the
// tests turn into real commits with real author/committer identities and a real --no-ff merge.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const who = (p) => ({ name: String((p && p.name) || 'Nobody Example'), email: String((p && p.email) || 'nobody@example.test') });

function run(dir, args, env, ident) {
  const r = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      ...(ident ? {
        GIT_AUTHOR_NAME: ident.author.name, GIT_AUTHOR_EMAIL: ident.author.email,
        GIT_COMMITTER_NAME: ident.committer.name, GIT_COMMITTER_EMAIL: ident.committer.email,
        GIT_AUTHOR_DATE: ident.date, GIT_COMMITTER_DATE: ident.date,
      } : {}),
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  return r.stdout.trim();
}

/** Materialise `spec` (an object or a path to its JSON) into `dir` (default: a fresh temp dir). */
export function materialiseHistory(spec, dir) {
  const s = typeof spec === 'string' ? JSON.parse(readFileSync(spec, 'utf8')) : spec;
  const out = dir || mkdtempSync(join(tmpdir(), 'cw-provenance-'));
  const env = process.env;
  const branch = s.defaultBranch || 'main';
  run(out, ['init', '-q', '-b', branch], env);
  const shas = {};
  let current = branch;
  const checkout = (b) => { if (b !== current) { run(out, ['checkout', '-q', b], env); current = b; } };
  let n = 0;
  for (const step of s.steps || []) {
    n += 1;
    const date = `2026-01-01T00:${String(n).padStart(2, '0')}:00Z`;
    const ident = { author: who(step.author), committer: who(step.committer || step.author), date };
    if (step.op === 'branch') { run(out, ['branch', step.name, step.from || branch], env); continue; }
    if (step.op === 'commit') {
      checkout(step.branch || branch);
      writeFileSync(join(out, `f${n}.txt`), `${step.id || n}\n`);
      run(out, ['add', '-A'], env);
      run(out, ['commit', '-q', '-m', step.message || `step ${n}`, ...(step.body ? ['-m', step.body] : [])], env, ident);
    } else if (step.op === 'merge') {
      checkout(step.into || branch);
      run(out, ['merge', '--no-ff', '--no-edit', '-m', step.message || `merge ${step.from}`, ...(step.body ? ['-m', step.body] : []), step.from], env, ident);
    } else throw new Error(`unknown fixture op '${step.op}'`);
    if (step.id) shas[step.id] = run(out, ['rev-parse', 'HEAD'], env);
  }
  checkout(branch);
  return { dir: out, shas, spec: s };
}

/** The branch-protection manifest a spec declares, written beside the repo. Null when the spec declares none. */
export function writeProtectionManifest(spec, dir) {
  const bp = spec.branchProtection;
  if (!bp) return null;
  const p = join(dir, 'branch-protection.json');
  writeFileSync(p, `${JSON.stringify({ repos: [{ repo: spec.repo, branch: spec.defaultBranch || 'main', requiredChecks: [], requireSigned: bp.requireSigned === true }] }, null, 2)}\n`);
  return p;
}

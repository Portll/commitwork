// monitor/draft-pr-go.mjs — the Go toolchain acts behind remediation-draft-pr, run in the scratch
// clone: probe the advisory before the change, apply the bump, then build and probe again. Results
// are read from govulncheck's JSON, never from its exit status alone (see upstream-probe.mjs).
import { spawnSync } from 'node:child_process';
import { interpretGovulncheck, parseConcatJson } from './upstream-probe.mjs';
import { bumpSpec } from './remediation-pr.mjs';

const LIMITS = { timeout: 900_000, maxBuffer: 256 * 1024 * 1024 };
const VULNCHECK = ['govulncheck', '-format', 'json', './...'];
const shown = (argv) => argv.join(' ');

function run(argv, dir, env) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...LIMITS });
  if (r.error) return { status: null, stdout: '', stderr: `${argv[0]} could not be run (${r.error.code || r.error.message})` };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** The call path govulncheck traced to `id`, entry point first. */
export function traceFor(stdout, id) {
  const f = parseConcatJson(stdout || '').map((o) => o?.finding)
    .find((x) => x && x.osv === id && Array.isArray(x.trace) && x.trace.some((t) => t?.function));
  if (!f) return [];
  return f.trace.filter((t) => t?.function).map((t) => `${t.package || t.module}.${t.receiver ? `(${t.receiver}).` : ''}${t.function}`).reverse().slice(0, 8);
}

const version = (mod, dir, env) => {
  const r = run(['go', 'list', '-m', '-f', '{{.Version}}', mod], dir, env);
  return r.status === 0 ? r.stdout.trim() : '';
};
const lastLine = (s) => String(s || '').trim().split('\n').at(-1) || '';

export function goSeams(env) {
  return {
    /** -> { fixed, reason, trace } before the change */
    probe(adv, dir) {
      const r = run(VULNCHECK, dir, env);
      return { ...interpretGovulncheck(adv.id, r), trace: traceFor(r.stdout, adv.id) };
    },
    /** go get the bump and tidy -> { ok, versions, steps, reason? } */
    apply(adv, dir) {
      const mods = [...new Set([adv.bump?.module, adv.package].filter(Boolean))];
      const before = Object.fromEntries(mods.map((m) => [m, version(m, dir, env)]));
      const steps = [];
      for (const argv of [['go', 'get', bumpSpec(adv)], ['go', 'mod', 'tidy']]) {
        const r = run(argv, dir, env);
        steps.push({ cmd: shown(argv), status: r.status, result: r.status === 0 ? 'applied' : lastLine(r.stderr) || 'failed' });
        if (r.status !== 0) return { ok: false, steps, reason: `${shown(argv)} exited ${r.status}` };
      }
      const versions = mods.map((m) => ({ module: m, before: before[m], after: version(m, dir, env) }));
      return { ok: true, versions, steps };
    },
    /** go build, then govulncheck must analyse and no longer report the advisory -> { ok, steps, reason? } */
    verify(adv, dir) {
      const build = run(['go', 'build', './...'], dir, env);
      const steps = [{ cmd: 'go build ./...', status: build.status, result: build.status === 0 ? 'passed' : lastLine(build.stderr) || 'failed' }];
      if (build.status !== 0) return { ok: false, steps, reason: 'build-failed' };
      const scan = run(VULNCHECK, dir, env);
      const v = interpretGovulncheck(adv.id, scan);
      const ok = v.fixed === true;
      steps.push({ cmd: shown(VULNCHECK), status: scan.status, result: ok ? `${adv.id} no longer reported (analysis complete)` : `${adv.id} not cleared (${v.reason})` });
      return ok ? { ok, steps } : { ok, steps, reason: `advisory-check-failed:${v.reason}` };
    },
  };
}

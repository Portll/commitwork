#!/usr/bin/env node
// Emit the docker flags for a sandboxed run, so shell lanes and JSON manifests share ONE isolation
// definition with the Node callers instead of hand-rolling their own.
//
//   docker run $(node bin/sandbox.mjs --posture analyse --name cw-osv \
//                  --mount-source "$PWD:/src") image cmd
//
// It prints flags and nothing else; it never runs docker. Refusals exit 2 with the reason on
// stderr, so a lane that asks for an isolation level this file will not grant fails loudly rather
// than falling back to a weaker one.
//
// This is a thin shell over bin/lib/sandbox.mjs and MUST stay one: a CLI that re-derives what the
// library already computes can print flags the library would not emit, and
// bin/test/sandbox.test.mjs asserts the two agree.
//
// env, read at call time: CW_CHECK (the check being run, read for its cost class when --check is absent), CW_CONTAINER_OWNER (the owning run, <pid>.<start ms>), CW_PERF_PROFILES (the perf document the cost class is read from)

import { buildSandbox, shellQuote, POSTURES } from './lib/sandbox.mjs';
import { coresFor } from '../monitor/perf-tuning.mjs';

const argv = process.argv.slice(2);
const takeAll = (flag) => argv.reduce((acc, a, i) => (a === flag ? [...acc, argv[i + 1]] : acc), []);
const take = (flag) => { const i = argv.indexOf(flag); return i > -1 ? argv[i + 1] : undefined; };

// `--check` over CW_CHECK, which bin/commitwork.mjs sets for every lane it runs, so a manifest
// command inherits its own cost class without naming it twice.
function cpusFor() {
  const explicit = Number(take('--cpus'));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const check = take('--check') || process.env.CW_CHECK || '';
  if (!check) return undefined;
  try { return coresFor(check) ?? undefined; }
  catch { return undefined; }   // an unreadable perf document is an unknown bound, not a bound of 0
}

if (argv.includes('--help') || !argv.length) {
  console.log(`usage: sandbox.mjs --posture <${Object.keys(POSTURES).join('|')}> --name <container> [options]

  --mount <host:path[:ro|rw]>    a non-source mount (defaults to ro)
  --mount-source <host:path>     the repo tree; postures that allow egress refuse it
  --env <K=V>                    passed through to the container
  --memory <2g> --pids-limit <N> override the posture floor
  --cpus <N>                     CPU bound in cores; defaults to the cost class of --check
  --check <id>                   the check being run (else CW_CHECK), read for its cost class
  --allow-network                open egress on a network:none posture — LOUD, prints a warning
  --keep-container               omit --rm; the container must outlive the invoking script
  --egress-proxy <url>           REQUIRED by build-resolve; bounds what repo build logic can reach
  --egress-network <name>        REQUIRED by build-resolve; the private docker network to join
  --json                         emit the raw argument array instead of a shell string

postures:
${Object.entries(POSTURES).map(([k, v]) => `  ${k.padEnd(11)}${v.why}`).join('\n')}`);
  process.exit(0);
}

const parseMount = (raw, source) => {
  const parts = String(raw ?? '').split(':');
  if (parts.length < 2) {
    console.error(`[sandbox] --mount${source ? '-source' : ''} ${JSON.stringify(raw)} is not host:path[:mode]`);
    process.exit(2);
  }
  const mode = parts.length > 2 ? parts[parts.length - 1] : 'ro';
  const path = parts.length > 2 ? parts.slice(1, -1).join(':') : parts[1];
  return { host: parts[0], path, mode, source };
};

try {
  const { args, warnings } = buildSandbox({
    posture: take('--posture'),
    name: take('--name'),
    mounts: [
      ...takeAll('--mount').map((m) => parseMount(m, false)),
      ...takeAll('--mount-source').map((m) => parseMount(m, true)),
    ],
    env: Object.fromEntries(takeAll('--env').map((e) => {
      const i = String(e ?? '').indexOf('=');
      return i > 0 ? [e.slice(0, i), e.slice(i + 1)] : [e, ''];
    })),
    memory: take('--memory'),
    // The CPU bound is DERIVED, never defaulted to a number nobody declared: an explicit --cpus
    // wins, else the cost class of the check being run. Read at call time, and an unreadable perf
    // document leaves the bound unknown — which buildSandbox says out loud rather than inventing.
    cpus: cpusFor(),
    pidsLimit: take('--pids-limit') ? Number(take('--pids-limit')) : undefined,
    allowNetwork: argv.includes('--allow-network'),
    keepContainer: argv.includes('--keep-container'),
    egressProxy: take('--egress-proxy'),
    egressNetwork: take('--egress-network'),
    // Set by bin/commitwork.mjs for every lane it runs; the lane's shell passes it through to here.
    owner: process.env.CW_CONTAINER_OWNER || null,
  });
  for (const w of warnings) console.error(`[sandbox] ${w}`);
  console.log(argv.includes('--json') ? JSON.stringify(args) : shellQuote(args));
} catch (e) {
  console.error(`[sandbox] ${e.message}`);
  process.exit(2);
}

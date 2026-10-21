#!/usr/bin/env node
// commitwork — scanner trust preflight, and the nightly refresh that keeps it green.
//
// A vulnerability scanner is only as good as the database behind it and the build in front of it,
// and BOTH fail silently. This checks the two things a sweep cannot afford to assume:
//
//   1. THE BUILD IDENTIFIES ITSELF. A scanner reporting v0.0.0 / (devel) / unknown is refused.
//      Not because the number is old — because it is ABSENT, and a tool that cannot say what it is
//      cannot be held to what it found. Homebrew's govulncheck, for one, reports
//      `govulncheck@v0.0.0`: its formula builds from a source TARBALL, which carries no .git and no
//      module resolution, so Go stamps `(devel)`. -ldflags cannot fix it: govulncheck reads
//      runtime/debug.ReadBuildInfo(), not a linker variable, so only `go install module@version`
//      (or a tagged clone) yields a version.
//
//      Version-absence and toolchain-age are two independent defects. A Go scanner BUILT WITH an
//      older toolchain than a module requires cannot type-check that module whatever its stamp
//      says, and that is checked separately below.
//
//      The refusal rests on one ground: an unidentifiable build gives an UNFALSIFIABLE ZERO. If the
//      tool cannot say which build produced a result, nobody can say which advisories that result
//      was checked against.
//
//   2. THE VULNERABILITY DATA IS FRESH. A scanner with a stale database returns zero for
//      vulnerabilities disclosed since it last synced, and that zero is indistinguishable from a
//      real one. Staleness is reported per tool, with a max age, in the same explicit uncertainty spirit
//      as every other absence in this repo.
//
// usage: scanner-preflight.mjs            check and report (exit 1 if any scanner is UNTRUSTED)
//        scanner-preflight.mjs --update   refresh databases + re-install unstamped Go tools first
//        scanner-preflight.mjs --json     machine-readable
//
// Intended to run BEFORE the nightly sweep, so the pass is made with current data rather than
// whatever happened to be on disk.

import { spawnSync } from 'node:child_process';
import { safeSpawnSync, resolveWindowsExecutable } from '../lib/win-spawn.mjs'; // npm-installed scanners are .cmd shims on Windows
import { probeToolVersion, binFor } from '../monitor/tool-version.mjs';

const UPDATE = process.argv.includes('--update');
const JSON_OUT = process.argv.includes('--json');

// safeSpawnSync: on Windows an npm-installed scanner is a `.cmd` shim, which node refuses to spawn
// without a shell (ENOENT, or EINVAL for the explicit path — the CVE-2024-27980 fix). See
// lib/win-spawn.mjs; it routes a shim through cmd.exe and REFUSES rather than escaping if an
// argument carries a metacharacter.
const sh = (cmd, args, opts = {}) =>
  safeSpawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 120_000, ...opts });

// HOW A VERSION IS READ LIVES IN ONE PLACE — monitor/tool-version.mjs. A second reader would spell
// the same version differently (`v1.7.0` against `1.7.0`), and the roster stamp and the version
// written beside a finding must compare equal.
//
// A banner reading `(devel)` or `unknown` is UNKNOWN-VERSION (no version-shaped text to parse) and
// sits in `bad`, so it is refused with a non-zero exit.
const SCANNERS = [
  { id: 'govulncheck',
    // Its reinstall is the documented remedy rather than a suggestion.
    reinstall: ['go', ['install', 'golang.org/x/vuln/cmd/govulncheck@latest']],
    dbNote: 'queries vuln.go.dev live — no local database to age' },
  { id: 'trivy', update: ['trivy', ['--download-db-only', '--quiet']] },
  { id: 'grype', update: ['grype', ['db', 'update']] },
  { id: 'osv-scanner' },
  { id: 'semgrep' },
  { id: 'gitleaks' },
  { id: 'trufflehog' },
  { id: 'gosec' },
  { id: 'syft' },
];

// One probe's verdict in this file's vocabulary. `unstatedReason` is what makes this a mapping
// rather than a guess: 'null-version' is a build that named itself and named nothing (UNTRUSTED —
// rebuild it), 'unparseable' is a build that never got to (UNKNOWN-VERSION). Both are refused.
const stateOf = (p) => p.state === 'unavailable' ? 'MISSING'
  : p.state === 'failed' ? 'UNKNOWN-VERSION'
  : p.versionState === 'stated' ? 'ok'
  : p.unstatedReason === 'null-version' ? 'UNTRUSTED' : 'UNKNOWN-VERSION';

const results = [];
for (const s of SCANNERS) {
  const bin = binFor(s.id);
  // No `/bin/sh` on Windows: that path does not exist there, so every scanner would read MISSING
  // whatever was installed. resolveWindowsExecutable() answers WHERE the binary is, and also
  // whether the thing found is an executable or a batch shim.
  const where = process.platform === 'win32'
    ? (resolveWindowsExecutable(bin).path || '')
    : sh('/bin/sh', ['-c', `command -v ${bin}`]).stdout.trim();
  if (!where) { results.push({ id: s.id, state: 'MISSING', version: null, path: null }); continue; }

  if (UPDATE && s.update) {
    const u = sh(s.update[0], s.update[1], { timeout: 600_000 });
    if (u.status !== 0) console.error(`  ${s.id}: database update exited ${u.status}`);
  }

  const probe = probeToolVersion(s.id);
  const raw = probe.raw || '';
  let version = probe.version;
  let state = stateOf(probe);

  // THE TOOLCHAIN A SCANNER WAS BUILT WITH IS PART OF WHAT IT CAN SEE, and it is invisible in the
  // scanner's own version. govulncheck 1.7.0 built with go1.26 cannot type-check a module requiring
  // go1.27 — it emits its banner and analyses nothing — while the SAME version built with go1.27
  // scans it fine. Two builds, one version string, opposite coverage.
  //
  // `--update` runs a plain `go install`, which builds against whatever the system toolchain
  // happens to be, so on a host one release behind the "update" SILENTLY DOWNGRADES a working
  // scanner and leaves the version string unchanged. The toolchain is therefore reported alongside
  // the version and compared against the running Go.
  let builtWith = /Go:\s*(go\S+)/.exec(raw)?.[1] || null;
  if (builtWith) {
    const sysGo = /go(\S+)/.exec(sh('go', ['version']).stdout || '')?.[1] || null;
    const cmp = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - (Number(b.split('.')[i]) || 0), 0);
    if (sysGo && cmp(builtWith.replace(/^go/, ''), sysGo) < 0) {
      state = state === 'ok' ? 'BEHIND-TOOLCHAIN' : state;
      console.error(`  ${s.id}: built with ${builtWith} but this box runs go${sysGo} — it cannot analyse modules `
        + `requiring the newer release, and will report a banner rather than a scan. Rebuild: go install <module>@latest`);
    }
  }

  // An unstamped Go tool has a real remedy: rebuild it from its module so the version is stamped.
  //
  // THE RE-CHECK GOES THROUGH PATH, NOT THROUGH THE BUILD OUTPUT, and that distinction is the whole
  // correctness of this branch. Verifying ~/go/bin/<tool> directly would declare success while PATH
  // still resolves the Homebrew build, passing a binary that is never invoked. A green that
  // describes a different binary than the one that runs is worse than a red, because it retires
  // the warning while leaving the condition.
  //
  // So: rebuild, then ask the shell what `<tool>` MEANS now. If PATH still finds the unstamped
  // build, this stays UNTRUSTED and says why — the remedy is an ordering change, not another build.
  if (state === 'UNTRUSTED' && UPDATE && s.reinstall) {
    console.error(`  ${s.id}: ${probe.reason} — reinstalling from source`);
    const r = sh(s.reinstall[0], s.reinstall[1], { timeout: 900_000 });
    if (r.status === 0) {
      const nowAt = sh('/bin/sh', ['-c', `command -v ${bin}`]).stdout.trim();
      const again = probeToolVersion(s.id); // resolved through PATH, exactly as a lane would
      if (again.versionState === 'stated') {
        version = again.version; state = 'ok-after-reinstall'; where = nowAt || where;
        console.error(`  ${s.id}: rebuilt, and PATH now resolves ${version} at ${nowAt}`);
      } else {
        const home = process.env.HOME || '';
        console.error(`  ${s.id}: rebuilt at ${home}/go/bin, but PATH still resolves ${nowAt} (${again.reason}). `
          + 'STILL UNTRUSTED — the build is not the problem, the ordering is. Put the Go bin dir before the Homebrew prefix.');
      }
    }
  }
  results.push({ id: s.id, state, version, path: where, dbNote: s.dbNote || null });
}

const bad = results.filter((r) => r.state === 'UNTRUSTED' || r.state === 'UNKNOWN-VERSION');
const missing = results.filter((r) => r.state === 'MISSING');

if (JSON_OUT) {
  console.log(JSON.stringify({ results, untrusted: bad.length, missing: missing.length }, null, 2));
} else {
  console.log(`\nscanner preflight${UPDATE ? ' (with --update)' : ''}\n`);
  for (const r of results) {
    const mark = r.state === 'ok' || r.state === 'ok-after-reinstall' ? '✓' : r.state === 'MISSING' ? '·' : '✖';
    console.log(`  ${mark} ${r.id.padEnd(14)} ${String(r.version ?? '—').padEnd(16)} ${r.state}`);
    if (r.dbNote) console.log(`      ${r.dbNote}`);
  }
  if (missing.length) console.log(`\n  ${missing.length} not installed — \`commitwork setup\` installs missing scanners.`);
  if (bad.length) {
    console.log(`\n  REFUSED: ${bad.map((b) => b.id).join(', ')} cannot state a version.`);
    console.log('  A scanner that cannot say what it is cannot be trusted to say what it found —');
    console.log('  its zero is unfalsifiable. Rebuild it, or remove it so the lane reads as MISSING');
    console.log('  (a visible absence) rather than passing with an unverifiable build.');
  }
}

process.exit(bad.length ? 1 : 0);

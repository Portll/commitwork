// bin/test/lexical-ratchets.test.mjs — four lexical half-levers, one file, armed 2026-09-06 from
// the lever triage of the failure taxonomy's unrecorded classes. Each decides a FORM of a class,
// never the class, and each is a ratchet (bin/lib/lexical-ratchet.mjs): no new offender, no stale
// baseline entry, and a planted offender through the same detector so a silent detector cannot
// pass as a clean tree.
//
//   C28  Exit status read from the wrong process — a tracked shell script with a pipeline and
//        neither `set -o pipefail` nor PIPESTATUS reads the LAST command's status as the run's.
//   M16  Empty selector read as everything — `xargs` without -r/--no-run-if-empty runs its
//        command once with NO arguments when the selector is empty, which for rm/git/kill is
//        "everything" or "the cwd", never "nothing".
//   C22  Unread contradicting channel — a spawnSync result whose .status/.signal/.error is never
//        read near the call forms its verdict from stdout alone.
//   M5/M9 Ambient reads at module load — `const X = process.env.Y` at module scope defeats every
//        CW_* override a test sets afterwards (CLAUDE.md: read the env at CALL time).
//
// Baselines are the offenders present when armed. They may only shrink; a fix that clears an
// entry must delete it here, and the test says which.
//
// KEYS ARE PLACES, NEVER LINES. The first cut keyed every offender as file:line and went red within
// the hour: a peer edited ten lines above one env read, the same read became "1 new offender +
// 1 stale entry", and a real new offender in another file arrived beside it looking identical.
// CLAUDE.md's identity rule was written for exactly this. An offender is now file::identifier (the
// declared name for env reads, the result variable for spawnSync, the trimmed line for xargs),
// with #n on repeats within a file, so code moving for unrelated reasons is not a state change.
//
// THE POPULATION GREW UNDER THE GATE, ONCE. This file's own planted `xargs rm -f` string joined
// git ls-files when the file was committed, and the M16 gate that had passed over an untracked test
// file reported it as new. Test files are now outside every population here: a plant is not a use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { scan, ratchet, explain } from '../lib/lexical-ratchet.mjs';

const isTest = (f) => /(^|\/)test\/|\.test\.mjs$/.test(f);
// file::key, with #2, #3 … on repeats of the same key within one file.
const placeKeys = () => { const seen = new Map(); return (file, key) => { const k = `${file}::${key}`; const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n > 1 ? `${k}#${n}` : k; }; };

// ── C28 ──────────────────────────────────────────────────────────────────────────────────────
export const detectPipefail = (text, file) => {
  // A pipe is a lone `|`. `/\|[^|]/` matched the second bar of `|| true`, a logical OR with no
  // pipeline, and flagged a sourced library whose only fix would have set pipefail on its callers.
  const hasPipe = /(^|[^|])\|(?!\|)/m.test(text.replace(/^\s*#.*$/gm, ''));
  const guarded = /set\s+-o\s+pipefail|set\s+-[a-zA-Z]*o[a-zA-Z]*\s+pipefail|PIPESTATUS/.test(text);
  return hasPipe && !guarded ? [file] : [];
};
const C28_BASELINE = [
  'bin/codeql-swift-build.sh',
  'joernwork/repro/repro.sh',
];

// ── M16 ──────────────────────────────────────────────────────────────────────────────────────
export const detectXargs = (text, file) => {
  const out = [];
  const key = placeKeys();
  text.split('\n').forEach((line) => {
    if (!/\bxargs\b/.test(line) || /^\s*(#|\/\/|\*)/.test(line)) return;
    // -r may be combined (-r0, -0r, -rn1, -rI{}) or spelled out.
    const guarded = /\bxargs\b(\s+-[a-zA-Z0-9{}]+)*\s+-[a-zA-Z0-9]*r[a-zA-Z0-9]*\b|--no-run-if-empty/.test(line);
    if (!guarded) out.push(key(file, line.trim().replace(/\s+/g, ' ').slice(0, 60)));
  });
  return out;
};
const M16_BASELINE = [];

// ── C22 ──────────────────────────────────────────────────────────────────────────────────────
export const detectSpawnStatusUnread = (text, file) => {
  const out = [];
  const key = placeKeys();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = /(?:const|let|var)\s+(\w+)\s*=\s*spawnSync\(/.exec(line);
    if (!m) return;
    const v = m[1];
    const window = lines.slice(i, i + 41).join('\n');
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal or escaped value defined in the test
    if (!new RegExp(`\\b${v}\\.(status|signal|error)\\b`).test(window)) out.push(key(file, v));
  });
  return out;
};
const C22_BASELINE = [
  'admin/routes/posture.mjs::found',
  // bin/commitwork.mjs::r left the baseline in the 2026-09-26 origin merge: runShell reads the
  // shell plan's void and the sandbox refusal from status before stdout.
  // bin/session-start-roster.mjs::r left the baseline 2026-09-06 when it was
  // fixed (--record takes a pid and refuses one holding no live socket) and the ratchet said so.
  'monitor/posture.mjs::found',
  'monitor/workflow-harden.mjs::r',
];

// ── M5 / M9 ──────────────────────────────────────────────────────────────────────────────────
export const detectModuleScopeEnv = (text, file) => {
  const out = [];
  const key = placeKeys();
  text.split('\n').forEach((line) => {
    const m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=]*=\s*process\.env\b/.exec(line);
    if (m) out.push(key(file, m[1]));
  });
  return out;
};
// 47 at arming — the CLAUDE.md invariant "read the env at CALL time" measured for the first time.
// The git grep that had reported zero used \b, which this platform's grep does not support: a
// guard that could not match, reported as a clean tree (C26). The detector above has a planted
// offender for exactly that reason.
// bin/hooks/guard-destructive.mjs::HOME landed AFTER arming (another session) and is
// deliberately NOT here: the ratchet's whole job is to name it, and it has.
const M5_BASELINE = [
  'admin/serve.mjs::CODE_STAMP_FILE',
  'bin/a11y-scan.mjs::OUT',
  'bin/authz-bola.mjs::A',
  'bin/authz-bola.mjs::B',
  'bin/authz-bola.mjs::CANARY_A',
  'bin/authz-bola.mjs::CANARY_B',
  'bin/authz-bola.mjs::TA',
  'bin/authz-bola.mjs::TB',
  'bin/bola-run.mjs::ENV',
  'bin/cloudflare-purge.mjs::API_BASE',
  'bin/cvd-palette.mjs::OUT',
  'bin/cvd-palette.mjs::STATIC',
  'bin/docsite-publish.mjs::EDITOR_HOME',
  'bin/docsite-publish.mjs::dist',
  'bin/gradle-wrapper-verify.mjs::OUT',
  'bin/lib/theme.mjs::env',
  'bin/tls-headers-scan.mjs::OUT',
  'bin/tls-headers-scan.mjs::TLS_URL',
  'bin/top100-html.mjs::NOW',
  'cra/watch.mjs::KEV_URL',
  'map/attach-cve.mjs::ROOT',
  'map/attach-program.mjs::ROLLUP',
  'map/attach-program.mjs::ROOT',
  'map/attach-security.mjs::ROOT',
  'map/build-data.mjs::ROOT',
  'map/build-tracks.mjs::ROOT',
  'map/generate.mjs::ROOT',
  'monitor/backfill-dimensions.mjs::CVEHIST',
  'monitor/corrected-history.mjs::SERVICES',
  'monitor/modernization.mjs::MS',
  'monitor/refresh-modmap.mjs::MAP',
  'monitor/renovate-dryrun.mjs::AREA_DIR',
  'monitor/renovate-status.mjs::REPO',
  'monitor/retro-ledger.mjs::CLONES',
  'monitor/retro-ledger.mjs::SX',
  'monitor/sweep.mjs::RACES_ENGINES',
  'monitor/sync-map-history.mjs::MAP_STORE',
  'monitor/timeline2.mjs::SUBJECT',
  'monitor/verify-corrected.mjs::MAP',
];

const gates = [
  { name: 'C28 pipefail', pathspecs: ['*.sh'], detect: detectPipefail, baseline: C28_BASELINE,
    fixHint: 'bash: add `set -o pipefail` (or read PIPESTATUS) so a failing inner command is the run\'s status; #!/bin/sh: dash has neither, so remove the pipeline (capture the left side first, or use parameter expansion)',
    plant: { text: 'cat a.log | grep x\n', file: 'fixture.sh', expect: ['fixture.sh'] } },
  { name: 'M16 xargs -r', pathspecs: ['*.sh', '*.mjs'], detect: detectXargs, baseline: M16_BASELINE, exclude: isTest,
    fixHint: 'pass -r / --no-run-if-empty so an empty selector runs nothing',
    plant: { text: 'find . -name "*.tmp" | xargs rm -f\n', file: 'fixture.sh', expect: ['fixture.sh::find . -name "*.tmp" | xargs rm -f'] } },
  { name: 'C22 spawnSync status read', pathspecs: ['*.mjs'], detect: detectSpawnStatusUnread, baseline: C22_BASELINE, exclude: isTest,
    fixHint: 'read r.status (and r.signal / r.error) before trusting r.stdout — a verdict from one channel is C22',
    plant: { text: 'const r = spawnSync("x");\nreturn r.stdout;\nconst r = spawnSync("y");\n', file: 'fixture.mjs', expect: ['fixture.mjs::r', 'fixture.mjs::r#2'] } },
  { name: 'M5 env at call time', pathspecs: ['*.mjs'], detect: detectModuleScopeEnv, baseline: M5_BASELINE, exclude: isTest,
    fixHint: 'read process.env inside the function that needs it, so a CW_* override set later is honoured',
    plant: { text: 'const ROOT = process.env.CW_ROOT || "/x";\n', file: 'fixture.mjs', expect: ['fixture.mjs::ROOT'] } },
];

test('C28 pipefail: a logical OR is not a pipeline', () => {
  assert.deepEqual(detectPipefail('x="$(node a.mjs 2>/dev/null || true)"\n[[ a || b ]]\n', 'f.sh'), []);
  assert.deepEqual(detectPipefail('a || b\ncat a | grep x\n', 'f.sh'), ['f.sh']);
});

for (const g of gates) {
  test(`${g.name}: the detector catches a planted offender and passes a clean text`, () => {
    assert.deepEqual(g.detect(g.plant.text, g.plant.file), g.plant.expect, 'positive control: the planted offender must be reported');
    assert.deepEqual(g.detect('echo ok\n', g.plant.file), [], 'negative control: a clean text reports nothing');
  });

  test(`${g.name}: no new offender in the tracked tree, and the baseline is exact`, () => {
    const { offenders, scanned } = scan({ pathspecs: g.pathspecs, detect: g.detect, exclude: g.exclude });
    assert.ok(scanned > 0, `${g.name}: scanned nothing — the population is empty, which is not a clean tree`);
    const r = ratchet(offenders, g.baseline);
    assert.ok(r.ok, explain(g.name, r, g));
  });
}

// C28's remedy is a CLAIM, and it was briefly a wrong one: the hint named only `set -o pipefail`
// and PIPESTATUS, both bash-only, while bin/install.sh is the one tracked #!/bin/sh file. Following
// it would have broken the Linux installer, because dash rejects the option outright. ec3a7ae2 gave
// the hint a POSIX sh branch; this measures both halves of what it now asserts.
//
// /bin/sh is NOT the witness for the sh branch. On macOS it is bash in sh mode and accepts
// `set -o pipefail`, so a test that used it would pass here while proving nothing about dash — the
// shape of unsupported pass this repository exists to refuse. A real POSIX sh is required, and
// where there is none the claim is declared UNMEASURED rather than assumed.
test('C28 pipefail: the remedy names both dialects, and the POSIX half is true of a real POSIX sh', (t) => {
  const c28 = gates.find((g) => g.name === 'C28 pipefail');
  assert.ok(/set\s+-o\s+pipefail|PIPESTATUS/.test(c28.fixHint), 'the bash remedy is gone from the hint');
  assert.match(c28.fixHint, /#!\/bin\/sh|POSIX/, 'the hint must say what a POSIX sh script can do instead; without it the advice is bash-only and breaks a dash script');

  const posixSh = ['/bin/dash', '/usr/bin/dash'].find((p) => existsSync(p));
  if (!posixSh) {
    return t.skip('no dash on this host — whether a POSIX sh rejects `set -o pipefail` is UNMEASURED here, and /bin/sh is not a substitute (it is bash in sh mode on darwin)');
  }
  const r = spawnSync(posixSh, ['-c', 'set -o pipefail'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `${posixSh} accepted \`set -o pipefail\`; if a POSIX sh accepts it, the hint's sh branch is advising a detour nobody needs`);
  assert.match(`${r.stderr}${r.stdout}`, /[Ii]llegal option|not? valid|unknown option|bad option/, `${posixSh} refused it without saying why: ${JSON.stringify(r.stderr)}`);

  // and the detector still REPORTS a POSIX sh file with a pipeline. The dialect changes the remedy,
  // never the finding: an unchecked pipeline hides a failing left-hand side in dash exactly as in bash.
  assert.deepEqual(detectPipefail('#!/bin/sh\ncat a.log | grep x\n', 'posix.sh'), ['posix.sh'],
    'a #!/bin/sh file with an unguarded pipeline must still be reported, just advised differently');
});

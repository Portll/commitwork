// monitor/images.mjs — pull each scanner image ONCE per sweep, bounded, and record what ran.
//
// deps-osv carried `--pull=always` per repo: 100 registry round-trips per batch, and on
// sweep-20260822153004 one stalled pull held the first repo for 8.9 h with no alarm. The
// freshness argument behind it was right (`:latest` is not self-updating; a cached scanner silently
// misses every advisory since it was pulled) — the per-repo placement was the defect. This pulls
// each image once before the first repo, under a timeout, and writes presence + digest into
// batch-manifest.json so a batch can state which scanner build produced it.
//
// Failure is recorded, never hidden: a pull that times out or fails leaves the lane running on
// whatever tag is cached, with {pulled:false, reason} beside it. A missing digest is null with a
// reason (locally built images have no RepoDigests), never a fabricated one.
import { safeSpawnSync } from '../lib/win-spawn.mjs';
import { getSetting } from './settings.mjs';

// Every binary is read at CALL time so a test can point it at a fake; a module-level const would
// defeat the override (CLAUDE.md, "read the env at CALL time").
const dockerBin = () => process.env.CW_DOCKER || 'docker';
const colimaBin = () => process.env.CW_COLIMA || 'colima';
const openBin = () => process.env.CW_OPEN || 'open';
const osascriptBin = () => process.env.CW_OSASCRIPT || 'osascript';

function runBin(bin, args, timeoutMs) {
  // safeSpawnSync, not spawnSync directly. On win32 node REFUSES to spawn a `.cmd`/`.bat` without a
  // shell (the CVE-2024-27980 mitigation) and returns EINVAL, so an operator pointing CW_DOCKER or
  // CW_COLIMA at a wrapper batch shim — an ordinary thing to do on Windows — got an unexplained
  // failure. lib/win-spawn.mjs routes exactly those through `cmd.exe /d /s /c` with every argument
  // validated, and REFUSES rather than escaping when one carries a cmd metacharacter. On every
  // other platform its plan is an exact pass-through, so nothing changes there.
  const r = safeSpawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  // A refusal is not an absence: the binary is there and the ARGUMENTS could not be made safe.
  // Reporting it as absent would send a reader to install something they already have.
  if (r.refused) return { ok: false, refused: true, status: null, out: '', err: r.reason };
  if (r.error && r.error.code === 'ENOENT') return { ok: false, absent: true, out: '', err: '' };
  if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, timedOut: true, out: String(r.stdout || ''), err: String(r.stderr || '') };
  return { ok: r.status === 0, status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}
const run = (args, timeoutMs) => runBin(dockerBin(), args, timeoutMs);

// Synchronous sleep for the poll loop below — this module is spawnSync end to end.
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** RepoDigests is `[]` for an image with no registry origin; `{{index .RepoDigests 0}}` would throw. */
function digestOf(image) {
  const r = run(['image', 'inspect', '--format', '{{json .RepoDigests}}', image], 30_000);
  if (!r.ok) return { digest: null, reason: r.absent ? 'docker absent' : `inspect failed (${r.timedOut ? 'timeout' : `exit ${r.status}`})` };
  let list = [];
  try { list = JSON.parse(r.out.trim() || '[]'); } catch { return { digest: null, reason: 'inspect output unparseable' }; }
  if (!Array.isArray(list) || !list.length) return { digest: null, reason: 'no registry digest (locally built or untagged image)' };
  return { digest: String(list[0]), reason: null };
}


// A CREDENTIAL-HELPER FAILURE IS NOT A NETWORK FAILURE, and it does not look like one in the log.
//
// MEASURED 2026-08-28: every image pull in the fleet had been failing with
//   "error getting credentials - err: exec: \"docker-credential-osxkeychain\": executable file not
//    found in $PATH"
// for four images — osv-scanner, dep-scan, renovate and guarddog — on a box where ~/.docker/
// config.json declares `credsStore: osxkeychain` and NOTHING PROVIDES IT. Docker Desktop is not
// installed here (the context is colima), so the helper the config names had never existed. These
// are PUBLIC images needing no credentials at all; the helper is consulted before anyone asks
// whether authentication is required.
//
// The raw error names a macOS binary, so on Linux or Windows the same failure prints a different
// helper and the same nothing about what to do. This turns it into an instruction, chosen from the
// platform actually running rather than from the string the error happens to carry.
const HELPER_FIX = {
  darwin: 'brew install docker-credential-helper (provides docker-credential-osxkeychain)',
  linux: 'install docker-credential-secretservice or docker-credential-pass, or remove "credsStore" from ~/.docker/config.json — these images are public and need no credentials',
  win32: 'install docker-credential-wincred (ships with Docker Desktop for Windows), or remove "credsStore" from %USERPROFILE%\\.docker\\config.json',
};

/** Turn a raw pull error into an actionable one where we recognise the cause. */
export function explainPullFailure(raw) {
  const t = String(raw || '');
  const m = /docker-credential-(\w+)/.exec(t);
  if (!/getting credentials|credential/i.test(t) || !m) return raw;
  const fix = HELPER_FIX[process.platform]
    || 'install the credential helper your platform uses, or remove "credsStore" from the docker config';
  return `${t} -- the config names a credential helper that is not installed, and these images are PUBLIC and need none. Fix: ${fix}`;
}

/** 'restart-popup' asked for a desktop notification; every other mode leaves `notified` null. Best effort, bounded, never throws. */
function notifyIfAsked(mode, record) {
  if (mode !== 'restart-popup') return;
  const text = record.ok
    ? `docker restarted (${record.method}, ${record.secs}s) — the sweep is pulling images`
    : `docker restart ${record.attempted ? 'FAILED' : 'not attempted'}: ${record.reason || 'no reason recorded'}`;
  const quoted = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const r = runBin(osascriptBin(), ['-e', `display notification "${quoted}" with title "commitwork sweep"`], 10_000);
  record.notified = r.ok;
  // A REFUSAL is named as one. It has no exit status, so the generic branch below would render
  // "exit null" — a reason that tells a reader nothing and looks like a crash.
  if (!r.ok) {
    record.notifyReason = r.refused ? `notification not sent: ${r.err}`
      : r.absent ? 'osascript not found — the popup needs macOS'
        : `osascript failed (${r.timedOut ? 'timeout' : `exit ${r.status}`})`;
  }
}

/**
 * One bounded attempt to bring a DOWN daemon back, gated on the operator's `dockerRestartOnDown`
 * setting (env > store > default, read HERE at call time). Called only from the DOWN branch:
 * ABSENT never reaches this — absence is a deployment choice, and a sweep must not install or
 * start what the operator never deployed.
 *
 * The record returns whichever way it goes, and warmImages puts it on its result so the batch
 * manifest can state whether these images were pulled from a daemon this sweep itself kicked.
 * `ok: null` means the attempt could not be MADE (no method, or the setting said no) — that is a
 * different fact from `ok: false`, which means a method ran and the daemon still does not answer.
 */
export function attemptDockerRestart(opts = {}) {
  const s = getSetting('dockerRestartOnDown');
  const mode = s.value;
  const record = { mode, modeSource: s.source, attempted: false, method: null, ok: null, secs: null, reason: null, notified: null };
  if (mode !== 'restart' && mode !== 'restart-popup') {
    record.reason = 'operator setting says do not restart — recorded, nothing started';
    return { recovered: false, record };
  }
  const budgetMs = Number(opts.timeoutSec ?? process.env.CW_DOCKER_RESTART_TIMEOUT_SEC ?? 180) * 1000;
  const t0 = Date.now();
  const took = () => Math.round((Date.now() - t0) / 1000);

  // colima first: on this class of box the daemon IS colima, `colima start` blocks until the
  // socket answers, and it needs no elevation. ENOENT falls through to the Docker app on macOS.
  const colima = runBin(colimaBin(), ['start'], budgetMs);
  if (!colima.absent) {
    record.attempted = true;
    record.method = 'colima';
    record.secs = took();
    if (colima.ok) {
      // exit 0 does not prove the socket answers — the probe is the witness, not the exit code.
      const probe = run(['info'], 30_000);
      record.ok = probe.ok;
      record.secs = took();
      if (!probe.ok) record.reason = 'colima start exited 0 but docker info still fails — treated as still DOWN';
    } else {
      record.ok = false;
      record.reason = `colima start failed (${colima.timedOut ? 'timeout' : `exit ${colima.status}`}): ${((colima.err || colima.out).trim().split('\n').pop() || 'no output')}`.slice(0, 300);
    }
    notifyIfAsked(mode, record);
    return { recovered: record.ok === true, record };
  }

  if (process.platform === 'darwin') {
    record.attempted = true;
    record.method = 'docker-app';
    const opened = runBin(openBin(), ['-a', 'Docker'], 30_000);
    if (!opened.ok) {
      record.ok = false;
      record.secs = took();
      record.reason = `open -a Docker failed (${opened.absent ? 'open not found' : opened.timedOut ? 'timeout' : `exit ${opened.status}`}) and colima is not installed`;
      notifyIfAsked(mode, record);
      return { recovered: false, record };
    }
    // The app starts asynchronously; poll the daemon until it answers or the budget runs out.
    const pollMs = Number(process.env.CW_DOCKER_RESTART_POLL_MS || 5000);
    while (Date.now() - t0 < budgetMs) {
      const probe = run(['info'], 30_000);
      if (probe.ok) {
        record.ok = true;
        record.secs = took();
        notifyIfAsked(mode, record);
        return { recovered: true, record };
      }
      sleep(pollMs);
    }
    record.ok = false;
    record.secs = took();
    record.reason = `the Docker app was started but the daemon did not answer within ${Math.round(budgetMs / 1000)}s`;
    notifyIfAsked(mode, record);
    return { recovered: false, record };
  }

  // ok stays null: nothing ran, so "failed" would be a fabricated verdict about an attempt
  // that never happened.
  record.reason = 'no non-elevated restart method: colima is not installed and this is not macOS — starting a system dockerd needs privileges a sweep must not hold';
  notifyIfAsked(mode, record);
  return { recovered: false, record };
}

/**
 * @param {string[]} images
 * @param {{timeoutSec?: number, restartTimeoutSec?: number}} [opts]  pull timeout per image; CW_IMAGE_PULL_TIMEOUT_SEC or 600
 * @returns {{docker: 'ok'|'absent'|'down', reason: string|null, images: Record<string, {presentBefore: boolean|null, pulled: boolean, digest: string|null, reason: string|null, secs: number}>|null, restart?: object}}
 */
export function warmImages(images, opts = {}) {
  const uniq = [...new Set((images || []).filter(Boolean))];
  const timeoutSec = Number(opts.timeoutSec ?? process.env.CW_IMAGE_PULL_TIMEOUT_SEC ?? 600);
  const info = run(['info'], 30_000);
  if (info.absent) return { docker: 'absent', reason: 'docker is not installed — container lanes will skip and say so', images: null };
  let restart = null;
  if (!info.ok) {
    const downReason = `docker info failed (${info.timedOut ? 'timeout' : `exit ${info.status}`}) — nothing pulled; container lanes run on whatever is cached or skip`;
    const attempt = attemptDockerRestart({ timeoutSec: opts.restartTimeoutSec });
    if (!attempt.recovered) return { docker: 'down', reason: downReason, images: null, restart: attempt.record };
    // Recovered: fall through into the pull loop. The record rides on the OK result — a daemon
    // this sweep itself restarted is a fact the batch must be able to state.
    restart = attempt.record;
  }
  const out = {};
  for (const image of uniq) {
    const t0 = Date.now();
    const before = run(['image', 'inspect', '--format', '{{.Id}}', image], 30_000);
    const presentBefore = before.absent ? null : before.ok;
    const pull = run(['pull', '--quiet', image], timeoutSec * 1000);
    const secs = Math.round((Date.now() - t0) / 1000);
    const pulled = pull.ok;
    const reason = pulled ? null
      : pull.timedOut ? `pull exceeded ${timeoutSec}s — running on the cached tag${presentBefore ? '' : ', which is ABSENT: the lane will pull implicitly or skip'}`
        : `pull failed (exit ${pull.status}): ${explainPullFailure((pull.err || pull.out).trim().split('\n').pop() || 'no output')}`.slice(0, 400);
    const d = digestOf(image);
    out[image] = { presentBefore, pulled, digest: d.digest, reason: reason || d.reason, secs };
  }
  return { docker: 'ok', reason: null, images: out, ...(restart ? { restart } : {}) };
}

/** Union of `images[]` across the manifests a sweep will run. Missing/unreadable manifests are reported, not skipped silently. */
export function manifestImages(readManifest, names) {
  const images = new Set(); const problems = [];
  for (const n of [...new Set(names)]) {
    let m;
    try { m = readManifest(n); } catch (e) { problems.push(`${n}: ${(e && e.message) || e}`); continue; }
    for (const i of (m && Array.isArray(m.images) ? m.images : [])) images.add(i);
  }
  return { images: [...images], problems };
}

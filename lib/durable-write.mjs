// lib/durable-write.mjs — writes that survive a full disk, and a store-verifier that survives the
// aftermath. Zero dependencies; sync throughout, because atomicity is easier to reason about when
// there is no interleaving to reason about.
//
// WHY THIS EXISTS, measured on this box. The volume hit ENOSPC (615 MiB free on 2026-09-06; 105 GiB
// now). Three stores stopped inside one window: ~/.substrate/tasks.db last wrote Aug 30 22:54,
// monitor/commitwork.db Aug 30 00:42, and a JSONL ledger's newest row is dated Aug 31. Nothing
// reported it. Every one of those lanes exits 0 on failure, so a silent write failure and a quiet
// week look identical from outside.
//
// THE CENTRAL FACT THIS MODULE IS SHAPED AROUND — ENOSPC DAMAGE OUTLIVES THE ENOSPC.
// In the same window containerd's bolt metadata DB reported
//   `write /var/lib/containerd/io.containerd.metadata.v1.bolt/meta.db: input/output error`
// — EIO, not ENOSPC — and kept failing for EIGHT DAYS after space was available, until a VM
// restart. A failed mmap grow had left it wedged. Three consequences, and they are the whole design:
//
//   1. "The disk is fine now" proves nothing about whether a store is still broken. Free space is a
//      fact about the FUTURE of writes, never about the PAST of a store. So preflight (which looks
//      forward) and verify (which looks backward) are separate functions and neither substitutes
//      for the other.
//   2. The error you observe later need not name the original cause. Detection must not key on the
//      ENOSPC errno — classify() carries EIO, EROFS and EDQUOT as first-class ENOSPC aftermath.
//   3. Inside a VM or container the GUEST's free space is what matters, not the host's. statfs() on
//      the target path answers for the guest, which is the right answer and also the one that was
//      never asked. The containerd case is the trap in its pure form: the host had room, the guest's
//      already-wedged store did not care.
//
// GREY IS NEITHER GREEN NOR RED (CLAUDE.md). Preflight is ADVISORY. If free space cannot be
// determined that is UNKNOWN — it must not render as "plenty of room" and must not refuse the write
// either. A preflight that fails closed on its own ignorance would have stopped every write on every
// filesystem Node cannot statfs, which is over-reporting, and over-reporting is not the safe
// direction for a tool whose claim is reporting that survives scrutiny.
//
// FAIL CLOSED (CLAUDE.md). Only ENOENT is legitimate absence, and it is decided by stat(), never by
// matching an error message — admin/lib/overwatch-layer-read.mjs:84-90 decides absence with
// `/unable to open database|no such file/i` against a message SQLite emits identically for a missing
// file and for a permission denial. Those are opposite facts. This module is the correct version.

import {
  openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync,
  mkdirSync, statSync, statfsSync, readFileSync, fstatSync, fchmodSync, appendFileSync,
} from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

// ── Vocabulary ──────────────────────────────────────────────────────────────
//
// Three write outcomes, not two, for the same reason lib/memory-layer-client.mjs declares four
// receipt states: a REFUSED write and a FAILED write are opposite facts and one badge loses the
// second. A refusal is recoverable — nothing was touched, the caller may retry or free space. A
// failure means we started and something is now in an unknown state.

export const WRITTEN = 'written';   // the bytes are on disk and were read back
export const REFUSED = 'refused';   // we declined BEFORE touching anything — nothing was changed
export const FAILED = 'failed';     // we tried and did not finish — see partial{} for what we know

/** Preflight verdicts. Three, and the third is the point. */
export const SPACE_OK = 'ok';
export const SPACE_INSUFFICIENT = 'insufficient';
export const SPACE_UNKNOWN = 'unknown';   // NEVER read as either of the above

/** Per-step durability outcomes, so a caller can see which guarantees actually held. */
export const HELD = 'held';                 // the step ran and succeeded
export const NOT_ATTEMPTED = 'not-attempted';
export const UNSUPPORTED = 'unsupported';   // the platform cannot offer it — a real, reportable gap
export const STEP_FAILED = 'failed';        // it was attempted and it did not work

/** Store verdicts for verifySqlite(). `empty` is deliberately NOT one of them — see below. */
export const STORE_OK = 'ok';
export const STORE_ABSENT = 'absent';           // stat() said ENOENT, and only stat() may say this
export const STORE_UNREADABLE = 'unreadable';   // present and we could not read it — never "empty"
export const STORE_CORRUPT = 'corrupt';         // present, readable, and integrity_check disagrees
export const STORE_TRUNCATED = 'truncated';     // present, zero bytes — see the probe note below

// ── Config, read at CALL time ───────────────────────────────────────────────
//
// A `const X = process.env.Y` at module load silently defeats every test that sets the override
// afterwards — the test then passes while proving nothing (CLAUDE.md). So these are functions.

/** Hard ceiling on a single payload. Above it we REFUSE with a receipt rather than let V8 die. */
export function maxBytes(env = process.env) {
  const v = Number(env.CW_DURABLE_MAX_BYTES);
  return Number.isFinite(v) && v > 0 ? v : 64 * 1024 * 1024;
}

/**
 * Slack demanded over and above the payload. A filesystem at literally zero free blocks fails in
 * places that are not your write — journal commits, directory extends, the rename itself — so
 * "payload fits exactly" is not the same as "the write can complete".
 */
export function headroomBytes(env = process.env) {
  const v = Number(env.CW_DURABLE_HEADROOM_BYTES);
  return Number.isFinite(v) && v >= 0 ? v : 8 * 1024 * 1024;
}

/** Deterministic clock, honoured repo-wide. Same inputs => byte-identical outputs. */
export function now(env = process.env) {
  const o = env.CW_NOW;
  if (!o) return new Date().toISOString();
  const d = new Date(o);
  if (Number.isNaN(d.getTime())) throw new Error(`CW_NOW is not a parseable date: ${o}`);
  return d.toISOString();
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * The injected I/O surface. Every syscall this module makes goes through here, which is the only
 * way to prove an ENOSPC path without filling a real disk — and a fault you cannot inject is a
 * fault nobody has ever seen the handler for.
 *
 * Built at CALL time from node:fs and shallow-merged with the caller's overrides, so a test may
 * replace exactly one function (writeSync, say) and keep real semantics for the rest. A test that
 * had to stub all eleven would be asserting its own mock.
 */
export function defaultIO() {
  return {
    openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync,
    mkdirSync, statSync, statfsSync, readFileSync, fstatSync, fchmodSync, appendFileSync,
  };
}

// ── Error classification ────────────────────────────────────────────────────

/**
 * What KIND of failure was that. Note what is deliberately absent: any branch that turns an
 * unrecognised error into a benign outcome. An unknown error is classified `unknown` and the
 * original errno and message are PRESERVED rather than erased — the undetermined claim keeps its
 * evidence instead of being flattened into a verdict (CLAUDE.md).
 *
 * ENOSPC is not privileged here, and that is the point of the containerd case. A store damaged by a
 * full disk goes on reporting EIO long after the disk is fine; a filesystem that hit ENOSPC is
 * frequently remounted EROFS by the kernel; a user over quota gets EDQUOT and never sees ENOSPC at
 * all. Keying detection on one errno would have missed all three.
 */
export function classify(err) {
  const code = err && err.code ? String(err.code) : null;
  const msg = err && err.message ? String(err.message) : '';

  // OOM-adjacent first: these carry no errno, so an errno-keyed switch drops them into `unknown`
  // and a caller reads an allocation death as a mystery. ERR_STRING_TOO_LONG is the named code;
  // V8's own string ceiling throws a bare RangeError with `code: undefined` (verified on this
  // runtime: message "Invalid string length"), so the constructor and message are both consulted.
  if (code === 'ERR_STRING_TOO_LONG') return { class: 'oom', errno: code, recoverable: true, why: 'string exceeded V8 max string length' };
  if (err instanceof RangeError && /invalid string length|array buffer allocation failed|invalid typed array length|cannot create a string longer/i.test(msg)) {
    return { class: 'oom', errno: code, recoverable: true, why: `allocation refused by the runtime: ${msg}` };
  }
  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE') {
    return { class: 'oom', errno: code, recoverable: true, why: msg };
  }

  switch (code) {
    case 'ENOSPC':
      return { class: 'no-space', errno: code, recoverable: true, why: 'no space left on device' };
    case 'EDQUOT':
      return { class: 'quota', errno: code, recoverable: true, why: 'user or group quota exceeded — the device may have space you cannot use' };
    case 'EFBIG':
      return { class: 'too-big-for-fs', errno: code, recoverable: false, why: 'file exceeds the filesystem maximum' };
    case 'EIO':
      // The signature that outlives its cause. Do not report this as a transient hiccup.
      return { class: 'io', errno: code, recoverable: false, why: 'input/output error — the store or device may be wedged, and this can persist long after the original cause cleared' };
    case 'EROFS':
      return { class: 'read-only-fs', errno: code, recoverable: false, why: 'filesystem is read-only — a kernel frequently remounts read-only AFTER an I/O or space failure' };
    case 'EACCES':
    case 'EPERM':
      return { class: 'permission', errno: code, recoverable: false, why: 'permission denied' };
    case 'ENOENT':
      // The ONLY legitimate absence, and even here it is a fact about a path, not about a store.
      return { class: 'absent', errno: code, recoverable: true, why: 'path does not exist' };
    case 'EMFILE':
    case 'ENFILE':
      return { class: 'fd-exhausted', errno: code, recoverable: true, why: 'file descriptor limit reached' };
    case 'EBUSY':
    case 'ETXTBSY':
      return { class: 'busy', errno: code, recoverable: true, why: 'resource busy' };
    case 'EXDEV':
      // Only reachable if a caller hands us a tmp path on another device; we always co-locate.
      return { class: 'cross-device', errno: code, recoverable: false, why: 'rename across filesystems is not atomic and was refused by the kernel' };
    case 'EISDIR':
      return { class: 'is-directory', errno: code, recoverable: false, why: 'path is a directory' };
    default:
      return { class: 'unknown', errno: code, recoverable: null, why: msg || 'unclassified failure' };
  }
}

// ── Preflight ───────────────────────────────────────────────────────────────

/**
 * How much room is there, on the filesystem holding `path`, for the guest that is asking?
 *
 * ADVISORY, and three-valued. `statfs` is present on this runtime (Node 24.16.0, verified — the
 * brief said Node 26 and this box says otherwise, which is exactly why it is checked rather than
 * assumed). It is absent on older Node and can throw ENOSYS on exotic filesystems, and on some
 * network mounts it answers with zeroes that mean "I do not know" rather than "you are full".
 * Every one of those is UNKNOWN. None of them is a refusal, and none of them is a pass.
 *
 * `bavail`, not `bfree`: bfree counts root-reserved blocks this process cannot have. Reporting
 * reserved space as available is how a preflight passes a write that then fails with ENOSPC.
 *
 * VM/CONTAINER NOTE: this measures the filesystem that `path` actually lands on, from inside
 * whatever namespace we are in. That is the number that governs the write. A host with terabytes
 * free is not evidence about a guest's 615 MiB, and the ENOSPC that started this module was
 * observed from inside.
 */
export function freeSpace(path, { io = null, statfsPath = null } = {}) {
  const f = { ...defaultIO(), ...(io || {}) };
  // statfs answers for a filesystem, so any existing path on it will do. The target file usually
  // does not exist yet; its directory does.
  const probe = statfsPath || dirname(path);

  if (typeof f.statfsSync !== 'function') {
    return { state: SPACE_UNKNOWN, freeBytes: null, why: 'fs.statfsSync is not available on this runtime — free space is undetermined, which is neither ample nor exhausted' };
  }
  let st;
  try {
    st = f.statfsSync(probe);
  } catch (e) {
    const c = classify(e);
    return { state: SPACE_UNKNOWN, freeBytes: null, errno: c.errno, why: `statfs(${probe}) failed: ${c.why} — undetermined, not empty` };
  }
  // BigInt appears when a caller passes { bigint: true }; Number() is safe at filesystem scale and
  // keeps the receipt JSON-serialisable.
  const blockSize = Number(st && (st.bsize ?? st.frsize));
  const avail = Number(st && st.bavail);
  if (!Number.isFinite(blockSize) || !Number.isFinite(avail) || blockSize <= 0) {
    return { state: SPACE_UNKNOWN, freeBytes: null, why: 'statfs returned no usable block size or available count — undetermined' };
  }
  return { state: SPACE_OK, freeBytes: avail * blockSize, blockSize, why: null };
}

/**
 * Would this write fit? Returns the same three states. `insufficient` is the only one that stops a
 * write, and it is only ever returned when we have a real number in hand.
 */
export function preflight(path, bytes, { io = null, env = process.env, headroom = null } = {}) {
  const slack = headroom == null ? headroomBytes(env) : headroom;
  const required = bytes + slack;
  const fs_ = freeSpace(path, { io });
  if (fs_.state !== SPACE_OK) {
    return { ...fs_, requiredBytes: required, headroomBytes: slack };
  }
  if (fs_.freeBytes < required) {
    return {
      state: SPACE_INSUFFICIENT,
      freeBytes: fs_.freeBytes,
      requiredBytes: required,
      headroomBytes: slack,
      why: `${fs_.freeBytes} bytes available, ${required} needed (${bytes} payload + ${slack} headroom) — refusing rather than half-writing`,
    };
  }
  return { state: SPACE_OK, freeBytes: fs_.freeBytes, requiredBytes: required, headroomBytes: slack, why: null };
}

// ── The write ───────────────────────────────────────────────────────────────

/** A receipt with every field present. A field that appears on some outcomes and is absent on
 *  others gets read as zero by the next consumer along, so the shape never varies. */
function baseReceipt(path, env) {
  return {
    ok: false,
    state: FAILED,
    path,
    bytes: null,
    sha256: null,
    reason: null,
    class: null,
    errno: null,
    at: now(env),
    preflight: { state: SPACE_UNKNOWN, freeBytes: null, requiredBytes: null, headroomBytes: null, why: 'not run' },
    // WHICH GUARANTEES ACTUALLY HELD. Never silently no-op a step on a platform that lacks it —
    // record it, so a caller can tell a durable write from a merely-completed one.
    durability: {
      tmpWrite: NOT_ATTEMPTED,
      fileFsync: NOT_ATTEMPTED,
      rename: NOT_ATTEMPTED,
      dirFsync: NOT_ATTEMPTED,
      readback: NOT_ATTEMPTED,
    },
    // What we know about what reached the disk. A write error NEVER means "wrote nothing".
    partial: { started: false, bytesWritten: 0, targetReplaced: false },
    tmp: { path: null, cleaned: 'not-created', cleanupReason: null },
    // Non-fatal degradations. A guarantee that went grey must be able to say WHY without borrowing
    // the fatal `reason` field (which would make a successful write look failed) or tmp.cleanupReason
    // (which would make a durability gap look like a leaked file).
    notes: [],
    platform: process.platform,
    // Present on EVERY receipt, including refusals and failures. A field that appears on some
    // outcomes and is absent on others gets read as zero by the next consumer along — this module's
    // own shape test caught it missing here. On a refusal all three are false, which is exactly
    // right: nothing was written, so nothing about it is durable.
    guarantees: { atomicRename: false, fileDurable: false, dirDurable: false },
  };
}

/** Roll the per-step outcomes up into the three claims a caller actually reasons about. */
function guaranteesFrom(d) {
  const held = (s) => s === HELD;
  return {
    // The rename happened and nothing can now observe a half-file at the target path.
    atomicRename: held(d.rename),
    // The bytes are on stable storage rather than in the page cache.
    fileDurable: held(d.fileFsync),
    // The DIRECTORY ENTRY pointing at those bytes is itself on stable storage. This is the step
    // most often missed: without it a crash can lose the rename and leave the OLD file in place,
    // with a perfectly fsynced tmp file nobody will ever look at.
    dirDurable: d.dirFsync === HELD ? true : (d.dirFsync === UNSUPPORTED ? 'unknown' : false),
  };
}

/**
 * Write `data` to `path` atomically and durably, and return a receipt instead of throwing.
 *
 * Callers on nightly paths exit 0 on failure. A thrown exception in one of those becomes a silent
 * no-op; a returned receipt becomes a row somebody can count. That asymmetry is the whole reason
 * this returns rather than throws — it is the same reason lib/memory-store.mjs returns receipts.
 * (It still throws on programmer error — a bad argument type — because that is not a runtime
 * condition a receipt can help with.)
 *
 * THE SEQUENCE, and what each step buys:
 *   1. preflight            — refuse before touching anything. A refused write is recoverable; a
 *                             half-write is not.
 *   2. write tmp (same dir) — same directory so the rename is same-filesystem and therefore atomic.
 *                             A tmp in /tmp renames across devices and fails EXDEV, or worse,
 *                             silently degrades to copy+unlink in a helpful library.
 *   3. fsync(file)          — the bytes reach stable storage.
 *   4. rename(tmp, path)    — POSIX guarantees an observer sees either the whole old file or the
 *                             whole new one. Never a truncate-then-write in place.
 *   5. fsync(directory)     — the rename ITSELF becomes durable. Skipping this is the classic bug:
 *                             every byte fsynced, and a crash still loses the change.
 *   6. readback             — assert the EFFECT, not the marker. Steps 1-5 all returning 0 is a
 *                             marker. Bytes that hash to what we meant to write is the effect, and
 *                             it is the only check that catches a filesystem which accepted a write
 *                             and stored something else — the containerd failure mode exactly.
 *
 * PLATFORM DIFFERENCES, handled rather than assumed:
 *   · fsync on a DIRECTORY is a POSIX concept. On Windows a directory cannot be opened as a file
 *     handle by fs.openSync, so step 5 cannot run at all. We attempt it, and on win32 a failure is
 *     recorded as UNSUPPORTED with `dirDurable: 'unknown'` — it is not silently skipped and it is
 *     not reported as held. NTFS metadata journaling makes rename durability likely in practice,
 *     but likely is not a guarantee and this module does not launder one into the other.
 *   · rename-over-an-existing-file is atomic on POSIX. On Windows libuv uses MoveFileEx with
 *     MOVEFILE_REPLACE_EXISTING, which is atomic for the directory entry BUT fails with EPERM or
 *     EACCES when another process holds the target open — a condition that simply does not arise on
 *     POSIX. That failure is classified `permission`, and the tmp is cleaned up, so the caller
 *     retries rather than losing data.
 *   · statfs is absent on Node < 18.15 and can throw on network mounts; freeSpace() returns UNKNOWN.
 *
 * @param {string} path
 * @param {string|Buffer|Uint8Array} data
 * @returns {object} receipt — never throws for an I/O condition
 */
export function durableWrite(path, data, {
  io = null,
  env = process.env,
  mode = null,           // explicit file mode; otherwise an existing target's mode is preserved
  verify = true,         // readback-and-compare. On by default: a guarantee nobody checks decays.
  headroom = null,
  max = null,
  mkdir = true,
  tmpPath = null,        // injectable so a test can predict the path it asserts about
} = {}) {
  const f = { ...defaultIO(), ...(io || {}) };
  const r = baseReceipt(path, env);

  // ── OOM guard, before any allocation we control ──────────────────────────
  // Converting a string to a Buffer is the allocation; do the size check on the source first so a
  // 900 MB payload is REFUSED with a receipt instead of taking the process down with it. An
  // allocation crash is not a reportable failure — nothing survives to report it.
  const ceiling = max == null ? maxBytes(env) : max;
  let buf;
  try {
    if (typeof data === 'string') {
      // Cheap upper bound first (UTF-8 is at most 3 bytes per UTF-16 code unit for BMP, 4 for
      // surrogate pairs which are 2 units — so 3x length is a true ceiling). If even the bound is
      // under the limit we skip the exact measurement, which itself walks the string.
      const bound = data.length * 3;
      const size = bound <= ceiling ? bound : Buffer.byteLength(data, 'utf8');
      if (size > ceiling) {
        return {
          ...r, state: REFUSED, class: 'too-large', bytes: size,
          reason: `payload is ${size} bytes, ceiling is ${ceiling} (CW_DURABLE_MAX_BYTES) — refused before allocating, because an allocation crash cannot file a report about itself`,
        };
      }
      buf = Buffer.from(data, 'utf8');
    } else if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      if (data.byteLength > ceiling) {
        return {
          ...r, state: REFUSED, class: 'too-large', bytes: data.byteLength,
          reason: `payload is ${data.byteLength} bytes, ceiling is ${ceiling} (CW_DURABLE_MAX_BYTES) — refused`,
        };
      }
      buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else {
      throw new TypeError('durableWrite: data must be a string, Buffer or Uint8Array (a programmer error, not a runtime condition — no receipt can help with it)');
    }
  } catch (e) {
    if (e instanceof TypeError) throw e;
    const c = classify(e);
    return { ...r, state: REFUSED, class: c.class, errno: c.errno, reason: `could not materialise the payload: ${c.why}` };
  }
  r.bytes = buf.length;
  r.sha256 = sha256(buf);

  const dir = dirname(path);
  if (mkdir) {
    try {
      f.mkdirSync(dir, { recursive: true });
    } catch (e) {
      const c = classify(e);
      // Nothing has been touched yet, so this is a refusal, not a failure.
      return { ...r, state: REFUSED, class: c.class, errno: c.errno, reason: `parent directory ${dir} is not usable: ${c.why}` };
    }
  }

  // ── 1. Preflight ─────────────────────────────────────────────────────────
  r.preflight = preflight(path, buf.length, { io: f, env, headroom });
  if (r.preflight.state === SPACE_INSUFFICIENT) {
    return {
      ...r, state: REFUSED, class: 'no-space', errno: null,
      reason: `refused on preflight: ${r.preflight.why}`,
    };
  }
  // SPACE_UNKNOWN falls through ON PURPOSE and carries its greyness into the receipt. Refusing on
  // ignorance would fail every write on a filesystem we cannot measure; passing it off as OK would
  // publish an unknown as a green. It proceeds, and it says it did not know.

  // The tmp file lives beside the target: same directory, therefore same filesystem, therefore the
  // rename is atomic. The suffix carries pid and randomness so eight concurrent sessions on one
  // tree cannot collide. The tmp path is DIAGNOSTIC, not data — it is the one non-deterministic
  // field in the receipt, and it is here because a cleanup failure is unreportable without it.
  const tmp = tmpPath || join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  r.tmp.path = tmp;

  // Cleanup is its own function because it runs from five different failure points and MUST NOT be
  // swallowed at any of them: a tmp file left behind after an ENOSPC is more space consumed on a
  // full disk, which is how one failure becomes a cascade.
  const cleanup = () => {
    try {
      f.unlinkSync(tmp);
      r.tmp.cleaned = true;
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        // The only benign case, and it is decided by the errno of the unlink itself, not by a
        // message match: the tmp was never created or is already gone.
        r.tmp.cleaned = true;
        return;
      }
      const c = classify(e);
      r.tmp.cleaned = false;
      r.tmp.cleanupReason = `tmp file ${tmp} could not be removed (${c.errno || 'no errno'}): ${c.why} — it is still occupying space`;
    }
  };

  let fd = null;
  try {
    // ── 2. Write the tmp ───────────────────────────────────────────────────
    // 'wx' — exclusive create. If something already sits at our tmp path, that is a collision or a
    // leftover, and clobbering it blind would destroy another session's in-flight write.
    fd = f.openSync(tmp, 'wx', mode == null ? 0o600 : mode);
    r.partial.started = true;

    // An explicit writeSync loop rather than writeFileSync, for one reason: writeFileSync tells you
    // nothing about how far it got. A short write is not an error and a failed write is not
    // "nothing was written" — the loop keeps the offset, so the receipt can say how many bytes
    // reached the file before it stopped. That number is what tells a human whether the disk went
    // full at byte 0 or byte 40 million.
    let off = 0;
    while (off < buf.length) {
      const n = f.writeSync(fd, buf, off, buf.length - off);
      if (!(n > 0)) {
        // Zero progress with no error thrown: not a condition POSIX should produce, and looping on
        // it forever is worse than reporting it.
        throw Object.assign(new Error(`writeSync made no progress at offset ${off}`), { code: 'ENOSPC' });
      }
      off += n;
      r.partial.bytesWritten = off;
    }
    r.durability.tmpWrite = HELD;

    // Preserve the target's permissions across the replace. rename() gives the target the TMP's
    // mode, so a 0600 store silently becomes 0644 on the first durable rewrite — a real disclosure,
    // introduced by the very code meant to protect the file.
    if (mode == null) {
      try {
        const prev = f.statSync(path);
        f.fchmodSync(fd, prev.mode & 0o7777);
      } catch (e) {
        // ENOENT here is the ordinary first-write case and carries no information. Anything else is
        // a fact about the target we should not silently discard.
        if (!e || e.code !== 'ENOENT') {
          r.notes.push(`could not read the existing target's mode (${e && e.code}); the replacement will carry 0600 instead of inheriting`);
        }
      }
    }

    // ── 3. fsync the FILE ──────────────────────────────────────────────────
    try {
      f.fsyncSync(fd);
      r.durability.fileFsync = HELD;
    } catch (e) {
      // EINVAL from fsync on a filesystem that does not implement it (some network and virtual
      // filesystems) is a genuine absence of the guarantee, not a write failure. Record it and
      // continue: the write is still atomic via rename, it is just not proven durable.
      if (e && (e.code === 'EINVAL' || e.code === 'ENOTSUP')) {
        r.durability.fileFsync = UNSUPPORTED;
      } else {
        throw e;
      }
    }

    f.closeSync(fd);
    fd = null;

    // ── 4. Rename ──────────────────────────────────────────────────────────
    f.renameSync(tmp, path);
    r.durability.rename = HELD;
    r.partial.targetReplaced = true;
    // Not "cleaned" and not "not-created": the tmp WAS created and then BECAME the target. Saying
    // "not-created" of a file that existed is a small lie, and small lies in a receipt are how a
    // reader learns not to trust the rest of it.
    r.tmp.cleaned = 'became-target';

    // ── 5. fsync the DIRECTORY ─────────────────────────────────────────────
    // The step most often missed, and the one that makes the rename itself durable. Without it a
    // power loss can roll the directory entry back to the OLD file while the new bytes sit fsynced
    // and unreferenced.
    //
    // The OPEN and the FSYNC are two different questions and must not share a verdict — the first
    // version of this code gave them one, and a Windows-shaped EPERM on the directory open was
    // reported as a FAILED sync. That is grey published as red, which CLAUDE.md names as the
    // costlier direction: a caller reading `dirFsync: failed` would conclude the rename is at risk
    // on a platform that simply has no such syscall to offer.
    //
    //   open refused    => we never got a handle, so the step could not be ATTEMPTED. On Windows a
    //                      directory is not openable as a file at all; on POSIX a directory we can
    //                      write into but not read is the same shape. UNSUPPORTED — grey.
    //   fsync refused   => we HAD the handle and the kernel declined. EINVAL/ENOTSUP mean the
    //                      filesystem does not implement it (grey); anything else is a real failure
    //                      of a real attempt (red).
    let dfd = null;
    try {
      try {
        dfd = f.openSync(dir, 'r');
      } catch (e) {
        const code = e && e.code;
        // "No directory handle for you" — the platform/filesystem cannot offer the guarantee.
        if (process.platform === 'win32' || code === 'EPERM' || code === 'EACCES' || code === 'EISDIR' || code === 'ENOTSUP' || code === 'EINVAL') {
          r.durability.dirFsync = UNSUPPORTED;
          r.notes.push(`directory fsync unavailable: opening ${dir} for fsync failed with ${code || 'no errno'}${process.platform === 'win32' ? ' (expected on Windows — a directory has no file handle, and NTFS metadata journaling makes rename durability likely but not guaranteed)' : ''}. The bytes are written and the rename completed; the DURABILITY OF THE RENAME is undetermined.`);
        } else {
          // EIO, ENOSPC, EMFILE on a directory open are real faults and are not excused.
          r.durability.dirFsync = STEP_FAILED;
          r.notes.push(`directory fsync failed: could not open ${dir} (${code || 'no errno'}) — the rename may not survive a crash`);
        }
        throw { __handled: true };
      }
      try {
        f.fsyncSync(dfd);
        r.durability.dirFsync = HELD;
      } catch (e) {
        if (e && (e.code === 'EINVAL' || e.code === 'ENOTSUP')) {
          r.durability.dirFsync = UNSUPPORTED;
          r.notes.push(`directory fsync unsupported by this filesystem (${e.code}) — the rename's durability is undetermined`);
        } else {
          r.durability.dirFsync = STEP_FAILED;
          r.notes.push(`directory fsync failed (${e && e.code}): the rename may not survive a crash`);
        }
      }
    } catch (e) {
      // Only the sentinel above reaches here; anything else is a bug and must not be swallowed.
      if (!(e && e.__handled)) throw e;
    } finally {
      if (dfd !== null) { try { f.closeSync(dfd); } catch { /* the outcome above is the reportable one */ } }
    }

    // ── 6. Read back and compare ───────────────────────────────────────────
    if (verify) {
      try {
        // Read as a BUFFER, never a string: readFileSync with an encoding throws
        // ERR_STRING_TOO_LONG above V8's ~512 MB string ceiling, so the verification step would be
        // the thing that OOMs on a large-but-legal payload.
        const back = f.readFileSync(path);
        const got = sha256(back);
        if (got !== r.sha256) {
          r.durability.readback = STEP_FAILED;
          return {
            ...r, ok: false, state: FAILED, class: 'io',
            reason: `readback hash mismatch: wrote ${r.bytes} bytes hashing ${r.sha256}, read back ${back.length} bytes hashing ${got} — the filesystem accepted the write and stored something else`,
            guarantees: guaranteesFrom(r.durability),
          };
        }
        r.durability.readback = HELD;
      } catch (e) {
        const c = classify(e);
        r.durability.readback = STEP_FAILED;
        return {
          ...r, ok: false, state: FAILED, class: c.class, errno: c.errno,
          reason: `the write completed but could not be read back: ${c.why} — the file's contents are UNVERIFIED, which is not the same as wrong and not the same as right`,
          guarantees: guaranteesFrom(r.durability),
        };
      }
    }

    return { ...r, ok: true, state: WRITTEN, guarantees: guaranteesFrom(r.durability) };
  } catch (e) {
    const c = classify(e);
    if (fd !== null) { try { f.closeSync(fd); } catch { /* the write failure is the reportable one */ } }
    // A write error NEVER means "wrote nothing" — partial.bytesWritten says what we know. The tmp
    // must go, and if it will not go, that is reported rather than swallowed.
    if (r.partial.started && !r.partial.targetReplaced) cleanup();
    return {
      ...r, ok: false, state: FAILED, class: c.class, errno: c.errno,
      reason: `${c.why}${r.partial.bytesWritten ? ` (${r.partial.bytesWritten} of ${r.bytes} bytes had already reached the temporary file)` : ''}`,
      guarantees: guaranteesFrom(r.durability),
    };
  }
}

/**
 * JSON convenience. The stringify is inside the try because JSON.stringify is itself an OOM site —
 * a large object throws RangeError "Invalid string length" with no errno, which an errno-keyed
 * handler drops on the floor.
 */
export function durableWriteJson(path, value, opts = {}) {
  const env = opts.env || process.env;
  let text;
  try {
    text = JSON.stringify(value, null, opts.indent === undefined ? 2 : opts.indent);
  } catch (e) {
    const c = classify(e);
    return {
      ...baseReceipt(path, env), state: REFUSED, class: c.class, errno: c.errno,
      reason: `could not serialise the value: ${c.why}`,
    };
  }
  if (typeof text !== 'string') {
    return { ...baseReceipt(path, env), state: REFUSED, class: 'unknown', reason: 'JSON.stringify produced undefined — the value is not serialisable' };
  }
  return durableWrite(path, `${text}\n`, opts);
}

/**
 * Append one line to a JSONL ledger, durably.
 *
 * A ledger cannot be rewritten atomically — that is the point of an append-only file — so this
 * gets a WEAKER guarantee than durableWrite, and says so in the receipt rather than implying
 * parity. What it does buy:
 *   · preflight, so a full disk refuses instead of writing half a row;
 *   · one appendFileSync call, so the row is a single write syscall (atomic up to PIPE_BUF-ish
 *     sizes on local filesystems, and never guaranteed on NFS — recorded, not claimed);
 *   · fsync, so a completed row survives a crash.
 * A partial row is the failure mode this cannot fully prevent, and `partial.bytesWritten` plus the
 * file size before and after are what let a reader find one. The JSONL ledger named in this
 * module's header stopped on Aug 31 with nobody noticing; a receipt per append is the fix for the
 * noticing, and the ceiling below is the fix for a caller that buffers a whole day into one line.
 */
export function durableAppendLine(path, line, { io = null, env = process.env, max = null, headroom = null } = {}) {
  const f = { ...defaultIO(), ...(io || {}) };
  const r = baseReceipt(path, env);
  r.tmp = { path: null, cleaned: 'not-created', cleanupReason: 'append does not use a temporary file — this write is not atomically replaceable' };

  if (typeof line !== 'string') throw new TypeError('durableAppendLine: line must be a string');
  if (line.includes('\n')) throw new TypeError('durableAppendLine: line must not contain a newline — one call is one row, or the ledger\'s row boundaries stop meaning anything');

  const ceiling = max == null ? maxBytes(env) : max;
  const payload = `${line}\n`;
  const size = Buffer.byteLength(payload, 'utf8');
  if (size > ceiling) {
    return { ...r, state: REFUSED, class: 'too-large', bytes: size, reason: `row is ${size} bytes, ceiling is ${ceiling} — refused rather than appending a row no reader can parse back` };
  }
  r.bytes = size;
  r.sha256 = sha256(Buffer.from(payload, 'utf8'));

  try { f.mkdirSync(dirname(path), { recursive: true }); } catch (e) {
    const c = classify(e);
    return { ...r, state: REFUSED, class: c.class, errno: c.errno, reason: `parent directory not usable: ${c.why}` };
  }

  r.preflight = preflight(path, size, { io: f, env, headroom });
  if (r.preflight.state === SPACE_INSUFFICIENT) {
    return { ...r, state: REFUSED, class: 'no-space', reason: `refused on preflight: ${r.preflight.why}` };
  }

  let fd = null;
  try {
    fd = f.openSync(path, 'a');
    // Size BEFORE the append, so a failure can be described in terms a reader can act on.
    let before = null;
    try { before = f.fstatSync(fd).size; } catch { /* undetermined; the append still proceeds */ }

    const buf = Buffer.from(payload, 'utf8');
    let off = 0;
    while (off < buf.length) {
      const n = f.writeSync(fd, buf, off, buf.length - off);
      if (!(n > 0)) throw Object.assign(new Error(`append made no progress at offset ${off}`), { code: 'ENOSPC' });
      off += n;
      r.partial.started = true;
      r.partial.bytesWritten = off;
    }
    r.durability.tmpWrite = HELD;    // "the bytes were written"; there is no tmp in this path

    try {
      f.fsyncSync(fd);
      r.durability.fileFsync = HELD;
    } catch (e) {
      if (e && (e.code === 'EINVAL' || e.code === 'ENOTSUP')) r.durability.fileFsync = UNSUPPORTED;
      else throw e;
    }
    f.closeSync(fd);
    fd = null;

    // No rename, so no directory fsync is needed for THIS write — the directory entry already
    // existed. It is genuinely not-attempted rather than missing, and the receipt distinguishes
    // those. (A brand-new ledger file is the exception; a caller that cares should durableWrite an
    // empty file first.)
    r.durability.rename = NOT_ATTEMPTED;
    r.durability.dirFsync = NOT_ATTEMPTED;

    return {
      ...r, ok: true, state: WRITTEN,
      offsetBefore: before,
      guarantees: {
        // Deliberately NOT claimed. An append is not an atomic replace, and dressing it as one is
        // the same error as publishing an unknown as a pass.
        atomicRename: false,
        fileDurable: r.durability.fileFsync === HELD,
        dirDurable: 'unknown',
      },
    };
  } catch (e) {
    const c = classify(e);
    if (fd !== null) { try { f.closeSync(fd); } catch { /* the append failure is the reportable one */ } }
    return {
      ...r, ok: false, state: FAILED, class: c.class, errno: c.errno,
      reason: `${c.why}${r.partial.bytesWritten ? ` — ${r.partial.bytesWritten} of ${r.bytes} bytes of this row reached the ledger and the row is now TRUNCATED; a reader must treat the last line as suspect` : ''}`,
      guarantees: { atomicRename: false, fileDurable: false, dirDurable: 'unknown' },
    };
  }
}

// ── Verifying a store after an unclean shutdown ─────────────────────────────

/**
 * Is this SQLite store actually readable, and does it still hold what it held?
 *
 * THE RULE THIS ENFORCES: an unreadable store is never reported as an EMPTY one. Reporting an
 * unreadable store as empty invents a data-loss event that did not happen, and — worse — hides the
 * one that did, because "0 rows" reads as a quiet week rather than as a wedged file.
 *
 * MEASURED ON THIS RUNTIME (Node 24.16.0, node:sqlite), and each measurement changed the code:
 *
 *   · A ZERO-BYTE FILE OPENS FINE, PASSES `PRAGMA integrity_check` WITH "ok", AND REPORTS ZERO
 *     TABLES. That is precisely what an ENOSPC truncation leaves behind, and it is precisely what a
 *     naive checker calls a healthy empty database. It gets its own verdict, STORE_TRUNCATED, and
 *     it is never `ok`. This is the single highest-value line in the module: without it the check
 *     that exists to catch data loss is the check that certifies it.
 *
 *   · LATE-PAGE CORRUPTION OPENS FINE AND READS sqlite_master FINE — `PRAGMA integrity_check` then
 *     THROWS "database disk image is malformed" rather than returning rows saying so. So the
 *     integrity_check call needs its own try/catch, and a throw there is CORRUPT, not a checker
 *     bug and not an empty store. A checker that only inspected the returned rows would have
 *     reported nothing at all.
 *
 *   · A READ-ONLY OPEN OF A MISSING FILE AND OF AN UNREADABLE ONE PRODUCE THE SAME MESSAGE,
 *     "unable to open database file" (errcode 14). They are opposite facts. Absence is therefore
 *     decided by stat() and by nothing else — see lib/memory-store.mjs openForRead(), and see
 *     admin/lib/overwatch-layer-read.mjs:84-90 for the anti-pattern this replaces.
 *
 * node:sqlite is imported lazily so this module stays usable on a runtime without it (Node < 22) —
 * durableWrite has no such dependency and should not inherit one.
 *
 * @returns {{state:string, ok:boolean, path:string, bytes:number|null, tables:number|null,
 *            errno:string|null, why:string|null, at:string}}
 */
export function verifySqlite(path, { io = null, env = process.env, sqlite = null, deep = true } = {}) {
  const f = { ...defaultIO(), ...(io || {}) };
  const out = { state: STORE_UNREADABLE, ok: false, path, bytes: null, tables: null, errno: null, why: null, at: now(env) };

  // ── Absence is a question for stat(), and only for stat() ────────────────
  let st;
  try {
    st = f.statSync(path);
  } catch (e) {
    const c = classify(e);
    if (c.errno === 'ENOENT') {
      // The ONE legitimate absence. Note it is still not "empty": a caller must decide whether a
      // store that should exist and does not is a fresh install or a deletion.
      return { ...out, state: STORE_ABSENT, ok: false, errno: 'ENOENT', why: 'no file at this path — legitimately absent, which is not the same as empty' };
    }
    return { ...out, errno: c.errno, why: `cannot stat the store: ${c.why} — present-or-absent is undetermined, so it is treated as unreadable` };
  }
  out.bytes = st.size;

  if (st.isDirectory && st.isDirectory()) {
    return { ...out, why: 'a directory sits where the store should be' };
  }

  // ── The zero-byte trap ───────────────────────────────────────────────────
  if (st.size === 0) {
    return {
      ...out, state: STORE_TRUNCATED, ok: false,
      why: 'the file exists and is zero bytes. SQLite accepts this as a valid empty database and PRAGMA integrity_check returns "ok" — which is why it is reported here as TRUNCATED and never as a healthy empty store. A full disk produces exactly this file.',
    };
  }

  // A real SQLite file starts with "SQLite format 3\0". A first-16-byte check costs nothing and
  // catches a store overwritten by something else entirely — a case where integrity_check may
  // simply refuse to open and hand back the same ambiguous errcode 14 as a missing file.
  try {
    const head = f.readFileSync(path);
    const magic = head.subarray(0, 16).toString('latin1');
    if (magic !== 'SQLite format 3\0') {
      return { ...out, why: `the file does not begin with the SQLite header (found ${JSON.stringify(magic.slice(0, 16))}) — it is not a database, and calling it empty would invent a data-loss event` };
    }
  } catch (e) {
    const c = classify(e);
    return { ...out, errno: c.errno, why: `cannot read the store's header: ${c.why}` };
  }

  // `sqlite` is the injection point: a test hands in a constructor that throws the errno it wants
  // to prove the handler for.
  let DatabaseSync = sqlite;
  if (!DatabaseSync) {
    try {
      ({ DatabaseSync } = loadSqlite());
    } catch (e) {
      // Not healthy and not broken. A runtime that cannot open the store has told us nothing about
      // the store.
      return { ...out, why: `node:sqlite is unavailable on this runtime (${e && e.message}) — the store's health is UNDETERMINED` };
    }
  }

  let db = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (e) {
    // errcode is SQLite's own; 11 is SQLITE_CORRUPT. We reached here having already proved the file
    // exists and carries the header, so "unable to open" can no longer mean "missing".
    const errcode = e && e.errcode;
    return {
      ...out,
      state: errcode === 11 ? STORE_CORRUPT : STORE_UNREADABLE,
      errno: (e && e.code) || null,
      why: `read-only open failed: ${e && e.message}${errcode ? ` (sqlite errcode ${errcode})` : ''}`,
    };
  }

  try {
    // Cheap liveness first: a store whose schema page cannot be read is finished, and this reads
    // one page rather than the whole file.
    const t = db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    out.tables = t && typeof t.n === 'number' ? t.n : null;

    if (deep) {
      // integrity_check walks every page — the only check that catches the damage a failed mmap
      // grow leaves behind, and the one that THROWS rather than reporting when the damage is bad
      // enough. Both outcomes are handled; neither is "empty".
      let rows;
      try {
        rows = db.prepare('PRAGMA integrity_check').all();
      } catch (e) {
        return {
          ...out, state: STORE_CORRUPT, errno: (e && e.code) || null,
          why: `PRAGMA integrity_check threw rather than reporting: ${e && e.message} — measured on this runtime, a corrupt interior page produces exactly this, so a checker that only inspects returned rows sees nothing wrong`,
        };
      }
      const verdicts = (rows || []).map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? ''));
      if (!(verdicts.length === 1 && verdicts[0] === 'ok')) {
        return {
          ...out, state: STORE_CORRUPT,
          why: `integrity_check reported ${verdicts.length} problem(s): ${verdicts.slice(0, 5).join('; ')}${verdicts.length > 5 ? ` … and ${verdicts.length - 5} more` : ''}`,
        };
      }
    }

    return {
      ...out, state: STORE_OK, ok: true,
      why: out.tables === 0
        // A non-zero-byte, header-valid, integrity-clean database with no tables is a real state:
        // a freshly created store nobody has migrated. It is `ok` and it is flagged, because it is
        // ALSO what a caller would see if a store had been replaced by a fresh one.
        ? 'readable and intact, and it holds no tables — a fresh store, or one that was replaced by a fresh one'
        : null,
    };
  } catch (e) {
    const c = classify(e);
    return { ...out, errno: c.errno, why: `the store opened but could not be queried: ${e && e.message} — unreadable, never empty` };
  } finally {
    if (db) { try { db.close(); } catch { /* nothing left to report */ } }
  }
}

/**
 * node:sqlite, loaded on FIRST USE rather than at import. durableWrite has no database dependency
 * and must stay usable on a runtime that lacks node:sqlite (Node < 22); a static import here would
 * make the whole module unloadable there. createRequire rather than a dynamic import, because
 * verifySqlite is synchronous and must stay so — an async verifier cannot be called from the
 * synchronous write path that needs it.
 */
let _sqlite = null;
function loadSqlite() {
  if (_sqlite === null) _sqlite = createRequire(import.meta.url)('node:sqlite');
  return _sqlite;
}

// ── Reporting ───────────────────────────────────────────────────────────────

/**
 * One line a human can read, from any receipt this module returns. Three-valued throughout: the
 * summary must be able to say "I could not tell", because that is the state that was missing.
 */
export function summarise(receipt) {
  if (!receipt) return 'no receipt — the write was never attempted, which is not a success';
  const g = receipt.guarantees || {};
  const parts = [];
  if (receipt.state === WRITTEN) {
    parts.push(`wrote ${receipt.bytes} bytes to ${receipt.path}`);
    // Always printed, even when everything held: a guarantee that is only mentioned when it breaks
    // is a guarantee nobody is watching.
    parts.push(`atomic:${g.atomicRename === true ? 'yes' : g.atomicRename === false ? 'NO' : 'unknown'}`);
    parts.push(`file-fsync:${g.fileDurable === true ? 'yes' : g.fileDurable === false ? 'NO' : 'unknown'}`);
    parts.push(`dir-fsync:${g.dirDurable === true ? 'yes' : g.dirDurable === false ? 'NO' : 'unknown'}`);
    if (receipt.durability && receipt.durability.readback === HELD) parts.push('readback:verified');
    else parts.push('readback:NOT VERIFIED');
    if (receipt.preflight && receipt.preflight.state === SPACE_UNKNOWN) parts.push('free space was undetermined at preflight');
  } else if (receipt.state === REFUSED) {
    parts.push(`REFUSED (${receipt.class}) — nothing was written and nothing was damaged: ${receipt.reason}`);
  } else {
    parts.push(`FAILED (${receipt.class}${receipt.errno ? `/${receipt.errno}` : ''}): ${receipt.reason}`);
    if (receipt.partial && receipt.partial.started) {
      parts.push(`${receipt.partial.bytesWritten} bytes had already been written — a write error never means nothing was written`);
    }
  }
  if (receipt.tmp && receipt.tmp.cleaned === false) parts.push(`TEMP FILE NOT REMOVED: ${receipt.tmp.cleanupReason}`);
  // Degradations reach the human. A note nobody prints is a note nobody has.
  for (const n of receipt.notes || []) parts.push(n);
  return parts.join('; ');
}

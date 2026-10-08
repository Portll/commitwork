// Windows filename hazards — MEASURED on Windows 11 with node v24.14.1 on 2026-09-04, not
// inherited from folklore. Two of the four hazards everyone repeats did not reproduce, and saying
// so is the point: a guard that asserts four dangers when one exists is the same over-reporting
// this repo treats as more expensive than a miss.
//
// This module exists because commitwork derives filenames from attacker-influenceable strings —
// repository names, rule ids, package names, finding keys, paths out of scanner output. An agent
// pointed at a hostile repository never types those; it passes them along, into a write.
//
// ── WHAT REPRODUCED ─────────────────────────────────────────────────────────────────────────────
//
// 1. `:` CREATES AN ALTERNATE DATA STREAM, SILENTLY. Measured:
//        writeFileSync('evid:hidden.json', 'SECRET')   -> succeeds, no error
//        readFileSync('evid:hidden.json')              -> 'SECRET'   (round-trips!)
//        readdirSync(dir)                              -> ['evid']   (the name is GONE)
//        statSync('evid').size                         -> 0
//    So the data is written and is readable BY THAT EXACT PATH, which is what makes it dangerous:
//    a naive round-trip test passes. What cannot see it is everything that enumerates or measures
//    — directory listings, size checks, archivers, the emptiness second-witness, any rollup that
//    walks a report directory. Evidence that exists and is invisible is worse than evidence that
//    failed to write, because nothing anywhere reports a problem.
//    `:` arrives naturally: Maven coordinates (`group:artifact:version`), timestamps, CVE prose.
//
// 2. `< > | ? *` FAIL WITH **ENOENT**. Measured: every one of them throws, and the code is ENOENT
//    — not EINVAL, not ENAMETOOLONG. This repo's stated rule is that *only ENOENT means
//    legitimately absent*. So a report that could not be written, or read, because its name held an
//    illegal character is indistinguishable from a report that was legitimately never produced.
//    A write failure converted into a clean lane. This is the same shape as the MAX_PATH story
//    below, reached by a trigger that actually exists.
//
// ── WHAT DID NOT REPRODUCE, and is recorded so nobody re-adds it as a claim ─────────────────────
//
// 3. RESERVED DEVICE NAMES. `NUL`, `CON`, `COM1`, and `NUL.json` all wrote, listed and read back
//    their real contents. Node passes `\\?\`-prefixed paths to the Win32 API, which disables
//    device-name parsing. The received wisdom that a write to `NUL.json` is discarded is FALSE
//    through node's fs on this platform.
// 4. TRAILING DOTS AND SPACES. `tf`, `tf.` and `tf ` were three DISTINCT files, each reading back
//    its own contents, all three listed. Also `\\?\`. The "they collapse onto one file" claim is
//    likewise false here.
// 5. MAX_PATH. A 303-character directory was created without complaint and behaved normally.
//
// Cases 3-5 are still REPORTED by nameHazard(), but the distinction is kept in the flags: node is
// not the only reader of these directories. cmd.exe, Explorer, zip and tar implementations, and any
// non-node consumer do apply Win32 munging, so a name that is fine for us can still be one an
// operator cannot open or an archive cannot restore. That is an interop concern worth naming, not a
// silent-data-loss hazard, and it is not reported as one (`interopOnly`, never `silent`).
//
// ── THE SANITISER WAS REMOVED, AND WHY THAT IS THE RIGHT ANSWER ─────────────────────────────────
// This module shipped with safeName()/safeJoin()/unsafeName() — a reversible, collision-free
// percent-encoder for turning a hostile string into a usable filename. They were deleted on the day
// they were written, because a census of the call sites found there were none, and the reason there
// were none is the interesting part:
//
//   * The annotation and anchor stores key findings INSIDE one JSON document. There is no
//     per-finding filename anywhere, so no scanner-derived text ever becomes a path segment.
//   * Where a caller-supplied name DOES shape a path, this codebase already VALIDATES rather than
//     sanitises — admin/lib/core.mjs `reportsFor()` requires `/^[a-z0-9][a-z0-9._-]*$/i` and
//     returns UNRESOLVED otherwise.
//
// Validation is the stronger choice and should stay the convention. A sanitiser accepts every input
// and quietly produces *something*, which means a caller can never tell a clean name from a
// laundered hostile one; an allowlist refuses, loudly, and the refusal is the signal. Keeping an
// unused encoder beside a working allowlist would have been a second way to do the same job, and
// the weaker way — read as protection in every review, executing nothing.
//
// What remains is the half with a real caller: classifyFsError(), wired into admin/auth.mjs, where
// ENOENT-means-absent decides whether the panel is in bootstrap mode.

import { win32, posix } from 'node:path';

// Win32 reserved device names. Kept for the interop case only — see 3 above.
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
// Characters that FAIL on this platform. `:` is excluded here because it does not fail — it
// silently succeeds, which is hazard 1 and is reported separately and more loudly.
const ILLEGAL = /[<>"|?*]/;
const TRAILING = /[. ]$/;
// Control characters are tested by CODE POINT, never by a regex range. A literal U+0000-U+001F
// range inside a character class is exactly the sort of thing an editor, a heredoc or a codemod
// eats silently — this file was written twice with real NUL bytes embedded before a byte census
// caught them. A numeric predicate cannot be mangled into something that still parses.
const CONTROL_MAX = 0x1f;
const isControl = (ch) => ch.charCodeAt(0) <= CONTROL_MAX;
const hasControlChar = (s) => Array.from(String(s)).some(isControl);

/** Windows' documented limit without the long-path opt-in. Node exceeds it; see 5 above. */
export const MAX_PATH = 260;

/**
 * -> null when `name` is a safe Windows FILENAME (one segment), else a hazard record.
 *
 * `silent: true` means the operation SUCCEEDS and the data becomes invisible — the only kind that
 * can produce a false clean without anything erroring. `silent: false` covers both loud failures
 * and interop-only concerns; `enoent: true` marks the ones whose loud failure arrives wearing
 * ENOENT, which this codebase reads as legitimate absence.
 */
export function nameHazard(name) {
  const s = String(name ?? '');
  if (!s) return { hazard: 'empty', why: 'an empty filename', silent: false };
  if (s.includes('/') || s.includes('\\')) {
    return { hazard: 'separator', why: 'contains a path separator — this checks ONE segment, not a path', silent: false };
  }
  if (s.includes(':')) {
    return {
      hazard: 'ads',
      why: 'contains ":" — on NTFS this writes an ALTERNATE DATA STREAM. Measured: the write '
        + 'succeeds, the same path reads the data back, but readdir does not list it and the base '
        + 'file stats as 0 bytes. Invisible to every enumeration, size check and archive.',
      silent: true,
    };
  }
  const bad = ILLEGAL.exec(s);
  if (bad) {
    return {
      hazard: 'illegal',
      why: `contains ${JSON.stringify(bad[0])}, which Windows rejects — and measured, it fails with `
        + 'ENOENT, the one code this codebase reads as "legitimately absent". A write that could '
        + 'not happen becomes a lane with nothing to report.',
      silent: false,
      enoent: true,
    };
  }
  if (hasControlChar(s)) {
    return { hazard: 'control', why: 'contains a control character, which Windows rejects (also as ENOENT)', silent: false, enoent: true };
  }
  if (RESERVED.test(s)) {
    return {
      hazard: 'reserved',
      why: `"${s}" is a reserved Win32 device name. Measured: node reads and writes it correctly `
        + '(it uses \\\\?\\ paths), so this is an INTEROP concern — cmd.exe, Explorer and archive '
        + 'tools may not be able to open it — not silent data loss.',
      silent: false,
      interopOnly: true,
    };
  }
  if (TRAILING.test(s)) {
    return {
      hazard: 'trailing',
      why: 'ends with a dot or space. Measured: node keeps such names distinct and reads them back '
        + 'correctly, so this is an INTEROP concern for non-node readers, not a collision.',
      silent: false,
      interopOnly: true,
    };
  }
  return null;
}

/**
 * Classify an fs error so that "absent" keeps meaning absent.
 *
 * THE RULE THIS PROTECTS: *only ENOENT means legitimately absent*. Measured on Windows, ENOENT is
 * ALSO what you get for a filename containing `< > " | ? *` or a control character — so without
 * this, an unwritable or unreadable report is indistinguishable from one that was never produced.
 * A caller must treat anything but 'absent' as a FAILURE.
 *
 * -> 'absent' | 'invalid-name' | 'too-long' | 'denied' | 'other'
 */
export function classifyFsError(err, path = '', { platform = process.platform } = {}) {
  const code = err && err.code;
  if (code === 'ENAMETOOLONG') return 'too-long';
  if (code === 'EACCES' || code === 'EPERM') return 'denied';
  if (code !== 'ENOENT') return 'other';
  if (platform !== 'win32') return 'absent';
  // On Windows, decide WHY the ENOENT happened rather than accepting it at face value.
  const p = String(path);
  const h = pathHazard(p, { platform: 'win32' });
  if (h && (h.enoent || h.hazard === 'illegal' || h.hazard === 'control')) return 'invalid-name';
  if (p.length >= MAX_PATH) return 'too-long';
  return 'absent';
}

/** -> a hazard record for a whole PATH, or null. Every segment, plus the length rule. */
export function pathHazard(path, { platform = process.platform } = {}) {
  const p = String(path ?? '');
  if (!p) return { hazard: 'empty', why: 'an empty path', silent: false };
  if (platform === 'win32' && p.length >= MAX_PATH) {
    return {
      hazard: 'too-long',
      why: `${p.length} characters, at or past the ${MAX_PATH}-character MAX_PATH limit. Measured: `
        + 'node handled a 303-character path here, so this is a warning for other consumers rather '
        + 'than a reproduced failure.',
      silent: false,
      interopOnly: true,
    };
  }
  const segments = p.split(/[/\\]+/).filter(Boolean);
  // A drive letter's colon is legitimate and is not an ADS. Whether `C:/x` is absolute is a fact of
  // the platform asked about, not the host: POSIX's path module reads it as a relative name.
  const { isAbsolute } = platform === 'win32' ? win32 : posix;
  const start = isAbsolute(p) && /^[A-Za-z]:$/.test(segments[0] || '') ? 1 : 0;
  for (let i = start; i < segments.length; i += 1) {
    const h = nameHazard(segments[i]);
    if (h) return { ...h, segment: segments[i] };
  }
  return null;
}

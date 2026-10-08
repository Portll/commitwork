// commitwork monitor — the HASH-CHAINED history log (history/chain.jsonl).
//
// WHY A SEPARATE LOG AND NOT CHAIN FIELDS ON index.json ROWS. The index is not append-only by
// design: a re-roll of the same batch legitimately drops its own prior row and appends a fresh one
// (rollup.mjs dedupes v1 rows by `source`). A chain over index rows would therefore break on every
// honest re-roll — teaching people that "chain broken" is routine, which is how a tamper signal
// gets switched off. So the chain lives HERE, over WRITE EVENTS: every slice write, every
// replacement, and every retro-seal appends one line that binds the previous line's hash. A
// correction is then RECORDED IN the chain rather than breaking it, and the verifier cross-checks
// that every index row has an event behind it — an index row with no chain event is an unrecorded
// write, and it is named, not smoothed over.
//
// APPEND-ONLY, DELIBERATELY NOT tmp+rename. Rewriting the whole log to add a line would give every
// writer a moment where the entire history of writes is one torn rename from gone; appendFileSync
// of one short line (the LOG.md pattern in this repo) risks only the tail. A torn tail is
// DETECTED, not hidden: the verifier reports `tailTorn` and verifies the intact prefix, because
// "the last line is half-written" and "the chain is forged" are different facts and must render
// differently.
//
// WHAT THE CHAIN PROVES — and what it does not. From the first sealed line forward, no recorded
// state can be dropped, reordered or edited without `verified:false` naming the break. Lines with
// op:'retro-seal' attest bytes as found AT SEAL TIME: they prove continuity from the seal forward
// and nothing about the pre-seal past — the verifier carries `retroSealed` so no surface can claim
// otherwise. Determinism: the hashed body is built by eventBody() with a FIXED key order; two
// writers on two days hashing the same event get the same bytes.
//
// TWO HASHED BODIES, CHOSEN PER LINE. Lines without `chainVersion` (everything before 2026-09-06)
// hash six fixed fields — `note`, `resealedAt`, `preScrubMismatch` and anything else on the line
// were editable without breaking a hash, which is the gap a re-seal note could have hidden in.
// Lines with `chainVersion: 2` hash EVERY field except `prev`/`chain`, canonically (sorted keys,
// nested objects included). The verifier picks the body from the line's own `chainVersion`, so no
// re-seal is needed: old lines verify as written, new lines are fully bound, and a line whose
// version field is added, removed or changed after the fact recomputes under the wrong body and
// breaks. `v1Lines` / `protectedFrom` on the verdict say where full protection starts.
//
// WHAT v2 STILL DOES NOT STOP, measured rather than assumed: rewriting the WHOLE log — stripping
// every `chainVersion` and re-chaining from genesis under the v1 body — is self-consistent and
// verifies. It always was; per-line binding cannot fix it, because a chain rewritten entirely has
// no line left to disagree with. Only a tip held where the writer cannot reach it catches that,
// which is what the committed anchor is for. v2 closes the SELECTIVE edit (a note, a flag, a field
// added to one line); the committed anchor closes the wholesale one.

import { readFileSync, appendFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative, basename, sep } from 'node:path';
import { withinRoot } from '../lib/path-contain.mjs'; // `startsWith(root + '/')` is false on Windows
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sourceKey } from './area.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

export const GENESIS = '0'.repeat(64);
export const CHAIN_FILE = 'chain.jsonl';
const OPS = Object.freeze(['slice', 'replace', 'retro-seal', 'checkpoint']);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * The canonical hashed body — FIXED field order, independent of object key order or JSON
 * whitespace. `prev` is bound separately by chainOf(). Missing values hash as the literal
 * string 'absent' so "no sliceSha256 recorded" is itself part of what is attested.
 */
export function eventBody(e) {
  const f = (v) => (v === null || v === undefined || v === '' ? 'absent' : String(v));
  const base = [f(e.at), f(e.op), f(e.stamp), f(e.sliceId), f(e.source), f(e.sliceSha256)];
  // `by` — WHO wrote — is hashed ONLY when the event carries the field. Presence-based on
  // purpose: lines written before attribution existed verify unchanged, while stripping the
  // attribution off a newer line changes its hash. Deletion is tamper; absence-from-birth is
  // history. Every NEW line carries it (appendChainEvent supplies 'unattributed' rather than
  // omitting), so the unattributed state is a declared value, never a missing field.
  if (e.by !== undefined) base.push(f(e.by));
  return base.join('\n');
}

export const CHAIN_VERSION = 2;

// Canonical form of any JSON value: object keys sorted at every depth, arrays in order, undefined
// dropped (JSON.stringify drops it on write, so a line read back never has it). Two writers
// serialising the same event on different days produce the same string.
//
// REFUSES anything a chain line cannot hold. A line is read back from JSON, so only the JSON types
// can ever appear there — but a CALLER can pass a live object, and two of those hash to the same
// bytes while meaning different things: every Date canons to '{}' (measured 2026-09-06), so
// `{at: new Date(0)}` and `{at: new Date(9e11)}` would be one hash. A silent collision inside a
// hash function is worse than a throw at the call site, so non-JSON values are named and refused.
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return JSON.stringify(v);
  if (t === 'number') { if (!Number.isFinite(v)) throw new TypeError(`chain event holds a non-finite number (${v}) — it would hash as null`); return JSON.stringify(v); }
  if (t === 'object') {
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) {
      throw new TypeError(`chain event holds a ${v.constructor?.name || 'non-plain'} — hash it as a string, not as an object whose fields JSON drops`);
    }
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  throw new TypeError(`chain event holds a ${t} — not representable on a chain line`);
}

/** chainVersion 2: every field on the line except the binding pair, canonically. */
export function eventBodyV2(e) {
  const o = {};
  for (const k of Object.keys(e)) if (k !== 'prev' && k !== 'chain' && e[k] !== undefined) o[k] = e[k];
  return canon(o);
}

export const bodyVersion = (e) => (Number(e && e.chainVersion) >= 2 ? 2 : 1);

export function chainOf(prev, e) {
  return sha256(`${prev}\n${bodyVersion(e) === 2 ? eventBodyV2(e) : eventBody(e)}`);
}

export function chainPath(histDir) { return join(histDir, CHAIN_FILE); }

/**
 * Read the chain log. A torn tail line (the one append-only failure mode) is reported, never
 * silently dropped as if the log simply ended there: `tailTorn` carries the raw remnant length.
 * A parse failure ANYWHERE ELSE is corruption, not a torn append, and every later line is
 * unreadable in a log whose meaning is its order — reading stops there and says so.
 */
export function readChain(histDir, file = CHAIN_FILE) {
  const p = join(histDir, file);
  let raw;
  try { raw = readFileSync(p, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { present: false, events: [], tailTorn: false, error: null, path: p };
    return { present: false, events: [], tailTorn: false, error: `${e.code} reading ${p}`, path: p };
  }
  const lines = raw.split('\n').filter((l) => l.length);
  const events = [];
  let tailTorn = false;
  let error = null;
  for (let i = 0; i < lines.length; i++) {
    try { events.push(JSON.parse(lines[i])); }
    catch {
      if (i === lines.length - 1) { tailTorn = true; break; } // torn append — prefix stands
      error = `line ${i + 1} of ${lines.length} is not JSON — the log is corrupt from there and later lines cannot be trusted in order`;
      break;
    }
  }
  return { present: true, events, tailTorn, error, path: p };
}

/**
 * Append one write event, binding the previous line. Returns the appended line's record.
 * The caller supplies at/op/stamp/sliceId/source/sliceSha256; prev and chain are computed here
 * and only here, so no caller can write a line with a hand-picked hash.
 */
export function appendChainEvent(histDir, event) {
  if (!OPS.includes(event.op)) throw new Error(`chain op must be one of ${OPS.join('/')}, got "${event.op}"`);
  const { events, tailTorn, error } = readChain(histDir);
  if (error) throw new Error(`refusing to append to a corrupt chain: ${error}`);
  if (tailTorn) throw new Error('refusing to append after a torn tail line — repair (truncate the torn line) first, so the tear stays visible instead of being built on');
  // WHO wrote — always recorded on new lines and always hashed (see eventBody). Spine-aware
  // callers export CW_CHAIN_BY (a session id); everything else writes the literal 'unattributed',
  // a declared unknown rather than an omitted field.
  const by = event.by !== undefined ? String(event.by) : (process.env.CW_CHAIN_BY || 'unattributed');
  const evt = {
    at: event.at, op: event.op, stamp: event.stamp ?? null, sliceId: event.sliceId ?? null,
    source: event.source ?? null, sliceSha256: event.sliceSha256 ?? null, by,
  };
  let prev = events.length ? events[events.length - 1].chain : GENESIS;
  if (event.op === 'checkpoint') {
    // A checkpoint may only OPEN a chain: rotation archives the old log first, then opens the new
    // one with a line whose prev is the ARCHIVED TIP — so a rotated chain verifies end-to-end
    // through the rotation instead of starting a fresh genesis (a fresh genesis is exactly the
    // rewrite-from-scratch shape the anchors exist to catch; rotation must not imitate it).
    if (events.length) throw new Error('a checkpoint may only open an empty chain — archive first, then open');
    if (!/^[0-9a-f]{64}$/.test(String(event.prevTip || ''))) throw new Error('a checkpoint needs prevTip: the archived segment\'s tip hash');
    prev = String(event.prevTip);
  }
  const body = {
    ...evt,
    note: event.note ?? undefined,          // hashed from chainVersion 2 — see eventBodyV2
    chainVersion: CHAIN_VERSION,
  };
  const line = { ...body, prev, chain: chainOf(prev, body) };
  appendFileSync(chainPath(histDir), JSON.stringify(line) + '\n');
  return line;
}

/**
 * Retro-seal: append one 'retro-seal' event per index row that has no chain event yet, attesting
 * the row's recorded sliceSha256 (or, when the row predates R1b, the slice file's bytes as they
 * exist NOW — marked by note, because "hashed at seal time" is a weaker claim than "hashed at
 * write time" and the two must never be conflated). Idempotent: rows already covered are skipped.
 */
export function sealHistory(histDir, idx, nowISO) {
  const { events, error, tailTorn } = readChain(histDir);
  if (error || tailTorn) return { sealed: 0, refused: error || 'torn tail' };
  const covered = new Set(events.map((e) => String(e.stamp)));
  let sealed = 0;
  for (const row of idx || []) {
    const stamp = String(row.stamp || '');
    if (!stamp || covered.has(stamp)) continue;
    let sliceSha256 = row.sliceSha256 || null;
    let note = 'retro-sealed from the index row';
    if (!sliceSha256 && row.file) {
      try { sliceSha256 = sha256(readFileSync(join(histDir, row.file))); note = 'retro-sealed from slice bytes as found at seal time — attests nothing earlier'; }
      catch { sliceSha256 = null; note = 'retro-sealed with no hash: the row predates R1b and the slice file was unreadable at seal time'; }
    }
    appendChainEvent(histDir, { at: nowISO, op: 'retro-seal', stamp, sliceId: row.sliceId ?? null, source: row.source ?? null, sliceSha256, note });
    covered.add(stamp);
    sealed++;
  }
  return { sealed, refused: null };
}

// ── anchors: a copy of each area's chain tip OUTSIDE the directory that holds the chain ─────────
// The chain and the bytes it attests live in one directory, written by one uid. A hash chain
// detects a PARTIAL edit; a rewrite from genesis verifies perfectly (done deliberately on
// 2026-09-02, with a note on every row). So after each append the tip is copied to the sidecar
// store — a different git repo. Read at CALL time (CW_CHAIN_ANCHORS) so a test never anchors into
// the real store. Append-only, one short line, same torn-tail posture as the chain.
//
// What an anchor proves, and what it does not. The store path is a symlink into a working tree on
// the same disk: a writer who rewrites the chain can rewrite the anchor line too. `anchored:true`
// therefore means CONSISTENT WITH THE LOCAL ANCHOR — tamper evidence begins where the anchor was
// committed and pushed, and a verifier that reads sidecar HEAD is the check that says so. Absence
// of an anchor file is `anchored:false` with the reason named; it never upgrades `verified`.
export function anchorsPath() {
  return process.env.CW_CHAIN_ANCHORS || join(CW, '.claude', 'store', 'chain-tips.jsonl');
}

/**
 * May a rollup at `out` write the DEFAULT anchor store? A named store (CW_CHAIN_ANCHORS): always.
 * Otherwise only the default registry's own reports root qualifies. Two measured leaks shaped the
 * two refusals: 360 fixture anchors from scratch OUT dirs outside the root (2026-09-02), then 642
 * more from the 14 tests that set CW_REGISTRY to a fixture registry whose OWN reportsRoot contained
 * their OUT (2026-09-03). The registry check is by LOCATION, not presence: the real registry has
 * three possible paths (monitor/projects.json, monitor/private/projects.json, the shipped example)
 * and every one of them is under <repo>/monitor/, while every fixture is in a temp dir. A session
 * that exports CW_REGISTRY at the real file keeps anchoring.
 */
export function anchorableOut(out, reg, env = process.env) {
  if (env.CW_CHAIN_ANCHORS) return { anchorable: true, why: 'anchor store named (CW_CHAIN_ANCHORS)' };
  // withinRoot(): the prefix test was false for every path on Windows, so a registry that IS the
  // repo's own read as a fixture and the anchor store was declared unanchorable.
  if (env.CW_REGISTRY && !withinRoot(join(CW, 'monitor'), env.CW_REGISTRY)) {
    return { anchorable: false, why: `a fixture registry is in use (CW_REGISTRY=${env.CW_REGISTRY}) — the default anchor store belongs to the repo's own registry` };
  }
  const k = sourceKey(out, reg);
  if (!k || k.startsWith('..')) return { anchorable: false, why: 'OUT is outside the reports root' };
  return { anchorable: true, why: 'OUT is inside the default reports root' };
}

/** Copy the current tip. Does NOT mkdir: the store dir is a symlink, and creating a real directory in
 *  its place is the exact failure bin/test/sidecar-paths.test.mjs exists to catch — a missing store
 *  throws, and the caller warns. */
export function appendAnchor(histDir, area, at, path = anchorsPath()) {
  const { events, tailTorn, error } = readChain(histDir);
  if (error || tailTorn || !events.length) throw new Error(`nothing to anchor: ${error || (tailTorn ? 'torn tail' : 'empty chain')}`);
  if (!existsSync(dirname(path))) throw new Error(`anchor store ${dirname(path)} is absent — not creating it (it is a symlink into the sidecar)`);
  const line = { at, area, length: events.length, tip: events[events.length - 1].chain };
  appendFileSync(path, JSON.stringify(line) + '\n');
  return line;
}

/** Every anchor recorded for `area`, in order. ENOENT is `present:false`; a torn last line is reported, never dropped silently. */
export function readAnchors(area, path = anchorsPath()) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { present: false, anchors: [], tailTorn: false, error: null, path };
    return { present: false, anchors: [], tailTorn: false, error: `${e.code} reading ${path}`, path };
  }
  const lines = raw.split('\n').filter((l) => l.length);
  const anchors = [];
  let tailTorn = false;
  for (let i = 0; i < lines.length; i++) {
    let a;
    try { a = JSON.parse(lines[i]); } catch { if (i === lines.length - 1) { tailTorn = true; break; } continue; }
    if (a && a.area === area && typeof a.tip === 'string') anchors.push(a);
  }
  return { present: true, anchors, tailTorn, error: null, path };
}

// ── the COMMITTED anchor: the copy a local writer cannot rewrite ────────────────────────────────
// The anchor file is a symlink into the sidecar working tree — same disk, same uid as the chain.
// Its committed history is not: HEAD of that repo (and its push) is the first copy the chain's
// writer does not control. The verifier reads the newest committed anchor for the area from
// `git show HEAD:<rel>` and reports `committed` as a THIRD verdict — null when it cannot be
// determined (no repo, nothing committed yet), false when HEAD contradicts the chain, true when the
// committed tip is in the chain. It never upgrades `verified` or `anchored`.
export function anchorRepo(path = anchorsPath()) {
  let dir;
  try { dir = realpathSync(dirname(path)); } catch (e) { return { repo: null, rel: null, error: `${e.code} resolving ${dirname(path)}` }; }
  let top;
  try { top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return { repo: null, rel: null, error: `${dir} is not inside a git repository` }; }
  const rel = relative(top, join(dir, basename(path))).split(sep).join('/');
  return { repo: top, rel, error: null };
}

// Two git spawns per call. The sweep calls this once per area (40); the panel calls it on every
// Report-tab read, and a burst of reads would pay for the same answer repeatedly. Cached for a few
// seconds by (repo, rel) — long enough to collapse a burst, short enough that a commit landing
// mid-session shows up. TTL is env-overridable, read at CALL time; 0 disables the cache entirely,
// which is what the tests use so none of them can pass on a neighbour's cached answer.
const _committedCache = new Map();
export function _clearCommittedCache() { _committedCache.clear(); }

/** Anchors for `area` as committed at the sidecar's HEAD — not the working copy. */
export function committedAnchors(area, path = anchorsPath()) {
  const { repo, rel, error } = anchorRepo(path);
  if (error) return { present: false, anchors: [], sha: null, error, why: null, repo: null, rel: null };
  const ttl = Number(process.env.CW_ANCHOR_CACHE_MS ?? 5000);
  const ck = `${repo}\u0000${rel}`;
  if (ttl > 0) {
    const hit = _committedCache.get(ck);
    // The cached value is the RAW file and sha, never the filtered per-area list: two areas asking
    // in the same burst must not have to agree on which area they asked about.
    if (hit && Date.now() - hit.at < ttl) return { ...hit.val, anchors: hit.val.all.filter((a) => a.area === area) };
  }
  let raw;
  try { raw = execFileSync('git', ['-C', repo, 'show', `HEAD:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { return { present: false, anchors: [], sha: null, error: null, why: `${rel} is not in HEAD of ${repo} — anchors exist locally but none is committed yet`, repo, rel }; }
  let sha = null;
  try { sha = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%h', '--', rel], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || null; } catch { /* informational */ }
  const all = raw.split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((a) => a && typeof a.tip === 'string');
  const val = { present: true, all, sha, error: null, why: null, repo, rel };
  if (ttl > 0) _committedCache.set(ck, { at: Date.now(), val });
  return { ...val, anchors: all.filter((a) => a.area === area) };
}

/**
 * Verify the whole chain, then cross-check the index against it, then the anchor against both.
 * Returns, always in full:
 *   present      — a chain log exists at all
 *   verified     — every line's chain recomputes AND binds its predecessor AND no index row has
 *                  drifted from the hash the chain last recorded for it
 *   length       — lines verified
 *   brokenAt     — first line whose hash does not recompute (stamp + index), else null
 *   tailTorn     — a half-written final line exists (prefix still verified)
 *   retroSealed  — how many lines only attest seal-time bytes
 *   unrecorded   — index stamps with NO chain event: writes the log never saw
 *   drifted      — index rows whose sliceSha256 is not what the chain's LAST event for that stamp
 *                  recorded: a slice+index rewritten together, consistently, behind the log.
 *                  Before this field existed such a rewrite left verified:true and unrecorded:[].
 *   anchored     — the newest anchor for `area` names a tip present in this chain and a length this
 *                  chain has reached. Consistency with the LOCAL anchor only — see anchorsPath().
 *   anchorMissing / anchorShrunk / anchorAt / anchorWhy — the anchor verdict, spelled out
 *   error        — read/corruption error, verbatim
 *   committed    — null (undetermined: no repo, nothing committed, not consulted) | true | false:
 *                  the newest anchor at the sidecar's HEAD is in this chain and the chain is at
 *                  least that long. Opt-in (`committed: true`) — it shells out to git.
 *   committedMissing / committedShrunk / committedAt / committedSha / committedWhy — spelled out
 *   v1Lines      — lines hashed under the six-field body (notes etc. unprotected on those)
 *   protectedFrom — 1-based line where chainVersion 2 begins, or null
 */
export function verifyChain(histDir, idx, { area = null, anchorsFile = undefined, now = null, committed = false } = {}) {
  const noAnchor = (why) => ({ anchored: false, anchorMissing: false, anchorShrunk: false, anchorAt: null, anchorWhy: why });
  const noCommitted = (why) => ({ committed: null, committedMissing: false, committedShrunk: false, committedAt: null, committedSha: null, committedWhy: why });
  const { present, events, tailTorn, error } = readChain(histDir);
  if (!present || error) {
    return { present: !!present, verified: false, length: 0, brokenAt: null, tailTorn, retroSealed: 0,
      unrecorded: (idx || []).map((r) => String(r.stamp)).filter(Boolean), drifted: [], error: error || null,
      lastEventAt: null, staleDays: null, checkpoint: null,
      ...noAnchor(present ? 'chain unreadable' : 'no chain'), ...noCommitted(present ? 'chain unreadable' : 'no chain'), v1Lines: 0, protectedFrom: null };
  }
  // A rotated chain opens with a checkpoint whose prev is the archived segment's tip — verification
  // starts THERE, not at genesis, and when the archived segment is still on disk its tip is
  // re-checked against the checkpoint, so altering the archive after rotation is named too.
  let prev = GENESIS;
  let checkpoint = null;
  if (events.length && events[0].op === 'checkpoint' && typeof events[0].prev === 'string') {
    prev = events[0].prev;
    checkpoint = { segment: events[0].source || null, tip: events[0].prev, segmentVerified: null,
      segmentWhy: 'archived segment not consulted' };
    if (checkpoint.segment && !/[/\\]/.test(checkpoint.segment)) { // a filename, never a path
      const seg = readChain(histDir, checkpoint.segment);
      if (!seg.present) checkpoint.segmentWhy = 'archived segment absent — continuity rests on the checkpoint line (and the anchors) alone';
      else if (seg.error || seg.tailTorn || !seg.events.length) { checkpoint.segmentVerified = false; checkpoint.segmentWhy = seg.error || 'archived segment torn or empty'; }
      else {
        // WALK the archive, not just its tip: a line edited in place keeps its stored `chain`
        // field, so tip comparison alone would bless an altered archive. The segment may itself
        // open with a checkpoint (a rotation of a rotation) — its own prev is honoured one level
        // down, and deeper segments get the same walk when their turn as `segment` comes.
        let sp = seg.events[0].op === 'checkpoint' && typeof seg.events[0].prev === 'string' ? seg.events[0].prev : GENESIS;
        let segBrokenAt = null;
        for (let i = 0; i < seg.events.length; i++) {
          const se = seg.events[i];
          if (se.prev !== sp || se.chain !== chainOf(sp, se)) { segBrokenAt = i + 1; break; }
          sp = se.chain;
        }
        const tip = seg.events[seg.events.length - 1].chain;
        if (segBrokenAt) { checkpoint.segmentVerified = false; checkpoint.segmentWhy = `archived segment does not verify at line ${segBrokenAt} — the archive was altered after rotation`; }
        else if (tip !== checkpoint.tip) { checkpoint.segmentVerified = false; checkpoint.segmentWhy = 'archived segment tip does not match the checkpoint — the archive was altered after rotation'; }
        else { checkpoint.segmentVerified = true; checkpoint.segmentWhy = null; }
      }
    }
  }
  let brokenAt = null;
  let retroSealed = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.op === 'retro-seal') retroSealed++;
    if (e.prev !== prev || e.chain !== chainOf(prev, e)) { brokenAt = { line: i + 1, stamp: e.stamp ?? null }; break; }
    prev = e.chain;
  }
  // the deadman half: a chain that stopped moving is a DETECTED state, not an inferred one. The
  // caller supplies `now` when determinism matters; staleness is computed, never stored.
  const lastEventAt = events.length ? (events[events.length - 1].at || null) : null;
  const tLast = lastEventAt ? Date.parse(lastEventAt) : NaN;
  const staleDays = Number.isFinite(tLast) ? Math.max(0, Math.round(((now ?? Date.now()) - tLast) / 864e5)) : null;
  const lastByStamp = new Map();
  for (const e of events) lastByStamp.set(String(e.stamp), e);
  const unrecorded = (idx || []).map((r) => String(r.stamp)).filter((s) => s && !lastByStamp.has(s));
  const drifted = [];
  for (const r of idx || []) {
    const e = lastByStamp.get(String(r.stamp));
    if (!e || typeof r.sliceSha256 !== 'string' || !r.sliceSha256) continue;
    if (typeof e.sliceSha256 !== 'string' || !e.sliceSha256) continue; // the chain attested no hash for it
    if (e.sliceSha256 !== r.sliceSha256) drifted.push({ stamp: String(r.stamp), index: r.sliceSha256, chain: e.sliceSha256 });
  }

  const v1Lines = events.filter((e) => bodyVersion(e) !== 2).length;
  const firstV2 = events.findIndex((e) => bodyVersion(e) === 2);
  const protectedFrom = firstV2 === -1 ? null : firstV2 + 1;

  let committedV = noCommitted(committed ? (area ? 'no committed anchor for this area' : 'no area named — committed anchors not consulted') : 'not consulted (opt-in)');
  if (committed && area) {
    const c = committedAnchors(area, anchorsFile);
    if (c.error) committedV = noCommitted(c.error);
    else if (!c.present) committedV = noCommitted(c.why);
    else if (c.anchors.length) {
      const a = c.anchors[c.anchors.length - 1];
      const committedMissing = !events.some((e) => e.chain === a.tip);
      const committedShrunk = events.length < Number(a.length || 0);
      committedV = { committed: !committedMissing && !committedShrunk, committedMissing, committedShrunk, committedAt: a.at || null, committedSha: c.sha,
        committedWhy: committedMissing ? `the tip committed at ${c.sha} is not in this chain — the log was rewritten or replaced since that commit`
          : committedShrunk ? `the chain is shorter than when it was committed at ${c.sha} (${events.length} < ${a.length})`
            : `consistent with the anchor committed at ${c.sha}` };
    }
  }

  let anchor = noAnchor(area ? 'no anchor recorded for this area' : 'no area named — anchors not consulted');
  if (area) {
    const { present: ap, anchors, tailTorn: at, error: aerr } = readAnchors(area, anchorsFile);
    if (aerr) anchor = noAnchor(aerr);
    else if (!ap) anchor = noAnchor(`anchor store absent (${anchorsFile || anchorsPath()})`);
    else if (anchors.length) {
      const a = anchors[anchors.length - 1];
      const anchorMissing = !events.some((e) => e.chain === a.tip);
      const anchorShrunk = events.length < Number(a.length || 0);
      anchor = { anchored: !anchorMissing && !anchorShrunk, anchorMissing, anchorShrunk, anchorAt: a.at || null,
        anchorWhy: anchorMissing ? 'the anchored tip is not in this chain — the log was rewritten or replaced since it was anchored'
          : anchorShrunk ? `the chain is shorter than when it was anchored (${events.length} < ${a.length})`
            : (at ? 'consistent with the local anchor (the anchor file has a torn last line)' : 'consistent with the local anchor') };
    }
  }

  return { present: true,
    verified: brokenAt === null && !error && drifted.length === 0 && (!checkpoint || checkpoint.segmentVerified !== false),
    length: events.length, brokenAt,
    tailTorn, retroSealed, unrecorded, drifted, error: null,
    lastEventAt, staleDays, checkpoint, ...anchor, ...committedV, v1Lines, protectedFrom };
}

/** Byte-check one slice file against the hash its chain/index row attests. */
export function verifySliceBytes(histDir, file, attestedSha256) {
  if (!attestedSha256) return { checked: false, match: null, why: 'no hash was attested for this state' };
  let raw;
  try { raw = readFileSync(join(histDir, file)); }
  catch (e) { return { checked: false, match: null, why: `${e.code} reading ${file}` }; }
  const got = sha256(raw);
  return { checked: true, match: got === attestedSha256, why: got === attestedSha256 ? null : 'slice bytes do not match the attested hash — the file changed after it was recorded' };
}

export function fileExists(p) { try { return statSync(p).isFile(); } catch { return false; } }

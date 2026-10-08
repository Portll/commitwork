// cra/lib.mjs — shared plumbing for the CRA (EU Cyber Resilience Act) readiness module.
//
// Zero runtime dependencies, ESM. Every path is env-overridable so the
// test suite (and any future hosted runner) can point the module at fixtures without
// touching the live monitor state.

import { nowISO as clockISO } from '../lib/clock.mjs';
import { readFileSync, existsSync, mkdirSync, renameSync, readdirSync, appendFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The one cross-process mutex (bin/test/one-mutex.test.mjs pins that it stays one).
import { acquireLock, writeAtomic } from '../monitor/lockfile.mjs';
// fact: area/manifest resolution is reused from registry.mjs + discover.mjs, never reimplemented here (R22) / cra/ was the one directory with zero edges into either, and this was the 16th hand-rolled copy of the same rule (expiry: never, prev: duplicated)
// fact: both are pure over whatever `reg` they are handed — registry.mjs never touches the filesystem, discover.mjs only for an explicit entry's OWN declared path / that purity is what lets this file's CW_CRA_ROOT-isolated projects.json keep every existing test's isolation intact (expiry: if either starts reading an ambient path, prev: unknown)
import { areaOf, areaOut, primaryArea, validateAgainstSchema } from '../monitor/registry.mjs';
import { registryPathFor, annotationsPathFor, craProductsPathFor, epssDetailPathFor } from '../monitor/store-paths.mjs';
import { resolveRepos } from '../monitor/discover.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// A function, not a const: `export const ROOT = process.env.CW_CRA_ROOT ? …` froze the value at
// import, so any test setting CW_CRA_ROOT afterwards passed while proving nothing about the
// override. Every path in this module hangs off it, so that one binding decided whether the whole
// module was testable. Read at CALL time.
export const craRoot = () => (process.env.CW_CRA_ROOT ? resolve(process.env.CW_CRA_ROOT) : resolve(HERE, '..'));

// ── time (CW_CRA_NOW makes runs deterministic for tests / reproducible evidence) ──
export const nowISO = () => clockISO(process.env, 'CW_CRA_NOW');
export function addHours(iso, h) { return new Date(new Date(iso).getTime() + h * 3600_000).toISOString(); }
export function addDays(iso, d) { return addHours(iso, d * 24); }
// Calendar month (CRA "one month"), clamping day overflow (e.g. Jan 31 + 1mo → Feb 28/29).
export function addMonths(iso, m) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
export function isOverdue(dueIso, refIso) { return new Date(refIso).getTime() > new Date(dueIso).getTime(); }
export function hoursSince(iso, refIso) { return (new Date(refIso).getTime() - new Date(iso).getTime()) / 3600_000; }
export function daysBetween(aIso, bIso) { return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 86_400_000; }

// ── IO ────────────────────────────────────────────────────────────────────────
export function loadJSON(path, fallback = undefined) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`could not read ${path}: ${e.message}`);
  }
}

// Atomic write (tmp + rename): a killed process never leaves a torn evidence file.
// ONE atomic-write primitive, not three. These were a second and third hand-rolled tmp+rename
// beside monitor/lockfile.mjs's writeAtomic — correct, pid-suffixed, and therefore never caught by
// the fixed-tmp guard, which is why they survived: a duplicate that works is invisible to a test
// looking for a duplicate that breaks. What they add over writeAtomic is the mkdir, so that is all
// they keep; the tmp naming and the rename now live in one place and change in one place.
//
// Note the tmp file is now HIDDEN (writeAtomic uses `.<basename>.tmp-<pid>`) rather than sitting
// beside its target as `<name>.tmp-<pid>`. That is the better default here — cra writes into
// directories an operator browses, and a visible tmp during a crash reads as a stray artifact.
export function writeJSONAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, `${JSON.stringify(obj, null, 2)}\n`);
}
export function writeTextAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, text);
}

// ── canonical hashing (the case log is a hash chain — tamper-evident, verifiable) ──
// Must hash what JSON.stringify will write, not what is in memory: the chain is verified against
// the deserialised form, so an undefined-valued key hashes one way in and another way back out.
export function stableStringify(v) {
  if (v === undefined) return 'null'; // array hole / explicit undefined element — JSON writes null
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }
export function chainHash(prevHash, event) {
  const { prevHash: _p, hash: _h, ...body } = event;
  return sha256((prevHash || 'genesis') + stableStringify(body));
}
// Deterministic urn:uuid from content — re-runs over identical inputs emit identical docs.
export function contentUUID(seed) {
  const h = sha256(seed);
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ── the case log, and the one place it may be written ─────────────────────────
// Fail closed: cases.json is the Art. 14 ledger, and a lost write drops a case-event that `verify`
// still certifies as intact — the chain it recomputes never contained the dropped records.

// Read at CALL time, never at module load: a `const X = process.env.Y` at import silently defeats
// any test that sets the override afterwards, so the test passes while proving nothing.
// The budget is NOT attempts × spinMs. Measured 2026-08-30 against a real blocked writer, the wait
// was 2535ms where this comment claimed ~1s — each retry round also does filesystem work that the
// arithmetic ignores. That 2.5x gap is load-bearing: cases-concurrency's holder held for 2500ms, so
// the blocked writer OUTLASTED it by 35ms, acquired the lock it was supposed to be refused by, and
// wrote. Two processes in the critical section, and the test read it as an exit-code defect.
const caseLockStaleMs = () => Number(process.env.CW_CRA_LOCK_STALE_MS) || 30_000;
const caseLockAttempts = () => Number(process.env.CW_CRA_LOCK_ATTEMPTS) || 50;
const caseLockSpinMs = () => Number(process.env.CW_CRA_LOCK_SPIN_MS) || 20;

export function emptyCasesDoc() {
  return {
    note: 'CRA Art. 14 case log — append-only, hash-chained (verify: node cra/watch.mjs verify). ' +
      'events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.',
    events: [],
    cases: {},
  };
}

// The one chained append; watch.mjs and escalate.mjs each had their own copy of the link.
export function appendCaseEvent(doc, type, caseId, data, at) {
  const ev = { type, caseId, at, data };
  ev.prevHash = doc.events.length ? doc.events[doc.events.length - 1].hash : null;
  ev.hash = chainHash(ev.prevHash, ev);
  doc.events.push(ev);
  return ev;
}

const heldCases = new Set();
export const holdsCasesLock = (path) => heldCases.has(resolve(path));

// Backstop for a writer that reaches past updateCases: a loud refusal beats a silent lost update.
export function saveCases(paths, doc) {
  const target = resolve(paths.cases);
  if (!heldCases.has(target)) {
    throw new Error(
      `refusing to save the CRA case log at ${target} without its lock — go through updateCases(). `
      + 'The write is atomic, which prevents a torn file and not a lost one: a concurrent writer\'s '
      + 'document replaces yours, and verify() certifies the survivor because the events you appended '
      + 'were never in the file it hashes.',
    );
  }
  writeJSONAtomic(target, doc);
}

// ── deferral accounting ───────────────────────────────────────────────────────
// A refused write spends real Art. 14 slack, so it is recorded on stderr AND in the ledger by the
// next successful writer — consumed slack must be countable, not inferred from an absence.
// Sibling file, never the chain: a writer without the lock must not be appending chain links.
const deferralMarker = (casesPath) => `${resolve(casesPath)}.deferred.jsonl`;

function recordDeferral(casesPath, entry) {
  try { appendFileSync(deferralMarker(casesPath), JSON.stringify(entry) + '\n'); }
  catch { /* best effort; the stderr half is the unconditional one */ }
}

// Drained under the lock. Residual: a deferral appended during the rename lands in the next drain,
// or is lost. Locking the marker is impossible by construction — its writers are the ones refused a
// lock — and undercounting a tally is soft where the stderr half is lossless.
function drainDeferrals(casesPath) {
  const marker = deferralMarker(casesPath);
  const staged = `${marker}.draining-${process.pid}`;
  try { renameSync(marker, staged); } catch { return []; } // nothing deferred since the last drain
  let lines = [];
  try { lines = readFileSync(staged, 'utf8').split('\n').filter(Boolean); } catch { /* unreadable */ }
  try { unlinkSync(staged); } catch { /* already gone */ }
  return lines.map((l) => { try { return JSON.parse(l); } catch { return { at: null, reason: 'unparseable' }; } });
}

// The chokepoint: takes a mutation, not a document, and loads inside the lock — a caller that reads
// first and locks second writes superseded state, and the chain verifies clean over that too.
// `mutate(doc)` returns truthy to persist, falsy to leave the file untouched, or `{ save, result }`.
// Never process.exit() from a mutator: it skips the release in `finally` and wedges every writer
// until the stale window expires. Return a sentinel and exit after this returns.
/**
 * Serialise a read-modify-write on any CRA store that is not the case log. Same primitive and
 * policy as updateCases; refuses rather than racing. `fn` receives nothing — load INSIDE it, or a
 * read taken before the lock makes the write a lost update wearing a lock.
 */
export function withCraStoreLock(path, fn, { label = 'cra-store' } = {}) {
  const target = resolve(path);
  const held = acquireLock(`${target}.lock`, {
    staleMs: caseLockStaleMs(), label, attempts: caseLockAttempts(), spinMs: caseLockSpinMs(),
    onStale: (ageMs) => console.warn(`[cra] breaking a stale ${label} lock (${Math.round(ageMs / 1000)}s old) at ${target}.lock`),
  });
  if (!held.ok) return { ok: false, code: 'lock-contention', holder: held.holder || null, target };
  try { return { ok: true, value: fn() }; } finally { held.release(); }
}

export function updateCases(paths, mutate, { label = 'cra-cases' } = {}) {
  const target = resolve(paths.cases);
  // Acquisition wait, reported on both paths: the cost of failing closed should be citable.
  const t0 = Date.now();
  const held = acquireLock(`${target}.lock`, {
    staleMs: caseLockStaleMs(), label, attempts: caseLockAttempts(), spinMs: caseLockSpinMs(),
    onStale: (ageMs) => console.warn(`[cra] breaking a stale case-log lock (${Math.round(ageMs / 1000)}s old) at ${target}.lock`),
  });
  const waitedMs = Date.now() - t0;
  if (!held.ok) {
    const at = nowISO();
    recordDeferral(target, { at, pid: process.pid, label, reason: 'lock-contention', waitedMs, heldFor: held.heldFor, holder: held.holder || null });
    console.error(
      `cra: REFUSED to write the Article 14 case log — another process holds ${target}.lock and did not `
      + `release it within ${waitedMs}ms. Nothing was written and nothing was lost; this run's work is `
      + 'deferred, and the deferral is recorded so the consumed deadline slack is countable.',
    );
    return { ok: false, reason: 'lock-contention', waitedMs, heldFor: held.heldFor, holder: held.holder || null, doc: null, saved: false, deferred: [] };
  }
  heldCases.add(target);
  try {
    // Loaded inside the lock. ENOENT is the only absence meaning "no cases yet" — a fresh chain over
    // an unreadable ledger overwrites the evidence with a blank document.
    let doc;
    if (existsSync(target)) {
      let raw;
      try { raw = readFileSync(target, 'utf8'); }
      catch (e) {
        if (e.code !== 'ENOENT') throw new Error(`CRA case log at ${target} is unreadable (${e.code}); refusing to treat it as empty`);
        doc = emptyCasesDoc();
      }
      if (doc === undefined) {
        try { doc = JSON.parse(raw); }
        catch (e) { throw new Error(`CRA case log at ${target} is not valid JSON (${e.message}); refusing to treat it as empty`); }
        if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.events) || !doc.cases) {
          throw new Error(`CRA case log at ${target} is not a case document (events[] + cases{}); refusing to overwrite it`);
        }
      }
    } else {
      doc = emptyCasesDoc();
    }

    const deferred = drainDeferrals(target);
    if (deferred.length) {
      const at = nowISO();
      appendCaseEvent(doc, 'write-deferred', null, {
        skipped: deferred.length,
        from: deferred[0]?.at || null,
        to: deferred[deferred.length - 1]?.at || null,
        writers: [...new Set(deferred.map((d) => d.label).filter(Boolean))],
        note: 'runs refused the case-log lock, which wrote nothing — recorded so the Art. 14 slack '
          + 'consumed by contention is countable from the ledger itself.',
      }, at);
      console.error(`cra: ${deferred.length} earlier case-log write(s) were deferred by contention (${deferred[0]?.at} … ${deferred[deferred.length - 1]?.at}); banked as a write-deferred event`);
    }

    // Snapshot BEFORE the mutation, so validation can tell what this write actually touched.
    const before = JSON.parse(JSON.stringify(doc.cases || {}));
    const outcome = mutate(doc);
    const save = outcome && typeof outcome === 'object' && 'save' in outcome ? outcome.save : !!outcome;
    const result = outcome && typeof outcome === 'object' && 'result' in outcome ? outcome.result : outcome;

    // Validate what this write created or changed (schema/case.schema.json). Pre-existing records
    // are reported and left alone: refusing the whole document over a legacy case would make every
    // subsequent write fail and strand the ledger — a guard that bricks the thing it guards.
    let caseErrors = [];
    if (save) {
      const v = validateCaseChanges(doc, before);
      caseErrors = v.errors;
      if (v.legacy.length) {
        console.error(`cra: ${v.legacy.length} PRE-EXISTING case record(s) do not match schema/case.schema.json — left untouched, not rewritten:`);
        for (const e of v.legacy.slice(0, 5)) console.error(`  · ${e}`);
      }
      if (caseErrors.length) {
        // Fail closed on OUR OWN write. An invalid case here is a defect in the code that just ran,
        // and persisting it would put a malformed record into a hash-chained legal ledger where it
        // is thereafter tamper-evident and permanent.
        console.error('cra: REFUSED to write — this run produced case record(s) that do not validate:');
        for (const e of caseErrors) console.error(`  · ${e}`);
        return { ok: false, reason: 'case-invalid', errors: caseErrors, doc: null, saved: false, deferred, waitedMs };
      }
    }

    // A drained deferral is itself a change worth persisting even when the mutator declined to act.
    if (save || deferred.length) saveCases({ cases: target }, doc);
    return { ok: true, doc, saved: !!(save || deferred.length), result, deferred, waitedMs };
  } finally {
    // Deregistered before the release, so saveCases never believes a handed-on lock is held.
    heldCases.delete(target);
    held.release();
  }
}

// ── input resolution (env override › monitor/projects.json convention) ───────
//
// `resolvePaths()` (no args) keeps the same keys and the same single ambient area for every existing
// caller. What "ambient" MEANS changed on 2026-08-06: it was `projects.monitorOutput ||
// 'clientA-monorepo'`, and the registry no longer sets monitorOutput — so that literal was the live
// answer for an areas-only or unreadable registry, and every CRA artifact (SOC2 pack, POA&M, VEX)
// resolved out of ONE customer's report directory. Compliance evidence under the wrong product is
// the worst instance of this class in the tree.
//
// So: the ambient area is the registry's own PRIMARY area, and NULL — never a project name — when
// nothing declares one. Callers get null paths plus `areaVoid` and render a void. No evidence is a
// state an operator can act on; clientA's evidence under another product's name is not.
//
// `resolvePaths({ area })` additionally resolves the same shape against one DECLARED area's report
// directory (areas[].out, own-name fallback via areaOut), which feeds resolveEvidenceForRepos()
// below — a product's repos are not guaranteed to share one area. Precedence follows
// monitor/area.mjs minus its CW_MONITOR_OUT rung, which belongs to the monitor's writers, not CRA's
// readers. Not imported from area.mjs because that module's CW is this checkout and cra/ must
// re-root under CW_CRA_ROOT for its fixtures.
function ambientOutName(projects) {
  if (projects.monitorOutput) return projects.monitorOutput;
  const p = primaryArea(projects);
  if (p) return areaOut(p.slug, projects) || p.slug;
  return null;
}
export function resolvePaths({ area } = {}) {
  // CW_CRA_ROOT NAMES A ROOT, so an ambient CW_REGISTRY must not outrank it — the `{ ambient: false }`
  // rule monitor/store-paths.mjs documents for every caller that nominates its own root. Without it,
  // a fixture run from a shell that had exported CW_REGISTRY read the LIVE fleet registry and
  // resolved its evidence paths from that. With CW_CRA_ROOT unset the root is this checkout and
  // CW_REGISTRY still wins, which production depends on: it is how the live registry is reached.
  const projects = loadJSON(registryPathFor(craRoot(), { ambient: !process.env.CW_CRA_ROOT }), {});
  const reportsRoot = join(craRoot(), projects.reportsRoot || 'reports');
  const areaOutName = area ? (areaOut(area, projects) || area) : null;
  const outName = areaOutName || ambientOutName(projects);
  const monitorOut = outName ? join(reportsRoot, outName) : null;
  // A path under the ambient area, or null when no area is declared. Every key built with this is
  // env-overridable, so an operator who knows which evidence they mean can still name it directly.
  const inOut = (...seg) => (monitorOut ? join(monitorOut, ...seg) : null);
  const p = (env, dflt) => (process.env[env] ? resolve(process.env[env]) : dflt);
  return {
    projects,
    area: area || null,
    // WHICH area this evidence describes, and — when the answer is "none" — why. `soc2.mjs`,
    // `pack.mjs` and the panel all publish attributed evidence; an unattributed read must be
    // visible to them rather than silently pointed at whichever area was hardcoded last.
    areaOut: outName,
    areaVoid: outName ? null : 'monitor/projects.json declares no areas[] and no monitorOutput, so no '
      + 'ambient area resolves — pass resolvePaths({ area }), declare an area (primary:true), or set '
      + 'CW_ROLLUP/CW_LEDGER/CW_HISTORY explicitly. CRA evidence is attributed to a product; it is never '
      + 'resolved by guessing a report directory.',
    rollup: p('CW_ROLLUP', inOut('rollup.json')),
    ledger: p('CW_LEDGER', inOut('remediation-ledger.json')),
    annotations: p('CW_ANNOTATIONS', annotationsPathFor(craRoot(), { ambient: false })),
    kev: p('CW_KEV', join(craRoot(), 'monitor', 'data', 'kev.json')),
    epss: p('CW_EPSS', join(craRoot(), 'monitor', 'data', 'epss.json')),
    // The full {probability, percentile, date} triple, beside the score-only cache. CSAF 2.1
    // requires all three and epss.json holds one, so this is the only store a 2.1 metric can be
    // built from. Own env override like every other input path.
    epssDetail: p('CW_EPSS_DETAIL', epssDetailPathFor(craRoot(), { ambient: false })),
    // Vendored MITRE CWE catalogue. TRACKED, unlike monitor/data/*.json which are gitignored
    // caches: both CSAF versions require a weakness NAME, so without this file every cwes[] entry
    // would have to be invented, and a catalogue that could go missing is not an authority.
    cweCatalogue: p('CW_CWE_CATALOGUE', join(craRoot(), 'cra', 'cwe-catalogue.json')),
    // The product registry names the operator's customers and their repositories, so it is a private
    // record (monitor/private/cra-products.json). Absent, preflight says it is not configured and
    // every tool that needs it refuses with the path; the panel's wizard creates it there.
    products: p('CW_PRODUCTS', craProductsPathFor(craRoot(), { ambient: false })),
    controls: p('CW_CONTROLS', join(craRoot(), 'cra', 'controls.json')),
    historyIndex: p('CW_HISTORY', inOut('history', 'index.json')),
    cases: p('CW_CASES', join(craRoot(), 'cra', 'cases.json')),
    out: p('CW_CRA_OUT', join(reportsRoot, 'cra')),
    reportsRoot,
    // R22 fix 3: was pinned with no override at all (the one resolvePaths() entry that bypassed
    // p()). CW_BASELINE_MANIFEST is the escape hatch pack.mjs's tests use; manifestIdsForRepos()
    // below is the per-product resolution this default now needs to defer to.
    baselineManifest: p('CW_BASELINE_MANIFEST', join(craRoot(), 'manifests', 'security-baseline.json')),
  };
}

// ── attestation key location ──────────────────────────────────────────────────
// ONE resolver, because two copies disagreed. attest.mjs treated CW_ATTEST_KEYDIR as an override
// (env wins outright); refresh.mjs's keyPresent probe OR-ed the env dir with the default, so a key
// at the default path made it schedule `attest.mjs sign` even when the env pointed somewhere with
// no key — attest.mjs then looked only at the env dir and exited 2. The detector and the consumer
// have to answer "which directory" the same way, so neither of them answers it any more.
export const ATTEST_KEY = 'attest-ed25519.key'; // gitleaks:allow — a filename, not key material
export const ATTEST_PUB = 'attest-ed25519.pub';
export function resolveKeyDir(paths) {
  return process.env.CW_ATTEST_KEYDIR ? process.env.CW_ATTEST_KEYDIR : join(paths.reportsRoot, '..', 'cra', '.keys');
}

// ── per-area evidence merge (R22 fix 1) ───────────────────────────────────────
// Which declared area each of these repo names resolves to, via monitor/registry.mjs's ONE
// precedence chain (explicit projects[].area > areas[].members > areas[].prefixes > own name —
// never re-derived here). Grouped, because a product's repos are not guaranteed to share an
// area: clientA's repos all resolve to 'clientA', but a product spanning a fleet repo and a
// standalone repo spans two.
export function areasForRepos(repoNames, projects) {
  const byArea = new Map();
  for (const name of repoNames || []) {
    const slug = areaOf(name, projects) || name;
    if (!byArea.has(slug)) byArea.set(slug, []);
    byArea.get(slug).push(name);
  }
  return byArea;
}

// fact: rooted at THIS call's reportsRoot, never monitor/area.mjs's outDirFor / outDirFor's CW is hardcoded to this checkout and has no CW_CRA_ROOT override, so a fixture registry under a scratch root would resolve outside it (expiry: if outDirFor gains an override, prev: broken)
// fact: same precedence as outDirFor — declared `out`, else the slug — only re-rooted (expiry: if outDirFor's precedence changes, prev: unknown)
// fact: the ambient tail returns NULL, not the old 'clientA-monorepo' literal / a directory nobody declared is not a directory this may read (expiry: never, prev: wrong)
function areaReportsDir(reportsRoot, slug, projects) {
  const name = (slug && areaOut(slug, projects)) || slug || ambientOutName(projects);
  return name ? join(reportsRoot, name) : null;
}

// Resolve rollup + remediation-ledger + history for an arbitrary repo set across however many
// declared areas they resolve to, and merge — instead of the single hardwired `monitorOutput` every
// CRA tool bound to, under which products in any other area got zero findings. Each area is read
// INDEPENDENTLY: no rollup yet reports `hasRollup: false`, never folded into "zero findings".
// Freshness of the merged view is the OLDEST contributing slice.
export function resolveEvidenceForRepos(repoNames, paths) {
  const projects = paths.projects || {};
  const grouped = areasForRepos(repoNames, projects);
  const areas = [];
  const repos = [];
  const ledgerEntries = [];
  const sliceIds = [];
  let generated = null;
  for (const [slug, want] of grouped) {
    const out = areaReportsDir(paths.reportsRoot, slug, projects);
    if (!out) {
      // Unresolvable area: its repos are reported as MISSING with the reason, never merged in from
      // some other area's rollup. Same rule as hasRollup:false — absent evidence stays absent.
      areas.push({
        area: slug, out: null, rollupPath: null, ledgerPath: null, historyPath: null,
        hasRollup: false, hasLedger: false, historyCount: 0,
        repos: want, found: [], missing: want, generated: null, sliceId: null,
        void: `no report directory resolves for area '${slug}' — it is not declared in monitor/projects.json`,
      });
      continue;
    }
    const rollupPath = join(out, 'rollup.json');
    const ledgerPath = join(out, 'remediation-ledger.json');
    const historyPath = join(out, 'history', 'index.json');
    const rollup = loadJSON(rollupPath, null);
    const ledger = loadJSON(ledgerPath, { entries: [] });
    const history = loadJSON(historyPath, []);
    const have = new Set((rollup?.repos || []).map((r) => r.name));
    const found = want.filter((r) => have.has(r));
    const missing = want.filter((r) => !have.has(r));
    areas.push({
      area: slug, out, rollupPath, ledgerPath, historyPath,
      hasRollup: !!rollup, hasLedger: existsSync(ledgerPath), historyCount: Array.isArray(history) ? history.length : 0,
      repos: want, found, missing, generated: rollup?.generated || null, sliceId: rollup?.sliceId || null,
    });
    if (rollup) {
      for (const r of rollup.repos || []) if (want.includes(r.name)) repos.push(r);
      if (rollup.generated && (!generated || rollup.generated < generated)) generated = rollup.generated;
      if (rollup.sliceId) sliceIds.push(rollup.sliceId);
    }
    for (const e of ledger.entries || []) if (want.includes(e.repo)) ledgerEntries.push(e);
  }
  return {
    areas,
    missing: areas.flatMap((a) => a.missing),
    rollup: { repos, generated, sliceId: sliceIds.join('+') || null },
    ledgerEntries,
  };
}

// ── per-product manifest resolution (R22 fix 3) ───────────────────────────────
// fact: which manifests apply is resolved through discover.mjs's resolveRepos, expand:children included, exactly as sweep.mjs does — never re-derived from area/prefix guessing / a child repo inherits its PARENT entry's manifest, and nothing in projects.json enumerates a monorepo's child names, so prefix matching cannot recover it (expiry: if projects.json starts enumerating children, prev: wrong)
// fact: a repo resolveRepos has never heard of (not yet cloned here) still gets the registry DEFAULT manifest / otherwise it contributes nothing to the union and the gap reads as a clean result (expiry: never, prev: broken)
export function manifestIdsForRepos(repoNames, paths) {
  const projects = paths.projects || {};
  const { repos } = resolveRepos(projects, {});
  const byName = new Map(repos.map((r) => [r.name, r]));
  const ids = new Set();
  const unresolved = [];
  for (const name of repoNames || []) {
    const r = byName.get(name);
    if (!r) unresolved.push(name);
    const m = r?.manifest || projects.defaultManifest || 'security-baseline';
    for (const id of Array.isArray(m) ? m : [m]) ids.add(id);
  }
  if (!ids.size) ids.add(projects.defaultManifest || 'security-baseline'); // never an empty catalogue
  return { ids: [...ids], unresolved };
}

// KEV store: accept the full CISA catalog shape ({vulnerabilities:[{cveID}]}) or a
// flat map/array (the monitor's cache format may evolve).
export function kevSet(kevDoc) {
  if (!kevDoc) return new Set();
  if (Array.isArray(kevDoc.vulnerabilities)) return new Set(kevDoc.vulnerabilities.map((v) => v.cveID).filter(Boolean));
  if (Array.isArray(kevDoc)) return new Set(kevDoc.map((v) => (typeof v === 'string' ? v : v.cveID)).filter(Boolean));
  return new Set(Object.keys(kevDoc).filter((k) => /^CVE-/.test(k)));
}

// EPSS: flat {CVE: score}. A fetch failure persists null (unknown) — NEVER 0 (breaker B1).
export function epssFor(epssDoc, cveId) {
  const v = epssDoc?.[cveId];
  return typeof v === 'number' ? v : null;
}

// ── catalogue freshness (content-based, NEVER file mtime) ────────────────────
// fact: freshness is read from the catalogue's own content, NEVER statSync().mtime / mtime says when a file was written, never what is in it — a clone reset kev.json/epss.json's mtime to "now" and cra/preflight.mjs read a weeks-stale catalogue (catalogVersion 2026.07.01) as freshly fetched (expiry: never, prev: wrong)
// fact: untracking those caches removed the clone-reset TRIGGER, not the error (expiry: never, prev: wrong)
// fact: two copies of this rule exist — here and monitor/rollup.mjs (pinned to bifocal R21/C5); cra/watch.mjs imports this one, and both copies read the threshold through kevStaleDays() / a fix applied to one is not applied to the other (expiry: when they are merged into one, prev: duplicated)
//
// ONE threshold, ONE name. monitor/rollup.mjs read CW_KEV_STALE_DAYS while this file and
// cra/watch.mjs read CRA_KEV_STALE_DAYS, so one catalogue could be fresh to the watch and stale to
// the rollup. CRA_KEV_STALE_DAYS is the name — the catalogue is fetched by cra/watch.mjs — and every
// reader goes through this function, at CALL time. The retired name is REFUSED rather than ignored
// (a threshold someone set that nothing reads is a silent config drop), and so is a non-number:
// `ageDays > NaN` is false, so a typo used to read every catalogue as fresh.
export const KEV_STALE_DAYS_DEFAULT = 7;
export function kevStaleDays(env = process.env) {
  if (env.CW_KEV_STALE_DAYS) {
    throw new Error('CW_KEV_STALE_DAYS is retired: CRA_KEV_STALE_DAYS is the one name every KEV freshness reader uses (cra/watch.mjs, cra/preflight.mjs, monitor/rollup.mjs)');
  }
  const raw = env.CRA_KEV_STALE_DAYS;
  if (raw === undefined || raw === '') return KEV_STALE_DAYS_DEFAULT;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) throw new Error(`CRA_KEV_STALE_DAYS must be a number of days >= 0 (got ${JSON.stringify(raw)})`);
  return days;
}

export function kevFreshness(paths, at) {
  const doc = loadJSON(paths.kev, null);
  const dateReleased = doc?.dateReleased || null;
  const catalogVersion = doc?.catalogVersion || null;
  // An unusable threshold is UNKNOWN freshness with its reason, never a verdict either way.
  let maxDays;
  try { maxDays = kevStaleDays(); }
  catch (e) { return { state: 'unknown', ageDays: null, maxDays: null, catalogVersion, dateReleased, reason: e.message }; }
  const t = dateReleased ? Date.parse(dateReleased) : NaN;
  if (!Number.isFinite(t)) return { state: 'unknown', ageDays: null, maxDays, catalogVersion, dateReleased };
  const ageDays = hoursSince(dateReleased, at) / 24;
  return { state: ageDays > maxDays ? 'stale' : 'fresh', ageDays: Math.round(ageDays), maxDays, catalogVersion, dateReleased };
}

// EPSS's store is a flat {cveId: score} map with no version/date field of its own to read —
// 'unknown' is the honest answer, stated with a reason, never invented from mtime or anything
// else (monitor/rollup.mjs's epssFreshness constant says the same thing for the same reason).
export function epssFreshness() {
  return { state: 'unknown', reason: 'monitor/data/epss.json is a flat {cveId: score} map with no version/date field of its own to measure freshness from' };
}

// Open findings across the rollup, flattened with their repo.
export function openFindings(rollup) {
  const out = [];
  for (const repo of rollup?.repos || []) {
    for (const f of repo.findings || []) {
      const state = f.state || f.status || 'persisting';
      if (/^resolved/.test(state)) continue;
      out.push({ ...f, repo: f.repo || repo.name });
    }
  }
  return out;
}

export function loadProducts(path) {
  const doc = loadJSON(path);
  if (!Array.isArray(doc.products)) throw new Error(`${path}: products[] missing`);
  const byRepo = new Map();
  for (const prod of doc.products) {
    for (const r of prod.repos || []) {
      if (!byRepo.has(r)) byRepo.set(r, []);
      byRepo.get(r).push(prod);
    }
  }
  return { doc, products: doc.products, byRepo, manufacturer: doc.manufacturer || {} };
}

export function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// Sweep/slice stamp (…-YYYYMMDDHHmmss, e.g. "sweep-20260719170004", "v0-20260702064632")
// → ISO. Used to derive a finding's discovery date from the slice it was born in. null if
// no 14-digit stamp is present (never guess a date).
export function sweepStampToISO(stamp) {
  const m = /(\d{14})/.exec(stamp || '');
  if (!m) return null;
  const s = m[1];
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}.000Z`;
}

// Zero-dep validator mirroring schema/product.schema.json — structural errors (block)
// vs advisories (the seeded-placeholder / not-yet-configured states that must not silently
// pass as "ready"). Returns { errors, advisories }.
const PLACEHOLDER = /TODO|set-me|example\.com/i;
// The 27 Member States, read from the ONE directory that holds them. Returns lowercase names plus
// ISO codes plus the handful of colloquial spellings a human types. Fails LOUD: an unreadable
// directory throws rather than returning an empty set, because an empty set would silently accept
// every string as a valid member state — the inverse of what this guard is for.
let _euStates = null;
export function euMemberStateNames() {
  if (_euStates) return _euStates;
  const dir = loadJSON(join(dirname(fileURLToPath(import.meta.url)), 'csirt-directory.json'));
  const states = dir.memberStates || [];
  if (states.length < 27) throw new Error(`csirt-directory.json lists ${states.length} member states — refusing to validate against a truncated directory`);
  const set = new Set();
  for (const s of states) { set.add(s.name.toLowerCase()); set.add(s.code.toLowerCase()); }
  for (const alias of ['czech republic', 'the netherlands', 'holland']) set.add(alias);
  _euStates = set;
  return set;
}

// ── THE CLOCK SPEC — one authority, keyed by track ──────────────────────────────────────────────
// fact: every consumer that names a clock reads THIS one authority / it was four independent literals (here, cra/escalate.mjs, admin/routes/cra.mjs, inline in admin/index.html), so a clock added to computeClocks never rendered, never paged and never flagged overdue while every surface looked healthy (expiry: never, prev: duplicated)
// fact: `escalationId` MUST NOT change — the pager keys its chain-covered `paged` events on it, so it is part of the ledger's identity (expiry: never, prev: unknown)
// See evaluations/REMEDIATION-schema-derivation-2026-08-22.md R3.
export const CLOCK_SPEC = Object.freeze({
  article14: Object.freeze([
    Object.freeze({ key: 'earlyWarningDue', label: '24h early warning', escalationId: 'early-warning-24h' }),
    Object.freeze({ key: 'notificationDue', label: '72h notification', escalationId: 'notification-72h' }),
    Object.freeze({ key: 'finalDue', label: 'final report', escalationId: 'final-report' }),
  ]),
  internal: Object.freeze([
    Object.freeze({ key: 'triageDue', label: 'triage', escalationId: 'internal-triage' }),
    Object.freeze({ key: 'remediateDue', label: 'remediate', escalationId: 'internal-remediate' }),
  ]),
});
// bestpractice runs the Art. 14 timeline exactly — the SAME array, not a copy of it, so the two can
// never drift apart. An unknown (pre-split) case is read with the Art. 14 keys because that is what
// it was written with.
export const clockSpecFor = (track) => CLOCK_SPEC[track === 'internal' ? 'internal' : 'article14'];

// ── case validation at the write path ───────────────────────────────────────────────────────────
// Enough of schema/case.schema.json to catch the defects that matter, zero-dep. It is a MIRROR, and
// cra/test/schema-drift.test.mjs holds the two in step the same way it does for products.
//
// LEGACY-TOLERANT BY DESIGN. Validation runs over the cases a write CREATES OR CHANGES, never the
// whole document: cases.json predates this schema, and hard-failing a pre-existing record would
// make updateCases refuse every write and strand the Art. 14 ledger — a guard that bricks the thing
// it guards. A legacy case that does not validate is REPORTED, and left exactly as it is.
const CASE_TRACKS = new Set(['article14', 'bestpractice', 'internal']);
const CASE_KINDS = new Set(['vulnerability', 'incident']);
const CASE_TRIGGERS = new Set(['incident-declared', 'kev', 'epss', 'crit']);
const CASE_STATUS = new Set(['open', 'acknowledged', 'closed']);

export function validateCase(kase) {
  const errs = [];
  const at = kase?.caseId || '(no caseId)';
  if (!kase || typeof kase !== 'object') return [`${at}: not an object`];
  if (typeof kase.caseId !== 'string' || !kase.caseId) errs.push(`${at}: caseId is required`);
  if (!CASE_KINDS.has(kase.kind)) errs.push(`${at}: kind '${kase.kind}' must be vulnerability|incident`);
  if (typeof kase.productId !== 'string' || !kase.productId) errs.push(`${at}: productId is required`);
  if (!CASE_TRIGGERS.has(kase.trigger)) errs.push(`${at}: trigger '${kase.trigger}' is not a declared trigger`);
  if (!CASE_STATUS.has(kase.status)) errs.push(`${at}: status '${kase.status}' must be open|acknowledged|closed`);
  if (kase.epss !== undefined && kase.epss !== null && typeof kase.epss !== 'number') errs.push(`${at}: epss must be a number or null (null = UNKNOWN, never 0)`);

  const c = kase.clocks;
  if (!c || typeof c !== 'object') { errs.push(`${at}: clocks are required — a case with no clock owes a deadline nobody is counting`); return errs; }
  if (!CASE_TRACKS.has(c.track)) errs.push(`${at}: clocks.track '${c.track}' must be article14|bestpractice|internal`);
  if (typeof c.basisAt !== 'string') errs.push(`${at}: clocks.basisAt is required — without it no elapsed fraction can be computed and every band renders 0%`);

  // The cross-track leak this exists to catch: an internal policy clock carrying an Art. 14 key
  // reads as a regulatory deadline everywhere downstream.
  const A14 = ['earlyWarningDue', 'notificationDue', 'finalDue'];
  const INT = ['triageDue', 'remediateDue'];
  if (c.track === 'internal') {
    for (const k of A14) if (c[k] !== undefined) errs.push(`${at}: internal clock carries Art. 14 key '${k}' — a policy deadline must never be readable as a regulatory one`);
    for (const k of INT) if (typeof c[k] !== 'string') errs.push(`${at}: internal clock is missing '${k}'`);
  } else if (CASE_TRACKS.has(c.track)) {
    for (const k of INT) if (c[k] !== undefined) errs.push(`${at}: reportable clock carries internal key '${k}'`);
    for (const k of A14) if (typeof c[k] !== 'string') errs.push(`${at}: ${c.track} clock is missing '${k}'`);
  }
  if (kase.reporting && kase.reporting.regime && !['regulatory', 'benchmark', 'unrecognised'].includes(kase.reporting.regime)) {
    errs.push(`${at}: reporting.regime '${kase.reporting.regime}' is not a declared regime`);
  }
  return errs;
}

/** Validate only what a write touched. Returns {errors, legacy} — legacy is reported, never fatal. */
export function validateCaseChanges(doc, before) {
  const errors = [], legacy = [];
  for (const [id, kase] of Object.entries(doc.cases || {})) {
    const prior = before?.[id];
    const changed = !prior || stableStringify(prior) !== stableStringify(kase);
    const errs = validateCase(kase);
    if (!errs.length) continue;
    if (changed) errors.push(...errs); else legacy.push(...errs);
  }
  return { errors, legacy };
}

// fix: the schema was decorative - nothing had ever applied schema/product.schema.json, so it
// drifted until it FORBADE manufacturer.establishedInEU, a field this file reads (2026-08-26).
// Path read at CALL time; hung off HERE, not craRoot(), because the schema ships with the module
// and a CW_CRA_ROOT fixture dir has no schema/ to find.
const productSchemaPath = () => (process.env.CW_PRODUCT_SCHEMA
  ? resolve(process.env.CW_PRODUCT_SCHEMA)
  : join(HERE, '..', 'schema', 'product.schema.json'));

export function validateProducts(doc) {
  const errors = [], advisories = [];
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { errors.push('products.json is not an object'); return { errors, advisories }; }
  // The mirror below and the schema are now BOTH applied: a shape the schema forbids is an error
  // here, and an unreadable schema is an error too (validateAgainstSchema refuses to report a
  // document valid against a schema nothing opened). Messages carry a `schema:` prefix, so an
  // overlap with the mirror's own findings is legible rather than confusing.
  errors.push(...validateAgainstSchema(doc, { path: productSchemaPath() }).errors);
  const m = doc.manufacturer;
  if (!m || typeof m !== 'object') errors.push('manufacturer (object) is required');
  else {
    if (!isStr(m.name)) errors.push('manufacturer.name is required');
    else if (PLACEHOLDER.test(m.name)) advisories.push('manufacturer.name is still a placeholder — Art. 14 notifications will carry a TODO');
    if (!isStr(m.contact)) errors.push('manufacturer.contact is required');
    else if (PLACEHOLDER.test(m.contact)) advisories.push('manufacturer.contact is still a placeholder — set a monitored mailbox');
    // fix: advise on address/euRepresentative/csirtMemberState too - only name and contact were
    // checked, so three placeholders reached Annex I and OSCAL output unremarked.
    if (isStr(m.address) && PLACEHOLDER.test(m.address)) advisories.push('manufacturer.address is still a placeholder — Annex I Part II documentation carries it');
    if (isStr(m.euRepresentative) && PLACEHOLDER.test(m.euRepresentative)) advisories.push('manufacturer.euRepresentative is still a placeholder — required by CRA Art. 18 when placing on the EU market from outside the EU');
    if (isStr(m.csirtMemberState) && PLACEHOLDER.test(m.csirtMemberState)) advisories.push('manufacturer.csirtMemberState is still a placeholder — it routes the Art. 14 notification');
  }
  if (!Array.isArray(doc.products) || !doc.products.length) { errors.push('products[] must be a non-empty array'); return { errors, advisories }; }
  const ids = new Set();
  let euCount = 0;
  for (const [i, p] of doc.products.entries()) {
    const at = `products[${i}]`;
    if (!p || typeof p !== 'object') { errors.push(`${at} is not an object`); continue; }
    if (!isStr(p.id) || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) errors.push(`${at}.id must match ^[a-z0-9][a-z0-9-]*$`);
    else if (ids.has(p.id)) errors.push(`${at}: duplicate product id '${p.id}'`);
    else ids.add(p.id);
    if (!isStr(p.name)) errors.push(`${at} (${p.id || '?'}): name is required`);
    if (!isStr(p.version)) errors.push(`${at} (${p.id || '?'}): version is required`);
    else if (PLACEHOLDER.test(p.version)) advisories.push(`${p.id}: version '${p.version}' is a placeholder — the SBOM filename embeds it`);
    if (!Array.isArray(p.repos) || !p.repos.every(isStr)) errors.push(`${at} (${p.id || '?'}): repos must be a non-empty array of strings`);
    else if (!p.repos.length) advisories.push(`${p.id}: no repos mapped — nothing to scan for this product`);
    if (!p.market || typeof p.market.eu !== 'boolean') errors.push(`${at} (${p.id || '?'}): market.eu (boolean) is required`);
    else if (p.market.eu) euCount++;

    // ── fields the SCHEMA declares and this mirror used to ignore ────────────────────────────────
    // Found by cra/test/schema-drift.test.mjs: five schema properties were permitted and checked by
    // nothing. Two of them carry CRA obligations, so silence here read as approval.
    if (isStr(p.supportEndsAt)) {
      const t = Date.parse(p.supportEndsAt);
      if (!Number.isFinite(t)) errors.push(`${at} (${p.id || '?'}): supportEndsAt '${p.supportEndsAt}' is not a date`);
      else if (t < Date.now()) advisories.push(`${p.id}: supportEndsAt ${p.supportEndsAt} is in the PAST — the CRA support period has lapsed, and vulnerability handling obligations run for its duration`);
    } else if (p.market?.eu) {
      advisories.push(`${p.id}: no supportEndsAt declared — the CRA requires a support period to be determined, and an undeclared one cannot be evidenced`);
    }
    if (isStr(p.cvdPolicyUrl)) { if (PLACEHOLDER.test(p.cvdPolicyUrl)) advisories.push(`${p.id}: cvdPolicyUrl is still a placeholder`); }
    else if (p.market?.eu) advisories.push(`${p.id}: no cvdPolicyUrl — Annex I Part II requires a coordinated vulnerability disclosure policy`);
    if (isStr(p.advisoriesUrl) && PLACEHOLDER.test(p.advisoriesUrl)) advisories.push(`${p.id}: advisoriesUrl is still a placeholder — it is where users are told to look for security updates`);
    if (isStr(p.description) && PLACEHOLDER.test(p.description)) advisories.push(`${p.id}: description is still a placeholder`);
    if (p.reporting !== undefined) {
      if (!p.reporting || typeof p.reporting !== 'object') errors.push(`${at} (${p.id || '?'}): reporting must be an object`);
      else if (!isStr(p.reporting.locale)) errors.push(`${at} (${p.id || '?'}): reporting.locale is required when reporting is present`);
      else if (!/^[A-Z]{2,3}$/.test(p.reporting.locale)) errors.push(`${at} (${p.id || '?'}): reporting.locale '${p.reporting.locale}' must be an uppercase 2-3 letter code — a misspelt locale resolves to 'unrecognised' and files nothing`);
    }
  }
  if (euCount === 0) advisories.push('no product has market.eu=true — the watch will open ZERO Art. 14 cases (seeded state; flip market.eu once a product is placed on the EU market)');

  // Both fields are correct as "N/A"/non-EU only while euCount is 0; they become Art. 18 / Art. 14
  // gaps the moment a product flips market.eu, which is edited elsewhere and later.
  if (euCount > 0) {
    // DERIVED from cra/csirt-directory.json, not re-listed. This set and the directory's
    // memberStates are the same 27 states; when they were two literals, adding a state to one left
    // the other silently rejecting it. Aliases (and the ISO codes, so 'DE' validates as readily as
    // 'Germany') are added on top of the derived names — see REMEDIATION-schema-derivation R1.
    const EU_STATES = euMemberStateNames();
    // Art. 18 binds only a manufacturer established OUTSIDE the EU, which nothing here can infer —
    // an EU-established one needs no representative and "N/A" is correct. Fires only on an explicit
    // establishedInEU:false; absent means unknown, and unknown is not a violation.
    const rep = isStr(m && m.euRepresentative) ? m.euRepresentative.trim() : '';
    if (m && m.establishedInEU === false && (!rep || /^(n\/?a|none|not applicable)$/i.test(rep))) {
      advisories.push(`manufacturer.euRepresentative is '${rep || '(unset)'}' while ${euCount} product(s) declare market.eu=true and establishedInEU is false — CRA Art. 18 requires an EU representative`);
    }
    // Only a SET non-EU value fires; unset is a pre-existing gap this does not widen.
    const state = isStr(m && m.csirtMemberState) ? m.csirtMemberState.trim() : '';
    if (state && !EU_STATES.has(state.toLowerCase())) {
      advisories.push(`manufacturer.csirtMemberState is '${state}', which is not an EU member state, while ${euCount} product(s) declare market.eu=true — it routes the Art. 14 notification and must name the member state whose CSIRT receives it`);
    }
  }
  return { errors, advisories };
}

function listSubdirNames(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

// Latest sweep batch dir under reportsRoot (sweep-<stamp>), if any.
//
// With no `repos` filter this is EXACTLY the old behaviour (newest by name across the whole
// reports root) — every existing caller (oscal.mjs, dashboard.mjs, controls.mjs, runtime.mjs,
// soc2.mjs) calls it this way and is unaffected.
//
// fact: "the newest sweep" and "the newest sweep OF THIS PRODUCT" are different questions and this answers the second (R22 fix 2) / the newest batch under reports/ is routinely an unrelated single-repo run, which made cra/sbom.mjs report "no per-repo SBOMs" for a product it had simply looked in the wrong directory for — a coverage GAP rendered as a coverage FACT (expiry: never, prev: wrong)
//
// fact: with `repos`, candidates filter newest-first to the latest batch whose batch-manifest.json names one in scope.repos — the field sweep.mjs writes and rollup.mjs reads (expiry: if sweep.mjs stops writing scope.repos, prev: not built)
// fact: an UNMANIFESTED batch is not automatically excluded — scope is then "the repo dirs physically present", rollup.mjs's own definition / treating a legacy batch as an automatic non-match would drop real coverage (expiry: if rollup.mjs changes that definition, prev: unknown)
// fact: no match returns NULL and the caller must report the gap / a silent fallback to an unrelated batch is the exact defect this exists to close (expiry: never, prev: broken)
export function latestSweepDir(reportsRoot, { repos = null } = {}) {
  let dirs;
  try {
    dirs = readdirSync(reportsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^sweep-\d/.test(e.name))
      .map((e) => e.name).sort();
  } catch { return null; }
  if (!dirs.length) return null;
  if (!repos || !repos.length) return join(reportsRoot, dirs[dirs.length - 1]);
  const want = new Set(repos);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const dir = join(reportsRoot, dirs[i]);
    const bm = loadJSON(join(dir, 'batch-manifest.json'), null);
    const scoped = bm?.scope?.repos
      ? bm.scope.repos.map((r) => (typeof r === 'string' ? r : r.name))
      : listSubdirNames(dir);
    if (scoped.some((n) => want.has(n))) return dir;
  }
  return null;
}

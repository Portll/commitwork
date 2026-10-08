#!/usr/bin/env node
// gradle-wrapper-verify.mjs — the two things ./gradlew does BEFORE any build logic runs.
//
//   1. reads distributionUrl from gradle-wrapper.properties and downloads a Gradle distribution
//      from it — a URL the scanned repository chooses
//   2. executes gradle-wrapper.jar, a committed BINARY that nobody diffs
//
// Both are checkable without running anything, and neither was being checked. This lane executes no
// Gradle, needs no container, and is the cheapest real signal available on a JVM repo.
//
// usage:  node bin/gradle-wrapper-verify.mjs [rootDir]
// env:    CW_REPORT_DIR · CW_GRADLE_CHECKSUMS (a {sha256: version} map to check the jar against)
//
// WHAT IT CANNOT DO, stated because the absence is the point: without Gradle's published checksum
// list this cannot say a jar is GOOD. It can say the URL is off-vendor, that the jar is absent, or
// that two repos declaring one Gradle version ship different jars. Unknown is reported as unknown.

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import * as fsSync from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { validateAgainstSchema } from '../monitor/registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] || process.cwd());
const OUT = process.env.CW_REPORT_DIR || null;

// Gradle's own distribution host. A wrapper pointing anywhere else is not automatically malicious —
// a corporate mirror is legitimate — but it is the single highest-value thing to surface, because
// it is where a hostile repo substitutes its own toolchain.
const VENDOR = /^https:\/\/services\.gradle\.org\/distributions\//;

/** Read at most `cap` bytes. The path is chosen by the scanned repository, so an unbounded read is
 *  a denial-of-scan it can trigger at will. Returns {buf} | {truncated,size} | {error}. */
function readCapped(path, cap) {
  let fd = null;
  try {
    const { statSync, openSync, readSync, closeSync } = fsSync;
    const size = statSync(path).size;
    if (size > cap) return { truncated: true, size };
    fd = openSync(path, 'r');
    const buf = Buffer.allocUnsafe(size);
    let off = 0;
    while (off < size) {
      const n = readSync(fd, buf, off, size - off, off);
      if (n <= 0) break;
      off += n;
    }
    return { buf: off === size ? buf : buf.subarray(0, off), size };
  } catch (e) {
    return { error: e.code || e.message };
  } finally {
    if (fd !== null) { try { fsSync.closeSync(fd); } catch { /* already closed */ } }
  }
}

export function verifyWrapper(root) {
  const props = join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const jar = join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  const gradlew = join(root, 'gradlew');

  if (!existsSync(gradlew) && !existsSync(props)) {
    // findings:[] even here. A consumer doing .findings.length must not have to know which shape
    // it was handed — an absent array and an empty one are the same claim and only one of them
    // throws.
    return { ran: true, applicable: false, findings: [], reason: 'no gradlew and no wrapper properties — this repo does not ship a Gradle wrapper' };
  }

  const findings = [];
  const out = { ran: true, applicable: true, hasGradlew: existsSync(gradlew) };

  // WHAT THIS VERIFIES, AND WHAT IT DOES NOT. It checks the wrapper FETCH PATH — where the Gradle
  // distribution comes from and what the committed wrapper binary is. It does NOT establish that
  // running the wrapper is safe, and nothing here should be read as saying so. An attacker who
  // leaves distributionUrl vendor-correct and the jar byte-identical, and puts the payload in
  // gradlew (a 248-line shell script), build.gradle, gradle.properties (org.gradle.jvmargs can
  // carry -javaagent:) or settings.gradle pluginManagement, defeats every check below.
  out.scope = 'wrapper-fetch-path';
  out.doesNotCover = ['build.gradle configuration-time code', 'gradle.properties jvmargs',
    'settings.gradle pluginManagement repositories', 'wrappers in sub-modules (root only)'];

  // ── the distribution URL ──────────────────────────────────────────────────────────────────────
  if (!existsSync(props)) {
    findings.push({ rule: 'wrapper-properties-absent', sev: 'med',
      message: 'gradlew is present but gradle/wrapper/gradle-wrapper.properties is not — the wrapper resolves its distribution from somewhere this check cannot see' });
  } else {
    // READABLE FIRST, AND NOTHING DERIVED IF IT IS NOT. An unreadable file produced FOUR findings
    // in the first cut of this function — "url absent" and "checksum undeclared" among them, both
    // assertions about a file nobody read. That is an unsupported finding, which is the defect
    // this whole lane exists to refuse, so the derived checks are gated on the read succeeding.
    let text = null;
    try { text = readFileSync(props, 'utf8'); } catch (e) {
      findings.push({ rule: 'wrapper-properties-unreadable', sev: 'med', message: `could not read gradle-wrapper.properties (${e.code || 'error'}) — UNKNOWN, and nothing is inferred from it` });
    }
    if (text !== null) {
      const m = /distributionUrl\s*=\s*(.+)/.exec(text);
      // Java .properties escapes the colon; other escapes exist and are NOT handled, so a URL this
      // cannot parse is reported as unparseable rather than silently treated as absent.
      const url = m ? m[1].trim().replace(/\\:/g, ':') : '';
      out.distributionUrl = url || null;
      const ver = /gradle-([0-9][0-9.]*)-(bin|all)\.zip/.exec(url);
      out.declaredVersion = ver ? ver[1] : null;

      if (!url) {
        findings.push({ rule: 'distribution-url-absent', sev: 'med', message: 'no distributionUrl in gradle-wrapper.properties — the wrapper cannot be told where it fetches from' });
      } else if (url.startsWith('http://')) {
        // ONE finding per fact. http:// also fails VENDOR, and emitting both made a single bad URL
        // look like two problems.
        findings.push({ rule: 'distribution-url-plaintext', sev: 'high', message: `distributionUrl is http:// — the toolchain is fetched over a channel any network position can rewrite: ${url.slice(0, 200)}` });
      } else if (!VENDOR.test(url)) {
        // HIGH: this is the substitution vector. A mirror is legitimate and this is not a verdict of
        // malice — it is the one line a reader must look at themselves.
        findings.push({ rule: 'distribution-url-off-vendor', sev: 'high',
          message: `distributionUrl points outside services.gradle.org: ${url.slice(0, 200)} — ./gradlew downloads and EXECUTES whatever is there, before any build logic is evaluated. A corporate mirror is legitimate; verify this one is.` });
      }
      if (!/distributionSha256Sum/.test(text)) {
        findings.push({ rule: 'distribution-checksum-undeclared', sev: 'low',
          message: 'no distributionSha256Sum — Gradle supports pinning the distribution hash and this wrapper does not, so a substituted download would not be detected by Gradle itself' });
      }
    }
  }

  // ── the script, which is the thing actually executed ──────────────────────────────────────────
  // gradlew is a ~248-line POSIX shell script. Checking the URL and the jar while never reading the
  // script that runs them was the largest false negative in the first cut: an attacker edits
  // gradlew, leaves the URL vendor-correct and the jar byte-identical, and the check reports clean.
  // Its hash is published for the same cross-repo comparison the jar gets — it is generated by
  // Gradle too, so siblings on one version should agree.
  if (out.hasGradlew) {
    const s = readCapped(gradlew, 512 * 1024);
    if (s.error) findings.push({ rule: 'gradlew-unreadable', sev: 'med', message: `could not read gradlew (${s.error}) — UNKNOWN, and nothing is inferred from it` });
    else if (s.truncated) findings.push({ rule: 'gradlew-oversized', sev: 'high', message: `gradlew is larger than 512 KB — the real wrapper script is a few hundred lines, and a shell script this size is not one` });
    else out.gradlewSha256 = createHash('sha256').update(s.buf).digest('hex');
  }

  // ── the committed jar ─────────────────────────────────────────────────────────────────────────
  if (!existsSync(jar)) {
    if (out.hasGradlew) {
      findings.push({ rule: 'wrapper-jar-absent', sev: 'low', message: 'gradlew is present but gradle-wrapper.jar is not — the wrapper would fetch one, which is a download this check cannot inspect' });
    }
  } else {
    // SIZE-CAPPED. readFileSync on a path the SCANNED REPOSITORY controls is a denial-of-scan: the
    // genuine wrapper jar is ~50 KB, and a committed 4 GB file would take the scanner down before
    // it reported anything. A scanner a scanned repo can kill is worse than one that declines.
    const j = readCapped(jar, 4 * 1024 * 1024);
    let buf = null;
    if (j.error) {
      findings.push({ rule: 'wrapper-jar-unreadable', sev: 'med', message: `could not read gradle-wrapper.jar (${j.error}) — UNKNOWN, not absent` });
    } else if (j.truncated) {
      findings.push({ rule: 'wrapper-jar-oversized', sev: 'high',
        message: `gradle-wrapper.jar exceeds 4 MB — the genuine wrapper is roughly 50 KB. It is NOT hashed, because reading it whole is what an oversized file is for.` });
      out.jarBytes = j.size;
    } else { buf = j.buf; }
    if (buf) {
      out.jarSha256 = createHash('sha256').update(buf).digest('hex');
      out.jarBytes = buf.length;
      // A checksum map is OPTIONAL and its absence is reported, never assumed clean. Without it the
      // hash is published for cross-repo comparison and nothing is asserted about goodness.
      const mapPath = process.env.CW_GRADLE_CHECKSUMS;
      if (mapPath && existsSync(mapPath)) {
        let map = null;
        try { map = JSON.parse(readFileSync(mapPath, 'utf8')); } catch { map = null; }
        if (!map) {
          out.checksumCheck = 'unreadable';
        } else if (Object.prototype.hasOwnProperty.call(map, out.jarSha256)) {
          out.checksumCheck = 'known';
          out.jarMatchesVersion = map[out.jarSha256];
        } else {
          out.checksumCheck = 'unknown-hash';
          findings.push({ rule: 'wrapper-jar-unrecognised', sev: 'high',
            message: `gradle-wrapper.jar sha256 ${out.jarSha256.slice(0, 16)}… is not in the known-good list. ./gradlew executes this binary before any build file is read.` });
        }
      } else {
        // Not a finding. An unchecked jar is an UNKNOWN, and saying so is the whole point.
        out.checksumCheck = 'no-reference-list';
      }
    }
  }

  return { ...out, findings };
}

/**
 * Cross-repo agreement, which needs NO reference list because the corpus is its own reference.
 *
 * Two repos declaring the same Gradle version should ship the same wrapper jar — it is generated by
 * Gradle, not written by the project. A disagreement is not proof of anything (a project may have
 * regenerated with a different Gradle than its distributionUrl now claims, which is common and
 * harmless) but it is the ONE shape a substituted jar would take, and it costs nothing to surface.
 *
 * Measured on the 100randomrepos corpus 2026-08-22: RxJava and caffeine both declare gradle 9.7.0
 * and ship different jars; junit-framework declares 9.7.1 and ships RxJava's. So caffeine is the
 * outlier and someone should be able to say why.
 */
export function fleetAgreement(results, { artifact = 'jarSha256' } = {}) {
  const label = artifact === 'gradlewSha256' ? 'gradlew' : 'gradle-wrapper.jar';
  const byVersion = new Map();
  const singletons = [];
  for (const r of results) {
    if (!r || !r.applicable || !r.declaredVersion || !r[artifact]) continue;
    if (!byVersion.has(r.declaredVersion)) byVersion.set(r.declaredVersion, new Map());
    const m = byVersion.get(r.declaredVersion);
    if (!m.has(r[artifact])) m.set(r[artifact], []);
    m.get(r[artifact]).push(r.repo || r.root);
  }
  const disagreements = [];
  for (const [version, hashes] of byVersion) {
    // A version only ONE repo declares cannot be cross-checked at all, and that is the cheapest way
    // to defeat this check — declare a version no sibling uses. Counted and reported, because an
    // unexaminable repo is not an agreeing one.
    const total = [...hashes.values()].reduce((a, v) => a + v.length, 0);
    if (total < 2) { singletons.push({ version, repos: [...hashes.values()].flat() }); continue; }
    if (hashes.size < 2) continue;
    // The majority hash is the reference only in the weak sense of "most repos agree" — it is
    // explicitly NOT an assertion that the majority is good.
    const groups = [...hashes.entries()].map(([sha, repos]) => ({ sha, repos, n: repos.length }))
      .sort((a, b) => b.n - a.n);
    disagreements.push({ artifact: label, version, groups,
      note: `${hashes.size} distinct ${label} hashes across repos all declaring gradle ${version}. It is generated by Gradle, not authored by the project, so they should match. A project that regenerated with a different Gradle than its distributionUrl claims produces this harmlessly — and so does a substituted one.` });
  }
  return { artifact: label, versionsCompared: byVersion.size, disagreements, unexaminable: singletons };
}

// Env read at CALL time, not module load, or a test setting CW_GRADLE_WRAPPER_SCHEMA after import
// silently gets the default and passes while proving nothing.
const schemaPath = () => process.env.CW_GRADLE_WRAPPER_SCHEMA
  || join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'schema', 'gradle-wrapper.schema.json');

/**
 * Refuse to publish a document that does not match its declared shape.
 *
 * The sibling scannerFindings rows have been schema-validated all along; this one was not, so a
 * consumer could not distinguish a RENAMED field from one that never existed. Fails closed —
 * an unreadable schema is fatal rather than a skipped check, per validateAgainstSchema's own rule.
 */
export function assertValidDocument(doc, { path = schemaPath() } = {}) {
  const { errors } = validateAgainstSchema(doc, { path });
  if (errors.length) {
    throw new Error(`gradle-wrapper.json does not match ${path}:\n  - ${errors.join('\n  - ')}`);
  }
  return doc;
}

if (isMainModule(import.meta.url)) {
  const res = verifyWrapper(ROOT);
  const doc = { tool: 'gradle-wrapper-verify', generatedAt: nowISO(), root: ROOT.replace(process.env.HOME || '', '~'), ...res };
  assertValidDocument(doc);
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'gradle-wrapper.json'), `${JSON.stringify(doc, null, 2)}\n`); }
  if (!res.applicable) { console.log(`gradle-wrapper-verify: n/a — ${res.reason}`); process.exit(0); }
  console.log(`gradle-wrapper-verify: ${res.findings.length} finding(s) · version ${res.declaredVersion || '?'} · jar ${res.jarSha256 ? `${res.jarSha256.slice(0, 16)}…` : 'absent'} · checksums ${res.checksumCheck || 'n/a'}`);
  for (const f of res.findings) console.log(`  [${f.sev}] ${f.rule} — ${f.message.slice(0, 150)}`);
  process.exit(res.findings.some((f) => f.sev === 'high') ? 1 : 0);
}

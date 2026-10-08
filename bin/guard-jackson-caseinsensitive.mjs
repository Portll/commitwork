#!/usr/bin/env node
/*
 * guard-jackson-caseinsensitive.mjs — enforce the control that keeps jackson-databind
 * CVE-2026-54515 (case-insensitive @JsonIgnoreProperties deserialization bypass) UNREACHABLE.
 *
 * Exploitable only when ACCEPT_CASE_INSENSITIVE_PROPERTIES is enabled (opt-in, off by default);
 * fails if anything enables it in Java or Spring config. Exit 0 = clean (or SKIPPED: nothing of the
 * scanned types), 1 = violation, 2 = a root, directory or file it could not read — undetermined,
 * never OK. A violation outranks an unread path: both are printed, the exit is 1.
 *
 *   node bin/guard-jackson-caseinsensitive.mjs [rootDir]   (default: the current directory)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || process.cwd();

// Enablement patterns (case-insensitive-properties turned ON). Disabling / mere mention is fine.
const JAVA_ON = [
  /ACCEPT_CASE_INSENSITIVE_PROPERTIES\s*,\s*true/,                       // configure(..., true)
  /\.enable\s*\(\s*[^)]*ACCEPT_CASE_INSENSITIVE_PROPERTIES/,             // .enable(...)
];
const CONFIG_ON = [
  /accept-case-insensitive-properties\s*[:=]\s*true/i,                   // yaml/properties
  /accept_case_insensitive_properties\s*[:=]\s*true/i,
];

const violations = [];
const unreadable = [];
let scanned = 0;
// fix: every read failure was a silent skip, so a 000 config that enabled the feature reported OK.
// Only ENOENT (gone between readdir and stat) is legitimately absent.
const unread = (p, e) => { if (e?.code !== 'ENOENT') unreadable.push(`${p}: ${e?.code || e?.message || e}`); };
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch (e) { unread(dir, e); return; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'build' || name === '.git' || name === 'out') continue;
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch (e) { unread(p, e); continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(java|ya?ml|properties)$/.test(name)) continue;
    let txt; try { txt = readFileSync(p, 'utf8'); } catch (e) { unread(p, e); continue; }
    scanned++;
    const pats = name.endsWith('.java') ? JAVA_ON : CONFIG_ON;
    txt.split('\n').forEach((line, i) => {
      if (pats.some(re => re.test(line))) violations.push(`${p}:${i + 1}: ${line.trim()}`);
    });
  }
}
// A root that is not there is a missing input; SKIPPED would read as "nothing here to guard".
try { statSync(ROOT); } catch (e) {
  console.error(`guard-jackson-caseinsensitive: NOT RUN — ${ROOT} could not be read (${e?.code || e?.message || e}); nothing was scanned and this is NOT a clean result.`);
  process.exit(2);
}
walk(ROOT);

if (violations.length) {
  console.error('GUARD FAILED — ACCEPT_CASE_INSENSITIVE_PROPERTIES enabled (opens jackson CVE-2026-54515):');
  violations.forEach(v => console.error('  ' + v));
  process.exitCode = 1;
}
if (unreadable.length) {
  console.error(`guard-jackson-caseinsensitive: UNREADABLE — ${unreadable.length} path(s) under ${ROOT} could not be read, and any of them may enable the feature (${scanned} file(s) scanned is NOT a clean result):`);
  unreadable.forEach(u => console.error('  ' + u));
  if (!violations.length) process.exitCode = 2;
}
// A guard that read nothing says SKIPPED, not OK. Exit 0 — the manifest reads non-zero as a violation.
if (!violations.length && !unreadable.length) {
  if (!scanned) console.log(`guard-jackson-caseinsensitive: SKIPPED — no .java/.yml/.properties files under ${ROOT} (nothing scanned; this is NOT a clean result).`);
  else console.log(`guard-jackson-caseinsensitive: OK — ACCEPT_CASE_INSENSITIVE_PROPERTIES not enabled in ${scanned} scanned file(s) under ${ROOT} (CVE-2026-54515 unreachable here).`);
}

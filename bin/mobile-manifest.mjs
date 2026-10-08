#!/usr/bin/env node
// Mobile manifest scan — AndroidManifest.xml and Info.plist.
//
// Closes Top 100 entry 109 (exported components, deep links, unprotected IPC), which nothing else
// in the fleet reaches: CodeQL sees Android and iOS *source*, and no lane has ever parsed the
// manifest that decides what is exported, what is backed up, and whether cleartext is permitted.
// Also carries part of 108 (transport trust) and 107 (local storage), and android:debuggable → 76.
//
// Emits SARIF, deliberately. `generic` is in PASSTHROUGH_FORMATS: parseReport scores it ok on the
// file EXISTING, so a lane declaring it greens whatever it wrote. SARIF is parsed, so severity is
// derived from contents and an empty run is a real zero rather than a file that turned up.
//
// WHAT THIS DELIBERATELY DOES NOT FLAG, and why it matters more than what it does:
//
//   · A LAUNCHER activity with exported="true" — that is required for the app to start. Flagging it
//     would fire on essentially every Android application.
//   · The ABSENCE of android:allowBackup or networkSecurityConfig — absence is the platform default,
//     not a decision the author made.
//   · Custom URL schemes — an entry point to review, not a defect. Emitted at `note`.
//
// That restraint is the design. GuardDog's `capability-*` rules published 602 of 675 rows at `med`
// for "this package can open a socket", true of almost every package; Prowler asserted 1,067 FAILs
// about a field GitHub never returned. A lane that fires on ~100% of its subjects is measuring the
// platform, not the application. bin/test/mobile-manifest.test.mjs asserts a well-formed manifest
// produces ZERO findings, which is the assertion that keeps this honest.
//
// usage: node bin/mobile-manifest.mjs [root] [--json|--sarif]   (default: SARIF on stdout)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'out', 'Pods', '.gradle',
  'DerivedData', 'vendor', 'reports', '.idea']);

// Env is read at CALL time, never at module load — a const at import defeats any test that sets it.
const rootArg = () => process.argv.slice(2).find((a) => !a.startsWith('--'))
  || process.env.CW_MOBILE_ROOT || '.';

/** Every AndroidManifest.xml / Info.plist under root, deterministically ordered. */
export function findManifests(root, { maxDepth = 8 } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }                        // unreadable dir: skip this branch, never the scan
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1); }
      else if (e.name === 'AndroidManifest.xml') out.push({ path: p, kind: 'android' });
      else if (e.name === 'Info.plist') out.push({ path: p, kind: 'ios' });
    }
  };
  try { if (statSync(root).isDirectory()) walk(root, 0); } catch { /* missing root → no manifests */ }
  return out;
}

// ── a tolerant XML tag scanner ──────────────────────────────────────────────────────────────────
// Not a parser: enough to know each tag's name, attributes, nesting and line. Zero dependencies is
// a house rule, and AndroidManifest/Info.plist are small and regular enough that this is honest.
export function scanTags(xml) {
  const tags = [];
  const stack = [];
  const re = /<\/?([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [full, name, rawAttrs, selfClose] = m;
    const line = xml.slice(0, m.index).split('\n').length;
    if (full.startsWith('</')) { stack.pop(); continue; }
    const attrs = {};
    const are = /([\w.:-]+)\s*=\s*"([^"]*)"|([\w.:-]+)\s*=\s*'([^']*)'/g;
    let a;
    while ((a = are.exec(rawAttrs))) attrs[a[1] ?? a[3]] = a[2] ?? a[4];
    const node = { name, attrs, line, parent: stack[stack.length - 1] || null, children: [] };
    if (node.parent) node.parent.children.push(node);
    tags.push(node);
    if (!selfClose) stack.push(node);
  }
  return tags;
}

const COMPONENTS = new Set(['activity', 'activity-alias', 'service', 'receiver', 'provider']);

/** True when a component declares the LAUNCHER category — it MUST be exported to start the app. */
function isLauncher(node) {
  return node.children.some((c) => c.name === 'intent-filter'
    && c.children.some((k) => k.name === 'category'
      && /LAUNCHER|LEANBACK_LAUNCHER/.test(k.attrs['android:name'] || '')));
}

export function scanAndroid(xml, file) {
  const findings = [];
  const add = (rule, level, line, message) => findings.push({ rule, level, file, line, message });

  for (const n of scanTags(xml)) {
    const a = n.attrs;
    const exported = a['android:exported'];
    const name = a['android:name'] || '(unnamed)';

    if (n.name === 'application') {
      if (a['android:debuggable'] === 'true') {
        add('mobile/debuggable', 'error', n.line,
          'android:debuggable="true" ships a build any user can attach a debugger to and read process memory from. Top 100 entry 76.');
      }
      if (a['android:usesCleartextTraffic'] === 'true') {
        add('mobile/cleartext-traffic', 'warning', n.line,
          'android:usesCleartextTraffic="true" permits plaintext HTTP for the whole application. Top 100 entry 108.');
      }
      if (a['android:allowBackup'] === 'true') {
        add('mobile/allow-backup', 'warning', n.line,
          'android:allowBackup="true" lets application data be extracted over adb on a debuggable-capable device. Top 100 entry 107. '
          + '(Only an EXPLICIT "true" is reported; the absence of this attribute is the platform default, not an author decision.)');
      }
    }

    if (!COMPONENTS.has(n.name)) continue;
    const hasFilter = n.children.some((c) => c.name === 'intent-filter');

    // The exemption that keeps this lane from measuring the platform.
    if (isLauncher(n)) continue;

    if (exported === 'true' && !a['android:permission']) {
      add('mobile/exported-no-permission', 'error', n.line,
        `<${n.name} android:name="${name}"> is exported with no android:permission, so any other application on the device can invoke it. Top 100 entry 109.`);
    } else if (exported === undefined && hasFilter) {
      add('mobile/implicitly-exported', 'warning', n.line,
        `<${n.name} android:name="${name}"> declares an intent-filter without an explicit android:exported. Older platforms export it implicitly. Top 100 entry 109.`);
    }

    if (n.name === 'provider' && a['android:grantUriPermissions'] === 'true' && exported === 'true') {
      add('mobile/provider-grant-uri', 'warning', n.line,
        `<provider android:name="${name}"> is exported and grants URI permissions, widening what a caller may read. Top 100 entry 109.`);
    }
  }
  return findings;
}

export function scanPlist(xml, file) {
  const findings = [];
  const tags = scanTags(xml);
  // <key>X</key> followed by its value sibling — plist's shape, read positionally.
  const keyAt = (want) => {
    const idx = [];
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- want is a literal plist key name at each call site
    const re = new RegExp(`<key>\\s*${want}\\s*</key>`, 'g');
    let m; while ((m = re.exec(xml))) idx.push(xml.slice(0, m.index).split('\n').length);
    return idx;
  };
  for (const line of keyAt('NSAllowsArbitraryLoads')) {
    const after = xml.split('\n').slice(line - 1, line + 1).join(' ');
    if (/<true\s*\/>/.test(after)) {
      findings.push({ rule: 'mobile/ats-arbitrary-loads', level: 'error', file, line,
        message: 'NSAppTransportSecurity → NSAllowsArbitraryLoads is true, disabling App Transport Security so the app accepts plaintext HTTP. Top 100 entry 108.' });
    }
  }
  for (const line of keyAt('CFBundleURLSchemes')) {
    findings.push({ rule: 'mobile/custom-url-scheme', level: 'note', file, line,
      message: 'A custom URL scheme is registered. Any application can invoke it, so treat its handler as an untrusted entry point. Top 100 entry 109. Reported as a note, not a defect — registering a scheme is normal.' });
  }
  void tags;
  return findings;
}

export function scan(root = '.') {
  const manifests = findManifests(root);
  const findings = [];
  for (const m of manifests) {
    let xml;
    try { xml = readFileSync(m.path, 'utf8'); }
    catch (e) {
      // Fail closed: an unreadable manifest is a void, never an absence of findings.
      findings.push({ rule: 'mobile/unreadable-manifest', level: 'error', file: relative(root, m.path) || m.path, line: 1,
        message: `manifest could not be read (${e.code || e.message}) — this is a coverage void, not a clean result` });
      continue;
    }
    const rel = relative(root, m.path).split(sep).join('/') || m.path;
    findings.push(...(m.kind === 'android' ? scanAndroid(xml, rel) : scanPlist(xml, rel)));
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.line - b.line);
  return { manifests: manifests.length, findings };
}

const LEVEL_SEVERITY = { error: '8.0', warning: '5.0', note: '2.0' };

export function toSarif({ manifests, findings }) {
  const rules = [...new Set(findings.map((f) => f.rule))].sort().map((id) => ({
    id, name: id, shortDescription: { text: id },
    properties: { 'security-severity': LEVEL_SEVERITY[findings.find((f) => f.rule === id).level] || '5.0' },
  }));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'commitwork-mobile-manifest', informationUri: 'https://github.com/Portll/commitwork', rules } },
      // Stated so a zero can be read correctly: no manifests found means NOT APPLICABLE, which is
      // different from a scan that examined manifests and found nothing wrong.
      properties: { manifestsExamined: manifests },
      results: findings.map((f) => ({
        ruleId: f.rule,
        level: f.level,
        message: { text: f.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }],
      })),
    }],
  };
}

if (isMainModule(import.meta.url)) {
  const res = scan(rootArg());
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  } else if (res.manifests === 0) {
    // WRITE NOTHING. A SARIF with zero results parses as sev:'ok' — a clean scan — and this lane
    // examined no manifest at all. The `appliesIfExists` gate should mean we are never reached on a
    // non-mobile repo, but a lane must not depend on its own gate to avoid publishing a false
    // clean. An absent artifact reads as not-scanned, which is the true state. This is the pattern
    // tls-headers already uses: "no https endpoint writes no report — not-scanned must not read as
    // pass".
    process.stderr.write('mobile-manifest: no AndroidManifest.xml or Info.plist found — writing NO sarif, '
      + 'which classifies as not-scanned rather than a clean zero\n');
  } else {
    process.stdout.write(JSON.stringify(toSarif(res), null, 2) + '\n');
  }
  process.exitCode = 0;   // findings are reported in the SARIF, not via exit code
}

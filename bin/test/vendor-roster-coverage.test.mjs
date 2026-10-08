// bin/test/vendor-roster-coverage.test.mjs — the second witness over vendor-verify's ROSTER.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// `bin/vendor-verify.mjs` answers one question well: do the bytes of the assets the roster NAMES
// match the publisher's? It never reads the directory — it only walks the paths it was handed — so
// it structurally cannot answer the other question: does the roster name everything that is there?
// An unlisted blob dropped into `sitemap/vendor/` is therefore verified by nothing, disclosed in
// `docs/THIRD-PARTY-NOTICES.md` by nothing, and invisible to every test that existed before this
// file. The roster has been right; nothing made it HAVE to be, so nothing could notice when it
// stopped being.
//
// This witness cannot share that failure mode. It reads the filesystem where the verifier reads a
// literal array, and it needs no registry, no tarball and no network to return an answer.
//
// ── THE POPULATION, STATED RATHER THAN GLOBBED ──────────────────────────────────────────────────
// EVERY regular file under each vendored directory, recursively, with NO extension filter. An
// extension filter is this same defect wearing a fix's clothes: `*.js` waves a `.wasm`, a `.css`,
// a sourcemap or a renamed bundle straight through, and the rule that let it past lives inside a
// glob instead of being written down. Recursing rather than refusing to recurse is deliberate too
// — a blob one directory deeper would otherwise be a second blind spot of exactly this shape.
//
// Each file is then classified into exactly one of two kinds, each with its own obligation:
//
//   ASSET   Redistributed third-party code or data. MUST appear in the ROSTER, so its bytes get
//           checked against the publisher, and MUST be named in the disclosure section of
//           docs/THIRD-PARTY-NOTICES.md.
//
//   NOTICE  A licence text travelling beside an asset — basename matching /^LICEN[CS]E/i. It is
//           the disclosure, so it cannot also be the disclosure's subject: it MUST NOT be a roster
//           entry, because the roster's contract is "byte-identical to a named entry inside a
//           named npm tarball" and a notice is copied under a different name than it carries
//           upstream. It MUST still be named in the notices document, so a sidecar cannot arrive
//           unannounced either. A peer landed `sitemap/vendor/LICENSE-three.txt` on 2026-10-04 as
//           the MIT notice for `OrbitControls.js`, which is what forced this kind to be named.
//
// Anything that is neither a regular file nor a directory — a symlink, a socket, a device — is a
// THIRD outcome and fails. The roster's claim is over bytes in this tree, and a symlink's bytes
// are somewhere else.
//
// ── FAIL CLOSED ─────────────────────────────────────────────────────────────────────────────────
// A directory that cannot be read is not an empty directory, and an empty directory is not a
// covered one. An ABSENT vendored directory FAILS, including when the roster is empty: the
// directory list below is a declaration, and if vendoring is genuinely withdrawn the declaration
// has to be withdrawn in the same change set rather than silently turning this check vacuous.
//
// Nothing here is keyed on a line number, and every env read happens at call time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoster } from '../vendor-verify.mjs';
import { withUnreadable, isRefusal, ignoresPermissions } from '../../lib/fs-unreadable.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Declared, not derived. Deriving the directories purely from the roster would make an empty
// roster prove an empty tree — the one thing this check must be unable to do.
export const DECLARED_VENDOR_DIRS = ['sitemap/vendor'];

// The heading whose section has to carry the disclosure. Section-scoped on purpose: every vendored
// path is also named in the document's own "gaps" prose, so a whole-document substring search
// could be satisfied by a paragraph that describes the asset as UNDISCLOSED.
export const NOTICES_SECTION = '## 2. Vendored JavaScript';

const isNotice = (basename) => /^licen[cs]e/i.test(basename);

/** Every repo-relative path the roster plus the declaration says we must look under. */
export function vendorDirs(roster) {
  const dirs = new Set(DECLARED_VENDOR_DIRS);
  for (const item of roster) dirs.add(posix.dirname(String(item.path).split(sep).join('/')));
  return [...dirs].filter((d) => d && d !== '.').sort();
}

/**
 * Enumerate one vendored directory, recursively.
 * -> { files: [repo-relative posix path], odd: [...] }
 * Throws on ANY read failure, absence included. The caller does not get to read a refusal or a
 * missing directory as "nothing vendored here".
 */
export function enumerateVendorDir(root, relDir) {
  const files = [], odd = [];
  const walk = (rel) => {
    for (const ent of readdirSync(join(root, rel.split('/').join(sep)), { withFileTypes: true })) {
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(child);
      else if (ent.isFile()) files.push(child);
      else odd.push(child); // symlink, socket, fifo, device — bytes that are not in this tree
    }
  };
  walk(relDir);
  return { files: files.sort(), odd: odd.sort() };
}

/** The slice of `text` under `heading`, up to the next same-or-shallower ATX heading. */
export function noticesSection(text, heading) {
  const at = text.indexOf(heading);
  if (at === -1) return null;
  const rest = text.slice(at + heading.length);
  const next = rest.search(/\n#{1,2} /);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Does `section` name `path` as a path rather than as a prefix of a longer one?
 * The trailing boundary is what stops `sitemap/vendor/three.min.js` being satisfied by a mention
 * of `sitemap/vendor/three.min.js.map`, and the full repo-relative path (slashes and all) is what
 * stops a bare basename colliding with ordinary prose.
 */
export function namesPath(section, path) {
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal or escaped value defined in the test
  return new RegExp(`${esc}(?![\\w.\\-/])`).test(section);
}

/**
 * The whole judgement, pure: no env, no fixed paths, no network.
 * -> array of problem strings. Empty means covered.
 */
export function coverageProblems({ root, roster, noticesText }) {
  const problems = [];
  const listed = new Map(roster.map((i) => [String(i.path).split(sep).join('/'), i]));
  const section = noticesText === null ? null : noticesSection(noticesText, NOTICES_SECTION);
  if (noticesText !== null && section === null) {
    problems.push(`notices document has no '${NOTICES_SECTION}' section, so nothing can be disclosed in it`);
  }

  const onDisk = new Set();
  for (const dir of vendorDirs(roster)) {
    let found;
    try {
      found = enumerateVendorDir(root, dir);
    } catch (e) {
      // ENOENT included: a declared vendored directory that is absent is an unannounced change,
      // not an empty population.
      problems.push(`vendored directory ${dir} could not be enumerated (${e.code || e.message}) — not read as empty`);
      continue;
    }
    for (const p of found.odd) problems.push(`${p} is not a regular file, so its bytes are not in this tree`);
    for (const p of found.files) {
      onDisk.add(p);
      const base = posix.basename(p);
      if (isNotice(base)) {
        if (listed.has(p)) problems.push(`${p} is a licence notice and must not be a ROSTER entry`);
      } else if (!listed.has(p)) {
        problems.push(`${p} is on disk but no ROSTER entry names it — verified by nothing, disclosed by nothing`);
      }
      if (section && !namesPath(section, p)) problems.push(`${p} is not named under '${NOTICES_SECTION}' in the notices document`);
    }
  }

  for (const p of listed.keys()) {
    if (!onDisk.has(p)) problems.push(`ROSTER names ${p} but no such file is in the tree`);
  }
  return problems;
}

// Env read at CALL time, never at module load, so a test that sets CW_VENDOR_ROSTER or
// CW_VENDOR_ROOT after this module is imported still bites.
const repoRoot = () => resolve(process.env.CW_VENDOR_ROOT || join(HERE, '..', '..'));
const noticesPath = () => join(repoRoot(), 'docs', 'THIRD-PARTY-NOTICES.md');

function realInputs() {
  return { root: repoRoot(), roster: loadRoster(), noticesText: readFileSync(noticesPath(), 'utf8') };
}

// ── the real tree, both directions, asserted separately ─────────────────────────────────────────

// DIRECTION 1 — disk -> roster. This is the direction that lies to you today: nothing else in the
// repository looks at the directory at all.
test('every file in a vendored directory is accounted for by the ROSTER', () => {
  const { root, roster } = realInputs();
  const unaccounted = [];
  for (const dir of vendorDirs(roster)) {
    const listed = new Set(roster.map((i) => String(i.path).split(sep).join('/')));
    for (const p of enumerateVendorDir(root, dir).files) {
      if (!isNotice(posix.basename(p)) && !listed.has(p)) unaccounted.push(p);
    }
  }
  assert.deepEqual(unaccounted, [], `vendored blob(s) no ROSTER entry names: ${unaccounted.join(', ')}`);
});

// DIRECTION 2 — roster -> disk. Deliberately NOT a duplicate of the verifier's own absence check.
// `readLocal` in bin/vendor-verify.mjs reports an absent roster path as UNVERIFIABLE (exit 2) — a
// REPORT, produced only when the whole lane runs, which needs a registry and a tarball. This is the
// same property asserted offline, in milliseconds, as a hard failure. Two witnesses, and the one
// that runs on every suite is the one that does not need the network.
test('every ROSTER entry names a file that is actually in the tree', () => {
  const { root, roster } = realInputs();
  const missing = roster
    .map((i) => String(i.path).split(sep).join('/'))
    .filter((p) => {
      try { readFileSync(join(root, p.split('/').join(sep))); return false; } catch { return true; }
    });
  assert.deepEqual(missing, [], `ROSTER names path(s) this tree does not have: ${missing.join(', ')}`);
});

test('a licence notice beside an asset is not itself a ROSTER entry', () => {
  const { root, roster } = realInputs();
  const listed = new Set(roster.map((i) => String(i.path).split(sep).join('/')));
  const misfiled = [];
  for (const dir of vendorDirs(roster)) {
    for (const p of enumerateVendorDir(root, dir).files) {
      if (isNotice(posix.basename(p)) && listed.has(p)) misfiled.push(p);
    }
  }
  assert.deepEqual(misfiled, [], `licence notice(s) wrongly rostered: ${misfiled.join(', ')}`);
});

// The loop the finding actually names: the roster is also what keeps the notices document from
// going stale. A new roster entry now has to gain a disclosure line too.
test('every vendored file is named in the disclosure section of THIRD-PARTY-NOTICES.md', () => {
  const { root, roster, noticesText } = realInputs();
  const section = noticesSection(noticesText, NOTICES_SECTION);
  assert.ok(section, `notices document has no '${NOTICES_SECTION}' section`);
  const undisclosed = [];
  for (const dir of vendorDirs(roster)) {
    for (const p of enumerateVendorDir(root, dir).files) if (!namesPath(section, p)) undisclosed.push(p);
  }
  assert.deepEqual(undisclosed, [], `vendored file(s) absent from the disclosure section: ${undisclosed.join(', ')}`);
});

test('the real tree raises no coverage problem at all', () => {
  assert.deepEqual(coverageProblems(realInputs()), []);
});

// ── the floor: this guard has been watched failing ───────────────────────────────────────────────
// All of the following work in a throwaway fixture tree. Never in the real one — a floor-check that
// writes into sitemap/vendor/ is a scanner finding waiting to be committed by a peer mid-edit.

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-roster-'));
  const vendor = join(dir, 'sitemap', 'vendor');
  mkdirSync(vendor, { recursive: true });
  writeFileSync(join(vendor, 'lib.js'), 'export const a = 1;\n');
  writeFileSync(join(vendor, 'LICENSE-lib.txt'), 'MIT\n');
  const roster = [{ path: 'sitemap/vendor/lib.js', pkg: 'lib', version: '1.0.0', entry: 'package/lib.js' }];
  const noticesText = [
    '# notices', '', NOTICES_SECTION, '',
    '- `sitemap/vendor/lib.js` from lib 1.0.0.',
    '- `sitemap/vendor/LICENSE-lib.txt` is its MIT notice.', '',
    '## 3. Something else', '',
  ].join('\n');
  return { dir, vendor, inputs: { root: dir, roster, noticesText } };
}

test('FLOOR: a covered fixture passes, then the same fixture with one extra blob FAILS', (t) => {
  const { dir, vendor, inputs } = fixture();
  try {
    assert.deepEqual(coverageProblems(inputs), [], 'the fixture must start clean or the floor proves nothing');

    const intruder = join(vendor, 'unlisted-bundle.js');
    writeFileSync(intruder, 'window.x = 1;\n');
    const withIntruder = coverageProblems(inputs);
    assert.ok(
      withIntruder.some((p) => p.startsWith('sitemap/vendor/unlisted-bundle.js is on disk but no ROSTER entry names it')),
      `an unlisted blob must be reported; got ${JSON.stringify(withIntruder)}`,
    );

    rmSync(intruder);
    assert.deepEqual(coverageProblems(inputs), [], 'removing the blob must restore the pass');
    t.diagnostic('floor confirmed: clean -> FAIL on one extra blob -> clean again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FLOOR: an extension this check has never seen still fails', () => {
  const { dir, vendor, inputs } = fixture();
  try {
    writeFileSync(join(vendor, 'runtime.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
    assert.ok(coverageProblems(inputs).some((p) => p.includes('runtime.wasm')), 'a .wasm blob must not pass as "not JavaScript"');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('FLOOR: a blob one directory deeper fails rather than being skipped', () => {
  const { dir, vendor, inputs } = fixture();
  try {
    mkdirSync(join(vendor, 'nested'));
    writeFileSync(join(vendor, 'nested', 'deep.js'), 'x\n');
    assert.ok(coverageProblems(inputs).some((p) => p.includes('sitemap/vendor/nested/deep.js')), 'recursion must reach it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('FLOOR: a rostered path removed from disk fails', () => {
  const { dir, vendor, inputs } = fixture();
  try {
    rmSync(join(vendor, 'lib.js'));
    const problems = coverageProblems(inputs);
    assert.ok(problems.some((p) => p === 'ROSTER names sitemap/vendor/lib.js but no such file is in the tree'), JSON.stringify(problems));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('FLOOR: a licence notice promoted into the ROSTER fails', () => {
  const { dir, inputs } = fixture();
  try {
    const roster = [...inputs.roster, { path: 'sitemap/vendor/LICENSE-lib.txt', pkg: 'lib', version: '1.0.0', entry: 'package/LICENSE' }];
    const problems = coverageProblems({ ...inputs, roster });
    assert.ok(problems.some((p) => p.includes('must not be a ROSTER entry')), JSON.stringify(problems));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('FLOOR: a vendored file missing from the disclosure section fails', () => {
  const { dir, inputs } = fixture();
  try {
    const noticesText = inputs.noticesText.replace('- `sitemap/vendor/lib.js` from lib 1.0.0.', '');
    const problems = coverageProblems({ ...inputs, noticesText });
    assert.ok(problems.some((p) => p.includes(`is not named under '${NOTICES_SECTION}'`)), JSON.stringify(problems));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A disclosure named only in the document's "gaps" prose is not a disclosure. This is the
// assertion that makes the section slice load-bearing rather than decorative.
test('a mention outside the disclosure section does not satisfy the disclosure', () => {
  const { dir, inputs } = fixture();
  try {
    const noticesText = inputs.noticesText
      .replace('- `sitemap/vendor/lib.js` from lib 1.0.0.', '')
      + '\n## 5. Gaps\n\n- `sitemap/vendor/lib.js` is undisclosed.\n';
    assert.ok(coverageProblems({ ...inputs, noticesText }).some((p) => p.includes('sitemap/vendor/lib.js')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a longer path does not satisfy a shorter one', () => {
  const section = '\n\n- `sitemap/vendor/lib.js.map` is the sourcemap.\n';
  assert.equal(namesPath(section, 'sitemap/vendor/lib.js'), false);
  assert.equal(namesPath(section, 'sitemap/vendor/lib.js.map'), true);
});

// ── fail-closed ──────────────────────────────────────────────────────────────────────────────────

test('an absent vendored directory is not an empty one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-roster-absent-'));
  try {
    const problems = coverageProblems({ root: dir, roster: [], noticesText: null });
    assert.ok(
      problems.some((p) => p.includes('sitemap/vendor could not be enumerated (ENOENT)')),
      `a declared directory that is absent must fail even with an empty roster; got ${JSON.stringify(problems)}`,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unreadable vendored directory is not an empty one', (t) => {
  if (ignoresPermissions()) return t.skip('﹣ running elevated, so a read deny does not hold');
  const { dir, vendor, inputs } = fixture();
  try {
    writeFileSync(join(vendor, 'unlisted.js'), 'x\n');
    const r = withUnreadable(vendor, () => coverageProblems(inputs));
    if (!r.ran) return t.skip(`﹣ ${r.why}`);
    // Either outcome is a failure; what must never happen is an empty problem list.
    assert.notDeepEqual(r.value, [], 'a refused directory read must not report "covered"');
    assert.ok(
      r.value.some((p) => isRefusal(p.match(/\(([A-Z]+)\)/)?.[1]) || p.includes('unlisted.js')),
      `expected a refusal or the hidden blob; got ${JSON.stringify(r.value)}`,
    );
  } finally {
    // withUnreadable restores 0o644, which is right for a file and leaves a DIRECTORY
    // non-traversable — the cleanup then dies ENOTEMPTY and the test fails after passing.
    try { chmodSync(vendor, 0o755); } catch { /* Windows, or already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the env seam ────────────────────────────────────────────────────────────────────────────────

test('CW_VENDOR_ROSTER set after this module was imported is still honoured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-roster-env-'));
  const before = process.env.CW_VENDOR_ROSTER;
  try {
    const p = join(dir, 'roster.json');
    writeFileSync(p, JSON.stringify([{ path: 'sitemap/vendor/only.js', pkg: 'x', version: '1', entry: 'package/only.js' }]));
    process.env.CW_VENDOR_ROSTER = p;
    assert.deepEqual(loadRoster().map((i) => i.path), ['sitemap/vendor/only.js']);
  } finally {
    if (before === undefined) delete process.env.CW_VENDOR_ROSTER; else process.env.CW_VENDOR_ROSTER = before;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the declared vendored directories are a superset of the ones the ROSTER implies', () => {
  const roster = [{ path: 'admin/vendor/a.js' }, { path: 'sitemap/vendor/b.js' }];
  assert.deepEqual(vendorDirs(roster), ['admin/vendor', 'sitemap/vendor']);
  assert.deepEqual(vendorDirs([]), DECLARED_VENDOR_DIRS);
});

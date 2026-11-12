// The npm tarball carries every wire-layer file and the licence texts its licence statements cite.
//
// npm pack reads the WORKING TREE, so this packs a git archive of HEAD (CW_NPM_PACK_REF overrides)
// rather than the checkout.
// npm's automatic inclusion takes LICENSE but not a suffixed name such as LICENSE-APACHE-2.0, so
// the licence texts and mcp/ are asserted by name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- win32-only so npm.cmd resolves; argv is constant
const npm = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
const tracked = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const skip = npm.status !== 0 ? 'npm is not on PATH' : tracked.status !== 0 ? 'not a git checkout' : false;

function packedFiles(t, plant = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-npm-pack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ref = process.env.CW_NPM_PACK_REF || 'HEAD';
  assert.match(ref, /^[\w./^~-]+$/, `CW_NPM_PACK_REF is not a plain ref: ${JSON.stringify(ref)}`);
  const archive = spawnSync('sh', ['-c', `git -C "${REPO}" archive "${ref}" | tar -x -C "${dir}"`], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  plant(dir);
  // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- win32-only so npm.cmd resolves; argv is constant
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, files: new Set(JSON.parse(r.stdout)[0].files.map((f) => f.path)) };
}

test('the tarball carries every wire-layer path and the licence texts', { skip }, (t) => {
  const { dir, files } = packedFiles(t);
  const wire = JSON.parse(readFileSync(join(dir, 'manifests', 'wire-layer.json'), 'utf8'));
  const missing = [];
  for (const e of wire.entries) {
    if (e.kind === 'directory') {
      if (![...files].some((f) => f.startsWith(e.path))) missing.push(e.path);
      if (e.marker && !files.has(e.marker)) missing.push(e.marker);
    } else if (!files.has(e.path)) missing.push(e.path);
  }
  for (const p of ['LICENSE', wire.licenseText, 'LICENSING.md', 'mcp/server.mjs']) if (!files.has(p)) missing.push(p);
  assert.deepEqual(missing, [], `npm pack leaves out: ${missing.join(', ')}`);
});

test('every repository-relative link in LICENSING.md that the tarball needs resolves inside it', { skip }, (t) => {
  const { dir, files } = packedFiles(t);
  const links = [...readFileSync(join(dir, 'LICENSING.md'), 'utf8').matchAll(/\]\(((?!https?:|#|mailto:)[^)#\s]+)\)/g)].map((m) => m[1]);
  // docs/stack/ is the four-part distribution's draft, parked in this repository; it is not shipped.
  const needed = links.filter((l) => !l.startsWith('docs/stack/') && existsSync(join(dir, l)));
  const missing = needed.filter((l) => !files.has(l));
  assert.deepEqual(missing, [], `LICENSING.md links outside the tarball: ${missing.join(', ')}`);
});

// One path per .gitignore rule that covers a listed directory: the rule's own path when it is
// anchored, one per listed directory when it is not, and a file inside it when it names a directory.
function ignoredUnderListed(gitignore, files) {
  const dirs = files.filter((f) => !f.startsWith('!') && f.endsWith('/')).map((f) => f.slice(0, -1));
  const listed = (p) => dirs.some((d) => p.startsWith(`${d}/`));
  const out = [];
  for (const line of gitignore.split('\n').map((l) => l.trim())) {
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const p = line.replace(/^\//, '').replace(/\/$/, '').replace(/\*+/g, 'planted');
    const asDir = line.endsWith('/') || !p.split('/').pop().includes('.');
    for (const f of (line.startsWith('/') || p.includes('/')) ? [p] : dirs.map((d) => `${d}/${p}`)) {
      const path = asDir ? `${f}/planted.json` : f;
      if (listed(path)) out.push({ rule: line, path });
    }
  }
  return out;
}

// With a files list npm does not read the root .gitignore, so a gitignored file inside a listed
// directory ships whenever it is on disk. Each rule needs a negation in files.
test('a gitignored file inside a listed directory stays out of the tarball', { skip }, (t) => {
  let planted = [];
  const { files } = packedFiles(t, (dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    planted = ignoredUnderListed(readFileSync(join(dir, '.gitignore'), 'utf8'), pkg.files)
      .filter((x) => !existsSync(join(dir, x.path)));
    for (const { path } of planted) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), '{"planted":true}\n');
    }
  });
  assert.ok(planted.length > 0, 'no .gitignore rule covers a listed directory, so nothing was planted and nothing was checked');
  const shipped = planted.filter((x) => files.has(x.path)).map((x) => `${x.path} (rule ${x.rule})`);
  assert.deepEqual(shipped, [], `gitignored paths npm pack would ship; add a negation to package.json files:\n  ${shipped.join('\n  ')}`);
  assert.ok(files.has('monitor/security-annotations.json'), 'the shared security-annotations defaults are tracked and must ship');
});

// Every module a shipped entry imports, transitively, read from the packed tree: static imports and
// re-exports, and dynamic import() of a literal relative specifier.
function importClosure(dir, entry) {
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    let src;
    try { src = readFileSync(join(dir, rel), 'utf8'); } catch { return; }   // absent: reported as missing below
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'(\.{1,2}\/[^']+)'|\bimport\(\s*'(\.{1,2}\/[^']+)'\s*\)/gm)) {
      walk(join(dirname(rel), m[1] || m[2]).split('\\').join('/'));
    }
  };
  walk(entry);
  return seen;
}

// admin/routes/dfd.mjs reaches into flow/ (the dfd command's parser and the flow store); every module
// it imports, transitively, must ship, and flow/'s tests must not.
test('the panel\'s dfd route ships with every module it imports, and flow/ ships without its tests', { skip }, (t) => {
  // arrange
  const { dir, files } = packedFiles(t);

  // act
  const seen = importClosure(dir, 'admin/routes/dfd.mjs');
  const missing = [...seen].filter((p) => !files.has(p));

  // assert
  assert.ok(seen.has('flow/dfd-cli.mjs') && seen.has('flow/store.mjs'), [...seen].join(' '));
  assert.deepEqual(missing, [], `the dfd route imports modules npm pack leaves out: ${missing.join(', ')}`);
  assert.deepEqual([...files].filter((f) => f.startsWith('flow/test/')), []);
});

// `commitwork dfd` is flow/dfd-cli.mjs: the static pass, both adapters, the CodeQL reader and the
// renderer must all be in the tarball for an installed commitwork to draw a scanned repository.
test('`commitwork dfd` ships with every module it imports', { skip }, (t) => {
  // arrange
  const { dir, files } = packedFiles(t);

  // act
  const seen = importClosure(dir, 'flow/dfd-cli.mjs');
  const missing = [...seen].filter((p) => !files.has(p));

  // assert
  for (const m of ['flow/static.mjs', 'flow/triggers.mjs', 'flow/verify.mjs', 'flow/lexer.mjs', 'flow/dfd-adapter.mjs', 'cra/dataflow-evidence.mjs', 'monitor/sarif-read.mjs', 'lib/dfd-render.mjs']) {
    assert.ok(seen.has(m), `${m} is not in the closure the walk found: ${[...seen].join(' ')}`);
  }
  assert.ok(files.has('schema/dfd.schema.json'), 'validateDfd reads schema/dfd.schema.json at call time');
  assert.ok(files.has('bin/commitwork.mjs'));
  assert.match(readFileSync(join(dir, 'bin/commitwork.mjs'), 'utf8'), /^import \{ main as runDfd \} from '\.\.\/flow\/dfd-cli\.mjs';/m);
  assert.deepEqual(missing, [], `\`commitwork dfd\` imports modules npm pack leaves out: ${missing.join(', ')}`);
});

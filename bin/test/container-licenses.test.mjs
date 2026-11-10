// node --test bin/test/container-licenses.test.mjs
//
// The images' licence directory. container/licenses.json against the tree it describes: each vendored
// text matches its pin and is pinned at the version the images install, each copyleft component names
// a source, and both Dockerfiles run the assembler. container/licenses.mjs against a fixture root:
// a component without a licence text, a copyleft one without a source, or an unnamed binary each
// leave the build failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, lstatSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, family, familyOf, debianLicences, parseMetadata, sourcesNotice, COPYLEFT, SITE_PACKAGES } from '../../container/licenses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(resolve(ROOT, ...p), 'utf8');
const manifest = () => JSON.parse(read('container', 'licenses.json'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const walk = (d) => readdirSync(d).flatMap((n) => (lstatSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const vendored = (m) => [...m.components.flatMap((c) => c.files), ...Object.values(m.python.files).flatMap((p) => p.files)].filter((f) => f.tree);
const component = (m, name) => m.components.find((c) => c.name === name);
// Dockerfile instructions as { op, args }: comments dropped, continuations joined.
const instructions = (text) => text.replace(/\\\n(\s*#.*\n)*/g, ' ').split('\n').filter((l) => /^[A-Z]+\s/.test(l)).map((l) => ({ op: l.split(/\s/)[0], args: l.slice(l.indexOf(' ') + 1) }));
const lockVersion = (name) => new RegExp(`^${name}==(\\S+)`, 'mi').exec(read('container', 'requirements.txt'))?.[1];

test('every vendored licence text matches its pin, and every file under container/licenses/ is pinned', () => {
  const m = manifest();
  for (const f of vendored(m)) assert.equal(sha256(readFileSync(resolve(ROOT, f.tree))), f.sha256, f.tree);
  const pinned = new Set(vendored(m).map((f) => f.tree));
  for (const p of walk(resolve(ROOT, 'container', 'licenses'))) assert.ok(pinned.has(relative(ROOT, p).split('\\').join('/')), `${relative(ROOT, p)} is not pinned in container/licenses.json`);
});

test('each vendored text was taken at the tag or commit of the version the images install', () => {
  const m = manifest();
  for (const c of m.components) {
    for (const f of c.files.filter((x) => x.tree)) assert.ok(f.upstream.includes(`/v${c.version}/`) || f.upstream.includes(`/${c.version}/`) || /\/[0-9a-f]{40}\//.test(f.upstream), `${c.name}: ${f.upstream} is not at ${c.version}`);
  }
  for (const [name, p] of Object.entries(m.python.files)) {
    assert.equal(p.version, lockVersion(name), `${name}: pinned for ${p.version}, the lock installs ${lockVersion(name)}`);
    for (const f of p.files) assert.ok(f.upstream.includes(`/v${p.version}/`) || f.upstream.includes(`/${p.version}/`), `${name}: ${f.upstream}`);
  }
  for (const [name, s] of Object.entries(m.python.sources)) assert.equal(s.version, lockVersion(name), `${name}: source pinned for ${s.version}`);
});

test('the manifest names the versions the Dockerfiles and the catalogue pin', () => {
  const m = manifest();
  const df = read('container', 'Dockerfile'), runner = read('container', 'runner', 'Dockerfile');
  assert.equal(component(m, 'node').version, /^FROM node:(\d+\.\d+\.\d+)-/m.exec(df)[1]);
  assert.equal(component(m, 'cosign').version, /cosign\/cosign:v(\S+)@sha256/.exec(df)[1]);
  assert.equal(component(m, 'actions-runner').version, /^ARG RUNNER_VERSION=(\S+)$/m.exec(runner)[1]);
  const tools = JSON.parse(read('manifests', 'install-catalog.json')).tools;
  const scanners = /^ARG SCANNERS=(\S+)$/m.exec(df)[1].split(',').filter((n) => n !== 'none');
  for (const n of scanners) {
    const c = component(m, n);
    assert.ok(c, `${n} is a default scanner and container/licenses.json does not name it`);
    assert.equal(`v${c.version}`, tools[n].release.tag, n);
    assert.ok(c.files.some((f) => f.archive), `${n}: its licence should come from the release archive setup verifies`);
  }
});

test('every component names a licence and a file, and every copyleft one names a source', () => {
  for (const c of manifest().components) {
    assert.ok(c.licence && c.present && c.files.length, c.name);
    if (c.versionIn) assert.ok(c.version.split('.').every((part) => c.versionIn.text.includes(part)), `${c.name}: versionIn does not name ${c.version}`);
    if (COPYLEFT.has(family([c.licence]))) assert.ok(c.source?.length, `${c.name} is ${c.licence} and names no source`);
  }
});

/** Rule ids a Dockerfile breaks: it must build the licence directory last, after all its content. */
function licenceStep(text, image) {
  const ops = instructions(text);
  const at = ops.findIndex((i) => i.op === 'RUN' && new RegExp(`container/licenses\\.mjs --image ${image}( |$)`).test(i.args));
  if (at < 0) return ['no-licence-step'];
  return ops.slice(at + 1).some((i) => ['RUN', 'COPY', 'ADD'].includes(i.op)) ? ['content-after-licence-step'] : [];
}

test('both Dockerfiles build the licence directory last, and setup is told where release licences go', () => {
  for (const [file, image] of [[['container', 'Dockerfile'], 'commitwork'], [['container', 'runner', 'Dockerfile'], 'commitwork-runner']]) {
    const text = read(...file);
    assert.deepEqual(licenceStep(text, image), [], file.join('/'));
    assert.deepEqual(licenceStep(text.replace(/^RUN (.*\\\n)*.*container\/licenses\.mjs.*$/m, ''), image), ['no-licence-step'], `${file.join('/')}: the rule reads the step`);
    assert.deepEqual(licenceStep(text.replace(/^ENTRYPOINT /m, 'COPY late /late\nENTRYPOINT '), image), ['content-after-licence-step']);
  }
  const install = instructions(read('container', 'Dockerfile')).find((i) => /bin\/install\.sh/.test(i.args));
  assert.match(install.args, /CW_SETUP_LICENSE_DIR=\/usr\/share\/licenses\/commitwork\b/);
});

test('licence families: OR is a choice, AND and separate stanzas accumulate', () => {
  assert.equal(familyOf('GPL-2+'), 'copyleft');
  assert.equal(familyOf('LGPL-2.1+'), 'weak-copyleft');
  assert.equal(familyOf('GNU Lesser General Public License v2 or later (LGPLv2+)'), 'weak-copyleft');
  assert.equal(familyOf('MPL-2.0'), 'weak-copyleft');
  assert.equal(familyOf('Expat'), 'permissive');
  assert.equal(familyOf('ad-hoc'), 'unknown');
  assert.equal(family(['BSD-3-clause or GPL-2']), 'permissive');
  assert.equal(family(['Apache-2.0 OR BSD-3-Clause']), 'permissive');
  assert.equal(family(['AGPL-3.0-or-later AND Apache-2.0']), 'copyleft');
  assert.equal(family(['Expat', 'GPL-2+']), 'copyleft');
  assert.equal(family([]), 'unknown');
});

test('a Debian copyright file is read by its License fields, or by what a free-form one names', () => {
  const dep5 = 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n\nFiles: *\nLicense: GPL-2+\n\nFiles: debian/*\nLicense: BSD-3-clause or GPL-2\n text\n';
  assert.deepEqual(debianLicences(dep5), { form: 'dep5', ids: ['BSD-3-clause or GPL-2', 'GPL-2+'] });
  assert.deepEqual(debianLicences('This package is under the GNU General Public License, see /usr/share/common-licenses/GPL-2.\n').ids, ['GPL (free-form)']);
  assert.ok(debianLicences('GCC RUNTIME LIBRARY EXCEPTION\nVersion 3.1\n').ids.includes('GPL-3+ WITH GCC-exception-3.1 (free-form)'));
});

test('a METADATA License field that runs over several lines is text, not a licence name', () => {
  const m = parseMetadata('Metadata-Version: 2.1\nName: x\nVersion: 1\nLicense: Copyright (c) 2010 Someone\n        Permission is hereby granted\nClassifier: License :: OSI Approved :: MIT License\n\nbody\n');
  assert.deepEqual([m.name, m.version, m.license, m.classifiers], ['x', '1', '', ['MIT License']]);
  assert.equal(parseMetadata('Name: y\nVersion: 2\nLicense-Expression: MIT\n').expression, 'MIT');
});

test('the written offer names the bundle by the index digest, and a placeholder until a location is given', () => {
  const sha = 'ab'.repeat(32);
  const unset = sourcesNotice({ image: 'commitwork-runner', indexSha: sha, sourcesAt: '' });
  assert.match(unset, /`commitwork-sources-abababababab\.tar`/);
  assert.match(unset, /Published at: <SOURCE-BUNDLE-LOCATION>, a placeholder\. .*not ready to distribute/s);
  assert.match(sourcesNotice({ image: 'x', indexSha: sha, sourcesAt: 'https://example.test/sources/' }), /^Published at: https:\/\/example\.test\/sources\/$/m);
});

function fixture(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-licenses-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const root = join(d, 'root'), tree = join(d, 'tree'), out = join(d, 'out');
  const put = (base, p, body) => { mkdirSync(dirname(join(base, p)), { recursive: true }); writeFileSync(join(base, p), body); };
  put(root, '/usr/share/doc/libfoo1/copyright', 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n\nFiles: *\nLicense: GPL-2+\n');
  put(root, '/usr/share/common-licenses/GPL-2', 'GPL text');
  put(root, `${SITE_PACKAGES}/bar-1.0.dist-info/METADATA`, 'Name: bar\nVersion: 1.0\nLicense-Expression: MIT\n');
  put(root, `${SITE_PACKAGES}/bar-1.0.dist-info/licenses/LICENSE`, 'MIT text');
  put(root, `${SITE_PACKAGES}/gpl_thing-2.0.dist-info/METADATA`, 'Name: gpl_thing\nVersion: 2.0\nClassifier: License :: OSI Approved :: GNU General Public License v2 or later (GPLv2+)\n');
  put(root, `${SITE_PACKAGES}/gpl_thing-2.0.dist-info/COPYING`, 'GPL text');
  put(root, '/usr/local/bin/tool', 'bin');
  put(root, '/opt/tool-data/README', 'x');
  put(tree, 'container/licenses/tool/LICENSE', 'Apache text');
  const m = { components: [{ name: 'tool', version: '1', licence: 'Apache-2.0', present: '/usr/local/bin/tool', covers: ['/opt/tool-data'], files: [{ tree: 'container/licenses/tool/LICENSE', sha256: sha256('Apache text') }] }], python: { files: {}, licences: {}, sources: {} } };
  const dpkg = 'ii \tlibfoo1\t1.0-1\tfoo\t1.0-1\tarm64\nrc \tgone\t0.1\tgone\t0.1\tarm64\n';
  const run = (over = {}) => assemble({ root, manifest: m, tree, out, image: 'fixture', dpkg, ...over });
  return { root, tree, out, m, run, put };
}

test('a complete image gives no missing entries, and every component its files and source', (t) => {
  const { out, run } = fixture(t);
  const { index, missing } = run();
  assert.deepEqual(missing, []);
  assert.deepEqual(index.components.map((c) => `${c.kind}:${c.name}:${c.family}:${c.files.join('+')}`), [
    'component:tool:permissive:tool/LICENSE', 'debian:libfoo1:copyleft:debian/libfoo1/copyright',
    'python:bar:permissive:python/bar/licenses/LICENSE', 'python:gpl-thing:copyleft:python/gpl-thing/COPYING',
  ]);
  assert.deepEqual(index.components.find((c) => c.name === 'libfoo1').source, [{ debian: 'foo', version: '1.0-1' }]);
  assert.deepEqual(index.components.find((c) => c.name === 'gpl-thing').source, [{ pypi: 'gpl-thing', version: '2.0' }]);
  for (const p of ['tool/LICENSE', 'debian/libfoo1/copyright', 'common-licenses/GPL-2', 'python/bar/licenses/LICENSE']) assert.ok(existsSync(join(out, p)), p);
});

test('a component whose licence text is absent fails, by name', (t) => {
  const { root, m, run } = fixture(t);
  rmSync(join(root, `${SITE_PACKAGES}/bar-1.0.dist-info/licenses`), { recursive: true });
  rmSync(join(root, '/usr/share/doc/libfoo1/copyright'));
  m.components[0].files[0].sha256 = '0'.repeat(64);
  const { missing } = run();
  assert.equal(missing.length, 3, missing.join('\n'));
  assert.match(missing.join('\n'), /^tool: container\/licenses\/tool\/LICENSE is not the pinned sha256/m);
  assert.match(missing.join('\n'), /^debian libfoo1: \/usr\/share\/doc\/libfoo1\/copyright is not in the image$/m);
  assert.match(missing.join('\n'), /^python bar: no licence file in bar-1\.0\.dist-info and none pinned/m);
});

test('a pinned licence text for another version of a package is refused', (t) => {
  const { root, m, tree, put, run } = fixture(t);
  rmSync(join(root, `${SITE_PACKAGES}/bar-1.0.dist-info/licenses`), { recursive: true });
  put(tree, 'container/licenses/bar/LICENSE', 'MIT text');
  m.python.files.bar = { version: '0.9', files: [{ tree: 'container/licenses/bar/LICENSE', sha256: sha256('MIT text') }] };
  assert.deepEqual(run().missing, ['python bar: licence text pinned for 0.9, 1.0 is installed']);
  m.python.files.bar.version = '1.0';
  assert.deepEqual(run().missing, []);
});

test('a copyleft component without a source fails, and a source override replaces the sdist', (t) => {
  const { m, run } = fixture(t);
  m.components[0].licence = 'AGPL-3.0-only';
  assert.deepEqual(run().missing, ['tool: AGPL-3.0-only is copyleft and no source is named for it']);
  m.components[0].source = [{ github: 'o/tool', tag: 'v1' }];
  m.python.sources['gpl-thing'] = { version: '2.0', replace: [{ github: 'o/gpl-thing', tag: '2.0' }] };
  const { index, missing } = run();
  assert.deepEqual(missing, []);
  assert.deepEqual(index.components.find((c) => c.name === 'gpl-thing').source, [{ github: 'o/gpl-thing', tag: '2.0' }]);
});

test('a component whose image holds another version than the manifest names fails', (t) => {
  const { root, m, put, run } = fixture(t);
  put(root, '/opt/tool-data/VERSION', 'tool 2');
  m.components[0].versionIn = { path: '/opt/tool-data/VERSION', text: 'tool 1' };
  assert.deepEqual(run().missing, ['tool: /opt/tool-data/VERSION does not show 1; container/licenses.json is stale']);
  m.components[0].versionIn.text = 'tool 2';
  assert.deepEqual(run().missing, []);
});

test('a binary or /opt directory no component names fails, and a symlink does not', (t) => {
  const { root, put, run } = fixture(t);
  put(root, '/usr/local/bin/stowaway', 'bin');
  put(root, '/opt/mystery/x', 'x');
  symlinkSync('tool', join(root, '/usr/local/bin/linked'));
  assert.deepEqual(run().missing, ['/opt/mystery: no component in container/licenses.json names it', '/usr/local/bin/stowaway: no component in container/licenses.json names it']);
});

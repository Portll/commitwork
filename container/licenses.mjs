#!/usr/bin/env node
// The image's licence directory: every component's licence texts under one root, and INDEX.json
// naming each component, its licence, the files that carry it and where its source comes from.
// Runs inside the image at build time. Exit 1 names each component left without a licence text and
// each copyleft component left without a source, and writes no INDEX.json.
//
// usage: node container/licenses.mjs --image <name> [--out <dir>] [--tree <commitwork tree>]
//        [--sources-at <where the source bundle is published>]
// env, read at call time: CW_LICENSE_ROOT (the filesystem root the image paths are read under),
//        CW_LICENSE_DPKG (a file of dpkg-query output to read instead of running dpkg-query)

import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = '/usr/share/licenses/commitwork';
const VENV = '/opt/scanners';
export const SITE_PACKAGES = `${VENV}/lib/python3.11/site-packages`;
// Only these trees hold software no package manager records; everything in them must be named.
const UNMANAGED = ['/opt', '/usr/local/bin'];
const LICENCE_FILE = /^(LICEN[CS]E|COPYING|NOTICE|AUTHORS|COPYRIGHT|PATENTS)([._-].*)?$/i;
export const DPKG_FORMAT = '${db:Status-Abbrev}\t${Package}\t${Version}\t${source:Package}\t${source:Version}\t${Architecture}\n';

const WEAK = [/(^|[^A-Za-z])(LGPL|MPL|EPL|CDDL|EUPL|GFDL|CPL|OSL)/, /Lesser General Public|Library General Public|Mozilla Public|Eclipse Public|Free Documentation|Share-?Alike|CC-BY-SA/i];
const STRONG = [/(^|[^A-Za-z])A?GPL/, /General Public License|Affero/i];
const PERMISSIVE = /MIT|Expat|X11|BSD|ISC|Apache|Zlib|PSF|Python|public[ -]?domain|CC0|Unlicense|BSL|Boost|Artistic|OpenSSL|SSLeay|curl|Unicode|PostgreSQL|NTP|HPND|FSFAP|FSFUL|ermissive|bzip2|libpng|ICU|Info-ZIP|Sleepycat|WTFPL|Beerware/i;
const RANK = { permissive: 0, unknown: 1, 'weak-copyleft': 2, copyleft: 3 };
export const COPYLEFT = new Set(['copyleft', 'weak-copyleft']);

/** The family of one licence name: copyleft, weak-copyleft, permissive or unknown. */
export function familyOf(id) {
  const s = String(id);
  if (WEAK.some((re) => re.test(s))) return 'weak-copyleft';
  if (STRONG.some((re) => re.test(s))) return 'copyleft';
  return PERMISSIVE.test(s) ? 'permissive' : 'unknown';
}
const most = (fs) => fs.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'permissive');
const least = (fs) => fs.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), 'copyleft');

/** Family of licence expressions: OR offers a choice, so the least demanding; AND or several lines, the most. */
export function family(expressions) {
  const lines = expressions.filter(Boolean);
  if (!lines.length) return 'unknown';
  const known = lines.map((l) => least(String(l).split(/\s+or\s+/i).map((alt) => most(alt.split(/\s+and\s+|,\s*/i).map(familyOf)))));
  const classified = known.filter((f) => f !== 'unknown');
  return classified.length ? most(classified) : 'unknown';
}

/** Licence names a Debian copyright file states: its License: fields, or what a free-form file names. */
export function debianLicences(text) {
  const t = String(text);
  if (/^Format:\s*\S*(copyright-format|dep5)/im.test(t)) {
    return { form: 'dep5', ids: [...new Set([...t.matchAll(/^License:[ \t]*(\S.*?)\s*$/gm)].map((m) => m[1]))].sort() };
  }
  const found = [
    [/GCC Runtime Library Exception/i, 'GPL-3+ WITH GCC-exception-3.1'], [/GNU Affero/i, 'AGPL'], [/GNU (Lesser|Library) General Public|\bLGPL/i, 'LGPL'], [/GNU General Public License|\bGPL\b/, 'GPL'],
    [/Mozilla Public License/i, 'MPL'], [/Apache License/i, 'Apache'], [/Artistic License/i, 'Artistic'],
    [/Redistribution and use in source and binary forms|\bBSD\b/, 'BSD'], [/Permission is hereby granted, free of charge/i, 'MIT'],
    [/public domain/i, 'public-domain'],
  ].filter(([re]) => re.test(t)).map(([, id]) => `${id} (free-form)`);
  return { form: 'free', ids: found };
}

/** The header fields of a Python METADATA file that name a licence. */
export function parseMetadata(text) {
  const fields = [];
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n\n')[0].split('\n')) {
    if (/^\s/.test(line) && fields.length) fields.at(-1).multi = true;
    else if (line.includes(':')) fields.push({ k: line.slice(0, line.indexOf(':')).toLowerCase(), v: line.slice(line.indexOf(':') + 1).trim() });
  }
  const field = (k) => fields.filter((f) => f.k === k.toLowerCase()).map((f) => f.v);
  // A License field that runs over several lines is the licence text, not its name.
  const lic = fields.find((f) => f.k === 'license');
  const license = lic && !lic.multi ? lic.v : '';
  return {
    name: field('Name')[0], version: field('Version')[0], expression: field('License-Expression')[0] || '',
    license: license && license !== 'UNKNOWN' && license.length <= 80 ? license : '',
    classifiers: field('Classifier').filter((c) => c.startsWith('License ::')).map((c) => c.split(' :: ').pop()),
  };
}
export const pep503 = (n) => String(n).toLowerCase().replace(/[-_.]+/g, '-');

function walk(dir, base = dir) {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    return lstatSync(p).isDirectory() ? walk(p, base) : [relative(base, p)];
  });
}
/** Files in a dist-info directory that carry a licence or notice. */
export const distInfoLicenceFiles = (dir) => walk(dir).filter((r) => /^(licenses|license_files)\//.test(r) || LICENCE_FILE.test(basename(r)));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Build the directory under `out`. Returns { index, missing }; copies files as it goes. */
export function assemble({ root = '/', manifest, tree, out, image, dpkg }) {
  const at = (p) => join(root, p);
  const missing = [], components = [], short = new Set();
  const miss = (who, why) => { short.add(who); missing.push(`${who}: ${why}`); };
  const put = (from, rel) => { mkdirSync(dirname(join(out, rel)), { recursive: true }); copyFileSync(from, join(out, rel)); return rel; };
  const vendored = (f, rel) => {
    const buf = readFileSync(join(tree, f.tree));
    if (sha256(buf) !== f.sha256) throw new Error(`${f.tree} is not the pinned sha256 ${f.sha256}`);
    return put(join(tree, f.tree), rel);
  };
  const accounted = new Set([VENV]);

  for (const c of manifest.components) {
    if (!existsSync(at(c.present))) continue;
    accounted.add(c.present);
    for (const p of c.covers || []) accounted.add(p);
    // A version bump upstream of the pin leaves the manifest naming a version the image no longer holds.
    const v = c.versionIn;
    if (v && !(existsSync(at(v.path)) && readFileSync(at(v.path), 'utf8').includes(v.text))) miss(c.name, `${v.path} does not show ${c.version}; container/licenses.json is stale`);
    const files = [];
    for (const f of c.files) {
      const rel = `${c.name}/${f.as || basename(f.tree || f.path || f.archive)}`;
      try {
        if (f.archive) { if (existsSync(join(out, rel))) files.push(rel); else miss(c.name, `${f.archive} was not taken from its release archive`); }
        else if (f.tree) files.push(vendored(f, rel));
        else if (existsSync(at(f.path))) files.push(put(at(f.path), rel));
        else miss(c.name, `${f.path} is not in the image`);
      } catch (e) { miss(c.name, `${e.message}`); }
    }
    components.push({ kind: 'component', name: c.name, version: c.version, licence: c.licence, family: family([c.licence]), files, source: c.source || [], ...(c.note ? { note: c.note } : {}) });
  }

  for (const line of String(dpkg).split('\n').filter(Boolean)) {
    const [status, name, version, srcName, srcVersion, arch] = line.split('\t');
    if (!status.startsWith('i')) continue;
    const file = at(`/usr/share/doc/${name}/copyright`);
    if (!existsSync(file)) { miss(`debian ${name}`, `/usr/share/doc/${name}/copyright is not in the image`); continue; }
    const { form, ids } = debianLicences(readFileSync(file, 'utf8'));
    components.push({ kind: 'debian', name, version, arch, licence: ids.join(', ') || 'unstated', family: family(ids), form, files: [put(file, `debian/${name}/copyright`)], source: [{ debian: srcName || name, version: srcVersion || version }] });
  }
  if (existsSync(at('/usr/share/common-licenses'))) for (const n of readdirSync(at('/usr/share/common-licenses')).sort()) put(at(`/usr/share/common-licenses/${n}`), `common-licenses/${n}`);

  const py = manifest.python || {};
  const site = at(SITE_PACKAGES);
  for (const d of existsSync(site) ? readdirSync(site).filter((n) => n.endsWith('.dist-info')).sort() : []) {
    const meta = parseMetadata(readFileSync(join(site, d, 'METADATA'), 'utf8'));
    const name = pep503(meta.name), version = meta.version;
    const ids = meta.expression ? [meta.expression] : meta.license ? [meta.license] : meta.classifiers.length ? meta.classifiers : py.licences?.[name] ? [py.licences[name]] : [];
    let files = distInfoLicenceFiles(join(site, d)).map((r) => put(join(site, d, r), `python/${name}/${r}`));
    const pinned = py.files?.[name];
    if (!files.length && pinned) {
      if (pinned.version !== version) miss(`python ${name}`, `licence text pinned for ${pinned.version}, ${version} is installed`);
      else files = pinned.files.map((f) => { try { return vendored(f, `python/${name}/${basename(f.tree)}`); } catch (e) { miss(`python ${name}`, `${e.message}`); return null; } }).filter(Boolean);
    }
    if (!files.length && !pinned) miss(`python ${name}`, `no licence file in ${d} and none pinned in container/licenses.json`);
    const fam = family(ids);
    const over = py.sources?.[name];
    let source = COPYLEFT.has(fam) ? [{ pypi: name, version }] : [];
    if (over && over.version !== version) miss(`python ${name}`, `source pinned for ${over.version}, ${version} is installed`);
    else if (over) source = over.replace || [...source, ...(over.add || [])];
    components.push({ kind: 'python', name, version, licence: ids.join(', ') || 'unstated', family: fam, files, source });
  }

  for (const dir of UNMANAGED) {
    if (!existsSync(at(dir))) continue;
    for (const n of readdirSync(at(dir)).sort()) {
      const p = `${dir}/${n}`;
      if (!accounted.has(p) && !lstatSync(at(p)).isSymbolicLink()) miss(p, 'no component in container/licenses.json names it');
    }
  }
  for (const c of components) {
    const who = c.kind === 'component' ? c.name : `${c.kind} ${c.name}`;
    if (!c.files.length && !short.has(who)) miss(who, 'no licence text');
    if (COPYLEFT.has(c.family) && !c.source.length) miss(who, `${c.licence} is copyleft and no source is named for it`);
  }
  const order = { component: 0, debian: 1, python: 2 };
  components.sort((a, b) => order[a.kind] - order[b.kind] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { index: { schema: 'commitwork-licenses/1', image, components }, missing };
}

/** The written offer, beside INDEX.json. */
export function sourcesNotice({ image, indexSha, sourcesAt }) {
  const bundle = `commitwork-sources-${indexSha.slice(0, 12)}.tar`;
  return `# Source code for this image

${image} holds components under the GNU GPL, LGPL and AGPL and the Mozilla Public License, whose
terms ask that their source code be available to whoever receives the image. INDEX.json, beside
this file, names every component, its licence, the files here that carry the licence, and its
source.

The source bundle for this image is \`${bundle}\`, with \`SOURCES.json\` beside it. It holds the
source of every component INDEX.json names a source for, each file with the URL it was fetched
from and its SHA-256. It belongs to the image whose INDEX.json has SHA-256
${indexSha}.

Published at: ${sourcesAt || '<SOURCE-BUNDLE-LOCATION>, a placeholder. This image was built without --build-arg SOURCES_AT=<location> and is not ready to distribute: rebuild it with the place the bundle will be published, then publish the bundle there, beside the image.'}

The bundle is offered from the same place as the image, for as long as the image is offered there.
`;
}

function parseArgs(argv) {
  const o = { out: DEFAULT_OUT, tree: resolve(HERE, '..'), image: '', sourcesAt: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--out') o.out = v; else if (k === '--tree') o.tree = v; else if (k === '--image') o.image = v;
    else if (k === '--sources-at') o.sourcesAt = v; else throw new Error(`unknown argument ${k}`);
    i++;
  }
  if (!o.image) throw new Error('--image is required');
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = process.env.CW_LICENSE_ROOT || '/';
  const dpkg = process.env.CW_LICENSE_DPKG ? readFileSync(process.env.CW_LICENSE_DPKG, 'utf8') : execFileSync('dpkg-query', ['-W', '-f', DPKG_FORMAT], { encoding: 'utf8' });
  const manifest = JSON.parse(readFileSync(join(o.tree, 'container', 'licenses.json'), 'utf8'));
  mkdirSync(o.out, { recursive: true });
  const { index, missing } = assemble({ root, manifest, tree: o.tree, out: o.out, image: o.image, dpkg });
  if (missing.length) {
    console.error(`licenses: ${missing.length} component(s) unaccounted for, so the image cannot carry its notices:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  const body = `${JSON.stringify(index, null, 1)}\n`;
  writeAtomic(join(o.out, 'INDEX.json'), body);
  writeAtomic(join(o.out, 'SOURCES.md'), sourcesNotice({ image: o.image, indexSha: sha256(body), sourcesAt: o.sourcesAt }));
  const fams = {};
  for (const c of index.components) fams[c.family] = (fams[c.family] || 0) + 1;
  console.log(`licenses: ${index.components.length} components in ${o.out} (${Object.entries(fams).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}

if (isMainModule(import.meta.url)) main();

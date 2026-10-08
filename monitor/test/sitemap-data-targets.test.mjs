// monitor/sitemap-data.mjs — fleet-wide target derivation: targets come from the registry's own
// resolver universe (resolveRepos), and every SKIP carries its reason — an empty manifest for an
// unresolved area is the false-clean "no code" shape. Unit tests inject fixtures directly; the
// end-to-end test runs the script in a subprocess with CW_SITEMAP_OUT at scratch.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTargets } from '../sitemap-data.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// minimal declared-areas registry; tests spread over it
const reg = (extra) => ({ reportsRoot: 'reports', roots: [], projects: [], ...extra });
const slugsOf = (r) => r.targets.map((t) => t.slug);

describe('buildTargets — explicit registry shapes (pre-widening behaviour preserved)', () => {
  test('fleet root + rider + second children-expander: area target plus libs-own target', () => {
    const r = buildTargets(reg({
      areas: [{ slug: 'fleet', members: ['svc-root', 'libs-root', 'buildout'] }],
      projects: [
        { name: 'svc-root', path: '/x/services', manifest: 'm', area: 'fleet', expand: 'children' },
        { name: 'libs-root', path: '/x/libs', manifest: 'm', area: 'fleet', expand: 'children' },
        { name: 'buildout', path: '/x/buildout', manifest: 'm', area: 'fleet' },
      ],
    }), []);
    assert.deepEqual(slugsOf(r), ['fleet', 'libs-root']);
    assert.equal(r.targets.find((t) => t.slug === 'libs-root').area, 'fleet'); // own manifest, same area scope
    assert.deepEqual(r.skips, []);
  });

  test('single explicit entry is its own target under its declared area', () => {
    const r = buildTargets(reg({
      areas: [{ slug: 'panel-admin', members: ['panel'] }],
      projects: [{ name: 'panel', path: '/x/panel', manifest: 'm', area: 'panel-admin' }],
    }), []);
    assert.deepEqual(slugsOf(r), ['panel-admin']);
    assert.deepEqual(r.skips, []);
  });
});

describe('buildTargets — newly admitted shapes (the widening)', () => {
  const discovered = (name, area) => ({ name, path: `/repos/${name}`, source: 'root:/repos', ...(area ? { area } : {}) });

  test('a root-discovered checkout in a declared members[] area becomes that area\'s target', () => {
    const r = buildTargets(reg({ areas: [{ slug: 'zip', members: ['zip'] }] }), [discovered('zip')]);
    assert.deepEqual(slugsOf(r), ['zip']);
    assert.deepEqual(r.skips, []);
  });

  test('multiple discovered checkouts in ONE area yield ONE target (no per-repo fragmentation)', () => {
    const r = buildTargets(
      reg({ areas: [{ slug: 'sub', members: ['sub-main', 'sub-code'] }] }),
      [discovered('sub-main'), discovered('sub-code')]);
    assert.deepEqual(slugsOf(r), ['sub']);
  });

  test('own-name fallback: a discovered repo claimed by no area is its own target', () => {
    const r = buildTargets(reg({ areas: [{ slug: 'other' }] }), [discovered('standalone')]);
    assert.ok(slugsOf(r).includes('standalone'));
  });

  test('explicit entry + discovered checkout in the same area stay ONE target', () => {
    const r = buildTargets(reg({
      areas: [{ slug: 'mix', members: ['anchor', 'extra'] }],
      projects: [{ name: 'anchor', path: '/x/anchor', manifest: 'm', area: 'mix' }],
    }), [
      { name: 'anchor', path: '/x/anchor', source: 'explicit', area: 'mix' }, // explicit resolves too — must not double-claim
      discovered('extra'),
    ]);
    assert.deepEqual(slugsOf(r), ['mix']);
  });

  test('targets are sorted by slug — deterministic regardless of registry/discovery order', () => {
    const r = buildTargets(reg({ areas: [{ slug: 'zz', members: ['zz'] }, { slug: 'aa', members: ['aa'] }] }),
      [discovered('zz'), discovered('aa')]);
    assert.deepEqual(slugsOf(r), ['aa', 'zz']);
  });
});

describe('buildTargets — every skip carries its reason (a reasonless skip is silence)', () => {
  test('a declared area nothing resolves into is a SKIP with areaRepos\' not-scanned reason, never a target', () => {
    const r = buildTargets(reg({ areas: [{ slug: 'ghost', members: ['ghost-repo'] }] }), []);
    assert.deepEqual(slugsOf(r), []);
    assert.equal(r.skips.length, 1);
    assert.equal(r.skips[0].slug, 'ghost');
    assert.match(r.skips[0].reason, /NO repo resolves into it/);
    assert.match(r.skips[0].reason, /not "clean"/); // explicit uncertainty survives the wording
  });

  test('an explicit entry with no usable area slug is a SKIP naming the fix', () => {
    const r = buildTargets(reg({ projects: [{ name: 'Bad_Name', path: '/x', manifest: 'm' }] }), []);
    assert.deepEqual(slugsOf(r), []);
    assert.equal(r.skips[0].slug, 'Bad_Name');
    assert.match(r.skips[0].reason, /no usable area slug/);
  });

  test('a discovered repo with an unusable name and no declaration is a SKIP naming its path', () => {
    const r = buildTargets(reg({}), [{ name: 'Weird_Dir', path: '/repos/Weird_Dir', source: 'root:/repos' }]);
    assert.deepEqual(slugsOf(r), []);
    assert.equal(r.skips[0].slug, 'Weird_Dir');
    assert.match(r.skips[0].reason, /\/repos\/Weird_Dir/);
    assert.match(r.skips[0].reason, /no usable area slug/);
  });
});

// ── end-to-end: the script in a subprocess on a fixture registry ────────────────────────────────
describe('sitemap-data.mjs run on a fixture fleet', () => {
  let tmp, out, run, regPath;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sitemap-data-'));
    out = path.join(tmp, 'out');
    // a discovered checkout: root-walked, and a REAL git repo so its own gitignore governs the walk
    const alpha = path.join(tmp, 'repos', 'alpha');
    fs.mkdirSync(alpha, { recursive: true });
    const git = spawnSync('git', ['-C', alpha, 'init', '-q'], { encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    fs.writeFileSync(path.join(alpha, 'index.mjs'), 'export const alpha = 1;\n');
    // the 2026-08-21 shape in miniature: a gitignored generated tree parked inside the checkout
    fs.writeFileSync(path.join(alpha, '.gitignore'), 'generated/\n');
    fs.mkdirSync(path.join(alpha, 'generated'), { recursive: true });
    fs.writeFileSync(path.join(alpha, 'generated', 'scan-output.mjs'), 'export const junk = 1;\n');
    // an explicit single-repo entry
    const expo = path.join(tmp, 'expo');
    fs.mkdirSync(expo, { recursive: true });
    fs.writeFileSync(path.join(expo, 'main.mjs'), 'export const expo = 1;\n');
    const registry = {
      reportsRoot: path.join(tmp, 'reports'), // absolute: isolates overlays from the live tree
      defaultManifest: 'security-baseline',
      roots: [{ path: path.join(tmp, 'repos'), maxDepth: 1 }],
      areas: [
        { slug: 'alpha', members: ['alpha'] },
        { slug: 'expo-admin', members: ['expo'] },
        { slug: 'ghostarea', members: ['ghost-not-checked-out'] },
      ],
      projects: [
        { name: 'expo', path: expo, manifest: 'security-baseline', area: 'expo-admin' },
        { name: 'lost', path: path.join(tmp, 'absent'), manifest: 'security-baseline', area: 'lost' },
      ],
    };
    regPath = path.join(tmp, 'projects.json');
    fs.writeFileSync(regPath, JSON.stringify(registry, null, 1));
    run = spawnSync(process.execPath, [path.join(ROOT, 'monitor', 'sitemap-data.mjs')], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, CW_REGISTRY: regPath, CW_SITEMAP_OUT: out },
    });
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const treeNames = (nodes, acc = []) => { for (const n of nodes) { acc.push(n.name); if (n.children) treeNames(n.children, acc); } return acc; };

  test('exits 0 and emits one manifest per resolved area, stamped with the area slug', () => {
    assert.equal(run.status, 0, run.stderr);
    const expo = JSON.parse(fs.readFileSync(path.join(out, 'expo-admin.sitemap.json'), 'utf8'));
    assert.equal(expo.project, 'expo-admin');
    assert.equal(expo.services.length, 1);
    const alpha = JSON.parse(fs.readFileSync(path.join(out, 'alpha.sitemap.json'), 'utf8'));
    assert.equal(alpha.project, 'alpha');
    assert.equal(alpha.services[0].path, '.'); // a standalone checkout presents as its own root
    assert.ok(alpha.provenance.files.scanned >= 1); // harvested, not an empty-but-clean shell
  });

  test('a declared area with no local checkout prints SKIP + reason and emits NO manifest', () => {
    assert.match(run.stderr, /SKIP ghostarea — .*NO repo resolves into it/);
    assert.equal(fs.existsSync(path.join(out, 'ghostarea.sitemap.json')), false);
  });

  test('an explicit entry whose path is missing prints the absence and emits NO manifest', () => {
    assert.match(run.stderr, /lost: declared path missing/);
    assert.equal(fs.existsSync(path.join(out, 'lost.sitemap.json')), false);
  });

  test('a gitignored tree never enters the walk — counted in provenance, printed, absent from the tree', () => {
    const alpha = JSON.parse(fs.readFileSync(path.join(out, 'alpha.sitemap.json'), 'utf8'));
    const names = treeNames(alpha.services[0].tree);
    assert.ok(!names.includes('generated'), `gitignored dir walked into the manifest: ${names.join(',')}`);
    assert.ok(!names.includes('scan-output.mjs'));
    assert.ok(names.includes('index.mjs')); // the product itself still harvests
    assert.ok(alpha.provenance.files.excluded >= 1, 'exclusion happened but was not counted'); // visible, not silent
    assert.match(run.stdout, /alpha -> .*1 gitignored entr\(ies\) excluded/);
  });

  test('a dir where git cannot answer prints the UNFILTERED fallback, never a silent unfiltered walk', () => {
    // expo is deliberately NOT a git repo
    assert.match(run.stderr, /expo: gitignore rules unavailable .*walking UNFILTERED/);
    assert.ok(fs.existsSync(path.join(out, 'expo-admin.sitemap.json'))); // still harvests — absence of rules ≠ absence of code
  });

  test('an oversize manifest is REFUSED with its reason and a non-zero exit, never written quietly', () => {
    const capped = spawnSync(process.execPath, [path.join(ROOT, 'monitor', 'sitemap-data.mjs'), 'alpha'], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, CW_REGISTRY: regPath, CW_SITEMAP_OUT: path.join(tmp, 'out-capped'), CW_SITEMAP_MAX_BYTES: '16' },
    });
    assert.notEqual(capped.status, 0);
    assert.match(capped.stderr, /alpha: manifest is \d+ bytes — exceeds the 16-byte cap .*REFUSED/);
    assert.equal(fs.existsSync(path.join(tmp, 'out-capped', 'alpha.sitemap.json')), false);
  });
});

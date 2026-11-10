// Merges per-subject SBOM documents into one envelope with prefixed artifact ids (monitor/update-vulns.mjs mergeSbom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSbom } from '../update-vulns.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mergeSbom-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

test('returns null doc and empty own map when no entries are provided', () => {
  const { dir, cleanup } = setup();
  try {
    const r = mergeSbom([], { installedSide: true });
    assert.deepEqual(r, { doc: null, own: new Map([]) });
  } finally { cleanup(); }
});

test('skips entries whose sbomPath file does not exist', () => {
  const { dir, cleanup } = setup();
  try {
    const r = mergeSbom([{ key: 'k1', sbomPath: join(dir, 'missing.json'), ownVersion: null, targetVersion: null }], { installedSide: true });
    assert.deepEqual(r, { doc: null, own: new Map([]) });
  } finally { cleanup(); }
});

test('skips entries whose sbomPath contains invalid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = mergeSbom([{ key: 'k1', sbomPath: p, ownVersion: null, targetVersion: null }], { installedSide: true });
    assert.deepEqual(r, { doc: null, own: new Map([]) });
  } finally { cleanup(); }
});

test('skips entries whose parsed document lacks an artifacts array', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'noart.json');
    writeFileSync(p, JSON.stringify({ source: { name: 's' }, artifacts: 'not-array' }));
    const r = mergeSbom([{ key: 'k1', sbomPath: p, ownVersion: null, targetVersion: null }], { installedSide: true });
    assert.deepEqual(r, { doc: null, own: new Map([]) });
  } finally { cleanup(); }
});

test('builds envelope from first valid entry and prefixes artifact ids with key', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'a.json');
    writeFileSync(p, JSON.stringify({
      source: { name: 'src' }, distro: { name: 'd' }, descriptor: { name: 'desc' }, schema: { version: '1' },
      artifacts: [{ id: 'art1', name: 'pkg', version: '1.0.0' }]
    }));
    const r = mergeSbom([{ key: 'row1', sbomPath: p, ownVersion: null, targetVersion: null }], { installedSide: true });
    assert.deepEqual(r, { doc: { source: { name: "src" }, distro: { name: "d" }, descriptor: { name: "desc" }, schema: { version: "1" }, artifacts: [{ id: "row1#art1", name: "pkg", version: "1.0.0" }], artifactRelationships: [] }, own: new Map([["row1", []]]) });
  } finally { cleanup(); }
});

test('retargets own-version artifacts when installedSide is false', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, JSON.stringify({
      source: { name: 'src' }, distro: { name: 'd' }, descriptor: { name: 'desc' }, schema: { version: '1' },
      artifacts: [
        { id: 'own1', name: 'pkg', version: '2.0.0', purl: 'pkg:generic/pkg@2.0.0' },
        { id: 'other1', name: 'lib', version: '1.0.0', purl: 'pkg:generic/lib@1.0.0' }
      ]
    }));
    const r = mergeSbom([{ key: 'row2', sbomPath: p, ownVersion: '2.0.0', targetVersion: '3.0.0' }], { installedSide: false });
    assert.deepEqual(r, { doc: { source: { name: "src" }, distro: { name: "d" }, descriptor: { name: "desc" }, schema: { version: "1" }, artifacts: [{ id: "row2#own1", name: "pkg", version: "3.0.0", purl: "pkg:generic/pkg@3.0.0", cpes: [] }, { id: "row2#other1", name: "lib", version: "1.0.0", purl: "pkg:generic/lib@1.0.0" }], artifactRelationships: [] }, own: new Map([["row2", ["row2#own1"]]]) });
  } finally { cleanup(); }
});

test('does not retarget own-version artifacts when installedSide is true', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({
      source: { name: 'src' }, distro: { name: 'd' }, descriptor: { name: 'desc' }, schema: { version: '1' },
      artifacts: [
        { id: 'own1', name: 'pkg', version: '2.0.0', purl: 'pkg:generic/pkg@2.0.0' },
        { id: 'other1', name: 'lib', version: '1.0.0', purl: 'pkg:generic/lib@1.0.0' }
      ]
    }));
    const r = mergeSbom([{ key: 'row3', sbomPath: p, ownVersion: '2.0.0', targetVersion: '3.0.0' }], { installedSide: true });
    assert.deepEqual(r, { doc: { source: { name: "src" }, distro: { name: "d" }, descriptor: { name: "desc" }, schema: { version: "1" }, artifacts: [{ id: "row3#own1", name: "pkg", version: "2.0.0", purl: "pkg:generic/pkg@2.0.0" }, { id: "row3#other1", name: "lib", version: "1.0.0", purl: "pkg:generic/lib@1.0.0" }], artifactRelationships: [] }, own: new Map([["row3", ["row3#own1"]]]) });
  } finally { cleanup(); }
});

test('treats artifact as not own when ownVersion is null even if versions match', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'd.json');
    writeFileSync(p, JSON.stringify({
      source: { name: 'src' }, distro: { name: 'd' }, descriptor: { name: 'desc' }, schema: { version: '1' },
      artifacts: [{ id: 'x1', name: 'pkg', version: '2.0.0', purl: 'pkg:generic/pkg@2.0.0' }]
    }));
    const r = mergeSbom([{ key: 'row4', sbomPath: p, ownVersion: null, targetVersion: '3.0.0' }], { installedSide: false });
    assert.deepEqual(r, { doc: { source: { name: "src" }, distro: { name: "d" }, descriptor: { name: "desc" }, schema: { version: "1" }, artifacts: [{ id: "row4#x1", name: "pkg", version: "2.0.0", purl: "pkg:generic/pkg@2.0.0" }], artifactRelationships: [] }, own: new Map([["row4", []]]) });
  } finally { cleanup(); }
});

test('tracks own ids in the own map only for artifacts matching ownVersion', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'e.json');
    writeFileSync(p, JSON.stringify({
      source: { name: 'src' }, distro: { name: 'd' }, descriptor: { name: 'desc' }, schema: { version: '1' },
      artifacts: [
        { id: 'match1', name: 'a', version: '5.0.0' },
        { id: 'nomatch1', name: 'b', version: '6.0.0' }
      ]
    }));
    const r = mergeSbom([{ key: 'row5', sbomPath: p, ownVersion: '5.0.0', targetVersion: '7.0.0' }], { installedSide: true });
    assert.deepEqual(r, { doc: { source: { name: "src" }, distro: { name: "d" }, descriptor: { name: "desc" }, schema: { version: "1" }, artifacts: [{ id: "row5#match1", name: "a", version: "5.0.0" }, { id: "row5#nomatch1", name: "b", version: "6.0.0" }], artifactRelationships: [] }, own: new Map([["row5", ["row5#match1"]]]) });
  } finally { cleanup(); }
});

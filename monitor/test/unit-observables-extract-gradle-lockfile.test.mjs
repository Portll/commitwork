// Package observables and provenance from a Gradle lockfile (monitor/observables.mjs extractGradleLockfile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGradleLockfile } from '../observables.mjs';

const NOTE = 'versions pinned; repositories are declared in build.gradle and not read, so no origin is claimed';
const prov = (packages) => ({ packages, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false });
const NOTHING = { observables: [], provenance: prov(0), note: NOTE };
const values = (r) => r.observables.map((o) => o.value);

test('a locked coordinate becomes one group:artifact package declared at the given location', () => {
  const r = extractGradleLockfile('com.example:lib:1.0.0=compileClasspath,runtimeClasspath', 'gradle.lockfile');
  const [first] = r.observables;
  assert.deepEqual(r, {
    observables: [{ type: first.type, value: 'com.example:lib', where: 'gradle.lockfile', tier: 'declared' }],
    provenance: prov(1),
    note: NOTE,
  });
});

test('empty text and whitespace-only lines produce no packages', () => {
  assert.deepEqual(extractGradleLockfile('', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('\n   \n\t\n', 'w'), NOTHING);
});

test('a comment holding a full coordinate is skipped, even when indented', () => {
  assert.deepEqual(extractGradleLockfile('# com.example:lib:1.0.0=compileClasspath', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('#g:a:1=c', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('   #g:a:1=c', 'w'), NOTHING);
});

test('a line is skipped when it has no equals sign or nothing before the equals sign', () => {
  assert.deepEqual(extractGradleLockfile('com.example:lib:1.0.0', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('=compileClasspath', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('=g:a:1', 'w'), NOTHING);
});

test('the empty sentinel is not a package and does not disturb its neighbours', () => {
  assert.deepEqual(extractGradleLockfile('empty=', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('empty=compileClasspath,testCompileClasspath', 'w'), NOTHING);
  const r = extractGradleLockfile('g:a:1=c\nempty=d', 'w');
  assert.deepEqual(values(r), ['g:a']);
  assert.deepEqual(r.provenance, prov(1));
});

test('coordinates with fewer or more than three parts are skipped', () => {
  assert.deepEqual(extractGradleLockfile('solo=c', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('g:a=c', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('g:a:1:classifier=c', 'w'), NOTHING);
});

test('a coordinate missing its group or its artifact is skipped', () => {
  assert.deepEqual(extractGradleLockfile(':a:1=c', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('g::1=c', 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile('::1=c', 'w'), NOTHING);
});

test('the version may be empty and only the first equals sign ends the coordinate', () => {
  const empty = extractGradleLockfile('a:b:=c', 'w');
  assert.deepEqual(values(empty), ['a:b']);
  assert.deepEqual(empty.provenance, prov(1));
  const split = extractGradleLockfile('g:a:1=x:y:z=c', 'w');
  assert.deepEqual(values(split), ['g:a']);
  assert.deepEqual(split.provenance, prov(1));
});

test('each valid line counts once, in order, keeping repeats and same-named artifacts apart', () => {
  const text = [
    'org.a:one:1.0=c\r',
    '# note',
    '  org.b:one:2.0=c  ',
    '',
    'empty=d',
    'org.a:one:1.1=c',
    '',
  ].join('\n');
  const r = extractGradleLockfile(text, 'locks/gradle.lockfile');
  assert.deepEqual(values(r), ['org.a:one', 'org.b:one', 'org.a:one']);
  assert.deepEqual(r.observables.map((o) => o.where), Array.from({ length: 3 }, () => 'locks/gradle.lockfile'));
  assert.deepEqual(r.observables.map((o) => o.tier), ['declared', 'declared', 'declared']);
  assert.deepEqual(r.provenance, prov(3));
  assert.equal(r.note, NOTE);
});

test('non-string input is converted to text before parsing', () => {
  assert.deepEqual(extractGradleLockfile(null, 'w'), NOTHING);
  assert.deepEqual(extractGradleLockfile(undefined, 'w'), NOTHING);
  const r = extractGradleLockfile(Buffer.from('g:a:1=c'), 'w');
  assert.deepEqual(values(r), ['g:a']);
  assert.deepEqual(r.provenance, prov(1));
});

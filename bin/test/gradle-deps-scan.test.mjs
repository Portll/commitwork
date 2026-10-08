// The Gradle declared-dependency lane: extraction, and the refusals that keep it honest.
//
// The lane exists because every LOCAL scanner returns zero on a Gradle source tree with no
// lockfile — trivy fs, grype and syft all measured at zero on the same three repos — so the danger
// it introduces is the mirror of the one it fixes: a resolution that quietly covers less than it
// appears to. These tests pin the three places it must refuse rather than under-report.
//
// Network is never touched here: --offline stops after extraction, which is the only part with
// logic worth pinning. The deps.dev and OSV boundaries are verified by running the real thing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../gradle-deps-scan.mjs', import.meta.url));
const run = (dir, out, extra = []) =>
  spawnSync('node', [TOOL, dir, '--out', out, '--log', `${out}.log`, '--offline', ...extra], { encoding: 'utf8' });

const fixture = (toml) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-gradle-'));
  if (toml !== null) { mkdirSync(join(d, 'gradle'), { recursive: true }); writeFileSync(join(d, 'gradle', 'libs.versions.toml'), toml); }
  return d;
};

describe('gradle declared-dependency extraction', () => {
  test('resolves all three library spellings Gradle documents', () => {
    const d = fixture([
      '[versions]', 'guava = "32.1.3-jre"', '',
      '[libraries]',
      'a = { module = "com.google.guava:guava", version.ref = "guava" }',
      'b = { module = "org.ow2.asm:asm", version = "9.10.1" }',
      'c = "org.apache.bcel:bcel:6.12.0"',
      'd = { group = "org.awaitility", name = "awaitility", version = "4.3.0" }',
    ].join('\n'));
    const out = join(d, 'out.json');
    const r = run(d, out);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    const coords = j.direct.map((x) => `${x.group}:${x.artifact}:${x.version}`).sort();
    assert.deepEqual(coords, [
      'com.google.guava:guava:32.1.3-jre',
      'org.apache.bcel:bcel:6.12.0',
      'org.awaitility:awaitility:4.3.0',
      'org.ow2.asm:asm:9.10.1',
    ]);
    rmSync(d, { recursive: true, force: true });
  });

  test('a Groovy build file declares coordinates in either quote, and a single-quoted $ stays literal', () => {
    const d = fixture(null);
    writeFileSync(join(d, 'build.gradle'), [
      'def jacksonVersion = "2.9.8"',
      'dependencies {',
      "    implementation 'org.apache.logging.log4j:log4j-core:2.14.1'",
      '    implementation "com.fasterxml.jackson.core:jackson-databind:$jacksonVersion"',
      "    implementation 'com.example:literal-dollar:$jacksonVersion'",
      "    implementation 'org.example:mismatched:1.0\"",
      '}',
    ].join('\n'));
    const out = join(d, 'out.json');
    const r = run(d, out);
    assert.equal(r.status, 0, r.stderr);
    const coords = JSON.parse(readFileSync(out, 'utf8')).direct.map((x) => `${x.group}:${x.artifact}:${x.version}`).sort();
    assert.deepEqual(coords, ['com.fasterxml.jackson.core:jackson-databind:2.9.8', 'org.apache.logging.log4j:log4j-core:2.14.1']);
    rmSync(d, { recursive: true, force: true });
  });

  test('a repo with NO version catalog leaves no report — noscan, never a clean scan', () => {
    // The failure this refuses is the whole reason the lane exists: five repos in the corpus
    // catalogued zero packages and reported `pass`. A lane that finds no catalog and writes an
    // empty findings file would reproduce that defect in a new place.
    const d = fixture(null);
    const out = join(d, 'out.json');
    const r = run(d, out);
    assert.equal(r.status, 1, 'must exit non-zero when there is nothing to resolve');
    assert.equal(existsSync(out), false, 'must leave NO report, so the lane degrades to noscan');
    rmSync(d, { recursive: true, force: true });
  });

  test('a catalog whose versions never resolve is refused, not reported as empty', () => {
    // Every entry is BOM- or plugin-managed: a real shape, and one where guessing a version would
    // query the wrong package. Zero resolvable coordinates is not a small project, it is no scan.
    const d = fixture(['[libraries]', 'a = { module = "com.example:one" }', 'b = { module = "com.example:two" }'].join('\n'));
    const out = join(d, 'out.json');
    const r = run(d, out);
    assert.equal(r.status, 1);
    assert.equal(existsSync(out), false);
    const log = readFileSync(`${out}.log`, 'utf8');
    assert.match(log, /unresolved-version: 2/, 'the skipped entries must be COUNTED, not silently dropped');
    rmSync(d, { recursive: true, force: true });
  });

  test('an unparseable entry is counted and named, never silently dropped', () => {
    const d = fixture([
      '[versions]', 'v = "1.0.0"', '',
      '[libraries]',
      'good = { module = "com.example:ok", version.ref = "v" }',
      'weird = { somethingElse = "com.example:nope" }',
    ].join('\n'));
    const out = join(d, 'out.json');
    const r = run(d, out);
    assert.equal(r.status, 0);
    const log = readFileSync(`${out}.log`, 'utf8');
    assert.match(log, /unparsed: 1/);
    assert.match(log, /unparsed entry .*weird/, 'the entry must be named so it can be fixed');
    rmSync(d, { recursive: true, force: true });
  });

  test('the report states that its resolution is DECLARED, so a floor is never read as a ceiling', () => {
    // Gradle constraints, resolutionStrategy, platform BOMs and plugins can all override a declared
    // version, and none of that is visible to this lane. The claim has to travel with the data.
    const d = fixture(['[versions]', 'v = "1.0.0"', '', '[libraries]', 'a = { module = "com.example:one", version.ref = "v" }'].join('\n'));
    const out = join(d, 'out.json');
    run(d, out);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.resolution, 'declared');
    rmSync(d, { recursive: true, force: true });
  });
});

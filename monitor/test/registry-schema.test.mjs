// node --test monitor/test/  — registry validation: WRONG TYPES DIE, UNKNOWN KEYS WARN, and
// loadRegistry() THROWS on unreadable/unparseable/invalid — never a degraded {}. Every fixture is
// a known-valid base broken in exactly one place; temp files under os.tmpdir() only.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRegistry, loadRegistry, registryPath, NAME_RE, SLUG_RE } from '../registry.mjs';

// A minimal registry that must validate with zero errors and zero warnings.
const base = () => ({
  reportsRoot: 'reports',
  monitorOutput: 'alpha-monorepo',
  defaultManifest: 'security-baseline',
  areas: [
    { slug: 'alpha', label: 'Alpha', out: 'alpha-monorepo', primary: true, races: true, cadenceMs: 86400000, members: ['alpha-core'], prefixes: ['ax-'] },
    { slug: 'beta', label: 'Beta' },
  ],
  projects: [
    { name: 'alpha-core', area: 'alpha', path: '~/Repositories/alpha', manifest: 'security-baseline' },
    { name: 'beta-core', area: 'beta', path: '~/Repositories/beta', manifest: ['security-baseline', 'build-health'] },
  ],
});

// -> the errors array, asserted non-empty, with a one-line report of what actually came back.
const errorsOf = (reg) => {
  const { errors } = validateRegistry(reg);
  return errors;
};
const assertDies = (reg, re, what) => {
  const errors = errorsOf(reg);
  assert.ok(errors.length > 0, `${what}: expected a fatal error, got none (registry accepted)`);
  assert.ok(errors.some((e) => re.test(e)), `${what}: no error matched ${re}\n  actual: ${JSON.stringify(errors, null, 2)}`);
  return errors;
};

let scratch;
const tmpFile = (name, body) => {
  scratch ??= mkdtempSync(join(tmpdir(), 'cw-registry-'));
  const p = join(scratch, name);
  writeFileSync(p, body);
  return p;
};
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

describe('validateRegistry — the control cases', () => {
  test('the valid base fixture produces zero errors and zero warnings', () => {
    const { errors, warnings } = validateRegistry(base());
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  test('the LIVE monitor/projects.json validates with zero errors', () => {
    const { errors } = validateRegistry(JSON.parse(readFileSync(registryPath(), 'utf8')));
    assert.deepEqual(errors, [], 'the shipped registry must always be valid');
  });

  test('a non-object registry dies rather than being treated as empty', () => {
    for (const bad of [null, undefined, 42, 'reports', []]) {
      assertDies(bad, /registry is not an object/, `registry=${JSON.stringify(bad)}`);
    }
  });
});

describe('validateRegistry — negative cases (these must DIE)', () => {
  test('a project with no `area` dies once areas[] is declared', () => {
    const reg = base();
    delete reg.projects[0].area;
    const errors = assertDies(reg, /^projects\[0\] \(alpha-core\): area \(string\) is required when areas\[\] is declared$/, 'missing area');
    assert.equal(errors.length, 1, 'exactly one error — the missing area, nothing collateral');
  });

  test('a wrong-typed `members` dies (string instead of string[])', () => {
    const reg = base();
    reg.areas[0].members = 'alpha-core';
    assertDies(reg, /^areas\[0\]: members must be an array of strings$/, 'members: string');
  });

  test('a wrong-typed `members` dies (array of non-strings)', () => {
    const reg = base();
    reg.areas[0].members = ['alpha-core', 7];
    assertDies(reg, /^areas\[0\]: members must be an array of strings$/, 'members: [string, number]');
  });

  test('a duplicate area slug dies', () => {
    const reg = base();
    reg.areas.push({ slug: 'alpha', label: 'Alpha Again' });
    assertDies(reg, /^areas\[2\]: duplicate area slug 'alpha'$/, 'duplicate slug');
  });

  test('two areas declaring primary:true die', () => {
    const reg = base();
    reg.areas[1].primary = true;
    assertDies(reg, /^areas: more than one area declares primary:true$/, 'two primaries');
  });

  test('a bad slug charset dies (and SLUG_RE is what it is checked against)', () => {
    for (const bad of ['Alpha', 'alpha monorepo', '-alpha', 'alpha_x', 'alpha/x', '', '../evil']) {
      assert.equal(SLUG_RE.test(bad), false, `SLUG_RE must reject ${JSON.stringify(bad)}`);
      const reg = base();
      reg.areas[0].slug = bad;
      assertDies(reg, /^areas\[0\]: slug must match /, `slug=${JSON.stringify(bad)}`);
    }
  });

  test('a bad `out` charset dies — out becomes a report DIRECTORY name', () => {
    const reg = base();
    reg.areas[0].out = '../escape';
    assertDies(reg, /^areas\[0\]: out must match /, 'out=../escape');
  });

  test('a bad project-name charset dies (NAME_RE reaches the filesystem and the panel DOM)', () => {
    for (const bad of ['<img src=x onerror=1>', 'alpha core', 'alpha/core', 'alpha;core', '']) {
      assert.equal(NAME_RE.test(bad), false, `NAME_RE must reject ${JSON.stringify(bad)}`);
      const reg = base();
      reg.projects[0].name = bad;
      assertDies(reg, /^projects\[0\]: name must match /, `name=${JSON.stringify(bad)}`);
    }
  });

  test('a negative or zero cadenceMs dies', () => {
    for (const bad of [-1, -86400000, 0]) {
      const reg = base();
      reg.areas[0].cadenceMs = bad;
      assertDies(reg, /^areas\[0\]: cadenceMs must be a positive number$/, `cadenceMs=${bad}`);
    }
  });

  test('a non-numeric cadenceMs dies too', () => {
    const reg = base();
    reg.areas[0].cadenceMs = '86400000';
    assertDies(reg, /^areas\[0\]: cadenceMs must be a positive number$/, 'cadenceMs="86400000"');
  });

  test('a wrong-typed projects container dies', () => {
    const p = base(); p.projects = 'alpha-core';
    assertDies(p, /^projects must be an array$/, 'projects as string');
    const n = base(); n.projects = [null];
    assertDies(n, /^projects\[0\] is not an object$/, 'null project');
  });

  test('a null entry inside areas[] dies', () => {
    const n = base(); n.areas = [null];
    assertDies(n, /^areas\[0\] is not an object$/, 'null area');
  });

  test('a wrong-typed areas container dies with an enumerated error, not a TypeError',
    () => {
      for (const areas of [{ alpha: {} }, 'alpha', 42, true]) {
        const reg = base(); reg.areas = areas;
        assertDies(reg, /^areas must be an array$/, `areas=${JSON.stringify(areas)}`);
      }
    });

  test('a non-boolean primary/races dies', () => {
    const reg = base();
    reg.areas[0].races = 'true';
    assertDies(reg, /^areas\[0\]: races must be a boolean$/, 'races="true"');
  });

  test('a project with no path or no manifest dies', () => {
    const noPath = base(); delete noPath.projects[1].path;
    assertDies(noPath, /^projects\[1\] \(beta-core\): path \(string\) is required$/, 'no path');
    const noManifest = base(); noManifest.projects[1].manifest = 42;
    assertDies(noManifest, /^projects\[1\] \(beta-core\): manifest must be a string or array of strings$/, 'manifest=42');
  });
});

describe('validateRegistry — unknown keys WARN, never die', () => {
  test('an unknown TOP-LEVEL key warns and the registry stays usable', () => {
    const reg = base();
    reg.futureFeatureFlag = { enabled: true };
    const { errors, warnings } = validateRegistry(reg);
    assert.deepEqual(errors, [], 'an unknown top-level key must NOT be fatal (forward-compat)');
    assert.deepEqual(warnings, ['unknown top-level key: futureFeatureFlag']);
  });

  test('an unknown AREA key and an unknown PROJECT key warn, naming the owner', () => {
    const reg = base();
    reg.areas[0].racesEngines = 'semgrep';   // a key PLAN item 3 will add
    reg.projects[0].profile = 'java';        // a key PLAN item 5 (D3) will add
    const { errors, warnings } = validateRegistry(reg);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, ['areas[0] (alpha): unknown key racesEngines', 'projects[0] (alpha-core): unknown key profile']);
  });

  test('an area typo on a project warns (visible) but does not block the sweep', () => {
    const reg = base();
    reg.projects[0].area = 'alfa'; // typo'd, no areas[] block, and != the project's own name
    const { errors, warnings } = validateRegistry(reg);
    assert.deepEqual(errors, [], 'a typo must be visible, not fatal — item 1 rollback depends on it');
    assert.deepEqual(warnings, ["projects[0] (alpha-core): area 'alfa' has no areas[] block (typo?)"]);
  });

  test('area === name is self-evidently own-area and stays SILENT', () => {
    const reg = base();
    reg.projects[0].name = 'standalone';
    reg.projects[0].area = 'standalone';
    const { errors, warnings } = validateRegistry(reg);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });
});

describe('loadRegistry — throws, never degrades to {}', () => {
  test('corrupt JSON THROWS and the message names the file and says "not valid JSON"', () => {
    const p = tmpFile('corrupt.json', '{ "reportsRoot": "reports", "areas": [ { "slug": "alpha" ');
    assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /^registry is not valid JSON \(/);
      assert.ok(e.message.includes(p), `the error must name the path; got: ${e.message}`);
      return true;
    });
  });

  test('a truncated-to-empty registry THROWS (an empty file is not an empty fleet)', () => {
    const p = tmpFile('empty.json', '');
    assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
      assert.match(e.message, /^registry is not valid JSON \(/);
      return true;
    });
  });

  test('valid JSON that is not an object THROWS as invalid, not as unparseable', () => {
    const p = tmpFile('array.json', '[]');
    assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
      assert.match(e.message, /^registry invalid \(/);
      assert.match(e.message, /registry is not an object/);
      return true;
    });
  });

  test('a schema-invalid registry THROWS with every error enumerated', () => {
    const reg = base();
    delete reg.projects[0].area;
    reg.areas[1].slug = 'Beta';
    const p = tmpFile('invalid.json', JSON.stringify(reg));
    assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
      assert.match(e.message, /^registry invalid \(/);
      assert.match(e.message, /area \(string\) is required/);
      assert.match(e.message, /areas\[1\]: slug must match/);
      return true;
    });
  });

  test('a MISSING path THROWS "unreadable", naming the path', () => {
    const p = join(scratch ?? tmpdir(), 'definitely-not-here-projects.json');
    assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
      assert.match(e.message, /^registry unreadable at /);
      assert.ok(e.message.includes(p));
      assert.match(e.message, /ENOENT/);
      return true;
    });
  });

  test('a chmod-000 path THROWS "unreadable" (a permissions error is not an empty fleet)', (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('running as root — chmod 000 is still readable');
    const p = tmpFile('noperm.json', JSON.stringify(base()));
    const _deny = denyRead(p);

    assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
    try {
      assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
        assert.match(e.message, /^registry unreadable at /);
        assert.match(e.message, REFUSED_ERRNO);
        return true;
      });
    } finally { _deny.restore(); }
  });

  test('a directory in place of the registry THROWS rather than silently emptying', () => {
    scratch ??= mkdtempSync(join(tmpdir(), 'cw-registry-'));
    assert.throws(() => loadRegistry({ path: scratch, quiet: true }), (e) => {
      assert.match(e.message, /^registry unreadable at /);
      assert.match(e.message, /EISDIR/);
      return true;
    });
  });

  test('the live registry loads and keeps its load-bearing shape', () => {
    const reg = loadRegistry({ quiet: true });
    assert.equal(typeof reg, 'object');
    assert.ok(Array.isArray(reg.areas) && reg.areas.length >= 1, 'areas[] is the routing table');
    assert.equal(reg.reportsRoot, 'reports');
    assert.ok(reg.areas.filter((a) => a.primary).length <= 1);
  });
});

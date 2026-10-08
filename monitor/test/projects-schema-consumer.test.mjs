// node --test monitor/test/  — schema/projects.schema.json HAS A CODE CONSUMER. Three kinds of
// assertion: the schema is executed at the read boundary; neither validator subsumes the other;
// the checker fails closed on keywords it does not implement.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, validateRegistry, validateAgainstSchema, registryPath, SCHEMA_PATH } from '../registry.mjs';

const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

// Valid by BOTH validators, and deliberately minimal: every negative below breaks exactly one thing.
const base = () => ({
  reportsRoot: 'reports',
  areas: [{ slug: 'alpha', label: 'Alpha' }],
  projects: [{ name: 'alpha-core', area: 'alpha', path: '~/x/alpha', manifest: 'm' }],
});

let scratch;
const tmp = (name, body) => {
  scratch ??= mkdtempSync(join(tmpdir(), 'cw-schemacons-'));
  const p = join(scratch, name);
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  return p;
};
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

const schemaErrors = (reg) => validateAgainstSchema(reg).errors;

describe('the anchor: the live pair agrees with itself', () => {
  test('the LIVE registry validates against the LIVE schema with zero errors', () => {
    const reg = JSON.parse(readFileSync(registryPath(), 'utf8'));
    assert.deepEqual(schemaErrors(reg), [], 'the shipped registry must satisfy the shipped schema');
  });

  test('and loadRegistry() emits zero warnings for it too — the flip to fatal deploy keys is clean', () => {
    const { errors, warnings } = validateRegistry(JSON.parse(readFileSync(registryPath(), 'utf8')));
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, [], 'a warning at the boundary that generates ingress is a silent-green');
  });

  test('the base fixture is clean under both, so every negative below isolates one cause', () => {
    assert.deepEqual(schemaErrors(base()), []);
    assert.deepEqual(validateRegistry(base()).errors, []);
  });
});

describe('the schema is EXECUTED: constraints the hand validator never checked now bite', () => {
  // constraints written in the schema all along and enforced by nothing — validateRegistry walks
  // areas/projects and stops
  const cases = [
    ['roots[].maxDepth below its minimum', (r) => { r.roots = [{ path: '~/Repositories', maxDepth: 0 }]; }, /roots\[0\]\.maxDepth: 0 < minimum 1/],
    ['roots[] entry with no path', (r) => { r.roots = [{ maxDepth: 2 }]; }, /roots\[0\]: required key 'path' is missing/],
    ['roots[].maxDepth as a float, not an integer', (r) => { r.roots = [{ path: '~/x', maxDepth: 1.5 }]; }, /roots\[0\]\.maxDepth: expected integer, got number/],
    ['an expand value outside the enum', (r) => { r.projects[0].expand = 'siblings'; }, /projects\[0\]\.expand: "siblings" is not one of \["children"\]/],
    ['a lifecycle state outside the enum', (r) => { r.lifecycle = { old: { state: 'archived', effectiveFrom: '20260101000000' } }; }, /lifecycle\.old\.state: "archived" is not one of/],
    ['a lifecycle timestamp that is not 14 digits', (r) => { r.lifecycle = { old: { state: 'superseded', effectiveFrom: '2026-01-01' } }; }, /lifecycle\.old\.effectiveFrom: "2026-01-01" does not match/],
    ['a lifecycle entry missing effectiveFrom', (r) => { r.lifecycle = { old: { state: 'superseded' } }; }, /lifecycle\.old: required key 'effectiveFrom' is missing/],
    ['a non-string value in urls', (r) => { r.urls = { alpha: 8099 }; }, /urls\.alpha: expected string, got number/],
    ['a non-array historic', (r) => { r.historic = {}; }, /historic: expected array, got object/],
    ['a non-object retention', (r) => { r.retention = 30; }, /retention: expected object, got number/],
  ];

  for (const [what, mutate, re] of cases) {
    test(`${what} — schema catches it, the hand validator does not`, () => {
      const reg = base();
      mutate(reg);
      assert.deepEqual(validateRegistry(reg).errors, [], `${what}: the hand validator was expected to be silent here — if it now catches this, the case no longer proves the schema runs`);
      const errs = schemaErrors(reg);
      assert.ok(errs.some((e) => re.test(e)), `${what}: no schema error matched ${re}\n  actual: ${JSON.stringify(errs, null, 2)}`);
    });
  }

  test('oneOf works, and manifest is the one place both validators cover it — asserted, not assumed', () => {
    // manifest is the schema's only oneOf and is also checked by hand — kept as a parity case
    const reg = base();
    reg.projects[0].manifest = { name: 'm' };
    assert.ok(schemaErrors(reg).some((e) => /projects\[0\]\.manifest: matched 0 of 2 oneOf branches/.test(e)));
    assert.ok(validateRegistry(reg).errors.some((e) => /manifest must be a string or array of strings/.test(e)));
    const arr = base();
    arr.projects[0].manifest = ['a', 'b'];
    assert.deepEqual(schemaErrors(arr), [], 'a string[] manifest must match exactly one branch');
  });

  test('and loadRegistry() THROWS on one, so the schema is enforced at the read boundary and not merely available', () => {
    const reg = base();
    reg.roots = [{ path: '~/Repositories', maxDepth: 0 }];
    const p = tmp('schema-only-invalid.json', reg);
    assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
      assert.match(e.message, /^registry invalid \(/);
      assert.match(e.message, /schema: roots\[0\]\.maxDepth/);
      return true;
    });
  });
});

describe('neither validator subsumes the other — which is why both run', () => {
  test('the SCHEMA misses what the hand validator catches: identity and cross-entry rules', () => {
    // a JSON Schema cannot express identity/cross-entry rules without machinery this checker lacks
    const dup = base();
    dup.areas.push({ slug: 'alpha', label: 'Alpha Again' });
    assert.deepEqual(schemaErrors(dup), [], 'a duplicate slug is well-formed JSON per the schema');
    assert.ok(validateRegistry(dup).errors.some((e) => /duplicate area slug/.test(e)));

    const twoPrimary = base();
    twoPrimary.areas = [{ slug: 'alpha', primary: true }, { slug: 'beta', primary: true }];
    assert.deepEqual(schemaErrors(twoPrimary), []);
    assert.ok(validateRegistry(twoPrimary).errors.some((e) => /more than one area declares primary/.test(e)));

    const clash = base();
    clash.areas = [
      { slug: 'alpha', deploy: { hostnames: ['a.example.com'], service: 'http://127.0.0.1:1', public: false, requiresAuth: true } },
      { slug: 'beta', deploy: { hostnames: ['a.example.com'], service: 'http://127.0.0.1:2', public: false, requiresAuth: true } },
    ];
    assert.deepEqual(schemaErrors(clash), [], 'one hostname in two areas is well-formed per the schema');
    assert.ok(validateRegistry(clash).errors.some((e) => /already claimed by area/.test(e)));
  });

  test('the HAND validator misses what the schema catches — proved above, restated as the pair rule', () => {
    const reg = base();
    reg.projects[0].expand = 'siblings';       // schema-only: enum violation
    reg.areas.push({ slug: 'alpha' });          // hand-only: duplicate slug
    assert.ok(validateRegistry(reg).errors.length >= 1, 'the hand validator must still see its own rule');
    assert.ok(schemaErrors(reg).length >= 1, 'the schema must still see its own rule');
    const p = tmp('both-invalid.json', reg);
    assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
      assert.match(e.message, /duplicate area slug/, 'the hand validator error must survive the merge');
      assert.match(e.message, /schema: projects\[0\]\.expand/, 'and so must the schema error');
      return true;
    });
  });
});

describe('the deploy block: one key set, two files, and loadRegistry refuses any disagreement', () => {
  const deployProps = Object.keys(SCHEMA.properties.areas.items.properties.deploy.properties);
  const sample = {
    hostnames: ['panel.example.com'], service: 'http://127.0.0.1:59000', public: false,
    requiresAuth: true, authAt: 'origin', originServerName: 'panel.example.com',
    caPool: '/x/ca.pem', note: 'n', probePath: '/app', hosting: 'pages',
  };

  test('every key the SCHEMA declares on deploy is accepted by validateRegistry too', () => {
    // sample values are hand-supplied so a newly-added schema key fails until someone gives it a real value
    for (const k of deployProps) {
      assert.ok(Object.prototype.hasOwnProperty.call(sample, k),
        `deploy key '${k}' is declared in projects.schema.json but has no sample value here — add one (and check DEPLOY_KEYS in registry.mjs knows it)`);
    }
    // hosting and service are MUTUALLY EXCLUSIVE (a pages-hosted area has no local origin — the
    // conditional lives in validateRegistry because the schema subset checker implements no
    // if/then), so the combined sample splits into the two shapes that can actually exist.
    const { hosting: _h, ...tunnelShaped } = sample;
    const { service: _s, ...pagesShaped } = sample;
    for (const deploy of [tunnelShaped, pagesShaped]) {
      const reg = base();
      reg.areas[0].deploy = { ...deploy };
      assert.deepEqual(validateRegistry(reg).errors, []);
      assert.deepEqual(validateRegistry(reg).warnings, []);
      assert.deepEqual(schemaErrors(reg), []);
    }
    // And the conjunction is refused — both keys together must never validate.
    const reg = base();
    reg.areas[0].deploy = { ...sample };
    assert.ok(validateRegistry(reg).errors.some((e) => /pages.*service|service.*pages/.test(e)),
      'hosting pages + service together must be an error');
  });

  test('a deploy key in NEITHER file cannot load, whichever validator objects first', () => {
    // `authat` is the realistic typo — on the one key that unlocks public emission
    for (const k of ['tunnelId', 'noTLSVerify', 'httpHostHeader', 'authat', 'originRequest']) {
      const reg = base();
      reg.areas[0].deploy = { ...sample, [k]: k === 'noTLSVerify' ? true : 'x' };
      const p = tmp(`unknown-${k}.json`, reg);
      assert.throws(() => loadRegistry({ path: p, quiet: true }), (e) => {
        assert.match(e.message, /^registry invalid \(/);
        assert.match(e.message, new RegExp(`unknown key '?${k}'?`), `${k}: the refusal must name the key\n${e.message}`);
        return true;
      }, `deploy key '${k}' must not load`);
    }
  });
});

describe('the checker fails CLOSED on its own limits', () => {
  const swap = (mutate) => {
    const s = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    mutate(s);
    return tmp(`schema-${Math.random().toString(36).slice(2)}.json`, s);
  };

  test('const is ENFORCED, not merely accepted — implementing a keyword means checking it', () => {
    // The failure this guards: a keyword added to SCHEMA_KEYWORDS to make a schema load, with no
    // branch in checkNode to evaluate it. The schema then passes its own audit and constrains
    // nothing — an unimplemented keyword wearing an implemented one's clothes, which is worse than
    // the refusal it replaced because it looks like coverage.
    const good = swap((s) => { s.properties.reportsRoot.const = 'reports'; });
    assert.deepEqual(validateAgainstSchema(base(), { path: good }).errors, [],
      'a value matching the constant must pass');
    const bad = swap((s) => { s.properties.reportsRoot.const = 'not-what-the-registry-says'; });
    const errs = validateAgainstSchema(base(), { path: bad }).errors;
    assert.ok(errs.some((e) => /expected the constant/.test(e)),
      `a value violating the constant must FAIL, or the keyword is decoration\n  ${JSON.stringify(errs)}`);
  });

  test('uniqueItems is enforced with structural JSON equality', () => {
    const schema = swap((s) => { s.properties.projects.uniqueItems = true; });
    assert.deepEqual(validateAgainstSchema(base(), { path: schema }).errors, []);

    const duplicate = base();
    duplicate.projects.push({ manifest: 'm', path: '~/x/alpha', area: 'alpha', name: 'alpha-core' });
    const errs = validateAgainstSchema(duplicate, { path: schema }).errors;
    assert.ok(errs.some((e) => /projects\[1\]: duplicates item 0 \(uniqueItems: true\)/.test(e)),
      `object key order must not evade uniqueItems:\n  ${JSON.stringify(errs)}`);
  });

  test('a schema keyword the checker does not implement is an ERROR, never a silent skip', () => {
    // an unimplemented keyword silently ignored is the schema decaying back into decoration
    // `const` left this list on 2026-08-26 — it is IMPLEMENTED now (see the test below), and a
    // keyword that has been implemented cannot also be an example of one that has not. The
    // principle is untouched: what the checker cannot evaluate, it refuses.
    for (const kw of ['allOf', 'anyOf', 'not', 'dependencies', 'format', '$ref']) {
      const p = swap((s) => { s.properties.reportsRoot[kw] = {}; });
      const errs = validateAgainstSchema(base(), { path: p }).errors;
      assert.ok(errs.some((e) => e.includes(`schema keyword '${kw}' is not implemented`)),
        `'${kw}' was silently ignored — the checker must refuse what it cannot evaluate\n  ${JSON.stringify(errs)}`);
    }
  });

  test('...even where the registry declares NOTHING, so it cannot hide in an unused branch', () => {
    // the lazy version walked only reached subschemas — the same hole, one level down
    for (const put of [
      (s) => { s.properties.lifecycle.additionalProperties.allOf = []; },
      (s) => { s.properties.roots.items.properties.exclude.items.format = 'uri'; },
      (s) => { s.properties.projects.items.properties.manifest.oneOf[1].$ref = '#/x'; },
    ]) {
      const errs = validateAgainstSchema(base(), { path: swap(put) }).errors;
      assert.ok(errs.some((e) => /is not implemented/.test(e)), JSON.stringify(errs));
    }
  });

  test('and loadRegistry() refuses rather than loading against a schema it cannot fully evaluate', () => {
    const sp = swap((s) => { s.properties.areas.items.properties.deploy.allOf = []; });
    const rp = tmp('fine.json', base());
    assert.throws(() => loadRegistry({ path: rp, schemaPath: sp, quiet: true }), /not implemented/);
  });

  test('an unevaluable schema yields NO verdict on the registry — not a partial one', () => {
    // the support audit gates the instance walk — no partial verdicts
    const reg = base();
    reg.roots = [{ path: '~/x', maxDepth: 0 }];   // a real, detectable violation
    const p = swap((s) => { s.allOf = []; });
    const errs = validateAgainstSchema(reg, { path: p }).errors;
    assert.ok(errs.every((e) => /is not implemented/.test(e)),
      `the instance walk must not run against an unevaluable schema:\n${JSON.stringify(errs, null, 2)}`);
  });

  test('a MISSING schema file is fatal — a registry cannot be valid against a file nothing opened', () => {
    const rp = tmp('fine2.json', base());
    const gone = join(scratch, 'no-such-schema.json');
    assert.throws(() => loadRegistry({ path: rp, schemaPath: gone, quiet: true }), (e) => {
      assert.match(e.message, /could not be read or parsed/);
      assert.match(e.message, /refusing to report the registry valid against a schema nothing opened/);
      return true;
    });
  });

  test('a CORRUPT schema file is fatal too, and says so as a schema problem, not a registry one', () => {
    const bad = tmp('corrupt-schema.json', '{ "type": "object", ');
    const rp = tmp('fine3.json', base());
    assert.throws(() => loadRegistry({ path: rp, schemaPath: bad, quiet: true }), /could not be read or parsed/);
  });

  test('a subschema that is not an object is refused rather than treated as "no constraints"', () => {
    const p = swap((s) => { s.properties.areas.items.properties.slug = 'string'; });
    const errs = validateAgainstSchema(base(), { path: p }).errors;
    assert.ok(errs.some((e) => /subschema is not an object/.test(e)), JSON.stringify(errs));
  });
});

describe('the drift the wiring found on its first run', () => {
  test('`projects` is NOT required at the top level, and the schema no longer says it is', () => {
    // the schema required `projects` while validateRegistry never did — a roots-only registry is legitimate
    assert.deepEqual(SCHEMA.required, ['reportsRoot'], 'projects must not be required');
    const rootsOnly = { reportsRoot: 'reports', areas: [{ slug: 'alpha' }] };
    assert.deepEqual(schemaErrors(rootsOnly), []);
    assert.deepEqual(validateRegistry(rootsOnly).errors, []);
    assert.doesNotThrow(() => loadRegistry({ path: tmp('roots-only.json', rootsOnly), quiet: true }));
  });

  test('reportsRoot IS still required — the relaxation was one key, not the constraint', () => {
    const noRoot = { areas: [{ slug: 'alpha' }] };
    assert.ok(schemaErrors(noRoot).some((e) => /required key 'reportsRoot' is missing/.test(e)));
  });
});

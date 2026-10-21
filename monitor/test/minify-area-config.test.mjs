// C2: per-area minifiedCode threshold overrides in projects.json areas[].minify.
// The schema is the single read boundary for every sweep/panel/rollup (registry.mjs loadRegistry),
// so a wrong `minify` schema would block the fleet — these pin accept/reject at that layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAgainstSchema, validateRegistry } from '../registry.mjs';

const base = () => ({
  areas: [{ slug: 'app', out: 'app', primary: true, minify: { maxBytes: 2_000_000, semgrepCeiling: 500_000, entropyRule: true } }],
  projects: [{ name: 'app', path: '~/app', manifest: 'security-baseline.json', area: 'app' }],
});

test('a valid area.minify block raises no schema error', () => {
  const { errors } = validateAgainstSchema(base());
  assert.ok(!errors.some((e) => /minify/.test(e)), `valid minify block should be accepted: ${errors.join('; ')}`);
});

test('a partial minify block (only one key) is accepted', () => {
  const reg = base(); reg.areas[0].minify = { entropyRule: false };
  assert.ok(!validateAgainstSchema(reg).errors.some((e) => /minify/.test(e)));
});

test('a non-integer maxBytes is rejected', () => {
  const reg = base(); reg.areas[0].minify = { maxBytes: 'lots' };
  assert.ok(validateAgainstSchema(reg).errors.some((e) => /minify|maxBytes/.test(e)),
    'a string maxBytes must fail the schema');
});

test('an unknown minify sub-key is rejected (additionalProperties:false)', () => {
  const reg = base(); reg.areas[0].minify = { turboMode: true };
  assert.ok(validateAgainstSchema(reg).errors.some((e) => /minify|turboMode|additional/i.test(e)),
    'an undeclared minify sub-key must fail');
});

test('minify is a known area key — validateRegistry raises no unknown-key warning', () => {
  const v = validateRegistry(base());
  const warns = (v && v.warnings) || [];
  assert.ok(!warns.some((w) => /unknown key minify/i.test(w)), `minify must be in AREA_KEYS: ${warns.join('; ')}`);
});

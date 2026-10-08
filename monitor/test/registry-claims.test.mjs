// pins: members/prefixes claimed once across areas - areaOf() is first-match, so a double claim
// routed a repo's findings into whichever area was declared first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistry, loadRegistry } from '../registry.mjs';

const reg = (areas) => ({ reportsRoot: 'reports', areas });
const claimErrs = (r) => validateRegistry(r).errors.filter((e) => /claimed by|overlaps/.test(e));

test('a repo claimed as a member of two areas is fatal', () => {
  const errs = claimErrs(reg([
    { slug: 'a', out: 'a', primary: true, members: ['svc'] },
    { slug: 'b', out: 'b', members: ['svc'] },
  ]));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /member 'svc' is already claimed by area 'a'/);
});

test('the same prefix in two areas is fatal', () => {
  const errs = claimErrs(reg([
    { slug: 'a', out: 'a', primary: true, prefixes: ['web-'] },
    { slug: 'b', out: 'b', prefixes: ['web-'] },
  ]));
  assert.equal(errs.length, 1);
});

test('an overlapping prefix is fatal too — web- and web-admin- both match web-admin-console', () => {
  const errs = claimErrs(reg([
    { slug: 'a', out: 'a', primary: true, prefixes: ['web-'] },
    { slug: 'b', out: 'b', prefixes: ['web-admin-'] },
  ]));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /overlaps/);
});

test('distinct members and prefixes are accepted', () => {
  assert.deepEqual(claimErrs(reg([
    { slug: 'a', out: 'a', primary: true, members: ['one'], prefixes: ['aa-'] },
    { slug: 'b', out: 'b', members: ['two'], prefixes: ['bb-'] },
  ])), []);
});

test('the shipped registry holds no claim collision', () => {
  assert.doesNotThrow(() => loadRegistry({ quiet: true }));
});

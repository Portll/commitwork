// The registry publishes its unevidenced-class count beside the matchers that define it, so the two
// must agree or the published number is one nobody can reproduce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '..', '..', 'monitor', 'failure-taxonomy.json');

test('the published evidence census is re-derived from its executable predicate', () => {
  const doc = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const claim = doc.evidencePredicate;
  assert.ok(claim && Array.isArray(claim.matchers) && claim.matchers.length > 0,
    'evidencePredicate needs executable matchers; prose alone cannot reproduce its count');

  const matchers = claim.matchers.map((source) => new RegExp(source, 'i'));
  const unevidenced = doc.classes.filter((c) => !matchers.some((re) => re.test(c.example || '')));
  assert.equal(claim.of, doc.classes.length,
    `evidencePredicate.of says ${claim.of}; the registry contains ${doc.classes.length} classes`);
  assert.equal(claim.count, unevidenced.length,
    `evidencePredicate.count says ${claim.count}; its matchers derive ${unevidenced.length} unevidenced classes`);
});

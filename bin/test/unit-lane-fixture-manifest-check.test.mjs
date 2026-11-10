// The first manifest check with a given id, tagged with its manifest name (bin/lane-fixture.mjs manifestCheck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestCheck } from '../lane-fixture.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'manifests');
const BASE = 'security-baseline.json';

const checksIn = (file) => {
  const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  return Array.isArray(doc?.checks) ? doc.checks : [];
};

const baseline = checksIn(BASE);
const baseIds = new Set(baseline.map((c) => c.id));
const otherFiles = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== BASE).sort();
const otherIds = new Set(otherFiles.flatMap((f) => checksIn(f).map((c) => c.id)));
const allIds = new Set([...baseIds, ...otherIds]);

const firstBase = baseline.find((c) => typeof c.id === 'string');
const lastBase = baseline.findLast(
  (c, i) => typeof c.id === 'string' && baseline.findIndex((d) => d.id === c.id) === i,
);
const shared = baseline.find((c) => typeof c.id === 'string' && otherIds.has(c.id));

const otherOnly = (() => {
  for (const file of otherFiles) {
    const check = checksIn(file).find((c) => typeof c.id === 'string' && !baseIds.has(c.id));
    if (check) return { file, check };
  }
  return null;
})();

const missingId = `missing-${'z'.repeat(32)}`;

test('a check id first defined in the security baseline returns that check tagged security-baseline', { skip: !firstBase }, () => {
  const r = manifestCheck(firstBase.id);
  assert.deepEqual(r, { ...firstBase, manifest: 'security-baseline' });
});

test('a later check id in the security baseline returns that later check, not the first one', { skip: !lastBase || lastBase === firstBase }, () => {
  const r = manifestCheck(lastBase.id);
  assert.deepEqual(r, { ...lastBase, manifest: 'security-baseline' });
});

test('a check id defined only outside the baseline returns it tagged with its own manifest name', { skip: !otherOnly }, () => {
  const r = manifestCheck(otherOnly.check.id);
  assert.deepEqual(r, { ...otherOnly.check, manifest: basename(otherOnly.file, '.json') });
});

test('a check id present in the baseline and another manifest is taken from the baseline', { skip: !shared }, () => {
  const r = manifestCheck(shared.id);
  assert.deepEqual(r, { ...shared, manifest: 'security-baseline' });
});

test('a check id that no manifest defines returns null', { skip: allIds.has(missingId) }, () => {
  assert.equal(manifestCheck(missingId), null);
});

test('a baseline id with one extra character appended is not matched and returns null', { skip: !firstBase || allIds.has(`${firstBase?.id}x`) }, () => {
  assert.equal(manifestCheck(`${firstBase.id}x`), null);
});

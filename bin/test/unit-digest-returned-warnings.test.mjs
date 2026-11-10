// Warnings seen again after being set aside in the register (bin/digest.mjs returnedWarnings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { returnedWarnings } from '../digest.mjs';
import { failedWork } from '../digest.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const WIN = { from: '2024-01-01T00:00:00.000Z', until: '2024-01-04T00:00:00.000Z' };
const ABSENT = 'register absent: nothing has been set aside, so no warning can have returned';
const RB = 'Ratchet breaches';
const FW = 'Failed work';
const NOT = (t) => `${t}: not measured, so a return there cannot be seen`;
const PART = (t) => `${t}: partly measured; returns are checked over the measured part only`;

const secs = (a, b, ai = [], bi = []) => ({
  ratchetBreaches: { title: RB, status: a, items: ai },
  failedWork: { title: FW, status: b, items: bi },
});
const expected = (notMeasured, status, state = 'absent', caveats = [ABSENT]) => ({
  title: 'Returned warnings',
  input: [{ name: 'disregarded-warning register', path: 'reg.json', state }],
  notMeasured,
  caveats,
  items: [],
  status,
});
const bare = ({ coverage, ...rest }) => rest;
const inTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'returnedWarnings-'));
  try { fn(dir, join(dir, 'reg.json')); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const call = (dir, registerPath, sections) => returnedWarnings({ root: dir, window: WIN, sections, registerPath });

test('an unreadable register leaves the section not measured and without coverage', () => inTmp((dir, reg) => {
  writeFileSync(reg, JSON.stringify({ records: [] }));
  const { notMeasured, ...rest } = call(dir, reg, secs('measured', 'measured'));
  assert.equal(notMeasured.length, 1);
  assert.equal(notMeasured[0].endsWith(' \u2014 a return cannot be told from a fresh warning'), true);
  assert.deepEqual({ ...rest, notMeasured: [] }, expected([], 'not-measured', 'unreadable', []));
}));

test('an absent register over two measured sources is measured with nothing returned', () => inTmp((dir, reg) => {
  assert.deepEqual(bare(call(dir, reg, secs('measured', 'measured'))), expected([], 'measured'));
}));

test('a not-measured source and a partly measured source make a partial section', () => inTmp((dir, reg) => {
  assert.deepEqual(bare(call(dir, reg, secs('not-measured', 'partial'))), expected([NOT(RB), PART(FW)], 'partial'));
}));

test('a measured source beside a partly measured one names only the partial one', () => inTmp((dir, reg) => {
  assert.deepEqual(bare(call(dir, reg, secs('measured', 'partial'))), expected([PART(FW)], 'partial'));
}));

test('two not-measured sources leave the section not measured', () => inTmp((dir, reg) => {
  assert.deepEqual(bare(call(dir, reg, secs('not-measured', 'not-measured'))), expected([NOT(RB), NOT(FW)], 'not-measured'));
}));

test('with no register neither warned nor unwarned rows count as returned', () => inTmp((dir, reg) => {
  const reports = join(dir, 'reports');
  mkdirSync(join(reports, 'area1'), { recursive: true });
  const marker = { pid: 999999, area: 'area1', sliceId: 'slice-1', startedAt: '2024-01-01T00:00:00.000Z' };
  writeFileSync(join(reports, 'area1', '.sweep-inflight.json'), JSON.stringify(marker));
  let hung = [];
  try { hung = failedWork({ root: dir, window: WIN, reportsRoot: reports, pidAlive: () => false }).items; } catch {}
  const sections = secs('measured', 'measured', [{ gate: 'g', subject: 's' }], [...hung, { area: 'b' }, ...hung]);
  assert.deepEqual(bare(call(dir, reg, sections)), expected([], 'measured'));
}));

test('a register record failing validation is named in a caveat by its first error', () => inTmp((dir, reg) => {
  const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
  const chained = [null, '0'.repeat(64)].flatMap((prev) => [{ prev }, { prev, hash: sha({ prev }) }]);
  const shapes = [(x) => JSON.stringify(x) + '\n', (x) => JSON.stringify([x]), (x) => JSON.stringify({ version: 1, records: [x] })]
    .concat(['warnings', 'entries', 'disregarded', 'setAsides', 'items'].flatMap((k) =>
      [(x) => JSON.stringify({ [k]: [x] }), (x) => JSON.stringify({ version: 1, [k]: [x] })]));
  for (const shape of shapes) {
    for (const x of [null, 7, 'x', [], {}, ...chained]) {
      writeFileSync(reg, shape(x));
      let r;
      try { r = call(dir, reg, secs('measured', 'measured')); } catch (e) {
        if (/reading 'errors'/.test(e.message)) throw e;
        continue;
      }
      assert.deepEqual(r.items, []);
      assert.deepEqual(r.caveats.filter((c) => c.endsWith('(undefined)')), []);
    }
  }
}));

// Exit code and console output of the disregard record, check and list commands (bin/disregard.mjs main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../disregard.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USAGE = 'usage: disregard.mjs record|check|list (see the header of bin/disregard.mjs)';
const BASE = ['--source', 's', '--code', 'c', '--subject', 'sub', '--why', 'w', '--who', 'me'];

async function run(argv) {
  const out = [];
  const err = [];
  const { log, error } = console;
  console.log = (...a) => { out.push(a.join(' ')); };
  console.error = (...a) => { err.push(a.join(' ')); };
  try {
    return { code: await main(argv), out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function parseDry(out) {
  const [head, ...body] = out[0].split('\n');
  const text = body.join('\n');
  return { head, text, obj: JSON.parse(text) };
}

async function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an unknown or missing command prints the usage line and returns 22', async () => {
  assert.deepEqual(await run(['bogus']), { code: 22, out: [], err: [USAGE] });
  assert.deepEqual(await run([]), { code: 22, out: [], err: [USAGE] });
});

test('without an argv argument the command comes from process.argv after the script path', async () => {
  const saved = process.argv;
  process.argv = [saved[0], saved[1], 'record', '--dry'];
  try {
    const r = await run();
    assert.equal(r.code, 20);
    assert.deepEqual(r.out, []);
    assert.equal(r.err.length, 1);
    assert.match(r.err[0], /^disregard: refusing \u2014 ./);
  } finally {
    process.argv = saved;
  }
});

test('a dry record prints the record it would append with two-space indent and returns 0', async () => {
  const r = await run(['record', '--who', 'first', ...BASE, '--message', 'm', '--dry']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.err, []);
  assert.equal(r.out.length, 1);
  const { head, text, obj } = parseDry(r.out);
  assert.match(head, /^\(dry\) would append to .+:$/);
  assert.equal(text, JSON.stringify(obj, null, 2));
  assert.deepEqual(Object.keys(obj), ['source', 'code', 'subject', 'why', 'who', 'at', 'message', 'key']);
  const { at, key, ...fields } = obj;
  assert.equal(Number.isNaN(Date.parse(at)), false);
  assert.deepEqual(fields, { source: 's', code: 'c', subject: 'sub', why: 'w', who: 'me', message: 'm' });
});

test('a dry record without --message leaves message out, and one missing fields is refused with 20', async () => {
  const r = await run(['record', ...BASE, '--dry']);
  assert.equal(r.code, 0);
  assert.deepEqual(Object.keys(parseDry(r.out).obj), ['source', 'code', 'subject', 'why', 'who', 'at', 'key']);
  const bad = await run(['record', '--source', 's', '--dry']);
  assert.equal(bad.code, 20);
  assert.deepEqual(bad.out, []);
  assert.equal(bad.err.length, 1);
  assert.match(bad.err[0], /^disregard: refusing \u2014 ./);
});

test('check that cannot load its warnings names the problem and returns 22 for usage or 21 for input', async () => {
  await withDir(async (dir) => {
    const obj = join(dir, 'obj.json');
    const nul = join(dir, 'null.json');
    writeFileSync(obj, JSON.stringify({ nope: 1 }));
    writeFileSync(nul, 'null');
    const shape = 'disregard: warnings file is neither an array nor {warnings:[...]}';
    assert.deepEqual(await run(['check']), { code: 22, out: [], err: ['disregard: check needs --warnings <file.json> or --from docs-doctor'] });
    assert.deepEqual(await run(['check', '--from', 'bogus']), { code: 22, out: [], err: ["disregard: unknown --from 'bogus' (known: docs-doctor)"] });
    assert.deepEqual(await run(['check', '--warnings', join(dir, 'missing.json')]), { code: 21, out: [], err: ['disregard: warnings unreadable (ENOENT)'] });
    assert.deepEqual(await run(['check', '--warnings', dir]), { code: 21, out: [], err: ['disregard: warnings unreadable (EISDIR)'] });
    assert.deepEqual(await run(['check', '--warnings', obj]), { code: 21, out: [], err: [shape] });
    assert.deepEqual(await run(['check', '--warnings', nul]), { code: 21, out: [], err: [shape] });
  });
});

test('check with an empty warnings list returns 0 with no rows and zero counts', async () => {
  await withDir(async (dir) => {
    const wrapped = join(dir, 'wrapped.json');
    const bare = join(dir, 'bare.json');
    writeFileSync(wrapped, JSON.stringify({ warnings: [] }));
    writeFileSync(bare, '[]');
    const j = await run(['check', '--warnings', wrapped, '--json']);
    assert.equal(j.code, 0);
    assert.deepEqual(j.err, []);
    const doc = JSON.parse(j.out[0]);
    assert.deepEqual(doc.rows, []);
    assert.deepEqual([doc.counts.fresh, doc.counts.returned, doc.counts['set-aside'], doc.counts.unidentified], [0, 0, 0, 0]);
    const want = ['', '0 fresh, 0 returned, 0 set-aside, 0 unidentified'];
    if (doc.quiet.length) want.push(`${doc.quiet.length} set-aside warning(s) not seen in this batch (\`list\` names them)`);
    if (doc.invalid.length) want.push(`${doc.invalid.length} register record(s) failed validation and were NOT applied: ${doc.invalid.map((i) => i.errors[0]).join(' | ')}`);
    assert.deepEqual(await run(['check', '--warnings', bare]), { code: 0, out: [want.join('\n')], err: [] });
  });
});

test('list --json reports the register path, set-asides, returns and invalid records and returns 0', async () => {
  const dry = await run(['record', ...BASE, '--dry']);
  const r = await run(['list', '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.err, []);
  assert.equal(r.out.length, 1);
  const doc = JSON.parse(r.out[0]);
  assert.deepEqual(Object.keys(doc).filter((k) => k !== 'absent'), ['register', 'disregarded', 'returned', 'invalid']);
  assert.equal(parseDry(dry.out).head, `(dry) would append to ${doc.register}:`);
});

test('list without --json prints each set-aside with its returns and returns 0', async () => {
  const doc = JSON.parse((await run(['list', '--json'])).out[0]);
  const want = doc.absent ? [`no register at ${doc.register} \u2014 nothing has been set aside`] : [];
  for (const q of doc.disregarded) {
    want.push(`${q.key}\n  set aside ${q.at} by ${q.who}: ${q.why}`);
    for (const b of doc.returned.filter((x) => x.key === q.key)) {
      want.push(`  RETURNED ${b.seenAt} after the set-aside of ${b.setAsideAt} (recorded ${b.recordedAt} by ${b.via})`);
    }
  }
  if (doc.invalid.length) want.push(`${doc.invalid.length} invalid record(s), not applied`);
  assert.deepEqual(await run(['list']), { code: 0, out: want, err: [] });
});

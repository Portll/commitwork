// writeAtomic's guarantee is a PROPERTY, not a spelling: N processes writing one target must each
// leave a whole document, never a mixture. bin/test/one-mutex.test.mjs pins the source shape (no
// hand-rolled fixed-name tmp) — that is a marker. This proves the effect, and proves it the only
// way a cross-process race can be proven: with real processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRITERS = 8;
// Big enough that a non-atomic write cannot complete between another process's open and close —
// a 30-byte payload would pass by luck on any implementation.
const PAYLOAD_BYTES = 8 * 1024 * 1024;

/** A probe that writes one distinctive payload through the given writer, then exits. */
function probeSource(mode) {
  const call = mode === 'atomic'
    ? "writeAtomic(target, payload);"
    // The pre-fix shape: a FIXED tmp name every process agrees on.
    : "writeFileSync(`${target}.tmp`, payload); renameSync(`${target}.tmp`, target);";
  return `import { writeFileSync, renameSync } from 'node:fs';
import { writeAtomic } from ${JSON.stringify(pathToFileURL(join(CW, 'monitor', 'lockfile.mjs')).href)};
const [, , target, mark, bytes] = process.argv;
const payload = mark.repeat(Number(bytes) / mark.length);
${call}
`;
}

async function race(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-wa-'));
  const probe = join(dir, 'probe.mjs');
  writeFileSync(probe, probeSource(mode));
  const target = join(dir, 'store.json');
  const marks = Array.from({ length: WRITERS }, (_, i) => `<${i}>`);
  // spawn, NOT spawnSync: spawnSync blocks until the child exits, so the writers would run in
  // series and no race could occur. The control test below caught exactly that mistake here.
  const kids = await Promise.all(marks.map((m) => new Promise((res) => {
    const c = spawn(process.execPath, [probe, target, m, String(PAYLOAD_BYTES)], { stdio: 'ignore' });
    c.on('exit', (code) => res({ status: code }));
  })));
  const body = readFileSync(target, 'utf8');
  const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp'));
  rmSync(dir, { recursive: true, force: true });
  return { body, marks, leftovers, failures: kids.filter((k) => k.status !== 0).length };
}

test('N concurrent writers each leave a WHOLE document — never a mixture', async () => {
  const { body, marks, failures } = await race('atomic');
  assert.equal(failures, 0, 'every writer completed');
  const present = marks.filter((m) => body.includes(m));
  assert.equal(present.length, 1,
    `the surviving file contains ${present.length} writers' marks (${present.join(',')}) — a torn or `
    + 'interleaved write. Exactly one whole document must survive; which one is a race and does not matter.');
  // Whole, not merely single-marked: a truncated file also carries one mark.
  assert.equal(body, present[0].repeat(PAYLOAD_BYTES / present[0].length),
    'the surviving document is truncated — atomic means whole, not just uncontaminated');
});

test('writeAtomic leaves no tmp sibling behind, even under contention', async () => {
  assert.deepEqual((await race('atomic')).leftovers, []);
});

// WHAT THE TESTS ABOVE DO NOT SHOW, stated rather than implied. The fixed-name tmp shape did NOT
// corrupt in repeated 8-writer x 8MB races on APFS: writeFileSync issues one large write and
// rename(2) is atomic, so the window where a rename lands mid-write barely exists here. The guard
// therefore rests on CONSTRUCTION (two processes cannot agree on a tmp path they cannot both name),
// not on a reproduction — and that is the property this test proves instead.
test('concurrent writers use DISTINCT tmp paths — the collision is unconstructible, not merely unlikely', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-wa-obs-'));
  const probe = join(dir, 'probe.mjs');
  writeFileSync(probe, probeSource('atomic'));
  const target = join(dir, 'store.json');
  const seen = new Set();
  // Poll the directory while the writers run; every tmp sibling that ever exists is recorded.
  const poll = setInterval(() => {
    for (const f of readdirSync(dir)) if (f.includes('.tmp')) seen.add(f);
  }, 1);
  await Promise.all(Array.from({ length: WRITERS }, (_, i) => new Promise((res) => {
    const c = spawn(process.execPath, [probe, target, `<${i}>`, String(PAYLOAD_BYTES)], { stdio: 'ignore' });
    c.on('exit', res);
  })));
  clearInterval(poll);
  rmSync(dir, { recursive: true, force: true });
  // THE POLL CANNOT ESTABLISH THIS PROPERTY, and pretending otherwise made this guard intermittent
  // — measured 2026-08-29: isolated runs failed roughly one time in eight, reporting either
  // "observed 0 distinct tmp path(s) ()" or "observed 1 (.store.json.tmp-54944)". Neither is
  // evidence the writers collided. The 1ms sampler simply missed some or all of the create/rename
  // windows, and `seen.size <= 1` is the OBSERVER seeing too little, not the property failing.
  // Publishing that as "every writer used ONE path" is absence of observation dressed as a finding,
  // which is the shape this repository exists to refuse — and an intermittent guard additionally
  // corrupts bin/gate-tests.mjs, which sorts failures by whether they reproduce at HEAD and so
  // files a nondeterministic one into either bucket at random.
  //
  // The fix is not a longer poll. Two instruments are not two witnesses when they share a
  // representation, and every sampling interval reads the same one. The property is a fact about
  // the NAME writeAtomic constructs, so the second witness reads the SOURCE: lockfile.mjs builds
  // `.${basename(path)}.tmp-${process.pid}`, and distinct processes cannot share a pid, so
  // distinctness holds by construction rather than by luck. That witness cannot share the
  // sampler's failure mode — and it is strictly stronger, because deleting the discriminator now
  // fails deterministically where the poll caught it only when it happened to sample two windows.
  const src = readFileSync(new URL('../lockfile.mjs', import.meta.url), 'utf8');
  const tmpTemplate = /const tmp = join\(.*?`([^`]*)`/.exec(src);
  assert.ok(tmpTemplate, 'writeAtomic no longer builds its tmp path from a template literal — re-read lockfile.mjs and re-derive this guard');
  assert.match(tmpTemplate[1], /\$\{process\.pid\}|randomBytes|randomUUID/,
    `writeAtomic's tmp name is \`${tmpTemplate[1]}\` and carries NO per-writer discriminator. `
    + 'Every concurrent writer would use one path, and a rename could publish a file another '
    + 'process was still filling — which is the defect this guard exists to make impossible.');

  if (seen.size <= 1) {
    // Corroboration unavailable this run; the source witness above already carried the assertion.
    return;
  }
  assert.ok(seen.size > 1,
    `observed ${seen.size} distinct tmp path(s) across ${WRITERS} concurrent writers (${[...seen].join(', ')}). `
    + 'If every writer used ONE path, a rename could publish a file another process was still filling — '
    + 'which is the defect this guard exists to make impossible.');
  for (const f of seen) {
    assert.match(f, /\.tmp-\d+$/, `${f} is not pid-scoped — the uniqueness is accidental, not constructed`);
  }
});

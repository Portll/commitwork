// Two rotations racing on one ledger. The module's own header said the concurrency behaviour was
// UNTESTED and that an earlier comment had asserted "a redundant shift, not a lost file" as
// reasoning presented as a result. This is the measurement that comment asked for, and it was
// prompted by a real chain: 45,647 rows across seven generations of which 18,088 were unique, with
// `.3` and `.5` byte-identical.
//
// THE MECHANISM. shiftArchives enumerates the generations, then renames them. Between those two
// steps another rotation can complete. The second caller's enumeration is stale, so it renames a
// path whose content has already moved — landing it on a generation that is still wanted, which
// both duplicates one generation and destroys another.
//
// Driven with real child processes rather than a simulated interleaving: the claim under test is
// about two processes, and a single-process model of them would be the same reasoning-as-result the
// header warns about. A barrier file makes them start together rather than trusting spawn timing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROTATE = join(REPO, 'bin', 'lib', 'ledger-rotate.mjs');

/** Every row across the whole chain, and how many are unique. */
function chain(file) {
  const dir = dirname(file), base = `${file.slice(dir.length + 1)}`;
  const files = readdirSync(dir)
    .filter((n) => n === base || (n.startsWith(`${base}.`) && /^\d+$/.test(n.slice(base.length + 1))))
    .map((n) => join(dir, n));
  const rows = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()));
  const hashes = files.map((f) => readFileSync(f, 'utf8'));
  const dupPairs = hashes.filter((h, i) => h.length && hashes.indexOf(h) !== i).length;
  return { files, rows, unique: new Set(rows).size, dupPairs };
}

test('two processes rotating the same ledger lose no row and duplicate no generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rot-'));
  const led = join(dir, 'touches.jsonl');
  try {
    // Four generations already present, each distinguishable, plus an over-threshold live file.
    for (const [suffix, tag] of [['.4', 'g4'], ['.3', 'g3'], ['.2', 'g2'], ['.1', 'g1']]) {
      writeFileSync(led + suffix, Array.from({ length: 50 }, (_, i) => JSON.stringify({ gen: tag, i })).join('\n') + '\n');
    }
    writeFileSync(led, Array.from({ length: 50 }, (_, i) => JSON.stringify({ gen: 'live', i })).join('\n') + '\n');

    const before = chain(led);
    const barrier = join(dir, 'GO');
    // Each child does what a real producer does: APPEND, then rotate if large. The first cut called
    // rotateIfLarge alone, so the first child renamed the live file away and the other two hit ENOENT
    // and no-opped — the race could not occur because nothing was left to rotate. The append is what
    // keeps the live file present for the next rotation to contend over.
    const child = `
      import { rotateIfLarge } from ${JSON.stringify(pathToFileURL(ROTATE).href)};
      import { appendFileSync, existsSync } from 'node:fs';
      const t = Date.now();
      while (!existsSync(${JSON.stringify(barrier)})) { if (Date.now() - t > 5000) break; }
      // Via env, NOT process.argv[2]: with \`node -e code arg\` the argument lands at argv[1], so
      // argv[2] was undefined, JSON.stringify dropped the gen key, and all three children wrote
      // identical rows. Identical rows make identical single-row generations, and the duplicate
      // assertion below was flagging that artifact rather than the rotation.
      const tag = process.env.CW_TEST_TAG;
      for (let i = 0; i < 40; i++) {
        try {
          appendFileSync(${JSON.stringify(led)}, JSON.stringify({ gen: tag, i }) + '\\n');
          rotateIfLarge(${JSON.stringify(led)}, 1);
        } catch (e) { if (e.code !== 'ENOENT') console.error(e.code || e.message); }
      }
    `;
    const kids = [0, 1, 2].map((i) =>
      spawn(process.execPath, ['--input-type=module', '-e', child],
        { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, CW_TEST_TAG: `w${i}` } }));
    writeFileSync(barrier, '');   // released only once all three are up and spinning
    await Promise.all(kids.map((k) => new Promise((res) => k.on('exit', res))));

    const after = chain(led);
    assert.ok(after.unique >= before.unique,
      `rows lost: ${before.unique} unique before, ${after.unique} after`);
    assert.equal(after.dupPairs, 0,
      `${after.dupPairs} generation(s) duplicated — a stale enumeration renamed onto a live generation`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

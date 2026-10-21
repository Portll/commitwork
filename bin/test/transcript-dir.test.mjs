// bin/lib/transcript-dir.mjs — the transcript directory is DERIVED, and the override is read at
// call time. Both directions of each judgement: the override takes effect, and its absence is
// reported as a missing input rather than as an empty directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { projectSlug, transcriptRoot, transcriptDir, missingTranscriptDir } from '../lib/transcript-dir.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEYS = ['CW_TRANSCRIPT_DIR', 'CW_TRANSCRIPT_ROOT'];
function clean(fn) {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  try { return fn(); } finally { for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}

// The literal this module replaced. Asserting the derivation reproduces it is what makes "the
// operator's behaviour is unchanged" a checked fact rather than a claim in a commit message.
test('the derivation reproduces the slug that was hard-coded, for the path it was hard-coded for', () => {
  assert.equal(projectSlug('/Users/someone/Repositories/Acme/commitwork'), '-Users-someone-Repositories-Acme-commitwork');
  assert.equal(projectSlug('/srv/public/commit_work.v2'), '-srv-public-commit-work-v2', 'dots and underscores are not alphanumeric');
});

test('with nothing set, the directory is this checkout\'s own under the harness root', () => {
  clean(() => {
    assert.equal(transcriptRoot(), join(homedir(), '.claude', 'projects'));
    assert.equal(transcriptDir(), join(homedir(), '.claude', 'projects', projectSlug(REPO)));
    assert.notEqual(transcriptDir('/elsewhere/commitwork'), transcriptDir(), 'the slug follows the checkout, not the module');
  });
});

test('both overrides are read at CALL time, and CW_TRANSCRIPT_DIR wins outright', () => {
  clean(() => {
    process.env.CW_TRANSCRIPT_ROOT = '/tmp/root-x';
    assert.equal(transcriptDir('/a/b'), '/tmp/root-x/-a-b');
    process.env.CW_TRANSCRIPT_DIR = '/tmp/exact';
    assert.equal(transcriptDir('/a/b'), '/tmp/exact', 'the named directory is not re-slugged');
  });
});

test('an absent directory is a NAMED missing input, and the name differs by how it was chosen', () => {
  clean(() => {
    assert.match(missingTranscriptDir('/tmp/nope'), /^missing input: no transcript directory at \/tmp\/nope — set CW_TRANSCRIPT_DIR/);
    process.env.CW_TRANSCRIPT_DIR = '/tmp/nope';
    assert.match(missingTranscriptDir('/tmp/nope'), /\(CW_TRANSCRIPT_DIR\)$/,
      'when the operator named the directory, the message must not tell them to name it');
  });
});

test('session-title resolves the directory through this module, not a slug of its own', async () => {
  const { transcriptDir: fromSessionTitle } = await import('../session-title.mjs');
  assert.equal(fromSessionTitle, transcriptDir, 'two resolvers for one directory can disagree; one cannot');
});

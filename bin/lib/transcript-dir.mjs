// Where the harness writes THIS checkout's session transcripts.
//
// The slug is DERIVED from the checkout's absolute path rather than spelled out. The literal that
// stood in bin/turn-gate.mjs and admin/routes/turns.mjs named one operator's home directory, so
// every other checkout — a worktree, a second clone, a public clone, any other machine — read a
// directory that does not exist, and an empty transcript directory reads exactly like a quiet fleet.
// A derived slug is wrong in the loud direction instead: it names the checkout you are actually in.

import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The harness's project-directory name for a checkout path: non-alphanumerics become '-'. */
export const projectSlug = (dir) => String(dir).replace(/[^A-Za-z0-9]/g, '-');

/** The tree the per-project transcript directories live in. CW_TRANSCRIPT_ROOT, read at call time. */
export const transcriptRoot = () => process.env.CW_TRANSCRIPT_ROOT || join(homedir(), '.claude', 'projects');

/**
 * This checkout's transcript directory. CW_TRANSCRIPT_DIR names it outright and wins; otherwise it
 * is the harness's own layout for `repo`. Env read at CALL time — a const at import defeats any
 * test that sets the override afterwards, and the test then passes while proving nothing.
 */
export const transcriptDir = (repo = REPO) => process.env.CW_TRANSCRIPT_DIR || join(transcriptRoot(), projectSlug(repo));

/** The sentence a caller prints when the directory is not there: it names the input, not just the path. */
export const missingTranscriptDir = (dir = transcriptDir()) => `missing input: no transcript directory at ${dir}`
  + `${process.env.CW_TRANSCRIPT_DIR ? ' (CW_TRANSCRIPT_DIR)' : ' — set CW_TRANSCRIPT_DIR to the harness directory for this checkout'}`;

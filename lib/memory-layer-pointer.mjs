// lib/memory-layer-pointer.mjs — write a LOCATOR to the memory layer, never a copy.
//
// The layer summarises long records to their first 50 words (memory-layer edfb43f fixes the default, but a
// deployed older binary still does it, and deploying is a human act). A document therefore cannot
// be stored there durably. A pointer to where the document actually lives can — provided it is
// written FOR the truncation rather than in spite of it.
//
// The rule this module enforces: everything needed to FIND the content sits in the first 50 words.
// A locator that survives is worth more than a copy that does not.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { scannedGitOut } from '../bin/lib/git-env.mjs';
import { basename, relative } from 'node:path';

/** The summariser's budget. memory-layer: create_summary(content, 50) -> first 50 whitespace-split words. */
export const SUMMARY_WORD_BUDGET = 50;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const git = (repo, ...args) => {
  try {
    return scannedGitOut(repo, args).trim();
  } catch { return ''; }
};

/**
 * Describe one file as a locator line. Reads the file — a pointer to something unreadable is
 * worse than no pointer, so ENOENT propagates rather than yielding a plausible row.
 */
export function describeFile(repo, path) {
  const buf = readFileSync(path);
  return {
    path: relative(repo, path) || basename(path),
    bytes: buf.length,
    sha256: sha256(buf),
    mtime: statSync(path).mtime.toISOString(),
  };
}

/**
 * Build a pointer record whose first SUMMARY_WORD_BUDGET words carry repo, commit and file count.
 *
 * `verify` reports whether the locator actually survives summarisation, as a MEASURED fact rather
 * than a promise — it is the same question the caller would otherwise assume the answer to.
 */
export function buildPointerRecord({ repo, files, label, externalId, remote = null }) {
  if (!repo) throw new Error('buildPointerRecord: repo is required — a locator without a repository locates nothing');
  if (!Array.isArray(files) || !files.length) throw new Error('buildPointerRecord: at least one file is required');

  const described = files.map((f) => describeFile(repo, f));
  const commit = git(repo, 'rev-parse', 'HEAD');
  const origin = remote || git(repo, 'remote', 'get-url', 'origin');
  const onRemote = commit ? git(repo, 'branch', '-r', '--contains', commit) !== '' : false;
  const totalBytes = described.reduce((n, d) => n + d.bytes, 0);

  // Locator FIRST. Everything after the budget is elaboration a reader can live without.
  const head =
    `POINTER not content. ${described.length} file(s), ${totalBytes} bytes, in repo ${origin || repo} ` +
    `at commit ${commit || 'UNKNOWN'} ${onRemote ? '(pushed)' : '(LOCAL ONLY - not on any remote)'}. ` +
    `Paths: ${described.map((d) => d.path).join(' ')}.`;

  const body = [
    head,
    '',
    `Label: ${label || '(none)'}`,
    '',
    'The memory layer summarises long records to their first 50 words, so this record deliberately',
    'holds no content. Read the files at the paths above. Verify each against its digest:',
    '',
    ...described.map((d) => `  ${d.path}  ${d.bytes} B  sha256:${d.sha256}  mtime:${d.mtime}`),
    '',
    onRemote
      ? 'The commit is on a remote, so a fresh clone resolves these paths.'
      : 'WARNING: the commit is NOT on any remote. These paths resolve on one machine only.',
  ].join('\n');

  const words = body.split(/\s+/).filter(Boolean);
  const surviving = words.slice(0, SUMMARY_WORD_BUDGET).join(' ');

  // Two directions, as everywhere else here: what survives, and what is lost by surviving.
  const verify = {
    budget: SUMMARY_WORD_BUDGET,
    totalWords: words.length,
    survives: {
      repo: surviving.includes(origin || repo),
      commit: !commit || surviving.includes(commit.slice(0, 7)),
      // Every path must be findable, not just the first — a partial locator points at a subset
      // while reading like a complete index.
      paths: described.every((d) => surviving.includes(d.path)),
    },
    // Digests are elaboration by design: they VERIFY content once found, they do not FIND it.
    // Losing them to the summariser costs integrity checking, not retrievability.
    lostToSummary: words.length > SUMMARY_WORD_BUDGET,
  };
  verify.locatorSurvives = verify.survives.repo && verify.survives.commit && verify.survives.paths;

  return {
    record: {
      external_id: externalId,
      content: body,
      memory_type: 'Context',
      tags: ['pointer', 'handoff-locator', ...(commit ? [`commit:${commit.slice(0, 12)}`] : [])],
    },
    files: described,
    commit,
    origin,
    onRemote,
    verify,
  };
}

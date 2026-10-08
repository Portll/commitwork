#!/usr/bin/env node
// usage: releases-atom.mjs [--out <path>] [--pattern <glob>] [--limit <n>] [--self <url>] [--json]
// exit: 0 wrote a feed (including a feed with no releases) · 2 could not read the tags (fail closed)
// env, read at call time: CW_NOW, CW_RELEASES_OUT, CW_RELEASES_SELF, CW_RELEASES_PATTERN, CW_REPO_ROOT
// output: Atom 1.0, newest entry first, written tmp+rename
//
// writes: one repository's feed, never an aggregate
// pins: a release is a `v*` tag; the retired 0.<count> series is outside the population
// pins: entry id is tag and sha, never position
// guard: tag messages are untrusted input
// guard: an empty feed names the pattern it read, so "no releases" cannot read as "no tags"

import { writeAtomic as writeFileAtomic } from '../monitor/lockfile.mjs';
import { nowISO } from '../lib/clock.mjs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { webRoot, missingWebRoot } from '../lib/web-root.mjs';

const REPO = () => process.env.CW_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
// fact: commitwork.portll.net is auth-gated, unreadable anonymously
const selfUrl = () => process.env.CW_RELEASES_SELF || 'https://we.commitwork.online/releases.atom';

// fact: a release is `v` + the version package.json carried at that commit / reading all of refs/tags published 0.1108, a commit count a rebase renumbers, as a release (expiry: never, prev: drifted)
export const DEFAULT_PATTERN = 'v*';
export const releasePattern = () => process.env.CW_RELEASES_PATTERN || DEFAULT_PATTERN;

// pins: a urn id, stable across hosts
export const writeAtomic = (path, body) => writeFileAtomic(path, body, { mkdir: true });

export const FEED_ID = 'urn:portll:commitwork:releases';

// pins: the sentinel keeps untagged output byte-stable
export const NO_RELEASE_UPDATED = '1970-01-01T00:00:00Z';

// guard: pattern stays inside refs/tags
export const isSafePattern = (p) => p === null || p === undefined
  || (typeof p === 'string' && p.length > 0 && !p.includes('/') && !p.includes('..'));

export const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// fact: control characters are illegal in XML 1.0
const stripIllegalXml = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const clean = (s) => xmlEscape(stripIllegalXml(s));

/**
 * @returns {{tag:string, sha:string, date:string, subject:string}[]} newest first
 * @throws when git cannot be run / [] means no tags
 */
export function readTags({ cwd = REPO(), pattern } = {}) {
  if (!isSafePattern(pattern)) throw new Error(`unsafe tag pattern ${JSON.stringify(pattern)} -- a pattern may not contain / or ..`);
  const p = pattern ?? releasePattern();
  const args = ['for-each-ref', '--sort=-creatordate',
    '--format=%(refname:short)%09%(objectname)%09%(creatordate:iso-strict)%09%(contents:subject)'];
  args.push(p ? `refs/tags/${p}` : 'refs/tags');
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000 });
  if (r.error) throw new Error(`git could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git exited ${r.status}: ${String(r.stderr || '').trim().slice(0, 200)}`);
  return String(r.stdout || '').split('\n').filter(Boolean).map((line) => {
    const [tag, sha, date, ...rest] = line.split('\t');
    return { tag, sha, date, subject: rest.join('\t') || tag };
  }).filter((t) => t.tag && t.sha);
}

// guard: a capped feed never reads as short
export function buildFeed({ tags, now = nowISO(), self = selfUrl(), limit = 0, pattern = null }) {
  const total = tags.length;
  const shown = limit > 0 ? tags.slice(0, limit) : tags;
  const dropped = total - shown.length;

  const read = pattern ? ` No tag matches ${pattern}.` : '';
  const subtitle = total === 0
    ? `No releases are tagged in this repository yet.${read} This feed is current and deliberately empty.`
    : dropped > 0
      ? `${shown.length} of ${total} releases shown; ${dropped} older entries omitted by --limit.`
      : `${total} release${total === 1 ? '' : 's'}.`;

  const updated = shown.length ? shown[0].date : NO_RELEASE_UPDATED;

  const entries = shown.map((t) => [
    '  <entry>',
    `    <title>${clean(t.tag)}</title>`,
    `    <id>urn:portll:commitwork:release:${clean(t.tag)}:${clean(t.sha)}</id>`,
    `    <updated>${clean(t.date)}</updated>`,
    `    <content type="text">${clean(t.subject)}</content>`,
    '  </entry>',
  ].join('\n')).join('\n');

  // fix: a filter(Boolean) also drops the final newline
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>commitwork releases</title>',
    `  <id>${FEED_ID}</id>`,
    `  <link rel="self" href="${clean(self)}"/>`,
    `  <subtitle>${clean(subtitle)}</subtitle>`,
    `  <updated>${clean(updated)}</updated>`,
  ];
  if (entries) lines.push(entries);
  lines.push('</feed>', '');
  return lines.join('\n');
}

function main(argv) {
  const flag = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  // writes: we/public in the commitwork-web repository, the served root
  const explicit = flag('--out', process.env.CW_RELEASES_OUT || null);
  const missing = explicit ? null : missingWebRoot();
  if (missing) { console.error(`releases-atom: ${missing} -- no feed written`); process.exit(2); }
  const out = explicit || join(webRoot(), 'releases.atom');
  const limit = Number(flag('--limit', '0')) || 0;

  const pattern = flag('--pattern', releasePattern());

  let tags;
  try {
    tags = readTags({ pattern });
  } catch (e) {
    console.error(`releases-atom: ${e.message} -- the release set is UNKNOWN, not empty; no feed written`);
    process.exit(2);
  }

  const body = buildFeed({ tags, self: flag('--self', selfUrl()), limit, pattern });
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ releases: tags.length, written: out, limit, pattern }, null, 2));
  }
  writeAtomic(out, body);
  console.log(`releases-atom: ${tags.length} release(s) matching ${pattern} -> ${out}`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));

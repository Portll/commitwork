// admin/lib/panel-build.mjs — what the running panel was built from: package version and the commit
// checked out when it booted. Read once at boot from files, never by spawning git: a booting panel
// spawns nothing (admin/test/panel-preflight-boot.test.mjs). It describes this process, not the
// tree as it is now.

import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const read = (p) => readFileSync(p, 'utf8').trim();

// A worktree's .git is a file naming its gitdir; its refs live in the common dir.
function gitDirs(root) {
  const dot = join(root, '.git');
  const gd = statSync(dot).isFile() ? resolve(root, read(dot).replace(/^gitdir:\s*/, '')) : dot;
  let common = gd;
  try { common = resolve(gd, read(join(gd, 'commondir'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { gd, common };
}

function headOf(root) {
  const { gd, common } = gitDirs(root);
  const head = read(join(gd, 'HEAD'));
  if (!head.startsWith('ref: ')) return { commit: head, branch: null };
  const ref = head.slice(5), branch = ref.replace(/^refs\/heads\//, '');
  for (const d of [gd, common]) {
    try { return { commit: read(join(d, ref)), branch }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  let refs = '';
  try { refs = read(join(common, 'packed-refs')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const packed = refs.split('\n').find((l) => l.endsWith(` ${ref}`));
  if (!packed) throw new Error(`${ref} is in neither the loose nor the packed refs`);
  return { commit: packed.split(' ')[0], branch };
}

export function readBuild(root, bootAt) {
  let version = null;
  try { version = JSON.parse(read(join(root, 'package.json'))).version || null; }
  catch { /* unreadable stays null and is shown as unknown */ }
  try { statSync(join(root, '.git')); }
  catch (e) {
    if (e.code === 'ENOENT') return { version, bootAt, checkout: false };
    return { version, bootAt, checkout: true, commit: null, reason: e.message };
  }
  try {
    const { commit, branch } = headOf(root);
    return { version, bootAt, checkout: true, commit, short: commit.slice(0, 8), branch };
  } catch (e) { return { version, bootAt, checkout: true, commit: null, reason: e.message }; }
}

// bin/lib/cargo-target.mjs — the build folder a sweep's cargo lanes write to.
//
// The machine-wide cargo target-dir (~/.cargo/config.toml -> ~/.cargo-target-drive) is shared by
// every Rust build on this box. A sweep lane that type-checks or tests a repository there writes
// artifacts beside the developer's own builds of the same crates, and cargo accepts whichever set
// it finds fresh: on 2026-09-27 a session ran stale ironwork test binaries another build had left
// in that folder. So each sweep lane gets a folder of its own per repository, keyed on the
// repository's real path, so two checkouts that share a name never share a folder.
//
// CARGO_TARGET_DIR keeps the UNRESOLVED path on purpose. ~/.cargo-target-drive is a symlink onto a
// volume whose name has a space, and jemalloc's configure refuses a prefix containing one; the
// symlink is how the operator's config avoids it. Only the sandbox write allowance, which is
// matched against resolved paths, uses the real path.
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

export const usesCargo = (check) => ((check && check.requires && check.requires.tools) || [])
  .some((t) => t === 'cargo' || String(t).startsWith('cargo-'));

export const sweepCargoRoot = (env = process.env) =>
  env.CW_CARGO_TARGET_ROOT || join(homedir(), '.cargo-target-drive', 'commitwork-sweep');

export function sweepCargoTargetDir(repoPath, env = process.env) {
  const r = real(repoPath);
  const name = basename(r).replace(/[^A-Za-z0-9._-]/g, '_') || 'repo';
  return join(sweepCargoRoot(env), `${name}-${createHash('sha256').update(r).digest('hex').slice(0, 10)}`);
}

/**
 * What a lane needs to build Rust in its own folder: { env, writes } with the folder created, or
 * { refused } when it cannot be. An unmounted drive is a lane that did not run, never a build that
 * quietly lands in the shared target-dir instead.
 */
export function cargoLaneEnv(check, repoPath, env = process.env) {
  if (!usesCargo(check)) return { env: {}, writes: [] };
  const dir = sweepCargoTargetDir(repoPath, env);
  try { mkdirSync(dir, { recursive: true }); }
  catch (e) {
    return { refused: `the sweep's cargo target folder ${dir} could not be created (${e.code || e.message}); the lane did not run rather than build into the shared target-dir` };
  }
  const resolved = real(dir);
  return { env: { CARGO_TARGET_DIR: dir }, writes: [...new Set([dir, resolved])] };
}

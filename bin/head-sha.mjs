// bin/head-sha.mjs — the commit a gate measured; the one git-shelling helper shared by gates.
// null = "I do not know which tree this was"; callers write it through, never a placeholder.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The commit this process is measuring, or null if that cannot be established.
 * CW_HEAD_SHA overrides — read at call time, never at import; blank/whitespace = unset.
 * @param {string} [cwd] tree to ask about; defaults to the repository root.
 * @returns {string|null} full 40-char sha, or null when there is no resolvable HEAD.
 */
export function headSha(cwd) {
  const override = process.env.CW_HEAD_SHA;
  if (typeof override === 'string' && override.trim()) return override.trim();
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: cwd || REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    // Shape-check: anything not 40 hex chars is not a checkout-able sha
    return /^[0-9a-f]{40}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

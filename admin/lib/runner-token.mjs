// The substrate runner's operator token. Every POST to its operator socket needs
// `Authorization: Bearer <token>` (substrate server/runner/token.mjs); the token is a 0600 file
// the runner mints at boot. Paths are read at call time.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** CW_SUBSTRATE_TOKEN_FILE, then substrate's own SUBSTRATE_RUNNER_TOKEN_FILE, then its default. */
export const runnerTokenFile = () => process.env.CW_SUBSTRATE_TOKEN_FILE
  || process.env.SUBSTRATE_RUNNER_TOKEN_FILE
  || join(homedir(), '.substrate', 'runner-token');

/**
 * Headers for an operator-socket POST: {ok:true, headers} or {ok:false, why}. An unreadable token
 * is a stated refusal, never a tokenless request.
 */
export function runnerPostHeaders() {
  const file = runnerTokenFile();
  let token;
  try { token = readFileSync(file, 'utf8').trim(); } catch (e) {
    return { ok: false, why: `runner token unreadable at ${file} (${e.code || e.message}) — start the substrate runner once to mint it, or set CW_SUBSTRATE_TOKEN_FILE` };
  }
  if (!/^\S+$/.test(token)) return { ok: false, why: `runner token at ${file} is empty or malformed` };
  return {
    ok: true,
    headers: { 'content-type': 'application/json', 'x-substrate-dispatch': '1', authorization: `Bearer ${token}` },
  };
}

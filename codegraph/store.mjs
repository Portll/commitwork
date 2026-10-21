// Store paths for codegraph/. The fail-closed IO itself is flow/store.mjs's — imported, not copied.
//
// `readJson` there already draws the only line that matters: ENOENT is absent, everything else is a
// REFUSAL. Re-deriving that here would give this repository two answers to "is an unreadable store
// an empty one", and the second one is always the wrong one.

import { join, resolve } from 'node:path';

export { readJson, writeJson, now } from '../flow/store.mjs';

export const SCHEMA_VERSION = 1;

// env read at CALL time — a module-load const defeats every test that sets the override afterwards
export function storeDir(env = process.env) {
  return resolve(env.CW_CODEGRAPH_STORE || 'reports/codegraph');
}

export function storePath(name, env = process.env) {
  return join(storeDir(env), name);
}

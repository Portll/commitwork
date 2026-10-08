// Store paths and fail-closed IO for flow/.
//
// Deliberately contains NO extraction logic. flow/runtime.mjs — the second witness — imports
// nothing from flow/ at all, and flow/test/independence.test.mjs enforces that; this module exists
// so the other four components share a store reader, not so C2 can borrow one.

import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const SCHEMA_VERSION = 1;

// env read at CALL time — a module-load const defeats every test that sets the override afterwards
export function storeDir(env = process.env) {
  return resolve(env.CW_HARNESS_STORE || 'reports/harness');
}

export function storePath(name, env = process.env) {
  return join(storeDir(env), name);
}

export function now(env = process.env) {
  return env.CW_NOW ? new Date(env.CW_NOW).toISOString() : new Date().toISOString();
}

/**
 * -> { state: 'present'|'absent', data }
 *
 * Only ENOENT is absent. A permission error or a truncated file is a REFUSAL: an empty store and an
 * unreadable one are the same shape downstream and the difference is the whole finding.
 */
export function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent', data: null };
    const err = new Error(`flow store unreadable ${path}: ${e.code || e.message}`);
    err.code = 'CW_FLOW_STORE_UNREADABLE';
    throw err;
  }
  try {
    return { state: 'present', data: JSON.parse(raw) };
  } catch (e) {
    const err = new Error(`flow store corrupt ${path}: ${e.message}`);
    err.code = 'CW_FLOW_STORE_CORRUPT';
    throw err;
  }
}

// tmp+rename; pid-suffixed because several sessions run this tree at once
export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}

/** -> ISO mtime, or null when the path is absent. Any OTHER error throws. */
export function mtimeOf(path) {
  try {
    return new Date(statSync(path).mtimeMs).toISOString();
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    const err = new Error(`flow cannot stat ${path}: ${e.code || e.message}`);
    err.code = 'CW_FLOW_STAT_FAILED';
    throw err;
  }
}

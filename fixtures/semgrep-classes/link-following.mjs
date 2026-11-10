// Annotated fixture for manifests/semgrep-classes/link-following.yaml (JavaScript rule).
import fs, { statSync, lstatSync, readdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export function listAll(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // ruleid: cw-walk-follows-dir-links-js
      listAll(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

export function listAllHeld(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      // ruleid: cw-walk-follows-dir-links-js
      listAllHeld(p, out);
    } else out.push(p);
  }
  return out;
}

export async function listAsync(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) {
      // ruleid: cw-walk-follows-dir-links-js
      await listAsync(p, out);
    }
  }
  return out;
}

export function listTolerant(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    // ruleid: cw-walk-follows-dir-links-js
    if (st.isDirectory()) { listTolerant(p, out); continue; }
    out.push(p);
  }
  return out;
}

export function listNoFollow(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (lstatSync(p).isDirectory()) {
      // ok: cw-walk-follows-dir-links-js
      listNoFollow(p, out);
    }
  }
  return out;
}

export function listDirents(dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      // ok: cw-walk-follows-dir-links-js
      listDirents(join(dir, d.name), out);
    }
  }
  return out;
}

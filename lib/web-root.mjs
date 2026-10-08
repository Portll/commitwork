// The we.commitwork.online pages live in the private Portll/commitwork-web repository, checked out
// beside this one. Read at call time; an absent site is a missing input, never an empty one.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The served public/ directory of we.commitwork.online. */
export const webRoot = () => resolve(process.env.CW_WEB_ROOT || join(REPO, '..', 'commitwork-web', 'we', 'public'));

/** null when the site is present, otherwise the reason, naming the path and the override. */
export function missingWebRoot(root = webRoot()) {
  return existsSync(root) ? null
    : `missing input: the we.commitwork.online pages are not at ${root}; check out Portll/commitwork-web beside this repository or set CW_WEB_ROOT to its we/public`;
}

// The spine task store, resolved the way spine's own store-path.mjs resolves it. The store moved from
// ~/.substrate to ~/.spine; a reader fixed on either home alone reads a different file from its peers
// on a box that holds only the other one.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const spineStorePath = () => {
  const envPath = process.env.SPINE_TASKS_DB || process.env.SUBSTRATE_TASKS_DB;
  if (envPath) return envPath;
  const spine = join(homedir(), '.spine', 'tasks.db');
  const legacy = join(homedir(), '.substrate', 'tasks.db');
  return existsSync(spine) || !existsSync(legacy) ? spine : legacy;
};

// One definition of the docker config the scanners run against, for the generator (which DECLARES
// it on every launchd agent) and the entry points (which must set it for everything else).
//
// The operator's ~/.docker sets `credsStore: desktop`, so anything resolving a remote image ref —
// trivy, grype, the docker CLI — execs docker-credential-desktop, which reads Docker.app's own
// container and raises "node would like to access data from other apps". Nothing here needs a
// stored credential: the scanners read public registries.
//
// Two definitions of this path would be worse than none: the agents would be quiet and every other
// caller would still prompt, and the difference would show up only as a dialog nobody could
// attribute. Import it; do not re-derive it.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

// Read at CALL time, never at module load: a `const` here would capture the env as it was when the
// first importer was resolved, and any test setting CW_DOCKER_CONFIG afterwards would pass while
// proving nothing about the override.
export function dockerConfigDir() {
  return process.env.CW_DOCKER_CONFIG || join(homedir(), '.config', 'commitwork', 'docker');
}

// Point this process's children at that config, and return what they will actually use.
//
// An inherited DOCKER_CONFIG WINS. A caller that exported one has said which registry identity to
// scan as, and silently overriding it would turn an authenticated scan of a private registry into
// an anonymous one that reports fewer findings — a quieter result that looks like a cleaner one.
export function useScopedDockerConfig() {
  if (process.env.DOCKER_CONFIG) return process.env.DOCKER_CONFIG;
  const dir = dockerConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cfg = join(dir, 'config.json');
  // `{}` rather than an absent file: docker treats both as "no credsStore", but an empty directory
  // reads as "not set up yet" to a human looking for why the prompt stopped.
  if (!existsSync(cfg)) writeFileSync(cfg, '{}\n', { mode: 0o600 });
  process.env.DOCKER_CONFIG = dir;
  return dir;
}

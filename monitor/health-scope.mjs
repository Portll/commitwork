// The healthcheck's repo scope: sweep.mjs's resolver, narrowed to one project name or one area slug.
// A private copy of that enumeration once read registry paths unexpanded and never saw root-discovered
// members, so an area scope resolved zero repos while sweep.mjs found all of them.
import { existsSync } from 'node:fs';
import { resolveRepos } from './discover.mjs';
import { areaOf } from './registry.mjs';

/**
 * `only` arrives as either a project name or an area slug; the admin panel sends the slug.
 * `skip(name)` drops repos the caller will not check (lifecycle-superseded ones).
 * @returns {{ onlyIsArea: boolean, repos: {name: string, path: string}[] }}
 */
export function healthScope(reg, only, { selfRoot = null, stamp = null, skip = () => false } = {}) {
  const areaSlugs = new Set((reg.areas || []).map((a) => a.slug));
  const onlyIsArea = !!only && areaSlugs.has(only) && !(reg.projects || []).some((p) => p.name === only);
  const resolved = resolveRepos(reg, { only: onlyIsArea ? null : only, selfRoot, stamp }).repos;
  const repos = resolved
    .filter((r) => !onlyIsArea || (r.area || areaOf(r.name, reg)) === only)
    .filter((r) => !skip(r.name) && existsSync(r.path))
    .map(({ name, path }) => ({ name, path }));
  return { onlyIsArea, repos };
}

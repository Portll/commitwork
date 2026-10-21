// Which rows of the fleet-wide judgment stores belong on one area's timeline.
//
// annotations.json, image-acceptance.json and program-worklist.json are single files for the whole
// fleet. timeline2 rendered every row in every area, so one project's remediation programme and
// image acceptances appeared as another area's own. A repo-keyed row follows its repo's project, a
// record that declares `project` follows that, and a record that declares neither renders in the
// primary area only, where it always effectively lived. Nothing is dropped silently: the caller
// gets the hidden counts beside the rows.

import { areaBySlug, primaryArea } from './registry.mjs';

/** -> { inScope(value), isPrimary, slug, label } for the area `slug` of registry `reg`. */
export function areaScope(slug, reg) {
  const area = areaBySlug(slug, reg);
  const label = area?.label || slug;
  const names = new Set([slug, label].filter(Boolean));
  return {
    slug, label,
    isPrimary: primaryArea(reg)?.slug === slug,
    inScope: (value) => names.has(value) || names.has(areaBySlug(value, reg)?.label),
  };
}

/**
 * rows: triage rows ({ store, repo, project? }); programs: worklist programs ({ project? }).
 * `projectOf(repo)` names a repo's project label. A '*' repo is fleet-wide by declaration.
 */
export function scopeJudgments({ rows, programs }, scope, projectOf) {
  const keepRecord = (project) => (project ? scope.inScope(project) : scope.isPrimary);
  const keepRow = (r) => {
    if (r.repo === '*') return true;
    if (r.store === 'image-acceptance' || !r.repo) return keepRecord(r.project);
    return scope.inScope(projectOf(r.repo));
  };
  const keptRows = rows.filter(keepRow);
  const keptPrograms = programs.filter((p) => keepRecord(p.project));
  return {
    rows: keptRows,
    programs: keptPrograms,
    hidden: { triage: rows.length - keptRows.length, programs: programs.length - keptPrograms.length },
  };
}

// The REMEDIATION.md section for scanner findings outside the dependency tables.
//
// The plan's tables list dependency advisories only, while its headline sums every lane, so a
// critical or high code, secret or configuration finding was counted at the top and listed nowhere
// below. Measured on one area's plan (2026-10-07): a Trivy root-user finding filed high since
// 2026-10-02 appeared in the issue tracker and in no table. This lists them, grouped by lane and rule.
//
// Rule, title, file and repository only: a finding's message can carry what it matched (a secret's
// value among them), so it never reaches this document. Suppressed rows carry an annotation and are
// left out. Dependency lanes (deps*) belong to the tables above; metric lanes are never work.
import { kindOf, METRIC_CATEGORIES } from './extractors.mjs';

const SEVS = ['crit', 'high'];
const LABEL = { crit: 'Critical', high: 'High' };
const GROUPS_MAX = 60;
const cell = (v) => String(v == null ? '' : v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Markdown lines for the section, or [] when there is nothing at critical or high. */
export function scannerRemediationSection(scannerFindings, ruleTitles = {}) {
  const groups = new Map();
  for (const [category, rows] of Object.entries(scannerFindings || {})) {
    if (category.startsWith('deps') || METRIC_CATEGORIES.has(category) || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || row.annotation || !SEVS.includes(row.sev)) continue;
      const rule = row.rule || row.id || row.check || '(unnamed rule)';
      const key = `${category}\u0000${rule}`;
      const g = groups.get(key) || { category, rule, sev: row.sev, sites: 0, repos: new Set(), files: new Set() };
      if (SEVS.indexOf(row.sev) < SEVS.indexOf(g.sev)) g.sev = row.sev;
      g.sites++;
      if (row.repo) g.repos.add(row.repo);
      const where = row.file || row.path || row.package || '';
      if (where) g.files.add(where);
      groups.set(key, g);
    }
  }
  if (!groups.size) return [];
  const sorted = [...groups.values()].sort((a, b) => (SEVS.indexOf(a.sev) - SEVS.indexOf(b.sev))
    || (b.sites - a.sites) || cmp(a.category, b.category) || cmp(a.rule, b.rule));
  const sites = sorted.reduce((n, g) => n + g.sites, 0);
  const lines = ['', `## Code, secrets and configuration — critical and high — ${sorted.length} rules, ${sites} sites`, '',
    'Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.', '',
    '| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |', '|---|---|---|---|---|---|---|---|'];
  sorted.slice(0, GROUPS_MAX).forEach((g, i) => {
    const title = (ruleTitles[g.category] || {})[g.rule];
    const rule = title ? `${cell(title)} (\`${cell(g.rule)}\`)` : `\`${cell(g.rule)}\``;
    const repos = [...g.repos].sort(cmp);
    const first = [...g.files].sort(cmp)[0] || '';
    lines.push(`| ${i + 1} | ${LABEL[g.sev]} | ${kindOf(g.category) || '—'} | ${rule} | ${cell(g.category)} | ${g.sites} | ${cell(repos.slice(0, 4).join(', '))}${repos.length > 4 ? ` +${repos.length - 4}` : ''} | ${first ? `\`${cell(first)}\`` : '—'} |`);
  });
  if (sorted.length > GROUPS_MAX) lines.push('', `${sorted.length - GROUPS_MAX} more rule(s) are not listed here; the issue tracker holds them.`);
  return lines;
}

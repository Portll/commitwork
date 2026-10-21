// Shared Gradle-convention predicates — one definition for quality-gates.mjs (gate) and
// build-health.mjs (executor), which cannot import each other (both run work on import).
// CW_GRADLE_CONVENTION_FILES=a.gradle,b.gradle overrides the conventions filename list.

export const DEFAULT_CONVENTION_FILES = ['verification-conventions.gradle'];

export function conventionFiles(env = process.env) {
  const named = String(env.CW_GRADLE_CONVENTION_FILES || '').split(',').map((s) => s.trim()).filter(Boolean);
  return named.length ? named : DEFAULT_CONVENTION_FILES;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Line-anchored so a commented-out apply/register is not evidence; returns { registered, how }.
export function registersBootTest(gradleText, { files = conventionFiles() } = {}) {
  const g = gradleText || '';
  if (/^\s*tasks\.register\(['"]bootTest['"]/m.test(g)) return { registered: true, how: "inline tasks.register('bootTest')" };
  for (const f of files) {
    if (new RegExp(`^\\s*apply from:.*${esc(f)}`, 'm').test(g)) return { registered: true, how: `apply from: …/${f}` }; // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- f pinned to a literal via esc; files defaults to the repo-local conventions list
  }
  return { registered: false, how: null };
}

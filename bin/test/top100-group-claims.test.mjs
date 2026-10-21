// docs/TOP-100.md's check-id legend states each lane's groups, and a lane that moves between groups
// changes what the scheduled sweep runs, so every claim is read back against the manifest.
//
// Not a set equality: a row may write "`all`" for checks that also carry `fast` or `deep`. The rules
// are no invented groups, and `all` claimed exactly, because `all` is what monitor/sweep.mjs runs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOC = join(ROOT, 'docs/TOP-100.md');
const MANIFEST = join(ROOT, 'manifests/security-baseline.json');

const ticks = (s) => [...String(s).matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/**
 * The legend abbreviates: "`sast-codeql-java` · `-ruby`" and "`sast-codeql` · `-cpp`". A leading `-`
 * is either APPENDED to the previous id (sast-codeql + -cpp) or REPLACES its last segment
 * (sast-codeql-java + -ruby -> sast-codeql-ruby), and the shorthand alone does not say which.
 * Resolved against the manifest, preferring append. If neither form is a declared check the token
 * is returned unresolved, so the "exists in the manifest" test still fails on a typo.
 */
function expandIds(tokens, exists) {
  const out = [];
  for (const t of tokens) {
    if (t.startsWith('-') && out.length) {
      const prev = out[out.length - 1];
      const stem = prev.includes('-') ? prev.slice(0, prev.lastIndexOf('-')) : prev;
      const append = prev + t, replace = stem + t;
      out.push(exists(append) ? append : (exists(replace) ? replace : append));
    } else out.push(t);
  }
  return out;
}

function legendRows() {
  const md = readFileSync(DOC, 'utf8');
  const start = md.indexOf('### Check-id legend');
  assert.ok(start > -1, 'docs/TOP-100.md has no "### Check-id legend" section — this guard is checking nothing');
  const rows = [];
  for (const line of md.slice(start).split('\n')) {
    if (!line.startsWith('|')) { if (rows.length) break; else continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/^-+$/.test(cells[0].replace(/[^-]/g, '-')) && !ticks(cells[1]).length) continue;  // separator
    if (cells[1] === 'Check id') continue;                                                  // header
    const ids = expandIds(ticks(cells[1]), (id) => !!groupsOf(id));
    if (!ids.length) continue;
    rows.push({ ids, groupCell: cells[2], line });
  }
  return rows;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const groupsOf = (id) => {
  const c = manifest.checks.find((x) => x.id === id);
  return c ? new Set(c.groups || []) : null;
};
const setStr = (s) => [...s].sort().join(',') || '(none)';
// The Groups column mixes prose with groups; only declared group names count as claims.
const GROUP_NAMES = new Set(manifest.checks.flatMap((c) => c.groups || []));
const claimedGroups = (cell) => new Set(ticks(cell).filter((g) => GROUP_NAMES.has(g)));

describe('docs/TOP-100.md check-id legend matches the manifest', () => {
  const rows = legendRows();

  test('the legend is found and non-trivial', () => {
    assert.ok(rows.length >= 10, `only ${rows.length} legend rows parsed — the assertions below would be near-vacuous`);
    const total = rows.reduce((n, r) => n + r.ids.length, 0);
    assert.ok(total >= 20, `only ${total} check ids parsed from the legend`);
  });

  test('every check id named in the legend exists in the manifest', () => {
    const unknown = [];
    for (const r of rows) for (const id of r.ids) if (!groupsOf(id)) unknown.push(id);
    assert.deepEqual(unknown, [],
      `the legend names check ids that manifests/security-baseline.json does not declare: ${unknown.join(', ')}. `
      + 'Either the id is a typo, or the check was renamed and the document was not.');
  });

  // `permitted` is the check's own groups for a per-check claim, or the row's union for a shared one.
  const claimCheck = (label, claimed, actual, wrong, permitted = actual) => {
    const invented = [...claimed].filter((g) => !permitted.has(g));
    if (invented.length) wrong.push(`${label}: legend claims [${invented.join(',')}], which the manifest does not give it (actual [${setStr(actual)}])`);
    if (claimed.has('all') !== actual.has('all')) {
      wrong.push(actual.has('all')
        ? `${label}: legend says [${setStr(claimed)}] but the check IS in \`all\` — it runs on every scheduled sweep`
        : `${label}: legend says \`all\` but the manifest does not — actual [${setStr(actual)}]`);
    }
  };

  test('every group the legend claims is the group the manifest declares', () => {
    const wrong = [];
    for (const { ids, groupCell } of rows) {
      const parts = groupCell.split(' · ');
      if (parts.length === ids.length && ids.length > 1) {
        ids.forEach((id, i) => {
          const actual = groupsOf(id);
          if (actual) claimCheck(id, claimedGroups(parts[i]), actual, wrong);
        });
      } else {
        // one shared claim: it must hold for EVERY check in the row
        const claimed = claimedGroups(groupCell);
        const union = new Set();
        for (const id of ids) for (const g of (groupsOf(id) || [])) union.add(g);
        for (const id of ids) {
          const actual = groupsOf(id);
          if (actual) claimCheck(id, claimed, actual, wrong, union);
        }
      }
    }
    assert.deepEqual(wrong, [],
      'the legend describes a group membership the manifest no longer has:\n  ' + wrong.join('\n  ')
      + '\n\nA lane moving between groups changes what a scheduled sweep runs, so update the legend '
      + 'to match manifests/security-baseline.json.');
  });
});

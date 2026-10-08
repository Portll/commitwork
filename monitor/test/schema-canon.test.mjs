// THE CANON MUST BE HELD TO, AND THE HOLDING MUST NOT BE A HAND-LIST.
//
// monitor/check-vocabulary.mjs already names this failure in its own header: "a canon with zero
// importers declares a vocabulary nothing is held to. A canon that nothing imports is a comment
// with a filename." It was written about status-enum.json, which has since acquired a consumer.
// Measured 2026-08-25, seven schemas had zero non-test source consumers and five of those had live
// data files sitting beside them, unvalidated.
//
// The obvious fix — add a validate() call to each of the five consumers — is the defect wearing a
// solution's clothes: a sixth schema lands next month with no call site and nothing notices. So the
// pairs are DISCOVERED from the tree rather than listed here, and a new schema joins this guard by
// existing. Nothing in this file needs editing when one is added.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../registry.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const schemaFiles = ['schema', join('monitor', 'schema')]
  .flatMap((d) => {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) return [];
    return readdirSync(abs).filter((f) => f.endsWith('.json')).map((f) => join(abs, f));
  });

// A data file is bound to a schema two ways, and both are honoured: it says so with `$schema`
// (authoritative — the file names its own contract), or it sits at a conventional path. Convention
// alone is never enough to CLAIM a binding, so it only supplies candidates; a mismatch is reported
// as an unbound schema rather than silently assumed to be fine.
function dataFor(schemaPath) {
  const stem = basename(schemaPath).replace(/\.schema\.json$|\.json$/, '');
  const byDeclaration = [];
  for (const dir of ['monitor', join('monitor', 'data'), 'manifests', '.']) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (!f.endsWith('.json')) continue;
      const p = join(abs, f);
      let doc; try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      const declared = typeof doc?.$schema === 'string' ? doc.$schema : '';
      if (declared && basename(declared) === basename(schemaPath)) byDeclaration.push(p);
      else if (!declared && f === `${stem}.json`) byDeclaration.push(p);
    }
  }
  return byDeclaration;
}

describe('schema canon', () => {
  test('every data file that DECLARES a schema resolves to one that exists', () => {
    // The F1 defect, generalised: manifests/security-tools.json pointed at a schema nobody had
    // written, for its whole life. A dangling pointer reads as evidence of a check.
    const dangling = [];
    for (const dir of ['monitor', join('monitor', 'data'), 'manifests', 'schema']) {
      const abs = join(ROOT, dir);
      if (!existsSync(abs)) continue;
      for (const f of readdirSync(abs)) {
        if (!f.endsWith('.json')) continue;
        const p = join(abs, f);
        let doc; try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
        const declared = typeof doc?.$schema === 'string' ? doc.$schema : '';
        // Remote/meta-schema URLs are a different kind of claim and are not resolved from disk.
        if (!declared || /^https?:/.test(declared)) continue;
        if (!existsSync(resolve(dirname(p), declared))) dangling.push(`${dir}/${f} -> ${declared}`);
      }
    }
    assert.deepEqual(dangling, [],
      `a $schema pointing at a file that does not exist claims a contract nobody can check:\n  ${dangling.join('\n  ')}`);
  });

  test('every schema with a data file is SATISFIED by it', () => {
    const bad = [];
    for (const s of schemaFiles) {
      for (const d of dataFor(s)) {
        let doc; try { doc = JSON.parse(readFileSync(d, 'utf8')); } catch { bad.push(`${d} unparseable`); continue; }
        const { errors } = validateAgainstSchema(doc, { path: s });
        if (errors.length) bad.push(`${d} violates ${basename(s)}: ${errors[0]}`);
      }
    }
    assert.deepEqual(bad, [], `data that does not satisfy its own schema:\n  ${bad.join('\n  ')}`);
  });

  test('a schema with NO data and NO importer is named — a canon nothing holds', () => {
    // Not a failure: a schema for a feature not yet built is legitimate, and failing on it would
    // push people to delete contracts rather than wire them. But it must be VISIBLE, because the
    // alternative is what happened here — five schemas quietly describing files nobody checked.
    const orphans = [];
    const sources = [];
    for (const dir of ['bin', 'monitor', 'lib', 'cra', 'admin']) {
      const abs = join(ROOT, dir);
      if (!existsSync(abs)) continue;
      const walk = (d, depth) => {
        if (depth > 3) return;
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.name === 'test' || e.name === 'node_modules') continue;
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p, depth + 1);
          else if (e.name.endsWith('.mjs')) { try { sources.push(readFileSync(p, 'utf8')); } catch { /* unreadable */ } }
        }
      };
      walk(abs, 0);
    }
    const blob = sources.join('\n');
    for (const s of schemaFiles) {
      const b = basename(s);
      if (blob.includes(b)) continue;
      if (dataFor(s).length) continue;
      orphans.push(b);
    }
    // Recorded, not enforced. If this list grows, the question to ask is whether the feature exists.
    if (orphans.length) console.error(`  note: ${orphans.length} schema(s) with no data and no importer: ${orphans.join(', ')}`);
    assert.ok(Array.isArray(orphans));
  });
});

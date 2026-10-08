// Every report file has exactly one writer — a check must not score off another check's artifact.
// The rule is about OWNERSHIP, not TLS: a report file may be written by the check that declares
// it, and by nothing else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASSTHROUGH_FORMATS, groupMembers } from '../commitwork.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// Every group the runner would expand to include `id`: a check's own groups[] and the manifest's
// top-level groups map, through the runner's groupMembers() rather than a second reading of either.
export function invokingGroups(doc, id) {
  const names = new Set([...Object.keys(doc.groups || {}), ...doc.checks.flatMap((c) => c.groups || [])]);
  return new Set([...names].filter((g) => groupMembers(doc, g).some((c) => c.id === id)));
}

test('invokingGroups sees a writer added through the top-level groups map', () => {
  const doc = {
    groups: { all: ['sast', 'sast-opengrep'] },
    checks: [{ id: 'sast', groups: ['compare'] }, { id: 'sast-opengrep', groups: ['compare-b'] }],
  };
  assert.deepEqual([...invokingGroups(doc, 'sast-opengrep')].sort(), ['all', 'compare-b']);
  assert.deepEqual([...invokingGroups(doc, 'sast')].sort(), ['all', 'compare']);
});

const MANIFEST_DIR = path.join(ROOT, 'manifests');

const manifests = fs.readdirSync(MANIFEST_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, doc: JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8')) }))
  .filter((m) => Array.isArray(m.doc.checks));

// A check "writes" a filename if it appears in its own commands or in a repo script one of its
// commands invokes.
const scriptCache = new Map();
const readScript = (rel) => {
  if (!scriptCache.has(rel)) {
    const p = path.join(ROOT, rel);
    scriptCache.set(rel, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  }
  return scriptCache.get(rel);
};

const writesOf = (check) => {
  const cmds = (check.local || []).join('\n');
  let text = cmds;
  for (const m of cmds.matchAll(/\b((?:bin|monitor|lib)\/[\w.-]+\.mjs)\b/g)) text += `\n${readScript(m[1])}`;
  return text;
};

// Known deliberate shared writes, recorded so the pin catches the NEXT one.
const ALLOWED_SHARED = {
  'security-baseline.json:semgrep.sarif': {
    writers: ['sast', 'sast-opengrep'],
    // Opengrep is the OSS Semgrep standby: same rules, same SARIF, declared an alias of `sast`.
    // "sarif" is a PARSED format, and the writers never run in one sweep — which was a COMMENT
    // until 2026-08-24, when promoting ten lanes into `all` made "put opengrep in too" a one-word
    // edit that this test would have waved through. requiresDisjointGroups makes the premise an
    // assertion: share the filename only while no group can invoke both. `scan` ignores groups and
    // runs every check; there cmdScan's standby rule (CHECK_ALIASES) keeps opengrep from running
    // after a sast that produced a report, pinned in bin/test/scan-standby.test.mjs.
    requiresDisjointGroups: true,
  },
  'security-baseline.json:npm-audit.json': {
    writers: ['npm-audit', 'yarn-audit'],
    // KNOWN EDGE: both lockfiles at root arms both gates and yarn-audit (declared second) wins —
    // deliberately not special-cased.
    why: 'mutually exclusive gates (./package-lock.json vs ./yarn.lock); shared filename is what '
      + 'lets a yarn repo reach parseNpm()/lifecycle at all; parsed format, no || true',
  },
  'runtime.json:authz-bola.json': {
    writers: ['authz-bola', 'bola-run'],
    // last-writer-wins between two checks in group "all" is a data-loss risk, not in scope here
    why: 'deliberate — bola-run supersedes the unauthenticated probe; parsed format, so no false green',
  },
};

describe('manifest report files have exactly one writer', () => {
  for (const { name, doc } of manifests) {
    test(`${name}: no check scores off another check's artifact`, () => {
      for (const target of doc.checks.filter((c) => c.report?.file)) {
        const file = target.report.file;
        const others = doc.checks.filter((c) => c.id !== target.id && writesOf(c).includes(file));
        if (!others.length) continue;

        const passthrough = PASSTHROUGH_FORMATS.has(target.report.format);
        const allowed = ALLOWED_SHARED[`${name}:${file}`];
        const ids = others.map((c) => c.id);

        // a pass-through format greens on existence — sharing is never allowable, allowlist or not
        assert.ok(!passthrough,
          `${target.id} declares report file "${file}" with pass-through format `
          + `"${target.report.format}" — it scores GREEN on that file existing, and ${ids.join(', ')} `
          + 'also write it, so the pass can come from a scan this check never ran');

        // The allowlist names every writer of the file; this check expects to see the others.
        const expected = (allowed?.writers || []).filter((id) => id !== target.id).sort();
        assert.deepEqual(ids.sort(), expected,
          `${target.id} shares report file "${file}" with ${ids.join(', ')}. Whichever runs last `
          + 'erases the other\'s findings. If that is intended, add it to ALLOWED_SHARED with the reason.');

        // Entries whose justification is "they never co-run" must prove it, not assert it in prose.
        if (allowed?.requiresDisjointGroups) {
          const groupsOf = (id) => invokingGroups(doc, id);
          for (const a of allowed.writers) {
            for (const b of allowed.writers) {
              if (a >= b) continue;
              const shared = [...groupsOf(a)].filter((g) => groupsOf(b).has(g));
              assert.equal(shared.length, 0,
                `${a} and ${b} both write "${file}" and are allowlisted on the grounds that no group `
                + `invokes both — but they now share group(s) ${shared.join(', ')}. One run would `
                + `erase the other's findings. Give one of them its own report file before adding it `
                + 'to a shared group.');
            }
          }
        }
      }
    });
  }
});

describe('the TLS checks share one env contract', () => {
  const runtime = manifests.find((m) => m.name === 'runtime.json').doc;
  const tls = runtime.checks.filter((c) => /tls/.test(c.id));
  assert.ok(tls.length > 0, 'the runtime manifest declares no TLS check — every assertion over `tls` below would pass having examined nothing');

  test('CW_TARGET_URL_TLS is set by nothing and must not be read by anything', () => {
    for (const { name, doc } of manifests) {
      for (const c of doc.checks) {
        assert.ok(!(c.local || []).join(' ').includes('CW_TARGET_URL_TLS'),
          `${name}:${c.id} reads CW_TARGET_URL_TLS; the repo's TLS contract is CW_TLS_URL`);
      }
    }
  });

  test('no TLS check falls back to the plain-HTTP target', () => {
    // the fallback is how a TLS-only tool grades an HTTP-only gateway as pass
    for (const c of tls) {
      const cmds = (c.local || []).join(' ');
      assert.doesNotMatch(cmds, /CW_TLS_URL:-\$?CW_TARGET_URL/,
        `${c.id} falls back to the plain-HTTP target when no TLS URL is set`);
    }
  });

  test('a TLS check with no https endpoint writes no report — not-scanned must not read as pass', () => {
    const t = runtime.checks.find((c) => c.id === 'tls-testssl');
    assert.ok(t, 'tls-testssl is declared');
    const cmd = (t.local || []).join(' ');
    assert.match(cmd, /\[ -n "\$\{CW_TLS_URL:-\}" \] \|\|/, 'must self-gate on CW_TLS_URL');
    // The gate may write a log, but never the file whose presence is the check's green signal.
    const gate = cmd.slice(0, cmd.indexOf('exit 0'));
    assert.ok(!gate.includes(t.report.file),
      `the skip path writes ${t.report.file}, which a pass-through format scores as green`);
  });

  test('every URL-needing runtime check declares requiresUrl, as the manifest says it does', () => {
    for (const c of runtime.checks) {
      const needsUrl = (c.local || []).join(' ').match(/\$\{?CW_(TARGET_URL|TLS_URL)/);
      if (!needsUrl) continue;
      assert.equal(c.requiresUrl, true,
        `${c.id} reads a target URL but does not declare requiresUrl — a URL-less run scans an empty target`);
    }
  });
});

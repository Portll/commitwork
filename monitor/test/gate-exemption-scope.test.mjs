// monitor/gate-exemptions.json — who an exemption may exempt, and what an unreadable file may
// mean. An exemption converts a red gate into annotated amber, so it must be scoped to its area
// (a bare service name matches every area), and an unreadable file is a failure, never zero
// exemptions — only ENOENT means legitimately absent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registryPathFor, gateExemptionsPathFor } from '../store-paths.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// The live overlay is a private record. The shipped example is always checked; the private overlay is
// checked when present, and its absence (ENOENT, no CW_GATE_EXEMPTIONS) drops it from the set.
const EXAMPLE = path.join(ROOT, 'monitor', 'gate-exemptions.example.json');
function privateOverlay() {
  try { return JSON.parse(fs.readFileSync(gateExemptionsPathFor(ROOT), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_GATE_EXEMPTIONS) return null; throw e; }
}
const docs = [['example', JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'))], ['private', privateOverlay()]].filter(([, d]) => d);
const rollupSrc = fs.readFileSync(path.join(ROOT, 'monitor', 'rollup.mjs'), 'utf8');

// The areas are declared in the private fleet registry, which a clean checkout does not have. Only
// its absence skips — ENOENT, with no CW_REGISTRY naming it — so unreadable or unparseable fails.
function liveRegistry() {
  try { return JSON.parse(fs.readFileSync(registryPathFor(ROOT), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_REGISTRY) return null; throw e; }
}

describe('every exemption names the project it applies to', () => {
  test('each entry declares an area', () => {
    for (const [label, doc] of docs) for (const [i, e] of (doc.exemptions || []).entries()) {
      assert.ok(e.area && String(e.area).trim(),
        `${label} exemptions[${i}] (${e.gate}/${e.service}) declares no area — it would match that service `
        + 'name in every other registered project');
    }
  });

  test('the declared area is a real area in the registry, not a typo', (t) => {
    const reg = liveRegistry();
    if (!reg) {
      return t.skip(`private registry absent: ${registryPathFor(ROOT)} does not exist, so the declared `
        + 'areas have no fleet to be checked against');
    }
    const slugs = new Set((reg.areas || []).map((a) => a.slug));
    const live = docs.find(([label]) => label === 'private');
    if (!live) return t.skip(`private overlay absent: ${gateExemptionsPathFor(ROOT)} does not exist, and the example's areas are synthetic`);
    for (const e of live[1].exemptions || []) {
      assert.ok(slugs.has(e.area),
        `'${e.area}' is not a declared area slug (${[...slugs].join(', ')}) — an exemption scoped to `
        + 'an area that does not exist scopes to nothing, or to everything, depending on the matcher');
    }
  });

  test('the rollup matcher ANDs the area in, against the area being rolled up', () => {
    // areaOf(service) returns the same answer for two same-named dirs — only the area being
    // rolled up can tell them apart
    assert.match(rollupSrc, /const rollupArea = \(bm && bm\.area\) \|\| ambientArea\(REG\)\?\.slug/,
      'the matcher must know which area this rollup is for');
    assert.match(rollupSrc, /if \(exArea && rollupArea && exArea !== rollupArea\) continue;/,
      'an exemption from another area must be skipped, not applied');
  });
});

describe('an exemption is re-affirmed, not assumed', () => {
  test('every entry carries an expires — a review date, not a permanent amber', () => {
    for (const [, doc] of docs) for (const [i, e] of (doc.exemptions || []).entries()) {
      assert.ok(e.expires,
        `exemptions[${i}] (${e.gate}/${e.service}) has no expires, so the panel renders it active `
        + 'forever and the judgment is never revisited');
      assert.ok(!Number.isNaN(Date.parse(e.expires)), `exemptions[${i}].expires is not an ISO date`);
      assert.ok(Date.parse(e.expires) > Date.parse(e.at), `exemptions[${i}] expires before it starts`);
    }
  });

  test('the file still forbids deletion — expiry is the removal mechanism', () => {
    for (const [label, doc] of docs) {
      assert.match(doc._comment, /Never delete an entry — set expires/,
        `${label}: the append-only discipline is what makes an expired exemption auditable rather than absent`);
    }
  });
});

describe('an unreadable exemptions file is not an empty one', () => {
  test('rollup fails closed on anything but ENOENT', () => {
    assert.match(rollupSrc, /if \(err\.code !== 'ENOENT'\) \{/,
      'only a genuinely absent file may be read as "no exemptions declared"');
    // Comments stripped first — the fix's own note quotes the `catch {}` it removed.
    const code = rollupSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const at = code.indexOf('readFileSync(gateExemptionsPathFor(CW)');
    assert.ok(at >= 0, 'the rollup must read the overlay through its resolver');
    const region = code.slice(at - 200);
    assert.doesNotMatch(region.slice(0, 600), /catch \{\s*\}/,
      'a bare catch here drops every recorded exemption and republishes those gates as plain reds');
  });

  test('it exits with a code distinct from the other refusals', () => {
    // rollup already uses 2 (empty batch), 3 (lock), 4 (foreign area), 5 (batch resolution), so a
    // shared code would make sweep.mjs report the wrong cause.
    const m = rollupSrc.match(/republish those gates as plain reds[\s\S]{0,300}?process\.exit\((\d+)\)/);
    assert.ok(m, 'the unreadable-exemptions path must exit non-zero');
    assert.ok(!['2', '3', '4', '5'].includes(m[1]), `exit ${m[1]} collides with an existing refusal code`);
  });
});

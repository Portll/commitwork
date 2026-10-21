// The remediation register is edited as Markdown and stored as JSON. These tests hold the bridge:
// a save must reproduce the registry byte for byte when nothing changed, touch only what was
// edited, and refuse what it cannot place rather than dropping it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toMarkdown, fromMarkdown, applyToRegistry, RegisterFormatError } from '../../lib/remediation-md.mjs';
import { presentPrivateRoot } from '../../lib/docsite-manifest.mjs';
import { outPath } from '../remediation-web.mjs';

const path = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const RAW = readFileSync(path('monitor/failure-taxonomy.json'), 'utf8');
const REGISTRY = JSON.parse(RAW);
const MD = toMarkdown(REGISTRY);
const save = (md, reg = REGISTRY) => applyToRegistry(reg, fromMarkdown(md));
const refuses = (md, re) => assert.throws(() => save(md), (e) => e instanceof RegisterFormatError && re.test(e.message));

describe('remediation register as Markdown', () => {
  test('an unedited save reproduces the registry byte for byte', () => {
    assert.ok(REGISTRY.remediations.length >= 18 && REGISTRY.attributionPlan.length >= 8, 'registry degenerated; the round trip would pass vacuously');
    assert.equal(`${JSON.stringify(save(MD), null, 2)}\n`, RAW);
  });

  test('an edit lands on the item edited and nowhere else', () => {
    const edited = MD.replace(/(### Action 3: [^\n]*\n\n- \*\*Status:\*\* )[^\n]*/, '$1DONE 2026-10-05 edited');
    const after = save(edited);
    assert.equal(after.remediations.find((r) => r.rank === 3).status, 'DONE 2026-10-05 edited');
    for (const k of Object.keys(REGISTRY).filter((k) => k !== 'remediations')) assert.deepEqual(after[k], REGISTRY[k], k);
    const others = (reg) => JSON.stringify(reg.remediations.filter((r) => r.rank !== 3));
    assert.equal(others(after), others(REGISTRY));
  });

  test('a wrapped line continues the field above it', () => {
    const wrapped = MD.replace(/(### Action 2: [^\n]*\n\n- \*\*Status:\*\* \S+) /, '$1\n');
    assert.equal(`${JSON.stringify(save(wrapped), null, 2)}\n`, RAW);
  });

  test('refusals name the line instead of dropping data', () => {
    refuses(MD.replace(/\n- \*\*Risk:\*\*[^\n]*/, ''), /Risk line is missing/);
    refuses(MD.replace('- **Layer:**', '- **Colour:**'), /unknown field "Colour"/);
    refuses(MD.replace(/- \*\*Gain:\*\* \d+/, '- **Gain:** four'), /Gain must be a number/);
    refuses(MD.replace(/### Action 2:/, '### Action 1:'), /action 1 appears twice/);
    refuses(MD.replace('## Ranked actions\n', '## Ranked actions\n\nA stray paragraph.\n'), /text before the first entry/);
    refuses(`${MD}\n## Appendix\n`, /unknown section "Appendix"/);
  });

  test('a lost or misspelt section heading is refused, never saved as an empty list', () => {
    refuses(MD.replace('## Ranked actions\n', '## Ranked Actions\n'), /unknown section "Ranked Actions"/);
    refuses(MD.replace('## Ranked actions\n', ''), /entry above the "## Ranked actions" heading/);
    refuses(MD.replace('## Attribution surfaces\n', ''), /an action heading reads/);
    refuses(`${MD}\n## Ranked actions\n`, /appears twice/);
  });

  test('an empty status shows as UNASSESSED and reads back as it was stored', () => {
    const reg = { remediations: [{ rank: 1, title: 't', action: 'a' }], attributionPlan: [] };
    const md = toMarkdown(reg);
    assert.match(md, /- \*\*Status:\*\* UNASSESSED/);
    assert.deepEqual(save(md, reg).remediations, reg.remediations);
  });

  test('a field the format cannot hold is refused, never written without it', () => {
    assert.throws(() => toMarkdown({ remediations: [{ rank: 1, title: 't', owner: 'x' }] }), /field 'owner' has no line/);
    assert.throws(() => toMarkdown({ remediations: [{ rank: 1, title: 't', note: 'two\nlines' }] }), /line break/);
  });

  // The register is a private draft (monitor/private/docsite since B1), so a public clone has no source
  // to compare. Only an absent private root skips; a present root without the entry fails in outPath().
  test('the docsite source matches the registry (regenerate: node bin/remediation-web.mjs)',
    { skip: presentPrivateRoot() ? false : 'no private docsite root: a public checkout carries no register source' }, () => {
      assert.equal(readFileSync(outPath(), 'utf8'), MD);
    });
});

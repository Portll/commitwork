// Renders a remediation registry as a markdown document (lib/remediation-md.mjs toMarkdown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../remediation-md.mjs';

test('renders a registry with one action and one surface', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix A', status: 'DONE', layer: 'L1', closes: ['x'], raises: [], effort: 'S', gain: 1, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: [{ area: 'Area1', status: 'OPEN', defect: 'D', mechanism: 'M', change: 'C', closes: [], effort: 'M' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** DONE 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix A\n\n- **Status:** DONE\n- **Layer:** L1\n- **Closes:** x\n- **Raises:** none\n- **Effort:** S\n- **Gain:** 1\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n\n### Surface: Area1\n\n- **Status:** OPEN\n- **Defect:** D\n- **Mechanism:** M\n- **Change:** C\n- **Closes:** none\n- **Effort:** M\n");
});

test('renders a registry with no actions and no surfaces', () => {
  const registry = { remediations: [], attributionPlan: [] };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 0 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** none\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n## Attribution surfaces\n");
});

test('renders a registry with undefined remediations and attributionPlan', () => {
  const registry = {};
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 0 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** none\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n## Attribution surfaces\n");
});

test('renders a registry with null remediations and attributionPlan', () => {
  const registry = { remediations: null, attributionPlan: null };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 0 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** none\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status UNASSESSED', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix B', status: 'UNASSESSED', layer: 'L2', closes: [], raises: [], effort: 'M', gain: 2, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.throws(() => toMarkdown(registry), { name: "Error", message: "action 1: a stored status of exactly UNASSESSED would read back as empty" });
});

test('renders a registry with one action having empty status', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix C', status: '', layer: 'L3', closes: [], raises: [], effort: 'L', gain: 3, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** UNASSESSED 1\n\n**1 of 1** carry no recognised status and read as UNASSESSED, never as blank: an unchecked item is not a finished one.\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix C\n\n- **Status:** UNASSESSED\n- **Layer:** L3\n- **Closes:** none\n- **Raises:** none\n- **Effort:** L\n- **Gain:** 3\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having unrecognized status', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix D', status: 'SOMETHING', layer: 'L4', closes: [], raises: [], effort: 'S', gain: 4, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** UNASSESSED 1\n\n**1 of 1** carry no recognised status and read as UNASSESSED, never as blank: an unchecked item is not a finished one.\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix D\n\n- **Status:** SOMETHING\n- **Layer:** L4\n- **Closes:** none\n- **Raises:** none\n- **Effort:** S\n- **Gain:** 4\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with two actions having status DONE', () => {
  const registry = {
    remediations: [
      { rank: 1, title: 'Fix E', status: 'DONE', layer: 'L5', closes: [], raises: [], effort: 'S', gain: 5, action: 'Do', note: '', risk: '', evidenceFrom: '' },
      { rank: 2, title: 'Fix F', status: 'DONE', layer: 'L6', closes: [], raises: [], effort: 'M', gain: 6, action: 'Do', note: '', risk: '', evidenceFrom: '' }
    ],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 2 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** DONE 2\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix E\n\n- **Status:** DONE\n- **Layer:** L5\n- **Closes:** none\n- **Raises:** none\n- **Effort:** S\n- **Gain:** 5\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n### Action 2: Fix F\n\n- **Status:** DONE\n- **Layer:** L6\n- **Closes:** none\n- **Raises:** none\n- **Effort:** M\n- **Gain:** 6\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status PARTIAL', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix G', status: 'PARTIAL', layer: 'L7', closes: [], raises: [], effort: 'M', gain: 7, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** PARTIAL 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix G\n\n- **Status:** PARTIAL\n- **Layer:** L7\n- **Closes:** none\n- **Raises:** none\n- **Effort:** M\n- **Gain:** 7\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status SUPERSEDED', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix H', status: 'SUPERSEDED', layer: 'L8', closes: [], raises: [], effort: 'L', gain: 8, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** SUPERSEDED 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix H\n\n- **Status:** SUPERSEDED\n- **Layer:** L8\n- **Closes:** none\n- **Raises:** none\n- **Effort:** L\n- **Gain:** 8\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status WRONG', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix I', status: 'WRONG', layer: 'L9', closes: [], raises: [], effort: 'S', gain: 9, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** WRONG 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix I\n\n- **Status:** WRONG\n- **Layer:** L9\n- **Closes:** none\n- **Raises:** none\n- **Effort:** S\n- **Gain:** 9\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status OPEN', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix J', status: 'OPEN', layer: 'L10', closes: [], raises: [], effort: 'M', gain: 10, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** OPEN 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix J\n\n- **Status:** OPEN\n- **Layer:** L10\n- **Closes:** none\n- **Raises:** none\n- **Effort:** M\n- **Gain:** 10\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status DONE with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix K', status: 'DONE \u2014 verified', layer: 'L11', closes: [], raises: [], effort: 'S', gain: 11, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** DONE 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix K\n\n- **Status:** DONE \u2014 verified\n- **Layer:** L11\n- **Closes:** none\n- **Raises:** none\n- **Effort:** S\n- **Gain:** 11\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status PARTIAL with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix L', status: 'PARTIAL - in progress', layer: 'L12', closes: [], raises: [], effort: 'M', gain: 12, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** PARTIAL 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix L\n\n- **Status:** PARTIAL - in progress\n- **Layer:** L12\n- **Closes:** none\n- **Raises:** none\n- **Effort:** M\n- **Gain:** 12\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status OPEN with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix M', status: 'OPEN: needs work', layer: 'L13', closes: [], raises: [], effort: 'L', gain: 13, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** OPEN 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix M\n\n- **Status:** OPEN: needs work\n- **Layer:** L13\n- **Closes:** none\n- **Raises:** none\n- **Effort:** L\n- **Gain:** 13\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status SUPERSEDED with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix N', status: 'SUPERSEDED by newer', layer: 'L14', closes: [], raises: [], effort: 'S', gain: 14, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** SUPERSEDED 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix N\n\n- **Status:** SUPERSEDED by newer\n- **Layer:** L14\n- **Closes:** none\n- **Raises:** none\n- **Effort:** S\n- **Gain:** 14\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status WRONG with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix O', status: 'WRONG: bad approach', layer: 'L15', closes: [], raises: [], effort: 'M', gain: 15, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** WRONG 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix O\n\n- **Status:** WRONG: bad approach\n- **Layer:** L15\n- **Closes:** none\n- **Raises:** none\n- **Effort:** M\n- **Gain:** 15\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status UNASSESSED with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix P', status: 'UNASSESSED: unknown', layer: 'L16', closes: [], raises: [], effort: 'L', gain: 16, action: 'Do', note: '', risk: '', evidenceFrom: '' }],
    attributionPlan: []
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 0 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** UNASSESSED 1\n\n**1 of 1** carry no recognised status and read as UNASSESSED, never as blank: an unchecked item is not a finished one.\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix P\n\n- **Status:** UNASSESSED: unknown\n- **Layer:** L16\n- **Closes:** none\n- **Raises:** none\n- **Effort:** L\n- **Gain:** 16\n- **Action:** Do\n- **Note:**\n- **Risk:**\n- **Evidence from:**\n\n## Attribution surfaces\n");
});

test('renders a registry with one action having status DONE with detail and one surface', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix Q', status: 'DONE \u2014 verified', layer: 'L17', closes: ['x'], raises: ['y'], effort: 'S', gain: 17, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area2', status: 'PARTIAL', defect: 'D2', mechanism: 'M2', change: 'C2', closes: ['z'], effort: 'M' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** DONE 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix Q\n\n- **Status:** DONE \u2014 verified\n- **Layer:** L17\n- **Closes:** x\n- **Raises:** y\n- **Effort:** S\n- **Gain:** 17\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area2\n\n- **Status:** PARTIAL\n- **Defect:** D2\n- **Mechanism:** M2\n- **Change:** C2\n- **Closes:** z\n- **Effort:** M\n");
});

test('renders a registry with one action having status PARTIAL with detail and one surface', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix R', status: 'PARTIAL - in progress', layer: 'L18', closes: ['x'], raises: ['y'], effort: 'M', gain: 18, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area3', status: 'OPEN', defect: 'D3', mechanism: 'M3', change: 'C3', closes: ['z'], effort: 'L' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** PARTIAL 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix R\n\n- **Status:** PARTIAL - in progress\n- **Layer:** L18\n- **Closes:** x\n- **Raises:** y\n- **Effort:** M\n- **Gain:** 18\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area3\n\n- **Status:** OPEN\n- **Defect:** D3\n- **Mechanism:** M3\n- **Change:** C3\n- **Closes:** z\n- **Effort:** L\n");
});

test('renders a registry with one action having status OPEN with detail and one surface', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix S', status: 'OPEN: needs work', layer: 'L19', closes: ['x'], raises: ['y'], effort: 'L', gain: 19, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area4', status: 'SUPERSEDED', defect: 'D4', mechanism: 'M4', change: 'C4', closes: ['z'], effort: 'S' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** OPEN 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix S\n\n- **Status:** OPEN: needs work\n- **Layer:** L19\n- **Closes:** x\n- **Raises:** y\n- **Effort:** L\n- **Gain:** 19\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area4\n\n- **Status:** SUPERSEDED\n- **Defect:** D4\n- **Mechanism:** M4\n- **Change:** C4\n- **Closes:** z\n- **Effort:** S\n");
});

test('renders a registry with one action having status SUPERSEDED with detail and one surface', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix T', status: 'SUPERSEDED by newer', layer: 'L20', closes: ['x'], raises: ['y'], effort: 'S', gain: 20, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area5', status: 'WRONG', defect: 'D5', mechanism: 'M5', change: 'C5', closes: ['z'], effort: 'M' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** SUPERSEDED 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix T\n\n- **Status:** SUPERSEDED by newer\n- **Layer:** L20\n- **Closes:** x\n- **Raises:** y\n- **Effort:** S\n- **Gain:** 20\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area5\n\n- **Status:** WRONG\n- **Defect:** D5\n- **Mechanism:** M5\n- **Change:** C5\n- **Closes:** z\n- **Effort:** M\n");
});

test('renders a registry with one action having status WRONG with detail and one surface', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix U', status: 'WRONG: bad approach', layer: 'L21', closes: ['x'], raises: ['y'], effort: 'M', gain: 21, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area6', status: 'UNASSESSED', defect: 'D6', mechanism: 'M6', change: 'C6', closes: ['z'], effort: 'L' }]
  };
  assert.throws(() => toMarkdown(registry), { name: "Error", message: "surface Area6: a stored status of exactly UNASSESSED would read back as empty" });
});

test('renders a registry with one action having status UNASSESSED with detail and one surface', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix V', status: 'UNASSESSED: unknown', layer: 'L22', closes: ['x'], raises: ['y'], effort: 'L', gain: 22, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area7', status: 'DONE', defect: 'D7', mechanism: 'M7', change: 'C7', closes: ['z'], effort: 'S' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** UNASSESSED 1\n\n**1 of 1** carry no recognised status and read as UNASSESSED, never as blank: an unchecked item is not a finished one.\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix V\n\n- **Status:** UNASSESSED: unknown\n- **Layer:** L22\n- **Closes:** x\n- **Raises:** y\n- **Effort:** L\n- **Gain:** 22\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area7\n\n- **Status:** DONE\n- **Defect:** D7\n- **Mechanism:** M7\n- **Change:** C7\n- **Closes:** z\n- **Effort:** S\n");
});

test('renders a registry with one action having status DONE with detail and one surface with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix W', status: 'DONE \u2014 verified', layer: 'L23', closes: ['x'], raises: ['y'], effort: 'S', gain: 23, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area8', status: 'PARTIAL - in progress', defect: 'D8', mechanism: 'M8', change: 'C8', closes: ['z'], effort: 'M' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** DONE 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix W\n\n- **Status:** DONE \u2014 verified\n- **Layer:** L23\n- **Closes:** x\n- **Raises:** y\n- **Effort:** S\n- **Gain:** 23\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area8\n\n- **Status:** PARTIAL - in progress\n- **Defect:** D8\n- **Mechanism:** M8\n- **Change:** C8\n- **Closes:** z\n- **Effort:** M\n");
});

test('renders a registry with one action having status PARTIAL with detail and one surface with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix X', status: 'PARTIAL - in progress', layer: 'L24', closes: ['x'], raises: ['y'], effort: 'M', gain: 24, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area9', status: 'OPEN: needs work', defect: 'D9', mechanism: 'M9', change: 'C9', closes: ['z'], effort: 'L' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** PARTIAL 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix X\n\n- **Status:** PARTIAL - in progress\n- **Layer:** L24\n- **Closes:** x\n- **Raises:** y\n- **Effort:** M\n- **Gain:** 24\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area9\n\n- **Status:** OPEN: needs work\n- **Defect:** D9\n- **Mechanism:** M9\n- **Change:** C9\n- **Closes:** z\n- **Effort:** L\n");
});

test('renders a registry with one action having status OPEN with detail and one surface with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix Y', status: 'OPEN: needs work', layer: 'L25', closes: ['x'], raises: ['y'], effort: 'L', gain: 25, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area10', status: 'SUPERSEDED by newer', defect: 'D10', mechanism: 'M10', change: 'C10', closes: ['z'], effort: 'S' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** OPEN 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix Y\n\n- **Status:** OPEN: needs work\n- **Layer:** L25\n- **Closes:** x\n- **Raises:** y\n- **Effort:** L\n- **Gain:** 25\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area10\n\n- **Status:** SUPERSEDED by newer\n- **Defect:** D10\n- **Mechanism:** M10\n- **Change:** C10\n- **Closes:** z\n- **Effort:** S\n");
});

test('renders a registry with one action having status SUPERSEDED with detail and one surface with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix Z', status: 'SUPERSEDED by newer', layer: 'L26', closes: ['x'], raises: ['y'], effort: 'S', gain: 26, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area11', status: 'WRONG: bad approach', defect: 'D11', mechanism: 'M11', change: 'C11', closes: ['z'], effort: 'M' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** SUPERSEDED 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix Z\n\n- **Status:** SUPERSEDED by newer\n- **Layer:** L26\n- **Closes:** x\n- **Raises:** y\n- **Effort:** S\n- **Gain:** 26\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area11\n\n- **Status:** WRONG: bad approach\n- **Defect:** D11\n- **Mechanism:** M11\n- **Change:** C11\n- **Closes:** z\n- **Effort:** M\n");
});

test('renders a registry with one action having status WRONG with detail and one surface with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix AA', status: 'WRONG: bad approach', layer: 'L27', closes: ['x'], raises: ['y'], effort: 'M', gain: 27, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area12', status: 'UNASSESSED: unknown', defect: 'D12', mechanism: 'M12', change: 'C12', closes: ['z'], effort: 'L' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** WRONG 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix AA\n\n- **Status:** WRONG: bad approach\n- **Layer:** L27\n- **Closes:** x\n- **Raises:** y\n- **Effort:** M\n- **Gain:** 27\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area12\n\n- **Status:** UNASSESSED: unknown\n- **Defect:** D12\n- **Mechanism:** M12\n- **Change:** C12\n- **Closes:** z\n- **Effort:** L\n");
});

test('renders a registry with one action having status UNASSESSED with detail and one surface with detail', () => {
  const registry = {
    remediations: [{ rank: 1, title: 'Fix AB', status: 'UNASSESSED: unknown', layer: 'L28', closes: ['x'], raises: ['y'], effort: 'L', gain: 28, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }],
    attributionPlan: [{ area: 'Area13', status: 'DONE \u2014 verified', defect: 'D13', mechanism: 'M13', change: 'C13', closes: ['z'], effort: 'S' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 1 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** UNASSESSED 1\n\n**1 of 1** carry no recognised status and read as UNASSESSED, never as blank: an unchecked item is not a finished one.\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix AB\n\n- **Status:** UNASSESSED: unknown\n- **Layer:** L28\n- **Closes:** x\n- **Raises:** y\n- **Effort:** L\n- **Gain:** 28\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area13\n\n- **Status:** DONE \u2014 verified\n- **Defect:** D13\n- **Mechanism:** M13\n- **Change:** C13\n- **Closes:** z\n- **Effort:** S\n");
});

test('renders a registry with one action having status DONE with detail and one surface with detail and one action with status PARTIAL', () => {
  const registry = {
    remediations: [
      { rank: 1, title: 'Fix AC', status: 'DONE \u2014 verified', layer: 'L29', closes: ['x'], raises: ['y'], effort: 'S', gain: 29, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' },
      { rank: 2, title: 'Fix AD', status: 'PARTIAL - in progress', layer: 'L30', closes: ['x'], raises: ['y'], effort: 'M', gain: 30, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }
    ],
    attributionPlan: [{ area: 'Area14', status: 'OPEN: needs work', defect: 'D14', mechanism: 'M14', change: 'C14', closes: ['z'], effort: 'L' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 2 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** DONE 1 \u00b7 PARTIAL 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix AC\n\n- **Status:** DONE \u2014 verified\n- **Layer:** L29\n- **Closes:** x\n- **Raises:** y\n- **Effort:** S\n- **Gain:** 29\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n### Action 2: Fix AD\n\n- **Status:** PARTIAL - in progress\n- **Layer:** L30\n- **Closes:** x\n- **Raises:** y\n- **Effort:** M\n- **Gain:** 30\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area14\n\n- **Status:** OPEN: needs work\n- **Defect:** D14\n- **Mechanism:** M14\n- **Change:** C14\n- **Closes:** z\n- **Effort:** L\n");
});

test('renders a registry with one action having status OPEN with detail and one surface with detail and one action with status SUPERSEDED', () => {
  const registry = {
    remediations: [
      { rank: 1, title: 'Fix AE', status: 'OPEN: needs work', layer: 'L31', closes: ['x'], raises: ['y'], effort: 'L', gain: 31, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' },
      { rank: 2, title: 'Fix AF', status: 'SUPERSEDED by newer', layer: 'L32', closes: ['x'], raises: ['y'], effort: 'S', gain: 32, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }
    ],
    attributionPlan: [{ area: 'Area15', status: 'WRONG: bad approach', defect: 'D15', mechanism: 'M15', change: 'C15', closes: ['z'], effort: 'M' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 2 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** OPEN 1 \u00b7 SUPERSEDED 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix AE\n\n- **Status:** OPEN: needs work\n- **Layer:** L31\n- **Closes:** x\n- **Raises:** y\n- **Effort:** L\n- **Gain:** 31\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n### Action 2: Fix AF\n\n- **Status:** SUPERSEDED by newer\n- **Layer:** L32\n- **Closes:** x\n- **Raises:** y\n- **Effort:** S\n- **Gain:** 32\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area15\n\n- **Status:** WRONG: bad approach\n- **Defect:** D15\n- **Mechanism:** M15\n- **Change:** C15\n- **Closes:** z\n- **Effort:** M\n");
});

test('renders a registry with one action having status SUPERSEDED with detail and one surface with detail and one action with status WRONG', () => {
  const registry = {
    remediations: [
      { rank: 1, title: 'Fix AG', status: 'SUPERSEDED by newer', layer: 'L33', closes: ['x'], raises: ['y'], effort: 'S', gain: 33, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' },
      { rank: 2, title: 'Fix AH', status: 'WRONG: bad approach', layer: 'L34', closes: ['x'], raises: ['y'], effort: 'M', gain: 34, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }
    ],
    attributionPlan: [{ area: 'Area16', status: 'UNASSESSED: unknown', defect: 'D16', mechanism: 'M16', change: 'C16', closes: ['z'], effort: 'L' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 2 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** SUPERSEDED 1 \u00b7 WRONG 1\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix AG\n\n- **Status:** SUPERSEDED by newer\n- **Layer:** L33\n- **Closes:** x\n- **Raises:** y\n- **Effort:** S\n- **Gain:** 33\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n### Action 2: Fix AH\n\n- **Status:** WRONG: bad approach\n- **Layer:** L34\n- **Closes:** x\n- **Raises:** y\n- **Effort:** M\n- **Gain:** 34\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area16\n\n- **Status:** UNASSESSED: unknown\n- **Defect:** D16\n- **Mechanism:** M16\n- **Change:** C16\n- **Closes:** z\n- **Effort:** L\n");
});

test('renders a registry with one action having status WRONG with detail and one surface with detail and one action with status UNASSESSED', () => {
  const registry = {
    remediations: [
      { rank: 1, title: 'Fix AI', status: 'WRONG: bad approach', layer: 'L35', closes: ['x'], raises: ['y'], effort: 'M', gain: 35, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' },
      { rank: 2, title: 'Fix AJ', status: 'UNASSESSED: unknown', layer: 'L36', closes: ['x'], raises: ['y'], effort: 'L', gain: 36, action: 'Do', note: 'N', risk: 'R', evidenceFrom: 'E' }
    ],
    attributionPlan: [{ area: 'Area17', status: 'DONE \u2014 verified', defect: 'D17', mechanism: 'M17', change: 'C17', closes: ['z'], effort: 'S' }]
  };
  assert.deepEqual(toMarkdown(registry), "# Remediation register\n\n<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->\n\nThe 2 ranked actions and 1 attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.\n\n**Status count:** WRONG 1 \u00b7 UNASSESSED 1\n\n**1 of 2** carry no recognised status and read as UNASSESSED, never as blank: an unchecked item is not a finished one.\n\n**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as UNASSESSED. Everything above \"Ranked actions\" is regenerated on save.\n\n## Ranked actions\n\n### Action 1: Fix AI\n\n- **Status:** WRONG: bad approach\n- **Layer:** L35\n- **Closes:** x\n- **Raises:** y\n- **Effort:** M\n- **Gain:** 35\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n### Action 2: Fix AJ\n\n- **Status:** UNASSESSED: unknown\n- **Layer:** L36\n- **Closes:** x\n- **Raises:** y\n- **Effort:** L\n- **Gain:** 36\n- **Action:** Do\n- **Note:** N\n- **Risk:** R\n- **Evidence from:** E\n\n## Attribution surfaces\n\n### Surface: Area17\n\n- **Status:** DONE \u2014 verified\n- **Defect:** D17\n- **Mechanism:** M17\n- **Change:** C17\n- **Closes:** z\n- **Effort:** S\n");
});

// Every LLM call this repository makes must pin `temperature`, and this asserts it over the SOURCE
// rather than over a list someone has to remember to update.
//
// WHY IT EXISTS. R15's finding was not that a site was unpinned — it was that NOTHING ASSERTED
// pinning anywhere in the repo (measured 2026-08-30: 0 temperature assertions across every test
// file). FOUR sites were unpinned — admin/routes/remediation.mjs twice, codeql-remediation.mjs
// once, and issue-detail.mjs's ollama branch, which R15 itself missed and the FIRST version of this
// test also missed — and nothing would have gone red as they were added,
// because there was no floor. Pinning them without adding this is a streak, not a guarantee:
// the next route to be written starts unpinned and nobody hears about it.
//
// WHY IT MATTERS BEYOND DETERMINISM. Output from these routes is written into the adjudication
// ledger as EVIDENCE. An unpinned rater's judgement cannot be re-derived, so it is a claim no re-run
// can support — the same doctrine as CW_VERDICT_PIN, applied to the sampler rather than the record.
//
// DISCOVERY, NOT ENUMERATION. The site list is derived by scanning for the LLM endpoints themselves,
// so a NEW call site is covered the day it lands. Two shapes are accepted because two engines are
// in use: OpenAI-style `temperature: X` at the top level of the body, and ollama's
// `options: { temperature: X }`. A call through lib/model-provider.mjs is a site too: the module
// forwards the caller's temperature, so `chatComplete(` is where the pin is chosen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENDPOINT = /\/v1\/chat\/completions|\/v1\/messages|\/api\/chat|\/api\/generate|\bchatComplete\(/;
const SKIP_DIR = new Set(['node_modules', '.git', 'reports', 'docsite', 'evaluations', 'schema']);

// Sites that sample ON PURPOSE. These are prose-generation routes for human reading, not raters
// whose output is written into the adjudication ledger, so reproducibility is not load-bearing.
// Listed rather than tolerated by pattern: an operator chose each one, and a NEW non-zero site
// fails until someone chooses it too. R15 leaves the question of whether these should be 0 as an
// operator call; this makes the pending decision visible instead of invisible.
// KEYED ON FILE AND VALUE, NEVER ON LINE. The first version of this list used `file:line` and broke
// within minutes: adding a three-line comment above one site shifted it 118 -> 121 and the entry
// stopped matching, turning a recorded decision back into an alarm. That is the repo's oldest rule
// ("never key an identity on a line number") reproduced inside the test written to enforce
// discipline. Code moves for reasons that have nothing to do with the decision recorded here.
const SAMPLING = new Map([
  ['bin/issue-llm.mjs', '0.2'],
  ['admin/routes/issue-detail.mjs', '0.2'],
]);

/** Every .mjs under the repo that is not a test and not in a skipped tree. */
function sources(dir = REPO, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) sources(p, out);
    else if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

/**
 * Call sites and whether each pins temperature.
 *
 * The window runs from the endpoint to the NEXT endpoint, capped at 18 lines. It must not be a
 * bare offset: a window that spans two call sites attributes one branch's pin to the other, which
 * is how issue-detail.mjs:118 read as pinned when it was not.
 */
export function callSites(text) {
  const lines = text.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!ENDPOINT.test(lines[i])) continue;
    // Bound the window at the NEXT endpoint, not at a fixed offset. Without this, an unpinned
    // ollama branch reads as pinned because the window reaches the `temperature` in the lmstudio
    // branch below it — which is exactly how admin/routes/issue-detail.mjs:118 hid, and it hid from
    // the first version of THIS test. A window that can span two call sites cannot attribute a pin.
    let end = i + 18;
    for (let j = i + 1; j < end && j < lines.length; j++) if (ENDPOINT.test(lines[j])) { end = j; break; }
    const window = lines.slice(i, end).join('\n');
    const m = window.match(/temperature:\s*([A-Za-z0-9_.]+)/);
    found.push({ line: i + 1, pinned: !!m, value: m ? m[1] : null });
  }
  return found;
}

test('EVERY LLM call site pins temperature — discovered from source, not from a list', () => {
  const unpinned = [];
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    if (!ENDPOINT.test(text)) continue;
    for (const site of callSites(text)) {
      if (!site.pinned) unpinned.push(`${relative(REPO, file)}:${site.line}`);
    }
  }
  assert.deepEqual(unpinned, [],
    `these LLM calls do not pin temperature, so their output cannot be re-derived:\n  ${unpinned.join('\n  ')}`);
});

test('every pin is 0 or a named constant — never a bare non-zero literal', () => {
  const loose = [];
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    if (!ENDPOINT.test(text)) continue;
    for (const site of callSites(text)) {
      if (!site.pinned) continue;
      // `0` is the pin. A bare non-zero number is a sampling temperature and is a deliberate
      // operator choice, so it is named here rather than failed — this test's job is to make it
      // VISIBLE, and the list below is the record of what was chosen on purpose.
      const rel = relative(REPO, file);
      if (/^(0|[A-Za-z_][A-Za-z0-9_]*)$/.test(site.value)) continue;
      if (SAMPLING.get(rel) === site.value) continue;   // deliberate, recorded above
      loose.push(`${rel}:${site.line} → ${site.value}`);
    }
  }
  assert.deepEqual(loose, [], `unexpected temperature literal:\n  ${loose.join('\n  ')}`);
});

// THE SECOND WITNESS. The two tests above pass when the detector is broken as readily as when the
// code is correct — a scanner that finds no call sites reports a clean tree it never read, which is
// the exact defect the import guard shipped with (CLAUDE.md, "a guard needs a second witness").
// So: assert the detector CAN fail, and assert it is actually looking at something.
test('the detector fails on an unpinned body — it is not vacuously green', () => {
  const unpinned = `const r = await fetch(\`\${U}/v1/chat/completions\`, {
      method: 'POST', body: JSON.stringify({ model, messages }) });`;
  const sites = callSites(unpinned);
  assert.equal(sites.length, 1, 'the scanner must SEE a call site here');
  assert.equal(sites[0].pinned, false, 'an unpinned body must read as unpinned');

  const pinned = `const r = await fetch(\`\${U}/v1/chat/completions\`, {
      method: 'POST', body: JSON.stringify({ model, temperature: 0, messages }) });`;
  assert.equal(callSites(pinned)[0].pinned, true, 'a pinned body must read as pinned');

  const ollama = `await fetch(u + '/api/chat', { body: JSON.stringify({ model,
      options: { temperature: 0, num_ctx: 16384 } }) });`;
  assert.equal(callSites(ollama)[0].pinned, true, "ollama's options shape must read as pinned");

  const viaProvider = `const r = await chatComplete(provider, { model, maxTokens,
      messages: [{ role: 'user', content: text }] });`;
  assert.equal(callSites(viaProvider).length, 1, 'a call through the provider interface is a site');
  assert.equal(callSites(viaProvider)[0].pinned, false, 'and it reads as unpinned without a temperature');
  assert.equal(callSites("url = `${base}/v1/messages`;\nbody = { model, temperature: 0 };")[0].pinned, true,
    'the Anthropic Messages endpoint is a site');
});

test('the population is non-empty — a scan that finds nothing proves nothing', () => {
  const files = sources().filter((f) => ENDPOINT.test(readFileSync(f, 'utf8')));
  assert.ok(files.length >= 4,
    `expected several LLM-calling modules, found ${files.length} — the scanner is probably not reaching the tree`);
  const total = files.reduce((n, f) => n + callSites(readFileSync(f, 'utf8')).length, 0);
  assert.ok(total >= 6, `expected several call sites, found ${total}`);
});

// The C10 half of R15: a basis string that HARDCODES the temperature keeps asserting it after the
// call changes. rate-llm writes that string into the adjudication ledger, so the claim and the
// behaviour must come from one value.
test("rate-llm's ledger basis derives its temperature rather than hardcoding it", () => {
  const src = readFileSync(join(REPO, 'bin', 'rate-llm.mjs'), 'utf8');
  assert.match(src, /export const TEMPERATURE = 0;/, 'the single definition must exist');
  assert.match(src, /temperature: TEMPERATURE/, 'the call must read the constant');
  assert.match(src, /temperature \$\{TEMPERATURE\}/, 'the basis string must interpolate the constant');
  assert.doesNotMatch(src, /temperature 0\)/, 'the basis must not hardcode the literal it claims');
});

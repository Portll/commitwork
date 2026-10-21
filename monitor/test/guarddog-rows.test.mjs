// node --test monitor/test/ — _guarddogCounts row detail: GuardDog's real messages open
// `On package: <name> version: <ver>`; an extractor looking only for `name@version` drew a dash
// for 99.6% of rows. Fixture messages are VERBATIM shapes from reports/*/rollup.json.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _guarddogCounts } from '../extractors.mjs';

const withTmp = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-guarddog-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

// A real-shaped guarddog SARIF carrying the given message texts.
function sarif(dir, messages) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'guarddog.sarif'), JSON.stringify({
    runs: [{
      tool: { driver: { name: 'guarddog', rules: messages.map((_, i) => ({ id: `rule-${i}` })) } },
      results: messages.map((m, i) => ({ ruleId: `rule-${i}`, message: { text: m } })),
    }],
  }));
  return dir;
}
// `findings` is asserted, not probed — a rename fails here instead of every test reading []
const rowsOf = (messages) => withTmp((d) => {
  const c = _guarddogCounts(sarif(join(d, 'repo'), messages), 'guarddog.sarif');
  assert.ok(Array.isArray(c.findings), 'detail rows are published under `findings`');
  return c.findings;
});

describe('the package column the supply-chain tab renders', () => {
  test("GuardDog's real message form yields a package and version, not a dash", () => {
    const [r] = rowsOf(['On package: @capacitor/cli version: 6.2.1\nDetects file deletion capabilities in package/dist/ios/build.js']);
    assert.equal(r.package, '@capacitor/cli', 'the scoped name, including the @scope prefix');
    assert.equal(r.version, '6.2.1');
  });

  test('an unscoped package parses the same way', () => {
    const [r] = rowsOf(['On package: wrangler version: 4.42.0\nDetects obfuscated code']);
    assert.equal(r.package, 'wrangler');
    assert.equal(r.version, '4.42.0');
  });

  test('THE REGRESSION GUARD: the two older `name@version` forms still parse', () => {
    // the older shapes must not start reading as empty
    const quoted = rowsOf(["package 'left-pad@0.0.1' looks typosquatted"])[0];
    assert.equal(quoted.package, 'left-pad');
    assert.equal(quoted.version, '0.0.1');
    const bare = rowsOf(['suspicious install script in lodash@4.17.21 detected'])[0];
    assert.equal(bare.package, 'lodash');
    assert.equal(bare.version, '4.17.21');
  });

  test('a message naming no package leaves the fields EMPTY, never guessed', () => {
    // empty is honest — a wrong name beside a real finding is worse than no name
    const [r] = rowsOf(['Detects an obfuscated file somewhere in the tree']);
    assert.equal(r.package, '');
    assert.equal(r.version, '');
  });

  test('the row carries only its declared fields — never spread from the SARIF result', () => {
    // rows cross the published tunnel — build from a declared field list, never spread
    const [r] = rowsOf(['On package: vite version: 5.0.0\nsomething']);
    assert.deepEqual(Object.keys(r).sort(), ['message', 'package', 'rule', 'version']);
  });

  test('the finding count is unchanged by this parse — rows detail findings, they do not create them', () => {
    const msgs = ['On package: a version: 1', 'On package: b version: 2', 'no package here'];
    assert.equal(rowsOf(msgs).length, 3);
  });
});

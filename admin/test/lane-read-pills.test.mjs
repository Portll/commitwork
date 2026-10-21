// laneReadPills (admin/static/panel-core.js) states what a lane did not finish beside its coverage
// pill: files read only in part, and rules the engine could not evaluate. Rule ids come from tool
// output, so they are escaped. Evaluated in a vm with the panel's own esc().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'panel-core.js'), 'utf8');
const slice = (start) => {
  const i = SRC.indexOf(start);
  assert.ok(i >= 0, `${start} is missing from panel-core.js`);
  const end = SRC.indexOf('\n};', i);
  return SRC.slice(i, end === -1 ? SRC.indexOf('\n', i) : end + 3);
};
const ctx = vm.createContext({});
new vm.Script(`${SRC.split('\n').find((l) => l.startsWith('const esc='))}\n${slice('const laneReadPills=')}\nthis.laneReadPills=laneReadPills;`).runInContext(ctx);
const pills = ctx.laneReadPills;

test('nothing unfinished renders nothing, so an older rollup looks as it did', () => {
  assert.equal(pills({}), '');
  assert.equal(pills(null), '');
  assert.equal(pills({ partialAnalysis: { files: 0, repos: 0, byReason: {} } }), '');
});

test('partly read files and rules not run each get a pill with the counts in its title', () => {
  const html = pills({
    partialAnalysis: { repos: 2, files: 55, byReason: { timeout: 54, 'syntax-error': 1 } },
    rulesNotEvaluated: { repos: 3, rules: ['a.rule', 'b.rule'], truncated: 1 },
  });
  assert.match(html, />55 partly read</);
  assert.match(html, /55 file\(s\) in 2 repo\(s\) were read only in part \(54 timeout, 1 syntax-error\)/);
  assert.match(html, />3 rule\(s\) not run</);
  assert.match(html, /a\.rule, b\.rule and 1 more/);
});

test('a hostile rule id is escaped, not rendered', () => {
  const html = pills({ rulesNotEvaluated: { repos: 1, rules: ['"><img src=x onerror=alert(1)>'] } });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

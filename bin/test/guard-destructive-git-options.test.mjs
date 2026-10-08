// guard-destructive: git's global options sit between `git` and the subcommand, and the push rule
// read `git -c k=v push` as something other than a push (review 2026-10-07 D14). One case per option
// shape git accepts there, the false-positive direction asserted separately, and the property that
// makes moving options safe: a `$(…)` inside a moved value is still judged.
//
// Still lexical, and these stay open (the gate's limit, not this fix's): `GIT_DIR=x git push` (an
// assignment prefix without `env`), `command git push`, `\git push`, `/usr/bin/git push`, an alias
// or a function named git, `xargs git push`, and an option span that crosses a line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, normaliseGit } from '../hooks/guard-destructive.mjs';

const decisionOf = (cmd) => judge(cmd)?.decision ?? null;

const PUSH_SHAPES = [
  'git -c k=v push',
  'git -c user.name=x -c core.sshCommand=ssh push origin main',
  'git -c "user.name=a b" push',
  "git -c 'a=b' push",
  'git -C /some/repo push',
  'git -C "/a dir/repo" push',
  'git -C /r -c k=v push',
  'git --git-dir=/r/.git push',
  'git --git-dir /r/.git push',
  'git --work-tree=/r push',
  'git --work-tree /r push',
  'git --namespace ns push',
  'git --config-env name=ENVVAR push',
  'git --attr-source HEAD push',
  'git --no-pager push',
  'git -p push',
  'git -P push',
  'git --paginate push',
  'git --bare push',
  'git --exec-path=/x push',
  'git --no-replace-objects push',
  'git --no-optional-locks push',
  'git --literal-pathspecs push',
  'sudo git -c k=v push',
  'cd /r && git -c k=v push',
  'true; git --no-pager push',
  'echo $(git -c k=v push)',
  'env A=b git -c k=v push',
  'if x; then git -c k=v push; fi',
];

for (const cmd of PUSH_SHAPES) {
  test(`a push behind global options is still a push: ${cmd}`, () => {
    assert.equal(decisionOf(cmd), 'ask');
  });
}

test('a force-push behind global options is still denied', () => {
  for (const cmd of ['git -c k=v push --force origin main', 'git -C /r --no-pager push -f origin main', 'git --git-dir /r/.git push origin +main:main']) {
    assert.equal(decisionOf(cmd), 'deny', cmd);
  }
});

const NOT_A_PUSH = [
  'git -c k=v log --grep push',
  'git -C /r status',
  'git --no-pager log -1 --format=%s',
  'git -c core.pager=cat show HEAD:push.mjs',
  'echo "git -c k=v push"',
  "grep -n 'git -c k=v push' notes.md",
  'npm run push',
];

for (const cmd of NOT_A_PUSH) {
  test(`not a push: ${cmd}`, () => {
    assert.equal(decisionOf(cmd), null);
  });
}

test('options are moved behind the subcommand, never dropped', () => {
  assert.equal(normaliseGit('git -C "/a b" -c k=v push origin'), 'git push -C "/a b" -c k=v origin');
  assert.equal(normaliseGit('git status'), 'git status', 'nothing to move, nothing changed');
  // a substitution inside a moved value still reaches the rm rule; `git status` alone is silent
  assert.equal(decisionOf('git status'), null);
  assert.equal(decisionOf('git -C "$(rm -rf /tmp/scratch)" status'), 'ask');
});

test('a span the normaliser cannot read whole is left as it was', () => {
  for (const cmd of ['git -c "unterminated push', 'git -c k=v\npush', 'git -c']) assert.equal(normaliseGit(cmd), cmd, JSON.stringify(cmd));
});

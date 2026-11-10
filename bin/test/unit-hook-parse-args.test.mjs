// Validated hook options from command-line arguments, with an absolute repo path (bin/hook.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../hook.mjs';
import { resolve } from 'node:path';

const base = (over) => ({
  repo: resolve(process.cwd()), lanes: ['secrets'], unrun: 'block', failOnContext: false,
  blockExisting: false, chain: false, dryRun: false, json: false, ...over,
});

test('returns the defaults with the current directory as repo when no arguments are given', () => {
  assert.deepEqual(parseArgs([]), base({}));
});

test('takes the repo from --repo or -r and resolves it to an absolute path', () => {
  assert.deepEqual(parseArgs(['--repo', '/tmp/r']), base({ repo: '/tmp/r' }));
  assert.deepEqual(parseArgs(['-r', '/tmp/a/../b']), base({ repo: '/tmp/b' }));
});

test('takes a relative repo from the --repo= form and resolves it against the current directory', () => {
  assert.deepEqual(parseArgs(['--repo=sub/dir']), base({ repo: resolve(process.cwd(), 'sub/dir') }));
});

test('splits --lanes on commas, trims each name and drops empty ones', () => {
  assert.deepEqual(parseArgs(['--lanes', ' gitleaks , ,secrets']), base({ lanes: ['gitleaks', 'secrets'] }));
});

test('reads lanes and unrun from the --lanes= and --unrun= forms', () => {
  assert.deepEqual(parseArgs(['--lanes=gitleaks', '--unrun=warn']), base({ lanes: ['gitleaks'], unrun: 'warn' }));
});

test('reads unrun from the value after --unrun', () => {
  assert.deepEqual(parseArgs(['--unrun', 'warn']), base({ unrun: 'warn' }));
  assert.deepEqual(parseArgs(['--unrun', 'block']), base({}));
});

test('sets only chain for --chain and only blockExisting for --block-existing', () => {
  assert.deepEqual(parseArgs(['--chain']), base({ chain: true }));
  assert.deepEqual(parseArgs(['--block-existing']), base({ blockExisting: true }));
});

test('sets failOnContext, dryRun and json for their flags', () => {
  assert.deepEqual(parseArgs(['--fail-on-context', '--dry-run', '--json']),
    base({ failOnContext: true, dryRun: true, json: true }));
});

test('rejects a flag missing its value and an unknown argument', () => {
  assert.throws(() => parseArgs(['--repo']), { name: 'Error', message: '--repo needs a value' });
  assert.throws(() => parseArgs(['--unrun']), { name: 'Error', message: '--unrun needs a value' });
  assert.throws(() => parseArgs(['--json', '--jsonx']), { name: 'Error', message: 'unknown argument: --jsonx' });
});

test('rejects an unknown lane, an empty lane list and an unrun other than block or warn', () => {
  assert.throws(() => parseArgs(['--lanes', 'secrets,bogus']),
    { name: 'Error', message: "unknown lane 'bogus' (lanes: secrets, gitleaks)" });
  assert.throws(() => parseArgs(['--lanes', ' , ']), { name: 'Error', message: '--lanes names no lane' });
  assert.throws(() => parseArgs(['--unrun=Block']), { name: 'Error', message: "--unrun is block or warn, not 'Block'" });
});

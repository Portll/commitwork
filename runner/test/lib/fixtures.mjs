// Recorded-shape GitHub fixtures (synthetic owners) and builders for the runner tests.
import { readFileSync } from 'node:fs';
import { validateConfig } from '../../config.mjs';

const DIR = new URL('../fixtures/', import.meta.url);

export const fixture = (name) => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
export const PRIVATE = 'example-owner/example-private';
export const PUBLIC = 'example-owner/example-public';
export const NOW = Date.parse('2026-10-22T09:10:00Z');

/** The shipped example config doubles as the test config. */
export const exampleConfig = (over = {}) => validateConfig({
  ...JSON.parse(readFileSync(new URL('../../runner.example.json', import.meta.url), 'utf8')),
  ...over,
}, { arch: 'arm64' });

const side = (repo) => ({ id: 700000002, full_name: repo, private: true });

export function makeRun({ repo = PRIVATE, ...over } = {}) {
  const run = fixture('runs-queued.json').workflow_runs[0];
  return { ...run, repository: side(repo), head_repository: side(repo), ...over };
}

export const makeJob = (over = {}) => ({ ...fixture('jobs.json').jobs[0], ...over });

export const CLEAN = `name: CI
on: [push, pull_request]
permissions: { contents: read }
jobs:
  build:
    runs-on: [self-hosted, linux, arm64, commitwork]
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;

/** A workflow whose build job carries extra lines under it. */
export const withBuild = (lines) => CLEAN.replace('    steps:\n', `${lines}\n    steps:\n`);
export const withStep = (line) => `${CLEAN}      ${line}\n`;

/** A snapshot for one repo with one queued run of the given jobs. */
export function repoSnapshot({ run = makeRun(), jobs = [makeJob()], text = CLEAN, meta, runners = [] } = {}) {
  return {
    meta: meta || fixture('repo-private.json'),
    policy: null,
    queuedRuns: [{ run, jobs }],
    workflowTexts: { [`${run.path}@${run.head_sha}`]: text },
    actionTexts: {},
    runners,
  };
}

/** A contents-API body for a text. */
export const contentsBody = (text) => ({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') });

/** A fetch that answers from `handler(url, init)` → { status, body, headers } and records each call. */
export function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body, headers = {} } = await handler(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  };
  fetch.calls = calls;
  return fetch;
}

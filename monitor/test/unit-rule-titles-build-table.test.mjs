// Builds a table of rule titles from ShellCheck and Hadolint documents (monitor/rule-titles.mjs buildTable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTable } from '../rule-titles.mjs';

const scHtml = '<li><a href="SC1000">SC1000</a>&ndash; A title</li>';
const dlMd = '| [DL3000] | x | y | A title |';

test('returns table with valid inputs', () => {
  const input = { shellcheckHtml: scHtml, hadolintMd: dlMd, retrieved: '2024-01-01' };
  const result = buildTable(input);
  assert.deepEqual(result, { about: "One line per rule code, as each tool publishes it. Built by node monitor/rule-titles.mjs from the documents named in sources; never edited by hand.", sources: { hadolint: { url: "https://github.com/hadolint/hadolint/blob/master/README.md#rules", retrieved: "2024-01-01", codes: 1 }, shellcheck: { url: "https://www.shellcheck.net/wiki/", retrieved: "2024-01-01", codes: 1 } }, titles: { hadolint: { DL3000: "y" }, shellcheck: { SC1000: "A title" } } });
});

test('rejects empty retrieved', () => {
  const input = { shellcheckHtml: scHtml, hadolintMd: dlMd, retrieved: '' };
  assert.throws(() => buildTable(input), { name: 'Error', message: 'retrieved must be YYYY-MM-DD, got ' });
});

test('rejects retrieved with five digit year', () => {
  const input = { shellcheckHtml: scHtml, hadolintMd: dlMd, retrieved: '12345-01-01' };
  assert.throws(() => buildTable(input), { name: 'Error', message: 'retrieved must be YYYY-MM-DD, got 12345-01-01' });
});

test('rejects retrieved with three digit month', () => {
  const input = { shellcheckHtml: scHtml, hadolintMd: dlMd, retrieved: '2024-011-01' };
  assert.throws(() => buildTable(input), { name: 'Error', message: 'retrieved must be YYYY-MM-DD, got 2024-011-01' });
});

test('rejects retrieved with three digit day', () => {
  const input = { shellcheckHtml: scHtml, hadolintMd: dlMd, retrieved: '2024-01-011' };
  assert.throws(() => buildTable(input), { name: 'Error', message: 'retrieved must be YYYY-MM-DD, got 2024-01-011' });
});

test('rejects empty shellcheck sitemap', () => {
  const input = { shellcheckHtml: '', hadolintMd: dlMd, retrieved: '2024-01-01' };
  assert.throws(() => buildTable(input), { name: 'Error', message: 'no ShellCheck codes found in the sitemap' });
});

test('rejects empty hadolint readme', () => {
  const input = { shellcheckHtml: scHtml, hadolintMd: '', retrieved: '2024-01-01' };
  assert.throws(() => buildTable(input), { name: 'Error', message: "no rules found in hadolint's README" });
});

// Parses ShellCheck sitemap HTML into a map of rule codes to titles (monitor/rule-titles.mjs parseShellcheckSitemap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShellcheckSitemap } from '../rule-titles.mjs';

test('returns empty object for empty string', () => {
  const input = '';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, {});
});

test('returns empty object for null', () => {
  const input = null;
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, {});
});

test('returns empty object for undefined', () => {
  const input = undefined;
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, {});
});

test('parses single rule with &ndash; entity', () => {
  const input = '<li><a href="SC1000">SC1000</a> &ndash; Title one</li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1000: "Title one" });
});

test('parses single rule with unicode ndash', () => {
  const input = '<li><a href="SC1001">SC1001</a> \u2013 Title two</li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1001: "Title two" });
});

test('parses multiple rules', () => {
  const input = '<li><a href="SC1000">SC1000</a> &ndash; First</li><li><a href="SC1001">SC1001</a> \u2013 Second</li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1000: "First", SC1001: "Second" });
});

test('strips inner HTML tags from title', () => {
  const input = '<li><a href="SC1002">SC1002</a> &ndash; <b>Bold</b> and <i>italic</i></li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1002: "Bold and italic" });
});

test('decodes named entities in title', () => {
  const input = '<li><a href="SC1003">SC1003</a> &ndash; &amp; &lt; &gt; &quot; &apos; &nbsp; &ndash; &mdash; &hellip;</li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1003: "& < > \" ' \u2013 \u2014 \u2026" });
});

test('decodes numeric decimal entities in title', () => {
  const input = '<li><a href="SC1004">SC1004</a> &ndash; &#65; &#97;</li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1004: "A a" });
});

test('decodes numeric hex entities in title', () => {
  const input = '<li><a href="SC1005">SC1005</a> &ndash; &#x41; &#x61;</li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1005: "A a" });
});

test('collapses whitespace in title', () => {
  const input = '<li><a href="SC1006">SC1006</a> &ndash;   spaced   out   </li>';
  const result = parseShellcheckSitemap(input);
  assert.deepEqual(result, { SC1006: "spaced out" });
});

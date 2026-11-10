// Parses a plist XML string into a JavaScript object (monitor/update-vulns.mjs parsePlistXml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlistXml } from '../update-vulns.mjs';

test('parses a simple dictionary with a string value', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>name</key><string>hello</string></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { plist: { name: "hello" } });
});

test('parses a dictionary with an integer value', () => {
  const xml = '<plist version="1.0"><dict><key>count</key><integer>42</integer></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { plist: { count: 42 } });
});

test('parses a dictionary with a real value', () => {
  const xml = '<plist version="1.0"><dict><key>ratio</key><real>3.14</real></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { plist: { ratio: 3.14 } });
});

test('parses a dictionary with a boolean true value', () => {
  const xml = '<plist version="1.0"><dict><key>flag</key><true/></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { plist: { flag: true } });
});

test('parses a dictionary with a boolean false value', () => {
  const xml = '<plist version="1.0"><dict><key>flag</key><false/></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { plist: { flag: false } });
});

test('parses a dictionary with an array of strings', () => {
  const xml = '<plist version="1.0"><dict><key>items</key><array><string>a</string><string>b</string></array></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { plist: { items: ["a", "b"] } });
});

test('decodes XML entities in string values', () => {
  const xml = '<plist version="1.0"><dict><key>msg</key><string>&lt;tag&gt; &amp; &quot;quoted&quot;</string></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { plist: { msg: "<tag> & \"quoted\"" } });
});

test('returns unknown for unparseable input', () => {
  const r = parsePlistXml('not xml at all');
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "the plist root is not a dictionary" });
});

test('returns unknown when root is not a dictionary', () => {
  const xml = '<plist version="1.0"><string>just a string</string></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "the plist root is not a dictionary" });
});

test('throws for non-key element inside dict', () => {
  const xml = '<plist version="1.0"><dict><string>oops</string></dict></plist>';
  const r = parsePlistXml(xml);
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "plist did not parse (expected <key> in <dict>, found <string>) \u2014 UNKNOWN, not an empty preference file" });
});

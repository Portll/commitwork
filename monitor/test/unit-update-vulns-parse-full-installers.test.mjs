// Parses softwareupdate --list-full-installers output into rows (monitor/update-vulns.mjs parseFullInstallers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFullInstallers } from '../update-vulns.mjs';

test('parses a single full installer row with deferred yes', () => {
  const text = '  * Title: macOS 15.1, Version: 15.1, Size: 1.2 GB, Build: 24B923, Deferred: yes';
  assert.deepEqual(parseFullInstallers(text), { rows: [{ source: "full-installer", title: "macOS 15.1", version: "15.1", build: "24B923", deferred: true, beta: false }] });
});

test('parses a row without size and with deferred no', () => {
  const text = '  * Title: macOS 15.1, Version: 15.1, Build: 24B923, Deferred: no';
  assert.deepEqual(parseFullInstallers(text), { rows: [{ source: "full-installer", title: "macOS 15.1", version: "15.1", build: "24B923", deferred: false, beta: false }] });
});

test('parses a row without size and without deferred', () => {
  const text = '  * Title: macOS 15.1, Version: 15.1, Build: 24B923';
  assert.deepEqual(parseFullInstallers(text), { rows: [{ source: "full-installer", title: "macOS 15.1", version: "15.1", build: "24B923", deferred: false, beta: false }] });
});

test('detects beta in title', () => {
  const text = '  * Title: macOS 15.1 Beta, Version: 15.1, Build: 24B923';
  assert.deepEqual(parseFullInstallers(text), { rows: [{ source: "full-installer", title: "macOS 15.1 Beta", version: "15.1", build: "24B923", deferred: false, beta: true }] });
});

test('detects seed in title', () => {
  const text = '  * Title: macOS 15.1 Seed, Version: 15.1, Build: 24B923';
  assert.deepEqual(parseFullInstallers(text), { rows: [{ source: "full-installer", title: "macOS 15.1 Seed", version: "15.1", build: "24B923", deferred: false, beta: true }] });
});

test('returns unknown when header present but no rows parse', () => {
  const text = 'Found the following full installers:\n  * Title: Bad, Version: 1';
  assert.deepEqual(parseFullInstallers(text), { unknown: true, unknownReason: "unparseable", unknownDetail: "softwareupdate announced full installers and none of its rows parsed \u2014 UNKNOWN, not \"no installers\"" });
});

test('returns unknown when no header and no rows', () => {
  const text = '  * Title: Bad, Version: 1';
  assert.deepEqual(parseFullInstallers(text), { unknown: true, unknownReason: "unparseable", unknownDetail: "softwareupdate --list-full-installers produced neither its header nor a parseable row \u2014 UNKNOWN, not empty" });
});

test('parses multiple rows', () => {
  const text = [
    '  * Title: macOS 15.1, Version: 15.1, Size: 1.2 GB, Build: 24B923, Deferred: yes',
    '  * Title: macOS 15.2, Version: 15.2, Build: 24C923'
  ].join('\n');
  assert.deepEqual(parseFullInstallers(text), { rows: [{ source: "full-installer", title: "macOS 15.1", version: "15.1", build: "24B923", deferred: true, beta: false }, { source: "full-installer", title: "macOS 15.2", version: "15.2", build: "24C923", deferred: false, beta: false }] });
});

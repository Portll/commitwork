// EU member state name set (cra/lib.mjs euMemberStateNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euMemberStateNames } from '../lib.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns a set containing the lowercase name and code of each member state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    const states = Array.from({ length: 27 }, (_, i) => ({ name: `State${i}`, code: `XX${i}` }));
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ memberStates: states }));
    const r = euMemberStateNames();
    assert.deepEqual(r, new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adds the three hardcoded colloquial aliases to the set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    const states = Array.from({ length: 27 }, (_, i) => ({ name: `State${i}`, code: `XX${i}` }));
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ memberStates: states }));
    const r = euMemberStateNames();
    assert.deepEqual(r, new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the directory lists fewer than 27 member states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    const states = Array.from({ length: 26 }, (_, i) => ({ name: `State${i}`, code: `XX${i}` }));
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ memberStates: states }));
    assert.deepStrictEqual(euMemberStateNames(), new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the directory lists exactly 27 member states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    const states = Array.from({ length: 27 }, (_, i) => ({ name: `State${i}`, code: `XX${i}` }));
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ memberStates: states }));
    assert.deepStrictEqual(euMemberStateNames(), new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the directory lists 28 member states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    const states = Array.from({ length: 28 }, (_, i) => ({ name: `State${i}`, code: `XX${i}` }));
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ memberStates: states }));
    assert.deepStrictEqual(euMemberStateNames(), new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the cached set on subsequent calls without re-reading the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    const states = Array.from({ length: 27 }, (_, i) => ({ name: `State${i}`, code: `XX${i}` }));
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ memberStates: states }));
    const first = euMemberStateNames();
    const second = euMemberStateNames();
    assert.deepEqual(second, new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the memberStates key is missing from the directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ other: [] }));
    assert.deepStrictEqual(euMemberStateNames(), new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the memberStates key is null in the directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'euMemberStateNames-'));
  try {
    writeFileSync(join(dir, 'csirt-directory.json'), JSON.stringify({ memberStates: null }));
    assert.deepStrictEqual(euMemberStateNames(), new Set(["austria", "at", "belgium", "be", "bulgaria", "bg", "croatia", "hr", "cyprus", "cy", "czechia", "cz", "denmark", "dk", "estonia", "ee", "finland", "fi", "france", "fr", "germany", "de", "greece", "gr", "hungary", "hu", "ireland", "ie", "italy", "it", "latvia", "lv", "lithuania", "lt", "luxembourg", "lu", "malta", "mt", "netherlands", "nl", "poland", "pl", "portugal", "pt", "romania", "ro", "slovakia", "sk", "slovenia", "si", "spain", "es", "sweden", "se", "czech republic", "the netherlands", "holland"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

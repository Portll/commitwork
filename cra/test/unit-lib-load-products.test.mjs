// Maps a products document to a lookup of products by repository (cra/lib.mjs loadProducts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProducts } from '../lib.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the document, products, byRepo map, and manufacturer when products is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'products.json');
    writeFileSync(p, JSON.stringify({ products: [{ name: 'a', repos: ['r1'] }], manufacturer: { id: 'm1' } }));
    const r = loadProducts(p);
    assert.deepEqual(r, { doc: { products: [{ name: "a", repos: ["r1"] }], manufacturer: { id: "m1" } }, products: [{ name: "a", repos: ["r1"] }], byRepo: new Map([["r1", [{ name: "a", repos: ["r1"] }]]]), manufacturer: { id: "m1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when products is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'products.json');
    writeFileSync(p, JSON.stringify({ products: { name: 'a' } }));
    assert.throws(() => loadProducts(p), { name: 'Error', message: `${p}: products[] missing` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builds byRepo with empty array for a product that has no repos property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'products.json');
    writeFileSync(p, JSON.stringify({ products: [{ name: 'a' }] }));
    const r = loadProducts(p);
    assert.deepEqual(r, { doc: { products: [{ name: "a" }] }, products: [{ name: "a" }], byRepo: new Map([]), manufacturer: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builds byRepo with empty array for a product whose repos is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'products.json');
    writeFileSync(p, JSON.stringify({ products: [{ name: 'a', repos: null }] }));
    const r = loadProducts(p);
    assert.deepEqual(r, { doc: { products: [{ name: "a", repos: null }] }, products: [{ name: "a", repos: null }], byRepo: new Map([]), manufacturer: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps each repository to the products that list it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'products.json');
    writeFileSync(p, JSON.stringify({ products: [{ name: 'a', repos: ['r1', 'r2'] }, { name: 'b', repos: ['r1'] }] }));
    const r = loadProducts(p);
    assert.deepEqual(r, { doc: { products: [{ name: "a", repos: ["r1", "r2"] }, { name: "b", repos: ["r1"] }] }, products: [{ name: "a", repos: ["r1", "r2"] }, { name: "b", repos: ["r1"] }], byRepo: new Map([["r1", [{ name: "a", repos: ["r1", "r2"] }, { name: "b", repos: ["r1"] }]], ["r2", [{ name: "a", repos: ["r1", "r2"] }]]]), manufacturer: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaults manufacturer to an empty object when the document has no manufacturer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'products.json');
    writeFileSync(p, JSON.stringify({ products: [{ name: 'a', repos: ['r1'] }] }));
    const r = loadProducts(p);
    assert.deepEqual(r, { doc: { products: [{ name: "a", repos: ["r1"] }] }, products: [{ name: "a", repos: ["r1"] }], byRepo: new Map([["r1", [{ name: "a", repos: ["r1"] }]]]), manufacturer: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaults manufacturer to an empty object when manufacturer is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'products.json');
    writeFileSync(p, JSON.stringify({ products: [{ name: 'a', repos: ['r1'] }], manufacturer: null }));
    const r = loadProducts(p);
    assert.deepEqual(r, { doc: { products: [{ name: "a", repos: ["r1"] }], manufacturer: null }, products: [{ name: "a", repos: ["r1"] }], byRepo: new Map([["r1", [{ name: "a", repos: ["r1"] }]]]), manufacturer: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadProducts-'));
  try {
    const p = join(dir, 'missing.json');
    assert.throws(() => loadProducts(p), { name: 'Error', message: `could not read ${p}: ENOENT: no such file or directory, open '${p}'` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

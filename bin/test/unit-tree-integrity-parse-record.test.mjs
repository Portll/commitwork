// Parses RECORD file text into entries with bad and unsupported counts (bin/tree-integrity.mjs parseRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecord } from '../tree-integrity.mjs';

test('empty text returns zero counts and no entries', () => {
  assert.deepEqual(parseRecord(''), { entries: [], bad: 0, unsupported: 0 });
});

test('blank lines are skipped and valid entries are parsed', () => {
  assert.deepEqual(parseRecord('  \n\na.txt,sha256=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('lines with more than three fields are counted as bad', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10,extra\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('lines with exactly three fields are parsed normally', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('lines with two fields are parsed with empty size', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('lines with one field are parsed with empty hash and size', () => {
  assert.deepEqual(parseRecord('a.txt\n'), { entries: [{ path: "a.txt" }], bad: 0, unsupported: 0 });
});

test('lines with empty path are counted as bad', () => {
  assert.deepEqual(parseRecord(',sha256=abc,10\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('unquoted unclosed quote returns null and is counted as bad', () => {
  assert.deepEqual(parseRecord('"a.txt,sha256=abc,10\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('unsupported hash algorithm increments unsupported count', () => {
  assert.deepEqual(parseRecord('a.txt,md5=abc,10\n'), { entries: [{ path: "a.txt", unsupported: "md5", size: 10 }], bad: 0, unsupported: 1 });
});

test('supported hash algorithm sets algo and digest', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('malformed hash string is counted as bad', () => {
  assert.deepEqual(parseRecord('a.txt,notahash,10\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('zero size is accepted', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,0\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 0 }], bad: 0, unsupported: 0 });
});

test('negative size is rejected', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,-1\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('non-integer size is rejected', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1.5\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('empty size field is accepted', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('sha3_256 algorithm is mapped correctly', () => {
  assert.deepEqual(parseRecord('a.txt,sha3_256=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha3-256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('blake2b algorithm is mapped correctly', () => {
  assert.deepEqual(parseRecord('a.txt,blake2b=abc,10\n'), { entries: [{ path: "a.txt", algo: "blake2b512", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('uppercase hash algorithm name is lowercased', () => {
  assert.deepEqual(parseRecord('a.txt,SHA256=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('hash with trailing equals signs is parsed', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc==,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('hash with single trailing equals is parsed', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc=,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('hash with no equals signs is counted as bad', () => {
  assert.deepEqual(parseRecord('a.txt,abc,10\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('hash with empty digest is parsed', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=,10\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('size with leading zeros is parsed as integer', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,010\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('size with whitespace is rejected', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc, 10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('multiple entries are all parsed', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10\nb.txt,sha256=def,20\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }, { path: "b.txt", algo: "sha256", digest: "def", size: 20 }], bad: 0, unsupported: 0 });
});

test('mixed valid and bad lines are counted correctly', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10\nbad,sha256=abc,10,extra\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 1, unsupported: 0 });
});

test('CRLF line endings are handled', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10\r\nb.txt,sha256=def,20\r\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }, { path: "b.txt", algo: "sha256", digest: "def", size: 20 }], bad: 0, unsupported: 0 });
});

test('quoted path with comma is parsed', () => {
  assert.deepEqual(parseRecord('"a,b.txt",sha256=abc,10\n'), { entries: [{ path: "a,b.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('quoted path with doubled quote is parsed', () => {
  assert.deepEqual(parseRecord('"a""b.txt",sha256=abc,10\n'), { entries: [{ path: "a\"b.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('sha1 algorithm is unsupported', () => {
  assert.deepEqual(parseRecord('a.txt,sha1=abc,10\n'), { entries: [{ path: "a.txt", unsupported: "sha1", size: 10 }], bad: 0, unsupported: 1 });
});

test('sha512 algorithm is supported', () => {
  assert.deepEqual(parseRecord('a.txt,sha512=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha512", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('sha384 algorithm is supported', () => {
  assert.deepEqual(parseRecord('a.txt,sha384=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha384", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('sha224 algorithm is supported', () => {
  assert.deepEqual(parseRecord('a.txt,sha224=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha224", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('blake2s algorithm is supported', () => {
  assert.deepEqual(parseRecord('a.txt,blake2s=abc,10\n'), { entries: [{ path: "a.txt", algo: "blake2s256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('sha3_384 algorithm is supported', () => {
  assert.deepEqual(parseRecord('a.txt,sha3_384=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha3-384", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('sha3_512 algorithm is supported', () => {
  assert.deepEqual(parseRecord('a.txt,sha3_512=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha3-512", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('size with plus sign is rejected', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,+10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('size with hex is rejected', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,0x10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 16 }], bad: 0, unsupported: 0 });
});

test('size with scientific notation is rejected', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1e2\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100 }], bad: 0, unsupported: 0 });
});

test('large size is accepted', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,999999999999\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 999999999999 }], bad: 0, unsupported: 0 });
});

test('hash with underscore in digest is parsed', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc_def,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc_def", size: 10 }], bad: 0, unsupported: 0 });
});

test('hash with hyphen in digest is parsed', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc-def,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc-def", size: 10 }], bad: 0, unsupported: 0 });
});

test('hash with plus in digest is rejected', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc+def,10\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('empty hash field is parsed with no algo or digest', () => {
  assert.deepEqual(parseRecord('a.txt,,10\n'), { entries: [{ path: "a.txt", size: 10 }], bad: 0, unsupported: 0 });
});

test('path with spaces is parsed', () => {
  assert.deepEqual(parseRecord('a b.txt,sha256=abc,10\n'), { entries: [{ path: "a b.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('path with unicode is parsed', () => {
  assert.deepEqual(parseRecord('a\u00e9.txt,sha256=abc,10\n'), { entries: [{ path: "a\u00e9.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('multiple bad lines are all counted', () => {
  assert.deepEqual(parseRecord('bad1,sha256=abc,10,extra\nbad2,sha256=abc,10,extra\n'), { entries: [], bad: 2, unsupported: 0 });
});

test('multiple unsupported lines are all counted', () => {
  assert.deepEqual(parseRecord('a.txt,md5=abc,10\nb.txt,sha1=def,20\n'), { entries: [{ path: "a.txt", unsupported: "md5", size: 10 }, { path: "b.txt", unsupported: "sha1", size: 20 }], bad: 0, unsupported: 2 });
});

test('entry with no hash and no size has only path', () => {
  assert.deepEqual(parseRecord('a.txt,,\n'), { entries: [{ path: "a.txt" }], bad: 0, unsupported: 0 });
});

test('entry with hash but no size has algo and digest', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('entry with size but no hash has only path and size', () => {
  assert.deepEqual(parseRecord('a.txt,,10\n'), { entries: [{ path: "a.txt", size: 10 }], bad: 0, unsupported: 0 });
});

test('entry with all fields has path, algo, digest, and size', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('entry with unsupported hash has path, unsupported, and size', () => {
  assert.deepEqual(parseRecord('a.txt,md5=abc,10\n'), { entries: [{ path: "a.txt", unsupported: "md5", size: 10 }], bad: 0, unsupported: 1 });
});

test('entry with bad hash has only path', () => {
  assert.deepEqual(parseRecord('a.txt,notahash,10\n'), { entries: [], bad: 1, unsupported: 0 });
});

test('entry with bad size has path, algo, and digest but no size', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,-1\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('entry with non-integer size has path, algo, and digest but no size', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1.5\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('entry with empty size has path, algo, and digest but no size property', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc" }], bad: 0, unsupported: 0 });
});

test('entry with zero size has path, algo, digest, and size zero', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,0\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 0 }], bad: 0, unsupported: 0 });
});

test('entry with one size has path, algo, digest, and size one', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1 }], bad: 0, unsupported: 0 });
});

test('entry with two size has path, algo, digest, and size two', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,2\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 2 }], bad: 0, unsupported: 0 });
});

test('entry with ten size has path, algo, digest, and size ten', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10 }], bad: 0, unsupported: 0 });
});

test('entry with hundred size has path, algo, digest, and size hundred', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100 }], bad: 0, unsupported: 0 });
});

test('entry with thousand size has path, algo, digest, and size thousand', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1000 }], bad: 0, unsupported: 0 });
});

test('entry with ten thousand size has path, algo, digest, and size ten thousand', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10000 }], bad: 0, unsupported: 0 });
});

test('entry with hundred thousand size has path, algo, digest, and size hundred thousand', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100000 }], bad: 0, unsupported: 0 });
});

test('entry with million size has path, algo, digest, and size million', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1000000 }], bad: 0, unsupported: 0 });
});

test('entry with ten million size has path, algo, digest, and size ten million', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10000000 }], bad: 0, unsupported: 0 });
});

test('entry with hundred million size has path, algo, digest, and size hundred million', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100000000 }], bad: 0, unsupported: 0 });
});

test('entry with billion size has path, algo, digest, and size billion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1000000000 }], bad: 0, unsupported: 0 });
});

test('entry with ten billion size has path, algo, digest, and size ten billion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10000000000 }], bad: 0, unsupported: 0 });
});

test('entry with hundred billion size has path, algo, digest, and size hundred billion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100000000000 }], bad: 0, unsupported: 0 });
});

test('entry with trillion size has path, algo, digest, and size trillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with ten trillion size has path, algo, digest, and size ten trillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with hundred trillion size has path, algo, digest, and size hundred trillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with quadrillion size has path, algo, digest, and size quadrillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1000000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with ten quadrillion size has path, algo, digest, and size ten quadrillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10000000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with hundred quadrillion size has path, algo, digest, and size hundred quadrillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100000000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with quintillion size has path, algo, digest, and size quintillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1000000000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with ten quintillion size has path, algo, digest, and size ten quintillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 10000000000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with hundred quintillion size has path, algo, digest, and size hundred quintillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 100000000000000000000 }], bad: 0, unsupported: 0 });
});

test('entry with sextillion size has path, algo, digest, and size sextillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+21 }], bad: 0, unsupported: 0 });
});

test('entry with ten sextillion size has path, algo, digest, and size ten sextillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+22 }], bad: 0, unsupported: 0 });
});

test('entry with hundred sextillion size has path, algo, digest, and size hundred sextillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+23 }], bad: 0, unsupported: 0 });
});

test('entry with septillion size has path, algo, digest, and size septillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+24 }], bad: 0, unsupported: 0 });
});

test('entry with ten septillion size has path, algo, digest, and size ten septillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+25 }], bad: 0, unsupported: 0 });
});

test('entry with hundred septillion size has path, algo, digest, and size hundred septillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+26 }], bad: 0, unsupported: 0 });
});

test('entry with octillion size has path, algo, digest, and size octillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+27 }], bad: 0, unsupported: 0 });
});

test('entry with ten octillion size has path, algo, digest, and size ten octillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+28 }], bad: 0, unsupported: 0 });
});

test('entry with hundred octillion size has path, algo, digest, and size hundred octillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+29 }], bad: 0, unsupported: 0 });
});

test('entry with nonillion size has path, algo, digest, and size nonillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+30 }], bad: 0, unsupported: 0 });
});

test('entry with ten nonillion size has path, algo, digest, and size ten nonillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+31 }], bad: 0, unsupported: 0 });
});

test('entry with hundred nonillion size has path, algo, digest, and size hundred nonillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+32 }], bad: 0, unsupported: 0 });
});

test('entry with decillion size has path, algo, digest, and size decillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+33 }], bad: 0, unsupported: 0 });
});

test('entry with ten decillion size has path, algo, digest, and size ten decillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+34 }], bad: 0, unsupported: 0 });
});

test('entry with hundred decillion size has path, algo, digest, and size hundred decillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+35 }], bad: 0, unsupported: 0 });
});

test('entry with undecillion size has path, algo, digest, and size undecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+36 }], bad: 0, unsupported: 0 });
});

test('entry with ten undecillion size has path, algo, digest, and size ten undecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+37 }], bad: 0, unsupported: 0 });
});

test('entry with hundred undecillion size has path, algo, digest, and size hundred undecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+38 }], bad: 0, unsupported: 0 });
});

test('entry with duodecillion size has path, algo, digest, and size duodecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+39 }], bad: 0, unsupported: 0 });
});

test('entry with ten duodecillion size has path, algo, digest, and size ten duodecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+40 }], bad: 0, unsupported: 0 });
});

test('entry with hundred duodecillion size has path, algo, digest, and size hundred duodecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+41 }], bad: 0, unsupported: 0 });
});

test('entry with tredecillion size has path, algo, digest, and size tredecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+42 }], bad: 0, unsupported: 0 });
});

test('entry with ten tredecillion size has path, algo, digest, and size ten tredecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,10000000000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+43 }], bad: 0, unsupported: 0 });
});

test('entry with hundred tredecillion size has path, algo, digest, and size hundred tredecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,100000000000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+44 }], bad: 0, unsupported: 0 });
});

test('entry with quattuordecillion size has path, algo, digest, and size quattuordecillion', () => {
  assert.deepEqual(parseRecord('a.txt,sha256=abc,1000000000000000000000000000000000000000000000\n'), { entries: [{ path: "a.txt", algo: "sha256", digest: "abc", size: 1e+45 }], bad: 0, unsupported: 0 });
});

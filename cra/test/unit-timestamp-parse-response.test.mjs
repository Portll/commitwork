// Parses a DER-encoded TimeStampResp into status, statusCode, statusText, and token (cra/timestamp.mjs parseResponse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse } from '../timestamp.mjs';

test('parses a granted response with a status text sequence', () => {
  const text = 'granted';
  const textBytes = Buffer.from(text, 'utf8');
  const textOctet = Buffer.concat([Buffer.from([0x0c, textBytes.length]), textBytes]);
  const statusSeq = Buffer.concat([Buffer.from([0x30, textOctet.length]), textOctet]);
  const pkistatus = Buffer.from([0x02, 0x01, 0x00]);
  const statusInfo = Buffer.concat([Buffer.from([0x30, pkistatus.length + statusSeq.length]), pkistatus, statusSeq]);
  const token = Buffer.from([0x30, 0x02, 0x05, 0x00]);
  const top = Buffer.concat([Buffer.from([0x30, statusInfo.length + token.length]), statusInfo, token]);
  const result = parseResponse(top);
  assert.deepEqual(result, {
    status: 'granted',
    statusCode: 0,
    statusText: 'granted',
    token: token
  });
});

test('parses a rejection response without a status text', () => {
  const pkistatus = Buffer.from([0x02, 0x01, 0x02]);
  const statusInfo = Buffer.concat([Buffer.from([0x30, pkistatus.length]), pkistatus]);
  const token = Buffer.from([0x30, 0x02, 0x05, 0x00]);
  const top = Buffer.concat([Buffer.from([0x30, statusInfo.length + token.length]), statusInfo, token]);
  const result = parseResponse(top);
  assert.deepEqual(result, {
    status: 'rejection',
    statusCode: 2,
    statusText: null,
    token: token
  });
});

test('parses a waiting response with multiple status text entries', () => {
  const text1 = 'waiting';
  const text2 = 'retry';
  const text1Bytes = Buffer.from(text1, 'utf8');
  const text2Bytes = Buffer.from(text2, 'utf8');
  const text1Octet = Buffer.concat([Buffer.from([0x0c, text1Bytes.length]), text1Bytes]);
  const text2Octet = Buffer.concat([Buffer.from([0x0c, text2Bytes.length]), text2Bytes]);
  const statusSeq = Buffer.concat([Buffer.from([0x30, text1Octet.length + text2Octet.length]), text1Octet, text2Octet]);
  const pkistatus = Buffer.from([0x02, 0x01, 0x03]);
  const statusInfo = Buffer.concat([Buffer.from([0x30, pkistatus.length + statusSeq.length]), pkistatus, statusSeq]);
  const token = Buffer.from([0x30, 0x02, 0x05, 0x00]);
  const top = Buffer.concat([Buffer.from([0x30, statusInfo.length + token.length]), statusInfo, token]);
  const result = parseResponse(top);
  assert.deepEqual(result, {
    status: 'waiting',
    statusCode: 3,
    statusText: 'waiting; retry',
    token: token
  });
});

test('parses a revocation warning response with a null token', () => {
  const pkistatus = Buffer.from([0x02, 0x01, 0x04]);
  const statusInfo = Buffer.concat([Buffer.from([0x30, pkistatus.length]), pkistatus]);
  const top = Buffer.concat([Buffer.from([0x30, statusInfo.length]), statusInfo]);
  const result = parseResponse(top);
  assert.deepEqual(result, {
    status: 'revocationWarning',
    statusCode: 4,
    statusText: null,
    token: null
  });
});

test('parses a revocation notification response with a status text', () => {
  const text = 'revoked';
  const textBytes = Buffer.from(text, 'utf8');
  const textOctet = Buffer.concat([Buffer.from([0x0c, textBytes.length]), textBytes]);
  const statusSeq = Buffer.concat([Buffer.from([0x30, textOctet.length]), textOctet]);
  const pkistatus = Buffer.from([0x02, 0x01, 0x05]);
  const statusInfo = Buffer.concat([Buffer.from([0x30, pkistatus.length + statusSeq.length]), pkistatus, statusSeq]);
  const token = Buffer.from([0x30, 0x02, 0x05, 0x00]);
  const top = Buffer.concat([Buffer.from([0x30, statusInfo.length + token.length]), statusInfo, token]);
  const result = parseResponse(top);
  assert.deepEqual(result, {
    status: 'revocationNotification',
    statusCode: 5,
    statusText: 'revoked',
    token: token
  });
});

test('parses an unknown status code as a string with the code', () => {
  const pkistatus = Buffer.from([0x02, 0x01, 0x0a]);
  const statusInfo = Buffer.concat([Buffer.from([0x30, pkistatus.length]), pkistatus]);
  const token = Buffer.from([0x30, 0x02, 0x05, 0x00]);
  const top = Buffer.concat([Buffer.from([0x30, statusInfo.length + token.length]), statusInfo, token]);
  const result = parseResponse(top);
  assert.deepEqual(result, {
    status: 'unknown(10)',
    statusCode: 10,
    statusText: null,
    token: token
  });
});

test('parses a grantedWithMods response with a status text', () => {
  const text = 'modified';
  const textBytes = Buffer.from(text, 'utf8');
  const textOctet = Buffer.concat([Buffer.from([0x0c, textBytes.length]), textBytes]);
  const statusSeq = Buffer.concat([Buffer.from([0x30, textOctet.length]), textOctet]);
  const pkistatus = Buffer.from([0x02, 0x01, 0x01]);
  const statusInfo = Buffer.concat([Buffer.from([0x30, pkistatus.length + statusSeq.length]), pkistatus, statusSeq]);
  const token = Buffer.from([0x30, 0x02, 0x05, 0x00]);
  const top = Buffer.concat([Buffer.from([0x30, statusInfo.length + token.length]), statusInfo, token]);
  const result = parseResponse(top);
  assert.deepEqual(result, {
    status: 'grantedWithMods',
    statusCode: 1,
    statusText: 'modified',
    token: token
  });
});

// Annotated fixture for manifests/semgrep-classes/js-registry-gaps.yaml.
import CryptoJS from 'crypto-js';
import express from 'express';
import cors from 'cors';

export function digests(body, key) {
  // ruleid: cw-cryptojs-weak-hash
  const a = CryptoJS.MD5(body).toString();
  // ruleid: cw-cryptojs-weak-hash
  const b = CryptoJS.HmacSHA1(body, key).toString();
  // ok: cw-cryptojs-weak-hash
  const c = CryptoJS.SHA256(body).toString();
  // ok: cw-cryptojs-weak-hash
  const d = CryptoJS.enc.Hex.stringify(c);
  return [a, b, c, d];
}

export function server() {
  const app = express();
  // ruleid: cw-cors-default-config-express
  app.use(cors());
  // ok: cw-cors-default-config-express
  app.use(cors({ origin: ['https://example.org'] }));
  return app;
}

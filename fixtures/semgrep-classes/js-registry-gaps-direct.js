// Annotated fixture for manifests/semgrep-classes/js-registry-gaps.yaml: per-algorithm modules and Koa.
const md5 = require('crypto-js/md5');
const sha256 = require('crypto-js/sha256');
const Koa = require('koa');
const cors = require('@koa/cors');

function hashes(x) {
  // ruleid: cw-cryptojs-weak-hash
  const a = md5(x);
  // ok: cw-cryptojs-weak-hash
  const b = sha256(x);
  // ruleid: cw-cryptojs-weak-hash
  const c = require('crypto-js/sha1')(x);
  return [a, b, c];
}

function koaServer(origin) {
  const app = new Koa();
  // ruleid: cw-cors-default-config-koa
  app.use(cors());
  // ok: cw-cors-default-config-koa
  app.use(cors({ origin }));
  return app;
}

// ok: cw-cryptojs-weak-hash
const notCrypto = { MD5: (s) => s }.MD5('x');

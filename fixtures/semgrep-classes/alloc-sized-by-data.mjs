// Annotated fixture for manifests/semgrep-classes/alloc-sized-by-data.yaml (JavaScript rule).
const MAX_BODY = 1 << 20;

export function readUnbounded(req, done) {
  let body = '';
  // ruleid: cw-request-body-uncapped-js
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => done(body));
}

export function readChunksUnbounded(req, done) {
  const chunks = [];
  // ruleid: cw-request-body-uncapped-js
  req.on('data', function (c) {
    chunks.push(c);
  });
  req.on('end', () => done(Buffer.concat(chunks)));
}

export function readCapped(req, res, done) {
  let size = 0;
  const chunks = [];
  // ok: cw-request-body-uncapped-js
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => done(Buffer.concat(chunks)));
}

export function readCappedDiscarding(req, done) {
  const chunks = []; let size = 0;
  // ok: cw-request-body-uncapped-js
  req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
  req.on('end', () => done(size > MAX_BODY ? null : Buffer.concat(chunks)));
}

export function readChildOutput(child, done) {
  let out = '';
  // ok: cw-request-body-uncapped-js
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', () => done(out));
}

export function readCappedTerse(req, done) {
  let body = '';
  // ok: cw-request-body-uncapped-js
  req.on('data', (c) => { body += c; if (body.length > MAX_BODY) req.destroy(); });
  req.on('end', () => done(body));
}

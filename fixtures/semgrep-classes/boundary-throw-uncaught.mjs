// Annotated fixture for manifests/semgrep-classes/boundary-throw-uncaught.yaml.
import http from 'node:http';

export function bodyHandler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    // ruleid: cw-parse-in-handler-uncaught-js
    const msg = JSON.parse(body);
    res.end(String(msg.id));
  });
}

export function bodyHandlerCaught(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    try {
      // ok: cw-parse-in-handler-uncaught-js
      const msg = JSON.parse(body);
      res.end(String(msg.id));
    } catch {
      res.writeHead(400).end();
    }
  });
}

export const server = http.createServer((req, res) => {
  // ruleid: cw-parse-in-handler-uncaught-js
  const meta = JSON.parse(req.headers['x-meta'] || '{}');
  res.end(String(meta.v));
});

export function parseConfig(text) {
  // ok: cw-parse-in-handler-uncaught-js
  return JSON.parse(text);
}

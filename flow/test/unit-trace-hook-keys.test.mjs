// The hook's pure parts: how an open's flags become an access, and how a call's arguments become
// C1's endpoint key. Loaded with CW_FLOW_TRACE unset, so nothing is patched in this process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { constants as C } from 'node:fs';
import { hookPath } from '../runtime.mjs';

const saved = process.env.CW_FLOW_TRACE;
delete process.env.CW_FLOW_TRACE;
const hook = createRequire(import.meta.url)(hookPath());
if (saved !== undefined) process.env.CW_FLOW_TRACE = saved;

test('flagsAccess reads string flags', () => {
  // Arrange
  const cases = { r: 'read', rs: 'read', 'r+': 'readwrite', w: 'write', wx: 'write', 'w+': 'readwrite', a: 'append', ax: 'append', 'a+': 'readwrite' };
  // Act / Assert
  for (const [f, want] of Object.entries(cases)) assert.equal(hook.flagsAccess(f), want, f);
});

test('flagsAccess reads O_* numbers and defaults to read', () => {
  // Arrange / Act / Assert
  assert.equal(hook.flagsAccess(C.O_RDONLY), 'read');
  assert.equal(hook.flagsAccess(C.O_WRONLY | C.O_CREAT), 'write');
  assert.equal(hook.flagsAccess(C.O_WRONLY | C.O_APPEND), 'append');
  assert.equal(hook.flagsAccess(C.O_RDWR), 'readwrite');
  assert.equal(hook.flagsAccess(undefined), 'read');
  assert.equal(hook.flagsAccess(null), 'read');
});

test('OPENS takes each call\'s own default and its flag option', () => {
  // Arrange
  const O = hook.OPENS;
  // Act / Assert
  assert.equal(O.readFileSync(['p']), 'read');
  assert.equal(O.readFile(['p', { flag: 'r+' }]), 'readwrite');
  assert.equal(O.createReadStream(['p']), 'read');
  assert.equal(O.writeFileSync(['p', 'x']), 'write');
  assert.equal(O.writeFile(['p', 'x', { flag: 'a' }]), 'append');
  assert.equal(O.appendFileSync(['p', 'x']), 'append');
  assert.equal(O.appendFile(['p', 'x', 'utf8']), 'append', 'a string option is an encoding, not a flag');
  assert.equal(O.createWriteStream(['p', { flags: 'a' }]), 'append');
  assert.equal(O.openSync(['p', 'w']), 'write');
  assert.equal(O.open(['p', () => {}]), 'read', 'open(path, cb) defaults to r');
});

test('endpointKey omits a scheme\'s default port, keeps any other, brackets IPv6', () => {
  // Arrange / Act / Assert
  assert.equal(hook.endpointKey('https', 'API.example.com', 443), 'https://api.example.com');
  assert.equal(hook.endpointKey('http', 'h', 8080), 'http://h:8080');
  assert.equal(hook.endpointKey('tcp', 'db', '5432'), 'tcp://db:5432');
  assert.equal(hook.endpointKey('tcp', undefined, null), 'tcp://localhost');
  assert.equal(hook.endpointKey('http', '::1', 81), 'http://[::1]:81');
  assert.equal(hook.endpointKey('http', 'h', 'nan'), 'http://h');
});

test('urlKey takes http(s) and ws(s) and declines everything else', () => {
  // Arrange / Act / Assert
  assert.equal(hook.urlKey('https://x.test/a?b'), 'https://x.test');
  assert.equal(hook.urlKey(new URL('http://x.test:81/')), 'http://x.test:81');
  assert.equal(hook.urlKey('wss://x.test'), 'wss://x.test');
  assert.equal(hook.urlKey('http://[::1]:9/'), 'http://[::1]:9');
  assert.equal(hook.urlKey('data:text/plain,hi'), null);
  assert.throws(() => hook.urlKey('/relative'));
});

test('httpKey merges a URL with an options object, and options alone', () => {
  // Arrange / Act / Assert
  assert.equal(hook.httpKey(['http://a.test/x'], 'http'), 'http://a.test');
  assert.equal(hook.httpKey([new URL('https://a.test:8443/')], 'https'), 'https://a.test:8443');
  assert.equal(hook.httpKey(['http://a.test/x', { port: 9 }], 'http'), 'http://a.test:9');
  assert.equal(hook.httpKey([{ hostname: 'b.test', port: 443 }], 'https'), 'https://b.test');
  assert.equal(hook.httpKey([{ host: 'b.test', protocol: 'http:', defaultPort: 8000 }], 'https'), 'http://b.test:8000');
  assert.equal(hook.httpKey([{ socketPath: '/s.sock' }], 'http'), 'unix:///s.sock');
  assert.equal(hook.httpKey([() => {}], 'http'), 'http://localhost');
});

test('socketKey reads (port, host), (options), (path), and net\'s normalised array', () => {
  // Arrange / Act / Assert
  assert.equal(hook.socketKey([5432, 'db'], 'tcp'), 'tcp://db:5432');
  assert.equal(hook.socketKey(['5432'], 'tcp'), 'tcp://localhost:5432');
  assert.equal(hook.socketKey([{ host: 'h', port: 1 }], 'tls'), 'tls://h:1');
  assert.equal(hook.socketKey([{ servername: 's', port: 2 }], 'tls'), 'tls://s:2');
  assert.equal(hook.socketKey([{ path: '/p.sock' }], 'tcp'), 'unix:///p.sock');
  assert.equal(hook.socketKey(['/p.sock'], 'tcp'), 'unix:///p.sock');
  assert.equal(hook.socketKey([[{ host: 'h', port: 3 }, () => {}]], 'tcp'), 'tcp://h:3');
});

test('listenKey names a fixed port, a pipe, a handle, and marks port 0 ephemeral', () => {
  // Arrange / Act / Assert
  assert.deepEqual(hook.listenKey([8080]), { key: 'listen:8080', ephemeral: false });
  assert.deepEqual(hook.listenKey(['8080', '0.0.0.0']), { key: 'listen:8080', ephemeral: false });
  assert.deepEqual(hook.listenKey([{ port: 9 }]), { key: 'listen:9', ephemeral: false });
  assert.deepEqual(hook.listenKey([0]), { key: null, ephemeral: true });
  assert.deepEqual(hook.listenKey([() => {}]), { key: null, ephemeral: true });
  assert.deepEqual(hook.listenKey([{}]), { key: null, ephemeral: true });
  assert.deepEqual(hook.listenKey(['/s.sock']), { key: 'listen:unix:/s.sock', ephemeral: false });
  assert.deepEqual(hook.listenKey([{ path: '/s.sock' }]), { key: 'listen:unix:/s.sock', ephemeral: false });
  assert.deepEqual(hook.listenKey([{ fd: 3 }]), { key: 'listen:handle', ephemeral: false });
});

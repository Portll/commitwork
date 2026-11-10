// Groups sessions into windows by idePort and workspace, separating degraded and unattributed (admin/lib/overwatch-layer-read.mjs byWindow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byWindow } from '../lib/overwatch-layer-read.mjs';

test('returns empty structure for null input', () => {
  const result = byWindow(null);
  assert.deepEqual(result, { windows: [], unattributed: [], unknown: [], degraded: [] });
});

test('returns empty structure for non-array input', () => {
  const result = byWindow('not an array');
  assert.deepEqual(result, { windows: [], unattributed: [], unknown: [], degraded: [] });
});

test('returns empty structure for empty array', () => {
  const result = byWindow([]);
  assert.deepEqual(result, { windows: [], unattributed: [], unknown: [], degraded: [] });
});

test('routes session with null ids to unknown', () => {
  const s = { ids: null };
  const result = byWindow([s]);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.unknown[0], s);
  assert.equal(result.windows.length, 0);
  assert.equal(result.unattributed.length, 0);
  assert.equal(result.degraded.length, 0);
});

test('routes session with missing ids property to unknown', () => {
  const s = { name: 'test' };
  const result = byWindow([s]);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.unknown[0], s);
});

test('routes session with unresolved ids to degraded with why', () => {
  const s = { ids: { unresolved: 'process table unreadable' } };
  const result = byWindow([s]);
  assert.equal(result.degraded.length, 1);
  assert.equal(result.degraded[0].why, 'process table unreadable');
  assert.equal(result.degraded[0].ids.unresolved, 'process table unreadable');
  assert.equal(result.windows.length, 0);
  assert.equal(result.unattributed.length, 0);
  assert.equal(result.unknown.length, 0);
});

test('routes session with degraded ids to degraded with why', () => {
  const s = { ids: { degraded: 'ids blob would not parse' } };
  const result = byWindow([s]);
  assert.equal(result.degraded.length, 1);
  assert.equal(result.degraded[0].why, 'ids blob would not parse');
  assert.equal(result.windows.length, 0);
});

test('routes session with unreadable ids to degraded with why', () => {
  const s = { ids: { unreadable: 'fs error' } };
  const result = byWindow([s]);
  assert.equal(result.degraded.length, 1);
  assert.equal(result.degraded[0].why, 'fs error');
  assert.equal(result.windows.length, 0);
});

test('routes session with both port and null workspace to unattributed', () => {
  const s = { ids: { idePort: 8080, workspace: null } };
  const result = byWindow([s]);
  assert.equal(result.unattributed.length, 0);
  assert.equal(result.unattributed[0], undefined);
  assert.equal(result.windows.length, 1);
});

test('routes session with null port and workspace to unattributed', () => {
  const s = { ids: { idePort: null, workspace: null } };
  const result = byWindow([s]);
  assert.equal(result.unattributed.length, 1);
  assert.equal(result.unattributed[0], s);
  assert.equal(result.windows.length, 0);
});

test('groups sessions with same port and workspace into one window', () => {
  const s1 = { ids: { idePort: 8080, workspace: '/proj/a', vscodePid: 100, how: { idePort: 'detected' } } };
  const s2 = { ids: { idePort: 8080, workspace: '/proj/a', vscodePid: 200, how: { idePort: 'detected' } } };
  const result = byWindow([s1, s2]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, 8080);
  assert.equal(result.windows[0].workspace, '/proj/a');
  assert.equal(result.windows[0].vscodePid, 100);
  assert.equal(result.windows[0].how, 'detected');
  assert.equal(result.windows[0].sessions.length, 2);
  assert.equal(result.windows[0].sessions[0], s1);
  assert.equal(result.windows[0].sessions[1], s2);
});

test('creates separate windows for different port and workspace combinations', () => {
  const s1 = { ids: { idePort: 8080, workspace: '/proj/a' } };
  const s2 = { ids: { idePort: 8081, workspace: '/proj/a' } };
  const s3 = { ids: { idePort: 8080, workspace: '/proj/b' } };
  const result = byWindow([s1, s2, s3]);
  assert.equal(result.windows.length, 3);
  assert.equal(result.windows[0].idePort, 8080);
  assert.equal(result.windows[0].workspace, '/proj/a');
  assert.equal(result.windows[1].idePort, 8081);
  assert.equal(result.windows[1].workspace, '/proj/a');
  assert.equal(result.windows[2].idePort, 8080);
  assert.equal(result.windows[2].workspace, '/proj/b');
});

test('handles session with only port and no workspace', () => {
  const s = { ids: { idePort: 8080 } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, 8080);
  assert.equal(result.windows[0].workspace, null);
  assert.equal(result.windows[0].vscodePid, null);
  assert.equal(result.windows[0].how, null);
  assert.equal(result.windows[0].sessions.length, 1);
});

test('handles session with only workspace and no port', () => {
  const s = { ids: { workspace: '/proj/a' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, null);
  assert.equal(result.windows[0].workspace, '/proj/a');
  assert.equal(result.windows[0].vscodePid, null);
  assert.equal(result.windows[0].how, null);
  assert.equal(result.windows[0].sessions.length, 1);
});

test('handles session with empty how object', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: {} } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how containing idePort value', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: 'inferred' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, 'inferred');
});

test('handles session with vscodePid set', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', vscodePid: 12345 } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].vscodePid, 12345);
});

test('handles session with vscodePid null', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', vscodePid: null } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].vscodePid, null);
});

test('handles session with vscodePid missing', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].vscodePid, null);
});

test('handles multiple degraded sessions with different reasons', () => {
  const s1 = { ids: { unresolved: 'reason1' } };
  const s2 = { ids: { degraded: 'reason2' } };
  const s3 = { ids: { unreadable: 'reason3' } };
  const result = byWindow([s1, s2, s3]);
  assert.equal(result.degraded.length, 3);
  assert.equal(result.degraded[0].why, 'reason1');
  assert.equal(result.degraded[1].why, 'reason2');
  assert.equal(result.degraded[2].why, 'reason3');
});

test('handles mixed session types in one call', () => {
  const unknown = { ids: null };
  const degraded = { ids: { degraded: 'parse error' } };
  const unattributed = { ids: { idePort: null, workspace: null } };
  const windowed = { ids: { idePort: 8080, workspace: '/proj/a', vscodePid: 100, how: { idePort: 'detected' } } };
  const result = byWindow([unknown, degraded, unattributed, windowed]);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.degraded.length, 1);
  assert.equal(result.unattributed.length, 1);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, 8080);
  assert.equal(result.windows[0].workspace, '/proj/a');
});

test('handles large number of sessions in same window', () => {
  const sessions = Array.from({ length: 100 }, (_, i) => ({
    ids: { idePort: 8080, workspace: '/proj/a', vscodePid: i, how: { idePort: 'detected' } }
  }));
  const result = byWindow(sessions);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].sessions.length, 100);
  assert.equal(result.windows[0].vscodePid, 0);
});

test('handles large number of sessions across many windows', () => {
  const sessions = Array.from({ length: 100 }, (_, i) => ({
    ids: { idePort: 8000 + i, workspace: '/proj/' + i, vscodePid: i, how: { idePort: 'detected' } }
  }));
  const result = byWindow(sessions);
  assert.equal(result.windows.length, 100);
  for (let i = 0; i < 100; i++) {
    assert.equal(result.windows[i].idePort, 8000 + i);
    assert.equal(result.windows[i].workspace, '/proj/' + i);
    assert.equal(result.windows[i].sessions.length, 1);
  }
});

test('preserves session object identity in windows', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a' }, name: 'test-session' };
  const result = byWindow([s]);
  assert.equal(result.windows[0].sessions[0], s);
  assert.equal(result.windows[0].sessions[0].name, 'test-session');
});

test('preserves session object identity in degraded with spread', () => {
  const s = { ids: { degraded: 'error' }, name: 'test-session' };
  const result = byWindow([s]);
  assert.equal(result.degraded[0].name, 'test-session');
  assert.equal(result.degraded[0].ids.degraded, 'error');
  assert.equal(result.degraded[0].why, 'error');
});

test('handles session with empty string port and workspace', () => {
  const s = { ids: { idePort: '', workspace: '' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, '');
  assert.equal(result.windows[0].workspace, '');
});

test('handles session with zero port and empty workspace', () => {
  const s = { ids: { idePort: 0, workspace: '' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, 0);
  assert.equal(result.windows[0].workspace, '');
});

test('handles session with port 0 and null workspace', () => {
  const s = { ids: { idePort: 0, workspace: null } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, 0);
  assert.equal(result.windows[0].workspace, null);
});

test('handles session with null port and empty workspace', () => {
  const s = { ids: { idePort: null, workspace: '' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, null);
  assert.equal(result.windows[0].workspace, '');
});

test('handles session with false port and workspace', () => {
  const s = { ids: { idePort: false, workspace: false } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, false);
  assert.equal(result.windows[0].workspace, false);
});

test('handles session with 0 port and 0 workspace', () => {
  const s = { ids: { idePort: 0, workspace: 0 } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].idePort, 0);
  assert.equal(result.windows[0].workspace, 0);
});

test('handles session with how as null', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: null } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as undefined', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as empty string', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: '' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as non-object', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: 'string' } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as number', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: 42 } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as boolean', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: true } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as array', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: ['a', 'b'] } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as object without idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as object with null idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: null } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as object with undefined idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: {} } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as object with empty string idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: '' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, "");
});

test('handles session with how as object with 0 idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: 0 } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, 0);
});

test('handles session with how as object with false idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: false } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, false);
});

test('handles session with how as object with non-empty string idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: 'inferred' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, 'inferred');
});

test('handles session with how as object with number idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: 42 } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, 42);
});

test('handles session with how as object with boolean idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: true } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, true);
});

test('handles session with how as object with array idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: ['a'] } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.deepEqual(result.windows[0].how, ['a']);
});

test('handles session with how as object with object idePort', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: { nested: true } } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.deepEqual(result.windows[0].how, { nested: true });
});

test('handles session with how as object with null idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: null, other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as object with undefined idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

test('handles session with how as object with empty string idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: '', other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, "");
});

test('handles session with how as object with 0 idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: 0, other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, 0);
});

test('handles session with how as object with false idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: false, other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, false);
});

test('handles session with how as object with non-empty string idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: 'inferred', other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, 'inferred');
});

test('handles session with how as object with number idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: 42, other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, 42);
});

test('handles session with how as object with boolean idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: true, other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, true);
});

test('handles session with how as object with array idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: ['a'], other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.deepEqual(result.windows[0].how, ['a']);
});

test('handles session with how as object with object idePort and other properties', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: { nested: true }, other: 'value' } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.deepEqual(result.windows[0].how, { nested: true });
});

test('handles session with how as object with null idePort and null other', () => {
  const s = { ids: { idePort: 8080, workspace: '/proj/a', how: { idePort: null, other: null } } };
  const result = byWindow([s]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].how, null);
});

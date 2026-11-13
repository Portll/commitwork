// speak() against a server that exits before it reads a frame. The three writes then hit a closed
// pipe; the verdict must be the server's exit, and the EPIPE must not escape as an unhandled error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speak } from '../mcp-tools-probe.mjs';

test('a server that exits at once is reported as exited, and the write to its closed stdin does not throw', async () => {
  // Arrange
  const argv = [process.execPath, '-e', 'process.stdin.destroy(); process.exit(3)'];
  // Act
  const runs = [];
  for (let i = 0; i < 20; i++) runs.push(await speak(argv, { env: process.env, cwd: process.cwd(), timeout: 5000 }));
  // Assert
  for (const r of runs) {
    assert.equal(r.ok, false);
    assert.match(r.why, /^(exited 3 before answering tools\/list|stdin: )/);
    assert.doesNotMatch(r.why, /^stdin: (EPIPE|ECONNRESET)/);
  }
});

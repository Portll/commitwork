// lib/exit-flushed.mjs — process.exit() only after stdout and stderr have drained.
//
// Writes to a PIPE are asynchronous on macOS, and process.exit() discards whatever has not drained.
// A CLI that prints more than the pipe buffer and then exits emits a truncated stream with the exit
// code it asked for. Files and TTYs are synchronous, so only a piped reader sees it. Measured
// 2026-09-27: `sweep.mjs --all --dry` printed 530 KB once ~/Repositories held 3,365 repos, and a
// reader that was slow to drain got 65,535 bytes and exit 0, with no fan-out plan and no summary.

/** Resolves once every write queued on `stream` before this call has been handed to the OS. */
export function drained(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.writableEnded) { resolve(); return; }
    // An empty write queues behind every pending chunk, so its callback fires after them. An
    // error (EPIPE: the reader left) also resolves — there is nothing left to wait for.
    try { stream.write('', () => resolve()); } catch { resolve(); }
  });
}

/** process.exit(code) once stdout and stderr have drained. Await it; nothing after it runs. */
export async function exitFlushed(code) {
  await Promise.all([drained(process.stdout), drained(process.stderr)]);
  process.exit(code);
}

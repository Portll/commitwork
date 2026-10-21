#!/usr/bin/env node
/**
 * docker-gc.mjs — bound the one Docker component nothing else bounds.
 *
 * WHY THIS EXISTS. When the host volume nears full, Docker's containerd store returns
 * `input/output error` on blob reads and on its own meta.db writes, and reports the result as a
 * CORRUPT BLOB — a diagnosis whose obvious remedy (purge and re-pull) destroys every image while
 * treating a symptom, and appears to work because it frees space. The blob is fine once the volume
 * has room.
 *
 * Build cache can be GC-capped in ~/.docker/daemon.json; unused images have no such policy.
 * Docker.raw is provisioned at the size of the whole volume, so the VM can never hit its own limit
 * — it hits the host's, and a guest write that should have been a clean ENOSPC inside a container
 * becomes EIO on a filesystem that cannot say why.
 *
 * Capping the disk image would give a real boundary, but Docker Desktop implements a reduction by
 * recreating the image: "Resizing to a smaller size will delete the disk image; all Docker images,
 * containers and volumes will be lost." So the bound has to come from retention instead.
 *
 * DECLARATION SPLIT FROM AUTHORITY: this prunes images, which is reversible by re-pulling. It never
 * touches volumes or running containers, because those hold state no registry can give back.
 */
import { execFileSync } from 'node:child_process';
import { sampleHeadroom, assessHostHeadroom, describeHost } from './lib/disk-headroom.mjs';
import { isMainModule } from '../lib/is-main.mjs';

/** Env read at CALL time — a module-load const silently defeats any test that sets the override. */
export function retention() {
  const raw = process.env.CW_DOCKER_GC_UNTIL;
  return raw === undefined || raw === '' ? '720h' : raw;
}

export function gcPath() { return process.env.CW_DOCKER_GC_PATH || '/System/Volumes/Data'; }

/**
 * One docker call. Never throws: a stopped daemon is its own state, and a GC that takes the host
 * down for being unable to tidy it would be worse than the growth it prevents.
 */
export function dockerRun(args, { exec = execFileSync, timeoutMs = 600_000 } = {}) {
  try {
    const out = exec('docker', args, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: String(out ?? '') };
  } catch (e) {
    const detail = String((e && (e.stderr || e.message)) || e).trim().split('\n')[0];
    return { ok: false, out: '', reason: detail || 'docker invocation failed' };
  }
}

/** `Total reclaimed space: 36.76GB` → 36.76GB. Absent means the line was not printed, not zero. */
export function parseReclaimed(text) {
  const m = /Total reclaimed space:\s*(\S+)/i.exec(String(text ?? ''));
  return m ? m[1] : null;
}

export function collect({ dry = false, exec = execFileSync } = {}) {
  const until = retention();
  const before = assessHostHeadroom(sampleHeadroom({ path: gcPath() }));

  const probe = dockerRun(['version', '--format', '{{.Server.Version}}'], { exec });
  if (!probe.ok) {
    // Fail closed: an unreachable daemon is UNMEASURED, never "nothing to reclaim".
    return { ran: false, dry, until, before, reason: `docker daemon unreachable: ${probe.reason}` };
  }

  const args = ['image', 'prune', '-a', '--filter', `until=${until}`, ...(dry ? [] : ['-f'])];
  if (dry) return { ran: false, dry, until, before, reason: `would run: docker ${args.join(' ')}` };

  const pruned = dockerRun(args, { exec });
  if (!pruned.ok) return { ran: false, dry, until, before, reason: `prune failed: ${pruned.reason}` };

  const after = assessHostHeadroom(sampleHeadroom({ path: gcPath() }));
  return { ran: true, dry, until, before, after, reclaimed: parseReclaimed(pruned.out) };
}

export function describe(r) {
  const lines = [`docker-gc: retention ${r.until} on ${gcPath()}`, `  before: ${describeHost(r.before)}`];
  if (!r.ran) { lines.push(`  NOT RUN — ${r.reason}`); return lines.join('\n'); }
  // An absent reclaim line is reported as unknown rather than 0B: docker prints nothing when it
  // prints nothing, and "reclaimed 0" is a claim this tool did not measure.
  lines.push(`  reclaimed: ${r.reclaimed ?? 'not reported by docker'}`, `  after:  ${describeHost(r.after)}`);
  return lines.join('\n');
}

if (isMainModule(import.meta.url)) {
  const dry = process.argv.includes('--dry');
  const r = collect({ dry });
  console.log(describe(r));
  // 0 ran clean · 1 host still under the warning line after GC · 2 could not run
  process.exit(!r.ran && !dry ? 2 : (r.after && !r.after.healthy ? 1 : 0));
}

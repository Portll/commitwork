// job-started.mjs: the runner's job-started hook, before the first step. GitHub hands a runner any
// queued job whose labels match in that repository, not the job the dispatcher admitted, so the
// dispatcher's event rules run again here on the job that actually arrived. Exit 1 fails the job.
import { readFileSync } from 'node:fs';
import { isMainModule } from '../../lib/is-main.mjs';
import { actorVerdict, eventVerdict } from '../../runner/admission.mjs';

/** The runs-API shape eventVerdict reads, from the event payload: a pull request's head, else the repo. */
export function runFromEvent(eventName, repository, event) {
  const head = eventName.startsWith('pull_request') ? event?.pull_request?.head?.repo?.full_name : repository;
  return { event: eventName, head_repository: head ? { full_name: head } : null };
}

/** Why this job must not run on this slot, or null. An empty actor list is a slot misconfigured, so it refuses. */
export function refusal({ eventName, repository, expectedRepo, event, actor = '', triggeringActor = '', actors = [] }) {
  if (expectedRepo && repository !== expectedRepo) return `minted for ${expectedRepo}, job is from ${repository}`;
  const run = { ...runFromEvent(eventName, repository, event), actor: actor ? { login: actor } : null, triggering_actor: triggeringActor ? { login: triggeringActor } : null };
  return eventVerdict(run, repository)?.reason ?? actorVerdict(run, actors.map((a) => a.toLowerCase()))?.reason ?? null;
}

if (isMainModule(import.meta.url)) {
  let event = null;
  try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* refused below */ }
  const why = event === null ? 'event payload unreadable' : refusal({
    eventName: process.env.GITHUB_EVENT_NAME || '',
    repository: process.env.GITHUB_REPOSITORY || '',
    expectedRepo: process.env.CW_SLOT_REPO || '',
    event,
    actor: process.env.GITHUB_ACTOR || '',
    triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR || '',
    actors: (process.env.CW_SLOT_ACTORS || '').split(',').filter(Boolean),
  });
  if (why) {
    console.log(`::error title=commitwork runner refused this job::${why}`);
    process.exitCode = 1;
  } else console.log(`commitwork runner admitted ${process.env.GITHUB_EVENT_NAME} on ${process.env.GITHUB_REPOSITORY}`);
}

import path from 'node:path';
import { SourceError } from './sources.js';
import { QuotaExceededError } from './youtube.js';

/**
 * How a script ends when it did not handle something itself.
 *
 * Every entry point under `scripts/` finishes with `main().catch(reportRunError)`,
 * which makes this the one place that decides what an unhandled failure *means*
 * — and the reason it is one place is that the answer is not obvious and has
 * been got wrong once per script that forgot it.
 *
 * **An exhausted quota is not a failure.** It is the end of the working day:
 * the queue lives in `cache.db`, tomorrow's run resumes from it, and every step
 * that spends quota already says so in its own words when it notices in time
 * (`data:refresh: квота исчерпана, продолжу завтра`). What it costs to get this
 * wrong is not the step — it is everything after it. `make pipeline` and
 * `refresh.yml` both put the free work last: `match` binds what the crawl gave
 * a title to, `embeds` asks oEmbed, `build` carries the whole day into
 * `public/data`. All three read only what is already on disk.
 *
 * On 2026-08-14 `data:subscribers` reached the ceiling and let the error out,
 * because it makes one batched call rather than draining a queue and so had
 * nowhere to catch it. It exited 1, `make pipeline` stopped at step 6 of 9, and
 * a day that had bought 9969 video walks, 4620 metadata refreshes and three new
 * channels' worth of playlists published none of it. In CI the same crash skips
 * `match` and `embeds` and takes down the `refresh` run — and the deploy hangs
 * off that run succeeding, so the site quietly stops updating on exactly the
 * nights the crawl worked hardest.
 *
 * So the rule belongs to the door, not to the script: a script that spends
 * quota gets this ending whether or not its author remembered the case, and one
 * written next year gets it too.
 */
export function reportRunError(error: unknown): never {
  if (error instanceof QuotaExceededError) {
    console.log(`${stepName()}: квота исчерпана, продолжу завтра`);
    process.exit(0);
  }

  if (error instanceof SourceError) {
    console.error(`\n✗ ${error.message}`);
    for (const detail of error.details.slice(0, 40)) console.error(`  ${detail}`);
    if (error.details.length > 40) {
      console.error(`  …and ${error.details.length - 40} more`);
    }
    process.exit(1);
  }

  // Anything else is a bug rather than a state, and a stack trace is the most
  // useful thing that can be said about it.
  throw error;
}

/**
 * What to call the step in that line — `data:subscribers` rather than
 * `12-subscribers.ts`, because the name a person types is the name they will
 * type again tomorrow. `npm_lifecycle_event` is what pnpm puts there; a script
 * run through `tsx` directly falls back to its file name.
 */
function stepName(): string {
  const script = process.env.npm_lifecycle_event;
  if (script) return script;
  const entry = process.argv[1];
  return entry ? path.basename(entry, path.extname(entry)) : 'crawl';
}

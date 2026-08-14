import path from 'node:path';
import { MAP_FILES, groundPlanIsCurrent, writeGroundPlan } from './lib/map-ground.js';
import { reportSourceError } from './lib/sources.js';

/**
 * Writes the scenery's plan for every map file — which cell carries which
 * tiles — so the browser reads the answer instead of working it out.
 *
 *   pnpm map:ground            write them
 *   pnpm map:ground --check    say whether they are current, and fail if not
 *
 * `pnpm map:import` and `pnpm map:portrait` already do this for the map they
 * redraw. This is for the other half of the problem: the plan also depends on
 * the tables in `shared/tiles` — which biome a field is, what grows in it, what
 * the sea does — and editing one of those changes what the map is made of
 * without the map file itself changing a byte. Run it after touching
 * `biomes.ts` or `terrain.ts`.
 *
 * Nothing breaks if it is forgotten. The app checks both fingerprints and works
 * the plan out for itself when they do not answer — it is a fifth of a second on
 * a phone, once, and it is why `--check` runs in CI: the cost of forgetting
 * should be caught by a robot rather than paid by a reader.
 */

const relative = (file: string): string => path.relative(process.cwd(), file);

function main(): void {
  if (process.argv.includes('--check')) {
    const stale = MAP_FILES.filter((file) => !groundPlanIsCurrent(file));
    if (!stale.length) {
      console.log(`✓ scenery plans are current · ${MAP_FILES.map(relative).join(', ')}`);
      return;
    }
    console.error(
      `✗ the scenery plan is out of date for ${stale.map(relative).join(', ')}\n` +
        '  The map draws correctly either way — the browser works it out instead — but it\n' +
        '  costs every reader a fifth of a second on a phone. Run `pnpm map:ground`.'
    );
    process.exitCode = 1;
    return;
  }

  for (const file of MAP_FILES) console.log(writeGroundPlan(file));
}

try {
  main();
} catch (error) {
  reportSourceError(error);
}

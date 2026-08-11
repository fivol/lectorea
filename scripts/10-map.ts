import fs from 'node:fs';
import { ensureDir, paths } from './lib/config.js';
import { generateMapSvg } from './lib/mapgen.js';
import { loadSources, reportSourceError } from './lib/sources.js';

/**
 * Regenerates public/map.svg from data/domains.yaml and the course counts.
 * Run it after adding domains or after a batch of new courses shifts the areas.
 * The result is committed — it is one file and it should be reviewable.
 */
async function main(): Promise<void> {
  refuseToClobberImported();
  const sources = loadSources();
  const courseCounts = new Map<string, number>();
  for (const course of sources.courses) {
    for (const domain of course.domains) {
      courseCounts.set(domain, (courseCounts.get(domain) ?? 0) + 1);
    }
  }

  const { svg, stats } = generateMapSvg({ domains: sources.domains, courseCounts });
  ensureDir(paths.publicDir);
  fs.writeFileSync(paths.mapSvg, svg, 'utf8');

  const bytes = Buffer.byteLength(svg);
  console.log(
    `✓ public/map.svg · ${sources.domains.length} territories · ${(bytes / 1024).toFixed(1)} KB`
  );

  // Areas are supposed to be proportional to course counts. When a territory is
  // fenced in by its neighbours the map quietly lies about how big a field is,
  // so say it out loud instead of leaving it to be noticed in the browser.
  const squeezed = stats.filter((s) => s.cells < s.quota * 0.6);
  if (squeezed.length) {
    console.warn(`! ${squeezed.length} territories are smaller than their share:`);
    for (const s of squeezed.sort((a, b) => a.cells / a.quota - b.cells / b.quota)) {
      console.warn(`  ${s.id}: ${s.cells}/${s.quota} cells`);
    }
  }
}

/**
 * The map in `public/` comes from the sandbox generator via `pnpm map:import`,
 * which is a different and much better map than this script draws: coastlines,
 * islands, straits, label anchors. Regenerating over the top would replace it
 * with bare hexagons and lose all of that.
 *
 * A file carrying coastlines came from the import; this script writes none.
 * `--force` is there for the case where that map is being retired.
 */
function refuseToClobberImported(): void {
  if (process.argv.includes('--force')) return;
  if (!fs.existsSync(paths.mapSvg)) return;
  if (!fs.readFileSync(paths.mapSvg, 'utf8').includes('class="coastline"')) return;

  console.error(
    'public/map.svg was imported from the map sandbox (`pnpm map:import`), not generated here.\n' +
      'Regenerating would replace its continents and islands with plain hexagons.\n' +
      'Run with --force if that is what you want.'
  );
  process.exitCode = 1;
  process.exit();
}

main().catch(reportSourceError);

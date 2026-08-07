import {
  buildDomainGraph,
  classifyLandforms,
  defaultLandformConfig,
  type LandformConfig,
} from '../shared/domain-graph.js';
import { loadSources, reportSourceError } from './lib/sources.js';

/**
 * Prints the landform each domain is assigned and why.
 *
 * The classification is the one part of the map that changes what the picture
 * *says* rather than how it looks, so it gets a table instead of only a render:
 * "философия стала островом" is a claim about the catalogue, and it should be
 * possible to check it without squinting at a coastline.
 */
function main(): void {
  const sources = loadSources();
  const counts = new Map<string, number>();
  for (const course of sources.courses) {
    for (const domain of course.domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const config: LandformConfig = { ...defaultLandformConfig };
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([a-zA-Z]+)=(.+)$/);
    if (match && match[1] in config) {
      (config as unknown as Record<string, number>)[match[1]] = Number(match[2]);
    }
  }

  const edges = buildDomainGraph(sources.domains, sources.courses, config);
  const topology = classifyLandforms(sources.domains, edges, counts, config);

  console.log(`edges ${edges.length} · seed ${config.seed}\n`);
  const order = ['mainland', 'peninsula', 'island'];
  const rows = [...topology.values()].sort(
    (a, b) =>
      a.continent.localeCompare(b.continent) ||
      order.indexOf(a.landform) - order.indexOf(b.landform) ||
      b.ownWeight - a.ownWeight
  );

  let continent = '';
  for (const row of rows) {
    if (row.continent !== continent) {
      continent = row.continent;
      console.log(`\n── ${continent}`);
    }
    const share = row.ownWeight + row.foreignWeight
      ? row.foreignWeight / (row.ownWeight + row.foreignWeight)
      : 0;
    console.log(
      `  ${row.landform.padEnd(10)} ${row.id.padEnd(24)} ` +
        `курсов ${String(counts.get(row.id) ?? 0).padStart(2)} · ` +
        `свои ${String(row.ownLinks).padStart(2)} · ` +
        `наружу ${(share * 100).toFixed(0).padStart(3)}%` +
        (row.reaches.length ? ` → ${row.reaches.join(',')}` : '')
    );
  }

  const tally = new Map<string, number>();
  for (const row of topology.values()) tally.set(row.landform, (tally.get(row.landform) ?? 0) + 1);
  console.log(
    `\nитого: ${[...tally.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`
  );
}

try {
  main();
} catch (error) {
  reportSourceError(error);
}

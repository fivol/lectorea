import fs from 'node:fs';
import path from 'node:path';
import { generateMap, type MapConfig } from './lib/mapgen.poc.js';
import { loadSources, reportSourceError } from './lib/sources.js';

/**
 * Renders the map proof of concept to an SVG plus a metrics report.
 * Not part of the build — this exists to look at, and to be argued with.
 */

const OUT = process.env.MAP_POC_OUT ?? '.map-poc';

function main(): void {
  const sources = loadSources();
  const counts = new Map<string, number>();
  for (const course of sources.courses) {
    for (const domain of course.domains) {
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }

  const overrides: Partial<MapConfig> = {};
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([a-zA-Z]+)=(.+)$/);
    if (match) (overrides as Record<string, number>)[match[1]] = Number(match[2]);
  }

  const started = Date.now();
  const map = generateMap(sources.domains, counts, overrides);
  const elapsed = Date.now() - started;

  const titles = JSON.parse(
    fs.readFileSync(path.join('data', 'i18n', 'ru.json'), 'utf8')
  ) as Record<string, string>;
  const titleOf = (id: string): string =>
    titles[`domain.${id}.title`] ?? titles[`domain.${id}`] ?? id;

  fs.mkdirSync(OUT, { recursive: true });

  const shadow = map.coasts
    .map((coast) => `<path d="${coast.path}" fill="#0a1622" opacity="0.55" transform="translate(0 9)"/>`)
    .join('\n    ');

  const fills = map.territories
    .map((territory) => {
      const { domain } = territory;
      return (
        `<path id="${domain.shapeId}" class="t" data-domain="${domain.id}" ` +
        `data-continent="${domain.continent}" ` +
        `data-cx="${territory.label.x.toFixed(1)}" data-cy="${territory.label.y.toFixed(1)}" ` +
        `data-room="${territory.room.toFixed(1)}" ` +
        `fill="${domain.color}" d="${territory.path}"/>`
      );
    })
    .join('\n    ');

  const coastline = map.coasts
    .map((coast) => `<path d="${coast.path}" fill="none" stroke="#f4f1e8" stroke-width="3.5" stroke-linejoin="round"/>`)
    .join('\n    ');

  const labels = map.territories
    .map((territory) => {
      const size = Math.max(9, Math.min(20, territory.room * 0.42));
      if (territory.room < 12) return '';
      const title = titleOf(territory.domain.id).toUpperCase();
      return (
        `<text x="${territory.label.x.toFixed(1)}" y="${territory.label.y.toFixed(1)}" ` +
        `font-size="${size.toFixed(1)}" font-family="Helvetica,Arial,sans-serif" font-weight="700" ` +
        `text-anchor="middle" fill="#20303f" paint-order="stroke" stroke="#ffffff" ` +
        `stroke-width="${(size * 0.22).toFixed(1)}" stroke-linejoin="round" stroke-opacity="0.8">${title}</text>`
      );
    })
    .filter(Boolean)
    .join('\n    ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${map.viewBox}">
  <rect width="100%" height="100%" fill="#cfe4ee"/>
  <g>
    ${shadow}
  </g>
  <g fill-opacity="0.85" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round">
    ${fills}
  </g>
  <g>
    ${coastline}
  </g>
  <g>
    ${labels}
  </g>
</svg>
`;

  fs.writeFileSync(path.join(OUT, 'map.svg'), svg, 'utf8');

  // The report is the point of the exercise: a picture can hide a territory
  // that is half the size its course count asks for, a table cannot.
  const rows = map.territories
    .map((territory) => ({
      id: territory.domain.id,
      want: territory.quotaShare,
      got: territory.areaShare,
      error: (territory.areaShare - territory.quotaShare) / territory.quotaShare,
      room: territory.room,
    }))
    .sort((a, b) => Math.abs(b.error) - Math.abs(a.error));

  const lines = [
    `attempts        ${map.metrics.attempts}`,
    `cells           ${map.metrics.cells}`,
    `mean area error ${(map.metrics.areaError * 100).toFixed(1)}%`,
    `dep adjacency   ${(map.metrics.adjacencyRate * 100).toFixed(0)}% of same-continent dependencies touch`,
    `elapsed         ${elapsed} ms`,
    '',
    'worst area errors:',
    ...rows.slice(0, 8).map((r) => `  ${r.id.padEnd(20)} ${(r.error * 100).toFixed(1).padStart(7)}%`),
    '',
    'tightest label room:',
    ...[...rows]
      .sort((a, b) => a.room - b.room)
      .slice(0, 6)
      .map((r) => `  ${r.id.padEnd(20)} ${r.room.toFixed(0).padStart(4)} px`),
  ];

  const report = lines.join('\n');
  fs.writeFileSync(path.join(OUT, 'report.txt'), `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n✓ ${path.join(OUT, 'map.svg')}`);
}

try {
  main();
} catch (error) {
  reportSourceError(error);
}

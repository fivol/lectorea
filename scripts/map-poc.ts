import fs from 'node:fs';
import path from 'node:path';
import { generateMap, defaultConfig, type MapConfig } from '../shared/mapgen.js';
import {
  buildDomainGraph,
  classifyLandforms,
  defaultLandformConfig,
  domainLevels,
} from '../shared/domain-graph.js';
import { loadSources, reportSourceError } from './lib/sources.js';

/**
 * Renders the generator to an SVG plus a metrics report, for looking at from a
 * terminal. The sandbox is the same generator with sliders — this exists so the
 * numbers can be diffed between runs.
 */

const OUT = process.env.MAP_POC_OUT ?? '.map-poc';

function main(): void {
  const sources = loadSources();
  const counts = new Map<string, number>();
  for (const course of sources.courses) {
    for (const domain of course.domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const overrides: Partial<MapConfig> = {};
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([a-zA-Z]+)=(.+)$/);
    if (match && match[1] in defaultConfig) {
      (overrides as Record<string, number>)[match[1]] = Number(match[2]);
    }
  }

  const landformConfig = { ...defaultLandformConfig, seed: overrides.seed ?? defaultConfig.seed };
  const edges = buildDomainGraph(sources.domains, sources.courses, landformConfig);
  const topology = classifyLandforms(sources.domains, edges, counts, landformConfig);
  const layers = domainLevels(sources.domains);
  if (layers.cycle) {
    console.warn(`! цикл в dependsOn: ${layers.cycle.join(' → ')}`);
  }

  const map = generateMap(
    {
      domains: sources.domains,
      courseCounts: counts,
      landform: new Map([...topology].map(([id, t]) => [id, t.landform])),
      reaches: new Map([...topology].map(([id, t]) => [id, t.reaches])),
      edges,
      levels: layers.level,
      maxLevel: layers.maxLevel,
    },
    overrides
  );

  const titles = JSON.parse(fs.readFileSync(path.join('data', 'i18n', 'ru.json'), 'utf8')) as Record<
    string,
    string
  >;
  const titleOf = (id: string) => titles[`domain.${id}.title`] ?? id;

  fs.mkdirSync(OUT, { recursive: true });

  const shadow = map.coasts
    .map((c) => `<path d="${c.path}" fill="#16324a" opacity="0.4" transform="translate(0 10)"/>`)
    .join('');
  // Only bridges that touch an island are drawn. Continent-to-continent links
  // are numerous and run straight across other people's land — as a picture
  // they are a scribble, and the island ones are the ones that explain
  // something: why that domain is out there on its own.
  const offshore = new Set(
    map.coasts.filter((c) => c.kind === 'island').flatMap((c) => c.id.replace('island:', ''))
  );
  const bridges = map.links
    .filter((l) => offshore.has(l.from) || offshore.has(l.to))
    .map(
      (l) =>
        `<path d="M${l.a.x.toFixed(1)} ${l.a.y.toFixed(1)}L${l.b.x.toFixed(1)} ${l.b.y.toFixed(1)}" ` +
        `stroke="#f4f6f8" stroke-width="2" stroke-dasharray="6 5" opacity="0.55" fill="none"/>`
    )
    .join('');
  const fills = map.territories
    .map(
      (t) =>
        `<path id="shape-${t.id}" data-domain="${t.id}" fill="${t.colour}" fill-opacity="0.8" d="${t.path}"/>`
    )
    .join('');
  const coast = map.coasts
    .map((c) => `<path d="${c.path}" fill="none" stroke="#fdfbf4" stroke-width="4"/>`)
    .join('');
  const labels = map.territories
    .filter((t) => t.room > 15)
    .map((t) => {
      const size = Math.max(9, Math.min(21, t.room * 0.4));
      return (
        `<text x="${t.label.x.toFixed(1)}" y="${t.label.y.toFixed(1)}" font-size="${size.toFixed(1)}" ` +
        `font-family="Helvetica,Arial,sans-serif" font-weight="700" text-anchor="middle" ` +
        `fill="#1d2c3a" paint-order="stroke" stroke="#fff" stroke-width="${(size * 0.24).toFixed(1)}" ` +
        `stroke-linejoin="round" stroke-opacity="0.85">${titleOf(t.id).toUpperCase()}</text>`
      );
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${map.viewBox}">
<rect width="100%" height="100%" fill="#cfe6f0"/>
${shadow}
${bridges}
<g stroke="#fdfbf4" stroke-width="1.8" stroke-linejoin="round">${fills}</g>
${coast}
${labels}
</svg>
`;
  fs.writeFileSync(path.join(OUT, 'map.svg'), svg, 'utf8');

  const worst = [...map.territories].sort((a, b) => Math.abs(b.areaError) - Math.abs(a.areaError));
  const report = [
    `mean area error ${(map.metrics.areaError * 100).toFixed(1)}%`,
    `worst           ${(map.metrics.worstAreaError * 100).toFixed(1)}%`,
    `hexes           ${map.metrics.hexes}`,
    `min label room  ${map.metrics.smallest.toFixed(0)} px`,
    `snizu vverh    ${(map.metrics.upwardRate * 100).toFixed(0)}% зависимостей идут снизу вверх`,
    `levels          0..${layers.maxLevel}`,
    `landmasses      ${map.coasts.length} (островов ${map.coasts.filter((c) => c.kind === 'island').length})`,
    `bridges         ${map.links.length}`,
    `elapsed         ${map.metrics.elapsedMs} ms`,
    `svg             ${(Buffer.byteLength(svg) / 1024).toFixed(0)} KB`,
    '',
    ...worst.slice(0, 6).map((t) => `  ${t.id.padEnd(22)} ${(t.areaError * 100).toFixed(1).padStart(7)}%`),
    '',
    'tightest label room:',
    ...[...map.territories]
      .sort((a, b) => a.room - b.room)
      .slice(0, 5)
      .map((t) => `  ${t.id.padEnd(22)} ${t.room.toFixed(0).padStart(4)} px`),
  ].join('\n');

  fs.writeFileSync(path.join(OUT, 'report.txt'), `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n✓ ${path.join(OUT, 'map.svg')}`);
}

try {
  main();
} catch (error) {
  reportSourceError(error);
}

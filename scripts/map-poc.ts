import fs from 'node:fs';
import path from 'node:path';
import { templateSvg, bridgeMarkup } from '../shared/mapgen.js';
import { buildWorld, readOverrides } from './lib/map-world.js';
import { reportSourceError } from './lib/sources.js';

/**
 * Renders the generator to an SVG plus a metrics report, for looking at from a
 * terminal. The sandbox is the same generator with sliders — this exists so the
 * numbers can be diffed between runs.
 *
 *   pnpm map:preview --packing=column --width=1040 --height=1780
 */

const OUT = process.env.MAP_POC_OUT ?? '.map-poc';

function main(): void {
  const { map, levels: layers } = buildWorld(readOverrides(process.argv.slice(2)));
  if (layers.cycle) {
    console.warn(`! цикл в dependsOn: ${layers.cycle.join(' → ')}`);
  }

  const titles = JSON.parse(fs.readFileSync(path.join('data', 'i18n', 'ru.json'), 'utf8')) as Record<
    string,
    string
  >;
  const titleOf = (id: string) => titles[`domain.${id}.title`] ?? id;

  fs.mkdirSync(OUT, { recursive: true });

  const shadow = map.coasts
    .map((c) => `<path d="${c.path}" fill="#16324a" opacity="0.4" transform="translate(0 10)"/>`)
    .join('');
  const bridges = bridgeMarkup(map, {
    colour: '#f4f6f8',
    width: 2,
    dash: '6 5',
    opacity: 0.55,
  });
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

  // The handoff to the image model, written every run so it can be eyeballed
  // without opening the sandbox.
  fs.writeFileSync(
    path.join(OUT, 'template.svg'),
    templateSvg(map, { borders: true, links: true }),
    'utf8'
  );

  const worst = [...map.territories].sort((a, b) => Math.abs(b.areaError) - Math.abs(a.areaError));
  const report = [
    `mean area error ${(map.metrics.areaError * 100).toFixed(1)}%`,
    `worst           ${(map.metrics.worstAreaError * 100).toFixed(1)}%`,
    `hexes           ${map.metrics.hexes}`,
    `min label room  ${map.metrics.smallest.toFixed(0)} px`,
    `snizu vverh    ${(map.metrics.upwardRate * 100).toFixed(0)}% зависимостей идут снизу вверх`,
    `torn            ${map.metrics.torn} разорванных массивов суши`,
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

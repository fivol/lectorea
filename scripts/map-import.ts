import fs from 'node:fs';
import path from 'node:path';
import { paths } from './lib/config.js';
import {
  anchorOf,
  describeLandmasses,
  ringFrom,
  writeMapFile,
  type FileTerritory,
} from './lib/map-file.js';
import { loadSources, SourceError } from './lib/sources.js';
import { reportRunError } from './lib/exit.js';

/**
 * Imports an SVG exported from the map sandbox (`pnpm map:sandbox`) into
 * `public/map.svg`.
 *
 * The export is a picture: a sea, drop shadows, dependency links, labels, and
 * territories carrying the colours the sandbox happened to be showing. The app
 * needs none of that — it paints the territories itself from `domains.yaml` and
 * writes its own labels. What it cannot recover is the geometry, so this keeps
 * the outlines and the coastline and throws the rest away.
 *
 * What the export does not carry either — the continent each territory belongs
 * to, the point a label can be centred on, how much room there is around it — is
 * measured in `lib/map-file.ts`, which is also what `pnpm map:portrait` uses. The
 * two maps are drawn by different routes and have to arrive at the same kind of
 * file.
 *
 *   pnpm map:import '~/Downloads/map (1).svg'
 */

const USAGE = 'usage: pnpm map:import <sandbox-export.svg>';

/* ──────────────────────────────  Reading  ──────────────────────────────── */

const PATH_RE = /<path\b([^>]*?)\/>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

type RawPath = { attributes: Record<string, string>; d: string };

function readPaths(svg: string): RawPath[] {
  const result: RawPath[] = [];
  for (const match of svg.matchAll(PATH_RE)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(ATTR_RE)) {
      attributes[attribute[1]] = attribute[2];
    }
    if (attributes.d) result.push({ attributes, d: attributes.d });
  }
  return result;
}

/**
 * The coastline, as the sandbox draws it: the only unfilled paths that are not
 * dependency links. A link is a straight dashed segment between two anchors.
 */
const isCoast = (path: RawPath): boolean =>
  !path.attributes.id &&
  path.attributes.fill === 'none' &&
  !('stroke-dasharray' in path.attributes);

/* ───────────────────────────────  Import  ──────────────────────────────── */

function main(): void {
  const source = process.argv[2];
  if (!source) {
    console.error(USAGE);
    process.exit(1);
  }
  const file = source.replace(/^~(?=\/)/, process.env.HOME ?? '~');
  if (!fs.existsSync(file)) {
    console.error(`${file}: no such file\n${USAGE}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(file, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!viewBox) throw new SourceError(`${path.basename(file)} has no viewBox`);

  const all = readPaths(svg);
  const coasts = all.filter(isCoast);
  const shapes = new Map(
    all
      .filter((p) => p.attributes.id?.startsWith('shape-'))
      .map((p) => [p.attributes.id, p] as const)
  );
  if (!coasts.length) throw new SourceError(`${path.basename(file)} carries no coastline`);

  // The map is only ever as good as its agreement with domains.yaml: a
  // territory the app cannot name is a hole, a domain with no territory is a
  // field that silently vanishes off the map.
  const { domains } = loadSources();
  const missing = domains.filter((domain) => !shapes.has(domain.shapeId));
  const extra = [...shapes.keys()].filter(
    (id) => !domains.some((domain) => domain.shapeId === id)
  );
  if (missing.length || extra.length) {
    throw new SourceError('the export and data/domains.yaml disagree', [
      ...missing.map((domain) => `missing territory ${domain.shapeId} (domain ${domain.id})`),
      ...extra.map((id) => `${id} has no domain in domains.yaml`),
    ]);
  }

  const territories: FileTerritory[] = domains.map((domain) => {
    const d = shapes.get(domain.shapeId)!.d;
    return {
      shapeId: domain.shapeId,
      domainId: domain.id,
      continent: domain.continent,
      d,
      anchor: anchorOf(ringFrom(d, `territory ${domain.shapeId} in the export`)),
    };
  });

  writeMapFile(paths.mapSvg, {
    viewBox,
    // The export draws every coast the same way and says nothing about who owns
    // it, so it is read back off the territories inside each one.
    landmasses: describeLandmasses(
      coasts.map((coast) => coast.d),
      territories
    ),
    territories,
    provenance: 'Imported from a map sandbox export by `pnpm map:import` — geometry only.',
  });
}

try {
  main();
} catch (error) {
  reportRunError(error);
}

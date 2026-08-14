import fs from 'node:fs';
import path from 'node:path';
import { groundPlan, planFits, type GroundPlan } from '../../shared/tiles/index.js';
import { parseMapSvg } from '../../src/lib/map.js';
import { planSourceOf } from '../../src/screens/Map/ground.js';
import { paths } from './config.js';

/**
 * Writing down what the scenery is made of, so the browser does not have to
 * work it out.
 *
 * Three passes over a map file — which hexes a territory owns, which hexes are
 * water, and what grows on each — take about a fifth of a second on a phone and
 * give the same answer every time. `shared/tiles/plan.ts` is what they are and
 * why keeping the answer is safe; this is the half that puts it on disk.
 *
 * Read back through `parseMapSvg` rather than taken from the model that was
 * just written, and deliberately: the app reads the *file*, down to the rounding
 * in its coordinates, so a plan measured off anything else would be a plan for a
 * map that does not exist. The reader is the app's own, for the same reason.
 */

/** `public/map.svg` → `public/map-ground.json`. Mirrors `groundFileFor`. */
export const groundFileOf = (mapFile: string): string => mapFile.replace(/\.svg$/, '-ground.json');

/** Every map file the app can ask for, in the order they are reported. */
export const MAP_FILES = [paths.mapSvg, paths.mapPortraitSvg];

export function planFor(mapFile: string): { plan: GroundPlan; svg: string } {
  const svg = fs.readFileSync(mapFile, 'utf8');
  const map = parseMapSvg(svg);
  if (!map.grid) {
    throw new Error(
      `${path.relative(process.cwd(), mapFile)} is not laid out on a hex grid any more — ` +
        'no plan can be drawn from it, and the app will fall back to working it out.'
    );
  }
  return { plan: groundPlan(planSourceOf(map, map.grid), svg), svg };
}

/** Writes the plan beside its map file. Returns the line to report. */
export function writeGroundPlan(mapFile: string): string {
  const { plan } = planFor(mapFile);
  const target = groundFileOf(mapFile);
  const json = JSON.stringify(plan);
  fs.writeFileSync(target, json, 'utf8');
  const cells =
    plan.fields.reduce((sum, field) => sum + field.cells.length, 0) +
    plan.sea.shore.length +
    plan.sea.open.length;
  return (
    `✓ ${path.relative(process.cwd(), target)} · ${cells} cells · ` +
    `${(Buffer.byteLength(json) / 1024).toFixed(1)} KB`
  );
}

/** Whether the plan on disk is the plan for the map file on disk. */
export function groundPlanIsCurrent(mapFile: string): boolean {
  const target = groundFileOf(mapFile);
  if (!fs.existsSync(target)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(target, 'utf8')) as GroundPlan;
    return planFits(saved, fs.readFileSync(mapFile, 'utf8'));
  } catch {
    return false;
  }
}

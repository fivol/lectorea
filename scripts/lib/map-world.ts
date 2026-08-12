import {
  buildDomainGraph,
  classifyLandforms,
  defaultLandformConfig,
  domainLevels,
} from '../../shared/domain-graph.js';
import { defaultConfig, generateMap, type MapConfig, type MapResult } from '../../shared/mapgen.js';
import { loadSources } from './sources.js';

/**
 * The generator, run over this repo's own data.
 *
 * Three callers want exactly this and differ only in what they do with the
 * result: `map:preview` renders it to look at, `map:build` writes the file the
 * app reads, and the sandbox does the same thing in a browser with sliders on
 * it. Which config produced a map is the only interesting variable, so that is
 * all any of them has to pass.
 */

export type BuiltWorld = {
  map: MapResult;
  config: MapConfig;
  /** Depth in the dependency order, and the cycle that broke it if there was one. */
  levels: ReturnType<typeof domainLevels>;
};

export function buildWorld(overrides: Partial<MapConfig> = {}): BuiltWorld {
  const config: MapConfig = { ...defaultConfig, ...overrides };
  const sources = loadSources();

  const courseCounts = new Map<string, number>();
  for (const course of sources.courses) {
    for (const domain of course.domains) {
      courseCounts.set(domain, (courseCounts.get(domain) ?? 0) + 1);
    }
  }

  // The landform pass is seeded off the same variant as the layout: stepping
  // the seed has to move the whole world, not redraw one half of it.
  const landformConfig = { ...defaultLandformConfig, seed: config.seed };
  const edges = buildDomainGraph(sources.domains, sources.courses, landformConfig);
  const topology = classifyLandforms(sources.domains, edges, courseCounts, landformConfig);
  const levels = domainLevels(sources.domains);

  const map = generateMap(
    {
      domains: sources.domains,
      courseCounts,
      landform: new Map([...topology].map(([id, t]) => [id, t.landform])),
      reaches: new Map([...topology].map(([id, t]) => [id, t.reaches])),
      edges,
      levels: levels.level,
      maxLevel: levels.maxLevel,
    },
    config
  );

  return { map, config, levels };
}

/**
 * `--knob=value` from a command line.
 *
 * Every knob but one is a slider, so a number is the default reading; the
 * packing is a word, and its own type is what says so.
 */
export function readOverrides(argv: string[]): Partial<MapConfig> {
  const overrides: Partial<MapConfig> = {};
  for (const argument of argv) {
    const match = argument.match(/^--([a-zA-Z]+)=(.+)$/);
    if (!match) continue;
    const key = match[1] as keyof MapConfig;
    if (!(key in defaultConfig)) continue;
    (overrides as Record<string, unknown>)[key] =
      typeof defaultConfig[key] === 'number' ? Number(match[2]) : match[2];
  }
  return overrides;
}

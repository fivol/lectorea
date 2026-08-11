/**
 * The collection: every tile, every assembled object, and the manifest that
 * carries both out of the repository.
 *
 * The manifest is the contract. It holds each drawing in unit-hex coordinates
 * rather than at some chosen pixel size, plus the clip path, the edge numbering
 * and the recipes — so a consumer that has never seen this code can place a
 * piece on any hex, at any size, and assemble the objects from the same data
 * the viewer draws.
 */

import {
  corner,
  DIRECTIONS,
  EDGE_NAMES,
  flatHexPath,
  GROUND,
  hexPath,
  HEX_H,
  HEX_R,
  HEX_W,
  round,
  SLAB,
} from './hex.js';
import { terrain, type Palette } from './ink.js';
import { reliefTiles } from './atlas/relief.js';
import { coastTiles } from './atlas/coast.js';
import { hydroTiles } from './atlas/hydro.js';
import { waterTiles } from './atlas/water.js';
import { assemblies } from './atlas/assemblies.js';
import { assemblyBox, assemblySvg, SEED_SALT, tileBody } from './render.js';
import {
  TERRAINS,
  TERRAIN_BY_CONTINENT,
  TERRAIN_BY_DOMAIN,
  type Terrain,
} from './terrain.js';
import type { Assembly, Over, Tile, TileGroup } from './types.js';

export * from './hex.js';
export * from './types.js';
export * from './render.js';
export * from './terrain.js';
export * from './fill.js';
export { terrain, WATERS, type Palette } from './ink.js';
export { assemblies };

export const tiles: Tile[] = [...reliefTiles, ...coastTiles, ...hydroTiles, ...waterTiles];

const index = new Map(tiles.map((tile) => [tile.id, tile]));

export const findTile = (id: string): Tile | undefined => index.get(id);

/** Shelf order for the viewer and the exported folders. */
export const GROUPS: Array<{ id: TileGroup; title: string; note: string }> = [
  {
    id: 'relief',
    title: 'Рельеф',
    note:
      'Форма земли: свет и тень поверх цвета области, ничего не закрашивая. ' +
      'Выходит за клетку вверх и не вращается — только отражается.',
  },
  {
    id: 'coast',
    title: 'Берег',
    note: 'Шов между сушей и водой — единственное место, где вода на суше. Стыкуется по углам.',
  },
  {
    id: 'hydro',
    title: 'Реки',
    note: 'Русло через клетки и устье. Линия, а не поле: цвет области видно насквозь.',
  },
  {
    id: 'water',
    title: 'Море',
    note: 'Открытая вода и то, что на ней: отмель, глубина, риф, течение, водоворот.',
  },
];

export const tilesOf = (group: TileGroup): Tile[] => tiles.filter((tile) => tile.group === group);

/* ────────────────────────────────  Manifest  ───────────────────────────── */

export type ManifestTile = {
  id: string;
  group: TileGroup;
  kind: string;
  layer: string;
  title: string;
  use: string;
  tags: string[];
  seams: Array<{ edges: number[]; meets: string }>;
  options: Record<string, { values: string[]; fallback: string; note: string }>;
  over: Over;
  bleed: number;
  clip: boolean;
  upright: boolean;
  /** One entry per variant: the drawing itself, in unit-hex coordinates. */
  bodies: string[];
};

export type ManifestAssembly = Assembly & { viewBox: string; svg: string };

export type Manifest = {
  version: string;
  seed: string;
  palette: Palette;
  hex: {
    orientation: 'pointy-top';
    radius: number;
    width: number;
    height: number;
    clipPath: string;
    /** Axial centre of cell (q, r) at hex radius `s`. */
    centre: string;
    corners: Array<{ index: number; x: number; y: number }>;
    edges: Array<{ index: number; name: string; step: { q: number; r: number } }>;
  };
  /** The angle the map is seen at, and what a consumer has to do about it. */
  view: {
    /** A unit of north-south ground is this much screen. */
    ground: number;
    /** How thick one cell of ground is, in hex radii. */
    slab: number;
    project: string;
    /** The cell as it lands on the screen: the clip for anything laid flat. */
    flatClipPath: string;
  };
  howToUse: Record<string, string>;
  groups: typeof GROUPS;
  tiles: ManifestTile[];
  assemblies: ManifestAssembly[];
  /**
   * What the app fills its territories with. Recipes rather than pictures, and
   * a table keyed on the domain rather than on the polygon — see
   * `shared/tiles/terrain.ts` for why that is the only key that survives the
   * map being redrawn.
   */
  terrains: {
    recipes: Terrain[];
    byDomain: Record<string, string>;
    byContinent: Record<string, string>;
  };
};

export type ManifestOptions = {
  seed?: string;
  palette?: Palette;
  /** Hex radius the assembled previews are rendered at. Tiles stay unit-sized. */
  previewSize?: number;
};

export function buildManifest(options: ManifestOptions = {}): Manifest {
  const seed = options.seed ?? SEED_SALT;
  const palette = options.palette ?? terrain;
  const previewSize = options.previewSize ?? 64;
  const render = { seed, palette };

  return {
    version: '1',
    seed,
    palette,
    hex: {
      orientation: 'pointy-top',
      radius: HEX_R,
      width: Number(HEX_W.toFixed(6)),
      height: HEX_H,
      clipPath: hexPath(),
      centre: 'x = s * √3 * (q + r/2), y = s * 1.5 * r',
      corners: Array.from({ length: 6 }, (_, i) => {
        const point = corner(i);
        return { index: i, x: Number(round(point.x)), y: Number(round(point.y)) };
      }),
      edges: DIRECTIONS.map((step, index) => ({
        index,
        name: EDGE_NAMES[index],
        step: { q: step.q, r: step.r },
      })),
    },
    view: {
      ground: GROUND,
      slab: SLAB,
      project: 'screen.x = x, screen.y = y * view.ground − z',
      flatClipPath: flatHexPath(),
    },
    howToUse: {
      space:
        'Каждая плитка нарисована в единичном гексагоне: центр в нуле, радиус 1, вершина вверх.',
      view:
        'На карту смотрят сверху и немного сбоку. Земля сжата по вертикали в view.ground раз, ' +
        'высота идёт прямо вверх, сетка не повёрнута — соседи, углы и середины граней остаются ' +
        'теми же. Клетка (q, r) на экране: x = s·√3·(q + r/2), y = s·1.5·r·view.ground.',
      place:
        'Клетка (q, r) при радиусе s: <g transform="translate(cx cy) scale(s)">…body…</g>, ' +
        'где cx, cy — центр клетки на экране.',
      lay:
        'Если clip = true, плитка лежит на земле: добавьте scale(1 view.ground) сразу после ' +
        'scale(s), до поворота и отражения. Если clip = false, у плитки есть высота — она ' +
        'нарисована уже в экранных координатах и сжимать её нельзя.',
      clip:
        'Если clip = true, оберните body во внутренний <g clip-path> с hex.clipPath — ' +
        'обрезка обязана считаться уже в масштабированной системе координат, внутри сжатия. ' +
        'Снаружи сжатия тот же контур — view.flatClipPath.',
      slab:
        'Клетка суши — не пятно, а плита толщиной view.slab радиуса. Стена рисуется по граням ' +
        '1 (ЮВ) и 2 (ЮЗ) и только там, где соседней клетки нет: грани 0 и 3 при этом угле ' +
        'смотрят ребром, а стена внутри материка — забор поперёк поля.',
      stack:
        'На одну клетку кладётся несколько плиток. Порядок снизу вверх: plate, surface, ' +
        'relief, overlay; внутри слоя — порядок в стопке.',
      transform:
        'Сначала отражение (scale(-1 1)), потом поворот на rotate × 60°. Грани швов ' +
        'пересчитываются так же. upright = true запрещает поворот: у объёма есть верх.',
      seams:
        'seams говорит, какие грани плитка пересекает и что обязано быть с той стороны. ' +
        'kind = part без соседей по швам не читается.',
      over:
        'over = land | water. На суше клетка уже покрашена цветом области, поэтому наземные ' +
        'куски рисуют свет и тень, а не заливку. Заливку имеет только вода.',
      terrain:
        'terrains — чем засеяна каждая область карты. Рецепт (какие плитки и как густо) плюс ' +
        'таблица domain → рецепт. Ключ — область знания, а не полигон: карту перерисовывают, ' +
        'и координаты устаревают, а «математика — это горы» остаётся. Сетку клеток берут не ' +
        'из файла соответствия, а из самих контуров карты.',
    },
    groups: GROUPS,
    tiles: tiles.map((tile) => ({
      id: tile.id,
      group: tile.group,
      kind: tile.kind,
      layer: tile.layer,
      title: tile.title,
      use: tile.use,
      tags: tile.tags,
      seams: tile.seams.map((seam) => ({ edges: seam.edges, meets: seam.meets })),
      options: Object.fromEntries(
        Object.entries(tile.options).map(([name, option]) => [
          name,
          { values: [...option.values], fallback: option.fallback, note: option.note },
        ])
      ),
      over: tile.over,
      bleed: tile.bleed,
      clip: tile.clip,
      upright: tile.upright,
      bodies: Array.from({ length: tile.variants }, (_, variant) =>
        tileBody(tile, { variant }, render)
      ),
    })),
    terrains: {
      recipes: TERRAINS,
      byDomain: TERRAIN_BY_DOMAIN,
      byContinent: TERRAIN_BY_CONTINENT,
    },
    assemblies: assemblies.map((assembly) => ({
      ...assembly,
      viewBox: (() => {
        const box = assemblyBox(assembly, findTile, previewSize);
        return `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`;
      })(),
      svg: assemblySvg(assembly, findTile, { ...render, size: previewSize }),
    })),
  };
}

/** What the collection holds, and how many pictures that adds up to. */
export function tally(): { tiles: number; variants: number; parts: number; assemblies: number } {
  return {
    tiles: tiles.length,
    variants: tiles.reduce((sum, tile) => sum + tile.variants, 0),
    parts: tiles.filter((tile) => tile.kind === 'part').length,
    assemblies: assemblies.length,
  };
}

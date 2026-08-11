/**
 * What each territory of the map is made of: the correspondence between a
 * domain of knowledge and the ground it stands on.
 *
 * This is the one file that has to survive the map being redrawn. The map is
 * imported from a sandbox export (`pnpm map:import`), and every redraw moves
 * the coastlines, resizes the territories and renumbers nothing: `shape-math`
 * is a different polygon afterwards, in a different place, with a different
 * number of cells under it. So the correspondence is keyed on **the domain**,
 * which is data, and never on the polygon, which is a picture:
 *
 * - a redrawn map keeps its terrains — mathematics is mountainous wherever the
 *   mountains end up;
 * - a domain added to `data/domains.yaml` and forgotten here falls back to its
 *   continent and is caught by `tests/terrain.test.ts`, which fails until the
 *   table catches up;
 * - a domain deleted leaves a stale line here, which the same test names.
 *
 * Nothing below says where anything is drawn. A terrain is a recipe — which
 * pieces of the collection go on a cell and how densely — and `fill.ts` is what
 * turns a recipe plus a polygon into cells. That split is the point: the recipe
 * cannot go stale with the geometry, because it never knew any.
 */

/** One piece that may land on a cell of its own. */
export type Scatter = {
  tile: string;
  /** Share of the draw, against the other entries. */
  weight: number;
  /** A landmark: at most one per territory, however large. */
  once?: boolean;
  opts?: Record<string, string>;
};

export type ChainPiece = { tile: string; opts?: Record<string, string> };

/**
 * A run of cells laid west to east out of pieces that join along their east and
 * west edges — a mountain range, a scarp, a canyon.
 *
 * Runs are the reason the collection has seams at all, and the reason a
 * territory reads as landscape rather than as confetti: five separate mountain
 * tiles scattered about are five mountains, and the same five in a row are a
 * range. Ends are mirrored rather than turned, because relief has a top.
 */
export type Chain = {
  /** How often a free cell starts a run, 0…1. */
  share: number;
  min: number;
  max: number;
  /** The west end, drawn mirrored. Without one the run just starts. */
  head?: ChainPiece;
  /** Repeated for everything between the ends. */
  body: ChainPiece;
  /** The middle of a run long enough to have one. */
  crown?: ChainPiece;
  tail?: ChainPiece;
};

export type Terrain = {
  id: string;
  /** Russian, for the docs and the viewer. */
  title: string;
  /** What this ground looks like, in one line. */
  note: string;
  /** Share of the cells left over after the runs that carry anything at all. */
  cover: number;
  chain?: Chain;
  scatter: Scatter[];
};

/* ────────────────────────────────  Terrains  ────────────────────────────── */

const RANGE: Chain = {
  share: 0.42,
  min: 2,
  max: 5,
  head: { tile: 'mountain-foot' },
  body: { tile: 'mountain-slope' },
  crown: { tile: 'mountain-peak', opts: { cap: 'snow' } },
  tail: { tile: 'mountain-foot' },
};

export const TERRAINS: Terrain[] = [
  {
    id: 'peaks',
    title: 'Хребты',
    note: 'Горные цепи через всю область, между ними скалы и редкие холмы.',
    cover: 0.4,
    chain: RANGE,
    scatter: [
      { tile: 'crags', weight: 3 },
      { tile: 'hills', weight: 2 },
    ],
  },
  {
    id: 'highland',
    title: 'Нагорье',
    note: 'Приподнятая столовая земля: полосы плато, уступы, холмы по краям.',
    cover: 0.42,
    // One band or two, not four: a plateau crosses its cells from edge to edge,
    // so a run of them is a stripe the whole way across a field, and a field of
    // stripes is a flag.
    chain: { share: 0.26, min: 2, max: 3, body: { tile: 'plateau' } },
    scatter: [
      { tile: 'terraces', weight: 3 },
      { tile: 'hills', weight: 4 },
      { tile: 'crags', weight: 1 },
    ],
  },
  {
    id: 'hills',
    title: 'Холмы',
    note: 'Мягкая неровная земля с рощами — ничего выдающегося, всё обжитое.',
    cover: 0.46,
    scatter: [
      { tile: 'hills', weight: 5 },
      { tile: 'grove', weight: 2 },
      { tile: 'terraces', weight: 1 },
    ],
  },
  {
    id: 'forest',
    title: 'Леса',
    note: 'Сплошной лес, к краям расходящийся рощами.',
    cover: 0.52,
    scatter: [
      { tile: 'forest', weight: 5 },
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'crags',
    title: 'Скалы',
    note: 'Голая порода: останцы, осыпи и одна каменная арка на всю область.',
    cover: 0.44,
    scatter: [
      { tile: 'crags', weight: 5 },
      { tile: 'scree', weight: 3 },
      { tile: 'arch', weight: 1, once: true },
    ],
  },
  {
    id: 'sands',
    title: 'Сушь',
    note: 'Дюны и растрескавшаяся земля — ровное место, по которому видно, что оно сухое.',
    cover: 0.5,
    scatter: [
      { tile: 'dunes', weight: 4 },
      { tile: 'cracked', weight: 3 },
      { tile: 'scree', weight: 1 },
    ],
  },
  {
    id: 'volcanic',
    title: 'Вулканы',
    note: 'Один конус на область, вокруг — камень и осыпи.',
    cover: 0.42,
    scatter: [
      { tile: 'volcano', weight: 1, once: true },
      { tile: 'crags', weight: 3 },
      { tile: 'scree', weight: 3 },
      { tile: 'hills', weight: 2 },
    ],
  },
  {
    id: 'canyons',
    title: 'Каньоны',
    note: 'Земля, вскрытая разломами: русла каньонов и ступени по бортам.',
    cover: 0.4,
    chain: { share: 0.44, min: 2, max: 4, body: { tile: 'canyon' } },
    scatter: [
      { tile: 'terraces', weight: 3 },
      { tile: 'crags', weight: 2 },
      { tile: 'hills', weight: 2 },
    ],
  },
  {
    id: 'plains',
    title: 'Равнина',
    note: 'Почти пустая земля: редкая роща, редкий холм. Тише всех остальных.',
    cover: 0.26,
    scatter: [
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 2 },
    ],
  },
];

const index = new Map(TERRAINS.map((terrain) => [terrain.id, terrain]));

export const findTerrain = (id: string): Terrain | undefined => index.get(id);

/* ─────────────────────────────────  The sea  ────────────────────────────── */

/**
 * Everything that is not a territory, in two bands.
 *
 * The sea is the largest thing on the map and the emptiest, so it is the one
 * place where the density has to be argued down rather than up: the reader is
 * looking for a field of knowledge, and every mark out here is competing with
 * the names of the islands too small to write on.
 *
 * Two bands rather than one recipe, because water says different things at
 * different distances from a coast. Near land it explains the edge — where the
 * bottom comes up, where a reef is, where the rocks break the surface. Out in
 * the open there is nothing to explain, and swell is enough to say the surface
 * is water rather than paper.
 *
 * No plate: the app paints its own sea, in a colour that follows the theme, and
 * these are marks laid on top of it. `shore` is in hex radii.
 */
export const OCEAN: { shore: number; near: Terrain; open: Terrain } = {
  shore: 2.4,
  near: {
    id: 'shore-water',
    title: 'Прибрежная вода',
    note: 'Отмели, рифы и камни у берега — там, где дно поднимается.',
    cover: 0.34,
    scatter: [
      { tile: 'shallows', weight: 5 },
      { tile: 'reef', weight: 2 },
      { tile: 'skerries', weight: 2 },
      { tile: 'swell', weight: 2 },
    ],
  },
  open: {
    id: 'open-water',
    title: 'Открытое море',
    note: 'Зыбь, редкая глубина и одно течение на несколько клеток.',
    cover: 0.15,
    // Rare on purpose: a share is per free cell, and the open sea has thousands
    // of them. This is a dozen streaks across the whole map.
    chain: { share: 0.004, min: 3, max: 6, body: { tile: 'current-straight' } },
    scatter: [
      { tile: 'swell', weight: 7 },
      { tile: 'deep', weight: 3 },
      { tile: 'skerries', weight: 1 },
      { tile: 'whirlpool', weight: 1, once: true },
    ],
  },
};

/* ───────────────────────────  The correspondence  ───────────────────────── */

/**
 * Which ground each field of knowledge stands on.
 *
 * Read it as a description of the field rather than as decoration: the oldest
 * and hardest are mountains, the ones that grow are forest, the ones that dig
 * are canyons, the ones that shift under you are sand. The map is the argument;
 * this is the adjective.
 */
export const TERRAIN_BY_DOMAIN: Record<string, string> = {
  /* ────────────────────────  Formal and natural  ─────────────────────── */
  math: 'peaks', // the range everything else on the continent stands on
  logic: 'crags', // bare rock, nothing growing on it
  probability: 'sands', // ground that moves while you stand on it
  cs: 'highland',
  physics: 'peaks',
  astronomy: 'highland', // thin air, a long way up
  chemistry: 'volcanic',
  'earth-science': 'canyons', // the one field whose subject is the section itself
  biology: 'forest',
  medicine: 'hills',
  engineering: 'highland', // ground worked into steps
  biochemistry: 'volcanic',
  bioinformatics: 'hills',
  'quantum-chemistry': 'crags',
  'machine-learning': 'highland',

  /* ──────────────────────────────  Social  ───────────────────────────── */
  economics: 'hills',
  sociology: 'plains',
  'political-science': 'highland',
  psychology: 'forest',
  anthropology: 'hills',
  law: 'crags', // stone, and what is cut into it
  management: 'highland',
  'human-geography': 'canyons',
  education: 'forest',
  econometrics: 'sands',
  'cognitive-science': 'forest',

  /* ────────────────────────────  Humanities  ─────────────────────────── */
  philosophy: 'peaks',
  history: 'canyons', // layer on layer, read from the side
  linguistics: 'hills',
  literature: 'forest',
  'art-history': 'hills',
  musicology: 'plains',
  religion: 'peaks',
  archaeology: 'canyons',
  classics: 'crags', // ruins, and the arch still standing
  'film-studies': 'sands',
  'computational-linguistics': 'highland',
  'history-of-science': 'canyons',
  bioethics: 'plains',
};

/**
 * What a domain gets when the table above has not caught up with
 * `data/domains.yaml` — a new field is on the map the day it is added, with the
 * ground its neighbours stand on, and the test says which line to write.
 */
export const TERRAIN_BY_CONTINENT: Record<string, string> = {
  formal: 'crags',
  social: 'hills',
  humanities: 'plains',
};

/** The fallback of last resort: a domain on no continent this file knows. */
export const DEFAULT_TERRAIN = 'hills';

export function terrainFor(domainId: string, continent?: string): Terrain {
  const id =
    TERRAIN_BY_DOMAIN[domainId] ??
    (continent ? TERRAIN_BY_CONTINENT[continent] : undefined) ??
    DEFAULT_TERRAIN;
  return findTerrain(id) ?? findTerrain(DEFAULT_TERRAIN)!;
}

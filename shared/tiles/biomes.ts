/**
 * The biomes: what every territory of the map is made of, and what colour it is
 * painted.
 *
 * One file, because they are one decision. A field of knowledge is *a kind of
 * country* — a range, a marsh, a stretch of desert — and a country has both a
 * shape and a colour. Kept apart, the two drift: the ground says taiga and the
 * fill says apricot, and the map stops being a picture of anywhere. Kept
 * together, a line of this table reads as a sentence — «математика — альпийские
 * хребты, цвет гранита» — and there is exactly one place to argue with it.
 *
 * This is also the one file that has to survive the map being redrawn. The map
 * is imported from a sandbox export (`pnpm map:import`), and every redraw moves
 * the coastlines, resizes the territories and renumbers nothing: `shape-math`
 * is a different polygon afterwards, in a different place, with a different
 * number of cells under it. So the correspondence is keyed on **the domain**,
 * which is data, and never on the polygon, which is a picture:
 *
 * - a redrawn map keeps its ground and its colours — mathematics is mountainous
 *   and grey-blue wherever the mountains end up;
 * - a domain added to `data/domains.yaml` and forgotten here falls back to its
 *   continent and is caught by `tests/biomes.test.ts`, which fails until the
 *   table catches up;
 * - a domain deleted leaves a stale line here, which the same test names.
 *
 * Three rules the palette keeps, and the test enforces:
 *
 * 1. **Every colour is used once.** Two territories in one colour is two fields
 *    the reader cannot tell apart, and the colour *is* the data here.
 * 2. **No two neighbours look alike.** Adjacency is read off `public/map.svg`
 *    rather than written down, so a redraw that puts two similar fields side by
 *    side fails the test and names the pair.
 * 3. **A tone belongs to its biome, and a biome to one continent.** The ramps
 *    below are families — every steppe is a gold, every glacier an ice — so a
 *    colour says which country it is before the reader has found the label. And
 *    because no biome is worn on two continents, the three continents are three
 *    palettes: ice and stone, grass and sand, wood and heather.
 *
 * How to compose or regenerate the table, as a prompt you can hand to somebody
 * (or to a model): **[docs/biomes.md](../../docs/biomes.md)**.
 */

import type { Terrain } from './terrain.js';

/**
 * A kind of country: a recipe for its ground, and the ramp its territories are
 * painted from.
 *
 * `colours` is a ramp rather than one colour because a biome is worn by several
 * fields — three of the formal continent's are karst — and two neighbours in the
 * same biome still have to be told apart. The tones of one ramp are a family:
 * near enough that the biome is legible, far enough that a border between two of
 * them is.
 */
export type Biome = Terrain & {
  /**
   * Which continent's climate this biome belongs to.
   *
   * A continent is one country's worth of weather, and that is what makes it
   * legible from across the room: the formal continent is ice and stone, the
   * social one is grass and sand, the humanities are wood, water and heather.
   * No biome is worn on two continents, so a continent's territories are a
   * family of colours before any of them is read.
   *
   * `offshore` is the exception, and the islands are the reason it exists: an
   * island has no neighbour to be told apart from, so it can carry a biome that
   * belongs to no continent at all.
   */
  climate: 'formal' | 'social' | 'humanities' | 'offshore';
  /** Tone name → hex. Every tone is spent at most once across the map. */
  colours: Record<string, string>;
  /** The tone a domain gets when it reaches this biome through a fallback. */
  fallback: string;
};

/* ─────────────────────────────  Shared recipes  ─────────────────────────── */

const RANGE = {
  share: 0.42,
  min: 2,
  max: 5,
  head: { tile: 'mountain-foot' },
  body: { tile: 'mountain-slope' },
  crown: { tile: 'mountain-peak', opts: { cap: 'snow' } },
  tail: { tile: 'mountain-foot' },
};

/* ─────────────────────  The formal continent — ice and stone  ───────────── */

export const BIOMES: Biome[] = [
  {
    id: 'alpine',
    climate: 'formal',
    title: 'Альпийские хребты',
    note: 'Горные цепи через всю область, между ними скалы и снежники.',
    cover: 0.4,
    chain: RANGE,
    colours: { granite: '#9FB6D6', cobalt: '#264EA6', slate: '#525CB0' },
    fallback: 'granite',
    scatter: [
      { tile: 'crags', weight: 3 },
      { tile: 'hills', weight: 2 },
      { tile: 'snowfield', weight: 1 },
    ],
  },
  {
    id: 'glacier',
    climate: 'formal',
    title: 'Ледники',
    note: 'Верхний пояс: снег между камнями, вершины в шапках, голая осыпь.',
    cover: 0.46,
    chain: { ...RANGE, share: 0.3, min: 2, max: 4 },
    colours: { firn: '#DEEDF5', rime: '#AAE6E6' },
    fallback: 'firn',
    scatter: [
      { tile: 'snowfield', weight: 5 },
      { tile: 'scree', weight: 2 },
      { tile: 'crags', weight: 2 },
    ],
  },
  {
    id: 'karst',
    climate: 'formal',
    title: 'Скалы',
    note: 'Голая порода: останцы, осыпи и одна каменная арка на всю область.',
    cover: 0.44,
    colours: { flint: '#747980', travertine: '#B2BBBE', marble: '#9DA6BD' },
    fallback: 'flint',
    scatter: [
      { tile: 'crags', weight: 5 },
      { tile: 'scree', weight: 3 },
      { tile: 'arch', weight: 1, once: true },
    ],
  },
  {
    id: 'tundra',
    climate: 'formal',
    title: 'Тундра',
    note: 'Низкая земля без леса: трава, камень и снег, доживающий до лета.',
    cover: 0.4,
    colours: { lichen: '#54B566', moss: '#4A8470' },
    fallback: 'lichen',
    scatter: [
      { tile: 'grass', weight: 4 },
      { tile: 'scree', weight: 3 },
      { tile: 'snowfield', weight: 2 },
      { tile: 'hills', weight: 2 },
    ],
  },
  {
    id: 'taiga',
    climate: 'formal',
    title: 'Тайга',
    note: 'Хвойный лес до горизонта, редкие камни и проплешины.',
    cover: 0.54,
    colours: { pine: '#359787', spruce: '#66BDC3' },
    fallback: 'pine',
    scatter: [
      { tile: 'forest', weight: 6 },
      { tile: 'grove', weight: 2 },
      { tile: 'crags', weight: 1 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'volcanic',
    climate: 'formal',
    title: 'Вулканы',
    note: 'Пояс, где материк ещё горячий: конус на область, вокруг камень и осыпи.',
    cover: 0.42,
    colours: { basalt: '#92455E', sulphur: '#CB7178', ash: '#AF688F' },
    fallback: 'basalt',
    scatter: [
      { tile: 'volcano', weight: 1, once: true },
      { tile: 'crags', weight: 3 },
      { tile: 'scree', weight: 3 },
      { tile: 'hills', weight: 2 },
    ],
  },

  /* ───────────────────  The social continent — grass and sand  ──────────── */

  {
    id: 'steppe',
    climate: 'social',
    title: 'Степь',
    note: 'Открытая трава на всю область, редкий холм, ещё более редкая роща.',
    cover: 0.5,
    colours: { wheat: '#AE7A32', ochre: '#DF6626', rye: '#E7E7A9' },
    fallback: 'wheat',
    scatter: [
      { tile: 'grass', weight: 7 },
      { tile: 'hills', weight: 2 },
      { tile: 'grove', weight: 1 },
    ],
  },
  {
    id: 'savanna',
    climate: 'social',
    title: 'Саванна',
    note: 'Сухая трава с одиночными рощами и ступенями по краям.',
    cover: 0.48,
    colours: { acacia: '#C96240' },
    fallback: 'acacia',
    scatter: [
      { tile: 'grass', weight: 5 },
      { tile: 'grove', weight: 3 },
      { tile: 'terraces', weight: 1 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'desert',
    climate: 'social',
    title: 'Пустыня',
    note: 'Дюны и растрескавшаяся земля — ровное место, по которому видно, что оно сухое.',
    cover: 0.5,
    colours: { dune: '#F4ECD1', sand: '#E5CEB3' },
    fallback: 'dune',
    scatter: [
      { tile: 'dunes', weight: 4 },
      { tile: 'cracked', weight: 3 },
      { tile: 'scree', weight: 1 },
    ],
  },
  {
    id: 'badlands',
    climate: 'social',
    title: 'Каньоны',
    note: 'Земля, вскрытая разломами: русла каньонов и ступени по бортам.',
    cover: 0.4,
    chain: { share: 0.44, min: 2, max: 4, body: { tile: 'canyon' } },
    colours: { terracotta: '#BF4A2D' },
    fallback: 'terracotta',
    scatter: [
      { tile: 'terraces', weight: 3 },
      { tile: 'crags', weight: 2 },
      { tile: 'hills', weight: 2 },
    ],
  },
  {
    id: 'highland',
    climate: 'social',
    title: 'Нагорье',
    note: 'Приподнятая столовая земля: полосы плато, уступы, холмы по краям.',
    cover: 0.42,
    // One band or two, not four: a plateau crosses its cells from edge to edge,
    // so a run of them is a stripe the whole way across a field, and a field of
    // stripes is a flag.
    chain: { share: 0.26, min: 2, max: 3, body: { tile: 'plateau' } },
    colours: { bronze: '#AEA946', straw: '#BBBA81' },
    fallback: 'bronze',
    scatter: [
      { tile: 'terraces', weight: 3 },
      { tile: 'hills', weight: 4 },
      { tile: 'crags', weight: 1 },
    ],
  },

  /* ────────────  The humanities continent — wood, water and heather  ────── */

  {
    id: 'forest',
    climate: 'humanities',
    title: 'Леса',
    note: 'Сплошной лес, к краям расходящийся рощами.',
    cover: 0.52,
    colours: { oak: '#458745', elm: '#49A049', birch: '#84B473' },
    fallback: 'oak',
    scatter: [
      { tile: 'forest', weight: 5 },
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'jungle',
    climate: 'humanities',
    title: 'Влажный лес',
    note: 'Сомкнутый полог круглых крон, под ним мокрая земля.',
    cover: 0.58,
    colours: { emerald: '#56D2AF', fern: '#69BA93' },
    fallback: 'emerald',
    scatter: [
      { tile: 'canopy', weight: 6 },
      { tile: 'forest', weight: 2 },
      { tile: 'marsh', weight: 2 },
      { tile: 'grove', weight: 1 },
    ],
  },
  {
    id: 'meadow',
    climate: 'humanities',
    title: 'Луга',
    note: 'Мягкая обжитая земля: трава, рощи, невысокие холмы.',
    cover: 0.46,
    colours: { spring: '#CDE48B', sorrel: '#CBE1C1' },
    fallback: 'spring',
    scatter: [
      { tile: 'grass', weight: 4 },
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 3 },
    ],
  },
  {
    id: 'wetland',
    climate: 'humanities',
    title: 'Марши',
    note: 'Мокрая земля пятнами стоячей воды, между ними ивняк и низкие бугры.',
    cover: 0.5,
    colours: { peat: '#4B7781' },
    fallback: 'peat',
    scatter: [
      { tile: 'marsh', weight: 6 },
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'heath',
    climate: 'humanities',
    title: 'Вересковая пустошь',
    note: 'Открытая земля, на которой ничего не растёт выше колена: вереск, камень, один стоячий валун.',
    cover: 0.44,
    colours: { heather: '#A475BB', ling: '#D8BEDA', bell: '#614A96' },
    fallback: 'heather',
    scatter: [
      { tile: 'grass', weight: 5 },
      { tile: 'crags', weight: 2 },
      { tile: 'hills', weight: 2 },
      { tile: 'scree', weight: 1 },
      { tile: 'arch', weight: 1, once: true },
    ],
  },

  /* ─────────────────────────────  Offshore  ─────────────────────────────── */

  {
    id: 'atoll',
    climate: 'offshore',
    title: 'Острова',
    note: 'Пальмы на песке: биом, который есть только за проливом и больше нигде.',
    cover: 0.62,
    colours: { lagoon: '#47B2D7', coral: '#EB897A', palm: '#89DCBA', shell: '#E2C283' },
    fallback: 'lagoon',
    // Denser than anything on the mainland on purpose: an island is a handful of
    // cells, and half of them empty reads as an island that failed to load.
    scatter: [
      { tile: 'palms', weight: 5 },
      { tile: 'hills', weight: 2 },
      { tile: 'dunes', weight: 2 },
      { tile: 'marsh', weight: 1 },
    ],
  },
];

const index = new Map(BIOMES.map((biome) => [biome.id, biome]));

export const findBiome = (id: string): Biome | undefined => index.get(id);

/* ───────────────────────────  The correspondence  ───────────────────────── */

/**
 * Which country each field of knowledge is, as `biome/tone`.
 *
 * Read it as a description of the field rather than as decoration: the oldest
 * and hardest are mountains, the ones that grow are forest, the ones that dig
 * are canyons, the ones that shift under you are sand. The map is the argument;
 * this is the adjective.
 *
 * The tone after the slash is a colour out of that biome's ramp, and choosing
 * it is the other half of the job: no two neighbours on `public/map.svg` may
 * wear tones that look alike. Which pairs are neighbours is a fact about the
 * current map, so it is measured by the test rather than written down here.
 */
export const BIOME_BY_DOMAIN: Record<string, string> = {
  /* ───────────────  Formal and natural — a continent of ice and stone  ─── */
  math: 'alpine/granite', // the range the whole continent stands on
  cs: 'alpine/cobalt', // the second range of the same system, younger than the first
  bioinformatics: 'alpine/slate', // the spur where two ranges meet
  physics: 'glacier/firn', // high, cold, and the same everywhere
  astronomy: 'glacier/rime', // thin air, a long way up
  logic: 'karst/flint', // bare rock, nothing growing on it
  'earth-science': 'karst/travertine', // the one field whose subject is the section itself
  engineering: 'karst/marble', // stone worked into something that holds
  probability: 'tundra/lichen', // ground that moves while you stand on it
  'machine-learning': 'tundra/moss', // flat, self-similar, and it goes on for ever
  biology: 'taiga/pine', // the forest a cold continent gets
  medicine: 'taiga/spruce', // the same wood, tended
  chemistry: 'volcanic/basalt', // the belt where the continent is still hot
  biochemistry: 'volcanic/sulphur',
  'quantum-chemistry': 'volcanic/ash',

  /* ─────────────────  Social — a continent of grass and sand  ─────────── */
  education: 'steppe/wheat', // what is sown comes up
  anthropology: 'steppe/ochre',
  sociology: 'steppe/rye',
  economics: 'savanna/acacia', // exchange under solitary trees
  psychology: 'desert/dune', // ground that shifts while it is being measured
  'human-geography': 'desert/sand',
  law: 'badlands/terracotta', // layers cut open, and what is read off the wall
  'political-science': 'highland/bronze', // ground worked into steps
  management: 'highland/straw',

  /* ────────  Humanities — a continent of wood, water and heather  ─────── */
  literature: 'forest/oak',
  archaeology: 'forest/elm', // digging under the trees
  linguistics: 'forest/birch',
  'art-history': 'jungle/emerald', // the closed canopy
  'history-of-science': 'jungle/fern',
  musicology: 'meadow/spring', // the quietest ground there is
  classics: 'meadow/sorrel', // ruins in the grass
  history: 'wetland/peat', // layer on layer, read from the side
  philosophy: 'heath/heather', // open ground, and you can see a long way
  religion: 'heath/ling',
  'film-studies': 'heath/bell',

  /* ──────────────────────  Offshore — the islands  ─────────────────────── */
  econometrics: 'atoll/lagoon',
  'cognitive-science': 'atoll/coral',
  'computational-linguistics': 'atoll/palm',
  bioethics: 'atoll/shell',
};

/**
 * What a domain gets when the table above has not caught up with
 * `data/domains.yaml` — a new field is on the map the day it is added, with the
 * ground its neighbours stand on, and the test says which line to write.
 *
 * It gets the biome's `fallback` tone, which is already spent by somebody else,
 * so the new field is a twin of an old one until the line above is written. That
 * is the right failure: a field with no ground at all reads as a bug in the map,
 * and a field sharing a colour reads as a table somebody has not finished — which
 * is exactly what it is, and what the test says out loud.
 *
 * Each entry is a biome of that continent's own climate, so even a field nobody
 * has written a line for lands on the right continent's palette.
 */
export const BIOME_BY_CONTINENT: Record<string, string> = {
  formal: 'karst',
  social: 'steppe',
  humanities: 'forest',
};

/** The fallback of last resort: a domain on no continent this file knows. */
export const DEFAULT_BIOME = 'karst';

function entryFor(domainId: string, continent?: string): { biome: Biome; tone: string } {
  const written = BIOME_BY_DOMAIN[domainId];
  if (written) {
    const [id, tone] = written.split('/');
    const biome = findBiome(id);
    if (biome) return { biome, tone: tone in biome.colours ? tone : biome.fallback };
  }
  const biome =
    (continent ? findBiome(BIOME_BY_CONTINENT[continent]) : undefined) ??
    findBiome(DEFAULT_BIOME)!;
  return { biome, tone: biome.fallback };
}

/** The ground a field stands on. Also a `Terrain`, which is all `fill.ts` wants. */
export function biomeFor(domainId: string, continent?: string): Biome {
  return entryFor(domainId, continent).biome;
}

/**
 * The colour a territory is painted, and with it every badge, icon and piece of
 * course art that field owns. `data/domains.yaml` carries no colours: the
 * loader asks here, so the map and the rest of the app cannot disagree.
 */
export function colourOf(domainId: string, continent?: string): string {
  const { biome, tone } = entryFor(domainId, continent);
  return biome.colours[tone] ?? Object.values(biome.colours)[0];
}

/** Every colour the map spends, keyed by domain. */
export function palette(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(BIOME_BY_DOMAIN).map((domainId) => [domainId, colourOf(domainId)])
  );
}

/* ──────────────────────────────  Telling apart  ─────────────────────────── */

/**
 * How far apart two colours look, 0…1, in OKLab.
 *
 * Not a hue difference and not a contrast ratio. Hue distance calls a pale
 * yellow and a dark brown the same colour; contrast ratio calls turquoise and
 * pink the same colour. The map needs the question a reader actually asks —
 * "are these two fields the same country?" — and that is perceptual distance.
 *
 * The map washes a territory's colour over its own ground at well under full
 * opacity, so the distance a reader gets is a fraction of the one measured
 * here. Which is why the threshold the test holds the palette to is generous.
 */
export function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function oklab(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const channel = (at: number): number => {
    const srgb = parseInt(value.slice(at, at + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(0);
  const g = channel(2);
  const b = channel(4);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

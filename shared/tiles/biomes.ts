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
 * 3. **A tone belongs to its biome.** The ramps below are families — every
 *    steppe is a gold, every glacier an ice — so a colour says which country it
 *    is before the reader has found the label.
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
 * fields — seven domains are highland — and two neighbours in the same biome
 * still have to be told apart. The tones of one ramp are a family: near enough
 * that the biome is legible, far enough that a border between two of them is.
 */
export type Biome = Terrain & {
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

/* ────────────────────────────────  The biomes  ──────────────────────────── */

export const BIOMES: Biome[] = [
  {
    id: 'alpine',
    title: 'Альпийские хребты',
    note: 'Горные цепи через всю область, между ними скалы и снежники.',
    cover: 0.4,
    chain: RANGE,
    colours: { granite: '#8093C3', cobalt: '#4082C0', slate: '#7179AC', gabbro: '#B5A2D9' },
    fallback: 'granite',
    scatter: [
      { tile: 'crags', weight: 3 },
      { tile: 'hills', weight: 2 },
      { tile: 'snowfield', weight: 1 },
    ],
  },
  {
    id: 'glacier',
    title: 'Ледники',
    note: 'Верхний пояс: снег между камнями, вершины в шапках, голая осыпь.',
    cover: 0.46,
    chain: { ...RANGE, share: 0.3, min: 2, max: 4 },
    colours: { firn: '#9ACEE4', rime: '#AFE3E3' },
    fallback: 'firn',
    scatter: [
      { tile: 'snowfield', weight: 5 },
      { tile: 'scree', weight: 2 },
      { tile: 'crags', weight: 2 },
    ],
  },
  {
    id: 'tundra',
    title: 'Тундра',
    note: 'Низкая земля без леса: трава, камень и снег, доживающий до лета.',
    cover: 0.4,
    colours: { lichen: '#82BF82', moss: '#6A9B82' },
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
    title: 'Тайга',
    note: 'Хвойный лес до горизонта, редкие камни и проплешины.',
    cover: 0.54,
    colours: { pine: '#44928F' },
    fallback: 'pine',
    scatter: [
      { tile: 'forest', weight: 6 },
      { tile: 'grove', weight: 2 },
      { tile: 'crags', weight: 1 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'forest',
    title: 'Леса',
    note: 'Сплошной лес, к краям расходящийся рощами.',
    cover: 0.52,
    colours: { oak: '#55A03E', elm: '#70AE74' },
    fallback: 'oak',
    scatter: [
      { tile: 'forest', weight: 5 },
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'jungle',
    title: 'Влажный лес',
    note: 'Сомкнутый полог круглых крон, под ним мокрая земля.',
    cover: 0.58,
    colours: { emerald: '#3AA677' },
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
    title: 'Луга',
    note: 'Мягкая обжитая земля: трава, рощи, невысокие холмы.',
    cover: 0.46,
    colours: { spring: '#A7D87C', clover: '#D2E294', sorrel: '#71BA5A' },
    fallback: 'spring',
    scatter: [
      { tile: 'grass', weight: 4 },
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 3 },
    ],
  },
  {
    id: 'steppe',
    title: 'Степь',
    note: 'Открытая трава на всю область, редкий холм, ещё более редкая роща.',
    cover: 0.5,
    colours: { wheat: '#D79526', ochre: '#C08A26', rye: '#D3CC79' },
    fallback: 'wheat',
    scatter: [
      { tile: 'grass', weight: 7 },
      { tile: 'hills', weight: 2 },
      { tile: 'grove', weight: 1 },
    ],
  },
  {
    id: 'savanna',
    title: 'Саванна',
    note: 'Сухая трава с одиночными рощами и ступенями по краям.',
    cover: 0.48,
    colours: { acacia: '#E19C66' },
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
    title: 'Пустыня',
    note: 'Дюны и растрескавшаяся земля — ровное место, по которому видно, что оно сухое.',
    cover: 0.5,
    colours: { dune: '#F8F4DC', sand: '#E0CCA1' },
    fallback: 'dune',
    scatter: [
      { tile: 'dunes', weight: 4 },
      { tile: 'cracked', weight: 3 },
      { tile: 'scree', weight: 1 },
    ],
  },
  {
    id: 'badlands',
    title: 'Каньоны',
    note: 'Земля, вскрытая разломами: русла каньонов и ступени по бортам.',
    cover: 0.4,
    chain: { share: 0.44, min: 2, max: 4, body: { tile: 'canyon' } },
    colours: { terracotta: '#D67251', clay: '#C5403B', rust: '#C06735' },
    fallback: 'terracotta',
    scatter: [
      { tile: 'terraces', weight: 3 },
      { tile: 'crags', weight: 2 },
      { tile: 'hills', weight: 2 },
    ],
  },
  {
    id: 'volcanic',
    title: 'Вулканы',
    note: 'Один конус на область, вокруг — камень и осыпи.',
    cover: 0.42,
    colours: { basalt: '#954963', sulphur: '#AE5944', ember: '#DA626A' },
    fallback: 'basalt',
    scatter: [
      { tile: 'volcano', weight: 1, once: true },
      { tile: 'crags', weight: 3 },
      { tile: 'scree', weight: 3 },
      { tile: 'hills', weight: 2 },
    ],
  },
  {
    id: 'karst',
    title: 'Скалы',
    note: 'Голая порода: останцы, осыпи и одна каменная арка на всю область.',
    cover: 0.44,
    colours: { flint: '#856955', chalk: '#E7E6E3', marble: '#D8D6CB', travertine: '#AA7468' },
    fallback: 'flint',
    scatter: [
      { tile: 'crags', weight: 5 },
      { tile: 'scree', weight: 3 },
      { tile: 'arch', weight: 1, once: true },
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
    colours: { bronze: '#B27C39', straw: '#BFBB74' },
    fallback: 'bronze',
    scatter: [
      { tile: 'terraces', weight: 3 },
      { tile: 'hills', weight: 4 },
      { tile: 'crags', weight: 1 },
    ],
  },
  {
    id: 'wetland',
    title: 'Марши',
    note: 'Мокрая земля пятнами стоячей воды, между ними ивняк и низкие бугры.',
    cover: 0.5,
    colours: { reed: '#3F839B', sedge: '#406F96' },
    fallback: 'reed',
    scatter: [
      { tile: 'marsh', weight: 6 },
      { tile: 'grove', weight: 3 },
      { tile: 'hills', weight: 1 },
    ],
  },
  {
    id: 'atoll',
    title: 'Острова',
    note: 'Пальмы на песке: биом, который есть только за проливом и больше нигде.',
    cover: 0.62,
    colours: { lagoon: '#62CCDD', coral: '#EB8A7B', palm: '#6AD2A8', shell: '#E1B87F' },
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
  /* ────────────────────────  Formal and natural  ─────────────────────── */
  math: 'alpine/granite', // the range everything else on the continent stands on
  logic: 'karst/flint', // bare rock, nothing growing on it
  probability: 'desert/dune', // ground that moves while you stand on it
  cs: 'alpine/cobalt', // the second range of the same system, younger than the first
  physics: 'glacier/firn', // high, cold and the same everywhere
  astronomy: 'tundra/lichen', // thin air, a long way up
  chemistry: 'volcanic/basalt',
  'earth-science': 'badlands/terracotta', // the one field whose subject is the section itself
  biology: 'jungle/emerald',
  medicine: 'meadow/spring', // tended ground
  engineering: 'highland/bronze', // ground worked into steps
  biochemistry: 'volcanic/sulphur',
  bioinformatics: 'steppe/wheat', // open ground, read from end to end
  'quantum-chemistry': 'karst/marble',
  'machine-learning': 'taiga/pine',

  /* ──────────────────────────────  Social  ───────────────────────────── */
  economics: 'savanna/acacia',
  sociology: 'meadow/clover',
  'political-science': 'alpine/slate',
  psychology: 'forest/oak',
  anthropology: 'steppe/ochre',
  law: 'karst/chalk', // stone, and what is cut into it
  management: 'highland/straw',
  'human-geography': 'badlands/clay',
  education: 'wetland/reed', // wet ground: everything put in it comes up
  econometrics: 'atoll/lagoon',
  'cognitive-science': 'atoll/coral',

  /* ────────────────────────────  Humanities  ─────────────────────────── */
  philosophy: 'alpine/gabbro',
  history: 'badlands/rust', // layer on layer, read from the side
  linguistics: 'steppe/rye',
  literature: 'forest/elm',
  'art-history': 'meadow/sorrel',
  musicology: 'tundra/moss', // the quietest ground there is
  religion: 'glacier/rime',
  archaeology: 'desert/sand',
  classics: 'karst/travertine', // ruins, and the arch still standing
  'film-studies': 'volcanic/ember',
  'computational-linguistics': 'atoll/palm',
  'history-of-science': 'wetland/sedge',
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
 */
export const BIOME_BY_CONTINENT: Record<string, string> = {
  formal: 'karst',
  social: 'meadow',
  humanities: 'steppe',
};

/** The fallback of last resort: a domain on no continent this file knows. */
export const DEFAULT_BIOME = 'meadow';

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

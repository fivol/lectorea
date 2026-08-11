# Biomes: what a field of knowledge is made of, and what colour it is

Every territory on the map is a **biome** — a kind of country. A biome carries
two things that are really one decision:

- **the ground**: which tiles of the collection land on its hexes, and how
  densely;
- **the colour**: the ramp its territories are painted from.

Both live on one line of one file, [`shared/tiles/biomes.ts`](../shared/tiles/biomes.ts):

```ts
math: 'alpine/granite',        // альпийские хребты, цвет гранита
'earth-science': 'karst/travertine',
education: 'steppe/wheat',
```

`alpine` names the biome; `granite` names a tone in that biome's ramp. Nothing
else in the repository holds a domain's colour — `data/domains.yaml` deliberately
has no `color:` field, and `loadSources()` fills it in from here, so the map, the
badges, the icons and the generated course art cannot drift apart.

```bash
pnpm data:build     # after editing the table: rewrites public/data/domains.json
pnpm test           # tests/biomes.test.ts is the alarm on all of it
pnpm tiles:view     # the collection, to see what a recipe can be built from
```

## Why the table is keyed on the domain

The map is imported from a sandbox export (`pnpm map:import`), and every redraw
moves the coastlines, resizes the territories and renumbers nothing. `shape-math`
is a different polygon afterwards, in a different place, with a different number
of cells under it.

So the correspondence is keyed on **the domain**, which is data, and never on the
polygon, which is a picture. A redrawn map keeps its ground and its colours:
mathematics is mountainous and grey-blue wherever the mountains end up.

What a redraw *can* invalidate is which territories are neighbours — and that is
measured rather than written down. `tests/biomes.test.ts` reads the borders back
off `public/map.svg` and names any pair of neighbours that came out looking
alike.

## A continent is a climate

No biome is worn on two continents. That is the rule that makes a continent
legible from across the room: its territories are a family of colours before any
of them is read, and the branch of knowledge is carried by the *weather* rather
than by a caption. Each biome declares its `climate`, and the test fails if a
domain ever wears a biome from somebody else's.

### Формально-естественные — лёд и камень

Cold, high and mineral. Blues, ice, cool stone, lichen, deep conifer, and one
belt where the continent is still hot.

| id | | ground | tones |
|---|---|---|---|
| `alpine` | Альпийские хребты | ranges, crags, snow between them | granite, cobalt, slate |
| `glacier` | Ледники | snowfields, capped peaks, bare scree | firn, rime |
| `karst` | Скалы | bare rock, scree, one arch | flint, travertine, marble |
| `tundra` | Тундра | grass, stone, snow that lasts the summer | lichen, moss |
| `taiga` | Тайга | conifer forest to the horizon | pine, spruce |
| `volcanic` | Вулканы | one cone, then rock and scree | basalt, sulphur, ash |

### Социальные — трава и песок

Dry and open. Gold, amber, sand, bronze, one rust.

| id | | ground | tones |
|---|---|---|---|
| `steppe` | Степь | open grass, the odd hill | wheat, ochre, rye |
| `savanna` | Саванна | dry grass with solitary groves | acacia |
| `desert` | Пустыня | dunes and cracked ground | dune, sand |
| `badlands` | Каньоны | canyon runs and terraced walls | terracotta |
| `highland` | Нагорье | plateau bands, steps, hills | bronze, straw |

### Гуманитарные — лес, вода и вереск

Old and overgrown. Greens, one peat, and the heather that gives the continent
its violet.

| id | | ground | tones |
|---|---|---|---|
| `forest` | Леса | closed wood thinning to groves | oak, elm, birch |
| `jungle` | Влажный лес | round-crowned canopy over wet ground | emerald, fern |
| `meadow` | Луга | grass, groves, low hills | spring, sorrel |
| `wetland` | Марши | standing water in patches, willow | peat |
| `heath` | Вересковая пустошь | heather, stone, one standing arch | heather, ling, bell |

### За проливом

| id | | ground | tones |
|---|---|---|---|
| `atoll` | Острова | palms on sand — offshore only | lagoon, coral, palm, shell |

`atoll` is the one biome that belongs to no continent, and no mainland territory
may wear it. An island has no neighbour to be told apart from, which is exactly
what makes it the place a biome that exists nowhere else can live.

## The three rules the palette keeps

1. **Every colour is spent once.** Two territories in one colour are two fields
   the reader cannot tell apart, and here the colour *is* the data.
2. **No two neighbours look alike.** Measured in OKLab across every border the
   current map actually draws — see `colourDistance` in `biomes.ts`. The
   threshold is generous (0.15) because the map lays the colour down as a wash
   over its own ground, so the difference a reader gets is a fraction of the one
   measured.
3. **A tone belongs to its biome, and a biome to one continent.** The ramps are
   families: every steppe is a gold, every glacier an ice. And because no biome
   crosses a coast, the three continents come out as three palettes rather than
   as one palette shuffled.

Rules 2 and 3 pull against each other, and that tension is the whole job. A
continent wants its fields to look related; a border wants its two sides to look
different. The way out is the ramp: fifteen cold territories, but a *cobalt*
next to a *flint* next to a *lichen*. The floor for two fields that share no
border is only 0.04 — inside one climate they are meant to be cousins.

## Changing one field

Edit one line of `BIOME_BY_DOMAIN`, run `pnpm data:build`, run `pnpm test`. If
the new tone is too close to a neighbour, the test names the pair and the
distance. Nothing needs regenerating beyond the catalogue: the app renders the
collection from source, and `public/map.svg` carries no colours at all.

Moving a field to a **different continent's** biome will not work: the test
checks the climate against `data/domains.yaml` and names the stray. A field
changes continent by changing continent, not by changing colour.

Adding a **new biome** is an entry in `BIOMES` built from land pieces, with the
`climate` of the continent it belongs to — the test checks that every tile it
names exists, is a land piece, and that a `chain` body actually joins along the
east and west edges. Adding a **new tile** to build it from is
[docs/tiles.md](tiles.md#adding-a-tile).

---

# The prompt

Everything below is written to be handed to somebody — or to a model — who has
to rebuild the table from scratch, or repair it after the map is redrawn. Copy
it as it stands.

> You are composing `shared/tiles/biomes.ts` for a map of the fields of
> knowledge. The map is a field of hexagons: three continents and a few offshore
> islands, one territory per domain, no borders drawn except a hairline. Each
> territory is filled with a wash of its own colour and seeded with tiles from
> `shared/tiles/` — light and shade only, never paint, because the territory's
> colour is the data.
>
> **Your inputs**
>
> 1. `data/domains.yaml` — every domain, with its continent.
> 2. `public/map.svg` — the drawing. Two territories are neighbours when their
>    outlines share two or more hex corners (the control point of every `Q`).
>    Which pairs those are is a fact about the current file: read it, do not
>    assume it.
> 3. `shared/tiles/index.ts` — the tiles you may build a recipe from. Only
>    pieces with `over: 'land'`; only `kind: 'solo'` in `scatter`; a `chain`
>    body must have seams on edges 0 and 3.
>
> **What you produce**
>
> `BIOMES` — for each biome: `id`, the `climate` (which continent it belongs to,
> or `offshore`), Russian `title`, a one-line `note`, `cover` (share of free
> cells that carry anything, 0.4–0.6), an optional `chain`, a `scatter` list of
> `{ tile, weight }`, a `colours` ramp of `tone: '#RRGGBB'`, and a `fallback`
> tone. Then `BIOME_BY_DOMAIN`, one line per domain, as `'biome/tone'`.
>
> **Rules, in the order they bind**
>
> 1. *A continent is one climate.* Decide the three climates first and give each
>    biome to exactly one of them. No biome crosses a coast, so a continent is a
>    family of colours: cold blue and stone; dry gold and sand; green and
>    heather. This is what makes the map readable at thumbnail size, and it is
>    the constraint everything else is fitted inside.
> 2. *Semantics second, inside the climate.* The biome is an adjective for the
>    field, not decoration — but the adjective is chosen from the words its
>    continent has. The oldest and hardest are mountains; the ones that grow are
>    forest; the ones that dig are canyons; the ones that shift under you are
>    sand. Write the reason as a trailing comment when it is not obvious.
> 3. *Islands are their own country.* Every offshore territory wears one biome
>    whose climate is `offshore` and which no mainland territory wears.
> 4. *Every tone is spent at most once.* One domain, one tone, one colour.
> 5. *No two neighbours look alike.* In OKLab, distance ≥ 0.15 across every
>    border the map draws. This is the constraint that costs work, and inside a
>    single climate it costs most: expect to move a domain to a different biome
>    of its own continent, not just to a different tone. Lightness is the axis
>    that buys the most — stagger it deliberately across a continent's tones
>    before touching hue.
> 6. *No two fields anywhere are the same colour.* Distance ≥ 0.04 over all
>    39 × 38 / 2 pairs. Loose on purpose: cousins inside one climate are the
>    point.
> 7. *A ramp is a family.* Every tone of one biome shares a hue band and reads
>    as the same country; they differ in lightness and chroma, not in kind.
> 8. *Stay in the legible middle.* HSL lightness roughly 0.40–0.88. Below that a
>    colour dies on the night map and as an icon; above it, on the day map. Text
>    is bent to fit by `inkOn()`, shapes are not.
> 9. *The ground has to match the colour.* A biome's tiles and its ramp are one
>    idea. If you change one, change the other.
>
> **How to work**
>
> Choose the three climates, then assign biomes by meaning inside them, ignoring
> the exact colours. Then read the adjacency off the map and list, for each
> territory, what it touches. Then pick tones — hardest-constrained territory
> first (the one with the most neighbours; on this map that is philosophy, with
> nine). Check the distance rules numerically, not by eye; when a pair fails,
> prefer changing the biome of the *less* constrained of the two. Repeat until
> clean.
>
> Do not tune the numbers by hand from the start. Anchor each tone where you
> mean it to be, then let a solver nudge it inside a small box around that
> anchor — a solver given a free hand paints coral blue and the biome stops
> being a biome.
>
> **How you know you are done**
>
> `pnpm test` passes `tests/biomes.test.ts`, and `pnpm data:build` followed by a
> look at the map shows every border as a border.

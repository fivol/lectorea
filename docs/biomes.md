# Biomes: what a field of knowledge is made of, and what colour it is

Every territory on the map is a **biome** — a kind of country. A biome carries
two things that are really one decision:

- **the ground**: which tiles of the collection land on its hexes, and how
  densely;
- **the colour**: the ramp its territories are painted from.

Both live on one line of one file, [`shared/tiles/biomes.ts`](../shared/tiles/biomes.ts):

```ts
math: 'alpine/granite',        // альпийские хребты, цвет гранита
'earth-science': 'badlands/terracotta',
education: 'wetland/reed',
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

## The sixteen biomes

| id | | ground | colour family |
|---|---|---|---|
| `alpine` | Альпийские хребты | ranges, crags, snow between them | cool blue-grey stone |
| `glacier` | Ледники | snowfields, capped peaks, bare scree | pale ice |
| `tundra` | Тундра | grass, stone, snow that lasts the summer | muted grey-green |
| `taiga` | Тайга | conifer forest to the horizon | deep blue-green |
| `forest` | Леса | closed wood thinning to groves | leaf green |
| `jungle` | Влажный лес | round-crowned canopy over wet ground | emerald |
| `meadow` | Луга | grass, groves, low hills | light yellow-green |
| `steppe` | Степь | open grass, the odd hill | golden straw |
| `savanna` | Саванна | dry grass with solitary groves | warm amber |
| `desert` | Пустыня | dunes and cracked ground | pale sand |
| `badlands` | Каньоны | canyon runs and terraced walls | rust and terracotta |
| `volcanic` | Вулканы | one cone, then rock and scree | dark ember |
| `karst` | Скалы | bare rock, scree, one arch | bone and limestone |
| `highland` | Нагорье | plateau bands, steps, hills | olive and bronze |
| `wetland` | Марши | standing water in patches, willow | teal |
| `atoll` | Острова | palms on sand — offshore only | tropical turquoise, coral, jade |

`atoll` is the one biome no mainland territory may wear. An island has no
neighbour to be told apart from, which is exactly what makes it the place a
biome that exists nowhere else can live — and the test enforces it.

## The three rules the palette keeps

1. **Every colour is spent once.** Two territories in one colour are two fields
   the reader cannot tell apart, and here the colour *is* the data.
2. **No two neighbours look alike.** Measured in OKLab across every border the
   current map actually draws — see `colourDistance` in `biomes.ts`. The
   threshold is generous (0.15) because the map lays the colour down as a wash
   over its own ground, so the difference a reader gets is a fraction of the one
   measured.
3. **A tone belongs to its biome.** The ramps are families: every steppe is a
   gold, every glacier an ice. A colour should say which country it is before
   the reader has found the label.

Two colours on opposite continents are allowed to be cousins (the floor there is
only 0.045). Forbidding that would mean spreading 39 colours over the whole wheel
and the map would stop looking like a map of anywhere.

## Changing one field

Edit one line of `BIOME_BY_DOMAIN`, run `pnpm data:build`, run `pnpm test`. If
the new tone is too close to a neighbour, the test names the pair and the
distance. Nothing needs regenerating beyond the catalogue: the app renders the
collection from source, and `public/map.svg` carries no colours at all.

Adding a **new biome** is an entry in `BIOMES` built from land pieces — the test
checks that every tile it names exists, is a land piece, and that a `chain` body
actually joins along the east and west edges. Adding a **new tile** to build it
from is [docs/tiles.md](tiles.md#adding-a-tile).

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
> `BIOMES` — for each biome: `id`, Russian `title`, a one-line `note`, `cover`
> (share of free cells that carry anything, 0.4–0.6), an optional `chain`, a
> `scatter` list of `{ tile, weight }`, a `colours` ramp of `tone: '#RRGGBB'`,
> and a `fallback` tone. Then `BIOME_BY_DOMAIN`, one line per domain, as
> `'biome/tone'`.
>
> **Rules, in the order they bind**
>
> 1. *Semantics first.* The biome is an adjective for the field, not decoration.
>    The oldest and hardest are mountains; the ones that grow are forest; the
>    ones that dig are canyons; the ones that shift under you are sand; the
>    quietest is tundra. Write the reason as a trailing comment when it is not
>    obvious.
> 2. *Islands are their own country.* Every offshore territory wears one biome
>    that no mainland territory wears.
> 3. *Every tone is spent at most once.* One domain, one tone, one colour.
> 4. *No two neighbours look alike.* In OKLab, distance ≥ 0.15 across every
>    border the map draws. This is the constraint that costs work: expect to
>    move a domain to a different biome, not just to a different tone, when a
>    field has many neighbours. Fix it structurally — a territory hemmed in by
>    greens should not be a green.
> 5. *No two fields anywhere are the same colour.* Distance ≥ 0.045 over all
>    39 × 38 / 2 pairs.
> 6. *A ramp is a family.* Every tone of one biome shares a hue band and reads
>    as the same country; they differ in lightness and chroma, not in kind.
> 7. *Stay in the legible middle.* HSL lightness roughly 0.42–0.88. Below that a
>    colour dies on the night map and as an icon; above it, on the day map. Text
>    is bent to fit by `inkOn()`, shapes are not.
> 8. *The ground has to match the colour.* A biome's tiles and its ramp are one
>    idea. If you change one, change the other.
>
> **How to work**
>
> Assign biomes by meaning first and ignore the colours. Then read the adjacency
> off the map and list, for each territory, what it touches. Then pick tones —
> hardest-constrained territory first (the one with the most neighbours). Check
> the two distance rules numerically, not by eye; when a pair fails, prefer
> changing the biome of the *less* constrained of the two. Repeat until clean.
>
> **How you know you are done**
>
> `pnpm test` passes `tests/biomes.test.ts`, and `pnpm data:build` followed by a
> look at the map shows every border as a border.

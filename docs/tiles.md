# The tile collection

The map is a field of hexagons with no borders drawn: territories coloured by
domain, sea between them. This is the set of pieces that go on those cells —
30 tiles at the altitude of a mountain range, a river, a reef, stacked several
to a cell and joined across cells into larger objects.

```bash
pnpm tiles:view      # one self-contained HTML page, opens straight from disk
pnpm tiles:build     # generate and export the collection into .tiles/
```

Code lives in `shared/tiles/`; the viewer's page in `sandbox/tiles/`; the two
commands in `scripts/tiles-build.ts` and `scripts/tiles-view.ts`. Nothing in the
frontend depends on it yet — like `pnpm map:preview`, it is a workshop, not a
build step.

## Two rules the whole collection follows

**Land is not painted.** A land cell already has a colour — the territory it
belongs to, which on this map *is* the data. Cover it with green and the map
stops saying anything. So relief is light and shade: a white face at low
opacity, a cool dark one, and a drawn crest. The same mountain reads over green,
purple and pink. Only water owns a colour, because the sea is one flat field
behind everything.

**The cell is about 30 px across.** `defaultConfig.hexR` in `shared/mapgen.ts`
is 16, so a hex is 27 px wide on the finished map. That fixes the altitude: a
range, a scarp, a river, a reef — never a tree, never a tuft of grass. Five or
six shapes per piece; anything finer is mud. The viewer draws every object a
second time at 16 px for exactly this reason.

Water stays at the edge. There are no inland lakes: a river is a line and does
not cover the territory, a coast is the seam at a landmass boundary, and
everything else wet is out at sea.

## What a tile is

Not a picture of a finished cell — one layer of one:

- **`plate`** — an opaque fill for the whole hex. Only the sea and the coast
  seam need one.
- **`surface`** — something flat on top: a river, a shoal, a current.
- **`relief`** — volume. Light and shade, and it may rise past the cell's edge.
- **`overlay`** — a small mark above everything: skerries, a whirlpool.

`over` says whether the cell underneath is `land` or `water`. The second axis is
whether a piece stands alone:

- **`solo`** — droppable on any matching cell. Hills, dunes, a volcano, swell.
- **`part`** — a fragment: a mountain shoulder, a river bend, a stretch of
  coast, a current. Alone it is a shape nobody can place, so it carries
  **seams**.

## Seams: how pieces join

`seams` records which of the six hex edges the drawing runs across, and what has
to be on the other side.

```ts
seams: [{ edges: [0, 3], meets: 'ridge' }]     // mountain-slope
seams: [{ edges: [1, 2], meets: 'water' },     // coast-shore
        { edges: [3, 4, 5, 0], meets: 'land' }]
```

`meets` is one of `water`, `land`, `channel`, `ridge`, `scarp`, `current`. Edges
are numbered the same way as the neighbour directions in `shared/mapgen.ts`:

| edge | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| direction | east | south-east | south-west | west | north-west | north-east |
| axial step | +1,0 | 0,+1 | −1,+1 | −1,0 | 0,−1 | +1,−1 |

Edge `i` runs between corner `i` and corner `i + 1`; corner `i` sits at angle
`60i − 30°`.

Two rules make the joins work without a lookup table:

- **Coastlines are pinned to corners.** A shoreline enters at a corner and
  leaves at a corner, wandering freely in between. A corner is shared by three
  hexes, so neighbouring pieces meet there whatever each drew. That is why one
  piece, rotated six ways, is a whole island.
- **Ridges, scarps and channels are pinned to edge midpoints.** A river arm
  always leaves through the middle of an edge at one width for the whole
  collection; a range hands over at a fixed height (`y = 0` at the crest,
  `y = 0.55` at the foot) with a short flat run either side, so two pieces share
  a silhouette whatever happened in between.

Relief pieces abut rather than overlap at the cell edge. Two translucent fills
stacked in an overhang double their opacity and draw a stripe on every join —
which is a bug that only shows up once a range is three cells long.

## Turning and mirroring

A placement may set `rotate` (sixths of a turn) and `flip` (mirror left to
right). Mirroring is applied first, then the turn, and `placedSeams()` maps the
edges the same way round.

Relief is marked `upright`: gravity applies, so a mountain shoulder that runs
out to the west becomes its eastern twin by mirroring, never by rotation.

## Options

Some pieces take named knobs a placement can set:

```ts
{ tile: 'coast-corner', rotate: 2, opts: { water: 'shallow' } }
```

Declared per tile as `options`, with allowed values and a fallback, and exported
in the manifest.

## Variants

Every tile is a seeded generator rather than a fixed drawing, so it has several
variants — the same piece, drawn again. A run of the same coast piece around an
island picks a different variant per cell, which is what stops six identical
pieces from reading as the hexagon they are laid out on.

Change `SEED_SALT` in `shared/tiles/render.ts` and the whole collection redraws
— one string instead of redrawing 127 files, the same trick
`scripts/lib/visual.config.ts` uses for course art.

## Objects

An assembled object is a plain list of cells, not a picture:

```ts
{ id: 'island', title: 'Остров', over: 'land', note: '…', cells: [
  { q: 0, r: 0, stack: [{ tile: 'hills' }] },
  { q: 1, r: 0, stack: [{ tile: 'coast-cape', rotate: 4, variant: 0 }] },
  …
]}
```

Because it is data, it survives export: a consumer holding the tiles and this
list can rebuild the object without knowing anything about how it was drawn.
Six ship — a range, an inland highland, a river reaching the sea, an island, a
bay and a stretch of open sea — and between them they exercise every joining
rule above.

## Sizes and colours

Tiles are authored in a **unit hex**: circumradius 1, centred on the origin,
corner pointing up. Nothing is stored in pixels. Placing one is

```html
<g transform="translate(cx cy) scale(s)">
  <g clip-path="url(#hex-clip)">…body…</g>
</g>
```

with `cx = s·√3·(q + r/2)`, `cy = s·1.5·r`. Stroke widths scale with the
drawing, so one file serves a 16 px map cell and a 160 px close-up.

The clip is only for flat tiles (`clip: true`). Relief is left unclipped and
declares `bleed`, the room it needs outside the cell.

> One clip id per document. Several inline SVGs on one HTML page share an id
> space and `url(#…)` resolves to whichever came first — pass `clipId` in
> `RenderOptions` when rendering more than one picture into a page.

The palette is a parameter (`RenderOptions.palette`). Point `sea`, `seaDeep`,
`seaShallow` and `foam` at whatever blues the app paints and the water group
follows; the land trio (`light`, `shade`, `ink`) is neutral on purpose and
should rarely need touching.

## Export

```bash
pnpm tiles:build                          # everything into .tiles/
pnpm tiles:build --out=public/tiles       # somewhere that ships
pnpm tiles:build --size=128 --seed=v2
pnpm tiles:build --only=coast,water --formats=svg
```

| flag | default | |
|---|---|---|
| `--out=` | `.tiles` (or `TILES_OUT`) | |
| `--size=` | 64 | hex radius the files are rendered at |
| `--seed=` | `v1` | redraws the whole collection |
| `--only=` | every group | `relief, coast, hydro, water` |
| `--formats=` | all four | `json, svg, objects, sprite` |

What comes out:

- **`collection.json`** — the manifest. Metadata for every tile, each variant's
  drawing in unit-hex coordinates, the hex geometry, the clip path, the edge
  numbering, the object recipes, and a `howToUse` block spelling out the
  placement rules. `--only` narrows the loose files, never the manifest or the
  objects: either of those, cut down to one group, would point at tiles it no
  longer carries.
- **`svg/<group>/<id>-<variant>.svg`** — one standalone file per picture.
- **`objects/<id>.svg`** — each assembled object.
- **`sprite.svg`** — every variant as a `<symbol>`, for `<use href="#tile-…">`.

`.tiles/` is gitignored. The viewer's export buttons produce the same files
through the same functions, which is the point of them being one generator.

## The viewer

`pnpm tiles:view` writes `.tiles/collection.html` — one file, no server, no
build step. It shows the objects assembled with their recipes underneath, a
stack demonstration, and every tile with its seams, options and layer.

Two controls are the ones that matter:

- **Под плиткой** — territory colours taken off the real map. Land relief has to
  read on every one of them; that is the swatch row's whole job.
- **Как на карте · 16 px** — snaps the size to the map's own hex radius. Every
  object is also drawn at that size on its card, permanently.

Override the output with `TILES_VIEW_OUT`; `--fragment` emits the page contents
without a document skeleton, for a host that supplies its own.

## Adding a tile

1. Pick the atlas file by group — `shared/tiles/atlas/{relief,coast,hydro,water}.ts`.
2. `defineTile({ … })`. The layer implies `kind`, `clip` and `upright`; declare
   only what is peculiar to the piece.
3. Draw in the unit hex. On land use `lit()`, `dim()` and `edge()` from
   `shared/tiles/ink.ts` — never a solid fill, or the territory colour is gone.
   At sea the palette's blues are yours.
4. If it is a fragment, give it `seams`. If it belongs at sea, set
   `over: 'water'`.
5. `pnpm tiles:view`, then press **Как на карте**. If it does not read at
   16 px it does not belong in the collection.

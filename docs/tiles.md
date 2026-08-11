# The tile collection

The map is a field of hexagons with no borders drawn. This is the set of pieces
that go on them: 33 tiles, each one drawing sized to one hex, stacked several to
a cell and joined across cells into larger objects.

```bash
pnpm tiles:view      # one self-contained HTML page, opens straight from disk
pnpm tiles:build     # generate and export the collection into .tiles/
```

Code lives in `shared/tiles/`; the viewer's page in `sandbox/tiles/`; the two
commands in `scripts/tiles-build.ts` and `scripts/tiles-view.ts`. Nothing in the
frontend depends on it yet — like `pnpm map:preview`, it is a workshop, not a
build step.

## The idea

A tile is **not** a picture of a finished cell. It is one layer of one:

- **Ground** — an opaque fill for the whole hex. One per cell.
- **Surface** — texture on top of it. Any number.
- **Relief** — something with volume, standing on the ground and rising past the
  cell's top edge.
- **Overlay** — a small mark above everything.

A meadow with a hill and a tree on it is four tiles on one hex, painted in that
order. That is where the coverage comes from: 33 pieces reach far more terrain
than 33 finished cell pictures would, and every combination costs nothing.

The second axis is whether a piece stands alone:

- **`solo`** — droppable on any cell. Grass, pebbles, a hill, a lone tree.
- **`part`** — a fragment. A mountain shoulder, a river bend, a stretch of
  coast. Alone it is a shape nobody can place, so it carries **seams**.

## Seams: how pieces join

`seams` records which of the six hex edges the drawing runs across, and what has
to be on the other side.

```ts
seams: [{ edges: [0, 3], meets: 'ridge' }]   // mountain-slope
seams: [{ edges: [1, 2], meets: 'water' },   // coast-shore
        { edges: [3, 4, 5, 0], meets: 'land' }]
```

`meets` is one of `water`, `land`, `shore`, `channel`, `ridge`, `canopy`. Edges
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
  hexes, so neighbouring pieces meet there whatever each drew. This is why one
  coast piece, rotated, serves both a lake ring (water facing in) and an island
  ring (water facing out).
- **Ridges and channels are pinned to edge midpoints.** A river arm always
  leaves through the middle of an edge at one width for the whole collection; a
  mountain hands over at a fixed height with a short flat run either side.

## Turning and mirroring

A placement may set `rotate` (sixths of a turn) and `flip` (mirror left to
right). Mirroring is applied first, then the turn, and `placedSeams()` maps the
edges the same way round.

Relief is marked `upright`: gravity applies, so a mountain shoulder that runs
out to the west becomes its eastern twin by mirroring, never by rotation.

## Options

Some pieces take named knobs a placement can set — that is how the same coast
piece borders a sea in one object and a lake in another:

```ts
{ tile: 'coast-corner', rotate: 2, opts: { water: 'lake', land: 'grass' } }
```

Declared per tile as `options`, with allowed values and a fallback, and exported
in the manifest.

## Variants

Every tile is a seeded generator rather than a fixed drawing, so it has several
variants — the same piece, drawn again. A run of the same coast piece around a
lake picks a different variant per cell, which is what stops six identical
pieces from reading as the hexagon they are laid out on.

Change `SEED_SALT` in `shared/tiles/render.ts` and the whole collection redraws
— one string instead of redrawing 142 files, the same trick
`scripts/lib/visual.config.ts` uses for course art.

## Objects

An assembled object is a plain list of cells, not a picture:

```ts
{ id: 'lake', title: 'Озеро', note: '…', cells: [
  { q: 0, r: 0, stack: [{ tile: 'lake-water', opts: { water: 'lake' } }] },
  { q: 1, r: 0, stack: [{ tile: 'coast-corner', rotate: 2, variant: 0, … }] },
  …
]}
```

Because it is data, it survives export: a consumer holding the tiles and this
list can rebuild the object without knowing anything about how it was drawn.
Six of them ship — a range, a lake, an island, a river reaching the sea, a bay
and a grove — and between them they exercise every joining rule above.

## Sizes

Tiles are authored in a **unit hex**: circumradius 1, centred on the origin,
corner pointing up. Nothing is stored in pixels. Placing one is

```html
<g transform="translate(cx cy) scale(s)">
  <g clip-path="url(#hex-clip)">…body…</g>
</g>
```

with `cx = s·√3·(q + r/2)`, `cy = s·1.5·r`. Stroke widths scale with the
drawing, so one file serves a 20 px overview cell and a 200 px close-up — the
size slider in the viewer is there to make a tile that only works at one size
fail visibly.

The clip is only for flat tiles (`clip: true`). Relief is left unclipped and
declares `bleed`, the room it needs outside the cell.

> One clip id per document. Several inline SVGs on one HTML page share an id
> space and `url(#…)` resolves to whichever came first — pass `clipId` in
> `RenderOptions` when rendering more than one picture into a page.

## Export

```bash
pnpm tiles:build                          # everything into .tiles/
pnpm tiles:build --out=public/tiles       # somewhere that ships
pnpm tiles:build --size=128 --seed=v2
pnpm tiles:build --only=coast,hydro --formats=svg
```

| flag | default | |
|---|---|---|
| `--out=` | `.tiles` (or `TILES_OUT`) | |
| `--size=` | 64 | hex radius the files are rendered at |
| `--seed=` | `v1` | redraws the whole collection |
| `--only=` | every group | `ground, surface, coast, relief, hydro, flora` |
| `--formats=` | all four | `json, svg, objects, sprite` |

What comes out:

- **`collection.json`** — the manifest. Metadata for every tile, each variant's
  drawing in unit-hex coordinates, the hex geometry, the clip path, the edge
  numbering, the object recipes, and a `howToUse` block spelling out the
  placement rules. `--only` narrows the files on disk, never the manifest: a
  partial manifest carrying whole objects would point at tiles it lacks.
- **`svg/<group>/<id>-<variant>.svg`** — one standalone file per picture.
- **`objects/<id>.svg`** — each assembled object.
- **`sprite.svg`** — every variant as a `<symbol>`, for `<use href="#tile-…">`.

`.tiles/` is gitignored. The viewer's export buttons produce byte-identical
files through the same functions, which is the point of them being one
generator.

## The viewer

`pnpm tiles:view` writes `.tiles/collection.html` — one file, no server, no
build step. It shows the objects assembled with their recipes underneath, the
stack demonstration, and every tile with its seams, options and layer. The
controls change the hex radius, the variant, the seed, the backdrop, and can
draw the hex grid and colour the seams over the artwork.

Override the output with `TILES_VIEW_OUT`; `--fragment` emits the page contents
without a document skeleton, for a host that supplies its own.

## Adding a tile

1. Pick the atlas file by group — `shared/tiles/atlas/{ground,surface,coast,relief,hydro,flora}.ts`.
2. `defineTile({ … })`. The layer implies `kind`, `clip` and `upright`; declare
   only what is peculiar to the piece.
3. Draw in the unit hex using the helpers in `shared/tiles/ink.ts` — the palette
   is shared so pieces drawn months apart still belong to the same map.
4. If it is a fragment, give it `seams`. If it goes on top of something, give it
   `on`.
5. `pnpm tiles:view` and look at it at three different sizes.

Keep the drawings laconic. These are read at 20–40 px on a full map; a piece
that needs sixty shapes to say "forest" says nothing at that size and costs
kilobytes at every one.

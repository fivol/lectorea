# The tile collection

The map is a field of hexagons with no borders drawn: territories coloured by
domain, sea between them. This is the set of pieces that go on those cells —
36 tiles at the altitude of a mountain range, a river, a reef, stacked several
to a cell and joined across cells into larger objects.

```bash
pnpm tiles:view      # one self-contained HTML page, opens straight from disk
pnpm tiles:build     # generate and export the collection into .tiles/
```

Code lives in `shared/tiles/`; the viewer's page in `sandbox/tiles/`; the two
commands in `scripts/tiles-build.ts` and `scripts/tiles-view.ts`. The map screen
imports the same generator and lays it on `public/map.svg` — see
[On the map](#on-the-map) for what each field is made of and how the pieces find
their cells. The two commands stay a workshop: they export the collection for
anybody outside this repository, and nothing in the build runs them.

## The angle

The map is looked at from above and a little to the side, and the collection is
drawn for that view. The projection is `shared/view.ts`, one file shared with
the map screen so that a mountain cannot end up standing at a different angle
from the coast it stands on:

```
screen.x = x
screen.y = y · GROUND − z
```

The ground is squashed north to south by `GROUND`, height goes straight up, and
**nothing is turned**. That last part is the whole reason it is this projection
and not a real isometric: a rotated grid would invalidate every hex formula in
`mapgen.ts`, every coastline in `public/map.svg` and every seam below. Squashing
leaves all of them exact — a cell's neighbours, a river's crossing point, a
coast pinned to a corner — and changes only distances.

Which means each piece is authored in one of two spaces, and `clip` is the
switch that says which:

- **Lying on the ground** (`clip: true`) — a plate, a river, a shoal. Drawn as a
  plan, in the plain unit hex, and laid back by the placement transform. The
  author never thinks about the angle at all.
- **Standing up** (`clip: false`) — anything with volume. Drawn already in
  screen coordinates, because height is the one thing the squash must not
  touch. A ground position in one of these goes through `flat()` or comes from
  `rim()`; a height is a plain number subtracted from one.

`rim(x)` is where the ground ends nearest the reader, and it is what standing
pieces stand on. A foot drawn level instead floats above the cell in the middle
and hangs over its edge at the sides.

## The slab

A cell of land is a slab, not a patch of colour: `SLAB` radii thick, with a wall
between the ground on top and whatever it stands in. `slabMarkup` draws it, and
two rules keep it honest.

**Only the near edges.** The wall goes on edges 1 (SE) and 2 (SW). At this angle
an east or west edge is exactly side-on, so sweeping it downwards gives a shape
with no width.

**Only at a boundary.** A land cell has no plate of its own — the ground is
already the territory's colour — so a wall between two cells of one landmass has
nothing to hide behind and reads as a fence across the middle of the field.

The map draws its coastline about twice this thick, and says why where it does:
a continent is seen from across the room, where one cell's true edge is a
hairline.

## Two rules the whole collection follows

**Land is not painted.** A land cell already has a colour — the territory it
belongs to, which on this map *is* the data. Cover it with green and the map
stops saying anything. So relief is light and shade: a white face at low
opacity, a cool dark one, and a drawn crest. The same mountain reads over green,
purple and pink. Only water owns a colour, because the sea is one flat field
behind everything.

**The cell is about 30 px across.** `defaultConfig.hexR` in `shared/mapgen.ts`
is 16, so a hex is 27 px wide on the finished map. That fixes the altitude: a
range, a scarp, a river, a reef, a stand of forest — never one tree, never a
tuft of grass. Five or six shapes per piece; anything finer is mud. The viewer
draws every object a second time at 16 px for exactly this reason.

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

## On the map

The map screen fills every territory with the collection: `shared/tiles/
terrain.ts` says what a field is made of, `shared/tiles/fill.ts` works out which
hexes it owns and what goes on them, and `src/screens/Map/ground.ts` is the
thirty lines that ask.

### Where the cells come from

Nowhere. `public/map.svg` carries outlines and nothing else — no cells, no grid,
not even the radius it was laid out at — and it is reimported from a sandbox
export every time the map is redrawn. So the grid is **read back off the
geometry** by `hexGridOf`, once, when the file loads. Three facts do it:

- a hexagon's edge is exactly its circumradius, so the distance between two
  corners in a row along an outline *is* the radius — the median over the whole
  file, which the current map answers as 19 with four hundredths of scatter;
- every corner then lies on a lattice `√3/2·r` across and `r/2` down, which pins
  the phase, and every corner has to be on it or the file is not a hex map;
- the phase leaves six candidate origins, five of which put "cell centres" on
  corners or on edge midpoints — settled by measuring, since a real centre is a
  whole radius from the nearest corner and a false one is half that.

If the file ever stops answering, `hexGridOf` returns `null` and the map draws
no ground at all. A plain coloured map is a fine map; tiles landing half a cell
off the grid are not.

Storing the cells in a file instead would be the same mistake as storing the
polygons: the next import moves every one of them, and nothing says so.

### What each field is made of

`shared/tiles/terrain.ts` is the correspondence, and it is keyed on **the
domain** — never on the polygon, its position or its size:

```ts
math: 'peaks',          // the range everything else on the continent stands on
'earth-science': 'canyons',
literature: 'forest',
```

A redraw is then free: mathematics is mountainous wherever the mountains end up.
A domain the table has not caught up with falls back to its continent
(`TERRAIN_BY_CONTINENT`), so a new field is on the map the day it is added —
and `tests/terrain.test.ts` fails until the table names it. A domain that has
gone leaves a stale line, which the same test names.

A terrain is a recipe rather than a picture:

```ts
{
  id: 'peaks',
  cover: 0.4,                                  // of the cells no run took
  chain: { share: 0.42, min: 2, max: 5,        // runs laid west to east
           head: { tile: 'mountain-foot' },
           body: { tile: 'mountain-slope' },
           crown: { tile: 'mountain-peak', opts: { cap: 'snow' } },
           tail: { tile: 'mountain-foot' } },
  scatter: [{ tile: 'crags', weight: 3 }, { tile: 'hills', weight: 2 }],
}
```

`chain` is where the seams earn their keep: five mountain tiles scattered about
are five mountains, and the same five in a row are a range. Runs go west to
east because that is the axis the ridge and scarp pieces join on, and the ends
are mirrored rather than turned — relief has a top. Everything a run did not
take is drawn from `scatter` by weight, `once` marking a landmark that may
appear at most one to a territory. A terrain quiet enough to come out empty
still gets one piece on its middle cell: an empty territory between full ones
reads as one whose ground failed to load.

Every placement is seeded on the domain and the cell, so a field grows the same
ground on every render and on every machine, and losing a cell to a redrawn
border does not reshuffle the rest of it.

### Where it is drawn

Cell centres have to be `INSET` — half a radius — inside the outline, because
relief stands up out of its cell and leans north; a piece on a cell whose centre
is a hair inside hangs over the neighbour, or over the sea. Where nothing is
that far in, the sliver keeps its cells anyway.

On the screen the ground is one layer, painted after the coastlines and before
the lettering, with `pointer-events: none` so a territory still answers the
pointer through it. North to south, both between territories and within one: a
piece standing on a southern cell has to be painted over its northern
neighbour. Over the shoreline rather than under it, because a mountain on the
northernmost cell of a coast hides the water beyond it — the shore there is the
far edge, not the near one. A territory ruled out by a filter keeps a quarter of
its relief: the ground is the shape of the field, and a field that empties
itself reads as one that has lost its data.

Nothing on this layer is painted, only lit and shaded, which is the collection's
first rule and the reason it can go over thirty-nine different hues.

### Changing what a field is made of

Edit one line in `TERRAIN_BY_DOMAIN`. A new terrain is an entry in `TERRAINS`
built from land pieces — the test checks that every tile it names exists, is a
land piece, and that a `chain` body actually joins along the east and west
edges. Nothing needs regenerating: the app renders the collection from source.

## Sizes and colours

Tiles are authored in a **unit hex**: circumradius 1, centred on the origin,
corner pointing up. Nothing is stored in pixels. Placing one is

```html
<!-- lying on the ground: clip: true -->
<g transform="translate(cx cy) scale(s) scale(1 GROUND) rotate(60·r)">
  <g clip-path="url(#hex-clip)">…body…</g>
</g>

<!-- standing up: clip: false -->
<g transform="translate(cx cy) scale(s)">…body…</g>
```

with `cx = s·√3·(q + r/2)`, `cy = s·1.5·r·GROUND`. Stroke widths scale with the
drawing, so one file serves a 16 px map cell and a 160 px close-up.

Read the transform right to left, which is the order the geometry goes through
it: the piece is mirrored, then turned — both on the ground, where the six edges
are still six equal edges — and only then laid back. Squash first and turn after
and a river arm swings off the edge midpoint it is supposed to leave through.

The clip is only for flat tiles, and so is the squash: they are the same
question. Relief is left unclipped, is already drawn in screen coordinates, and
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
  numbering, a `view` block with the projection and the slab, the object
  recipes, the `terrains` block — the recipes and the domain table the app fills
  its territories from — and a `howToUse` block spelling out the placement
  rules. `--only`
  narrows the loose files, never the manifest or the objects: either of those,
  cut down to one group, would point at tiles it no longer carries.
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
3. Decide which space it is in. Flat on the ground — leave `clip` alone and draw
   a plan in the unit hex; the placement lays it back for you. With volume —
   `clip: false`, draw in screen coordinates, put the foot on `rim(x)` and
   measure height straight up.
4. Draw. On land use `lit()`, `dim()` and `edge()` from `shared/tiles/ink.ts` —
   never a solid fill, or the territory colour is gone. At sea the palette's
   blues are yours.
5. If it is a fragment, give it `seams`. If it belongs at sea, set
   `over: 'water'`.
6. `pnpm tiles:view`, then press **Как на карте**. If it does not read at
   16 px it does not belong in the collection.

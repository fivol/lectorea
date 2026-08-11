# Drawing the map

[← all scripts](README.md) · the generators behind `public/map.svg` and the hex
tile collection the ground is made of.

![The map](../images/map.webp)

The shipped map is made by the sandbox generator and imported; `data:map` is the
older path. What each territory is made of and why it is that colour:
[biomes.md](../biomes.md), [tiles.md](../tiles.md).

## `pnpm data:map`

```bash
pnpm data:map
```

Regenerates `public/map.svg` from `data/domains.yaml` and the course counts per
domain. Unlike `public/data/`, the map **is committed** — it is one file, it
changes rarely, and a territory redraw should be visible in a diff.

Run it after adding a domain or after a batch of new courses makes an area
outgrow its territory; the generator warns when a territory ends up smaller than
its share of courses.

**It currently refuses to run.** The shipped `public/map.svg` comes from the
sandbox generator through `pnpm map:import`, and carries coastlines this script
does not produce. Regenerating would replace its continents, islands and label
anchors with plain hexagons, so it stops when it sees a `coastline` path.
`--force` overrides, for when that map is being retired.

## `pnpm map:import`

```bash
pnpm map:import '~/Downloads/map (1).svg'
```

Turns an SVG exported from `pnpm map:sandbox` into `public/map.svg` — which is
how the shipped map is made.

The export is a picture: a sea, drop shadows, dependency links, labels, and
territories in whatever colours the sandbox was showing. The app needs none of
that; it paints the territories from `domains.yaml` and writes its own labels
in the current theme's colours. So the import keeps the geometry — one path per
territory, one per coastline — and adds what the export does not carry: the
continent each territory and each landmass belongs to, the point a label can be
centred on, and how much room there is around it.

It fails if the export and `data/domains.yaml` disagree about which territories
exist, which is the only way the app could end up with a field that has no
ground or ground that has no field.

## `pnpm map:preview`, `map:sandbox`, `map:landforms`

A second map generator lives in `shared/mapgen.ts` — territories as a power
diagram, sized to their course counts, with one shared border graph. It is what
the shipped map is drawn with: the sandbox exports an SVG and `pnpm map:import`
turns it into `public/map.svg`. `pnpm data:map` and the older generator behind it
are what the file predates.

An SVG plus a metrics report into `.map-poc/`, so the numbers can be diffed
between runs from a terminal:

```bash
pnpm map:preview
```

Any numeric `MapConfig` field can be set by flag:

```bash
pnpm map:preview --hexR=4
```

The same generator with sliders, bundled into one self-contained HTML file that
opens straight from disk:

```bash
pnpm map:sandbox
```

Output goes to `.map-poc/`, which is gitignored — override with `MAP_POC_OUT`
and `MAP_SANDBOX_OUT`.

```bash
pnpm map:landforms
```

This one prints a table instead of a picture. Whether a domain comes out as a
mainland, a peninsula or an island is the one part of the map that changes what
it *claims* rather than how it looks, and «философия стала островом» should be
checkable without squinting at a coastline.

## `pnpm tiles:build`, `tiles:view`

The generator draws territories, not what is inside them. These two are the
other half: a collection of SVG pieces sized to one hex of the grid — ranges,
plateaus, canyons, rivers, coasts, and the sea with its shoals, reefs, currents
and whirlpools — that stack several to a cell and join across cells.

Land pieces never paint the cell: a hex already carries its territory's colour,
so relief is light and shade over it. Only water owns a colour. And the altitude
is fixed by the grid — a cell is 27 px wide on the finished map, which is a
range, not a tree.

One self-contained HTML page with controls:

```bash
pnpm tiles:view
```

Manifest, files and sprite into `.tiles/`:

```bash
pnpm tiles:build
```

Somewhere that ships:

```bash
pnpm tiles:build --out=public/tiles
```

A subset, in one format and size, under a different seed:

```bash
pnpm tiles:build --only=coast,water --formats=svg --size=128 --seed=v2
```

`tiles:build` writes four things: `collection.json` (every piece in unit-hex
coordinates, plus the geometry, the joining rules, the object recipes and the
terrain table the map fills its territories from), `svg/` (one file per
picture), `objects/` (each assembled object) and `sprite.svg`. `tiles:view`
bundles the same generator with controls into `.tiles/collection.html`. Output is
gitignored; override with `TILES_OUT` and `TILES_VIEW_OUT`.

Neither is wired into the build, and neither needs to be: the map screen imports
the generator from `shared/tiles/` and draws the ground of every territory
itself. These two exist for consumers outside the repository. Full
documentation: [tiles.md](../tiles.md).

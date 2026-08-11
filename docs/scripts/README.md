# Scripts

[![ci](https://github.com/fivol/lectorea/actions/workflows/ci.yml/badge.svg)](https://github.com/fivol/lectorea/actions/workflows/ci.yml)
[![refresh](https://github.com/fivol/lectorea/actions/workflows/refresh.yml/badge.svg)](https://github.com/fivol/lectorea/actions/workflows/refresh.yml)

Every script is a `tsx` entry point under `scripts/`, run through a `pnpm`
alias. They share `scripts/lib/`, read `.env` through `lib/config.ts`, and — for
everything that touches YouTube — the same SQLite file at `data/cache.db`.

Two of them are needed to work on the interface (`data:build`, `data:seed-dev`).
The rest exist to fill the catalogue with material and are run on a schedule, not
per commit.

| Page | What is in it |
|---|---|
| **[catalogue.md](catalogue.md)** | `data:build`, `data:seed-dev`, `course:new`, `playlist:add`, `check:i18n`, `stats` |
| **[map.md](map.md)** | `data:map`, `map:import`, `map:preview`, `map:sandbox`, `map:landforms`, `tiles:build`, `tiles:view` |
| **[crawl.md](crawl.md)** | `data:discover`, `data:refresh`, `data:playlists`, `data:videos`, `data:liveness`, `data:images`, `data:import` |
| **[matching.md](matching.md)** | `data:match`, how the rule pass decides, `data:review` |

## Doing it in batches

Every script that processes things one by one takes a **leading positive
integer** that caps how many it does in one run:

```bash
pnpm data:discover 3
```

Run the same command again and it takes the next three, not the same three:

```bash
pnpm data:discover 3
```

This works because each step already knows what it finished: a refresh window
that has not expired, a job marked `done`, a playlist that already has a match,
an image already on disk. The cap stops the run early; the skip rules decide
where the next one starts. Nothing is repeated and nothing is lost.

The point is control over spending. A crawl that runs to the quota ceiling is
hard to reason about mid-flight — a batch of ten is not, and the last line of
output always says how much is left:

```
data:discover: лимит выбран (готово 3, ошибок 0)
· 48 left — run the same command again for the next 3
```

Flags are ignored when looking for the number, so `pnpm data:match 20 --llm` and
`pnpm data:images --openai 5` both work. Without the number a script processes
everything due.

| Command | What one unit of the limit means |
|---|---|
| `data:discover` | one channel |
| `data:playlists` | one playlist's metadata |
| `data:videos` | one playlist's video list |
| `data:liveness` | one playlist checked |
| `data:refresh` | applies the cap to each of its three stages |
| `data:match` | one playlist classified |
| `data:images` | one image written |
| `data:import` | one newly queued playlist |
| `data:seed-dev` | one course seeded |

`data:build`, `data:review`, `data:map`, `stats`, `check:i18n`, `course:new` and
`playlist:add` take no limit: they either process the catalogue as a whole or
already work one item at a time by hand.

## Every command at a glance

| Command | Script | Needs | Writes |
|---|---|---|---|
| [`pnpm data:build`](catalogue.md#pnpm-databuild) | `08-build.ts` | `data/`, optional `cache.db` | `public/data/` |
| [`pnpm data:seed-dev`](catalogue.md#pnpm-dataseed-dev) | `dev-seed.ts` | — | `cache.db` |
| [`pnpm course:new`](catalogue.md#pnpm-coursenew) | `course-new.ts` | `data/` | `data/courses/`, `i18n/`, `keywords/` |
| [`pnpm playlist:add`](catalogue.md#pnpm-playlistadd) | `playlist-add.ts` | `data/`, API key | `data/overrides.yaml`, `cache.db` |
| [`pnpm check:i18n`](catalogue.md#pnpm-checki18n) | `check-i18n.ts` | `data/i18n/`, `data/keywords/`, `src/` | nothing — exits non-zero |
| [`pnpm stats`](catalogue.md#pnpm-stats) | `stats.ts` | `public/data`, optional `cache.db` | `.stats/dashboard.html` |
| [`pnpm data:map`](map.md#pnpm-datamap) | `10-map.ts` | `data/domains.yaml` | `public/map.svg` |
| [`pnpm map:import`](map.md#pnpm-mapimport) | `map-import.ts` | a sandbox SVG export, `data/domains.yaml` | `public/map.svg` |
| [`pnpm map:preview`](map.md#pnpm-mappreview-mapsandbox-maplandforms) | `map-poc.ts` | `data/` | `.map-poc/` |
| [`pnpm map:sandbox`](map.md#pnpm-mappreview-mapsandbox-maplandforms) | `map-sandbox.ts` | `data/` | `.map-poc/sandbox.html` |
| [`pnpm map:landforms`](map.md#pnpm-mappreview-mapsandbox-maplandforms) | `map-landforms.ts` | `data/` | nothing — prints a table |
| [`pnpm tiles:build`](map.md#pnpm-tilesbuild-tilesview) | `tiles-build.ts` | — | `.tiles/` |
| [`pnpm tiles:view`](map.md#pnpm-tilesbuild-tilesview) | `tiles-view.ts` | — | `.tiles/collection.html` |
| [`pnpm data:discover`](crawl.md#pnpm-datadiscover) | `01-discover.ts` | API key | `cache.db` |
| [`pnpm data:playlists`](crawl.md#the-three-steps) | `02-playlists.ts` | API key | `cache.db` |
| [`pnpm data:videos`](crawl.md#the-three-steps) | `03-videos.ts` | API key | `cache.db` |
| [`pnpm data:liveness`](crawl.md#the-three-steps) | `04-liveness.ts` | API key | `cache.db` |
| [`pnpm data:refresh`](crawl.md#pnpm-datarefresh) | `refresh.ts` | API key | `cache.db` |
| [`pnpm data:images`](crawl.md#pnpm-dataimages) | `07-images.ts` | — | `public/images/` |
| [`pnpm data:import`](crawl.md#pnpm-dataimport) | `09-import-github.ts` | network | `data/proposed-courses.yaml` |
| [`pnpm data:match`](matching.md#pnpm-datamatch) | `05-match.ts` | `cache.db` | `cache.db` |
| [`pnpm data:review`](matching.md#pnpm-datareview) | `06-review.ts` | `cache.db` | `data/overrides.yaml` |

## The order to run them in

First run, from an empty checkout — an empty catalogue with a valid graph:

```bash
pnpm install && pnpm data:build && pnpm dev
```

Or the same with fake playlists in it, so the panels have something to show:

```bash
pnpm data:seed-dev && pnpm data:build && pnpm dev
```

First run with real data, spread over two or three days of quota. Channels →
playlists:

```bash
pnpm data:discover
```

Then metadata, videos and liveness — repeat daily until it stops reporting
exhausted quota:

```bash
pnpm data:refresh
```

Bind what can be bound automatically, decide the leftovers by hand, and build:

```bash
pnpm data:match --llm
```

```bash
pnpm data:review
```

```bash
pnpm data:build
```

Afterwards `data:refresh` and `data:match` run nightly on CI, and the only manual
step is review.

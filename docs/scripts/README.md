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

## The three sequences with a shorter name

Most of what is below is one command doing one thing, and `pnpm` is the right
way to reach it. Three jobs are not: they are a *sequence*, in an order that
matters, and getting the order wrong costs a day of quota or publishes half a
state. Those have a `Makefile`.

```bash
make
```

prints the list. Nothing in it reimplements anything — every target forwards to
the same `pnpm` script CI runs. What it adds is the ordering and the guards.

### `make pipeline`

Everything the crawl does, in the order that buys the most for the day's quota:

```
import → discover → mine → match → refresh → subscribers → match → authors → embeds → build → prune
```

Three things about that order are worth stating, because they are the reason the
sequence exists at all rather than being written out by hand each time.

**Matching comes before the crawl.** Matching is free and needs only a title;
walking a playlist's videos is the most expensive call here, and a playlist no
course claims is never shown, so the work buys nothing. `data:refresh` ranks its
video queue off the `matches` table ([the five tiers](../pipeline.md#quota)) —
so whatever `match` has decided by the time it runs is what the day is spent on.

**And again after it.** A playlist discovered this run has no metadata yet, and
a title is the whole of what the rule pass reads. The second `match` is free and
picks up everything the refresh just gave a name to.

**Then the one question a title cannot answer.** `authors` asks
`playlistItems.list` who made the videos under each *new* binding, at a unit
apiece. A playlist called «Linguistics» with 268 videos in it is a course when a
linguist uploaded them and a bag of bookmarks when they come from forty
channels, and nothing in a title tells the two apart. It runs after the second
`match` because it needs bindings to judge, and before `build` because a
collection it refuses must not reach `public/data`. The verdict is kept in
`cache.db`, so a playlist is asked once and never again — the second night costs
almost nothing.

It has a third answer besides "a course" and "a bag": **a mirror**, one outside
channel behind almost all the videos. That is a real course and keeps its
binding — dropping it would delete material that mostly exists nowhere else here
— and what is wrong about it is only the name over it. `build` reads
`ownership.kind` and files a mirror under whoever *made* the videos, so «MIT
6.036 Introduction to Machine Learning» stops being credited to the account that
re-posted it. Nothing is written by hand for this; the probe's row is the fix.

Both verdicts are read out of `ownership` by `build` rather than trusted to the
`matches` row `authors` also writes, which is what makes the two steps
independent: every refusal in `matches` is reversible and `data:match --force`
re-reads all of them, so a keyword change used to quietly republish collections
that had each cost a unit to identify.

The free seams are in there too, in the places where they refill: `mine` reads
links out of API bodies already on disk and finds more of them after every
crawl, `import` re-reads the published curricula in `data/sources.yaml`. `import`
is the one step allowed to fail without stopping the run — it is the only one
that needs the open web, and a `raw.githubusercontent.com` that is having a bad
morning is not a reason to leave the quota unspent.

`data:build` is the last step that produces anything, so what the day bought is
visible in `pnpm dev` and validated before anybody thinks about publishing it.

**And then the housekeeping the schedule needs.** `prune` empties the API bodies
that have passed their three-day window, which is the only reason a cache under
a daily harvest does not fill the disk — it reached 28.2 GB of 32 before there
was a bound
([pipeline.md](../pipeline.md#the-raw-archive-is-bounded)). It costs no quota
and no network, it deletes no rows, and it runs last because it must run after
`mine`: a description nobody has mined is the only copy of the playlists it
links to. It refuses rather than relying on the order, so running the steps by
hand in the wrong sequence costs a message.

**And it always reaches that end.** A step that fails does not stop the
sequence: it is remembered, named in the last line, and the run exits non-zero
for it. The reason is the shape of the order above — the expensive steps are in
the middle and the free ones that publish the day's work are at the end, so
stopping at step 6 throws away five steps of crawling that were already paid
for. `data:subscribers` did exactly that on 2026-08-14 by meeting the quota
ceiling and exiting 1;
[pipeline.md](../pipeline.md#an-exhausted-quota-ends-the-day-not-the-run) has
the incident and the other half of the fix, which is that meeting the ceiling is
no longer a failure at all.

### `make publish`

The local state of the whole system, published:

```
guard: is this working copy what main would build?
  → data:build         the validator CI runs, before anything leaves the machine
  → cache:publish      cache.db → the data-cache release
  → deploy, pinned to that snapshot
```

The guard is the part that earns its keep. The site is built from `main` on
GitHub and never from a working copy, so an uncommitted `overrides.yaml` — the
committed record of everything decided in `data:review` — would simply not be
published, and nothing anywhere would say so. `make publish` stops on
uncommitted changes and on commits that have not been pushed, prints them, and
names the fix. `FORCE=1` publishes the crawl cache alone, which is the honest
thing to call it.

After it, nothing else has to be told anything. The `data-cache` release is the
source of truth and the newer generation wins, so the deploy this dispatches
takes the snapshot over whatever the Actions cache held — and so does tonight's
`refresh`, which crawls on top of it rather than over it. That is the whole of
what makes the local state *replace* CI's;
[pipeline.md](../pipeline.md#moving-the-crawl-between-machines) has the
mechanism and the failure it was written for.

### `make pull`

The other half, and the one to reach for when this machine should have the
catalogue without spending an evening on it:

```bash
make pull
```

The release → `data/cache.db`, when the release is ahead of what is here. It
refuses rather than overwrite local crawling the release has not seen — that
material exists on one disk — and it keeps this machine's `raw_responses`, which
the snapshot deliberately does not carry, by swapping the tables that travelled
instead of replacing the file.

`make cache-push` is `publish`'s middle step on its own: the cache to the
release, no git guard and no deploy. When both this machine and the release have
crawled since they last agreed, neither direction is right and the union is —
[`scripts/_merge.ts`](../pipeline.md#both-directions-from-a-laptop).

### `make stats`

The [dashboard](catalogue.md#pnpm-stats), served and opened —
`localhost:5180`, recomputed on every reload, so it can be left open while a
crawl runs.

### Everything else

`make check` runs what CI runs, in CI's order. `make doctor` says what this
machine actually has — tools, how many YouTube keys are configured (counted,
never printed), whether `cache.db` holds a crawl rather than merely holding
tables, whether `public/data` exists. `make clean` removes everything
regenerable and deliberately leaves `data/cache.db` alone, that being a week of
somebody's quota.

Variables: `N=` caps a step ([below](#doing-it-in-batches)), `LLM=1` adds the
model pass to `match`, `FORCE=1` means `--force` on `discover` and `match` and
"publish the cache anyway" on `publish`.

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
| [`pnpm data:import`](crawl.md#pnpm-dataimport) | `09-import.ts` | network | `data/proposed-courses.yaml` |
| [`pnpm data:mine`](crawl.md#pnpm-datamine) | `11-mine.ts` | — | `cache.db` |
| [`pnpm cache:prune`](../pipeline.md#the-raw-archive-is-bounded) | `cache-prune.ts` | `cache.db` | `cache.db` |
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

First run with real data, spread over two or three days of quota. This is the
whole of it, repeated daily until it stops reporting exhausted quota:

```bash
make pipeline
```

Which is `import → discover → mine → match → refresh → subscribers → match →
authors → embeds → build → prune`, in that order for the reasons
[above](#the-three-sequences-with-a-shorter-name). Spelled out, a day of it is:

```bash
pnpm data:discover
```

```bash
pnpm data:match
```

```bash
pnpm data:refresh
```

Then decide by hand the ones no pass could settle, and build:

```bash
pnpm data:review
```

```bash
pnpm data:build
```

Afterwards `data:refresh` and `data:match` run nightly on CI, and the only manual
steps are review and — when a laptop has been crawling and its work should reach
the site — `make publish`.

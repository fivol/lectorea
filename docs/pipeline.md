# Pipeline

[← docs](README.md) · [![refresh](https://github.com/fivol/lectorea/actions/workflows/refresh.yml/badge.svg)](https://github.com/fivol/lectorea/actions/workflows/refresh.yml)

The nightly crawl that keeps [the site](https://fivol.github.io/lectorea/) fresh.

```
scripts/
  01-discover.ts       channels → list of playlists
  02-playlists.ts      playlist metadata and statistics
  03-videos.ts         durations, counts, dates
  04-liveness.ts       are the links still alive
  05-match.ts          bind a playlist to a course
  06-review.ts         local review server
  07-images.ts         image generation
  08-build.ts          assemble public/data
  09-import-github.ts  import courses from awesome-lists
  10-map.ts            regenerate public/map.svg
  refresh.ts           the nightly job: 02 → 03 → 04
  dev-seed.ts          synthetic playlists for development
  course-new.ts        scaffold a course across its three files
  check-i18n.ts        localisation and course-text gate
  map-poc.ts           run the map generator to an SVG and a metrics report
  map-sandbox.ts       the same, bundled as one HTML file with sliders
  map-import.ts        a sandbox export → public/map.svg
  lib/
    youtube.ts        API wrapper with quota accounting
    db.ts             sqlite
    queue.ts          job queue
    tasks.ts          the individual steps
    rules.ts          binding a playlist to a course by its title
    sources.ts        load and validate data/, with file and line
    graph.ts          build-time checks over shared/graph.ts
    classify.ts       language, lecturer, kind, completeness from a title
    score.ts          bayesian rating
    layout.ts         column order: barycentric sweeps and domain bands
    mapgen.ts         the territory map generator behind `data:map`
    visual.config.ts  the look of the procedural course art
    openai.ts         optional
    config.ts

shared/            imported by both the build and the browser
  schema.ts        every shape that crosses a boundary
  graph.ts         Kahn's algorithm, cycles, closures
  search.ts        normalisation and scoring
  procedural.ts    course artwork
  mapgen.ts        the power-diagram map generator behind the shipped map
  domain-graph.ts  landform classification for that generator
```

## Quota

10 000 units a day per Google Cloud project. The rule that shapes everything:
**never call `search.list`** — it costs 100 units.

| Call | Cost | What it gives |
|---|---|---|
| `channels.list` | 1 | a channel's uploads playlist |
| `playlists.list` (up to 50 ids) | 1 | playlist metadata, in a batch |
| `playlistItems.list` (up to 50) | 1 | one page of a playlist's videos |
| `videos.list` (up to 50 ids) | 1 | durations and statistics, in a batch |

Which steps go through the job queue is a quota decision. Anything the API
answers 50 at a time — playlist metadata, liveness — runs in direct batches,
because one job per playlist would turn one unit into fifty. Only genuinely
per-target work is queued.

**The order the video queue drains in is a quota decision too.** Walking a
playlist's videos is the most expensive thing here, and a playlist no course
claims is never shown, so the work buys nothing. Matching is free and needs only
the title that discovery already stored, so the order is: discover, match, then
crawl what matched. With 7900 playlists queued and a day of quota buying some
4500, which 4500 is the whole question. The day is spent down five tiers:

| Tier | What | Why here |
|---|---|---|
| 0 | bound by hand in `overrides.yaml` | someone spent attention on it already |
| 1 | bound confidently by a pass | it is in the catalogue; this is what gives it hours and a rating |
| 2 | claimed too weakly to publish | the review queue — a crawl pays twice, in lecture titles a reviewer reads and in the first five names the model pass is shown |
| 3 | nothing claims it yet | |
| 4 | refused by hand, or a title naming support material | never shown however much is spent, and the expensive end: «Stanford Seminars» is 1150 videos, 47 units for a bin |

Tiers 1–3 the queue reads off the `matches` table. Tiers 0 and 4 it cannot see
by itself — hand decisions are a file in git and the support-material rule lives
in `lib/rules.ts` — so `03-videos.ts` works them out and hands them over.

`lib/youtube.ts` counts spent units in the `quota(date, key, spent)` table and
stops each key at 9500, leaving a margin. The date key follows Pacific midnight,
which is when the real quota resets.

### More than one key

A key is named in the ledger by eight hex characters of its digest rather than
by the slot it sits in. Identity has to follow the value: swapping two keys
around in `.env` would otherwise hand one of them the other's spending, which is
the one bookkeeping mistake that quietly overdraws a project.

Keys are spent **in order, not balanced** — a crawl that ends mid-queue should
leave the untouched key obviously untouched, because two keys both mysteriously
at 6000 is a state nobody can reason about the next morning.

Rotation is a loop around the request rather than a single choice up front. The
ledger is only this machine's memory of the day, and the API's own 403 is the
fact: a key that looks fresh here but is spent in reality — a clone with no
`cache.db`, a project CI has been crawling on — is found out on its first call,
written off for the day, and the same request goes out again on the next key.
`quotaExceeded` therefore no longer ends the run; it ends *a key*. Only when
every key has been written off does the worker stop with
`квота исчерпана, продолжу завтра`.

Two keys from two projects turn the two-day first crawl into one evening. Two
keys of the same project do nothing: the quota is the project's, and the second
is found empty on its first call. How to add one: [setup.md](setup.md).

Jobs run six at a time, because every unit is one request and one request at a
time is bound by the round trip rather than by the quota: at a second each, a
day's 9500 units would take three hours of wall clock. Six is a handful on
purpose — `rateLimitExceeded` is a separate 403 the API returns for asking too
fast, and the point is to spend the quota, not to race it. It is handled as
transient and retried with backoff, unlike `quotaExceeded`, which really does
mean tomorrow. The margin under 10 000 also covers the few units that requests
already in flight can add after the ceiling is reached.

Estimate for 500 channels and ~5000 playlists: a full first crawl is roughly
15–20 thousand units, so two days. The queue is not decoration — the crawl
physically does not fit in one.

## Fault tolerance

The queue lives in the same SQLite file as the data, so it survives `kill -9`.

- jobs left `running` for more than ten minutes are returned to `pending` at
  start-up — that is crash recovery
- failures retry with backoff: 1m, 4m, 16m, 64m, then the job is marked failed
- **403 quotaExceeded** stops the worker entirely, prints
  `квота исчерпана, продолжу завтра` and exits 0. This is not an error, it is
  the normal end of the working day
- **404 / 403 on a playlist** marks `alive = 0` and is never retried
- **5xx** retries with backoff

`raw_responses` keeps every API body verbatim. With a daily quota this is the
difference between "fix the parser and re-run" and "fix the parser and wait
until tomorrow".

## Incremental refresh

A full crawl happens once. After that everything is driven by `next_refresh_at`:

| What | Period |
|---|---|
| Playlist metadata | 30 days |
| Statistics, top 20% by views | 7 days |
| Statistics, the rest | 30 days |
| Liveness | 14 days |
| Discovering new playlists on a channel | 30 days |

Without this every run burns the quota again and half the jobs never finish.

Two things carry it: `next_refresh_at` says when a playlist is next due, and the
item count says whether its video list is worth walking again. A metadata
refresh queues the video crawl only for the playlists whose count actually
moved — queuing every playlist it looked at would hand the expensive step the
whole catalogue each cycle, which is a day of quota to re-read lists that did
not change.

The quota ledger is keyed by the Pacific date, formatted in that zone rather
than derived from a local clock. From a zone ahead of UTC the two disagree for
the first hours after the reset, which is exactly when the nightly job runs: the
crawler would read yesterday's spend and stop before it started.

## Matching

The most laborious step, and the one that does not fully automate. A cascade,
cheapest first:

1. **Rules** — regex over the playlist and channel title, plus the synonym
   dictionary from `keywords/ru.json`. Confidence 0.9 on an exact match. When
   two courses claim the same title the match is *declined*, not guessed — an
   ambiguous case is exactly what a human should see
2. **LLM** — title, description and the first five lecture names, in batches of
   20, with the instruction to pick one course or answer `none`. It is shown the
   rule's own below-threshold guesses too, and has to beat them to replace them
3. **Manual review** — anything still below 0.75 goes into the queue for
   `pnpm data:review`, and what it decides is crawled first next time round

The review server shows one playlist at a time: the playlist on the left, course
search and buttons on the right. Keyboard: `1`–`9` for the top suggestions, `n`
for "not a course", `→` to skip. Results are written to `data/overrides.yaml`.

Without this, marking up matches means hand-editing YAML by playlist id — which
is torture, and therefore does not get done.

## Images

**Procedural SVG (default, every course).** A deterministic generator: hash of
`course.id` → seed → a composition of geometric primitives in the domain
palette. The same input always gives the same output, so images are stable
between builds and are not stored in git. The generator lives in
`shared/procedural.ts`; the frontend inlines the same markup rather than firing
500 requests while the graph is scrolled.

Two different things decide what a card looks like. **The field** gives the hue
— from its biome, see [biomes.md](biomes.md) — and the *set of motifs* the
picture may be drawn with: the `MOTIFS` table in `shared/procedural.ts` reads as
*motif → the fields it suits*, and gives each domain three or so. **The course
id** picks which of those it gets, and every number inside it. So a domain reads
as a family and no two courses in it are the same card — a motif tied to the id
alone would put a double helix on a course in logic, one tied to the domain
alone would make forty identical cards in a column.

A domain added to `data/domains.yaml` and forgotten in that table falls back to
its continent, so it is never blank, and `tests/motifs.test.ts` names the line
that is missing.

`scripts/lib/visual.config.ts` controls the look. Changing `seedSalt`
regenerates everything — a redesign is one string edit, not 500 API calls.

The domain palette is picked against the dark canvas, so the generator takes a
`scheme`: on `dark` the marks are lighter than the domain colour and sit on a
darkened slab of it, on `light` they are deepened and the slab becomes a pale
wash. One palette, two ways of laying it down — the frontend passes the theme
in force, and files written to disk are always the dark one.

**OpenAI (optional, domains only).** ~40 images, generated with
`pnpm data:images --openai --only=math,physics` and **committed** to the
repository. They are stable and there is no reason to pay for them on every
build. Without the flag the image API is never called.

## Automation

`refresh.yml` — cron at 03:00 UTC plus manual dispatch:

```
restore cache.db from the Actions cache →
  pnpm data:refresh (runs until the quota is gone) →
  pnpm data:match →
  save cache.db →
  open a PR if there are new matches
```

`deploy.yml` — on push to `main`: `pnpm data:build → pnpm build → deploy`.

The separation matters: crawling must not block a deploy, and deploying must not
spend quota.

Secrets: `YOUTUBE_API_KEY`, `OPENAI_API_KEY`.

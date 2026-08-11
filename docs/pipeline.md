# Pipeline

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

10 000 units a day. The rule that shapes everything: **never call
`search.list`** — it costs 100 units.

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

`lib/youtube.ts` counts spent units in the `quota(date, spent)` table and stops
at 9500, leaving a margin. The date key follows Pacific midnight, which is when
the real quota resets.

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

## Matching

The most laborious step, and the one that does not fully automate. A cascade,
cheapest first:

1. **Rules** — regex over the playlist and channel title, plus the synonym
   dictionary from `keywords/ru.json`. Confidence 0.9 on an exact match. When
   two courses claim the same title the match is *declined*, not guessed — an
   ambiguous case is exactly what a human should see
2. **LLM** — title, description and the first five lecture names, in batches of
   20, with the instruction to pick one course or answer `none`
3. **Manual review** — anything below 0.75 goes into the queue for
   `pnpm data:review`

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

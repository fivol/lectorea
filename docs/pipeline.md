# Pipeline

[← docs](README.md) · [![refresh](https://github.com/fivol/lectorea/actions/workflows/refresh.yml/badge.svg)](https://github.com/fivol/lectorea/actions/workflows/refresh.yml)

The nightly crawl that keeps [the site](https://lectorea.org/) fresh.

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
  09-import.ts         import courses from lists and catalogues
  10-map.ts            regenerate public/map.svg
  11-mine.ts           playlists linked from what is already crawled
  12-subscribers.ts    channel subscriber counts, for the rating's reach signal
  13-embeds.ts         which playlists the embedded player refuses as `list=`
  refresh.ts           the nightly job: 02 → 03 → 04
  dev-seed.ts          synthetic playlists for development
  course-new.ts        scaffold a course across the files it needs
  check-i18n.ts        localisation and course-text gate
  map-poc.ts           run the map generator to an SVG and a metrics report
  map-sandbox.ts       the same, bundled as one HTML file with sliders
  map-import.ts        a sandbox export → public/map.svg
  map-portrait.ts      the generator, stacked → public/map-portrait.svg
  lib/
    youtube.ts        API wrapper with quota accounting
    db.ts             sqlite
    queue.ts          job queue
    tasks.ts          the individual steps
    rules.ts          binding a playlist to a course by its title
    sources.ts        load and validate data/, with file and line
    graph.ts          build-time checks over shared/graph.ts
    classify.ts       language, lecturer, kind, completeness from a title
    score.ts          rating and status — see rating.md
    layout.ts         column order: barycentric sweeps and domain bands
    mapgen.ts         the territory map generator behind `data:map`
    map-world.ts      run shared/mapgen.ts over this repo's own data
    map-file.ts       measure outlines and write one of the app's map files
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
- **403 quotaExceeded** writes off the key it came from and the request goes out
  again on the next one. Only when every key is spent does the worker stop,
  print `квота исчерпана, продолжу завтра` and exit 0. This is not an error, it
  is the normal end of the working day
- **404 / 403 on a playlist** marks `alive = 0` and is never retried
- **5xx** retries with backoff
- **a `nextPageToken` that leads back to its own page** ends the walk. Some
  playlists answer this way for ever, and nothing downstream notices: the same
  fifty ids arrive again, the ids are deduplicated, and the loop spends a unit a
  turn until the day is gone. Six of them took 54 000 units on 2026-08-13 —
  eighteen thousand pages for a playlist of 32 videos — and two had been spinning
  since the previous evening, which is where that day's quota went too. A token
  already seen is therefore the end of the playlist, not its next page

**The shape of that bug is worth remembering, because the quota hides it.** A
crawl that spends its day and stops is indistinguishable from a crawl that
worked, and every counter this pipeline prints agreed the day had been spent —
only the ratio of units to playlists gave it away. Anything that loops per
request wants a bound that does not depend on the API agreeing to end it.

`raw_responses` keeps every API body verbatim. With a daily quota this is the
difference between "fix the parser and re-run" and "fix the parser and wait
until tomorrow".

### The playlists the player will not open

Alive is not the same as playable, and the API cannot tell the difference.
`playlists.list` answers `privacyStatus: "public"` for playlists the embedded
player then meets with «This video is unavailable» — measured on Khan Academy's
Linear Algebra, Stanford CS229 and ИТМО's discrete mathematics, all of them
public, every video in them playing on its own. Drop `list=` from the embed and
the same video plays; keep it and nothing does, on `youtube.com` and
`youtube-nocookie.com` alike. What YouTube is doing there is not known here.

oEmbed refuses exactly the same playlists — three times out of three against the
player — so `pnpm data:embeds` uses it as the detector and writes
`list_playable`. It costs **no quota at all**: oEmbed is not the Data API. Only
playlists a reader can reach are asked about, which is why the step runs after
matching.

The shard carries the answer, and the app gives the player the playlist only
when the player will take it. For the rest the frame holds one lecture and the
app walks to the next itself — the order is ours, out of the shard, so the
course loses nothing but YouTube's own next-up rail. **31 of 2902 published
playlists** on 2026-08-13. Deleting them instead would have been the wrong
trade: the material is public and complete, and for those thirty-one this
catalogue is the only place the lectures are in order.

## Incremental refresh

A full crawl happens once. After that everything is driven by `next_refresh_at`:

| What | Period |
|---|---|
| Playlist metadata | 30 days |
| Statistics, top 20% by views | 7 days |
| Statistics, the rest | 30 days |
| Liveness | 14 days |
| Discovering new playlists on a channel | 30 days |
| Whether the player takes the playlist as `list=` | 30 days |

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

1. **Rules** — regex over the playlist and channel title, plus the course names
   and synonym dictionaries of **every** interface language. Confidence 0.9 on
   an exact match. When two courses claim the same title the match is
   *declined*, not guessed — an ambiguous case is exactly what a human should see
2. **LLM** — title, description and the first five lecture names, in batches of
   20, with the instruction to pick one course or answer `none`. It is shown the
   rule's own below-threshold guesses too, and has to beat them to replace them
3. **Manual review** — anything still below 0.75 goes into the queue for
   `pnpm data:review`, and what it decides is crawled first next time round

**Every language at once, and why that is not obvious.** `loadSources(lang)`
picks the language a build renders in, and for the rule pass that question has
no answer: it reads titles written by whoever uploaded the playlist. Reading one
dictionary — the Russian default — left every course whose English name nobody
had happened to add to `keywords/en.json` unable to recognise itself. «Cognitive
Psychology» knew only «когнитивная психология», so sixty lectures of MIT 9.35
fell through to `psychology-intro`, which did have an English synonym, and
`cognitive-psychology` stayed empty with its material already crawled and paid
for. Nine courses came out of that hole the day the index learned both
languages, without a unit of quota.

The correction it forces: **`keywords/{lang}.json` is a search file, and search
is allowed to be loose in a way matching is not.** «ocean», «feedback»,
«interviews», «study design», «inheritance» are all good things to type into a
search box and all bad things to bind a course by, because an exact hit on a
whole clause scores like a title. Two shapes were worth a rule — a department
label filed in front of the real subject («Electronics - Linux Programming», 66
playlists) and the English half of the interview-and-colloquium refusal. The
rest is word sense, which a substring cannot hold, and is pinned by hand.

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

## The two maps

The app ships two drawings of one world, both from `shared/mapgen.ts`.

| | file | command |
|---|---|---|
| Wide — the continents ranged side by side | `public/map.svg` | tuned in `pnpm map:sandbox`, exported, then `pnpm map:import <export.svg>` |
| Tall — the same continents stacked | `public/map-portrait.svg` | `pnpm map:portrait` |

They differ in one knob and what it costs. `packing` lays the landmasses out
along `x` or along `y`; because a continent given more dependency rows than it
has width is stretched upwards to fit them — which is what a *row* of continents
can afford and a *column* of them cannot — the stacked map also lowers
`maxStretch` below 1, so its continents come out a little wider than tall. Not
much lower: `map:preview` prints the share of dependencies that still run bottom
to top inside a landmass, and squashing far enough to look tidy is squashing far
enough to break that claim. It also draws on a larger cell, which is a third
fewer pieces of relief on the machine least able to draw them.

Both files are written by `scripts/lib/map-file.ts`, which measures what the app
reads off an outline — the point a name is centred on, the room around it, the
width of the territory along that line — so a map that came in from the sandbox
and a map generated headlessly describe themselves identically. The app reads
the cell size back off the outlines it loads, so nothing downstream has to be
told which of the two it is looking at.

To try a variant: `pnpm map:portrait --seed=9`, or any other knob. To look
before writing: `pnpm map:preview --packing=column --width=1180 --height=1560`,
which renders to `.map-poc/` with a metrics report. The sandbox has a
**Формат** switch that loads either preset, for art-directing by eye.

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

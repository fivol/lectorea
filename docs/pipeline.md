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
  map-ground.ts        what the scenery is made of → public/*-ground.json
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
**the crawl is built out of the 1-unit endpoints and never reaches for
`search.list`**, which costs 100.

| Call | Cost | What it gives |
|---|---|---|
| `channels.list` | 1 | a channel's uploads playlist |
| `playlists.list` (up to 50 ids) | 1 | playlist metadata, in a batch |
| `playlistItems.list` (up to 50) | 1 | one page of a playlist's videos |
| `videos.list` (up to 50 ids) | 1 | durations and statistics, in a batch |
| `search.list` | 100 | off by default — `createClient(db, { allowSearch: true })` |

That last line used to be a comment saying "never", and a comment cannot stop
anything. `lib/youtube.ts` now throws unless the caller asked for search at
construction, so a pipeline step that reaches for it fails on its first call
rather than in tomorrow's ledger. The one caller that does ask is
`scripts/_hunt.ts`, which is not part of any sequence and runs only against
quota that would otherwise expire — [harvest.md](harvest.md#seam-8--asking-youtube-itself)
has the arithmetic and why it inverts exactly once a day.

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

### An exhausted quota ends the day, not the run

The bullet above is a rule about a worker, and a worker is not the only place
the ceiling is met. Steps that drain a queue notice it and stop politely; steps
that make one batched call — `data:subscribers` is the whole of the catalogue's
channels in fifty-id batches — have nowhere to catch it and simply throw.

That distinction is invisible until it costs a day. On 2026-08-14 `data:refresh`
spent 66 452 units, ended the day properly, and handed over to
`data:subscribers`, which met the same ceiling on its first call and exited 1.
`make pipeline` stopped at step 6 of 9. The three steps it did not reach are the
free ones — the second `match`, `embeds`, `build` — and they are what carries a
day of crawling into `public/data`, so 9969 crawled video lists, 4620 metadata
refreshes and three new channels' worth of playlists stayed in `cache.db` and
reached nobody. The same crash in CI skips `match` and `embeds` and turns the
`refresh` run red, and the deploy hangs off that run succeeding — so the site
stops updating on exactly the nights the crawl worked hardest.

Two rules came out of it, and neither belongs to the script that broke:

- **`reportRunError` in `lib/exit.ts` is the one door every entry point ends
  with**, and it knows that `QuotaExceededError` reaching the top means the
  working day is over: it prints `<step>: квота исчерпана, продолжу завтра` and
  exits 0. A script that spends quota gets that ending whether or not its author
  remembered the case, which is the only version of this that survives the next
  script being added;
- **the free tail runs whatever happened to the paid steps.** `make pipeline`
  runs the whole sequence in one shell, remembers what failed, names it at the
  end and exits non-zero for it; `refresh.yml` carries the same rule as
  `if: !cancelled()` on everything after the crawl. Carrying on is not the same
  as pretending it went well — but a step that broke must not throw away what
  the day already bought.

**The shape of that bug is worth remembering, because the quota hides it.** A
crawl that spends its day and stops is indistinguishable from a crawl that
worked, and every counter this pipeline prints agreed the day had been spent —
only the ratio of units to playlists gave it away. Anything that loops per
request wants a bound that does not depend on the API agreeing to end it.

`raw_responses` keeps every API body verbatim. With a daily quota this is the
difference between "fix the parser and re-run" and "fix the parser and wait
until tomorrow".

### An id that cannot exist still costs four requests

The seams in [harvest.md](harvest.md) scrape playlist ids out of prose, and
prose supplies share links glued to the next word by a broken table. Three
scripts each kept their own copy of the extraction pattern, written
`PL[A-Za-z0-9_-]{16,32}` under a comment saying the id is "16 or 32 characters
after the prefix" — but a comma in a quantifier is a *range*, not a choice, so
every length from 18 to 34 was accepted and a mangled link produced an id that
looked entirely plausible. 245 of them reached the database; 240 reached the
video queue, where each one climbed the whole retry ladder earning
`400 Invalid Value` before being written off.

Two things came out of it, and the second is the one worth keeping:

- the three forms an id actually takes now live in `scripts/lib/playlist-id.ts`
  — `PL` + 32, `PL` + 16 hex, `PL` + a video id, which is every id that ever
  resolved across 32 914 rows — and `queuePlaylists` refuses anything else. It
  is already **the one door** every scraped playlist comes through, which is
  what makes it the place to check that an id is an id;
- a pattern kept in three copies gets edited in two. The comment was right and
  all three regexes were wrong, twice over, because each copy was written from
  the comment rather than from the other copy.

A truncated id is the expensive half, not a refused one: refusing costs nothing,
while a plausible id is indistinguishable from a real one until the API charges
to say otherwise.

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

### A pass may only defer the call it makes itself

`next_refresh_at` is one column and the metadata pass's own clock, and the video
pass used to write it too — a month out, unconditionally, having just walked a
playlist's lectures. For a playlist that already had a title that is merely
generous. For one that never had a title it is the whole difference between a
catalogue entry and a dead row: a seam queues metadata and videos together,
whichever ran first won, and when it was the video pass the title could not be
bought for thirty days. **A title is the entire input of the rule pass**, so
those playlists could not be classified, could not be shown, and sat in the
review queue as blank rows.

3252 of them on 2026-08-15 — eight per cent of the live catalogue, every one
with its lectures already walked at two units per fifty, waiting until September
for a call that costs one unit per fifty titles. The video pass now leaves an
untitled playlist due, and the metadata scan orders by *title* missing rather
than `published_at` missing, because the video pass fills `published_at` in from
the earliest lecture it saw — so a crawled-but-untitled playlist stopped looking
new, sorted by views among forty thousand rows, and fell out of the 5000-row
scan window for good. `scripts/_sweep.ts` unsticks the ones already deferred.

The shape to remember: **a step that writes another step's clock can starve it,
and nothing downstream can tell that from "there was nothing to fetch".**

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
playlists) and the English half of the interview-and-colloquium refusal.

The rest is word sense, which a substring cannot hold — and deleting such a word
answers the matcher by lying to the search box, which then cannot find the
course by the name half its readers know it under. So the file says which master
a word serves: **a value written `?word` is search-only.** Search keeps it; the
rule index never sees it. `genre` under literary theory, `classical music` under
the history of music and `motivation` under organisational behaviour are the
three that had already bound something — 1241 tracks of house music, two
collections of classical recordings, and a talk on Gaussian multiplicative
chaos.

**A refusal is an answer too, and is recorded as one.** `matches.refused` marks
a playlist a pass judged to be no course at all, which takes it out of the
review queue, out of the next model batch and into the last tier of the video
queue. Without it the queue could only grow: 35 148 playlists were waiting for a
person on 2026-08-15, nearly all of them mined music.
[matching.md](scripts/matching.md#a-refusal-is-an-answer-and-is-written-down)
has the table and the reversal rule — `--force` re-reads refusals, so a new
course still gets its material.

**And the refusal list reads the title as written.** `NOISE` takes `playlist`,
`videos`, `full` and `course` out before coverage is measured, which is right
for measuring and fatal for refusing: «Dance & Electronic Music Playlist |
Genre» reached the matcher as «dance electronic music» plus a clause that is
exactly a keyword. Support material is therefore matched against both readings
of a title, and «Crime Patrol 2.0 | Full Episodes» stopped being a course in
criminal law.

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

### What the scenery is made of

Beside each map file sits `map-ground.json` — which hex of the map carries which
tiles, for the land and for the sea. It is the output of three passes that are
pure functions of the map file and the tables in `shared/tiles`: which hexes a
territory owns, which hexes are water and how deep, and what grows on each. On a
phone those passes are about a fifth of a second, every load, for an answer that
has not changed since the map was last redrawn — so the answer is kept. About
50 KB each, a third of a millisecond to read, and a tenth of the markup they turn
into.

`shared/tiles/fill.ts` opens with the argument against storing cells: *"the next
import silently puts every mountain in the wrong place."* The objection is about
the word **silently**, and it is answered rather than ignored. Each plan carries
two fingerprints — of the map file it was drawn from, and of the tables that
decided what grows where — and the app checks both before trusting a cell of it.
A plan that does not answer is dropped and the passes run in the browser as they
always did, with a line in the console saying so. A forgotten regeneration costs
a slow first paint; it cannot cost a mountain in the sea.

Three things keep it from being forgotten anyway:

| when | what |
|---|---|
| the map is redrawn | `writeMapFile` writes the plan in the same breath — nothing to remember |
| a biome or the sea's recipe is edited | `pnpm map:ground`, since no map file changed |
| either is forgotten | `pnpm map:ground --check` in CI, and `tests/map-ground.test.ts` before the push |

That test also asserts the thing the whole design rests on: every piece of markup
the map draws from the saved plan is the same string as the one it draws without
it.

## Automation

The catalogue is meant to stay current with nobody touching it. Two workflows do
that, and they are deliberately separate: crawling must not block a deploy, and
deploying must not spend quota.

**`refresh.yml`** — cron at 08:30 UTC plus manual dispatch:

```
restore cache.db from the Actions cache →
  seed it from the data-cache release if that came back empty →
  pnpm data:refresh      (metadata, video lists, liveness — until the quota is gone)
  pnpm data:subscribers  (single digits of quota; the rating's reach signal)
  pnpm data:match        (bind what discovery found to courses)
  pnpm data:embeds       (which playlists the player refuses as list=) →
  save cache.db to the Actions cache and to the release →
  open a PR if there are new matches
```

**Half past the reset, and the hour is load-bearing.** The quota is Google's
day and turns over at midnight Pacific — 08:00 UTC in winter, 07:00 in summer.
The job used to run at 03:00, four hours *before* the reset, where it inherited
whatever was left of a day a laptop had already spent, and a nightly run could
end with nothing crawled at all.

**What the night fixes by itself.** A retitled playlist, a lecture added to one,
a video count that moved, a channel that has grown, a playlist that has been
deleted or set to private — all of it is read again on the schedule in
[incremental refresh](#incremental-refresh) and republished. Ratings and
statuses follow from those numbers ([rating.md](rating.md)), so a recording that
has stopped being watched slides down the list on its own, and one that has died
leaves it. A course whose last recording disappeared stops being shown and comes
back the day one matches it again ([data.md](data.md)).

**What it will not decide alone.** New bindings between a playlist and a course
are a content change and arrive as a pull request against `data/overrides.yaml`,
labelled `data`. A wrong binding files a recording under a course nobody will
check again, which is the one failure here nothing downstream can catch —
so it waits for a person. Everything else the crawl learns is published without
review.

The same chain runs on a laptop as `make pipeline`, with the two free seams CI
does not run — `data:import` and `data:mine` — folded in, and `data:match`
moved ahead of the crawl as well as after it. Why the steps go in that order:
[scripts/README.md](scripts/README.md#make-pipeline).

**`deploy.yml`** — on push to `main`, *and* on a successful `refresh` run: it
restores the same cache, then `pnpm data:build → pnpm build → deploy`. That
second trigger is what closes the loop — without it a night's work would sit in
the cache until somebody happened to push.

A red `refresh` does not deploy, and since the free steps now run even when a
paid one failed, that is a deliberate wait rather than an empty one: the night
is crawled, matched and published to the release, and what is missing is a
person's glance at why a step broke. `make publish` from a laptop, or a manual
dispatch of the deploy, ships it in the meantime — the restore compares
generations, so either takes the snapshot that night produced.

It also takes a manual dispatch, which needs no input to do the right thing:
the restore compares generations, so a deploy dispatched after a laptop
published rebuilds from that snapshot rather than from the Actions cache
— [`make publish`](#both-directions-from-a-laptop).

Secrets: `YOUTUBE_API_KEY` (plus optional `YOUTUBE_API_KEY2`, `3`) and
`OPENAI_API_KEY`; the refresh needs them, the deploy needs none. A fork that has
set none of them still builds and publishes — the graph, and whatever playlists
the snapshot it restored happens to hold ([below](#moving-the-crawl-between-machines)).

## Moving the crawl between machines

The catalogue lives in `cache.db`, which is not committed — and is a week of
daily quota to rebuild. Two places hold it, for two different spans of time.

The **Actions cache** is the working copy between nightly runs. It evicts after
seven idle days, the whole repository shares a 10 GB ceiling, entries are matched
on the `cache-db-` prefix so the newest wins, and nothing outside CI can write to
it. A laptop that has crawled therefore has no way to hand its work over, and one
bad entry saved under a newer key outranks every good one before it.

The **`data-cache` release** holds the snapshot that outlives all of that:

```bash
pnpm cache:publish     # local cache.db → the release, replacing what is there
pnpm cache:restore     # the release → data/cache.db, when the release is ahead
```

**The release is the source of truth, and the newer generation wins.** The
Actions cache and a laptop's file are working copies of some generation of it.
Every copy carries the moment its lineage was published, `restore` compares that
rather than counting rows, and both workflows can therefore go on running it
unconditionally — it takes the release when the release is ahead and carries on
otherwise. A repository with no release yet — a fresh fork — gets a log line and
a catalogue without playlists, not a red build. `refresh` publishes after every
night that crawled anything, so the release is never more than a day behind.

The stamp travels twice: inside the snapshot, so whoever restores it knows what
they descend from, and as a sidecar asset of a few dozen bytes, so that deciding
*not* to restore costs one small download instead of sixty-five megabytes. It is
written to the publishing machine only after the upload succeeds — a stamp for a
snapshot that is not on the release would make that machine look newer than the
thing it failed to become, and every other copy would defer to a snapshot nobody
can fetch.

**This replaced a rule that quietly threw work away.** `restore` used to ask "is
there anything here already" and stand aside if there was, so every machine kept
whatever it happened to hold. A snapshot published from a laptop was restored by
nobody: the nightly job came back with its own Actions cache, found material,
stood aside, crawled on top of the state the laptop had already moved past, and
published over it. The evening survived until the next cron and no log line
anywhere said otherwise. The same blindness is why `refresh` now publishes
*before* it saves the Actions cache — saved the other way round, the cache would
carry last night's stamp with a night of crawling on top, which reads as
unpublished local work, and a laptop's snapshot could never be picked up.

Two things `restore` will not do without `--force`, both of them the
irreversible direction:

- replace a cache that has **crawled since its own lineage was published**. That
  material exists on one disk. It names the newest local timestamp and suggests
  `cache:publish`
- replace a cache that has **never been in a snapshot at all** — crawled from
  nothing, locally. There is no generation to compare, so there is no answer,
  and guessing costs a week of quota

And one thing it does without being asked: **keeps this machine's
`raw_responses`.** The snapshot deliberately leaves them out, so replacing the
file would cost a laptop its 3.5 GB archive of verbatim API bodies on every
pull — the archive that makes "fix the parser and re-run" possible instead of
"fix the parser and wait until tomorrow". So a cache that already holds material
is updated table by table instead of overwritten: the 190 MB that travelled is
swapped in, the raw bodies stay.

The snapshot leaves out `raw_responses`, which is 3.5 GB of the 3.6 and read only
by `11-mine` and `stats`, both local. What travels is 190 MB, 65 compressed.

### Both directions, from a laptop

```bash
make publish   # this machine's state, whole: git → snapshot → release → deploy
make pull      # the release → here, when the release is the newer generation
```

Publishing the snapshot is only two thirds of `publish`, and the missing third
is the part that is silent when it goes wrong. The site is built from `main` on
GitHub and never from a working copy, so an `overrides.yaml` still sitting
unstaged — the committed record of everything `data:review` decided that
evening — is simply not published, and every log line in the run stays green.
`make publish` therefore refuses to start on uncommitted changes or unpushed
commits, prints them, and names the fix; `FORCE=1` publishes the crawl cache
alone, which is what that outcome should be called.

After it, the snapshot is the newest generation, so nothing else has to be told
anything: the deploy it dispatches restores the release over whatever the
Actions cache held, and so does the next nightly `refresh`, which then crawls on
top of it and publishes further. That is what makes the local state *replace*
CI's rather than race it.

`make pull` is the same rule read backwards, and is how a machine that does not
want to spend its own evening on the crawl gets the night the nightly job did.
It stops rather than overwrite local crawling the release has not seen, and it
keeps this machine's raw bodies either way.

**What counts as "material" is the load-bearing part.** `openDb` writes the whole
schema before the first request, and `seedManualMatches` fills `playlists` from
`overrides.yaml` before that too, so a run that dies on a missing key leaves a
database with every table and hundreds of playlist rows in it. Both are cheap to
mistake for a crawl, and the mistake is expensive: the empty file is saved under
a newer cache key and the deploy publishes `coverage 0.0%`. `dbHasMaterial` in
`lib/db.ts` therefore asks for something only the API could have supplied — a
video, or a playlist whose metadata came back.

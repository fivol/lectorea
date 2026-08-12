# Building the catalogue

[← all scripts](README.md) · the commands used while working on the interface
and the content, none of which spend YouTube quota.

## `pnpm data:build`

```bash
pnpm data:build
```

Turns `data/` plus whatever is in `cache.db` into the static JSON the frontend
fetches. Nothing runs before it: `public/data/` is generated and gitignored, so a
fresh checkout has an empty catalogue until this is run.

It is also the validator — see
[what CI checks](../../CONTRIBUTING.md#what-ci-checks). A schema violation, a
cycle, a dangling `deps` target, an unknown domain or a course in the wrong file
fails the build with the file and line, and CI runs the same command. Redundant
edges are reported as warnings and do not fail it.

The levels and the column order are computed here too; [layout.md](../layout.md)
explains how.

`cache.db` is optional. Without it the graph is built with zero playlists, which
is enough for layout, navigation and styling work.

Reads `DEFAULT_LANG` (default `ru`) to pick which `data/i18n/{lang}.json` and
`data/keywords/{lang}.json` the catalogue itself is built from. Every language in
`UI_LANGS` is then written out in full: a dictionary and a `search-{lang}.json`
of courses and fields, both under `public/data/i18n/`. The rest of the search
index — playlists, channels, lecturers — is written once, because nobody
translates a YouTube title. See [data.md](../data.md#one-language-whole).

## `pnpm data:seed-dev`

```bash
pnpm data:seed-dev
```

Inserts ~500 synthetic playlists into `cache.db`, spread across the existing
courses and titled so they are obviously fake (`[dev]`). The point is to see the
catalogue full — sorting, filters, the playlist panel, counts on the map —
without spending a day of YouTube quota on a first crawl.

Seeds only reach the UI through the build, so rebuild afterwards:

```bash
pnpm data:build
```

Twenty more courses, skipping those already seeded:

```bash
pnpm data:seed-dev 20
```

Remove every seeded row, leaving real data alone:

```bash
pnpm data:seed-dev --wipe
```

The limit counts courses rather than playlists: the generator is seeded once per
course, so stopping in the middle of one would shift every number after it and
the data would stop being reproducible.

## `pnpm course:new`

Adding a course means touching the graph entry plus the texts and the search
keywords of every language — five files at two languages — because the course
files deliberately carry no prose. This does the clerical part.

```bash
pnpm course:new probability --domain=math --stage=bachelor-2 --deps=calculus-2
```

Several domains, and a title seeded at the same time:

```bash
pnpm course:new topology --domain=math,cs --stage=bachelor-3 --title="Топология"
```

`--domain=` is required and its **first** entry decides the file the course lands
in (`data/courses/math.yaml`). `--stage=` is required too, from
`school-8`…`phd`: the schema demands it, and a default would be a guess the
reviewer could not tell from an answer. `--deps=` and `--soft=` take
comma-separated course ids, all of which must already exist. `--title=` is
optional, is read as `DEFAULT_LANG`, and seeds the title plus a first keyword
there; the other languages get empty slots to fill.

It refuses unknown domains, unknown dependencies and duplicate ids, and it
appends to the JSON files as text rather than reserialising them — keywords keep
one array per line, which is what makes their diffs reviewable.

The description is left empty on purpose, so `pnpm check:i18n` keeps failing
until somebody writes it.

## `pnpm playlist:add`

Binds one playlist to one course, by link. [`data:review`](matching.md#pnpm-datareview)
is the tool for a queue of candidates; this is for the single playlist that
arrives from outside it — an issue with a link in it, a recommendation, something
spotted by hand.

```bash
pnpm playlist:add https://youtube.com/playlist?list=PL… --course=probability
```

Without `--course` it spends one quota unit to say what the playlist is — title,
channel, video count — and whether the crawl already has it, without writing
anything:

```bash
pnpm playlist:add PL…
```

The id is the `list=` parameter, and a `watch?v=…` without one is refused — it
points at one video out of the course, not at the course.

Two writes, and the second is the one that is easy to forget: the match goes
into `data/overrides.yaml`, which is the committed record, and the playlist goes
into the crawl queue. A match without a queued playlist points at a row the
database does not have, and `data:build` skips it in silence.

Out of quota it takes the link on trust rather than refusing to record the
decision; the crawl checks the id again before anything is published.

## `pnpm check:i18n`

```bash
pnpm check:i18n
```

Two-way check on localisation: every key the code passes to `t()` must exist in
`data/i18n/{lang}.json`, and every key in the dictionary must be used somewhere.
Template keys (`` t(`course.${id}.title`) ``) are matched as wildcards.

Both halves matter. A missing key ships the raw key to the user; an orphaned one
is dead weight nobody later dares delete.

It also gates content, since the course files hold no prose at all: every course
needs a non-empty `title` and `desc`, and at least one entry in
`data/keywords/{lang}.json`. An empty string counts as missing — it passes a
presence check and then renders as nothing.

The other languages are held to the content one: each must carry every key it
has — the catalogue as well as the chrome — nothing beyond them, and its own
keywords for every course. A translation is a thing that rots, and a screen
nobody on the project ever opens in English is exactly where a stray Russian
sentence survives for months.

Exits non-zero on any of it, and CI runs it.

## `pnpm stats`

The dashboard: one local page with the coverage, the shape of the graph, the
material, the crawl, the daily series and — the part worth opening it for — an
estimate of what is left.

```bash
pnpm stats
```

Recomputed on every reload, at `localhost:5180`:

```bash
pnpm stats --serve
```

The same figures as JSON:

```bash
pnpm stats --json
```

Local rather than published, and that is the whole design. Half of what is worth
watching lives in `data/cache.db` — the quota, the queue, the matching
confidence — and that file is not committed and never reaches the site.
Publishing the page would mean either dropping those numbers or shipping the
cache, and the numbers are the point.

Three sources answer three different questions and are never mixed:
`public/data` says what the site publishes, `cache.db` says what the crawl knows
but has not published, `data/` says what was decided by hand. Either of the
first two may be missing — the page then says so in a badge and drops the
sections that would have been guesses.

The estimate keeps quota and review time apart, because they are not the same
currency: quota refills by itself overnight, review time does not. It says how
many units of crawling would still put something in the catalogue, how many
would be spent on playlists already ruled «not a course», how long the review
queue is in hours, and how much of the coverage gap that queue alone would
close. `--serve` recomputes per request, so the page can be left open while a
crawl runs. Output is gitignored; override with `STATS_OUT` and `STATS_PORT`.

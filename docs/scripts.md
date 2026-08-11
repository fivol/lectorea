# Scripts

Every script is a `tsx` entry point under `scripts/`, run through a `pnpm`
alias. They share `scripts/lib/`, read `.env` through `lib/config.ts`, and — for
everything that touches YouTube — the same SQLite file at `data/cache.db`.

Two of them are needed to work on the interface (`data:build`, `data:seed-dev`).
The rest exist to fill the catalogue with material and are run on a schedule, not
per commit.

## Doing it in batches

Every script that processes things one by one takes a **leading positive
integer** that caps how many it does in one run:

```bash
pnpm data:discover 3      # crawl three channels
pnpm data:discover 3      # the next three, not the same three
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
everything due, exactly as before.

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

| Command | Script | Needs | Writes |
|---|---|---|---|
| `pnpm data:build` | `08-build.ts` | `data/`, optional `cache.db` | `public/data/` |
| `pnpm data:seed-dev` | `dev-seed.ts` | — | `cache.db` |
| `pnpm course:new` | `course-new.ts` | `data/` | `data/courses/`, `i18n/`, `keywords/` |
| `pnpm playlist:add` | `playlist-add.ts` | `data/`, API key | `data/overrides.yaml`, `cache.db` |
| `pnpm data:map` | `10-map.ts` | `data/domains.yaml` | `public/map.svg` |
| `pnpm map:import` | `map-import.ts` | a sandbox SVG export, `data/domains.yaml` | `public/map.svg` |
| `pnpm map:preview` | `map-poc.ts` | `data/` | `.map-poc/` |
| `pnpm map:landforms` | `map-landforms.ts` | `data/` | nothing — prints a table |
| `pnpm map:sandbox` | `map-sandbox.ts` | `data/` | `.map-poc/sandbox.html` |
| `pnpm tiles:build` | `tiles-build.ts` | — | `.tiles/` |
| `pnpm tiles:view` | `tiles-view.ts` | — | `.tiles/collection.html` |
| `pnpm stats` | `stats.ts` | `public/data`, optional `cache.db` | `.stats/dashboard.html` |
| `pnpm check:i18n` | `check-i18n.ts` | `data/i18n/`, `data/keywords/`, `src/` | nothing — exits non-zero |
| `pnpm data:discover` | `01-discover.ts` | API key | `cache.db` |
| `pnpm data:playlists` | `02-playlists.ts` | API key | `cache.db` |
| `pnpm data:videos` | `03-videos.ts` | API key | `cache.db` |
| `pnpm data:liveness` | `04-liveness.ts` | API key | `cache.db` |
| `pnpm data:refresh` | `refresh.ts` | API key | `cache.db` |
| `pnpm data:match` | `05-match.ts` | `cache.db` | `cache.db` |
| `pnpm data:review` | `06-review.ts` | `cache.db` | `data/overrides.yaml` |
| `pnpm data:images` | `07-images.ts` | — | `public/images/` |
| `pnpm data:import` | `09-import-github.ts` | network | `data/proposed-courses.yaml` |

## Working on the interface

### `pnpm data:build`

Turns `data/` plus whatever is in `cache.db` into the static JSON the frontend
fetches. Nothing runs before it: `public/data/` is generated and gitignored, so a
fresh checkout has an empty catalogue until this is run.

It is also the validator — see [what CI checks](../CONTRIBUTING.md#what-ci-checks).
A schema violation, a cycle, a dangling `deps` target, an unknown domain or a
course in the wrong file fails the build with the file and line, and CI runs the
same command. Redundant edges are reported as warnings and do not fail it.

The levels and the column order are computed here too;
[docs/layout.md](layout.md) explains how.

`cache.db` is optional. Without it the graph is built with zero playlists, which
is enough for layout, navigation and styling work.

Reads `DEFAULT_LANG` (default `ru`) to pick which `data/i18n/{lang}.json` and
`data/keywords/{lang}.json` to bake in.

### `pnpm data:seed-dev`

Inserts ~500 synthetic playlists into `cache.db`, spread across the existing
courses and titled so they are obviously fake (`[dev]`). The point is to see the
catalogue full — sorting, filters, the playlist panel, counts on the map —
without spending a day of YouTube quota on a first crawl.

```bash
pnpm data:seed-dev          # insert
pnpm data:build             # then rebuild, seeds only reach the UI through the build
pnpm data:seed-dev 20       # twenty more courses, skipping those already seeded
pnpm data:seed-dev --wipe   # remove every seeded row, leaving real data alone
```

The limit counts courses rather than playlists: the generator is seeded once per
course, so stopping in the middle of one would shift every number after it and
the data would stop being reproducible.

### `pnpm course:new`

Adding a course means touching three files — the graph entry, the texts and the
search keywords — because the course files deliberately carry no prose. This does
the clerical part.

```bash
pnpm course:new probability --domain=math --stage=bachelor-2 --deps=calculus-2
pnpm course:new topology --domain=math,cs --stage=bachelor-3 --title="Топология"
```

`--domain=` is required and its **first** entry decides the file the course lands
in (`data/courses/math.yaml`). `--stage=` is required too, from
`school-8`…`phd`: the schema demands it, and a default would be a guess the
reviewer could not tell from an answer. `--deps=` and `--soft=` take
comma-separated course ids, all of which must already exist. `--title=` is
optional and seeds the title plus a first keyword.

It refuses unknown domains, unknown dependencies and duplicate ids, and it
appends to the JSON files as text rather than reserialising them — keywords keep
one array per line, which is what makes their diffs reviewable.

The description is left empty on purpose, so `pnpm check:i18n` keeps failing
until somebody writes it.

### `pnpm playlist:add`

Binds one playlist to one course, by link. `data:review` is the tool for a queue
of candidates; this is for the single playlist that arrives from outside it —
an issue with a link in it, a recommendation, something spotted by hand.

```bash
pnpm playlist:add https://youtube.com/playlist?list=PL… --course=probability
pnpm playlist:add PL…                                    # look, do not touch
```

The id is the `list=` parameter, and a `watch?v=…` without one is refused — it
points at one video out of the course, not at the course.

Two writes, and the second is the one that is easy to forget: the match goes
into `data/overrides.yaml`, which is the committed record, and the playlist goes
into the crawl queue. A match without a queued playlist points at a row the
database does not have, and `data:build` skips it in silence.

Without `--course` it spends one unit to say what the playlist is — title,
channel, video count — and whether the crawl already has it. Out of quota it
takes the link on trust rather than refusing to record the decision; the crawl
checks the id again before anything is published.

### `pnpm data:map`

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

### `pnpm map:import`

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

### `pnpm map:preview`, `map:sandbox`, `map:landforms`

A second map generator lives in `shared/mapgen.ts` — territories as a power
diagram, sized to their course counts, with one shared border graph. It is a
It is what the shipped map is drawn with: the sandbox exports an SVG and
`pnpm map:import` turns it into `public/map.svg`. `pnpm data:map` and the older
generator behind it are what the file predates.

```bash
pnpm map:preview                 # SVG + a metrics report into .map-poc/
pnpm map:preview --hexR=4        # any numeric MapConfig field can be set by flag
pnpm map:sandbox                 # one self-contained HTML file with sliders
pnpm map:landforms               # which domain became an island, and why
```

`map:preview` exists so the numbers can be diffed between runs from a terminal;
`map:sandbox` is the same generator with controls, bundled into a single file
that opens straight from disk. Output goes to `.map-poc/`, which is gitignored —
override with `MAP_POC_OUT` and `MAP_SANDBOX_OUT`.

`map:landforms` prints a table instead of a picture. Whether a domain comes out
as a mainland, a peninsula or an island is the one part of the map that changes
what it *claims* rather than how it looks, and «философия стала островом» should
be checkable without squinting at a coastline.

### `pnpm tiles:build`, `tiles:view`

The generator draws territories, not what is inside them. These two are the
other half: a collection of SVG pieces sized to one hex of the grid — ranges,
plateaus, canyons, rivers, coasts, and the sea with its shoals, reefs, currents
and whirlpools — that stack several to a cell and join across cells.

Land pieces never paint the cell: a hex already carries its territory's colour,
so relief is light and shade over it. Only water owns a colour. And the altitude
is fixed by the grid — a cell is 27 px wide on the finished map, which is a
range, not a tree.

```bash
pnpm tiles:view                        # one self-contained HTML page
pnpm tiles:build                       # manifest + files + sprite into .tiles/
pnpm tiles:build --out=public/tiles    # somewhere that ships
pnpm tiles:build --only=coast,water --formats=svg --size=128 --seed=v2
```

`tiles:build` writes four things: `collection.json` (every piece in unit-hex
coordinates, plus the geometry, the joining rules, the object recipes and the
terrain table the map fills its territories from), `svg/` (one file per
picture), `objects/` (each assembled object) and `sprite.svg`. `tiles:view`
bundles the same generator with controls into `.tiles/collection.html`, which
opens straight from disk. Output is gitignored; override with `TILES_OUT` and
`TILES_VIEW_OUT`.

Neither is wired into the build, and neither needs to be: the map screen imports
the generator from `shared/tiles/` and draws the ground of every territory
itself. These two exist for consumers outside the repository. Full
documentation: [docs/tiles.md](tiles.md).

### `pnpm stats`

The dashboard: one local page with the coverage, the shape of the graph, the
material, the crawl, the daily series and — the part worth opening it for — an
estimate of what is left.

```bash
pnpm stats               # .stats/dashboard.html
pnpm stats --serve       # localhost:5180, recomputed on every reload
pnpm stats --json        # the same figures as JSON
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

### `pnpm check:i18n`

Two-way check on localisation: every key the code passes to `t()` must exist in
`data/i18n/{lang}.json`, and every key in the dictionary must be used somewhere.
Template keys (`t(\`course.${id}.title\`)`) are matched as wildcards.

Both halves matter. A missing key ships the raw key to the user; an orphaned one
is dead weight nobody later dares delete.

It also gates content, since the course files hold no prose at all: every course
needs a non-empty `title` and `desc`, and at least one entry in
`data/keywords/{lang}.json`. An empty string counts as missing — it passes a
presence check and then renders as nothing.

Exits non-zero on any of it, and CI runs it.

## Crawling YouTube

These need `YOUTUBE_API_KEY` in `.env`. They share a 10 000 unit daily quota, and
all of them stop at `YOUTUBE_QUOTA_CEILING` (default 9500) rather than dying on a
403. Running out of quota prints `квота исчерпана, продолжу завтра` and **exits
0** — it is the normal end of a working day, not a failure, and CI stays green.

Every response body is kept verbatim in `raw_responses`, so a parser bug is
fixed and re-run locally instead of costing another day of quota.

State lives in `cache.db`, including the job queue, so any of these can be killed
and restarted. See [docs/pipeline.md](pipeline.md) for costs, retry policy and
refresh periods.

### `pnpm data:discover`

Channels → playlists. Reads `data/channels.yaml`, resolves each channel and lists
the playlists it owns. Costs 1 unit per channel plus 1 per 50 playlists.

Incremental: a channel is only re-scanned every 30 days. `--force` ignores that
and re-scans everything — useful right after adding channels in bulk, expensive
otherwise.

```bash
pnpm data:discover
pnpm data:discover --force
```

Run it roughly monthly, or after editing `data/channels.yaml`.

### `pnpm data:refresh`

The nightly job, and the one to reach for by default. Runs metadata → videos →
liveness in that order until the queue drains or the quota does.

```bash
pnpm data:refresh
```

Before the first step it seeds any playlist named in `overrides.yaml` that the
crawl has never seen. `overrides.yaml` is committed and `cache.db` is not, so a
playlist bound on somebody's laptop reaches CI only through that file — and a
playlist that has never had metadata is scanned first, ahead of the popular
ones. There are more playlists than the metadata scan window holds, and a new
row has no view count to sort by, so without that it would fall outside the
window every night and never be fetched at all.

The three steps are also available separately, which is mostly useful when
debugging one of them:

- **`pnpm data:playlists`** (`02`) — playlist titles, descriptions and
  statistics, in batches of 50 per unit. Incremental by `next_refresh_at`, so
  repeat runs are nearly free.
- **`pnpm data:videos`** (`03`) — the expensive one. Walks queued playlists,
  stores their videos, and rolls durations and statistics up onto the playlist.
  One unit per 50 videos listed, plus one per 50 detailed.
- **`pnpm data:liveness`** (`04`) — marks playlists that were deleted or went
  private. A dead playlist is never retried: 404 and 403 are permanent here.

## Matching playlists to courses

### `pnpm data:match`

Decides which course a crawled playlist belongs to. A cascade, cheapest first —
rules over titles and the synonym dictionary in `data/keywords/{lang}.json`,
then optionally the LLM, then a human.

```bash
pnpm data:match          # rules only, free, no network beyond the database
pnpm data:match --llm    # adds the model pass; needs OPENAI_API_KEY
pnpm data:match --force  # re-read everything, after a change to the rules
```

Anything that lands below confidence 0.75 — including every case where two
courses claim the same title, which is *declined* rather than guessed — is left
for `data:review`. A below-threshold guess is not an answer, so it is passed on
to the model as a hint rather than kept to itself; the model's answer is only
taken when it beats what the rules already had. Results go into the `matches`
table, not into YAML.

`--force` re-reads the playlists earlier passes already bound confidently, which
is otherwise the one thing this step leaves alone — so a change to
`lib/rules.ts` or to `keywords/{lang}.json` reaches nothing already in the
catalogue, which is exactly what such a change is usually written to correct. It
can take a binding back as well as add one. Hand decisions are never touched:
`reviewed` rows and `overrides.yaml` outrank every pass.

Model choice is `OPENAI_CLASSIFY_MODEL` (default `gpt-5-mini`).

#### How the rule pass decides

The rule lives in [scripts/lib/rules.ts](../scripts/lib/rules.ts) and is biased
towards refusing: a playlist it declines costs someone a minute in `data:review`,
while a playlist it binds wrongly sits in the catalogue and misleads.

Four things shape the answer.

**Word boundaries, not substrings.** A keyword has to match as a word, with a
short tail allowed for Russian inflection — «алгебра» still finds «алгебры», but
`logic` no longer finds «bio**logic**al Chemistry» and `evolution` no longer
finds «The American R**evolution**». Both were real bindings before this. The
tail is letters only: an ending is inflection, a digit is another course, so
`algebra 1` does not find «ALGEBRA 16».

**Noise is stripped first.** `MIT 18.06SC Linear Algebra, Fall 2011` is measured
as `linear algebra`. Course codes, terms and years go, and so do the words that
say who is teaching rather than what — `mit`, `stanford`, `мфти` — and the ones
every syllabus shares: `introduction`, `of`, `the`, `course`. All of it happens
before normalisation, while the dots are still there — otherwise `18.02` becomes
`18 02` and is indistinguishable from the `2` in «Математический анализ 2», which
decides which course that is. «часть» is stripped and its number is kept, because
«Матанализ. Часть 2» *is* «Матанализ 2»; «2 курс» is stripped whole, because it
says which year a student takes the course, not which course it is.

The same stripping runs over the keywords themselves. Both sides have to agree,
or a keyword written «theory of computation» stops matching every title that has
just had its `of` taken out.

**A title is read in clauses.** «Дискретная математика | Роман Глинских | осень
2021» is a subject, a lecturer and a term, and coverage is asked of the first
alone. Commas, brackets, pipes, dashes and a full stop before a word all divide;
so do `with` and `by`, which introduce a name. Without this the measure answers
the wrong question — a real subject padded out with a lecturer scores like a
passing mention, while «линейное программирование», which really is a passing
resemblance, scores like a subject.

**Confidence follows coverage of the clause.** Nearly all of it is 0.92, most of
it 0.82–0.88, about half 0.68–0.72, a passing mention 0.6; a clause that is
exactly the keyword is 0.95. The bar sits high because names and years are
already gone: what is left beside the keyword is usually a word that renames it.
«Линейное программирование» is not programming, «pre-algebra» is not algebra and
«tensor calculus» is not calculus — all three used to clear the bar.

**Two subjects mean no answer.** When another course claims a different span of
the same clause, or another clause names a second subject just as convincingly,
the playlist goes to a human: «Psychology and Economics», «Graph Theory and
Additive Combinatorics». Adjacent words are exempt, since in «multivariable
calculus» the two keywords describe one thing rather than two. The same applies
to a word two courses share outright: `algebra` is deliberately a keyword of both
`school-algebra` and `abstract-algebra`, so a bare English «Algebra» is declined
while «Algebra II» and «Алгебра» each still go where they belong.

On top of that a title that names support material rather than a course —
homework help, exam prep, test review, office hours, seminar series, podcasts,
shorts, open days — is refused outright.

Against the crawl in `cache.db` at the time of writing (7940 playlists) the rule
pass binds about a thousand automatically. The clause reading replaced some 380
of the bindings the previous version made with about 400 others; the ones it gave
up were «Project Management» under management, «Эволюция Земли» under evolution
and «Bioinformatics Research Symposium» under bioinformatics, and the ones it
gained were most of MIT's own flagship courses, whose titles are a fifth
university by weight.

### `pnpm data:review`

A local review server on `http://localhost:5174` for everything the automatic
passes refused to decide. One playlist at a time: the playlist on the left,
course search and suggestions on the right.

```
1–9   bind to the numbered suggestion
n     not a course at all
→     skip
```

Decisions are written to `data/overrides.yaml`, which is committed — that file is
the reviewed record and what goes into the pull request. Override the port with
`REVIEW_PORT`.

A refusal is worth as much as a binding. «Stanford Seminars», «Дни открытых
дверей» and «Our Research» are topic bins rather than courses, and without a
record saying so they come back into the queue every time and take crawl quota
with them — the bins are the long playlists. Both answers also reach
`data:videos`, which crawls what was bound first of all and what was refused
last of all.

The keyboard-first design is the whole point: the alternative is hand-editing
YAML by playlist id, which is torture and therefore does not get done.

## Content and imports

### `pnpm data:images`

By default, nothing is called and nothing is paid for: course art is procedural
SVG generated deterministically from the course id, both here and in the
frontend, so it never needs storing.

The flag is for domain images only — about 40 of them, generated once and
committed:

```bash
pnpm data:images --openai --only=math,physics
```

`--only=` takes a comma-separated list of domain ids; without it every domain is
covered. Needs `OPENAI_API_KEY`; model is `OPENAI_IMAGE_MODEL` (default
`gpt-image-1`). Look changes go through `scripts/lib/visual.config.ts` — editing
`seedSalt` there redraws all procedural art, which is one string instead of 500
API calls.

Both modes **skip images already on disk**, since there is no table to record
what is done and the file is the record. That is what makes the limit work
(`pnpm data:images --openai 5` twice generates ten different images), and it is
also what keeps a re-run from paying for the same pictures twice. A changed
`seedSalt` or prompt therefore needs `--force`, which regenerates regardless.

### `pnpm data:import`

Pulls YouTube playlist links out of the awesome-lists declared in
`data/sources.yaml` and queues them for the normal crawl.

Courses are **never** created automatically. Titles that match nothing in
`data/courses/` are dropped into `data/proposed-courses.yaml` (gitignored) for a
human to add by hand with real `deps` taken from a syllabus. Auto-generated
dependencies would quietly ruin the graph, and the graph is the whole product.

## Order

First run, from an empty checkout:

```bash
pnpm install
pnpm data:build            # empty catalogue, valid graph
pnpm data:seed-dev && pnpm data:build   # or: a full one, with fake playlists
pnpm dev
```

First run with real data, spread over two or three days of quota:

```bash
pnpm data:discover         # channels → playlists
pnpm data:refresh          # repeat daily until it stops reporting exhausted quota
pnpm data:match --llm
pnpm data:review           # decide the leftovers
pnpm data:build
```

Afterwards `data:refresh` and `data:match` run nightly on CI, and the only manual
step is review.

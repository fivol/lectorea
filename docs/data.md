# Data

[← docs](README.md) · the model behind the JSON the site fetches

## Sources — edited by hand, reviewed in pull requests

```
data/
  domains.yaml           areas, continents, links, shapes, band order
                         (no colours: they come with the biome — docs/biomes.md)
  courses/
    math.yaml            the course graph, one file per area
    physics.yaml
    bioinformatics.yaml
    …                    39 files, one per domain
  providers.yaml         universities, platforms, individuals
  channels.yaml          channels to crawl
  sources.yaml           awesome-lists to import from
  overrides.yaml         hand edits on top of the automatic pipeline
  image-prompts.yaml     prompt templates for domain images
  i18n/ru.json           every interface and content string
  i18n/en.json           the same, in English
  keywords/ru.json       search keywords
  keywords/en.json       …one file per interface language
```

YAML rather than JSON for sources: comments, readable diffs, less syntactic
noise when editing by hand.

## Why courses are split across files

Playlists are JSONL — thousands of them, written by scripts, never read by eye.
Courses are the opposite: a few hundred, hand-curated, reviewed line by line.
One flat file made every pull request touch the same lines, and a JSONL line per
course would have been unreadable and uncommentable.

So: **one file per area**, and the file is decided by the **first entry of
`domains`**. Bioinformatics declares `domains: [bioinformatics, cs, biology]`
and lives in `bioinformatics.yaml`.

That rule is the whole point — "where does this course go?" has exactly one
answer, and `pnpm data:build` fails if a course is filed anywhere else. Placement
is storage and nothing more: it has no effect on the graph, and a file with three
courses in it is fine.

## What a course file holds

```yaml
- id: probability
  domains: [probability]
  stage: bachelor-2             # when a person actually meets this
  deps: [calculus-2, combinatorics]
  soft: [measure-theory]        # excluded from the path
  refs:
    syllabus: https://ocw.mit.edu/courses/6-041/

- id: art-history-intro
  domains: [art-history]
  stage: bachelor-1
  minLevel: 1                   # no formal prerequisites, but column 0 lies
```

`stage` is one of `school-8`…`school-11`, `bachelor-1`…`bachelor-4`,
`master-1`, `master-2`, `phd`, and it is **not** derived from `level`. The two
answer different questions: `level` counts prerequisites inside this catalogue,
so "Введение в социологию" and "Школьная алгебра" both sit in column zero while
one is a first-year university course and the other is school. It is a curator's
judgement, so it lives in the data where a reviewer can argue with it.

No titles, no descriptions, no keywords — only structure. That is deliberate: a
diff on a course file should read as a change to the graph, not drown in
reworded prose.

`minLevel` is a manual floor under the computed level, for courses that have no
formal prerequisites but do not belong next to school algebra. Use it rarely and
always with a comment: every one is an admission of a dependency that exists but
is not written down. Several of them in one area means that area is badly marked
up.

## Generated — in `.gitignore`, built on CI

```
public/data/
  domains.json           ~39 records
  courses.json           the graph, plus level and row per course
  providers.json         for the global provider filter
  lecturers.json         the same, for the global lecturer filter
  search-index.json      playlists, channels, lecturers — nobody translates those
  playlists/
    probability.json     one file per course, fetched on click
  i18n/ru.json           one complete dictionary per interface language
  i18n/en.json
  i18n/search-ru.json    courses and fields for the search box, per language
  i18n/search-en.json
  meta.json              build date, counts, coverage
```

The point of the sharding: the first screen pulls about 50 KB, not the whole
database. Playlists load on demand when a course is opened, and are then kept in
memory.

## The two entities

A **course** is an abstract unit of knowledge; a **playlist** is one concrete
recording of it. Dependencies hang on the course.

Only direct dependencies are stored. Transitive closure is computed.

## Fields computed at build time

Not stored in sources, added by the generator. The separation matters: sources
are edited and reviewed, computed fields are not.

On a course:

| Field | How |
|---|---|
| `level` | length of the longest `deps` chain ending here, globally — the column |
| `row` | position inside the column, from the barycentric ordering |
| `playlistCount` | number of live playlists |
| `hours` | median `totalSeconds` across the course's playlists |
| `hidden` | present and `true` when the course is kept but not shown — below |

Transitive closures are **not** shipped. `level(dep) < level(course)` holds by
construction, so the client walks `deps` and sorts by level to get a valid study
order — five lines instead of ~100 KB of JSON in every page load. The same goes
for "what opens up next": it is the reverse `deps` index, built once on load.

`courses.json` also carries `columns` (`{level, count}` per column) and
`maxLevel`. Both count the courses that are shown, not the ones in the file —
see below.

## Courses with no materials are hidden, not deleted

A course nobody has recorded is a card that answers nothing: it opens to an
empty panel, pads the columns and the field counts, and search finds it only to
disappoint. The build marks it `hidden: true` and the client drops it before
anything is drawn — the columns, the links, the search index, the field counts
and `maxLevel` are all built from what is left.

Nothing is removed from the sources. The course keeps its file, its markup and
its dependencies, and the day a playlist matches it, it comes back on the next
build with no edit at all.

One exception, and it is the point of the rule: **a course something visible
depends on always stays**, empty or not. «What has to come first» is the promise
the catalogue makes, and a path that leads through a card that is not there
would be a worse lie than a card with nothing behind it. Keeping such a course
can keep its own dependencies in turn, so the set is a fixpoint rather than a
filter. Those courses are the ones that still show «нет материалов» on the site.

Coverage is deliberately *not* affected: `meta.coverage` and everything in
`pnpm stats` count the whole catalogue, hidden courses included, because hiding
a hole is not filling it. `meta.hidden` says how many are hidden, and the stats
page shows it beside «Курсов без материала».

On a playlist:

| Field | How |
|---|---|
| `lectureLength` | bucket by `medianSeconds`: `short` ≤ 15 min, `lesson` 15–40, `pair` 40–100, `double` 100–200, `long` > 200 |
| `kind` | `lectures` / `seminars` / `mixed` / `unknown`, from what a majority of the **lecture** titles call themselves |
| `engagement` | `(likes + comments) / views` — the raw column the modal shows |
| `retention` | views of the last quarter of lectures over the first |
| `curve` | `series` / `assorted` / `unclear` — the shape of the view curve, which decides whether retention may be scored |
| `collection` | a shelf of videos rather than a course — read off the titles, upload dates and lengths, not off the curve |
| `fullCourse` | a whole term of ordered lectures in equal slots — the mirror of `collection` |
| `rating` | the combined score the list sorts by, below |
| `status` | the one word the row says about the numbers, below |
| `signals` | the normalised parts behind the rating, for the tooltip |
| `lastVideoAt` | last upload — what decides whether a playlist is still settling |

## Rating

Dislikes have been private since 2021, so nothing YouTube publishes states
quality. Four things are measured instead — likes per view, how much of the
audience is still there at the end, comments per view, and views per lecture
per subscriber — and each is turned into a z-score against playlists of the
same language and era before anything is added up. The list sorts by `rating`
and shows one word from `status`. What a playlist *is* — «Подборка»,
«Семинары», «Полный курс» — is a separate badge, derived from `collection`,
`kind` and `fullCourse` by `playlistTypeOf`: it is not a verdict, and while it
shared the `status` slot it silenced the verdict on 15% of the catalogue.

**[docs/rating.md](rating.md) is the whole story**: what each signal is worth,
why the peer groups exist, how «Подборка» is told from a course, why the type
is not a status, what each word costs, and what the numbers still cannot say. Read it before changing a
knob in `scripts/lib/score.ts`.

## Overrides

`data/overrides.yaml` is applied on top of everything the pipeline decides and
always wins:

```yaml
matches:                      # playlistId → courseId, or null for "not a course"
  PLxxx: probability
  PLyyy: null
playlists:                    # playlistId → fields that beat the scraped values
  PLxxx:
    lecturer: Райгородский А. М.
    hidden: false             # true removes it from the catalogue entirely
channels:                     # channelId → providerId
  UCxxx: mipt
```

`06-review.ts` writes the `matches` section. The file is committed — it is the
reviewed record and what goes into the pull request.

## Localisation and course text

Every user-facing string is in `data/i18n/{lang}.json`; the code holds keys only.
Not localised: playlist and channel titles (they come from YouTube as they are),
lecturer names, ids.

Course text is keyed off the course id by convention — the course files
themselves carry no prose:

```json
// data/i18n/ru.json
"course.probability.title": "Теория вероятностей",
"course.probability.desc":  "Случайные величины, распределения, предельные теоремы"
```

```json
// data/keywords/ru.json
"course.probability": ["теорвер", "теория вероятностей", "вероятность", "probability"]
```

Search keywords are a separate file: they are long, only the search needs them,
and they should not be shipped alongside the interface strings. Morphology is
solved here by listing forms, not by a stemmer on the client.

The price is that adding a course touches the graph entry plus two files per
language. `pnpm course:new` does the clerical part — see
[scripts/catalogue.md](scripts/catalogue.md#pnpm-coursenew).

`pnpm check:i18n` fails when a key is used but missing, present but unused, or
left empty, and when a course has no keywords at all. The last two matter most:
without them, half the catalogue quietly ends up with no description and no way
to find it.

### One language, whole

Every language carries the whole dictionary — the `ui.*` chrome and the
`course.*` / `domain.*` catalogue alike — plus its own keyword file:

| file | holds |
| --- | --- |
| `data/i18n/{lang}.json` | interface **and** catalogue, the whole dictionary |
| `data/keywords/{lang}.json` | search keywords for every course and field |

`DEFAULT_LANG` is the source of truth: it is the one a course is written in
first, and the one every other language is checked against. A language that
translated only the chrome would put its own buttons around somebody else's
course titles, which is a worse page than either language alone — so
`check:i18n` holds each of them to the full key set, nothing beyond it, and
keywords for every course. Adding a language means adding it to `UI_LANGS` in
`shared/schema.ts` and dropping those two files next to the others.

The setting lives in the profile (`settings.lang`) and there is a switch in the
header of both screens. Switching refetches only what is written in a language:
the dictionary, and the courses-and-fields half of the search index. The
catalogue itself — the graph, the playlists, the big half of the index — is
language-independent and is never torn down.

### Searching in a language

The search index comes in two halves, because only one of them is translated:

| file | holds | ~size |
| --- | --- | --- |
| `public/data/search-index.json` | playlists, channels, lecturers — named on YouTube by whoever published them | 540 KB |
| `public/data/i18n/search-{lang}.json` | courses and fields, named in that language | 40 KB |

The client fetches the first once and concatenates whichever of the second the
profile asks for. Splitting them is what keeps a language switch cheap: the
nine tenths nobody translates are not refetched.

A translated index keeps the content language's keywords alongside its own. What
a course is *called* has to follow the page; what finds it does not. The lectures
are Russian, so someone reading the English interface may well type «матан» at
the box — and gets `Calculus 1`, named in the language on screen.

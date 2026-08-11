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
  keywords/ru.json       search keywords
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
  search-index.json
  playlists/
    probability.json     one file per course, fetched on click
  i18n/ru.json
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

Transitive closures are **not** shipped. `level(dep) < level(course)` holds by
construction, so the client walks `deps` and sorts by level to get a valid study
order — five lines instead of ~100 KB of JSON in every page load. The same goes
for "what opens up next": it is the reverse `deps` index, built once on load.

`courses.json` also carries `columns` (`{level, count}` per column) and
`maxLevel`.

On a playlist:

| Field | How |
|---|---|
| `lectureLength` | bucket by `medianSeconds`: `lesson` ≤ 40 min, `pair` 40–100, `double` 100–200, `long` > 200 |
| `engagement` | `(likes + comments) / views` |
| `score` | bayesian rating, below |
| `scorePercent` | `score` mapped onto 0..100 against the catalogue mean |

## Rating

Dislikes have been private since 2021, so there is no public "percent liked"
left. The only available proxy for quality is engagement — but raw engagement is
useless for sorting: a playlist with 40 views and one enthusiastic comment would
outrank an MIT course. Hence bayesian smoothing towards the catalogue average:

```
score = (v / (v + m)) * R + (m / (v + m)) * C

v — views of this playlist
R — its engagement
C — mean engagement across the catalogue
m — confidence threshold in views (5000, tunable)
```

Computed at build time and written into the JSON. This is the default sort.

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

The price is that adding a course touches three files. `pnpm course:new` does the
clerical part — see [scripts/catalogue.md](scripts/catalogue.md#pnpm-coursenew).

`pnpm check:i18n` fails when a key is used but missing, present but unused, or
left empty, and when a course has no keywords at all. The last two matter most:
without them, half the catalogue quietly ends up with no description and no way
to find it.

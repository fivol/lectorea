# Data

## Sources — edited by hand, reviewed in pull requests

```
data/
  domains.yaml           areas, continents, links, shapes
  courses.yaml           the course graph
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

## Generated — in `.gitignore`, built on CI

```
public/data/
  domains.json           ~39 records
  courses.json           graph + coordinates
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
| `level` | length of the longest `deps` chain ending here, globally |
| `x`, `y` | dagre layout; `x` is derived from `level` so columns line up |
| `playlistCount` | number of live playlists |
| `hours` | median `totalSeconds` across the course's playlists |
| `reachUp` | transitive `deps` closure, in topological order |
| `reachDown` | first step forward only, each with a counter of what is behind it |

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

## Localisation

Every user-facing string is in `data/i18n/{lang}.json`; the code holds keys only.
Not localised: playlist and channel titles (they come from YouTube as they are),
lecturer names, ids.

Search keywords are a separate file: they are long, only the search needs them,
and they should not be shipped alongside the interface strings.

`pnpm check:i18n` fails when a key is used but missing, or present but unused.

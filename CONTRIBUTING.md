# Contributing

[![ci](https://github.com/fivol/lectorea/actions/workflows/ci.yml/badge.svg)](https://github.com/fivol/lectorea/actions/workflows/ci.yml)
[![site](https://img.shields.io/badge/site-fivol.github.io%2Flectorea-2ea043)](https://fivol.github.io/lectorea/)

What the catalogue is: [README](README.md). How it is built:
[docs/](docs/README.md). This page is the rules an edit has to follow.

All content lives in `data/` as YAML and JSON. Changes go through pull requests.

## Without cloning anything

Open an issue. There are four forms — a playlist, a course, a domain, and
everything else — and they ask for as little as the pipeline can get away with:
a playlist needs the link and nothing more, since the channel, the university,
the lecturer, the language and the running time are all read off the YouTube
API. Anything left blank is either derived or asked about during triage; there
is no form to fill in twice.

Maintainers work through them with `/issues`, which checks each one against the
API and against this file before anything is written. What it cannot verify it
asks about — in the issue, so the answer stays with the request.

## The rule that matters most

**One unit = one semester course.**

Splitting a course into topics is not allowed. Neither is merging a two-year
sequence into one entry.

This is not style. `level` is computed as the longest `deps` chain ending at a
node, so the shape of the graph depends on how courses are sliced: cut calculus
into four parts and every physics course shifts a column to the right, for
everyone. No script can detect this — it is checked in review.

Rough test: could one lecturer teach this in one term, and does a real
university put exactly this on one line of a curriculum?

## Dependencies

`deps` — hard prerequisites. **Direct only.**

If A requires B and B requires C, then A lists only B. The transitive closure is
computed at build time; writing it out by hand makes the graph unreadable and
the diffs unmergeable.

`soft` — helpful but not required. Drawn as a dashed arrow, excluded from the
path and from the hour totals.

`related` — mutual links, for fields where dependency runs both ways (logic ↔
philosophy). Write it on one side only; the build mirrors it. `related` is not
part of the topological sort, which is what keeps the cycle check alive and able
to catch real mistakes in the natural sciences.

Dependencies come from **syllabi**, not from intuition. MIT OCW and Berkeley
state them explicitly. Put the link in `refs.syllabus` so a reviewer can check it
in one click.

```yaml
- id: probability
  domains: [probability]          # the first domain is primary: colour, and which file this is in
  stage: bachelor-2               # when a person normally meets it
  deps: [calculus-2, combinatorics]
  soft: []
  related: []
  refs:
    syllabus: https://ocw.mit.edu/courses/6-041-…/
```

`stage` is one of `school-8`…`school-11`, `bachelor-1`…`bachelor-4`, `master-1`,
`master-2`, `phd`. Do not read it off `level`: the column counts prerequisites
inside this catalogue, while the stage is where a real curriculum puts the
course. Answer it as "which year would a student normally take this?" — and when
the two disagree, that is information, not an error.

`minLevel` is available as a manual floor under the computed level, for a course
with no formal prerequisites that column zero would misrepresent — history of art
does not belong beside school algebra. Use it rarely, and always with a comment
saying why: each one is an admission of a dependency that exists but is not
written down.

## Which file a course goes in

`data/courses/<first domain>.yaml`. That is the entire rule, and CI enforces it.

Bioinformatics declares `domains: [bioinformatics, cs, biology]` and therefore
lives in `bioinformatics.yaml`. Placement is storage only — it has no effect on
the graph — and a file with three courses in it is fine.

## Adding a course

```bash
pnpm course:new probability --domain=math --stage=bachelor-2 --deps=calculus-2,combinatorics
```

`--stage` is required and has no default: a year written by a script is
indistinguishable from an answer, including to the reviewer.

That writes the graph entry and reserves the text and keyword keys. Then fill in
by hand:

1. `course.<id>.title` and `course.<id>.desc` in `data/i18n/ru.json` — the
   description is one line, the sentence that would appear under the title
2. keywords in `data/keywords/ru.json` — abbreviations, slang, transliterations
   (`теорвер`, `линал`, `диффуры`). Morphology is solved here by listing forms,
   not by a stemmer on the client
3. `pnpm check:i18n && pnpm data:build`

`check:i18n` fails while the description is empty or the keyword list is bare.
That is on purpose: a course with no description shows a placeholder, and a
course with no keywords can only be found by someone who already knows its exact
title — both are invisible failures otherwise.

An empty course — one with no playlists yet — is welcome. Empty courses are not
hidden: they show the structure of the field, and the empty outskirts on the map
are visible as work to be done.

## Adding a domain

Domains are territories on the map. After editing `data/domains.yaml`, run
`pnpm data:map` to regenerate `public/map.svg` and commit both. The generator
warns when a territory ends up smaller than its share of courses.

A domain also needs a **biome**: a line in `BIOME_BY_DOMAIN`
(`shared/tiles/biomes.ts`) saying what kind of country the field is — and, on
the same line, which tone of that biome's ramp it is painted. That one entry
decides both the ground inside the territory and its colour everywhere in the
app. Pick from the biomes of the domain's own continent: a continent is one
climate, which is what makes it readable as one place.
`tests/biomes.test.ts` fails until the line is written, again if the biome comes
from another continent, and again if the tone is too close to a neighbour's on
the redrawn map. The rules, and a prompt for picking one, are in
[docs/biomes.md](docs/biomes.md).

A domain also needs a `bandOrder`: its vertical position in the course columns,
fundamental at the top and applied at the bottom. Pick a number between its
neighbours — the existing ones are spaced by ten so there is always room. It is
written by hand rather than derived so that the whole screen does not reshuffle
when something unrelated changes.

And an icon, in `src/components/DomainIcon.tsx`: a line-art glyph on the 24×24
grid, stroked only, no fills. A test fails when a domain has none — the fallback
ring renders fine, so nothing else would notice.

## Adding a playlist

Do not edit playlist data by hand. Playlists are crawled; add the channel to
`data/channels.yaml` and let the pipeline find them.

A channel belongs there only if it publishes **courses as playlists** — several
playlists of roughly ten lectures or more, each named after a subject. Channels
of excellent standalone videos do not qualify, however good they are: their
playlists are topic bins ("Physics", "Popular videos") that no course can be
pointed at. Check before adding rather than after: `channels.list?forHandle`
resolves the handle and `playlists.list` shows what is actually there, at a cost
of two quota units.

To bind a specific playlist to a course, run `pnpm data:review` — a local server
that shows one playlist at a time with keyboard shortcuts and writes decisions
to `data/overrides.yaml`. That file is committed and is the reviewed record.

For the single playlist that arrives from outside that queue — an issue with a
link in it, something spotted by hand — there is:

```bash
pnpm playlist:add https://youtube.com/playlist?list=PL… --course=probability
pnpm playlist:add PL…                                    # look, do not touch
```

It does the two halves that are easy to do only one of: writes the match into
`overrides.yaml`, and puts the playlist into the crawl queue. Without the second
the match points at a row the database does not have, and the build skips it
without a word. Without `--course` it spends one quota unit to say what the
playlist is, which is the check worth doing before believing a link.

## What CI checks

- every YAML file matches its zod schema, with file and line on failure
- the `deps` graph is acyclic — the loop itself is printed if it is not
- every `deps`, `soft` and `related` target exists
- every course claims a domain that exists
- every course is in the file its first domain names
- every course declares a `stage` from the allowed set
- every course has a title, a description and at least one search keyword
- every domain has an icon in `src/components/DomainIcon.tsx`
- every i18n key used in code is present, and every key present is used
- types and tests pass

It also **warns**, without failing, when a dependency is already implied
transitively, or when a `soft` edge duplicates a hard one. Read them: that is the
graph telling you it is growing over.

## What CI cannot check

- whether a unit really is one semester course
- whether a dependency is real or merely plausible
- whether a `minLevel` is justified or is papering over missing markup

That is what review is for. When in doubt, link the syllabus.

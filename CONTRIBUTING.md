# Contributing

All content lives in `data/` as YAML and JSON. Changes go through pull requests.

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
pnpm course:new probability --domain=math --deps=calculus-2,combinatorics
```

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

To bind a specific playlist to a course, run `pnpm data:review` — a local server
that shows one playlist at a time with keyboard shortcuts and writes decisions
to `data/overrides.yaml`. That file is committed and is the reviewed record.

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

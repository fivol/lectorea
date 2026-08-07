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
state them explicitly. Put the link in `externalRefs.syllabus` so a reviewer can
check it in one click.

```yaml
- id: probability
  domains: [probability]          # the first domain is primary; it gives the card its colour
  deps: [calculus-2, combinatorics]
  soft: []
  related: []
  externalRefs:
    syllabus: https://ocw.mit.edu/courses/6-041-…/
```

## Adding a course

1. Add the entry to `data/courses.yaml`
2. Add `course.<id>.title` and `course.<id>.desc` to `data/i18n/ru.json`
3. Add search keywords to `data/keywords/ru.json` if the title alone would not
   find it — abbreviations, slang, transliterations (`теорвер`, `линал`,
   `диффуры`). Morphology is solved here by listing forms, not by a stemmer
4. Run `pnpm data:build && pnpm check:i18n`

An empty course — one with no playlists yet — is welcome. Empty courses are not
hidden: they show the structure of the field, and the empty outskirts on the map
are visible as work to be done.

## Adding a domain

Domains are territories on the map. After editing `data/domains.yaml`, run
`pnpm data:map` to regenerate `public/map.svg` and commit both. The generator
warns when a territory ends up smaller than its share of courses.

## Adding a playlist

Do not edit playlist data by hand. Playlists are crawled; add the channel to
`data/channels.yaml` and let the pipeline find them.

To bind a specific playlist to a course, run `pnpm data:review` — a local server
that shows one playlist at a time with keyboard shortcuts and writes decisions
to `data/overrides.yaml`. That file is committed and is the reviewed record.

## What CI checks

- every YAML file matches its zod schema, with file and line on failure
- the `deps` graph is acyclic — the node list is printed if it is not
- every `deps`, `soft` and `related` target exists
- every course claims a domain that exists
- every i18n key used in code is present, and every key present is used
- types and tests pass

## What CI cannot check

- whether a unit really is one semester course
- whether a dependency is real or merely plausible
- whether a dependency is direct or transitive

That is what review is for. When in doubt, link the syllabus.

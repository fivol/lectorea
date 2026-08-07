# Levels and columns

The courses screen is columns of cards. There are no arrows, no canvas and no
graph library — the claim the screen makes is carried entirely by *where a card
sits*, so this document is about how that position is decided.

Everything here happens at build time. The client receives `level` and `row` and
renders ordinary scrollable layout.

## The level is the column

```
level(c) = minLevel(c)                             if deps is empty
         = max(minLevel(c), 1 + max(level(d)))     over d in deps(c)
```

The **longest** chain, not the shortest. If probability requires calculus-2
(level 2) and combinatorics (level 1), it belongs at 3. A shortest-path rule
would put it at 2 — level with a course that is its own prerequisite.

Only `deps` counts. `soft` and `related` are excluded: `related` is mutual by
design, and letting the humanities' two-way links into the ranking would make it
unsolvable.

Because the level is computed and never written by hand, "everything to the left
must be known first" is a property of the data rather than a promise. It cannot
drift, and there is no such thing as a course accidentally placed before its own
prerequisite.

The price: depth depends on how courses are sliced. Split calculus into four
parts and all of physics shifts one column right, for everyone. Hence the rule in
[CONTRIBUTING.md](../CONTRIBUTING.md) — one unit = one semester course.

## One pass of Kahn's algorithm

The topological order, the levels and cycle detection are the same traversal, so
`shared/graph.ts` computes them together instead of walking the graph three
times.

The property that makes it cheap: when a node leaves the queue, every one of its
dependencies has already left, so their levels are final and `max` over them is
one operation — no recursion, no memoisation.

If fewer nodes come out than went in, what is left is exactly the part of the
graph that contains a cycle, and a DFS restricted to that subset reports the loop
itself:

```
✗ The deps graph has a cycle
  statistics → probability → measure-theory → statistics
```

A bare "cycle detected" is useless at 200 nodes. This is the single most valuable
check in the pipeline: it catches a markup error that is invisible to the eye and
points straight at it.

Alongside it the build reports things that are not errors but rot the graph if
left alone, with file and line:

```
! data/courses/physics.yaml:30 [electrodynamics] deps → "calculus-3" is already implied transitively
```

A redundant edge says nothing the graph did not already imply. Left to
accumulate, every course ends up listing half the catalogue and "direct only"
stops meaning anything.

## The row is the only thing left to decide

The column is settled by the level, so the layout's whole job is the vertical
order inside each column. That is what decides whether the screen reads as tracks
through a field or as confetti.

**Seed.** Sort each column by the domain's `bandOrder`, then by source order.
Deterministic input matters: without it the passes below converge somewhere
slightly different on every build and the whole screen reshuffles on an unrelated
edit.

**Barycentric ordering.** Four sweeps, forwards then backwards. Each card moves
towards the average row of what it connects to in the neighbouring column:

```
bary(n) = mean(row of n's deps)          sweeping forwards
        = mean(row of n's dependants)    sweeping backwards
```

Sort, renumber, repeat. The scatter drops sharply over the first few passes and
then stops improving — four is where it flattens out.

**Domain bands.** `bandOrder` is the primary sort key and the barycentre only
breaks ties, so a domain's courses stay contiguous inside every column and read
as a horizontal band across the screen.

This is a deliberate trade. Pure barycentric ordering would place cards closer to
their prerequisites; banding costs some of that. But the domain filter is used
constantly, and when you switch on "computer science" the result has to be a
solid stripe rather than a spray of cards across the full height. Precise
neighbour order is not looked at nearly as often.

`bandOrder` is written by hand in `data/domains.yaml`, fundamental at the top and
applied at the bottom. Derived from anything else it would drift between builds.

## Why the rows line up

`row` is a card's index inside its column and every card is the same height, so a
card at row 5 sits at the same height in every column. The build's ordering shows
up as alignment instead of geometry — which is why the screen still communicates
structure with nothing drawn between the cards.

When a filter hides part of a column the remainder collapses upward. Rows stop
lining up globally, and that is the right behaviour: a column holding three cards
spread across forty empty slots reads as a broken page, not as a filtered one.

## Why not dagre

It was used until the layout moved to columns, and it earned its removal twice
over.

Its default `network-simplex` ranker minimises total edge length rather than
producing our levels — nodes drift towards whatever consumes them, and calculus
ends up to the right of where it belongs. `longest-path` fixes the ranking, but
neither ranker can express domain bands, which is the part that actually matters
here.

And most of what dagre computes is edge routing for edges this screen does not
draw. What is left is ~80 lines with no dependency in the build.

## What the client does

Nothing about layout. It reads `level` and `row`, groups cards into columns and
renders them.

The graph queries it does run are all cheap re-derivations that would cost more
to ship than to compute (`src/lib/catalog.tsx`):

- **path to a course** — walk `deps` upwards, sort by `level`. Since
  `level(dep) < level(course)` always holds, sorting by level *is* a valid study
  order, so there is no topological sort on the client.
- **what a course unlocks** — the reverse `deps` index, built once when the
  catalogue loads, plus a forward-closure size for the "+3" counters.

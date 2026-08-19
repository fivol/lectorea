# Where more material comes from

[← docs](README.md) · [channel-hunt.md](channel-hunt.md) is the record of the
hunts and [agents/iteration.md](agents/iteration.md) the runbook for a whole
iteration; this is the catalogue of seams, spent and unspent.

The catalogue grows in one way only: more playlists that are actually courses.
This page is the list of places they can be dug out of, what each one costs, and
what it is worth — so a hunt starts from what has not been tried rather than
from a blank page.

## The bar

**A structured course on a subject the catalogue has.** That is the whole test,
and it is narrower and wider than it sounds.

It is *not* "a university course". A 25-part series on music theory by a
musician, a language course by a teacher, a bootcamp playlist that builds one
skill in order — all of these are courses, and the catalogue needs them badly,
because the fields it is emptiest in are exactly the ones universities publish
least. It is not "lectures" either: a screencast series, a problem-solving
course, a filmed workshop all qualify if they teach in order.

What fails the bar has nothing to do with production values:

| Refused | Why |
|---|---|
| Standalone videos, however good | Veritasium, Numberphile — there is no course to point at |
| Topic bins | «Physics», "Popular videos", *Harvard Gazette* — a label, not a syllabus |
| Conference and seminar archives | 300 talks by different people on different days |
| Exam prep and homework help | `lib/rules.ts` refuses these outright, so crawling them buys refusals |
| Re-uploads | the playlist is a real course, but the attribution is wrong and the mirror is what disappears |
| Subjects outside the catalogue | cooking, fitness, personal finance — good courses, wrong service |

The shape to look for: **several playlists of roughly ten or more videos whose
titles name a subject rather than a year, a series or the channel itself.**

## The economics that decide what is worth reading

Vetting a candidate playlist costs **one fiftieth of a unit** — `playlists.list`
resolves fifty ids per unit. A thousand bad ids is twenty units, about two
minutes of a day's quota.

That single number reframes the search. A source does not have to be clean; it
has to be *large*. Reddit threads, Notion dumps, a listicle of questionable
taste — all worth **reading**, because the cost of being wrong rounds to
nothing.

**But only for reading.** Walking a playlist's videos costs ~2.3 units, and the
tiered queue in [pipeline.md](pipeline.md) defends that by crawling unclaimed
playlists last — which protects nothing on the day a wide harvest lands, because
then *everything* is unclaimed and gold and rubbish are crawled in arbitrary
order. The sweep of 2026-08-12 paid real quota for nursery rhymes, music-video
compilations and Indian television, all of them linked in passing from a
description or a reading list. Two things follow, and neither is optional:

1. **Match before you crawl.** Titles are free, `playlists.list` is 1/50 of a
   unit, and matching turns an undifferentiated queue back into tiers. The order
   is metadata → match → videos, never refresh-everything.
2. **Teach `lib/rules.ts` to refuse what a wide seam drags in.** Its
   `NOT_A_COURSE` list knew about homework and open days because every playlist
   used to come from a vetted teaching channel; it now also knows about official
   music videos, nursery rhymes and full episodes. A refusal is tier 4, behind
   every real course, so the quota never reaches it.

So the ranking below is by **yield per unit of effort** — but a new seam is not
finished until the rubbish it brings has a rule that refuses it.

## Seam 1 — what the crawl already bought

Lecturers link their own courses. "Full playlist here", "part 2 of this series",
"prerequisites in my linear algebra course" — these sit in video and playlist
descriptions, and `raw_responses` keeps every API body verbatim, so they are
already on disk, already paid for.

```bash
pnpm data:mine
```

Zero quota, zero network. It scans the stored bodies and the playlist
descriptions for playlist ids, drops the ones already known, and queues the
rest. Re-run it after every crawl: each new playlist brings the descriptions of
its videos with it, so the seam refills itself.

This is the cheapest source there is and the only one that grows on its own.

## Seam 2 — the channels behind what was matched

Every playlist bound to a course names a channel, and a channel that keeps
turning up in decisions but is absent from `data/channels.yaml` is a hole in
that file — someone kept choosing it and nobody ever crawled it properly.

```bash
pnpm tsx scripts/_holes.ts
```

Zero quota — it is a query over `cache.db` and the overrides. Output is channels
ranked by how many bound playlists they own, which is a much better signal than
any listicle: it is the catalogue's own revealed preference.

## Seam 3 — catalogues that map course → playlist

The finding from the first hunt was that **lists naming playlists are lists of
courses, while lists naming channels are lists of good videos.** Course
catalogues are the purest form of the first kind: an institution publishing its
own curriculum, one playlist per course, with the subject already stated.

Scraping a web page costs no quota at all — only the final `playlists.list`
check does. `data/sources.yaml` therefore takes plain URLs as well as GitHub
repositories, and `pnpm data:import` reads both.

| Catalogue | Why it is worth reading |
|---|---|
| [Open Yale Courses](https://oyc.yale.edu/courses) | ~40 courses, and humanities throughout — literature, philosophy, political science, classics. Exactly where this catalogue is emptiest |
| [MIT OpenCourseWare](https://ocw.mit.edu/search/?f=Lecture%20Videos) | the channel is already crawled, but the catalogue states department and level, which the channel dump does not |
| [NPTEL](https://nptel.ac.in/courses) | thousands of Indian university courses, filed by discipline. The crawl has many of them by accident and none of them by structure |
| [Open Culture](https://www.openculture.com/freeonlinecourses) | ~1700 free courses, curated for decades, heavily humanities |
| [openedu.ru](https://openedu.ru/course/) | the Russian MOOC platform — ВШЭ, СПбГУ, МФТИ — much of it mirrored to YouTube |
| [Лекториум](https://www.lektorium.tv/mooc), [Teach-in](https://teach-in.ru/courses) | already crawled as channels, but their own catalogues are filed by course and lecturer, which shows what the channel walk missed |

## Seam 4 — beyond the sixteen hand-picked repositories

`pnpm data:import` reads the list in `data/sources.yaml`. Two ways to stop
choosing the lists by hand:

- **GitHub code search** for `youtube.com/playlist` in Markdown across all of
  GitHub — course notes, student repositories, awesome-lists nobody has heard
  of. The API is free and the results are noisy, which by the arithmetic above
  does not matter.
- **Common Crawl or the Wayback index**, queried by domain for playlist URLs on
  `.edu`, `.ac.uk`, `.ac.in`. That is universities publishing themselves, at a
  volume no curated list reaches, for nothing.

## Seam 5 — YouTube's own graph, for one unit

`search.list` costs 100 units and is never what a crawl should reach for
([pipeline.md](pipeline.md)); [seam 8](#seam-8--asking-youtube-itself) is the
one case where it is worth it, and it is a case about the clock rather than
about the search. Two 1-unit endpoints reach sideways for nothing:

- **`channelSections.list`** returns a channel's shelves, including the channels
  its owner chose to feature. A university department featuring another
  department is a recommendation with a person behind it. 1 unit per channel,
  136 for the whole file. Caveat: YouTube has been thinning homepage shelves for
  years and many channels now return nothing — worth one unit to find out.
- **`playlists.list` on ids from anywhere.** The general point: any list of
  playlist ids, from any source on this page, is fifty-to-a-unit to turn into
  titles, sizes and owning channels. That is what makes every other seam cheap.

## Seam 6 — aiming at the holes

The seams above widen the catalogue everywhere. They will not close a specific
gap, because a gap means the fields' channels were never in the file. For that,
`pnpm stats` names the courses with no material, and the fix is hand-picked
channels put through `scripts/_vet.ts` — one unit each to check.

As of the crawl of 2026-08-12 the empty courses cluster hard: linguistics
(morphology, syntax, typology, historical and corpus linguistics), antiquity
(ancient literature, ancient art, Ancient Greek, classical philology),
musicology (music history, ethnomusicology), political science, and parts of
psychology. All humanities, all under-published by the universities the crawl is
built from — and all well covered by individual teachers, which is why the bar
above does not ask for a university.

## Seam 7 — the material already crawled and not bound

The cheapest seam of all, and the last one anybody looks at: a course can be
empty because nothing was crawled for it, or because what was crawled never
bound. The two look identical from `pnpm stats` and want opposite work.

```bash
pnpm tsx scripts/_refusals.ts                 # the counts, by reason
pnpm tsx scripts/_refusals.ts no-phrase       # and the titles in one bucket
```

`matches` records the verdict and never the reason, so ten thousand refusals
read as one problem when they are five. Sorted by the step that stopped them:

| Reason | What it means | What fixes it |
|---|---|---|
| `no-phrase` | no course keyword occurs in the title at all | a keyword, an alias — or a course the catalogue lacks |
| `below-threshold` | matched, under 0.75 | the review queue proper |
| `weak-coverage` | the subject is there but is a minority of its clause | usually a clause the segmenter should split further |
| `ambiguous` | two courses claim it equally | a human, or a tie to break |
| `not-a-course` | `NOT_A_COURSE` caught a clause | usually right |

Two lessons from working the buckets on 2026-08-14, both of which generalise:

**Cluster before reading.** Sorting refusals by video count surfaces topic bins,
because bins are enormous — «Stanford Seminars» is 1140 videos and correctly
refused. Grouping them by their longest cleaned clause instead names the
systematic gaps: eight playlists whose subject clause was «теория колец и полей»,
six «гладкие многообразия», thirteen a genitive form of a course name the
keywords only had in the nominative. One keyword each, about two hundred
playlists bound.

**A tie blocks both courses.** Two courses owning the same phrase is refused by
design — that ambiguity is what a human is for — but it is a *bug* when one of
the two simply has a redundant copy. `«climate»` sat under both `meteorology`
and `climatology`, so no climate title reached either. Find them all with:

```bash
pnpm tsx scripts/_noisy.ts        # keywords that claim clauses and never win
```

which also names the opposite failure: a phrase loose enough to mean something
else in five fields. `«survey»` under `field-archaeology` had claimed land
surveying, geological surveys, drone surveying and four surveys *of English
literature*. It never bound anything — the damage is invisible in the catalogue
and real in the review queue and in the video queue's tiers, which is quota.
Read `overrides.yaml` and not just `matches` when judging one: a hand-bound
playlist keeps whatever stale guess a pass last wrote.

## Seam 8 — asking YouTube itself

Every seam above is cheaper than this one, and this one is the only one that
finds a course nobody has ever written down.

`search.list` costs **100 units** — a hundred playlists resolved, or forty
walked. Against a full video queue that arithmetic is never close, which is why
`lib/youtube.ts` refuses the call unless a caller says `allowSearch` and why the
crawl never does. But the arithmetic inverts once a day, and predictably:

> A key resets at midnight Pacific whether or not the day used it.

At the end of an iteration — the video queue drained, `data:mine` returning
nothing, `discover` reporting `0 of N due` — the choice is not "search or
crawl". It is "search or lose it". On 2026-08-15 that was four untouched keys
and 38 000 units with nothing queued to spend them on.

```bash
pnpm tsx scripts/_hunt.ts out.json --min=4 --budget=6000     # look
pnpm tsx scripts/_hunt.ts out.json --from=out.json --apply   # queue what survived
pnpm tsx scripts/_hunt.ts out.json --min=20 --variant=all    # a whole day of it
```

**A question is asked once, ever.** Every query goes into the `searches` table
with what it returned, and a question already there is skipped before it costs
anything ([pipeline.md](pipeline.md#a-question-is-bought-once-and-the-receipt-is-in-the-database)).
That is what makes the third line above safe: `--variant=all` walks every
phrasing in `QUALIFIERS` — «лекции», «курс», «видеолекции» — first phrasing of
every course before the second phrasing of any of it, and stops when the budget,
the quota or the unasked questions run out. Before the table existed the only
guard against re-buying a previous hunt's answers was whoever ran it remembering
which courses it had covered.

**The phrasings follow the course's `stage`.** All three of those words ask for
a lecture hall, and the seven courses at `stage: school-*` are not filmed in
one: `SCHOOL_QUALIFIERS` in
[lib/questions.ts](../scripts/lib/questions.ts) asks them «для школьников»,
«школьный курс» and «уроки» first, and under the bare subject name as well as
the catalogue's — «Химия» beside «Общая химия», which is the university's word
for it. Measured against one playlist the catalogue was missing, the school
wording moved it from 21st of 50 answers to 1st, and each phrasing is another 50
answers the lecture wording never returns at all.

**The brief writes itself.** The targets are the courses with the fewest
playlists in the *built* catalogue, asked for under every name they have in
every language — which is the whole point for this catalogue, since the fields
it is thinnest in are the ones no English list covers. One page per query and no
paging: page two of a query costs the same 100 units as page one of the next
question and is worth much less.

**And what the seam can bring in is capped by the keywords.** The third filter
below refuses a candidate no course claims by title, correctly — but that makes
the rule pass the ceiling on the search pass. «Полный курс школьной химии» was
the 21st answer to a question this hunt had already paid for and was thrown away
at that filter, because `general-chemistry` knew «общая химия» and nothing else.
Teach the rules first, then spend
([data-traps.md](agents/data-traps.md#a-seams-yield-is-capped-by-the-rule-pass-not-by-the-seam)).

**Then four filters, in rising order of cost.** Search answers a *subject*, not
the question, so most of what comes back is not a course:

| Filter | Cost | What it removes |
|---|---|---|
| already in `cache.db` | free | ~15% — search happily returns what the crawl owns |
| fewer than 8 videos, or `NOT_A_COURSE` | free | fragments and support material |
| names no course of this catalogue | free | 45% — the rule pass reads only the title, so no later run decides differently |
| **who owns the videos** | 1 unit | 36% of what was left |

That last one is the one to know about, and it is [its own
section](#a-playlist-is-not-a-course-because-it-is-called-one) below.

**And channels are the better half of the yield.** 20 of the 319 lines in
`channels.yaml` came from this one hunt, two thirds of them via mirrors rather
than by being found directly — see [channel-hunt.md](channel-hunt.md).

**It saturates per course, and quickly.** A third pass over the same courses
with a different phrasing («курс» rather than «лекции», which is what
`--variant=1` is for) found 154 new playlists against the first pass's 402 —
and 478 of its 1172 candidates were things the first two waves had already
queued. Search has one first page per question; the way to get more out of it
is a different question, not a second page or a second run.

**Budget for what it refills for free.** Resolving 4079 candidates through
`playlists.list` also put 3500 playlist *descriptions* on disk, and `data:mine`
read 2796 new playlist links out of them at no cost — then 4278 more once the
crawl had walked their videos. The expensive seam pays for the cheapest one, so
run `data:mine` again before calling a hunt finished.

### A playlist is not a course because it is called one

«Linguistics», 50 videos, by a channel called *A random human*. The title names
a subject, the size is right, the rule pass binds it at 0.95 — and it is
somebody's bookmarks, collected from forty other channels. Nothing in
`playlists.list` can tell it from a course, and it arrives by the hundred the
moment anything asks YouTube a question rather than reading a curated list.

`playlistItems.list` carries the owner of each video beside the owner of the
playlist, so **one page of fifty settles it for one unit**. Three answers:

- **own material** — the channel made what it listed. A course.
- **a collection** — many owners, no author. Dropped. 611 of them on
  2026-08-15, which at ~2.3 units a walk is some 1400 units of quota and, worse,
  a catalogue full of watch lists.
- **a mirror** — one *outside* channel made almost all of it. The playlist is
  the wrong door, because the crawl would file the course under whoever
  collected it — but somebody went to the trouble of collecting a course, which
  is a recommendation with a person behind it, and **the channel that made the
  videos is the best candidate the hunt produces.** Irwin Weil's Northwestern
  lectures on Dostoevsky reached this catalogue exactly this way.

The same signal is worth having outside a hunt: any playlist bound to a course
by a channel that did not make its videos is attributed to the wrong provider.

## The order the seams come in

They are not alternatives — they are a sequence, and the sequence is the price
list above read from the cheap end.

**Seam 1** first, always: `data:mine` costs nothing and refills itself after
every crawl. Then the other free ones — **seam 2** names the channels the
catalogue keeps choosing and never crawls, and **seam 7** binds material already
on disk, which on 2026-08-14 bought about 200 bindings against nine from a whole
channel hunt. Only then the ones that cost: **seams 3 and 4** are a web page and
a fiftieth of a unit per id, **seam 6** is one unit per candidate channel, and
**seam 8** is a hundred units a query and belongs last — it is worth running
only once the queue is empty and the day's keys are not, because by then the
alternative to spending them is losing them.

Two things hold for every seam. **A new seam is not finished until the rubbish it
brings has a rule that refuses it** — and a rule change is a guess about thirty
thousand titles, so `scripts/_probe.ts` prices it against the whole catalogue
before anything is committed. And **what was refused is recorded alongside what
was added**: [channel-hunt.md](channel-hunt.md) explains why that half is the
more useful one.

The runbook that walks these in order, with the commands and what to watch for,
is [agents/iteration.md](agents/iteration.md).

# Where more material comes from

[← docs](README.md) · [channel-hunt.md](channel-hunt.md) is the record of the
first hunt; this is the catalogue of seams, spent and unspent.

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

That single number reframes the whole search. A source does not have to be
clean; it has to be *large*. Reddit threads, Notion dumps, a listicle of
questionable taste — all worth reading, because the cost of being wrong rounds
to nothing. What is genuinely expensive is walking a playlist's videos (~2.3
units each), and the tiered queue in [pipeline.md](pipeline.md) already defends
that: nothing unclaimed is crawled until everything claimed has been.

So the ranking below is by **yield per unit of effort**, not by precision.

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

## Seam 5 — YouTube's own graph, without `search.list`

`search.list` costs 100 units and is banned here ([pipeline.md](pipeline.md)).
Two 1-unit endpoints reach sideways instead:

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

## Doing a hunt

1. `pnpm data:mine` — free, always first.
2. `pnpm tsx scripts/_holes.ts` — free, tells you which channels to add.
3. Add sources to `data/sources.yaml`, then `pnpm data:import`.
4. `pnpm data:refresh` to fetch what got queued, `pnpm data:match` to bind it.
5. `pnpm stats` to see what is still empty, and go to seam 6.

Record what was refused as well as what was added — [channel-hunt.md](channel-hunt.md)
explains why that half is the more useful one.

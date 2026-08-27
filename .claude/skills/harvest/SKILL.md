---
name: harvest
description: >-
  Spend a whole day of YouTube quota on the Lectorea catalogue and leave it
  confirmed and published. Use for "прогони пайплайн", "добей лимиты",
  "сделай итерацию данных", "наполни базу курсами", or when a loop wakes up
  after the quota reset at 10:00 MSK / midnight Pacific. Covers the crawl, the
  free seams, the search hunt, the reader pass that confirms bindings, and the
  publish the nightly job depends on.
version: 1
---

# A day of the catalogue

95 000 units arrive at **midnight Pacific — 10:00 MSK** and expire at the next
one, whether or not anything used them. This skill spends them, and spends them
on material a reader has confirmed, because a binding nobody confirmed never
reaches the site.

Read [docs/agents/iteration.md](../../../docs/agents/iteration.md) for the long
form and [docs/agents/data-traps.md](../../../docs/agents/data-traps.md) before
touching keywords. This page is the loop: what to check, in what order, and when
to stop.

## Ground rules — these are not style

1. **One writer on `data/cache.db` at a time.** A crawl and a hunt at once kills
   the crawl with `SQLITE_BUSY_SNAPSHOT` and the busy timeout does not cover it.
   Reading alongside is safe and is how you watch progress — but check which
   half a tool is in, because the price of guessing is the crawl:

   | safe during a crawl (`readonly`) | a second writer — wait |
   |---|---|
   | `_refusals` `_noisy` `_winners` `_markers` `_gaps` `_holes` `_yield` | `_probe` `_hunt` `_vet` `_merge` `_review` `_sweep --write` |
   | `pnpm stats`, `data:build`, any `openDb({readonly:true})` one-liner | `make match`, `make mine`, `playlist:add`, `data:*` |

   `_probe.ts` is the surprising one: it opens a writable connection because the
   rule pass it replays writes its verdicts.
2. **The day is the Pacific one.** `quotaDateKey()`, never `date()`, never the
   local date.
3. **Nothing is written without `--apply`.** `_hunt`, `_probe`, `_merge`,
   `_vet`, `_refusals` look by default.
4. **Never commit** `data/cache.db`, `.env`, `public/data/`. Commit an explicit
   list of files — the working tree is shared with other sessions.
5. **A keyword change is a guess about 100 000 titles.** Baseline → edit →
   `_probe.ts` → read both `gained` and `lost`. No probe, no commit.
6. **The free seams run before the paid ones.** Matching is free and decides
   what the expensive video walk buys first.

## 0 · Orient — one command, free

```bash
pnpm tsx scripts/_day.ts --release
```

Read-only and safe beside anything already running. It prints the ledger and the
hours left on it, what is queued and what that would cost, how many search
questions are still unasked, how many bindings wait on a reader, whether the
release is a generation this cache does not descend from — and then names the
next move for each.

**If the release has moved, settle that before spending a unit.** `pull`
deletes the playlists a search bought here; `publish` deletes the videos the
nights walked; both do it silently. When both sides hold rows the other lacks
the answer is the union, which deletes nothing:

```bash
S=<scratch dir>
gh release download data-cache --repo fivol/lectorea --pattern cache.db.gz -D "$S" --clobber && gunzip -f "$S/cache.db.gz"
pnpm tsx scripts/_merge.ts "$S/cache.db"           # the table of what each side holds alone
pnpm tsx scripts/_merge.ts "$S/cache.db" --apply   # ~3 min, and it stamps the generation
```

The merge is a writer. Finish it before anything else starts.

## 1 · Spend — `make pipeline`, in the background

```bash
nohup make pipeline > "$S/pipeline.log" 2>&1 & echo "pid $!"
```

`import → discover → mine → match → refresh → subscribers → match → authors →
embeds → build`. It outlives the 600 s tool timeout; watch `cache.db` rather
than the log, which buffers:

```bash
pnpm exec tsx -e "import {openDb,quotaDateKey} from './scripts/lib/db.ts';const db=openDb({readonly:true});console.log(db.prepare(\"SELECT count(*) c FROM jobs WHERE status='pending' AND type='videos'\").get(),db.prepare('SELECT COALESCE(sum(spent),0) s FROM quota WHERE date=?').get(quotaDateKey()));"
```

Two lines in the log are not failures: `pagination repeats after N pages —
stopping` is the guard working, and `0 of N channels due` means the 30-day
discovery window is closed. A failed step does not stop the run; it is named at
the end and the exit code carries it.

**Do nothing else that writes while this runs.** The reading half of phase 2 is
what the wait is for; its writing half — `_probe`, `make match FORCE=1` — waits
for the pipeline to end.

## 2 · While it spends — bind what is already on disk (free)

The cheapest phase and the one most often skipped. A course is thin either
because nothing was crawled for it or because what was crawled never bound, and
the two want opposite work.

```bash
pnpm tsx scripts/_refusals.ts                 # the five buckets, by count
pnpm tsx scripts/_refusals.ts no-phrase out.json
```

Cluster by the **longest cleaned clause**, never by video count — video count
ranks topic bins to the top and real courses are 10–90 videos in the middle. A
clause that repeats across eight playlists is one keyword.

Then, for every keyword or `NOT_A_COURSE` word considered:

```bash
git stash push -- data/keywords data/aliases   # baseline if the tree is dirty
pnpm tsx scripts/_probe.ts                     # gained / lost / changed
pnpm tsx scripts/_probe.ts gained              # and read the titles
pnpm tsx scripts/_probe.ts lost
```

Also free, and each answers a different failure:

| | |
|---|---|
| `_noisy.ts 6` | keywords that claim and never win — removing them costs nothing |
| `_winners.ts` | keywords that win **wrongly**; the fix is `?` in front, which keeps the word for search and hides it from the rules |
| `_markers.ts <word>` | what a refusal word would clear, and what it would cost |
| `_gaps.ts` | is a missing course worth adding — waiting / taken / refused |
| `_holes.ts` | channels the catalogue keeps choosing and never crawls |
| `_sweep.ts` | rows no rule can reach: impossible ids, titleless deferred playlists |

Russian traps that keep coming back: the inflection tolerance is three letters
**after** the phrase, so every feminine subject in `-ия` is invisible in the
genitive — store «химии», «биологии», «математики» by hand. A level qualifier
(«школьн…», «8 класс») is **not** noise: it is the only thing telling
`school-algebra` from `abstract-algebra`.

Nothing here reaches the catalogue until:

```bash
make match FORCE=1 && make data
```

Without `--force`, a keyword change reaches nothing already bound — which is
usually the half it was written to correct. Run it after the pipeline, not
during.

## 3 · The hunt — only on quota the crawl cannot spend

`search.list` is 100 units against a video walk's 2.3, so it is worth it in
exactly one case: **units that would otherwise expire.** When phase 1 ends with
the video queue empty and the ledger still has room, that case is here.

First refill the queue for free — the seam refills *after* the crawl, not only
before it, because the crawl just put fresh descriptions on disk:

```bash
make mine && make match
```

Repeat while it returns thousands. Only when it returns little:

```bash
pnpm tsx scripts/_hunt.ts "$S/hunt.json" --kind=playlist --min=999 --variant=all --budget=<what is left> --apply
```

- **`--kind=playlist` only.** Every `--kind=channel` phrasing ever asked has
  bought **zero** bindings — it answers with ids that then cost a unit each to
  vet. Spend on it only when the playlist pool is empty *and* there is time to
  run `_vet.ts` over the answer.
- A question is asked once, ever. `N questions skipped — already bought` is the
  `searches` table doing its job, not a bug.
- Run it **alone**: it writes to `cache.db` on every call.

### Aim it at English first

The launch audience reads English, and `playlistCount` cannot see that: a course
with forty Russian recordings and none in English is full by the total and empty
to half the readers. `--lang=en` makes the brief mean **thin in English** and
asks only English questions, so a day is not half spent on the language that is
already covered:

```bash
pnpm tsx scripts/_hunt.ts "$S/hunt-en.json" --lang=en --min=8 --kind=playlist --variant=all --budget=<what is left> --apply
```

`_day.ts` prints the coverage and names the holes, and the number to watch is the
count of courses under four English recordings rather than the overall share.
Two things follow from how the catalogue is actually built:

- **English is already the larger half** — 8115 of 11 816 published playlists on
  2026-08-27, with two courses holding none (`poetics`, `classical-philology`)
  and nine under four. The work is depth on named courses, not a general tilt.
- **The English seams are different ones.** The material is on NPTEL/IIT, MIT
  OCW, Open Yale, university channels and individual teachers, and the phrasings
  that pay for it are `lectures`, `lecture series` and `full course` — the three
  that measure highest. `--lang=en` and the `en` half of `QUALIFIERS` are the two
  levers; a Russian phrasing added on a launch week is the wrong 47 200 units.

### When the pool is empty

An exhausted pool is a dimension, not a wall. The pool is
course × name × language × **phrasing** × kind, and the cheap dimension is the
phrasing: one word in `QUALIFIERS` ([scripts/lib/questions.ts](../../../scripts/lib/questions.ts))
is 472 questions and 47 200 units, so two of them are a day.

Choose it by measurement, never by ear:

```bash
pnpm tsx scripts/_yield.ts     # what every phrasing already asked has bought
```

and count how the catalogue's own confirmed titles are worded — a word that
appears in a hundred of them is a question worth 100 units, one that appears in
six is not:

```bash
pnpm exec tsx -e "import {openDb} from './scripts/lib/db.ts';const db=openDb({readonly:true});const t=db.prepare(\"SELECT p.title FROM playlists p JOIN matches m ON m.playlist_id=p.id JOIN verdicts v ON v.playlist_id=p.id AND v.verdict='ok' WHERE p.alive=1 AND m.confidence>=0.75 AND p.title IS NOT NULL\").all().map(r=>r.title.toLowerCase());for (const w of ['класс','практикум','tutorial','series']) console.log(t.filter(x=>x.includes(w)).length, w);"
```

**Yield falls with vagueness, and that is the rule for choosing.** en `lectures`
bought 19.7 bindings per 100 units, `for high school` 13.6, `lessons` 12.4,
`lecture series` 11.7, ru «лекции» 10.7, `full course` 10.1 — against the bare
`course` 3.9 and «основы» 2.7. So the word to add is a *specific, lecture-hall*
one, not the biggest untried dimension. A bare course name with no qualifier at
all is 472 unasked questions and was left out for exactly this: it is the
vaguest phrasing there is, and a vague phrasing returns the topic bin rather
than the semester. Rejected on the title count: «полный курс»,
`university course`, `online course`.

**Rehearse before handing it a day.** A phrasing is 47 200 units and the report
only prints at the end, so buy 50 questions of it first — `--budget=5000` — and
read the survivor and collection rates. The `searches` table makes the rehearsal
free of waste: the second run asks only what the first did not. A 3100-unit
rehearsal is what would have caught the 70 000-unit channel hunt that came back
unranked.

**And read the rehearsal against its own slice, not against the last run.** The
brief is sorted thinnest-course-first, so the first fifty questions of a *new*
phrasing go to `poetics`, `ethnomusicology`, `field-archaeology`, `typology` —
the courses that are thin because the material does not exist, and the hardest
fifty there are. On 2026-08-27 that read as 0.84 playlists queued per question
against the previous round's 4.12, and almost all of the gap was the slice: the
previous round's questions had been left over from a run that had already
covered the thin end. Compare like with like, or take the honest reading, which
is that a rehearsal on the thin end measures the *courses* and not the phrasing.
`_yield.ts` answers it properly the next day, out of the saved bodies, for
nothing.

## 4 · Confirm — nothing publishes on the rules' word alone

`08-build.ts` publishes a binding only when `verdicts` says `ok`, and **an
absent verdict counts as not confirmed.** A day that bound anything new ends
here or the day is invisible.

```bash
pnpm tsx scripts/_review.ts export "$S/review" --size=150
```

One batch per 150 unconfirmed bindings, plus `courses.txt`. Hand each batch to
its own subagent — they run in parallel, the concurrency cap is 20, and the
brief is [references/review-brief.md](references/review-brief.md). Give each
agent the brief path, its batch path, the course list and its output path, and
the hard constraint that it reads those two files and writes one, touching
neither the database nor git.

```bash
pnpm tsx scripts/_review.ts import "$S/review" && make data
```

`import` validates count, ids and duplicates against the batch and turns an
invented course id into a refusal rather than a dangling reference. Both guards
have fired on real runs.

**What the numbers should look like.** Roughly a quarter is refused, and the
rate tracks the *seam* rather than the rules: a faculty channel comes back at
15%, a wide search or a mined day at 30–46%. So

- a batch that returns **100% `ok` is a reason to re-read it**, not a good day;
- a mined day is about **twice** the reading per published binding — budget it.

`export` also re-asks bindings whose *course* moved since they were judged: a
verdict answers a pairing and stops applying when the pairing changes. A keyword
change therefore drags a short review round behind it, and that round is part of
the change rather than optional.

## 5 · Verify, publish, and leave the night a queue

```bash
pnpm tsx scripts/_probe.ts        # what the day's rule changes did overall
pnpm stats && open .stats/dashboard.html
make check                        # typecheck, test, data:build, i18n, build
```

Commit an explicit list of files (the tree is shared), then — and this is the
step whose absence wasted the nights of 2026-08-25 and 08-26, which crawled
**five videos between them**:

```bash
make mine                         # free: turns today's crawl into tonight's queue
pnpm cache:publish                # ~4 min; or `make publish` to deploy the site too
```

The nightly `refresh.yml` fires at **08:30 UTC**, restores the release and
crawls *that*. It has **one** key — 9500 units, about 3200 playlists — so aim
`make mine` at roughly that and treat the surplus as backlog. A day of local
crawling that was never published is invisible to it, and an empty queue makes
the night worth nothing at all.

**And it never mines** — `cache:restore → data:discover → data:refresh` is the
whole job, so the queue it walks is exactly the one you publish. Once the queue
is down to about 3200, **stop crawling**: local units buy questions and discovery,
the night's key buys nothing but a queue that already exists. Walking those
playlists yourself and refilling by mining does not work — mining halves every
round (2695 → 1326 → 685 → 343 on 2026-08-27), and that day handed the night
1000 units of work against a 9500-unit key
([pitfalls.md](../../../docs/agents/pitfalls.md#the-nights-key-was-left-with-nothing-to-spend-it-on)).

**Check the release once more, immediately before publishing.** The quota resets
at 07:00 UTC and the nightly runs at 08:30, so a run that starts at the reset and
takes three hours has the night landing *in the middle of it* — the union done in
phase 0 was of the night before last. `cache:publish` replaces the release
wholesale, so publishing over a night nobody merged is how it disappears. One
stamp and one dry-run table say whether it happened:

```bash
pnpm tsx scripts/_day.ts --release      # "this cache descends from it" or it does not
```

Then report: units spent of the budget, playlists and videos before/after,
bindings added and confirmed, refusal rate, what the rules learned, and what is
left for tomorrow.

## The stop condition

The day is done when **either** the ledger is empty **or** all three of these
hold: the video queue is empty, `make mine` returns little, and the question
pool is empty with no phrasing worth its 47 200 units. Anything else is quota
left to expire.

## Running under a loop

The skill is idempotent by design; a wake-up decides between three states.

1. **Something of mine is still running** — a crawl, a hunt, an import:
   ```bash
   pgrep -fl "tsx scripts/|data:refresh|make pipeline" | grep -v pgrep
   ```
   If anything answers, **do nothing at all**: a second writer kills the first.
   Report progress and go back to sleep.
2. **The Pacific day has not changed and today's report exists**
   (`.stats/harvest/<pacific-day>.md`) and the ledger is near empty — no-op.
3. **The Pacific day has turned, or units remain** — run from phase 0.

Write the day's report to `.stats/harvest/<pacific-day>.md` when the day ends
(`.stats/` is gitignored). It is the marker *and* the handover: what was spent,
what was learned, what the next day should start with — the template and the
reason for each row are in [references/day-report.md](references/day-report.md).

Two things a loop must never do on its own: **publish the site**
(`make publish` deploys — `pnpm cache:publish` is the cache alone and is safe),
and **push commits**. Both wait for the user to say so.

## The end-of-iteration ritual

Whatever cost effort to learn gets written down before the day is called done —
a trap into [docs/agents/data-traps.md](../../../docs/agents/data-traps.md), a
mistake into [pitfalls.md](../../../docs/agents/pitfalls.md), an adopted
approach into [practices.md](../../../docs/agents/practices.md), a refused
channel into [docs/channel-hunt.md](../../../docs/channel-hunt.md). **Record the
refusals, not only the wins:** a rejected option with its reason is worth more
than an accepted one, because it stops the next day spending itself on the same
question.

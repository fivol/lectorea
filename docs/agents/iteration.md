# Running an iteration

[← agents](README.md) · the four phases end to end, and how to work the refusals

[pipeline.md](../pipeline.md) says what the crawl does and
[harvest.md](../harvest.md) says where more material comes from. This page is the
third thing: **how to spend a day on the catalogue.** It lives here rather than
in `docs/` because nobody reads it to understand the service — it is read to do
the next piece of work. What the work keeps turning up is
[data-traps.md](data-traps.md).

---

## The iteration

Four phases. Each is worth finishing before starting the next, because each one
changes what the next should do.

### 1. Run the pipeline

```bash
make pipeline
```

`import → discover → mine → match → refresh → subscribers → match → authors → embeds → build`,
in that order for the reasons in
[scripts/README.md](../scripts/README.md#make-pipeline). It takes hours and spends
quota; start it early and do phase 2 while it runs. It outlives the 600-second
tool timeout — run it in the background and watch the queue, not the log
([workflow.md](workflow.md#what-to-run-in-the-background)).

Watch for two things while it goes:

- **`! … pagination repeats after N pages — stopping`** is fine. That is the
  guard working; see [pipeline.md](../pipeline.md#fault-tolerance).
- **A step that ends far too fast.** `discover` reporting `0 of N channels due`
  means the 30-day window is closed and the run will find nothing new — which is
  correct, and also means the crawl has no new input until phase 3 adds
  channels.

When it finishes, the video queue is usually empty. **That is the normal end,
and quota is then no longer the constraint** — there is simply nothing left to
walk. To spend more, give it more input: `make mine` refills the queue for free
from descriptions the crawl just brought in, and the seam keeps refilling for
several rounds (2315 → 1853 → 1098 → 473 on 2026-08-14; 4797 → 6758 → 3387 on
2026-08-18, on a day that started with 7127 already queued).

```bash
make mine && make refresh && make match
```

Repeat until `mine` returns little. Then `make embeds && make data`.

**When the round costs more than the day has left, stop and hunt instead.** The
two are not symmetric: a mined queue is a row in `jobs` and waits — the nightly
job walks it for nothing that today can spend — while an unspent key expires at
Pacific midnight and takes nothing with it. So the last few thousand units of a
day belong to whatever cannot be deferred, which is the hunt. On 2026-08-18 that
was the call at 21 000 units with 3387 playlists mined: crawling them would have
been the better *rate* (≈4 units a playlist against 100 a query) and the worse
*decision*, because the crawl half of it was going to happen anyway.

### 2. Bind what is already on disk, before crawling more

This is the cheapest phase and the one most often skipped. A course can be thin
because nothing was crawled for it, or because what was crawled never bound —
`pnpm stats` cannot tell the two apart, and they want opposite work.

```bash
pnpm tsx scripts/_refusals.ts
```

Sorts every refused playlist by the *step* that refused it. Then work the
buckets — the method is [below](#the-review). On 2026-08-14 this bought about
200 bindings against nine from the whole channel hunt, so **do it first.**

### 3. Hunt channels for what is still thin

Count the holes and let the empty courses write the brief —
[channel-hunt.md](../channel-hunt.md) is the record of seven hunts and
[harvest.md](../harvest.md) the catalogue of seams. **Read the refusals in
channel-hunt.md before proposing anything**: every one of them looked like a hit
in a ranked list, and re-checking one costs a unit and a judgement call.

```bash
pnpm tsx scripts/_vet.ts candidates.txt out.json
```

Never add a channel on a description alone. `_vet.ts` costs one unit and answers
the only question that matters: how many playlists of ten or more does it own,
and do their titles name subjects. Its `✓` means "there is something to look at",
not "this qualifies" — **read the titles yourself**
([data-traps.md](data-traps.md#refuse-a-channel-for-its-unit-not-for-its-size)).

Adding a channel is three files, not one:

1. `data/channels.yaml` — the entry, with a comment saying what it is *for*;
2. `data/providers.yaml` — **a matching provider, or the channel silently falls
   back to `unknown` in the build.** `resolveProvider` does not fail on a
   missing id, it substitutes;
3. then `make discover && make refresh && make match && make data`.

The check that catches step 2 when it is forgotten is one line, and it is not
optional — [practices.md](practices.md#a-channel-takes-three-files-not-one).

### 3b. And when the queue empties before the day does

The end of phase 1 is usually "the video queue is empty and quota is no longer
the constraint". Check whether that is true of the *keys* as well
([workflow.md](workflow.md#quota-is-the-scarce-resource)):

```bash
pnpm tsx scripts/_hunt.ts out.json --min=4 --budget=6000
```

An untouched key is 9500 units that expire at midnight whether or not anything
used them, and that — and only that — is when YouTube's own search at 100 units
a query is the right call. It produces two things: playlists for the thinnest
courses, and a ranked list of channels for step 3 above, most of them found
because somebody had mirrored their lectures.
[harvest.md](../harvest.md#seam-8--asking-youtube-itself) has the filters, of
which the one worth knowing is that **a third of what survives every free filter
is somebody's bookmarks**, and one unit of `playlistItems.list` says which.

Nothing is written without `--apply`, and `--from` re-reads a finished report —
so a rule the hunt teaches `lib/rules.ts` reaches the candidates the search
already paid for, without asking the same questions again. Search has one first
page per question, so the way to get more out of it is a different question:
`--variant=all` walks all three phrasings, and every question it asks is written
into the `searches` table and never asked twice, whatever a later run is pointed
at. So when the day is mostly untouched, aim it wide rather than deep —
`--min=20 --variant=all --budget=<what is left>` is one command for a whole day's
keys, and it skips whatever an earlier hunt already bought.

**And run it alone.** A hunt writes to `cache.db` on every call, and a second
writer kills the crawl with `SQLITE_BUSY_SNAPSHOT`
([pitfalls.md](pitfalls.md#two-processes-wrote-to-cachedb-and-the-crawl-was-the-one-that-died)).
When the quota is larger than the time left to spend it, the answer is a hunt
rather than a hunt *and* a crawl: 100 units a query against 2.3 a playlist means
one process spending in the expensive currency drains a day the other cannot.

### 3c. Confirm the new bindings before they publish

Nothing the rule pass accepts reaches the catalogue until a reader has confirmed
it — `08-build.ts` publishes a binding only when `verdicts` says `ok`, and an
absent verdict counts as "not confirmed"
([practices.md](practices.md#the-rules-are-the-sieve-a-reader-is-the-confirmation)).
So a run that bound anything new ends here, or the new material stays invisible.

```bash
pnpm tsx scripts/_review.ts export /tmp/review --size=150
```

That writes one batch per 150 unconfirmed bindings plus `courses.txt`, the list
every verdict is judged against. Hand each batch to a subagent — one per batch,
they run in parallel, and the concurrency cap is 20. The brief that produced the
2026-08-16 pass is in the commit; the part that matters is the *examples*, since
the three shapes a reader is there to catch (a unit of a course, a homonym, a
vendor dump) are learned from instances rather than from the definition.

```bash
pnpm tsx scripts/_review.ts import /tmp/review && make data
```

`import` validates every file against its batch before writing — count, ids,
duplicates — and turns a suggested course that does not exist into a refusal
rather than a dangling reference. Both guards fired on the first run.

**Expect a quarter of it to go.** 1204 of 5469 on the first pass, and the loss
is concentrated in whichever seams publish something other than one semester per
playlist — the table in
[data-traps.md](data-traps.md#the-rules-are-not-12-wrong--they-are-blind-to-unstructured-sources)
says which.

`export` also re-asks the bindings whose *course* has moved since they were
judged, not only the ones never judged: a verdict answers a pairing and stops
applying when the pairing changes
([practices.md](practices.md#a-judgement-is-about-a-pairing-and-it-expires-when-the-pairing-moves)).
So a keyword change or a new course produces a short review round of its own,
and that round is part of the change rather than optional.

### 3d. And when the answer is a course the catalogue does not have

A reader that keeps saying `ok` about the *nearest* course is reporting a hole,
not approving a binding. Count it before believing it:

```bash
pnpm tsx scripts/_gaps.ts                    # waiting / taken / refused per candidate
pnpm tsx scripts/_gaps.ts fluid-mechanics    # and the titles on both sides
```

Adding one is `pnpm course:new`, then the texts and keywords in both languages —
and then **the name back from whoever was standing in for it**, in
`data/aliases/*.json` as well as the keywords, or the addition just makes the
titles ambiguous ([data-traps.md](data-traps.md#and-the-tie-a-new-course-creates-is-where-the-old-one-was-standing-in)).
`_probe.ts` is what says whether it worked; the row to watch is `- потеряет
привязку`, which should be small and boring.

### 4. Verify, then publish

```bash
make check
```

Typecheck, tests, `data:build`, i18n, build — CI's own order. Then commit —
**explicitly listed files**, because the working tree is shared with concurrent
sessions ([pitfalls.md](pitfalls.md#the-git-index-is-shared-with-other-sessions))
— and [`make publish`](../scripts/README.md) when the working copy is what `main`
would build.

Before calling the iteration done, run the end-of-iteration ritual in
[README.md](README.md#the-end-of-iteration-ritual). It is part of the work.

---

## When somebody sends a link

A playlist arrives — an issue, a message, a recommendation — and it is not in
the catalogue. **Two things happen, and the second one is the work.**

The playlist itself is one unit and one line:

```bash
pnpm playlist:add "<link>" --course=<id>
```

Then the real question: *why had nothing here reached it?* Whatever the answer
is, it is holding back everything shaped like it, and the next link will be the
same conversation ([practices.md](practices.md#a-link-that-arrives-is-a-sample-of-a-class-and-the-class-is-the-work)).

```bash
pnpm tsx scripts/_reachable.ts "<link>" --course=<id>          # free
pnpm tsx scripts/_reachable.ts "<link>" --course=<id> --ask    # 100 units a question
```

It walks the four gates in price order and prints where the playlist stood at
each. They fail in ways that look identical from `cache.db` — which holds
neither "never found" nor "found and dropped" — and they are fixed in four
different files:

| Gate | What the output says | Where the fix lives |
|---|---|---|
| **Discovery** | no row in `playlists` | `data/channels.yaml`, `data/sources.yaml`, or the questions below |
| **The questions** | none of them returns it under `--ask` | `scripts/lib/questions.ts` — a phrasing, or the names a course is asked under |
| **The rules** | `unclaimed` / `undecided` / under 0.75 | `data/keywords/*.json`, `data/aliases/*.json` — and this is the gate the hunt applies before it queues anything, so an unclaimed title is *found and discarded* |
| **The reader** | a `not-a-course` verdict | usually right; check it is |

**Then fix the class, not the link**, and prove it with the numbers the rest of
this page already asks for:

```bash
pnpm tsx scripts/_probe.ts && pnpm tsx scripts/_probe.ts lost
make match FORCE=1 && make data
```

and a review round for whatever the change newly bound
([3c above](#3c-confirm-the-new-bindings-before-they-publish)) — a keyword change
is not finished until the reader has confirmed what it dragged in.

### The worked example, 2026-08-19

«Полный курс школьной химии» — 13 lectures, 290 000 views, a channel of twenty
videos. Every guess about why it was missing was wrong:

- it was **not** undiscovered: it is the 21st of the 50 answers to «Общая химия
  лекции», which the hunt had asked and paid for a fortnight earlier;
- it was **not** below a threshold: 13 videos clears `MIN_VIDEOS`, and nothing
  in `NOT_A_COURSE` touches it;
- it was `unclaimed`. `general-chemistry` knew «общая химия» and the title says
  «школьной химии» — a level qualifier the keywords had never heard of, over a
  genitive the inflection tolerance cannot reach.

The class was **every school-level subject**: seven courses at `stage: school-*`,
of which one had school vocabulary and six did not. Closing it took two lists
read off `stage` — `SCHOOL_FORMS` in `lib/rules.ts`, `SCHOOL_QUALIFIERS` in
`lib/questions.ts` — seven genitives in `data/keywords/ru.json`, and one
ordering fix so a hand-added playlist can buy its own title
([data-traps.md](data-traps.md#a-playlist-added-by-hand-waits-behind-everything-the-crawl-mined)).
`_probe.ts`: **+56, −2**. The link was the smallest part of it.

The channel itself was refused, and that is the ordinary answer for a channel
somebody links from: five playlists, one of them a course
([channel-hunt.md](../channel-hunt.md#what-was-refused)). `playlist:add` is what
a good playlist on a thin channel is for.

---

## The review

`_refusals.ts` puts every refusal into one of five buckets, and each wants a
different fix:

| Bucket | Means | Fix |
|---|---|---|
| `no-phrase` | no course keyword occurs at all | a keyword or alias — or a course the catalogue lacks |
| `below-threshold` | matched, under 0.75 | `data:review`, or a longer keyword |
| `weak-coverage` | subject present but a minority of its clause | usually a clause the segmenter should split |
| `ambiguous` | two courses claim it equally | a human, or a tie to break |
| `not-a-course` | `NOT_A_COURSE` caught a clause | usually right; check it is |

Two of those five are **recorded decisions** rather than open questions, and
`data:review` no longer shows them: `not-a-course`, and the half of `no-phrase`
where no course keyword occurs at all
([matching.md](../scripts/matching.md#a-refusal-is-an-answer-and-is-written-down)).
That is what makes the queue readable — 35 148 waiting on 2026-08-15, of which
24 808 named no course of this catalogue in any language. `_refusals.ts` still
sees all of it, which is why the cluster work below is unaffected; and
`make match FORCE=1` re-reads every refusal, which is why a keyword you add
still reaches them.

### Cluster before you read

**Do not sort refusals by video count.** That ranks topic bins to the top,
because bins are enormous — «Stanford Seminars» is 1140 videos and correctly
refused, and the first two screens will be nothing but bins. Real courses are
10–90 videos and sit in the middle.

Group by the longest cleaned clause instead. Repeated clauses are the systematic
gaps and each one is a single keyword:

```bash
pnpm tsx scripts/_refusals.ts no-phrase out.json
```

then count the longest segment of each entry. Eight playlists whose subject
clause was «теория колец и полей», six «гладкие многообразия», thirteen a
genitive of a name the keywords only had in the nominative — one keyword each,
about two hundred playlists.

### Always probe before you commit

```bash
pnpm tsx scripts/_probe.ts          # gained / lost / changed, over the whole catalogue
pnpm tsx scripts/_probe.ts gained   # and the titles
pnpm tsx scripts/_probe.ts lost
```

A keyword is a guess about thirty thousand titles, and reading the `gained` list
is how you find out what it really dragged in. Three of the keywords added on
2026-08-14 were reverted this way. **Read `lost` too** — a change can take a
binding away, which is sometimes the point and sometimes the bug.

The same applies to a `NOT_A_COURSE` addition: the exam-coaching brands added on
2026-08-15 cost exactly two existing bindings, and knowing that was the whole
reason it was safe to commit them.

Take a baseline if the working tree already has edits in it, or the probe
reports your change plus everything else:

```bash
git stash push -- data/keywords && pnpm tsx scripts/_probe.ts; git stash pop
```

### Then make it reach the catalogue

```bash
make match FORCE=1 && make data
```

Without `--force`, `data:match` never revisits a playlist it already bound
confidently — so **a keyword change reaches nothing already in the catalogue**,
which is usually the half the change was written to correct.

### What a hand decision is for

`data:review` (or `pnpm playlist:add <id> --course=<id>`) writes
`data/overrides.yaml`, which is committed and outranks every pass. Use it when
the answer is right but unreachable by rule — one playlist whose title happens
to be ambiguous — and *not* to paper over a keyword gap that would fix thirty
playlists at once.

---

## Working with subagents

Parallel searches are worth it — five topic hunts covered twenty courses in one
pass. Two rules, both learned on 2026-08-14:

**Verify every claim against the database.** One agent reported a candidate
channel as a duplicate of an already-crawled one; it was not, and taking its word
would have cost 75 course playlists. One query settles it:

```bash
pnpm exec tsx -e "
import { openDb } from './scripts/lib/db.ts';
console.log(openDb({ readonly: true })
  .prepare('SELECT count(*) c FROM playlists WHERE channel_id = ?').get('UC…'));
"
```

**Give them the refusals, not just the brief.**
[channel-hunt.md](../channel-hunt.md) records what was refused and why precisely
so the next hunt does not spend a day rediscovering Gresham College. An agent
that has not read it will propose Smarthistory, ICTS and TutorialsPoint again.

---

## The tools, in one place

| Command | Cost | What it answers |
|---|---|---|
| `_refusals.ts [bucket] [out.json]` | free | why were these playlists refused |
| `_gaps.ts [course-id]` | free | is a course worth adding — what waits for it, and what it would take from its neighbours |
| `_noisy.ts [min]` | free | which keywords claim and never win |
| `_probe.ts [gained\|lost\|changed]` | free | what would a rule change do to the whole catalogue |
| `_reachable.ts <link> [--course] [--meta] [--ask]` | free / 1 unit / 100 a question | would this catalogue ever have found this playlist by itself, and at which of the four gates it stopped |
| `_holes.ts [min]` | free | which channels does the catalogue keep choosing but never crawl |
| `_vet.ts in.txt out.json` | 1 unit/channel | does this candidate own courses |
| `_hunt.ts out.json [--min\|--courses] [--variant=all] [--apply]` | 100 units/query | what does YouTube itself have for the thinnest courses — and whose channel is it really. Never asks a question the `searches` table already holds |
| `_owners.ts mined.json out.json` | 1 unit/50 ids | which channels are behind a set of playlist ids |
| `_found.ts [--apply]` | free | when was each playlist and video first seen, reconstructed from the saved API bodies. Run once per machine |
| `_sweep.ts [--write]` | free | rows no rule can ever reach: impossible ids, playlists deferred with no title |
| `_winners.ts` | free | which keyword won each confident binding, and what it dragged in |
| `_markers.ts [word]` | free | how much of the queue a refusal word would clear, and how much of the catalogue it would cost |
| `_columns.ts [worst]` | free | what a drawing option on the columns screen costs over all 197 chains — replays every screen headlessly |

None are wired into `pnpm`: they are read once or twice a year and the useful
half of the work is the judgement, not the script. Reach for them in price
order — the free ones first, and `_hunt.ts` only on untouched keys.

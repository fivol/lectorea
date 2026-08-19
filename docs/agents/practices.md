# Adopted practices

[← agents](README.md)

Not code style — ways of solving **classes** of problem that have been tried
here. Each one is named together with the case it came from, so it is visible
what it is for and when it does not apply.

---

## A rule that has to hold becomes code

«Never call `search.list`» lived as a comment in `lib/youtube.ts`, and a comment
cannot stop anything. Now the method does not exist until the caller says
`createClient(db, { allowSearch: true })`: a pipeline step that reaches for it by
inattention fails on the first call instead of turning up in tomorrow's ledger.

**Generally:** when breaking a rule is expensive and invisible, the rule should
be unavailable by default rather than described. A good sign is a rule written
with the word "never".

## Expensive discovery has to be resumable

Search is the only expensive half of a hunt; judging what it found is free.
`_hunt.ts --from=report.json` re-reads a finished report and **re-judges** it
against the current rules, asking nothing again. That matters because the rules
get written *after* the hunt shows what a seam drags in: a rule written half an
hour after the search has to reach the candidates the search already paid for.

**Generally:** separate "what cost money" from "what we think about it", and be
able to replay the second over a saved first. Asking the same question twice is
the one thing quota must never buy.

## A question that cost money is written down before its answer is judged

`--from` made a hunt's *answers* replayable; it did nothing about asking the same
question twice, because a second run with the same brief is a different process
with an empty memory. The only guard was the person running it passing
`--variant=1` because they remembered what the last one covered — which lasted
exactly as long as the memory did.

The `searches` table is the fix and the shape is general: **one row per paid
question, keyed by the question and not by what it was asked for.** `_hunt.ts`
now drops any query already in it before spending a unit, so two hunts a month
apart divide the catalogue between them instead of overlapping on it, and
`--variant=all` can walk every phrasing until the day's quota is gone. The row is
written on the answer rather than on the charge: a query billed and then failed
leaves nothing behind, because a question nobody holds the answer to is worth
asking again.

It is merged and never replaced on a restore, for the reason `verdicts` and
`ownership` are — the shape to copy for the next table like it is a single-column
key plus a `checked_at`
([pitfalls.md](pitfalls.md#a-restore-was-read-as-take-what-is-newer-and-it-is-replace-what-is-there)).

**Generally:** if an answer is worth caching, the *question* is worth recording
separately — they expire on different clocks, and only one of them is what the
money bought.

## Nothing is written without `--apply`

The scratch scripts (`_hunt`, `_vet`, `_probe`, `_refusals`) look and print by
default. Writing is a separate explicit flag. That is what makes it possible to
run an expensive step, read the result unhurriedly and decide — rather than
discover the decision already taken.

## A rule change is probed against the whole catalogue

`_probe.ts` shows what an edit to the rules would do to all ~38 000 live
playlists: what binds for the first time, what loses its binding, which courses
stop being empty. A keyword is a guess about thirty thousand titles and cannot be
committed unverified.

Proven on the exam-coaching brands added to `NOT_A_COURSE`: the probe showed a
loss of exactly two bindings, both correct refusals. Without it that would have
been an assumption.

## Filters go in rising order of price

In the hunt: already in the cache (free) → too short or not-a-course (free) →
names no course of this catalogue (free) → **who owns the videos** (1 unit). The
paid filter runs last and only on what is left — 1 unit × 2611 rather than
× 4079.

**Generally:** the order of filters is a budget, not a matter of taste. An
expensive filter placed first pays for what a free one would have removed for
nothing.

## A refusal is a finding, and gets written down

[channel-hunt.md](../channel-hunt.md) keeps the list of **refused** channels with
reasons, and across four hunts that half has been the more useful one: each of
them looks like a hit in a ranked list, and re-checking one costs a unit and a
judgement call. The same in code: `matches` stores the verdict "not a course" as
a decision, so nothing pays for it again on the next run.

## Collect what an expensive step refills for free

Resolving candidates through `playlists.list` also put 3500 playlist descriptions
on disk, out of which the free `data:mine` read 2796 new links — and 4278 more
once their videos had been walked. An expensive step often pays for a free one;
check whether new material has appeared for the cheap seams before calling the
step finished.

## A failed step does not cancel the rest of the day

`make pipeline` does not stop on a failed step: it remembers it, names it at the
end and exits non-zero. The reason is the shape of the order — the expensive
steps in the middle, and the free ones that publish the day's work at the end. To
stop at step six is to throw away five that were already paid for.

**For an agent:** in a long sequence, first finish everything that does not
depend on what failed, and only then report — but **report the failure
explicitly** rather than continuing quietly.

## A row that is upserted needs a column that says when it arrived

Everything the crawl stores is written more than once — a playlist is
re-discovered monthly, a video list is deleted and rewritten on every walk — so
every timestamp in `cache.db` had come to mean *last touched*. Nothing could
answer «what did today find», and the shape of the failure is that nothing looks
broken: `checked_at` is a real date, it moves every night, and a chart drawn
from it is a chart of the crawl re-reading itself.

`found_at` is one nullable column per growing table, written by the insert and
absent from every `ON CONFLICT` clause. Three rules make it mean what it says:

1. **Never in the update clause.** The day the crawl met a row again is not the
   day it found it.
2. **Carried across a delete-and-reinsert.** The video pass drops a playlist's
   whole list before writing the new one; without reading the old stamps back
   first, a refresh of 800 lectures reports 800 discoveries.
3. **Null stays null.** A row from before the column is *unknown*, not "found on
   the day the column was added" — and anything counting by day leaves nulls
   out rather than drawing them as a zero, which would be a claim.

**Generally:** when a table is upserted, "when did this arrive" is a different
question from "when was this last written", and only the second one answers
itself. The column costs one `ALTER TABLE` and is unrecoverable later —
`_found.ts` only exists because `raw_responses` happened to still hold the
receipts.

## What a paid answer still holds, a later question can be asked of

The history above was recoverable at all because every API body is kept with the
time it arrived: the first body that mentions a playlist is the day it was
found, whatever the row now says. That made an eight-day chart possible on the
day the column was added, instead of one that starts empty.

Two details are worth copying, both about **not paying for the reconstruction**.
The keys of `raw_responses` are indexed and the bodies are not: asking only for
`(endpoint, request_key)` is answered out of `idx_raw_key` and never touches the
18 GB beside it, which is why the video pass reads 108 000 request keys in
seconds. And `fetched_at` *is* behind the bodies — so the day each row belongs
to is binary-searched by rowid instead, which is exact because the table is only
ever appended to.

**Generally:** a cache kept "so a parser fix costs nothing" answers questions
nobody had when it was written. Before concluding that history is lost, ask what
was written down at the time — and reach for it through an index rather than a
scan.

## A channel takes three files, not one

1. `data/channels.yaml` — the entry, with a comment saying **what it is for**;
2. `data/providers.yaml` — the matching provider, or `resolveProvider` silently
   substitutes `unknown` and the attribution is lost without a single message;
3. `make discover && make refresh && make match && make data`.

The check after editing is one line, and it is not optional:

```bash
pnpm exec tsx -e "import {loadSources} from './scripts/lib/sources.ts'; const s=loadSources(); const ids=new Set(s.providers.map(p=>p.id)); console.log(s.channels.filter(c=>!ids.has(c.providerId)).map(c=>c.id))"
```

**Generally:** where code substitutes a default instead of failing, the failure
will not surface on its own — whoever edits the data writes the check.

## Two questions about a title need two texts

`NOT_A_COURSE` reads the title as written while the keyword pass reads it with
the noise stripped, because `NOISE` removes the very words by which a title
announces it is not a course. On 2026-08-16 the same split answered a second
question.

`DEPARTMENT` drops a clause that is a faculty label — «Computer Science -
Riemann Hypothesis» is a filing prefix, and nine subjects were published under
`programming-intro` because of it. But adding `computer science` to that set on
the cleaned text also deletes CS50 and Princeton COS 126: `NOISE` takes
«Introduction to» out first, and the flagship course's own title *collapses into
the label*. Asked of `rawSegments` instead, the two are distinguishable — and
one more condition, that the label be the **first** clause, keeps «Crash Course:
Computer Science» as well, because a mirror files in front and never behind.

**Generally:** when a normalisation exists to answer one question, any second
question asked of its output has inherited an answer it did not ask for. Check
whether the raw text still distinguishes the cases — and if the rule is about
where a thing sits, say so, rather than about the word alone.

## Ask the expensive question of what is already published, not only of what is new

The ownership probe — `playlistItems.list`, 1 unit, who made the videos — was
written for `_hunt.ts` to filter candidates. Everything bound before it existed
was decided on a title, which is precisely what cannot see a bag of bookmarks.
`data:authors` points the same unit at the live catalogue and found 17 published
collections, among them «Filme» (the films, under film studies) and 752 videos
under one CMU course code.

It also produced the number that justifies the crawl's ordering: **92% of
published bindings own their material, against 5% of search candidates.**

**Generally:** a test written to filter an intake is a test the existing stock
has never been through. When it is cheap and the stock is older than the test,
run it backwards over what is already live — and put the free filters first
(settled by hand, on a vetted channel) so the paid one runs on the remainder:
682 probes rather than 1308.

## Sum the rows; do not infer the whole — and the label is part of the sum

The heading over a run of parts prints **Части одного курса · 78 ч**. Every word
of it was arrived at by asking one question of each piece: *what is this a fact
about?*

The hours are a fact about the rows drawn under the line, so they are printed.
The count of parts is a fact about somebody else's course, taken off the largest
number parsed out of their titles, so a run of `s3, s4` announced four parts
above two rows — it is not printed. A figure summed from what is on screen stays
true when the crawl finds one more part; a figure inferred about the thing the
rows came from is a guess that grows more confident as it grows more wrong.

**The trap is that the label gets audited last, and it carries a claim too.**
The heading first read «Один курс · 78 ч», with an honest number, and was still
wrong: 24% of the 149 runs visibly start at part three, skip a part, or hold one
marked «фрагмент», and the remaining 76% are not *proved* whole either — they
are runs with no hole anybody can see, and a semester that was read and never
filmed leaves nothing to find. The number was measured over the rows; the two
words in front of it were measured over the course, and the reader adds them
together before noticing.

The fix that was **rejected** was two headings, one for the complete-looking
runs and one for the rest. It moves the false claim rather than removing it: the
76% would then be asserting completeness on the strength of us not having
spotted a gap. One modest wording covering every run is what survives — these
rows belong to one course, and together they run this long.

**Generally:** before printing a derived number, say what it is a fact about —
and then ask the same of the words beside it. A caption that outruns its number
is the easier mistake, because it costs nothing to write and reads as
description rather than as a claim. When a distinction cannot be *proved* from
the data, do not encode it in wording either; say the weaker thing once.

Rejected alongside it: putting the lecture count on the same line. Every row
already carries its own «14 лекций», so the group total is a second running sum
the eye has to reconcile against them, and unlike the hours it *is* recoverable
at a glance.

## The rules are the sieve; a reader is the confirmation

Nothing reaches the catalogue on the rule pass's word alone. `lib/rules.ts`
decides from a title and publishes about 13% of the 41 000 candidates; a reader
then judges each of those, and `08-build.ts` publishes only what the reader
confirmed. The verdict lives in the `verdicts` table — `ok`, `wrong-course`
(which republishes under the course the reader named), `not-a-course`, `unsure`
— and **an absent verdict means "not confirmed", never "fine"**.

The first full pass, 2026-08-16, read all 5469 published bindings in 37 batches
of 150: **4148 ok, 1204 not a course, 101 rebound, 16 unsure.** 24% wrong, twice
what a hand-read sample of 120 had estimated.

2026-08-18 read the 2815 bindings a day of crawling had added, in 19 batches:
**2025 ok, 686 not a course, 39 rebound, 65 unsure** — 28% refused, and the
third round in a row to land in the 24–28% band. That the rate is *stable across
seams and rounds* is the useful part: it makes a batch that comes back 100% `ok`
a reason to re-read the batch rather than a good day.

**Why a reader rather than more rules.** The three dominant errors are all
legible in the title and none is reachable by a keyword: a *unit* of a course
published as a playlist (99 Khan Academy chemistry units in one batch alone), a
title whose subject is a homonym of another course's («Genesis» → genetics,
«The Greeks» → the Greek *language*, «Learning with Conditional Guarantees» →
learning sciences), and a vendor dump or event archive wearing a subject name.
The complement holds too: a bag of bookmarks is *invisible* in the title, which
is why ownership stays a paid API question ([above](#ask-the-expensive-question-of-what-is-already-published-not-only-of-what-is-new))
and not a reading task.

**Generally:** where a cheap rule has good recall and poor precision, keep it as
the sieve and put the judgement after it — but make the gate say out loud what
silence means, or "not looked at yet" quietly becomes "approved".

## A judgement is about a pairing, and it expires when the pairing moves

A reader was shown «Fluid Mechanics» filed under transport phenomena and said
`ok`. That is not an opinion about the playlist; it is an answer to one
question. Add a fluid mechanics course, let `data:match --force` move the
binding, and the old yes silently becomes a confirmation of a pairing nobody
ever saw — **precisely on the rows a rule change touched, which are the ones
worth looking at.**

So `verdicts` carries `course_id`, the binding that was judged, and
`resolveCourses` treats a verdict stamped with a different course as no verdict:
back out of the catalogue, back into the queue `_review.ts export` reads. The 18
courses added on 2026-08-17 sent 393 bindings back through that door — most of
them new, the rest drifted — and the round came back **282 ok, 106 not a course,
3 rebound, 2 unsure**. 27% refused, in line with the 24% of the first pass, and
the refusals are the shape the new courses attract: GATE and ICAI exam-prep
batches wearing an engineering or accounting subject name, and semesters of
three to five uploaded videos.

**Generally:** when an expensive answer is stored, store *what was asked*
alongside it. An answer keyed only by its subject outlives the question, and the
failure is invisible — the row still says `ok`.

## An answer that cost a unit does not live in a row the next pass rewrites

`14-authors.ts` spends one unit deciding that a playlist is somebody's bookmarks
and writes the refusal into `matches`. Every refusal in `matches` is deliberately
reversible, and `data:match --force` re-reads all of them — so a keyword change
republishes collections that were each paid for, and nothing in either step
knows the other happened.

The fix is not to make the refusal sticky. It is that **the row is the wrong
place**: the evidence is in `ownership`, it does not expire, and `08-build.ts`
now reads `kind = 'collection'` directly and refuses there. The two steps stop
being ordered, `--force` becomes free of consequences again, and the unit is
never re-bought. The same move fixed the mirrors: `kind = 'mirror'` is read in
the build to file the playlist under whoever *made* the videos, instead of an
`overrides.channels` entry per playlist that somebody has to notice and write —
and an override keyed by channel could not have expressed it anyway, since the
same re-uploader also posts material of its own.

**Generally:** a derived judgement belongs in the table that holds its evidence,
and the consumer reads it. Copying it into a mutable working row makes the
answer depend on the order two steps ran in, which is the kind of bug that only
shows up months later as a number that drifted.

## A missing course is counted before it is added

The 2026-08-16 reading kept answering `ok` with a shrug: «Fluid Mechanics» under
transport phenomena, «Аналитическая геометрия» under linear algebra,
«Гомологическая алгебра» under category theory. Those are not matching mistakes
— they are the catalogue being asked for a course it does not have and answering
with the nearest one.

A hole is easy to feel and easy to imagine, so `_gaps.ts` counts it. Each
candidate gets three numbers: **waiting** (playlists naming it that nothing
holds), **taken** (playlists already published under some other course, listed
by which) and **refused** (ones a reader has already thrown out, never added
in). `taken` concentrated in one course is the nearest-fit answer at scale and
the strongest case there is — `fluid-mechanics` was 50 waiting and 17 taken, all
17 from `transport-phenomena`.

Two readings that saved courses from being added on volume alone:

- **`waiting` is not evidence if the material is not coursework.** `cloud-computing`
  showed 53 and was Kubernetes tutorials and CKA exam prep; `web-development`
  showed 40 and was bootcamps. Both refused. The phrase names an industry skill,
  not a curriculum subject, and the reader would have thrown the lot out.
- **A semester is not a subject.** «Physics II» had 32 waiting and two readers
  flagging it independently, and was still refused: what Physics II covers
  depends on the university, and this catalogue's unit is the subject.

**Generally:** before adding a category to a taxonomy, measure what would move
into it and what it would take from its neighbours. Adding on the strength of a
felt gap is how a taxonomy grows entries nothing ever lands in.

## A batch handed to a reader is checked before it is trusted

Every verdict file is validated against its batch before import: same count,
same ids, no duplicates, and a suggested course that is actually a course. The
check earns its keep immediately — one agent's prose reported 151 verdicts for a
150-row batch while the file it wrote was correct, and another proposed a course
id the catalogue does not have. Both would have been silent corruption.

`_review.ts import` turns an unknown course id into `not-a-course` rather than
storing it: a binding to a course that does not exist is not a suggestion, it is
a dangling reference.

**Generally:** a reader that returns structured data is a source like any other.
Reconcile it against what you sent, and never let a free-text field become a key
without checking it resolves.

## A third party is asked what it can do, on a page built to ask it

The speed control needed to know two things about the YouTube embed, and
neither is in its documentation in a form worth believing: which rates it
accepts, and what it does with one it does not. Twenty lines of `postMessage`
in a throwaway page under `public/` answered both in five minutes —
`availablePlaybackRates` is `[0.25 … 2]`, and `setPlaybackRate(3)` **is not
refused**: the player answers with a frame reporting 2. A control built on the
assumption that asking for 3× fails loudly would have shipped a button that
quietly does something else.

The probe is worth more than reading about the API because it also settles the
shape of the answers — which event carries the rate, whether it repeats — and
those are what the code has to be written against. It is deleted before the
commit; what it found goes into the comments, and the list it read goes into
the code as the source of the buttons rather than as a constant.

**Generally:** when a third party's limit decides what an interface may offer,
measure the limit before drawing the interface, and then let the interface be
built from what the thing reports rather than from what was measured. A tool
that silently rounds is worse than one that errors, and only a probe tells the
two apart.

**And measure the stream, not only the answers.** The probe above asked what the
player *can* do and got a straight reply. What it never asked was what the
player *keeps saying* — and the answer, found a day too late, is that its frames
are partial updates: `duration` is absent from every periodic one, so a rule
comparing it against `currentTime` was reading `n / undefined` for the whole
second half of every lecture
([pitfalls](pitfalls.md#a-field-was-read-off-whichever-frame-happened-to-arrive)).
A running tally of which keys each frame carries is ten lines and settles it.

## A «характеристика · значение» list is a shape that was never chosen

The metadata sheet in the player was eight of them in a column: лекций 26,
длительность 3.7 ч, тип «Разная длина», просмотры 770,1 тыс. Nobody designed
that — it is what a `Record<label, value>` looks like when it is printed in the
order it was declared, and the reader pays for it by scanning eight lines to
find the one number they opened the sheet for.

The fix was not to restyle the lines but to ask, of each one, **what kind of
fact it is**: a count, a category, or a number that means nothing without a
comparison. Three shapes, three components, in
[design-system.md](../design-system.md#three-shapes-for-a-fact).

**Generally:** when a block reads as technical, look at whether its shape was
decided or inherited from the data structure behind it. Facts of different kinds
laid out identically is the usual reason a screen feels like a database dump,
and no amount of typography fixes it — the layout has to stop treating a word
and a view count as the same thing.

## Take the keyboard back, and hand every key back with it

A cross-origin iframe that has been clicked owns the keyboard: the page it sits
in receives no `keydown` at all, so the speed control worked until the reader
touched the video and then stopped, with nothing in the console to show for it.
The fix is two halves, and one half alone is worse than neither. Focus is
returned to the dialog the moment it crosses into the frame — and because that
takes YouTube's own shortcuts away with it, every one of them is given back
through the command channel: pause, ∓5 and ∓10 seconds, fullscreen, speed.

The same move then makes the app's own shortcuts dangerous, because they now
always arrive: `m` swaps map and columns and sits one key from the `k` and `l`
the player answers. So a layer that owns the keyboard says so (`keyboardHeld`),
and the global letters stand down while it is up.

**Generally:** when something on the page can take an input channel away from
you, taking it back is a three-part job — take it, replace everything it was
answering, and re-check what your own handlers now receive that they never used
to. A partial version of this is a regression wearing a feature's clothes.

## A colour named against one surface is wrong on every other surface

Three separate complaints about the front-page card — invisible tile borders, an
ugly hover, captions that could not be read — were one bug. `border-line`,
`--c-surface-2` and `--c-ink-faint` are all measured against `--c-surface`, and
that card is a plate cut from the land, floating over the sea. Each token was
correct where it was chosen and wrong where the component actually stood.

The fix is not a fourth token but a **mix**: `.inlay`, `.inlay-hover` and
`.ink-soft` are shares of `--c-ink`, so they follow whatever palette is in force
— including the map's, which restates the inks for the light theme without
telling anybody. See
[design-system.md](../design-system.md#derived-where-a-named-colour-cannot-follow).

**Generally:** before reaching for a palette name, ask what this element will be
standing on — one surface, or several. A component that travels takes a derived
colour; a component that lives in one place may name one. And when a reader
reports two or three ugly things in the same corner of the screen, look for the
single assumption underneath before fixing them one at a time.

## A pointer answers with what is drawn; only a selection draws something new

The course panel names neighbours from wherever they are filed, and hovering one
lifts its card in the columns. Under a field filter «Открывает путь к» almost
never has a card to lift — what a course opens is usually somebody else's
subject — so the echo lands on nothing.

The first answer made the **echo the canvas's claim**: whatever the panel
pointed at got a seat for as long as it was pointed at. It fixed every list in
the panel at the joint rather than one at a time, which is why it was taken over
the narrow fix — and it was withdrawn, because a pointer crossing eight names
then inserted and removed eight cards, shuffled the column under each of them
and stuttered 60–115 ms a time
([pitfalls.md](pitfalls.md#a-pointer-was-given-the-power-to-lay-the-page-out)).
What stands now is the honest limit: a name whose card is not on the canvas
lights nothing, and the click that selects it brings the course in with the
whole chain behind it, in one move.

**Generally:** «fix it at the joint, for every sender at once» is still the right
instinct — but what the receiving view owes a pointer is *paint*, and layout is
the selection's to spend. A fix at the joint that turns out to be a layout
change is the wrong fix in the right place.

The signal still carries both ends. `echo` is `{ id, from }` rather than an
id, because a name in a panel *is* one end of a relation and the panel it stands
in is the other — with both, pointing can be answered with the edge itself and
not only with the card lighting up, which is what «наведи и проведи связь» asked
for. A signal that carries only what the sender was looking at can answer «which
one»; one that carries the relation can answer «why».

That is also why the edge is skipped outright when either end is off the canvas
rather than left to the router to drop after it has measured: a check the caller
can make from a set it already holds costs nothing, and the same answer arrived
at by measuring costs a pass over every card on screen, on every name the
pointer crosses.

The same reading settled the forward curves, which went at the same time. They
could only ever be drawn to the descendants the filter happened to keep, while
the prerequisites behind a course are borrowed in whole — so one half of the
picture was complete and the other half looked it. Now the relation is drawn
when the course is opened, from the end where it is a prerequisite.

**Generally:** when one view signals another, ask what the *receiving* view owes
everything that points into it, not whether this particular sender has its cards
— fixed at the joint, one class of list stops needing its own version. And a
drawing that can only cover what survived a filter is worse than none: it
answers with a subset and does not say that it is one.

## Measurement is keyed to the layout, not to what is drawn

`ChainLinks` walks every card on the canvas for its offsets and then routes the
curves through what it found. Both halves used to run together, on any change of
`links` — and `links` changes on a *pointer*, because a name in the panel draws
its edge while it is pointed at. So hovering a name re-read the position of 225
cards that had not moved a pixel: an 80–96 ms task for a curve that arithmetic
over the previous measurement would have produced.

Now the geometry is state of its own, re-read when the columns may have moved —
the arrangement, a resize of the scroller, a resize of the window — and drawing
a different set of curves over the same cards is a `useMemo` over a map already
in hand. The revision it is keyed to is the same string the shuffle animates on
(`arrangement` in `ColumnsView`): everything on the canvas, in the order it
stands in, which is the definition of "the layout may have changed" and was
already being computed. Counting columns and cards, which is what it used to be,
misses a card that merely changed places — harmless only while every change of
what is drawn re-measured anyway.

**Generally:** when a step reads the world and a step decides what to show, they
answer to different events; keying both to the noisier one pays the price of the
expensive half at the rate of the cheap one. And when a cache like this is
introduced, the key has to be tightened at the same time — the sloppy key was
being covered by the very re-measuring that is going away.

## A derived number carries the rule that produced it, at every place it is printed

«Примерная длительность курса в часах» was a caption that named the number and
said nothing about it. The number is a **median** over the recordings of a
course, and a reader who assumes a sum — the obvious assumption, since a course
is a list of playlists — reads «≈33 ч» as a tenth of what they think it is. Same
for «осталось ≈43 ч»: it drops the courses marked done and counts the one in
hand whole, so it can sit unmoved for a fortnight above a bar that is visibly
filling.

The fix is not one better caption. Each figure gets **one** sentence stating the
rule, kept in `ui.legend.*`, and that same key is attached everywhere the figure
appears — the chip on the panel, the path line, the profile. Two facts never
share a key, however alike the words: «осталось» over a path is the catalogue's
estimate for what is unticked, «осталось» over a recording is its unwatched
seconds, and one sentence covering both would be false in one of the two places.

Three things fell out of it that are the general part:

- **The seam is where the shapes already differ.** `Chip` renders a link, a
  button or a `span`, and only the `span` — a label, which answers nothing when
  pressed — takes the new tap-to-explain. Sorting by "does this element already
  own its press" is what keeps the bubble from stealing one.
- **Hover-only is desktop-only.** `Tooltip` refused touch outright, so every
  sentence in the product was unreadable on a phone; the `tap` prop opens the
  same bubble on a tap and the next touch elsewhere closes it. Before adding one
  more `title=` or hint, check the reader can reach it on the device they are on.
- **Where hover cannot reach, say it in the open.** A goal card in the profile
  is one press with an overlay across the whole card — nothing under it can be
  hovered. Wrapping the line in a tooltip there would have been dead markup, so
  the rule went into the visible line under the section heading instead.

Rejected: explaining it once in a legend popover and leaving the figures bare.
The legend is three screens away by the time the question comes up, and the
question comes up *at the number*.

**Generally:** a figure computed by a rule the reader cannot re-derive is
incomplete until the rule travels with it. Write the sentence once, key it to
the fact rather than to the screen, and attach it at every site — then check the
site can actually show it.

## A layout rule belongs to the container, not to every card in it

Two cards side by side in «Открывает путь к» were different heights: the one
with a two-line title was sixteen pixels taller than its neighbour, and the row
read as a table someone had knocked out of line.

The obvious fix is `h-full` on the card. It is also the fix that has to be
remembered again at the next card, and the next list — and the reason it was
needed at all is invisible from the card: the grid *does* stretch its cells,
but a semantic list is `ul > li > a`, and the `li` swallows the stretch. Only
the container knows there is a wrapper in the way.

So the rule went into the container: `.card-grid` in `index.css`, which makes
every `li` a stretch box that hands the row's height down to whatever it holds
([design-system.md](../design-system.md#a-row-of-cards-is-one-height)). Nothing
in `CourseLinkCard` changed, and the three lists on the panel — prerequisites,
what a course opens, the weak ties — were fixed by one word each.

Rejected: `.card-grid > * { display: grid }`, which would have covered a `div`
wrapper too. Most grids in this codebase hold their cards *directly*, and that
rule turns a card's own block or flex layout into a grid — it survives today
only because Tailwind's utility layer wins on source order, which is a rule
holding by accident. Wrappers are `li` here, so `li` is what the selector says.

**Generally:** when a fix reads as "and remember to do this at every call
site", it is in the wrong file. Ask which element actually knows the reason —
usually the container — and put it there once.

## A live third-party frame may be restyled, never moved

The player dialog now has two shapes — a sheet about a recording and a screen it
is watched on — and the obvious way to build the second is a second layout. It
is also the one way that cannot work: **an iframe reloads when it is moved in
the DOM**, and a reloaded YouTube embed starts the lecture again from the top.
React moves a node whenever its position in the tree changes, so a `? :` around
the whole body, a portal into another container, or one wrapper `div` added on
one branch and not the other are each enough to throw away the reader's hour.

So the two shapes are **one tree wearing different classes**. The frame's
ancestors are the same elements in the same order in both; what differs is
`className`, and everything that genuinely moves between the columns — the
lecture list, the progress line — is markup with no video in it. The test is
one line and worth running after any layout change around a player: mark the
node, switch, and ask whether the mark survived.

```js
document.querySelector('iframe').dataset.mark = 'keepme'; // then switch, then:
document.querySelector('iframe').dataset.mark ?? 'REMOUNTED';
```

Two things fell out of it that generalise past this dialog:

- **A class list that flips between layouts is a place to read Tailwind's
  output order, not just its names.** `shrink-0` and `lg:flex-1` on the same
  element look like the media query wins; `flex-shrink` is a later property
  group than `flex`, so the base class does. Where two utilities in one list
  can contradict each other, build the whole string with a ternary and let only
  one of them exist.
- **A frame that has been replaced can still speak.** The embed posts about four
  frames a second, and the last one from the outgoing player arrives *after* the
  new one has been asked for — so the screen named the lecture that had just
  been left, under a picture already playing the next. `event.source` against
  `iframe.current?.contentWindow` sorts them, and dropping a legitimate frame on
  the way costs nothing at four a second.

**Generally:** anything on the page that holds live state the app cannot rebuild
— a playing frame, a media element, a canvas with a context — is not markup to
be re-arranged. Decide what its container is once, and let the layout change
around it.

## A feature that might be switched off is a flag and a tag, in one file

Five gamification mechanics went into the player at once — stages inside a
recording, the audience curve, the day's numbers, the finished-recording card,
the plan in weeks. Between them they touch a schema field, a build step, two
screens, five components and twenty dictionary keys, and the brief was that any
one of them could be turned off later without an excavation.

The shape that answers it is **one module that owns the mechanic end to end**.
`src/lib/gamification.ts` holds the `GAME` flags, every pure function behind
them and every hook they need; `src/components/game/` holds one component per
mechanic; each component's default export checks its own flag and returns
`null` before any hook runs, so a call site needs no condition of its own. And
every site — component, call site, schema field, build line, test — carries a
`[game:<key>]` tag, which makes the whole of one mechanic a single grep:

```bash
grep -rn "game:audience" src scripts shared tests docs
```

Two details that are load-bearing. The flag check has to be in a **wrapper**
around the component rather than inside it, or the early return sits above
hooks and React refuses it. And the module has to be the *only* new import a
screen takes: PlaylistModal gained five imports and thirty lines, and none of
the arithmetic — what a stage is, where the reader stands against the crowd,
how many weeks are left — is written there, so switching a flag cannot leave a
half-computed value behind.

**Generally:** when a batch of related features lands in code that other
sessions are also editing, the unit to protect is *reversibility*. One owner
module, one flag each, one grep-able tag, and no logic at the call sites — then
"take it out again" is a word and a deletion of files nobody else touched.

**It was collected on.** Stages inside a recording came out again later and were
replaced by the week plan — the same rows, dealt into the reader's own calendar
instead of into three-hour blocks. The whole swap was one flag renamed
(`milestones` → `schedule`), one component file replaced, two call sites, and
four dictionary keys; `grep -rn "game:milestones"` listed every site to visit
before anything was touched, and nothing outside `gamification.ts`,
`components/game/` and the two call sites had to be read at all. The one file
that was not on the grep's list was a shared helper the new mechanic needed —
which is the honest limit of the pattern: a flag isolates a *feature*, not the
utilities it grows on the way out.

## A key assembled at the call site is a key `check:i18n` calls dead

`t(source === 'goal' ? 'ui.game.planGoal' : 'ui.game.planPace', params)` reads
perfectly and is invisible to the checker, which matches `\bt\(\s*'…'` — so the
four keys behind it were reported as orphans, which is the report that gets
somebody to delete them six months later. Writing both branches out
(`fromGoal ? t('ui.game.planGoal', params) : t('ui.game.planPace', params)`)
costs one line and puts them back under the gate.

**Generally:** the dictionary gate reads the source as text, so any key the
code *computes* is a key it cannot see. Template keys are the one exception it
handles (`t(\`course.${id}.title\`)` becomes a wildcard) — everything else has
to appear as a literal directly inside the call.

## A strip that narrates the current row is a second copy of it

The watching screen said the lecture in the frame twice. Under the picture stood
«Лекция 11 из 25», the title, a bar reading «6:13 / 11:40», arrows to the
lecture before and after and a button marking this one off; a centimetre to the
right the queue had that same lecture as a lit row, filled to the same playhead,
carrying the same two figures, opening on a click and ticking off with the
checkbox at its end. Every line of the strip was a restatement and every control
on it a second door to what the row already answered.

The strip went, and the queue kept the job whole. What settles it is not taste
but a question asked of each line: **what does this say that the row cannot?**
The honest answers were two — the title was truncated in the row, and the strip
sat under the picture where the eye already is. The first is a `line-clamp-2` on
the playing row; the second is not worth a panel.

The move has a cost that has to be paid deliberately, and it is the general
part. **A fact moved to a new home inherits that home's data source, and the new
source may have less right to speak than the old one.** The strip read the
position out of the player's own frames; the row read it out of the profile,
which is *allowed to be silent* — «Место остановки» switches the stored position
off, a ticked lecture keeps none, and anything under the fifteen-second resume
floor is not a place worth returning to. Three deliberate silences, all correct
about a lecture somebody left, all wrong about the one playing. So the live
figure is passed down to the row it belongs to and the stored mark is left to
every other row, which is one prop and the difference between a queue that
follows the player and one that shrugs three times a session.

Rejected: keeping the strip and quieting it — smaller type, no bar. It answers
«перетягивает внимание» and not «избыточность», and a muted second copy still
has to be kept in step with the first.

**Generally:** before adding a panel that narrates the selected item of a list
on the same screen, go line by line and ask what it says the row cannot. What
survives usually belongs *in the row*; what does not is state kept in two places
and two sets of controls that must agree. And when the panel goes, check what
its numbers were read from — the row's usual source is often the profile, and a
profile is entitled to silences an on-screen reading is not.

## A rule written to paint something is usually an act waiting to be offered

`VIDEO_DONE_FRACTION` had been in the player for a year with one consumer: past
it, a checkbox turned green. But the threshold is not the end of a lecture — the
last minutes are credits and a Q&A — so the rule fires at exactly the moment the
reader has a question the interface was not answering. *What now?* The answer
was in the queue all along, as a row to find among a hundred while a lecture ran
on; making it a press cost one derived boolean and one capsule, because the
state was already computed.

Three things make it an offer rather than another control:

- **It expires.** It is drawn only while the state that justifies it holds — the
  lecture behind you, a row after it — so it is never a permanent second door to
  something the list already does. That is what separates it from the strip
  above, which was taken down for being exactly that.
- **It is the same call as the automation.** The player already walked to the
  next lecture by itself where the embed had no rail to autoplay along. A button
  that did its own version of "move on" would be two answers to one question,
  and they drift: one of them marks the lecture off, the other forgets to. So
  `advance()` is one function with two callers.
- **The state it reads is the durable one.** "Behind you" is the tick in the
  profile, not the player's own fraction — which makes the threshold, the
  player's `ENDED`, a tick by hand and a lecture finished last week one case,
  and the offer survives the dialog being closed and opened again.

Rejected on the way: drawing it over the picture, where YouTube's chrome lives
and where the whole strip exists precisely to avoid landing; and offering the
next *unwatched* lecture rather than the next row, which is a different act from
the one the queue and the autoplay both perform.

A second reader also **moves the rule**, and that is part of the price. 90% was
chosen when it only had to decide when a bar may complete, where being early is
generous; the same number offering the next lecture is telling somebody to leave
while a long lecture still has ten minutes of teaching in it. It went to 95%
with the offer, and the constant's comment now says both jobs, so the next
person to move it knows what else they are moving.

**Generally:** when a rule is written so that something can be *painted*, ask
what the reader does next once it is true. If the answer is a press they would
have to go and find, the rule is also the trigger for offering it — where the
state was noticed, for as long as it holds, and through whatever function
already performs that act elsewhere.

## Which horizon a number belongs to is fixed by the question, not by the data

The day's goal existed, was chosen as the unit somebody acts in, and was printed
in exactly one place — the player. The front page, which is where the decision
"anything at all tonight" actually gets made, carried the week and nothing else.
Every screen had been settled on its own merits, and the answer to "should the
goal go here too" was being argued from scratch each time, with the same
evidence: the data is in the profile, so it *could* go anywhere.

The rule that settles it in advance is the reader's question. Three of them, and
a number answers exactly one:

| Horizon | The question | Where it may stand |
|---|---|---|
| **the day** | what do I do now | where there is a press that answers it — the front page's card, the course panel's continue block, the recording's sheet, the player between lectures |
| **the week** | how is it going | where looking back is the point — the profile; on the card as standing, never as an ask |
| **the object** — a recording, a course, a field, a path | how far into *this* am I | inside that object and nowhere else |

Four rules fall out of it, and each one deletes an argument that used to be had
per screen:

- **One ask per screen.** A second horizon may be on it as context — the week's
  bar under the day's line is what makes twenty minutes look worth doing — but
  two things asking at once is a screen that has stopped asking anything.
- **Nothing is offered to somebody who did not ask for it.** A goal is the one
  chosen number in the product; with none set, the same slot carries the report
  («Сегодня — 2 лекции, 1,5 часа») or nothing. An *invitation* is allowed only
  where the habit it would describe is already in the log.
- **An object's number never becomes a target,** but it may be divided by the
  reader's own pace: «осталось ≈37 ч · ≈2 месяца», with the sentence saying
  whose pace that is (`horizonFor`, `Forecast`).
- **A goal stops asking once it is met at its own grain.** «45 минут, 5 дней» is
  a week with two days off in it; a sixth day asked for is a target nobody set.

What the rule cost when it was applied: one line added to the front page, one
tile taken off it (the week's hours, which the bar beside it already said in
full), and two screens that cannot disagree because they render the same
component. What it saved is the next screen — the field card and the course
panel got the same question asked of them and the answer was **no**, in a
minute, with a reason that will still be there next time.

**Generally:** when the same kind of number keeps turning up in new places, do
not decide the places one at a time. Name the question each grain of it answers,
and the placement becomes a lookup rather than a debate — including the "no",
which is the half that never gets written down otherwise.

## A printed pair shares a unit, chosen by the larger half

«Сегодня — 2,5 из 45 минут» is what a long afternoon against a short goal came
out as: `span()` picked a unit per value, and each value picked correctly. The
sentence exists so two numbers can be compared, and it was handing the reader a
conversion to do first.

The fix is one optional argument — `span(seconds, scale)`, where `scale` is the
larger of the pair — rather than a rule at the call site, because there were
already two call sites and the third would have got it wrong again. The bar for
the week had solved the same problem years earlier by writing both halves in
hours whatever their size; this is that decision made available to everything
that prints a pair.

**Generally:** a formatter that is right about one value can still be wrong
about two. Where values are printed to be compared, the unit belongs to the
pair, and the cheapest place to hold that is the formatter's own signature.

## An event is taken where the state settles, not where the button is

Wiring analytics by putting a `track()` next to every control is a rule that has
to be remembered thirty times, and it is wrong on the thirty-first — the control
somebody adds next month, and the two changes no control makes at all (a filter
panel reset, the language filter re-seeding itself when another course opens).

Everything on this site already passes through four places, so that is where the
counting went: `useDocumentMeta` for a page view, since it is the one function
that knows the canonical path of every screen there is *and every screen there
will be*; the profile store for every progress write; `useSearchResults` for
every search, since both screens search through it; and one document-level click
listener for every link that leaves the site.

For the store the mechanism is `reporting()` in `src/lib/analytics.ts` — it
wraps an object of actions and asks a table what happened, with the state from
**both sides** of the call. That second half is what makes the table describe
*outcomes*: `cycleCourseStatus` takes an id and no status, and which of the
three it landed on is only knowable afterwards. The same shape covers the twelve
playlist filters as a diff of the panel's state.

**Generally:** count where the state settles. A chokepoint that already has to
be correct for another reason — the canonical URL, the persisted profile — is a
chokepoint that cannot silently stop being called.

## A collector that stores everything and reports nothing is the expensive kind of wrong

GA4 accepts any parameter on any event, keeps it, and then offers **none of
them** in a report unless a custom dimension was registered for that exact name
beforehand. Events arrive, totals go up, and the breakdown the event was added
for is not in the menu — found a month later, when that month is unrecoverable.

So the list of events and parameters lives in `shared/analytics.ts`, read by two
sides: `scripts/ga4-setup.ts` provisions the property from it, and `track()`
warns in development about any event or parameter that is not in it. The rule is
one line — **an event is added to the registry first** — and the check is where
somebody is actually watching.

**Generally:** where a system silently accepts input it will not give back, the
schema has to be declared to it in advance, and the declaration has to be the
same artefact the code is written against. Two lists that must agree, and no
check that they do, is one list that is wrong.

## A view a static host cannot serve a file for is not a page

Found on 2026-08-18, auditing the site for search engines.

A field of knowledge was `/courses?domain=math`. Every screen of the app can be
reached that way and the app names each of them correctly once it has booted, so
nothing looked wrong. What was wrong is invisible from inside the app: Pages
serves one file per **path**, so all thirty-nine fields were `courses.html` —
the same bytes, the same title, the same list of all 225 courses — and thirty-
nine entries in the sitemap pointed at it. A crawler that indexes what it is
served had thirty-nine copies of one page.

The fix is not a canonical link and not a better title. It is that **a view
worth indexing has to have a path of its own**, because a path is the unit a
static host can answer differently. `/fields/<id>` is a route, a prerendered
file and a sitemap entry; `?domain=` keeps working and canonicalises onto it.

The seam that made it cheap: one function decides the address from the filter
(`writeDomains` in `src/lib/url.ts`) and one reads it back (`columnsHref`), so
no screen knows there are two shapes. `params.search` still hands everything
downstream `domain=…` whichever shape the address is in, which is why the change
touched no screen except for the canonical link it declares.

**Generally:** before adding a query parameter that selects *what the page is
about* rather than how it is sorted, ask what file a static host would serve for
it. If the answer is "the same one as for everything else", it is not a page
yet, and no amount of head-rewriting after boot will make search treat it as
one.

A second rule came out of the same change. When a screen has to default
something the address did not say, **derive it during the render, do not correct
it afterwards**. The first attempt set the course's own fields in a `useEffect`
with `navigate(..., { replace: true })`, which is correct and looks fine in a
test — and on a real machine draws all 225 cards, paints them, and rebuilds the
screen into six. The user saw the lurch immediately. Deriving it in
`useCatalogParams` costs one `useMemo`, renders right the first time, and leaves
the URL clean, which the canonical link wanted anyway.

**Rejected, with reasons:**

- *Leave `?domain=` and drop the thirty-nine URLs from the sitemap.* One line,
  and it does remove the duplicate signal — but it also gives up thirty-nine
  landing pages for the shape of question people actually type («курсы по
  математике»), whose titles and descriptions were already written in
  `data/i18n/*.json`. Cheaper than the fix and worth less than nothing.
- *Serve the trailing-slash form as a small redirect stub.* `/courses/x/` was a
  404, and a stub is 600 bytes against a whole page copied. Rejected because
  which of `courses.html` and `courses/index.html` a static host prefers for the
  bare `/courses` is not documented anywhere we control — if it prefers the
  directory, the stub is the file *both* addresses resolve to and the page
  redirects to itself. The full copy cannot fail that way, carries the canonical
  link naming the slashless address, and costs 2 MB against a 35 MB `dist`.
- *Promote the course panel's `<h2>` to the page's `<h1>`.* It is the visible
  title of the open course, so it reads like the right heading. But `CoursePanel`
  is mounted up to three times in `CoursesScreen` — desktop panel, mobile sheet,
  list — and only the breakpoint decides which is showing, so the promotion
  risks a page with three `<h1>`s. One `sr-only` heading in the screen itself is
  always exactly one, in every state.

## An invariant that lives inside an expression cannot be checked, and fails quietly

Every hour this product prints came out of one line inside a React hook:

```ts
Math.max(0, Math.min(playing.sec - start.sec, ((now - start.at) / 1000) * peak.current))
```

It was right. It had been right for months. But the question «do the day's
hours count the lecture or the evening?» could only be answered by reading that
line and reasoning about it, which is exactly what the neighbouring paragraph of
[interface.md](../interface.md#progress-down-to-the-lecture) had failed to do:
the documentation said «capped by how long that took» and dropped the `* rate`,
so the prose described a product that credits a reader watching at 2× with half
of what they watched. Nobody could have caught that, because **nothing fails
when this breaks.** Tighten the ceiling by an honest-looking mistake and the
hours simply come out smaller, on a screen nobody can hold a stopwatch to.

The fix is not a comment. It is a name, a signature and a test:
`watchedBetween(travelled, elapsed, rate)` in `lib/youtube.ts`, six cases in
`tests/watched.test.ts` — one at 1×, one at 2× stated at the scale it is
printed at («half an evening, a whole hour»), one at 0.5×, a seek, a rewind, a
pause. The behaviour did not change by a single second.

**Generally:** when a rule the whole product rests on is spelled as an
expression at its one call site, three things are true at once — it cannot be
tested, it cannot be linked to from the documentation that explains it, and its
failure mode is a number that is merely *wrong* rather than absent. Give it a
name and a test the day you notice, even when it is correct. The test's job is
not to find today's bug; it is to make tomorrow's tightening fail out loud.

The corollary is about the docs beside it: **prose that paraphrases arithmetic
goes stale in the direction nobody checks.** If a sentence in `docs/` restates a
formula, it should name the function, so the next reader can go and see whether
the sentence is still true.

## Two clocks over one evening, and neither converts to the other

The pomodoro counts the wall — twenty-five minutes is twenty-five minutes of
somebody's evening — and the profile counts the lecture, so a session at 2×
comes to fifty minutes of studying. The temptation is to pick one, and both
attempts are wrong: measured in wall clock, a course's bar would have its two
ends in different units («0,1 из 3,4 ч», where the 3,4 is the sum of the
lectures and the 0,1 is the reader's sofa); measured in lecture time, a
pomodoro would run twelve minutes for somebody at 2× and be a timer that lies.

So both stand, neither is converted into the other, and the documentation says
out loud that they are different clocks answering different questions.

**Generally:** when two numbers on one screen measure the same afternoon and
disagree, check whether they are answering the same question before reconciling
them. A unit is fixed by **what the number will be compared against**, not by
what it was measured with — and two numbers with different comparisons are two
facts, not an inconsistency to fix.

## A wall-clock feature is tested by shrinking its unit, once, in one place

A pomodoro's shortest honest setting is fifteen minutes, and the cycle worth
watching is session → rest → chime → next session — an hour of sitting there to
see it once. `const MINUTE = 60_000` became `1_000` for one pass, which made the
whole cycle forty seconds, and went back before the commit.

That works because the constant is **one named thing that every deadline is
multiplied by**. The version of this that goes wrong is a feature where the unit
is spelled `* 60 * 1000` at four call sites: then the test patch is four edits,
three of them get reverted and the fourth ships.

**Generally:** a feature whose behaviour is spread over minutes or hours needs a
single constant standing for its unit — not for tidiness, but because that
constant is the only affordance that makes the feature observable in one sitting.
Write it before the feature is long enough to need it.

## A shared block with holes punched in it for one view belongs to one view

The player dialog has two shapes — the sheet a recording is read about on, and
the screen it is watched on — and the fact sheet under them was written once and
drawn on both. It could not simply be drawn on both, though: three things inside
it had a better home on the watching shape, so the block carried three
`{watching ? null : …}` holes — the progress bar (which stands over the queue
there), the day line (same), and the part navigation for a series (same). A
fourth conditional above it drew the «О ЗАПИСИ» heading that announced the sheet
had followed the queue down.

Four conditionals in one block is the block saying it is not shared. The sheet
went into the branch that reads it, the three holes and the heading went with
it, and each shape now owns its own column outright. The diff is mostly
indentation; what it removed is the standing obligation to check, for every line
added to the sheet from then on, which of the two shapes it was true of.

The evidence that the move is right — and the part worth reusing — is **what the
holes were for.** Each one existed because the fact had already been given a
better place on the other shape. That is not a variation on a shared block; it
is two blocks that were sharing a file. A heading whose job is to say "there is
more below this list" is the same admission one line further on.

Rejected: keeping the sheet and cutting it down for the watching shape — the
lecturer, the length, the rating and nothing else. It keeps both problems, a
second layout to maintain and a column that still does not end where the queue
ends, in exchange for facts nobody was going back to mid-lecture.

**Generally:** count the per-view conditionals inside a block drawn on more than
one view. One is a variation. Three or more, especially when each exists because
the other view already says the thing better, means the block belongs to one
view and the other view is being served a copy with the interesting parts cut
out. Move it whole rather than deepening the holes, and check afterwards that
the branch that lost it is not now missing something the holes were hiding.

## An option on a screen is priced over every screen, not the one in front of you

`steppedLines` and `fullGraph` were both offered as switches because each looked
like a matter of taste on the screen they were tried on. They are not the same
kind of question, and the way to tell them apart was to stop looking at one
screen: `scripts/_columns.ts` replays all 225 of them headlessly — the field's
own cards, the prerequisites borrowed in, `placeGuests` for where the guests
stand, the same cut to a tree that `links` makes — and counts what each option
changes.

What that bought:

- **Steps against curves**: not a taste at all. Lanes are keyed by the card at
  the end of a run, so everything arriving at one course merges into its edge —
  which is the fork a chain actually has, and the thing a curve cannot say. The
  switch was two pictures making different claims, and the second one was worse.
  Removed; steps are the drawing, and `COLUMN_GAP` is the 48px corridor they
  need rather than a number that changed under a setting.
- **Every link against the tree**: a real trade, and the numbers decided it the
  other way from how it looked. The two drawings differ on 87 of the 197 chains
  — +191 lines and crossings 13 → 42 over the whole catalogue, against 184 cards
  drawn with fewer prerequisites than they have. 174 of the 197 screens have no
  crossing either way, so the cost was three busy physics chains and the loss
  was everywhere. Removed; every edge is drawn.

The measurement was cheap only because the deciding is in pure functions —
`placeGuests` in `lib/order.ts`, `routeSteps` in `lib/route.ts` — and not in the
components. **Layout logic that lives outside the component can be replayed over
the whole catalogue; layout logic inside one cannot be measured at all**, and
then every option is settled by whichever screen was open at the time.

And the tie-breaker in both cases was the same, which is the part worth carrying
to the next switch: **a reader cannot press a switch for a loss they cannot
see.** One line into a card reads as «this is its only prerequisite» and nothing
contradicts it; a curve reads as a connection and never says «two of these
arrive at the same place». An option is honest when both settings state their
own claim on screen. When one of them silently states less, it is not an option,
it is a default that has to be right — and then the only question left is which
one, which is the question the script answers.

## Commit an explicit list of files

The working tree is shared with concurrent sessions. `git add` names files one by
one, and `git status --short` is checked before committing. See
[pitfalls.md](pitfalls.md#the-git-index-is-shared-with-other-sessions).

## What a subagent writes is a contract with the reader that consumes it

Handing 2815 bindings to 19 subagents needs a brief, and the brief was written
from the report `_review.ts export` produces. That was the wrong source. The
exporter calls the column `course`, the importer reads `row.course` — and the
first draft of the brief asked for `suggested_course`, because that is what the
field *means*. Nothing would have failed: `import` treats a `wrong-course`
verdict whose suggestion it cannot resolve as `not-a-course`, so all 39
rebindings would have become refusals, and the log would have said `39
not-a-course` in a tone of complete success.

**Read the consumer, not the producer.** The format a delegated worker writes to
is fixed by the code that parses it; a brief derived from anything else is a
guess that fails quietly and in the direction of losing work.

Two more things that batch taught, both cheap to prevent:

- **Verify the output yourself, do not read the self-report.** Every one of the
  19 agents reported its file as verified; that is a claim, and checking all 19
  against their batches — count, ids, membership, duplicates, every suggested
  course against `courses.txt` — is one script and about a second. Same rule as
  [verifying a subagent's claim against the database](../agents/iteration.md#working-with-subagents),
  applied to its output rather than to its findings.
- **Give parallel agents distinct filenames.** Several picked the same obvious
  name for a scratch script in the shared directory and overwrote each other
  mid-run; one noticed and reported it as an anomaly, and the others would not
  have. Anything a fan-out writes wants the batch number in its name, the
  verdict files included.

## A pasted address is answered by its id, and everything else by its words

Search here had one shape for two questions. «Теория вероятностей» asks what the
catalogue has about a subject; a link somebody was sent asks about one recording
the reader already holds. Both were normalised, lower-cased, stripped of
punctuation and matched as a phrase, so the second one found nothing —
`https://www.youtube.com/playlist?list=PL…` became the words `https www youtube
com playlist list pl…`, and the id, which the index already stores as the
playlist entry's own `id`, was never compared against anything.

**The address is read before `normalize` sees it.** Two of that function's three
jobs are fatal here: it lower-cases, and a YouTube id is case-sensitive — `PLxA`
and `plxa` are different playlists, and folding them answers with whichever came
first in the file — and it drops the `?` and `=` the id lives behind. So
`parseYoutubeRef` runs first, and what it returns is looked up with `===`.
Everything after that is the ordinary path: one hit or none, and the sections,
the keyboard walk and the map's highlight are built from it unchanged, which is
why the feature is a branch rather than a second search.

**A link that finds nothing is not «ничего не найдено».** Four different things
can be pasted and only one of them is a question the catalogue can answer. A
playlist it does not hold is worth proposing, and the reader is holding exactly
the field the form requires — so the form opens with the address already in it.
A video, a channel, and one of YouTube's own personal lists (`WL`, `LL`, `RD…`)
are dead ends and say which one they are; proposing a mix that resolves for
nobody but its owner spends a maintainer's attention on nothing.

**Ask the code that already knows the shape.** `scripts/lib/playlist-id.ts`
existed, with three forms counted over 32 914 crawled rows and a header
explaining that its own predecessor was three copies of one wrong regex. Writing
a fourth here was the obvious move and the one that file is an argument against,
so the definition moved to `shared/playlist-id.ts` — both sides read it now — and
the crawl's path stayed valid as a re-export. It decides the *offer*, not the
lookup: a link is found or missed by `===` regardless, but `OLAK5uy…` is an
auto-generated music album that the pipeline would refuse, so it is never
proposed.

**The words pass had to teach the highlighter too.** Half the catalogue's
recordings are titled by whoever published them — the lecturer after the
subject, the university only in the channel name — so a phrase search finds the
catalogue's own titles and misses everybody else's. The fix is a conjunction:
every word of the query has to land somewhere in the entry, and a word that
lands nowhere refuses the row, which keeps a three-word query as precise as its
rarest word. Two invariants hold it in place:

- **A scattered match can never outrank a phrase.** The token score is the mean
  of the words' scores times `TOKEN_FACTOR`, and the factor is chosen so that
  the best possible token score (500) sits below the weakest phrase-at-a-word
  score (600). The loose pass adds answers under the strict one instead of
  rearranging it, and a one-word query skips it entirely — its ranking is
  bit-for-bit what it was.
- **A hit marks what it matched.** `matchRanges` gained the same second pass,
  because an unmarked row reads as a bug — that is the whole reason `MarkedText`
  exists. The one place it stays silent is a link: the id matched, nothing in
  the title did, and the marker would have found something anyway (`com` and
  `list` are substrings of plenty of real titles). There the row says «по
  ссылке» instead.

**And it had to be paid for before it was spent.** The loose pass is one more
scan of 9160 entries per keystroke, on top of a search that already measured
13–24 ms — `normalize` over every entry's display name, three regular
expressions each, once per keystroke per variant. Memoising that in a `WeakMap`
took the same searches to 5–10 ms *with* the second pass. The general shape:
**before adding a pass over the whole index, look for the per-entry work the old
one was repeating** — it is usually the same size as what is being added.

Refused, with the reasons, so the next iteration does not re-derive them:

- **A bare video id is not read as a link.** It is eleven characters of
  base64url, and so is `Probability`. Inside an address it is unambiguous;
  standing alone it would take a real query out of the search for a paste nobody
  makes.
- **Video links resolve to nothing, deliberately.** The index holds playlists;
  the 239 890 videos live in 227 course shards totalling 33 MB, and a
  video→playlist map is ~14 MB of JSON — not something to load on the chance
  that somebody pastes a lecture. If `search_link` says people do, it wants its
  own file sharded by a hash of the id, fetched only when a video link is
  actually pasted.
- **Channel links say «канал» and stop.** `providers.json` carries no
  `channelId`, and a handle (`@name`) is not stored anywhere at all — the crawl
  never asked for one. Resolving them means a build change and a crawl field,
  which is a different iteration.

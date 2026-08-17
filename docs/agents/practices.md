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

## Commit an explicit list of files

The working tree is shared with concurrent sessions. `git add` names files one by
one, and `git status --short` is checked before committing. See
[pitfalls.md](pitfalls.md#the-git-index-is-shared-with-other-sessions).

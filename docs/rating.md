# Rating

How the catalogue decides which of thirty-nine recordings of «Algorithms» to
put first, and what single word it says about each.

Everything here is computed at build time by `scripts/lib/score.ts` and written
into the shards. The client never recomputes anything: a z-score is a statement
about a population, and the population is the whole catalogue, which the client
does not have.

## What can be measured

Dislikes have been private since 2021, so nothing YouTube publishes states
quality. Four things can be measured instead:

| Signal | From | Says |
|---|---|---|
| `approval` | `likes / views` | did the people who came like it |
| `retention` | views of the last quarter over the first | did they stay |
| `discussion` | `comments / views` | did they have something to say |
| `reach` | `views / videoCount / subscribers^0.8` | did it travel past its channel |

The design rests on these being independent. Measured over the catalogue,
approval and retention agree at **−0.04** — knowing one tells you nothing about
the other, so together they say roughly twice as much as either alone.

`retention` and the curve behind it come from `videos.views`, which the crawl
has stored all along — 588 591 rows, no extra quota. `reach` needs
`channels.subscribers`, which `pnpm data:subscribers` fetches; `channels.list`
costs one unit per call whatever `part` asks for and takes fifty ids at a time,
so the whole catalogue is single digits of quota. It is measured on 2004 of the
2902 playlists — 832 were found on GitHub course pages and carry no channel at
all, and 62 sit on a channel too small to divide by (see below).

## Why nothing is used raw

Every raw signal measures the circumstances more than the recording.

**The calendar.** Likes per view rose threefold across the platform over the
period the catalogue covers, and old videos keep collecting views long after
they stop collecting likes:

| Peer group | median likes per view |
|---|---|
| en, ≤2012 | 0.0057 |
| en, 2016–18 | 0.0137 |
| en, 2022+ | 0.0193 |
| ru, 2019–21 | 0.0162 |

A factor of **3.4** with nothing to do with the lecturer. The previous rating
compared every playlist to one catalogue-wide mean and therefore ranked mostly
by upload date: its rank correlation with year was **0.49**, and MIT 6.824
Distributed Systems scored 0 out of 100 while a course tagged as English but
recorded in Urdu scored 100.

**The channel.** A channel explains about **27%** of the variation in approval
— audience habits, not lecture quality. NPTEL's viewers press the button far
less often than МГУ's.

**The shape.** A playlist's view curve says nothing until you know whether it is
a course at all. A channel's «Astronomy» shelf is entered from search at a
random point; its retention is an artefact of arrival, not of staying.

**The size of the channel.** Views per lecture grow as the **0.68** power of
subscribers across the catalogue — a channel ten times the size gets five times
the views per lecture, not ten. Dividing by the subscriber count itself
therefore over-corrected, and `reach` came out at **−0.23** against channel
size: a metric for «small channel» wearing the name of one for «travelled
far».

So each signal is turned into a z-score against the right yardstick first.

## The yardsticks

**Peer groups: language × era** (`≤2012`, `2013-15`, `2016-18`, `2019-21`,
`2022+`). Not "who your competitors are" — a 2011 English course still competes
with everything — but *what a like is worth in this corner*. Groups under 25
playlists fall back on the catalogue as a whole. Applied to approval,
discussion, and retention.

**Robust statistics.** The centre is a median, the spread an IQR over 1.349.
Not for elegance: the catalogue contains a playlist reporting 10 638 likes
against 24 076 views, and a mean would let it set the scale for a whole group.
Anything above `MAX_PLAUSIBLE_APPROVAL` (0.15 likes per view) is treated as a
broken counter and clipped.

**Partial channel pooling.** A channel's habitual deviation from its peers is
computed, shrunk by how many playlists it has (`n / (n + 4)`), and then
subtracted **only in part** — `CHANNEL_PULL = 0.35`. Full subtraction was
tested and rejected twice over: it flattens a consistently good channel to its
own median and calls that neutrality, *and* it does not even fix the calendar
bias it was meant to fix (0.243 against year, versus 0.011 for peer groups),
because a channel spans a decade and its own newer uploads beat its older ones.

**Confidence shrinkage.** Approval is pulled towards its peer centre by
`views / (views + 2000)`; retention by `perVideo / (perVideo + 300)`. Retention
is counted per lecture on purpose — 4000 views over 41 lectures is 98 apiece,
and the difference between the first quarter and the last is then a few dozen
people either way.

**Saturation, not clipping.** `saturate(z) = 3·tanh(z/3)`. A hard clamp put 60
playlists on exactly 2.40 and made the head of the sorted list alphabetical.

**A denominator worth dividing by.** `reach` uses `subscribers^0.8`, which puts
its correlation with channel size at **+0.06**, and is not computed at all below
`MIN_REACH_SUBSCRIBERS` (1000). The exponent alone was not enough: 53 channels
in the catalogue have under a thousand subscribers and **94%** of them hold
exactly one playlist — they are private accounts somebody used to mirror a
Stanford or MIT course. A nine-subscriber channel with 1.6M views on Susskind's
«Cosmology» topped the reach scale by a mile at any exponent, because there is
no channel there for the playlist to have travelled past. The question is
unanswered rather than answered spectacularly.

## The view curve

For any playlist with at least 8 videos that have views, in playlist order:

```
rho     = Spearman(position, views)          −1 = watched in order, dropping out
scatter = robust MAD of the residuals of ln(views) ~ a + b·ln(position+1)
```

| Kind | Test | Count |
|---|---|---|
| `series` | `rho ≤ −0.45` and `scatter ≤ 0.85` | 1355 |
| `assorted` | `rho ≥ −0.25` or `scatter ≥ 1.2` | 540 |
| `unclear` | anything else | 325 |

Khan Academy sits at `rho = −0.13`, `scatter = 0.80` — the signature of a
shelf, and the explanation for its otherwise puzzling high retention: its
videos are searched for individually, not watched through.

The curve decides one thing only: **whether retention may be scored**. It is
not allowed to decide what the playlist *is* — see the next section for why.

Two corrections are applied. **67 playlists run newest-first**; read literally
their audience grows towards the end, so `isReversed` detects a clear majority
of decreasing dates and inverts the ratio. Playlists in no date order at all —
about half the catalogue — are left alone, because position is the order they
are watched in regardless of when they were filmed. And **an `assorted`
playlist's retention is not scored at all**: it is not a fact about staying.

Checked and found not to matter: the tail being recently uploaded (median
retention 0.446 for tails under 6 months versus 0.418 for tails over 3 years)
and playlist length (0.406 at 6–12 videos, 0.378 at 100+).

## How the playlist was built

The curve alone used to decide whether to call something «Подборка», and it was
wrong a quarter of the time: **120 of the 485** playlists it labelled a shelf
have their own lectures numbered in order — MIT 18.03, Stanford CS224N,
Professor Leonard's Calculus 3, Сурдин's «Общая астрономия». They are courses.
What happened to them is that each lecture is famous enough to be found from
search on its own, so position stops predicting views. `rho ≥ −0.25` alone
triggered **80%** of all shelf verdicts, and it fires on 8.3% of playlists that
number themselves.

Those 120 are indistinguishable from courses on every measure except the curve:

| | flagged shelves that number themselves | all `series` |
|---|---|---|
| median upload span | 82 days | 98 days |
| median duration spread | 0.14 | 0.13 |
| span over 2 years | 8.6% | 12.8% |

So three facts are read off the videos themselves — their titles, upload dates
and lengths — none of which come from the playlist record:

```
ordered         ≥60% of titles carry their own position, or ≥70% say «lecture»
spanDays        first upload to last
durationSpread  robust MAD of lecture lengths over their median
```

Measured against 630 playlists whose titles number themselves and 69 that are
unmistakable channel shelves, how the thing was made tells them apart far
better than how it is watched:

| Fires on | shelves | numbered courses |
|---|---|---|
| over 120 videos | 79.7% | 0.2% |
| uploaded across 2+ years | 100.0% | 7.3% |
| lecture lengths all over | 50.7% | 4.9% |
| *views unrelated to order* | *62.3%* | *8.9%* |

**«Подборка»** (`isCollection`) needs two witnesses and survives a veto: the
curve must not say the views follow the order, at least one structural mark must
agree — two if the curve only came out `unclear` — the playlist must have 20
videos or more, and the titles must not number themselves. A playlist that says
«Lecture 7» on its seventh video has answered the question already, whatever its
views do. That cuts the word from 16.7% of the catalogue to **7.6%**, and what
is left is unmistakable: Udacity's 1197-video «Intro to Psychology», Khan
Academy's 421-video «Algebra I», The Organic Chemistry Tutor's subject shelves.
Today it is **8.2%**.

**«Полный курс»** (`isFullCourse`) is the mirror image: ordered titles, 20+
lectures, filmed inside 400 days, lecture lengths within 0.35 of their median —
**14.0%** of the catalogue: MIT 7.016, Половинкин's ТФКП, Onur Mutlu's Computer
Architecture, UMass CS685. The two are mutually exclusive by construction.

### Neither of them is a status

Both were words on the status ladder once, and being a ladder it let only one of
them speak. A shelf people plainly like was told it was a shelf and nothing
else: **440 playlists — 15% of the catalogue — had their rating thrown away to
describe their shape.** So shape moved to its own answer, `playlistTypeOf`, and
the row wears both at once — «Подборка» beside «Ушёл в народ» is two true
statements about one playlist, and neither had to lose.

The type is one of four, tried in this order, and read off fields the build has
already worked out rather than stored:

| Type | Read from | Share |
|---|---|---|
| **Подборка** | `collection` — the curve and the build agree it is a shelf | 8.2% |
| **Семинары** | `kind` — a clear majority of the lecture titles say so | 6.0% |
| **Полный курс** | `fullCourse` — a whole ordered term in equal slots | 14.0% |
| **Разная длина** | `durationSpread ≥ 0.45` — the lengths are a mixture | 8.8% |
| **Лекции** | everything else | 63.1% |

«Разная длина» is the quietest of them and the one a reader is most likely to
want anyway: a playlist that is a course by every other test, but whose lectures
run ninety minutes, then eight, then eighty. It cannot be «Полный курс», which
requires the lengths to sit within 0.35 of their median, and it is not a shelf,
which needs the views to ignore the order as well. What it warns is that the
running time is spread unevenly — the one case where the numbers on the row
would otherwise mislead.

«Лекции» is never printed on a row: it is what most of a lecture catalogue is,
and a badge everybody wears separates nobody. It exists so the filter can ask
for courses and not shelves.

`kind` is read off the **lecture titles**, not the playlist's own. Read off the
playlist title and description alone — which is how it worked until now — 90% of
the catalogue came out «неизвестно» and the content-type filter offered three
values that between them described 297 playlists out of 2902. The lecture titles
ship with the shard anyway, and they are where the distinction is actually
written down: `unknown` falls to 61%, seminars go from 29 playlists to 180.

## The rating

```
rating = mean of the z-scores present, weighted 0.5 / 0.5
         × 0.8 if only one of the two was measurable

approval   z of ln(likes/views), peers + partial channel, shrunk by views
retention  z of ln(tail/head), peers, shrunk by views per video, series only
```

`reach` and `discussion` are **not** in the rating. Reach was tried at weights
of 0.1 and 0.2 and put the rank correlation with raw views back to 0.14 and
0.30 — reintroducing the "the famous wins" bias the rewrite exists to remove.
They earn badges instead.

The single-signal discount exists because a playlist under 8 lectures has no
readable curve, and one extreme number is weaker evidence than two moderate
ones agreeing.

### What it costs in bias

| Rank correlation with | old score | rating |
|---|---|---|
| year | 0.49 | **0.02** |
| views | −0.25 | **0.06** |
| video count | −0.22 | **−0.06** |
| language (ru) | 0.31 | **0.01** |
| channel subscribers | — | **0.05** |

## The status

One word, chosen in three steps. Deliberately all neutral or positive: the data
can honestly say "loved and finished", it cannot say "bad" — the same low like
rate is earned by NPTEL, whose audience does not press the button, and by a
genuinely dull recording, and nothing here separates them. A weak playlist gets
no word and sinks in the sort, which is the true statement.

**1. Gates**, in order. Each outranks anything built on top of it.

**2. Compound claims**, in order — statements the single scales cannot make.

**3. The widest margin** among the four single scales: the thing this playlist
is most unusual for. Not a priority list, which was tried and does not work —
every rung sees only what the rungs above refused, and the last one described
0.4% of the catalogue.

Nothing at all if none of the three answered, which is most of the catalogue and
the honest reading of it.

| Status | Condition | Share |
|---|---|---|
| **Мало данных** | `views < 1000` or `views/lecture < 150` | 6.0% |
| **Новый** | last upload under 120 days ago | 2.9% |
| **Отличный** | both signals measured, neither below its peers, top of the rating | 7.0% |
| **Классика** | recorded ≤2016 and the rating still holds up | 8.2% |
| **Досматривают** | widest margin on retention | 7.6% |
| **Нравится** | widest margin on approval | 8.0% |
| **Обсуждают** | widest margin on discussion | 7.0% |
| **Ушёл в народ** | widest margin on reach | 7.4% |
| *(no badge)* | cleared nothing | 45.9% |

Every word here is about the numbers. What the playlist *is* — a shelf, a whole
term, a set of seminars — is a separate badge on the row and is described
[above](#neither-of-them-is-a-status); it used to be said in this same slot, and
it silenced the rating of everything it described.

«Ушёл в народ» was «Разошёлся», which reads as «diverged» at least as readily as
«spread», and was the wrong half of the word for a metric that measures being
watched far outside your own subscriber base.

### Not being contradicted

Every single-scale word requires that neither approval nor retention is a full
sigma below its peers, so a playlist the data argues about is never complimented
for travelling far. Reach and discussion do not count as contradiction: a
channel's size and whether comments are switched on are circumstances, and being
unremarkable on either says nothing against being loved.

This replaced a gate on the composite rating — «rating ≥ 0» — which sounded like
the same idea and was not. Rating is the mean of approval and retention, so the
old gate refused every word to half the catalogue by construction: **803
playlists, 28% of the catalogue, cleared a threshold and were told nothing**, and
531 of those would have been «Ушёл в народ». That was not the gate working. It was
the gate papering over a reach metric that measured channel size, and the paper
covered a great deal besides.

«Классика» is ranked by the rating rather than by reach for a related reason:
reach needs a subscriber count, and 832 playlists have no channel behind them at
all, so ranking by it withheld the word from 29% of the catalogue over where the
playlist happened to be found.

### Thresholds

Set as **shares of each rung's own candidates** (`STATUS_TARGETS`), recomputed
every build and written into `meta.json` so what a word cost is always
checkable. Shares rather than fixed cut-offs because a z of 1.2 means whatever
this year's population makes it mean; shares of candidates rather than of the
catalogue because the rungs overlap and a quantile over everyone is met mostly
by playlists another rung has claimed.

Because the rungs overlap, a target is not the share of the catalogue that ends
up wearing the word: several rungs claim the same playlist and only one speaks.
The six were solved for on the built catalogue to land each word between 7.0%
and 8.2%, with «Без статуса» at 45.9% — a bigger silent share than before,
because the two shape words no longer fill it in with a statement about
something else. Every cut they produce is still at least a fifth of a sigma
above peers, so the shares are chosen but the words are not cheap. Rerun them
when the catalogue grows.

## What this still cannot do

- It measures audience response, not teaching. About **27%** of approval is
  explained by which channel a playlist is on rather than which playlist it is.
  NPTEL stays low because its audience likes rarely, not because its lecturers
  are worse. Normalising that away entirely would also destroy the ability to
  compare thirty-nine channels inside one course, which is the point.
- High retention on an `assorted` playlist and high retention on a course are
  not the same thing, and the curve can tell them apart only statistically.
- «Подборка» and «Полный курс» describe how a playlist was assembled, not how
  good it is. A shelf can be excellent teaching and a complete term can be dull.
  That is exactly why they are types and not statuses.
- A course that was re-published over several years — MIT 18.03's Spring 2006
  lectures were uploaded across a decade — cannot be confirmed as one term, so
  it is typed «Лекции» rather than «Полный курс». Unknown, not a shelf.
- `reach` is unmeasurable for the 898 playlists with no channel or too small a
  one, so «Ушёл в народ» and the reach bar are simply absent there.
- Nothing here knows whether the content is correct.
- «Нравится» can outrank «Отличный» in the sorted list. That is by design: the
  status is the most useful true thing to say, not a rank. A playlist with
  outstanding approval and no readable curve cannot be called excellent, and
  its rating can still be higher than a playlist that is merely good at both.

## Knobs

All in `scripts/lib/score.ts`, each with the observation that set it:
`CONFIDENCE_VIEWS`, `CONFIDENCE_VIEWS_PER_VIDEO`, `SPARSE_VIEWS`,
`SPARSE_VIEWS_PER_VIDEO`, `FRESH_DAYS`, `CHANNEL_PULL`, `CHANNEL_PRIOR`,
`WEIGHTS`, `SINGLE_SIGNAL_TRUST`, `Z_LIMIT`, `MIN_CURVE_VIDEOS`, `CURVE`,
`COLLECTION`, `TITLE_ORDER`, `FULL_COURSE`, `CONTRADICTION`, `REACH_EXPONENT`,
`MIN_REACH_SUBSCRIBERS`, `CLASSIC_YEAR`, `MAX_PLAUSIBLE_APPROVAL`,
`STATUS_TARGETS`.

After changing any of them, `pnpm data:build` then `pnpm stats` — the
dashboard's «Статус» and «Рейтинг» cards are the fastest way to see a build
that has quietly collapsed everything onto one value.

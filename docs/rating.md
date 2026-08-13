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
| `reach` | `views / videoCount / subscribers` | did it travel past its channel |

The design rests on these being independent. Measured over the catalogue,
approval and retention agree at **−0.04** — knowing one tells you nothing about
the other, so together they say roughly twice as much as either alone.

`retention` and the curve behind it come from `videos.views`, which the crawl
has stored all along — 588 591 rows, no extra quota. `reach` needs
`channels.subscribers`, which `pnpm data:subscribers` fetches; `channels.list`
costs one unit per call whatever `part` asks for and takes fifty ids at a time,
so the whole catalogue is single digits of quota.

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
a course at all. A channel's «Astronomy» bucket is entered from search at a
random point; its retention is an artefact of arrival, not of staying.

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
bucket, and the explanation for its otherwise puzzling high retention: its
videos are searched for individually, not watched through.

Two corrections are applied. **67 playlists run newest-first**; read literally
their audience grows towards the end, so `isReversed` detects a clear majority
of decreasing dates and inverts the ratio. Playlists in no date order at all —
about half the catalogue — are left alone, because position is the order they
are watched in regardless of when they were filmed. And **an `assorted`
playlist's retention is not scored at all**: it is not a fact about staying.

Checked and found not to matter: the tail being recently uploaded (median
retention 0.446 for tails under 6 months versus 0.418 for tails over 3 years)
and playlist length (0.406 at 6–12 videos, 0.378 at 100+).

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
| views | −0.25 | 0.14 |
| video count | −0.22 | **−0.04** |
| language (ru) | 0.31 | **0.04** |

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

| Status | Condition | Share |
|---|---|---|
| **Мало данных** | `views < 1000` or `views/lecture < 150` | 6.0% |
| **Новый** | last upload under 120 days ago | 2.9% |
| **Подборка** | curve is `assorted` | 16.7% |
| **Отличный** | both signals measured, neither below its peers, top of the rating | 7.1% |
| **Классика** | recorded ≤2016 and still reaching | 4.4% |
| **Досматривают** | widest margin on retention | 5.3% |
| **Нравится** | widest margin on approval | 6.2% |
| **Обсуждают** | widest margin on discussion | 4.9% |
| **Разошёлся** | widest margin on reach | 5.7% |
| *(no badge)* | cleared nothing | 40.7% |

Every single-scale word additionally requires the rating not to be negative, so
that a playlist two sigma below its peers on approval is never complimented for
travelling far.

`«Подборка»` sits above the earned words on purpose. «Нравится» on a channel's
878-video «Biology» bucket is true and useless; what a reader needs first is
that it is not a course to work through. Left at the foot of the ladder, the
head of the sorted catalogue filled with well-liked buckets wearing course
words.

### Thresholds

Set as **shares of each rung's own candidates** (`STATUS_TARGETS`), recomputed
every build and written into `meta.json` so what a word cost is always
checkable. Shares rather than fixed cut-offs because a z of 1.2 means whatever
this year's population makes it mean; shares of candidates rather than of the
catalogue because the rungs overlap and a quantile over everyone is met mostly
by playlists another rung has claimed.

The aim is that no word is so rare a reader never learns it and none so common
it says nothing. Everything currently lands between 2.9% and 16.7%.

## What this still cannot do

- It measures audience response, not teaching. About **27%** of approval is
  explained by which channel a playlist is on rather than which playlist it is.
  NPTEL stays low because its audience likes rarely, not because its lecturers
  are worse. Normalising that away entirely would also destroy the ability to
  compare thirty-nine channels inside one course, which is the point.
- High retention on an `assorted` playlist and high retention on a course are
  not the same thing, and the curve can tell them apart only statistically.
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
`CLASSIC_YEAR`, `MAX_PLAUSIBLE_APPROVAL`, `STATUS_TARGETS`.

After changing any of them, `pnpm data:build` then `pnpm stats` — the
dashboard's «Статус» and «Рейтинг» cards are the fastest way to see a build
that has quietly collapsed everything onto one value.

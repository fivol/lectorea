# Data problems, and what they turn out to be

[← agents](README.md) · what the catalogue keeps doing that no amount of reading
the code would predict

Everything below was found the hard way. **None of it is a code bug you can find
by reading code** — they are all properties of the data, or of the fit between
the data and rules that are individually correct. Each entry cost somebody an
hour to find, and most of them look like nothing until you know the shape.

This is the half of an iteration that is worth reading before starting one;
[iteration.md](iteration.md) is the half that says what to run.

---

## A tie silences both courses

Two courses owning the same phrase makes `matchSegment` decline **both**, by
design: an equally specific claim from two courses is exactly the ambiguity a
human should see. It stops being right the moment one of the two copies is
redundant.

`«climate»` sat under both `meteorology` and `climatology`. The visible symptom
was not "climate titles go to review" — it was that no climate title reached
either course, and both looked thinner than they were.

Find them all:

```bash
pnpm exec tsx -e "
import { buildKeywordIndex } from './scripts/lib/rules.ts';
import { loadSources } from './scripts/lib/sources.ts';
const byPhrase = new Map();
for (const e of buildKeywordIndex(loadSources())) {
  const s = byPhrase.get(e.phrase) ?? new Set(); s.add(e.courseId); byPhrase.set(e.phrase, s);
}
for (const [p, s] of byPhrase) if (s.size > 1) console.log('«' + p + '» → ' + [...s].join(', '));
"
```

Fifteen on 2026-08-14, of which eleven remain and **should** — judge each one
rather than clearing the list. `entropy` (thermodynamics / information-theory),
`einstein` (special / general relativity), `parsing` (compilers / computational
linguistics), `prosody` (phonetics / poetics) are genuinely ambiguous, and a
title carrying only that word really is a question for a person.

The four that were resolved had a specific course that should simply win:
`climate` → `climatology`, `spectroscopy` → `molecular-spectroscopy`,
`sequence alignment` → `sequence-analysis`, and `algebra` split by language
([matching.md](../scripts/matching.md#how-the-rule-pass-decides)).

The test is not "is this word ambiguous in English" but **"does one of these two
courses own it, with the other holding a redundant copy"**.

### And the tie a *new* course creates is where the old one was standing in

Adding 17 courses on 2026-08-17 took 40 bindings from wrong to nothing on the
first probe, and every one of them was a tie the addition had just made. The
reason is in `data/aliases/*.json` rather than in the keywords: a course the
catalogue lacks does not go unmatched, it gets filed under the nearest one and
somebody writes the missing name down as an alias of it.

| the alias | was standing in as |
|---|---|
| «Гомологическая алгебра» | `category-theory` |
| «Аналитическая геометрия» | `linear-algebra` |
| «Методы математической физики» | `pde` |
| «Тепломассообмен» | `transport-phenomena` |

So **adding a course means taking its name back**, from `aliases` and from
`keywords` both, and the aliases are the half that is easy to miss because
nothing about a keyword list mentions them. With the four moved, the same probe
read 364 gained, 8 lost, 37 rebound.

The eight that stayed lost are the honest kind and were left alone: «Data
Analytics with Python» is genuinely claimed as hard by `programming-intro` and
`data-science` at once, which is a question for a person and not for a rule.

One case ran the other way and is worth keeping: «Уравнения математической
физики» **is** the Russian name of the PDE course, not of mathematical physics,
so `pde` kept it and the new course took only «Методы математической физики».
The gap analysis suggests the split; the curriculum decides it.

The eighteenth course, `power-electronics`, was added an hour later with the
rule already known — its name taken back from `power-systems` in the same edit —
and the probe read **0 lost, 28 rebound, nothing emptied** on the first run.
That is what the check costs when it is done in the right order.

## A blank row in the queue is not a hard case, it is a missing title

The review queue is sorted by views and read from the top, so a playlist with no
title at all reads as one nobody has got to yet. 3252 of them were something
else: playlists whose lectures had been crawled — paid for, at two units per
fifty — before the metadata call that buys the title, after which the video pass
pushed `next_refresh_at` a month out and the title could not be bought at all.
Nothing can classify a playlist by its id, so they were permanent.

Two things make it visible rather than fixed-once:

```bash
pnpm tsx scripts/_sweep.ts          # counts them, writes nothing
pnpm tsx scripts/_sweep.ts --write  # makes them due, and drops ids that cannot be ids
```

and the count is worth glancing at whenever the queue looks larger than the work
in it. The pass that caused it no longer does
([pipeline.md](../pipeline.md#a-pass-may-only-defer-the-call-it-makes-itself)),
but the shape recurs: **any step that writes a column another step reads for
due-ness can starve it silently.**

## The other loose keyword: the one that wins, wrongly

`_noisy.ts` finds keywords that never win. The mirror image is worse and was
invisible until `_winners.ts` was written to ask for it: a keyword that wins
confidently on titles that have nothing to do with the course. It costs no
review time at all — it publishes.

```bash
pnpm tsx scripts/_winners.ts
```

Read as a list, the bad ones give themselves away: under a good keyword the
sample titles all name one subject, under a bad one they have nothing in common.
2026-08-15 turned up `genre` holding 1241 tracks of house music under literary
theory, `classical music` holding two record collections under its history,
`stars` holding «Dancing With The Stars», `crime` holding «British Pathé.
Crimea», `motivation` holding a talk on Gaussian multiplicative chaos, and
`micro` holding seven micro:bit playlists under microeconomics.

None of them wanted deleting — all six are things a person might reasonably type
into the search box. They wanted `?` in front, which keeps the word for search
and hides it from the rules
([matching.md](../scripts/matching.md#how-the-rule-pass-decides)).

Before adding a refusal instead, price it:

```bash
pnpm tsx scripts/_markers.ts             # clears / costs, per candidate word
pnpm tsx scripts/_markers.ts tutorial    # and the titles on both sides
```

The second column is what the word would take out of the catalogue as it
stands. `tutorial` would have cleared 345 from the queue and cost 25 published
bindings, which is why it is not a refusal: most of those 25 are programming
courses this catalogue does carry.

## A loose keyword costs nothing visible and plenty invisible

```bash
pnpm tsx scripts/_noisy.ts 6
```

Keywords that claim clauses and never once win confidently. `«survey»` under
`field-archaeology` had claimed land surveying, drone surveying, the Washington
Geological Survey and four surveys *of English literature*. It never bound
anything, so the catalogue looked fine — and the damage was real in two places
the catalogue does not show: the review queue, and the video queue's tiers,
which is quota.

Removing eight such keywords cost **zero** bindings and gained two. If a keyword
has never won, it is not load-bearing.

Two shapes to watch for:

- **A word that is also a refusal.** `«interviews»` was a keyword of
  `social-research-methods` *and* a `NOT_A_COURSE` trigger, so it could never
  match anything by construction.
- **A short English abbreviation.** `«prob»` matched «**Prob**lem Sets» and
  «**Prob**e Microscopy», because `findPhrase` tolerates three trailing letters
  for Russian inflection and that tolerance does not know which language it is
  in. Under about six characters, English keywords are dangerous.

## Russian inflection: the tolerance is three letters *after* the phrase, and that is masculine nouns only

`findPhrase` allows a short tail on the **end of the whole phrase**. That is not
"it handles inflection": it handles inflection whose nominative is a *prefix* of
the oblique form, and in Russian that is the masculine declension and nothing
else.

| stored | reaches | why |
|---|---|---|
| «анализ» | «анализа», «анализом», «анализе» | ✓ the nominative is a prefix |
| «язык» | «языка», «языком» | ✓ |
| «алгебра» | «алгебрах» ✓, «алгебры» ✗ | the final `а` *changes*, so nothing is appended |
| «химия» | «химии» ✗ | the same, and this is every subject in `-ия` |
| «физика», «биология», «логика», «математика» | their genitives ✗ | — |

So the whole feminine half of the catalogue's subject names — which is most of
them — is invisible in the genitive, and the genitive is the case a Russian
title puts the subject in: «Полный курс школьной **химии**», «Основы
**биологии**», «Уроки **математики**». Store the genitive beside the nominative
and stop expecting the tolerance to derive it.

This page said the opposite until 2026-08-19 («so «алгебра» finds «алгебры»»),
which is worth remembering as a shape: a rule's comment describes the case it
was written for, and «short tail» quietly became «inflection» in the retelling.

It does nothing either for a multi-word phrase whose *first* word inflects: the
stored «дискретная математика» does not find «Основы **дискретной математики**»,
and «квантовая механика» does not find «Математические основы **квантовой
механики**».

Measured ceiling for the whole class: **194 playlists, about 4% of the
`no-phrase` bucket** — and a stem-tolerant match also produced visible false
positives («Летняя школа по биоинформатике» → bioinformatics, a summer school).
So the decision stands: **no stemmer; add the oblique form by hand**, exactly as
`data/keywords/*.json` says at the top of the file.

Add the genitive when a course keeps appearing in one:
«дискретной математики», «квантовой механики», «теории чисел», «мировой
литературы», «робототехники».

## A school subject is not published under the university's name for it

Seven courses sit at `stage: school-*` — `school-algebra`, `general-chemistry`,
`general-biology`, `astronomy-intro`, `ancient-history`, `logic-intro`,
`programming-intro` — and every one of them is *named* by a university and
*filmed* by a school. The catalogue calls the course «Общая химия»; the material
is «Полный курс школьной химии», «Химия 8 класс», «Химия для школьников»,
«Уроки химии». Not one of those contains the phrase «общая химия».

The qualifier is also most of the clause, so even where the head noun does
survive, coverage puts the match at 0.6 and it never publishes — the faculty
pattern [below](#the-russian-faculty-title-pattern) with a different qualifier.

`school-algebra` had the whole school vocabulary written out by hand from the
day it was added («школьная алгебра», «алгебра 7 класс», …) and the other six
never got it. That asymmetry is the tell: **anything one course has by hand and
its six siblings lack is a rule that should have been read off a field.** It is
now generated from `stage` in `lib/rules.ts` (`SCHOOL_FORMS`), so a school
course added next year arrives with its vocabulary, and the search seam asks
school-worded questions from `lib/questions.ts` for the same reason.

+56 confident bindings on 2026-08-19, −2, and the two are honest ties. What the
generator cannot supply is the genitive of the noun — see
[above](#russian-inflection-the-tolerance-is-three-letters-after-the-phrase-and-that-is-masculine-nouns-only)
— so «химии», «биологии», «математики», «логики», «астрономии»,
«программирования», «информатики» are written beside their courses in
`data/keywords/ru.json` and every template then reaches them.

### And the level qualifier is not noise, however much it looks like one

The obvious fix is one line: put «школьн\p{L}*» and «N класс» in `NOISE`
beside «введение» and «полный», and every school title collapses to its subject.
It was implemented, measured and reverted the same hour: **−55 bindings.**

Two reasons, and the second is the one worth keeping. Stripping the qualifier
from a *title* strips it from the *keyword* too — `buildKeywordIndex` cleans
both — so «школьная алгебра» became «алгебра», which `abstract-algebra` already
owns, and [a tie silences both](#a-tie-silences-both-courses): 40 МГУ and НМУ
algebra recordings went to nobody. And the discriminator was the thing being
thrown away — «Алгебра 8 класс» is school algebra *because of* the words the
noise pass was about to delete.

**A qualifier is only noise when no course of the catalogue is told apart by
it.** Where two courses share a head noun and differ by level, it is the whole
signal.

## A seam's yield is capped by the rule pass, not by the seam

«Полный курс школьной химии» was **found by search and thrown away by matching**,
and every visible number said otherwise. `_hunt.ts` refuses a candidate whose
title no course claims (`accept: 'unclaimed'`), because the rule pass reads
nothing but the title and no later run decides differently — so an unclaimed
playlist is 2.3 units for something the site can never show. Correct, and it
means the search seam can only bring in what the keywords already recognise.

Measured on 2026-08-19, asking the catalogue's own questions about
`general-chemistry`:

| question | where the playlist ranks |
|---|---|
| «Общая химия лекции» — the only one ever asked | **21st of 50** |
| «Химия школьный курс» | 1st |
| «Общая химия школьный курс» | 4th |
| «Химия для школьников», «Химия уроки» | 7th |
| «Общая химия видеолекции» | absent |

So the seam had done its job a fortnight earlier and the report threw the row
away. Two consequences:

- **Teach the rules before spending on the seam.** A hunt run against keywords
  that cannot name the material buys 100 units a question and files the answer
  under `unclaimed`.
- **"We never found it" and "we found it and dropped it" look identical from
  `cache.db`,** which holds neither. `scripts/_reachable.ts` is the tool that
  separates them, and the separation is the whole diagnosis: one is a phrasing
  in `lib/questions.ts`, the other a keyword.

## A playlist added by hand waits behind everything the crawl mined

`seedManualMatches` makes a hand-bound playlist *due* immediately and its own
comment calls it "the most valuable metadata the next run can buy". Due-ness and
ordering are different things: the metadata scan sorted titleless rows by
`published_at IS NULL` and then by views, and a playlist whose videos had
already been walked has both a `published_at` and a view count — so it sorted
*behind* 3321 anonymous mined rows and could not buy the 1/50th of a unit that
gives it a name. Its videos, at 2.3 units, had been fetched the same minute.

Now `channel_id = 'proposed'` — the hand-added marker, and not `imported`, which
is a wide seam with no claim on the front of the queue — sorts first in
`refreshPlaylistMetadata`. The shape recurs and is the same one
[the blank rows](#a-blank-row-in-the-queue-is-not-a-hard-case-it-is-a-missing-title)
came from: **a step that makes a row eligible has not made it reachable.**

## The Russian faculty title pattern

Every philology faculty titles its courses «X современного русского языка», and
the qualifier is two thirds of the clause — so coverage puts a correct match at
0.6 and it never publishes. «Морфология современного русского языка» is
morphology and had been refused for months.

Add the whole phrase, not the head word. The same applies to any pattern where a
standing qualifier outweighs the subject.

## A thin course is as likely to be a matching problem as a coverage one

`Appreciating linguistics: A typological approach` — 66 lectures, already
crawled, already paid for — sat bound to `linguistics-intro` at 0.68 while
`typology` showed two playlists and got a channel hunt aimed at it.

**Check the cache before hunting.** For any course that looks empty, search its
subject in *both* languages — the material is titled in the language its author
speaks, not the one the course is filed under:

```bash
pnpm exec tsx -e "
import { openDb } from './scripts/lib/db.ts';
const db = openDb({ readonly: true });
for (const term of ['%typolog%', '%типолог%'])
  console.log(db.prepare(\`SELECT p.title, p.video_count, m.course_id, m.confidence
    FROM playlists p LEFT JOIN matches m ON m.playlist_id = p.id
    WHERE p.alive = 1 AND lower(p.title) LIKE ? AND p.video_count >= 8\`).all(term));
"
```

Both of `typology`'s near misses sit at 0.68 — one clause short of publishing,
and invisible to anything that only counts what the course already has.

## `matches` is not the record — `overrides.yaml` is

A hand-bound playlist keeps whatever stale guess a pass last wrote, **for ever**:
`unmatchedPlaylists` filters overridden rows out, so nothing ever revisits them.
«Теоретическая механика» still reads `mechanics @ 0.6` in the table while the
committed answer is `analytical-mechanics`, and both are correct — the table is
simply not where the answer lives.

Any tool that judges bindings must read both. `_noisy.ts` was wrong for exactly
one iteration for want of this, and reported the best keywords in the file as
the worst.

## A course can be empty because nobody looked, not because nothing exists

`field-archaeology` was recorded on 2026-08-13 as having no channel that clears
the bar in either language. It has a forty-lecture ordered course, on an Indian
university's SWAYAM channel, which no search had been pointed at.

Before recording a course as impossible, say **where** you looked. «No Western
field-school channel publishes a method course» is a finding; «field archaeology
does not exist on YouTube» was not.

## …and a course can be genuinely empty, and must be left that way

`poetics` had two channels added for it and stayed at zero. What they teach is
poetry — «Lectures on English Poetry», «A Survey of English Poetry» — and a
poetry survey is a literature course, not a course on verse theory. Binding them
would have closed the number and emptied the meaning.

**Do not fill a course by widening what it means.** `lib/rules.ts` is biased
towards refusing because a wrong binding sits in the catalogue and misleads,
while a refusal costs one person one minute. Hand decisions inherit that bias.

(It was finally filled on 2026-08-15, by a search that found four playlists
actually about poetics — which is the shape the rule predicts: the course waits
until the right material exists, rather than being fed the nearest thing.)

## Refuse a channel for its unit, not for its size

Channels clear the bar on quality and are refused on arithmetic. Vidya-mitra
(1072 playlists of 10+, behind discipline bins of 3100 videos) and МИАН (236,
mostly общеинститутский семинар and летние школы) were refused twice, on
2026-08-14 and again on 2026-08-15.

All of them own material the catalogue wants. The question is not "is this
channel good" but **"is the thing this channel publishes the thing the catalogue
stores"** — one semester, in order. When the answer is no but two playlists are
right, `pnpm playlist:add` costs one unit and the channel costs thousands.

The 2026-08-15 hunt reversed one of these: Virtual University of Pakistan was
refused in August for topic dumps and added after its 466 course-coded playlists
were read again. **A refusal is a judgement about what was seen, not a permanent
verdict** — but reversing one means reading the titles again, not remembering
differently.

## Twenty-four playlists of one course are four semesters read to four streams

`discrete-math` holds 24 ИТМО recordings, and the shape of them is the shape of
a lot of the Russian catalogue. Read as a list they look like a channel dumping
everything it has; they are two independent facts multiplied together.

**The course really is four semesters.** The topics of one run are disjoint,
which is the only proof that settles it — `s1` sets, Boolean functions, Post,
circuits, coding, Burnside–Pólya; `s2` probability, Markov chains, automata,
context-free grammars; `s3` graphs, random graphs, matroids; `s4` generating
functions, computability, Turing machines. 78 ч over 56 lectures, against 33 ч
for MIT 6.042J. Not one term stretched over four: it carries what a Western
curriculum splits into discrete maths, theory of computation and an information
theory course, and drops number theory, which ИТМО reads separately.

**And each of the four semesters is read to several streams at once**, by
different lecturers, all filmed and all published to the same channel. So
`[s1] … Васильев` and `[s1] … Станкевич` are not two parts of anything — they
are the same semester twice, and their lecture titles agree line for line for
the first eight lectures. Васильев, Станкевич, Голиков and Клёпов are four
readings of one programme, not four courses.

**The corollary for anything that counts.** A course with 4 semesters × 4
lecturers × several intakes generates a couple of dozen playlists and one
syllabus, so playlist count says nothing about how much distinct material a
course has. Ask how many *runs* it has, and how long one run is. What broke the
naive read of this course was the assumption that a channel with 24 recordings
of one subject was hoarding duplicates.

## `year` is the first video's date, and that is not the year the part was read

Two different things pull them apart, and only one is a problem.

**The title carries the intake, the videos carry the calendar.** ИТМО writes
`[s2 | 2024]` for semester two of the *2024 intake*, filmed in spring 2025 — so
every even semester's title is a year behind its own videos. 35 of the 240
titles that carry a year in the crawl disagree with the year computed from
their first video, and they are almost all this. **Do not reconcile them.**
`follows()` in `scripts/lib/series.ts` is built on the calendar year — semester
n of an intake starting in Y is read in Y + ⌊n/2⌋ — and reading the year off the
title instead would break every chain at its first spring semester.

**A channel patching a new stream's playlist with old recordings does break the
chain.** `[s4 | 2022] Дискретная математика, А.С. Станкевич` has videos titled
«ДМ y2020-2к-л1» in it, so its first video is dated 2021, so it chains onto the
`s3` of the 2019 intake instead of standing with the 2022 one. The tell is
inside the playlist rather than on it: the lecture titles use two naming
conventions at once, one of them naming a different year. Nothing detectable
from the outside, which is why this is here and not in the build.

## The unit is the semester, in both directions

A channel publishing one playlist per *chapter* binds every fragment as
confidently as the course itself, because each fragment names its course in a
clause of its own: «CPU Scheduling | Chapter 5 | Operating System». The course
then shows sixteen entries that are each a sixteenth of itself. 171 of these
were live before `NOT_A_COURSE` learned the shape.

The mirror image is a channel publishing one playlist per *lecturer* or per
*year* — «Lectures 2019», everything this professor ever gave. Both fail the
same test.

## A playlist's owner is not its author

Search and mined links both bring in playlists that name a subject, run to fifty
videos, and were assembled by somebody who made none of them. The rule pass
cannot see this — it reads the title — and the crawl would file the course under
whoever collected it.

`playlistItems.list` carries the owner of each video for one unit, and 43% of
what passed every free filter on 2026-08-15 failed here: 611 collections and 282
mirrors. The mirrors are worth more than the playlists were:
[harvest.md](../harvest.md#a-playlist-is-not-a-course-because-it-is-called-one).

**Any playlist bound to a course by a channel that did not make its videos is
attributed to the wrong provider** — the signal is worth having outside a hunt.

That last line became a pipeline step on 2026-08-16 — `data:authors`, which asks the same
one-unit question of what is **already published** rather than of candidates.
The catalogue answered far better than search does: of 682 probes, 631 own their
material, 34 are mirrors and 17 were collections. **92% against the hunt's 5%** —
the crawl seams are clean and the search seam is not, which is the argument for
running them in that order and not the other way round.

## The rules are not "12% wrong" — they are blind to unstructured sources

The 2026-08-16 reading of all 5469 published bindings refused 24% of them, and
the useful part is not the average but its **variance by source**:

| Source of the batch | Refused of 150 |
|---|---|
| NPTEL / IIT (coded semester courses) | 0 |
| МГУ, ВШЭ, МФТИ (per-semester recordings) | 3–4 |
| MIT / Stanford (courses plus everything else the channel makes) | 24 |
| mixed and mined | 35–68 |
| Khan Academy | 124 |

So the rule pass is not uniformly unreliable. It is **excellent where a channel
publishes one semester per playlist and blind where it does not** — and the
shapes it cannot see are the same three every time: a *unit* of a course
published as a playlist, a subject that is a homonym of another course, and a
vendor dump or event archive wearing a subject name.

Two consequences worth keeping:

- **Judge a seam by its unit, not by its prestige.** Khan Academy is excellent
  teaching and almost entirely unusable here, because its unit is a topic. MIT
  OpenCourseWare is the same institution as MIT's «How We Teach» talks.
- **A vetted channel is not a clean channel.** `_authors.ts` skips vetted
  channels for free because they own their material — which is true and says
  nothing about whether what they publish is a semester.

## English plurals: store the singular, and only when the phrase has two words

`findPhrase` tolerates three letters on the right edge for Russian inflection,
which means a stored **singular finds the plural for free** and a stored plural
can never find the singular. «electrical circuits» could not see any of the
23 «Electrical Circuit I» playlists a Bangladeshi university publishes every
semester.

The fix is one-directional and the trap is that it looks general. **It is safe
only for multi-word phrases**, where the qualifier pins the head noun down. On a
one-word keyword the same three letters walk straight into another word:

| stored | singular | what it then reaches |
|---|---|---|
| `graphs` | `graph` | «Computer **Graph**ics» |
| `genes` | `gene` | «**Gene**ral Biochemistry» |
| `mechanics` | `mechanic` | «**Mechanic**al Vibrations» |
| `statistics` | `statistic` | «**Statistic**al Mechanics» |
| `rocks` | `rock` | «**Rock**et Propulsion» |
| `ethics` | `ethic` | «**Ethic**al Hacking» |
| `flows` | `flow` | «Compressible **Flow**» under graph theory |

Thirteen multi-word singulars added on 2026-08-16 (`data structure`, `computer
network`, `control system`, `complex variable`, `differential equation`,
`neural network`, …) bought about 70 bindings and lost nothing. This is the same
rule [above](#a-loose-keyword-costs-nothing-visible-and-plenty-invisible)
already states from the other side — under about six characters, English
keywords are dangerous — and the reason is the same tolerance.

## A course cannot be told from a topic bin by its size

The obvious fix for «Biology» with 878 videos is a ceiling: a semester is at
most ninety lectures, so refuse above some number. It was measured on
2026-08-16 and **the distributions are the same on both sides**:

| | median | p90 | p95 | p99 | over 100 | max |
|---|---|---|---|---|---|---|
| on a vetted channel | 16 | 59 | 91 | 250 | 4.5% | 2466 |
| off any vetted channel | 23 | 79 | 111 | 215 | 6.0% | 1432 |

A ceiling would cost as much real material as it removed rubbish, and the
vetted side has the larger maximum. **Size is not the signal; authorship is** —
which is why the answer is `data:authors` and a unit, not a constant.

## YouTube's subtitles: three dead paths and one live one

Measured 2026-08-18, on `YeyrH-Oc2p4` (MIT 18.06SC, manual English captions)
and `Z0sqQzeWzig` (an 87-minute Russian lecture, automatic ones).

| Path | What it does now |
|---|---|
| `api/timedtext?v=…&lang=en` | `200`, and **zero bytes** |
| the signed `baseUrl` out of `captionTracks` on the watch page | the URL is there; fetching it is **zero bytes** — `xml`, `json3` and `vtt` alike |
| `yt-dlp` with its defaults | `has no subtitles`, and says why: *a PO token was not provided* |
| `yt-dlp --extractor-args "youtube:player_client=android"` | **works**, about 4 seconds a video |

The middle row is the one worth remembering: the signed URL *out of the page
itself* is as empty as the naive one, so no amount of scraping gets a browser
the text. Nothing client-side will ever have it, which is why «Спросить» ships
the command rather than the transcript ([interface.md](../interface.md)).

The live path, whole:

```bash
yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "ru" --sub-format vtt --extractor-args "youtube:player_client=android" -o "%(id)s.%(ext)s" "https://youtu.be/VIDEO_ID"
```

`ios` works as well; `mweb`, `tv_embedded` and `web_embedded` are all refused
outright. **Treat the flag as a moving target** — a year ago bare `timedtext`
worked, and today the *signed* one does not. The fallback not taken is
`--cookies-from-browser`, which reads the developer's own browser session.

### `captions: []` does not mean there is no transcript

The field is filled from `contentDetails.caption`, and the API counts only
tracks **a human uploaded**. `Z0sqQzeWzig` is `captions: []` in the catalogue
and has a complete Russian automatic transcript. So anything asking for
subtitles asks for the recording's own language whatever the field says, and
leans on `--write-auto-subs`; the field is good for the «с субтитрами» filter,
which is about quality, and for nothing else.

### The raw file is several times the text in it

Automatic captions come as a rolling two-line window — each cue repeats the
tail of the one before — with per-word timing tags inside every line:

| | raw VTT | one line per cue, deduped |
|---|---|---|
| 10-minute lecture | 43 KB | 5.7 KB |
| 87-minute lecture | **780 KB** | 144 KB, 2000 lines |

A 2-minute window is about **7 KB**, which is the size worth handing anybody —
and it is taken *behind* the timecode rather than around it, because the reader
has not seen what comes after. Never pass a raw VTT of a long lecture to a
model.

### Why this is not in the pipeline

5800 videos at 144 KB of cleaned text is not a static catalogue any more, and
the extractor flag above would put a nightly cron on a footing that breaks
without anybody noticing. The prompt hands the command to the reader's own
assistant instead, which costs nothing to ship and ages better.

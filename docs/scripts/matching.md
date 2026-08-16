# Matching playlists to courses

[← all scripts](README.md) · how a crawled playlist finds the course it belongs
to, and what happens to the ones that do not.

Working through the ones that did not is
[agents/iteration.md](../agents/iteration.md) — the
diagnostics, the order to fix things in, and the mistakes that page exists to
stop being made twice.

## `pnpm data:match`

Decides which course a crawled playlist belongs to. A cascade, cheapest first —
rules over titles and the synonym dictionary in `data/keywords/{lang}.json`,
then optionally the LLM, then a human.

Rules only, free, no network beyond the database:

```bash
pnpm data:match
```

Adds the model pass; needs `OPENAI_API_KEY`:

```bash
pnpm data:match --llm
```

Re-reads everything, after a change to the rules:

```bash
pnpm data:match --force
```

Anything that lands below confidence 0.75 — including every case where two
courses claim the same title, which is *declined* rather than guessed — is left
for `data:review`. A below-threshold guess is not an answer, so it is passed on
to the model as a hint rather than kept to itself; the model's answer is only
taken when it beats what the rules already had. Results go into the `matches`
table, not into YAML.

What the model is shown, per playlist: the title, the channel **by name**, the
video count, 400 characters of description, the first five lecture titles, and
the rule's own guess where there is one. What it is shown once, per request: the
courses as `id · name · field`, since `topology` reads the same whether the
catalogue files it under mathematics or geography. Twenty playlists a request,
six requests in flight — thirty thousand playlists is fifteen hundred requests,
and one at a time is a working day of waiting on round trips. The run prints the
tokens it spent, so the number is in the log rather than in a bill.

`--force` re-reads the playlists earlier passes already bound confidently — and
the ones they refused — which is otherwise the one thing this step leaves alone.
A change to `lib/rules.ts` or to `keywords/{lang}.json` otherwise reaches nothing
already decided, which is exactly what such a change is usually written to
correct. It can take a binding back as well as add one. Hand decisions are never
touched: `reviewed` rows and `overrides.yaml` outrank every pass.

Model choice is `OPENAI_CLASSIFY_MODEL` (default `gpt-5-mini`).

## A refusal is an answer, and is written down

A pass that can only ever say *yes* leaves a queue that only grows. On
2026-08-15 that queue held **35 148 playlists** — every playlist the crawl had
ever met and not bound — and the overwhelming majority were music videos and
tutorials mined out of a description. Nobody was ever going to read it, so the
few hundred real questions inside it were lost, and every model run paid again
to re-read the same karaoke.

So `matches.refused` records the difference between the ways of saying no:

| verdict | means | where it goes |
|---|---|---|
| `undecided` | a course is named, weakly or ambiguously | the review queue |
| `not-a-course` | the title says homework, music video, open day | recorded: out of the queue, last in the video queue |
| `unclaimed` | no course of this catalogue is named in the title at all | recorded, for a different reason — below |
| `no-title` | metadata has not arrived | nothing is written; there is nothing to judge |

**Why `unclaimed` is recorded rather than queued.** `data:review` works by
offering the courses a title might mean, and for a title that names none of them
it has nothing to offer: the reviewer would be searching 206 courses by hand for
a playlist called «Juice WRLD Freestyles». Of the 33 376 still waiting once the
crawl of 2026-08-15 had recorded its support-material refusals, 24 808 were
that — and the 8568 that were real questions could not be seen inside them.

What such a title actually needs is a keyword or a new course, and those are
found by reading titles **in clusters** rather than one at a time —
`pnpm tsx scripts/_refusals.ts no-phrase`, which reads the rules over the titles
and goes on seeing refused rows. So nothing is lost from the workflow that grows
the catalogue; what is lost is a queue nobody could read.

Both are lifted the moment the ground changes: `--force` re-reads every refusal
after a keyword or a course is added, and `01-discover.ts` clears `unclaimed`
for a channel the moment somebody vets it in `channels.yaml`.

The model writes a refusal too, when it has read the title, the description and
the first five lecture names and answers that this is none of the catalogue's
courses.

It is not a hand decision and does not pretend to be one: **`--force` re-reads
refusals**, which is what a new course or a new keyword needs, and `reviewed`
rows and `overrides.yaml` are untouched by any of it. The tiers in
[pipeline.md](../pipeline.md#quota) read the column too, so a refusal defends
the quota as well as the queue — the bins are the long playlists.

## How the rule pass decides

The rule lives in [scripts/lib/rules.ts](../../scripts/lib/rules.ts) and is
biased towards refusing: a playlist it declines costs someone a minute in
`data:review`, while a playlist it binds wrongly sits in the catalogue and
misleads.

Four things shape the answer.

**Word boundaries, not substrings.** A keyword has to match as a word, with a
short tail allowed for Russian inflection — «алгебра» still finds «алгебры», but
`logic` no longer finds «bio**logic**al Chemistry» and `evolution` no longer
finds «The American R**evolution**». Both were real bindings before this. The
tail is letters only: an ending is inflection, a digit is another course, so
`algebra 1` does not find «ALGEBRA 16».

**A word can be search-only.** `data/keywords/{lang}.json` is read by search and
by this pass, and they want opposite things from the same word: «genre»,
«micro», «stars», «crime», «classical music» are all reasonable things to type
into a search box and all ruinous as rules. Writing the value as `?genre` keeps
it for search and hides it from the index here. That replaced deleting the word,
which answered the matcher by making the catalogue unsearchable for half of what
it holds — and until 2026-08-15 those five had bound 1241 tracks of house music
to literary theory, seven micro:bit playlists to microeconomics, «Dancing With
The Stars» to astrophysics and «British Pathé. Crimea» to criminal law.

**And a name that collapses to one word is not a name.** Course names and
aliases go through the same noise pass as titles, so «Introduction to Language»
— a fair alias for linguistics — arrives in the index as `language`, which then
owns «GO Language» and «C Language tutorials» outright. A name of three or more
words that comes out as one is dropped: whatever it meant lived in the words the
noise pass removed, and a catalogue that wants the bare word can always write it
into `keywords` on purpose.

**Noise is stripped first.** `MIT 18.06SC Linear Algebra, Fall 2011` is measured
as `linear algebra`. Course codes, terms and years go, and so do the words that
say who is teaching rather than what — `mit`, `stanford`, `мфти` — and the ones
every syllabus shares: `introduction`, `of`, `the`, `course`. All of it happens
before normalisation, while the dots are still there — otherwise `18.02` becomes
`18 02` and is indistinguishable from the `2` in «Математический анализ 2», which
decides which course that is. «часть» is stripped and its number is kept, because
«Матанализ. Часть 2» *is* «Матанализ 2»; «2 курс» is stripped whole, because it
says which year a student takes the course, not which course it is.

The same stripping runs over the keywords themselves. Both sides have to agree,
or a keyword written «theory of computation» stops matching every title that has
just had its `of` taken out.

**A title is read in clauses.** «Дискретная математика | Роман Глинских | осень
2021» is a subject, a lecturer and a term, and coverage is asked of the first
alone. Commas, brackets, pipes, dashes and a full stop before a word all divide;
so do `with` and `by`, which introduce a name. Without this the measure answers
the wrong question — a real subject padded out with a lecturer scores like a
passing mention, while «линейное программирование», which really is a passing
resemblance, scores like a subject.

**Confidence follows coverage of the clause.** Nearly all of it is 0.92, most of
it 0.82–0.88, about half 0.68–0.72, a passing mention 0.6; a clause that is
exactly the keyword is 0.95. The bar sits high because names and years are
already gone: what is left beside the keyword is usually a word that renames it.
«Линейное программирование» is not programming, «pre-algebra» is not algebra and
«tensor calculus» is not calculus — all three used to clear the bar.

**Two subjects mean no answer.** When another course claims a different span of
the same clause, or another clause names a second subject just as convincingly,
the playlist goes to a human: «Psychology and Economics», «Graph Theory and
Additive Combinatorics». Adjacent words are exempt, since in «multivariable
calculus» the two keywords describe one thing rather than two.

The same rule fires when two courses own a phrase outright, and there it is a
sharper instrument than it looks: **a tie declines both courses, so a keyword
duplicated between them silences the pair.** That is right when the word really
is ambiguous — `entropy` belongs to thermodynamics and to information theory,
`einstein` to both relativities — and a plain mistake when one of the two copies
is redundant. `algebra` was a keyword of `school-algebra` *and*
`abstract-algebra` until 2026-08-14, and the effect was not that bare «Algebra»
went to a human: it was that every «College Algebra», «Algebra Basics» and
«Prealgebra» in the crawl went to nobody at all.

What replaced it splits the word by language rather than declining it, because
the two languages disagree about what the bare word means. English names its
university course «Abstract Algebra» or «Modern Algebra» and leaves the bare word
to schools; Russian does the reverse, where «Алгебра» on a second-year timetable
is abstract algebra and the school course says «алгебра 7 класс». So Latin
`algebra` now belongs to `school-algebra` alone and Cyrillic `алгебра` to
`abstract-algebra` alone, and each specific name still wins on length:

| Title | Goes to |
|---|---|
| «Algebra», «Algebra II», «College Algebra» | `school-algebra` |
| «Abstract Algebra», «Modern Algebra» | `abstract-algebra` |
| «Алгебра», «Высшая алгебра» | `abstract-algebra` |
| «алгебра 7 класс» | `school-algebra` |

Find every remaining tie — and judge each one, since some should stay — with the
duplicate scan in [agents/data-traps.md](../agents/data-traps.md#a-tie-silences-both-courses).

On top of that a title that names support material rather than a course —
homework help, exam prep, test review, office hours, seminar series, podcasts,
shorts, open days — is refused outright. Exam tracks count in every language:
ЕГЭ, ОГЭ and олимпиады were there from the start, and `AP`, `GCSE`, `MCAT` and
`NEET` say the same thing in English. That one line also settled a hundred and
forty Khan Academy playlists, which arrive as «Supply, demand, and market
equilibrium | AP Microeconomics» — a fortieth of a course, sold as one.

**The refusal list reads the title as written.** `NOISE` is stripped for
measuring coverage, and it removes `playlist`, `videos`, `full` and `course` —
which are exactly the words by which a title announces that it is not a course.
«Dance & Electronic Music Playlist | Genre» reached the matcher as «dance
electronic music» and a clause that is a keyword; «Crime Patrol 2.0 | Full
Episodes» lost the phrase that would have refused it. So the two questions are
asked of two texts: *is this a course at all* of the title as written, and
*which course* of the title with the noise gone.

Against the crawl in `cache.db` at the time of writing (7940 playlists) the rule
pass binds about a thousand automatically. The clause reading replaced some 380
of the bindings the previous version made with about 400 others; the ones it gave
up were «Project Management» under management, «Эволюция Земли» under evolution
and «Bioinformatics Research Symposium» under bioinformatics, and the ones it
gained were most of MIT's own flagship courses, whose titles are a fifth
university by weight.

## `pnpm data:review`

A local review server for everything the automatic passes refused to decide. One
playlist at a time: the playlist on the left, course search and suggestions on
the right.

```bash
pnpm data:review
```

It opens on `http://localhost:5174`, and it is keyboard-first:

```
1–9   bind to the numbered suggestion
n     not a course at all
→     skip
```

Decisions are written to `data/overrides.yaml`, which is committed — that file is
the reviewed record and what goes into the pull request. Override the port with
`REVIEW_PORT`.

A refusal is worth as much as a binding. «Stanford Seminars», «Дни открытых
дверей» and «Our Research» are topic bins rather than courses, and without a
record saying so they come back into the queue every time and take crawl quota
with them — the bins are the long playlists. Both answers also reach
`data:videos`, which crawls what was bound first of all and what was refused
last of all.

The keyboard-first design is the whole point: the alternative is hand-editing
YAML by playlist id, which is torture and therefore does not get done.

# Matching playlists to courses

[← all scripts](README.md) · how a crawled playlist finds the course it belongs
to, and what happens to the ones that do not.

Working through the ones that did not is [review.md](../review.md) — the
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

`--force` re-reads the playlists earlier passes already bound confidently, which
is otherwise the one thing this step leaves alone — so a change to
`lib/rules.ts` or to `keywords/{lang}.json` reaches nothing already in the
catalogue, which is exactly what such a change is usually written to correct. It
can take a binding back as well as add one. Hand decisions are never touched:
`reviewed` rows and `overrides.yaml` outrank every pass.

Model choice is `OPENAI_CLASSIFY_MODEL` (default `gpt-5-mini`).

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
duplicate scan in [review.md](../review.md#a-tie-silences-both-courses).

On top of that a title that names support material rather than a course —
homework help, exam prep, test review, office hours, seminar series, podcasts,
shorts, open days — is refused outright.

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

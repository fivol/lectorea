# Working the catalogue

[← docs](README.md) · an iteration end to end, and the data problems it turns up

[pipeline.md](pipeline.md) says what the crawl does and [harvest.md](harvest.md)
says where more material comes from. This page is the third thing: **how to
spend a day on the catalogue and what has already gone wrong doing it.**

It is written for whoever runs the next iteration. The second half is the more
useful one — every entry in it cost somebody an hour to find, and most of them
look like nothing until you know the shape.

---

## The iteration

Four phases. Each is worth finishing before starting the next, because each one
changes what the next should do.

### 1. Run the pipeline

```bash
make pipeline
```

`import → discover → mine → match → refresh → subscribers → match → embeds → build`,
in that order for the reasons in
[scripts/README.md](scripts/README.md#make-pipeline). It takes hours and spends
quota; start it early and do phase 2 while it runs.

Watch for two things while it goes:

- **`! … pagination repeats after N pages — stopping`** is fine. That is the
  guard working; see [pipeline.md](pipeline.md#fault-tolerance).
- **A step that ends far too fast.** `discover` reporting `0 of N channels due`
  means the 30-day window is closed and the run will find nothing new — which is
  correct, and also means the crawl has no new input until phase 3 adds
  channels.

When it finishes, the video queue is usually empty. **That is the normal end,
and quota is then no longer the constraint** — there is simply nothing left to
walk. To spend more, give it more input: `make mine` refills the queue for free
from descriptions the crawl just brought in, and the seam keeps refilling for
several rounds (2315 → 1853 → 1098 → 473 on 2026-08-14).

```bash
make mine && make refresh && make match
```

Repeat until `mine` returns little. Then `make embeds && make data`.

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
[channel-hunt.md](channel-hunt.md) is the record of three hunts and
[harvest.md](harvest.md) the catalogue of seams. Then:

```bash
pnpm tsx scripts/_vet.ts candidates.txt out.json
```

Never add a channel on a description alone. `_vet.ts` costs one unit and answers
the only question that matters: how many playlists of ten or more does it own,
and do their titles name subjects.

Adding a channel is three files, not one:

1. `data/channels.yaml` — the entry, with a comment saying what it is *for*;
2. `data/providers.yaml` — **a matching provider, or the channel silently falls
   back to `unknown` in the build.** `resolveProvider` does not fail on a
   missing id, it substitutes;
3. then `make discover && make refresh && make match && make data`.

### 4. Verify, then publish

```bash
make check
```

Typecheck, tests, `data:build`, i18n, build — CI's own order. Then commit, and
[`make publish`](scripts/README.md) when the working copy is what `main` would
build.

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

## Data problems, and what they turn out to be

Everything below was found the hard way. None of it is a code bug you can find
by reading code — they are all properties of the data, or of the fit between the
data and rules that are individually correct.

### A tie silences both courses

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
([matching.md](scripts/matching.md#how-the-rule-pass-decides)).

The test is not "is this word ambiguous in English" but **"does one of these two
courses own it, with the other holding a redundant copy"**.

### A loose keyword costs nothing visible and plenty invisible

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

### Russian inflection: the tolerance only covers the last word

`findPhrase` allows a short tail on the **end of the whole phrase**, so
«алгебра» finds «алгебры». It does nothing for a multi-word phrase whose *first*
word inflects: the stored «дискретная математика» does not find «Основы
**дискретной математики**», and «квантовая механика» does not find
«Математические основы **квантовой механики**».

Measured ceiling for the whole class: **194 playlists, about 4% of the
`no-phrase` bucket** — and a stem-tolerant match also produced visible false
positives («Летняя школа по биоинформатике» → bioinformatics, a summer school).
So the decision stands: **no stemmer; add the oblique form by hand**, exactly as
`data/keywords/*.json` says at the top of the file.

Add the genitive when a course keeps appearing in one:
«дискретной математики», «квантовой механики», «теории чисел», «мировой
литературы», «робототехники».

### The Russian faculty title pattern

Every philology faculty titles its courses «X современного русского языка», and
the qualifier is two thirds of the clause — so coverage puts a correct match at
0.6 and it never publishes. «Морфология современного русского языка» is
morphology and had been refused for months.

Add the whole phrase, not the head word. The same applies to any pattern where a
standing qualifier outweighs the subject.

### A thin course is as likely to be a matching problem as a coverage one

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

### `matches` is not the record — `overrides.yaml` is

A hand-bound playlist keeps whatever stale guess a pass last wrote, **for ever**:
`unmatchedPlaylists` filters overridden rows out, so nothing ever revisits them.
«Теоретическая механика» still reads `mechanics @ 0.6` in the table while the
committed answer is `analytical-mechanics`, and both are correct — the table is
simply not where the answer lives.

Any tool that judges bindings must read both. `_noisy.ts` was wrong for exactly
one iteration for want of this, and reported the best keywords in the file as
the worst.

### A course can be empty because nobody looked, not because nothing exists

`field-archaeology` was recorded on 2026-08-13 as having no channel that clears
the bar in either language. It has a forty-lecture ordered course, on an Indian
university's SWAYAM channel, which no search had been pointed at.

Before recording a course as impossible, say **where** you looked. «No Western
field-school channel publishes a method course» is a finding; «field archaeology
does not exist on YouTube» was not.

### …and a course can be genuinely empty, and must be left that way

`poetics` had two channels added for it and stayed at zero. What they teach is
poetry — «Lectures on English Poetry», «A Survey of English Poetry» — and a
poetry survey is a literature course, not a course on verse theory. Binding them
would have closed the number and emptied the meaning.

**Do not fill a course by widening what it means.** `lib/rules.ts` is biased
towards refusing because a wrong binding sits in the catalogue and misleads,
while a refusal costs one person one minute. Hand decisions inherit that bias.

### Refuse a channel for its unit, not for its size

Three channels on 2026-08-14 cleared the bar on quality and were refused on
arithmetic — Virtual University of Pakistan (466 playlists of 10+, each "course"
a 300-clip topic dump), Vidya-mitra (1072, behind discipline bins of 3100 videos)
and МИАН (236, mostly общеинститутский семинар and летние школы).

All three own material the catalogue wants. The question is not "is this channel
good" but **"is the thing this channel publishes the thing the catalogue
stores"** — one semester, in order. When the answer is no but two playlists are
right, `pnpm playlist:add` costs one unit and the channel costs thousands.

### The unit is the semester, in both directions

A channel publishing one playlist per *chapter* binds every fragment as
confidently as the course itself, because each fragment names its course in a
clause of its own: «CPU Scheduling | Chapter 5 | Operating System». The course
then shows sixteen entries that are each a sixteenth of itself. 171 of these
were live before `NOT_A_COURSE` learned the shape.

The mirror image is a channel publishing one playlist per *lecturer* or per
*year* — «Lectures 2019», everything this professor ever gave. Both fail the
same test.

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

**Give them the refusals, not just the brief.** [channel-hunt.md](channel-hunt.md)
records what was refused and why precisely so the next hunt does not spend a day
rediscovering Gresham College. An agent that has not read it will propose
Smarthistory, ICTS and TutorialsPoint again.

---

## The tools, in one place

| Command | Cost | What it answers |
|---|---|---|
| `_refusals.ts [bucket] [out.json]` | free | why were these playlists refused |
| `_noisy.ts [min]` | free | which keywords claim and never win |
| `_probe.ts [gained\|lost\|changed]` | free | what would a rule change do to the whole catalogue |
| `_holes.ts [min]` | free | which channels does the catalogue keep choosing but never crawl |
| `_vet.ts in.txt out.json` | 1 unit/channel | does this candidate own courses |
| `_owners.ts mined.json out.json` | 1 unit/50 ids | which channels are behind a set of playlist ids |

None are wired into `pnpm`: they are read once or twice a year and the useful
half of the work is the judgement, not the script.

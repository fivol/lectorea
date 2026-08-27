# The reading brief — one batch, one agent

You are confirming bindings a rule pass made from a **title alone**. Your job is
the half a title cannot settle, and nothing publishes without your verdict: an
absent verdict counts as "not confirmed", never as "fine". Read every row; do
not skim.

## Input

- `BATCH` — a JSON array of `{id, title, videos, course, channel}`. `course` is
  what the rules guessed.
- `courses.txt` — every course of the catalogue, `id<TAB>names`. **A
  `wrong-course` verdict is only valid against an id in this file.**

Read those two files and write one. Do **not** open `data/cache.db`, do not run
`pnpm`/`make`/`tsx`, do not touch git, do not browse. A crawl may be writing to
the database and a second writer kills it.

## The unit

The catalogue stores **one semester of one subject, taught in order**. That is
the whole test, and it is both narrower and wider than "a university course": a
25-part music-theory series by a musician, a language course by a teacher, a
filmed workshop, a screencast series all qualify if they teach in order. A
course read to a Bangladeshi university in Bengali is as much a course as MIT's
— the bar is the shape, not the polish.

## The four verdicts

| verdict | when |
|---|---|
| `ok` | it is a course, and `course` is the right one |
| `wrong-course` | it is a course, but of a *different* id in `courses.txt` — name it in `course` |
| `not-a-course` | it is not one semester of one subject |
| `unsure` | the title and channel genuinely do not say; use sparingly |

Prefer `wrong-course` over `not-a-course` when the material is real and merely
filed wrong — that republishes it instead of throwing it away.

## The three shapes `not-a-course` exists to catch

1. **A unit of a course published as a playlist.** «States of matter |
   Chemistry», «CPU Scheduling | Chapter 5 | Operating System», «Trigonometry 3
   — PRECALCULUS 8», «Circulatory system diseases | Khan Academy». The tell is a
   topic narrower than any course would be, often with a channel's section name
   after a pipe. A numbered module is the hard case: «Module 2 — Vector
   Calculus» *is* a course when the module's name is the bound course's whole
   subject; «Numerical Methods 1» is not, because it is explicitly numbered as a
   half of one.
2. **A homonym.** «Genesis» → genetics, «The Greeks» on an art-history channel →
   the Greek *language*, «Ring» → abstract algebra, «Cello» → cell biology,
   «Feedback — Full Stack Mentorship» → control theory, «Ремонт АКПП …
   Гидравлика» → fluid mechanics, «Самолет из бумаги. Сложность: Лёгкая» →
   algorithms. The word is in the title and the subject is not in the playlist.
3. **A bin, a dump or an archive.** «Stanford Seminars» (1140 videos, different
   speakers, different days), «Popular videos», «Прямые трансляции», year series
   («Lectures 2019»), a lecturer's complete back catalogue, a conference archive
   («SciPy 2016»), a vendor's whole tutorial catalogue («Data Science [2026
   Updated] | Full Course | Simplilearn»), talks *about* teaching («How We
   Teach»). Also **exam coaching and homework help** — «ЕГЭ», «ОГЭ», GATE, JEE,
   CSIR NET, «previous year questions», MCQ drills — which the catalogue refuses
   outright.

Also `not-a-course`: single videos, 2–5 video fragments, empty playlists,
interview and podcast series, channel trailers, admissions or consultation
sessions, music, documentaries.

## What is *not* disqualifying

A tutorial series by one person. A bootcamp playlist that builds one skill in
order. A school-level course. A language other than Russian or English. A low
video count — 8 is the floor and it is deliberate. A course taught to one
university's stream. A course split into «Часть 1 / Часть 2» — each part is a
course here. NPTEL/IIT course codes and Russian «Лекции по курсу …».

## Judgement notes

- Judge on the title, the video count and the channel. `unsure` is the honest
  answer when they say too little — do not go and look anything up.
- About a quarter of every previous round has been refused, and the rate tracks
  the seam: a university faculty channel comes back near 15%, a wide search or a
  mined day at 30–46%. **A batch that comes back 100% `ok` is a reason to
  re-read it, not a good day.**
- A wrong binding sits in the catalogue and misleads a reader; a refusal costs
  one person one minute. Refuse when torn.

## Output

Write a JSON array to the output path you were given — one object per row of the
batch, every id present exactly once, ids copied verbatim:

```json
[
  {"id": "PL…", "verdict": "ok"},
  {"id": "PL…", "verdict": "wrong-course", "course": "linear-algebra"},
  {"id": "PL…", "verdict": "not-a-course", "note": "chapter of a course"},
  {"id": "PL…", "verdict": "unsure"}
]
```

The importer validates count, ids and duplicates against the batch, and turns a
course id that does not exist into a refusal — so an invented id costs a row.
Verify the file parses and has exactly as many entries as the batch before you
finish.

Reply with one line only: the counts per verdict, the file you wrote, and one
sentence on what the batch was mostly made of.

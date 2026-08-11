# Lectorea

**[🇷🇺 Читать по-русски](README.ru.md)** · [Open the catalogue →](https://fivol.github.io/lectorea/)

### What to learn, and in what order

Lectorea is a free catalogue of university-level video courses on YouTube —
lecture playlists from real universities, arranged not alphabetically but by
what has to come first. Nearly 200 courses across 39 fields of knowledge, each
one knowing what it depends on.

That is the difference from a search engine: YouTube can find you a lecture on
tensor analysis, but it cannot tell you that you will not understand it without
linear algebra. Lectorea answers the two questions that actually come up:

- **What do I need to know before this course?**
- **What can I study right now, with what I already know?**

No registration, no ads, nothing to pay for. Everything you mark stays in your
browser. The interface and most of the catalogue are in Russian for now.

## Who it is for

**If you are teaching yourself.** You know where you want to end up — machine
learning, quantum mechanics, ancient philosophy — but not what the road there
looks like. Mark a course as your goal and the site lays out the path to it:
every prerequisite in the right order, with an estimate in hours and video
lectures for each step. You get a curriculum instead of a folder of bookmarks.

**If you are a student with an exam coming.** Your lecturer's recording is not
the only one that exists. Find the same course here and you get every recording
of it — several universities, several lecturers — sorted by rating rather than
by view count. Filter down to a language, a lecture length or a course with
subtitles, and if one explanation does not land, take the next.

**If you have just finished something and want to know what is next.** Every
course shows what it opens up: the courses that become reachable once this one
is done. That turns "I have learned probability theory, now what?" into a list
of concrete answers rather than a search query.

**If you are filling in gaps.** Walk the path to a course you thought you
already knew, and the columns to the left of it are exactly what you may have
missed.

## How to use it

1. **Start on the map.** Three continents — formal and natural sciences, social
   sciences, humanities — with the fields of knowledge drawn as territories. The
   bigger the territory, the more courses it holds. Or just search: the box
   understands abbreviations and student slang, so `теорвер` and `линал` find
   what you mean.
2. **Pick a field and read the columns.** Each column is a difficulty level:
   the number of courses that have to come before this one. Left is the
   foundation, right is what stands on it. Hovering over a card lights up what
   it needs.
3. **Open a course.** You get its prerequisites and what it leads to, the full
   path to it in order, and the recordings themselves — filterable by language,
   university, lecturer, lecture length, subtitles, year and completeness.
4. **Mark what you are doing.** A course cycles through *not started → in
   progress → done*, and that is what makes "what can I study right now"
   answerable.

## What is in it

**A path, not a list.** Any course can be turned into a study plan: every
prerequisite in order, an estimate in hours, and a running count of how much of
it you have already done. Export the plan and it downloads as a Markdown
checklist with links, ready for your notes app.

**Recordings ranked honestly.** The default sort is not view count but how
strongly people reacted — likes and comments per view — corrected so that a
playlist with forty views and one enthusiastic comment cannot outrank MIT. A
careful lecture course from a small university gets a fair hearing. Playlists
that have died or been half-deleted are dropped automatically.

**Goals and progress.** Add a course to your favourites and it becomes a goal:
the profile shows a progress bar along its whole path, how many hours are left,
and a button that takes you to the next course you can actually start.

**Your marks, your playlists, your history.** Courses in progress and finished,
favourite playlists, and everything you have opened recently — grouped by course
or by university.

**Your data is yours.** There is no account and no server: everything lives in
your browser. The **Данные** tab exports it all as one JSON file and imports it
back on another machine — either replacing what is there or merging it, keeping
the further-along status on a conflict. That is the whole sync story, and it
works between browsers without anyone hosting anything.

**Small comforts.** Light and dark themes, a link that carries the exact view
you are looking at, and keyboard shortcuts (`/` search, `t` theme, `?` for the
rest).

## The catalogue is public — help fix it

Everything you see is open data, and anyone can change it. If a course is
missing its best recording, or a prerequisite is wrong, or a whole subject is
absent, say so:

- **«Предложить плейлист»** on any empty course opens a ready-made form. It asks
  for one thing — the link. The university, the lecturer, the language and the
  running time are read from YouTube automatically.
- **«Исправить данные»** in a course panel opens the exact file the course comes
  from.
- Or open an issue [here](https://github.com/fivol/lectorea/issues/new/choose) —
  there are four short forms: a playlist, a course, a field of knowledge, and
  everything else.

Empty courses are deliberately left visible rather than hidden: they show where
the catalogue still has holes, and the map's empty outskirts are an invitation.

---

Building it, running it locally, the data model and the pipeline behind it —
[docs/README.md](docs/README.md).

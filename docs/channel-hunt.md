# Where the channels came from

[← docs](README.md) · [pipeline.md](pipeline.md) for what the crawl does with
them, [agents/iteration.md](agents/iteration.md) for how to run a hunt and
[agents/data-traps.md](agents/data-traps.md) for what has already gone wrong in
one

`data/channels.yaml` is the crawl's whole input. This is the record of how the
list was filled and, just as usefully, what was looked at and refused, so the
same ground is not covered twice.

The bar a candidate has to clear — *a structured course on a subject the
catalogue has*, which is not the same as a university lecture course — and the
other seams playlists can be dug out of are in [harvest.md](harvest.md).

## The method

Three steps, cheapest first. The whole pass cost 1361 units of a 10 000-unit
day, of which discovery was 226.

**1. Mine the lists.** Forty-odd awesome-lists, wikis and magazine round-ups
were fetched and every YouTube link pulled out of them — `@handle`,
`/channel/UC…`, `/c/…`, `/user/…` and `?list=…`. 2067 channel references and
1717 playlist references.

**2. Turn playlists into channels.** The useful discovery was that the
*academic* lists do not link channels at all — they link one playlist per
course. `playlists.list` resolves 50 ids per unit, so 1717 links cost 35 units
and named the 867 channels behind them, ranked by how many curated courses each
one owns. That ranking is the candidate list; popularity in a "best YouTube
channels" listicle is not.

**3. Ask the API.** Each candidate was resolved and its playlists listed —
1 unit plus 1 per 50 — and judged on the numbers the bar actually states: how
many playlists have ten or more videos, and whether their titles name subjects
rather than years, series or the channel itself. `scripts/_vet.ts` prints
exactly that.

Russian channels needed a different route: the awesome-lists have none, and the
Russian round-ups (AdMe, 3DNews, vc.ru) list popular-science channels almost
exclusively. Those candidates were assembled by hand from university and
lecturer names and put through the same check — a wrong guess at a handle costs
one unit, so guessing broadly was cheaper than researching each one.

## Lists mined

Yield is what each one contributed *before* deduplication.

| List | Channels | Playlists |
|---|---:|---:|
| [Developer-Y/cs-video-courses](https://github.com/Developer-Y/cs-video-courses) | 35 | 921 |
| [EbookFoundation/free-programming-books](https://github.com/EbookFoundation/free-programming-books) (`courses/`, `casts/`) | 1 | 568 |
| [avinash201199/Awesome-YouTube-Playlists](https://github.com/avinash201199/Awesome-YouTube-Playlists) | — | 84 |
| [romulomourao/awesome-courses](https://github.com/romulomourao/awesome-courses) | 42 | 74 |
| [dair-ai/ML-YouTube-Courses](https://github.com/dair-ai/ML-YouTube-Courses) | — | 53 |
| [amirabbasasadi/mathematics-computerscience-courses](https://github.com/amirabbasasadi/mathematics-computerscience-courses) | 2 | 44 |
| [SayedNadim/Awesome-Physics-Learning](https://github.com/SayedNadim/Awesome-Physics-Learning) | 4 | 17 |
| [prakhar1989/awesome-courses](https://github.com/prakhar1989/awesome-courses) | 2 | 13 |
| [ChristosChristofidis/awesome-deep-learning](https://github.com/ChristosChristofidis/awesome-deep-learning) | 1 | 12 |
| [desireevl/awesome-quantum-computing](https://github.com/desireevl/awesome-quantum-computing) | 1 | 8 |
| [rossant/awesome-math](https://github.com/rossant/awesome-math) | 15 | 7 |
| [ossu/computer-science](https://github.com/ossu/computer-science), [ossu/math](https://github.com/ossu/math), [ossu/data-science](https://github.com/ossu/data-science), [ossu/bioinformatics](https://github.com/ossu/bioinformatics) | — | 10 |
| [josephmisiti/awesome-machine-learning](https://github.com/josephmisiti/awesome-machine-learning) (`courses.md`) | — | 5 |
| [aalhour/awesome-compilers](https://github.com/aalhour/awesome-compilers) | 2 | 4 |
| [topicplay/YouTubeList](https://github.com/topicplay/YouTubeList) | 765 | — |
| [PrejudiceNeutrino/YouTube_Channels](https://github.com/PrejudiceNeutrino/YouTube_Channels) | 548 | 6 |
| [JoseDeFreitas/awesome-youtubers](https://github.com/JoseDeFreitas/awesome-youtubers) | 249 | — |
| [wpacademy/educational-youtube-channels](https://github.com/wpacademy/educational-youtube-channels) | 187 | — |
| [kunalmanik/Awesome-Youtube-Channels](https://github.com/kunalmanik/Awesome-Youtube-Channels) | 109 | — |
| [epoyraz/Awesome-Youtube-Channels](https://github.com/epoyraz/Awesome-Youtube-Channels) | 107 | 4 |
| [learn-anything/youtube](https://github.com/learn-anything/youtube) | 78 | — |
| [Lazyt3ch/awesome-youtube](https://github.com/Lazyt3ch/awesome-youtube) | 53 | — |
| [bartolomej/awesome-cs-youtube](https://github.com/bartolomej/awesome-cs-youtube) | 20 | 2 |
| [mikeroyal/Physics-Guide](https://github.com/mikeroyal/Physics-Guide), [keon/awesome-nlp](https://github.com/keon/awesome-nlp), [raivivek/awesome-biology](https://github.com/raivivek/awesome-biology), [theimpossibleastronaut/awesome-linguistics](https://github.com/theimpossibleastronaut/awesome-linguistics), brandonhimpfen/awesome-{physics,mathematics,chemistry,economics} | 2 | 4 |
| [koljapluemer/awesome-lectures](https://github.com/koljapluemer/awesome-lectures) | — | 1 |
| AdMe «80 образовательных YouTube-каналов», 3DNews «20 каналов», vc.ru «50 каналов», Wikipedia *List of educational video websites* | 108 | — |

The shape of that table is the finding. **The lists that name channels are
lists of good videos; the lists that name playlists are lists of courses.** The
four largest channel lists between them contributed almost nothing this
catalogue can use — they are Vsauce, Numberphile, Fireship, The Net Ninja — while
`cs-video-courses`, which names no channels at all, is where a third of the new
university channels came from.

Every list that yielded playlists is now in `data/sources.yaml`, so
`pnpm data:import` keeps them current. The lists that yielded only channels are
not: they were read once, and re-reading them costs a request to learn nothing.

## What was added

85 channels, taking the file from 51 to 136. In rough order of what they bring:

| Channel | Courses | Why |
|---|---:|---|
| Дистанционные занятия МФТИ | 374 | the single largest find — a course per playlist, and the reason for this hunt |
| KhanAcademyRussian | 167 | the Russian Khan Academy, subject by subject |
| Neso Academy | 156 | signals, networks, digital electronics, compilers |
| IIT Madras — B.S. Degree Programme | 185 | the whole data-science degree |
| Udacity | 164 | the free back catalogue |
| Onur Mutlu Lectures | 71 | computer architecture, several years of it |
| CrashCourse | 66 | the exception to the standalone-video rule: each *Crash Course X* is a course in order |
| UofU Data Science, CMU Database Group, CMU Deep Learning | 128 | flagship courses published a term at a time |
| Павел ВИКТОР | 63 | school physics, years 7–11, filmed lesson by lesson |
| Professor Dave Explains, Dr Peyam, MathDoctorBob | 118 | full undergraduate sequences from individuals |
| Борис Трушин, Валерий Волков, Wild Mathing, Маткульт-привет! | 99 | the Russian mathematics teachers |
| Кафедра высшей математики МФТИ, Deep Learning School, Computer Science Club, Исторический факультет МГУ, НОЦ Математики ИТМО, Иннополис, Сириус | 90 | Russian faculty channels |
| Arzamas, Фоксфорд, Т-Образование | 77 | humanities and school, where the catalogue is thinnest |
| ~45 individual lecturers (Roughgarden, Skiena, Stachniss, Schuller, McElreath, Kellis, Solomon, Neubig, O'Donnell, Smola, Roth, Raschka, Canziani, Abbeel, …) | ~250 | one to fifteen courses each, and between them most of the graduate CS curriculum |

## What was refused, and why

Worth writing down: each of these looks like a hit in a ranked list, and
re-checking one costs a unit and a judgement call.

**Topic bins wearing a university's name.** Harvard University, Stanford (the
main channel), uwaterloo, UC Davis, Cambridge University, МГУ, СПбГУ, УрФУ,
МГИМО, Финуниверситет, Высшая школа экономики, Канал МПГУ. All have dozens of
playlists of ten or more videos and almost none of them is a course: *Harvard
Gazette*, *Commencement*, *Новостные сюжеты*, *Студенческая жизнь*. The courses
these universities do publish live on department channels, which is why
`@cs50`, `@oxfordmathematics` and `@spbumathcs` are in the file and the
universities above are not.

**Popular science.** Vsauce, Numberphile, Computerphile, Kurzgesagt,
minutephysics, ПостНаука, Лекторий Dостоевский, Российское общество Знание.
Excellent, and there is no course to point at.

**Exam-prep and marketing.** Умскул, СОТКА, Математик МГУ, Polytech Global —
`lib/rules.ts` refuses homework help and test review outright, so crawling them
buys refusals.

**Mirrors.** Several highly-ranked candidates — Pubvideos, Saul Leung, Haibo
Yan, Jayant, "S K", "cat blue", Quantum AI — turned out to be personal
re-uploads of Georgia Tech, MIT, Caltech and NPTEL courses. The playlists are
real courses, but the attribution would be wrong and the source is the one
likely to disappear.

**Conference and seminar archives.** International Centre for Theoretical
Sciences (304 long playlists, nearly all schools and workshops), Simons
Institute, Isaac Newton Institute, Google DeepMind. These are the expensive end:
a 300-video bin is six units to crawl and is never shown.

## The second hunt, 2026-08-13 — starting from the empty courses

The first hunt asked "which channels teach?". This one asked the question the
catalogue can answer for itself: **which courses have nothing, and who filmed
them?** Every course was counted, the list was cut at nought or one playlist,
and that list — not a ranked list of channels — was the brief.

Two sources, and the difference between them is the finding.

**Web search against the holes.** Five parallel searches, one per group of
fields, each told the bar and the courses it had to fill. 103 candidates, and
**all 103 resolved against the API** — no invented handles, which is what makes
this shape of search worth repeating. The best of them fill zeros nothing else
could: `@oer-vlc` (Handke's Marburg unit grid) covers morphology, historical
linguistics, typology and corpus linguistics on its own; Николай Поселягин
brings поэтика, Максим Жук античную литературу, Иван Соколов историю музыки,
`@ibivubioinformatics3199` publishes playlists literally named for the two empty
bioinformatics courses.

**The cache, asked who it already knows.** A channel whose playlists keep
binding to courses but which has never been crawled whole is a hole in
`channels.yaml`, and the `matches` table names them for nothing. 160 such
channels; **34 survived**. That ratio is the lesson — the cache is a good
detector and a bad judge, because a mirror binds exactly as well as a source.

129 channels added, taking the file from 136 to 265, and 3210 playlists for 321
units of quota.

### What this hunt refused

Beyond the categories above, which held:

**Aggregate playlists wearing a professor's name.** Gresham College — 381
playlists, 96 of them past ten videos, and the ten-plus ones are *everything
this professor ever gave*, across topics and years. A bin by lecturer is still a
bin. Same reasoning retired History of Philosophy Without Any Gaps: 505 episodes
in one playlist is a life's work, not a semester.

**One playlist per chapter.** Andrew Carnie's own companion videos to his syntax
textbook, 21 playlists, one per chapter. Every one would bind to `syntax`, and
the course would show twenty-one entries that are each a fortieth of a course.
The unit the catalogue publishes is the semester; a channel that is shaped
smaller than that cannot be taken whole.

**Tutorial farms.** TutorialsPoint, Simplilearn, CosmoLearning — hundreds of
course-shaped playlists, and the courses are either re-hosted or the channel is
a shop window. Refused for the mirror reason, at ten times the volume.

### Courses with nothing on YouTube at all

Reported so the next hunt does not spend a day rediscovering it: **bioethics**,
**field archaeology** and **ethnomusicology** have no channel that clears the
bar in either language — the courses exist, on university LMS pages and OCW text
sites, not as video. **Typology** rests entirely on one unit of `@oer-vlc`, and
**celestial mechanics** on one Лекториум course already crawled. Russian-language
quantum chemistry, ТОЭ and ТАУ have single recordings but no channel.

## The third hunt, 2026-08-14 — the thin courses, and the ones that were not thin at all

The second hunt closed the empty courses. This one asked the next question down:
which courses sit at **one or two playlists**, where one channel disappearing
takes the subject with it. Twenty courses fitted, and five parallel searches
took four each. 31 channels added, 265 → 296, and coverage went from 99.0% to
**99.5%** — 205 of 206 courses, with only `poetics` left.

What it bought, counted after the crawl — 13 of the 20 briefed courses moved:

| Course | Before | After | What did it |
|---|---:|---:|---|
| modern-art | 2 | 7 | `@arthistorywithtravisleecla6343`, `@GARAGEMCA`, `@EastTennesseeState` |
| demography | 1 | 6 | `@ErnestoFLAmaral` — five semesters of one course |
| celestial-mechanics | 2 | 5 | Ross, Rao, Peet, Carleton, `@fizmehmat` |
| archaeology-intro | 2 | 5 | `@dr.robs.archaeofilms`, Открытая археология |
| ancient-literature | 1 | 4 | `@alexandereliotschmid`, `@theliteraturechannel9755` |
| project-management | 2 | 4 | `@stanislavfurta7614` |
| historiography, economic-history, morphology, historical-linguistics, computability, enzymology | 1–2 | +1 each | |
| **field-archaeology** | **0** | **1** | `@SWAYAM-INI-BHU` — the course the last hunt said did not exist |

Seven did not move, and the reason divides them cleanly. `corpus-linguistics`,
`typology` and `time-series-econometrics` got their channel and the playlist
that should have bound was a clause short of the threshold — a matching problem,
fixed in the same session from `_refusals.ts` rather than by crawling anything.
`model-theory`, `ethnomusicology`, `ancient-art` and `poetics` got nothing
because there is nothing.

**Celestial mechanics is the finding.** It read as one of the barest courses in
the catalogue and was nothing of the kind — it was simply that nobody had looked
at aerospace engineers' own channels. Four of them hold six full courses between
them. A course can look empty because the material is absent, or because the
search has only ever been pointed at universities.

### Refused for size, and mined by hand instead

Three channels cleared the bar on quality and were refused on arithmetic. Each
owns material the catalogue wants, and taking the channel would have bought that
material at a thousand times its price:

| Channel | 10+ playlists | Why not |
|---|---:|---|
| Virtual University of Pakistan | 466 of 517 | Every "course" is a 300-clip topic dump titled `ENG509_Topic001…`; most of the channel is education and teacher training, which the catalogue has no courses for |
| Vidya-mitra (e-PG Pathshala) | 1072 of 1455 | Behind discipline bins of 3100 and 1934 videos. Its two linguistics modules are genuinely wanted; the other thousand are not |
| МЦМУ МИАН | 236 of 296 | «Общеинститутский семинар» 228, «Прямая трансляция» 197, four летние школы — the conference-archive shape, at the expensive end |

The lesson is not "refuse big channels". It is that **the unit a channel
publishes in decides whether the channel is the right thing to buy.** When a
channel's unit is wrong but two of its playlists are right, `pnpm playlist:add`
costs one unit and the channel costs thousands.

### What this hunt refused, beyond the categories that held

**A personal channel with a course inside it.** `@johnpfrazier`'s top playlists
are *Alyssa's Rockin' 80's Remix* (157) and *Grand Circle Vacation 2013* (77);
the two real art-history surveys are outnumbered. `@solubleshark` and
`@JamesElkins` each own exactly one course — a 73-lecture modern art history and
a graduate seminar — on channels otherwise full of photographs and soundscapes.
Both courses are worth having; neither channel is worth crawling.

**Chapters again, in a new disguise.** `@AxiomTutor` publishes *Model Theory,
Ch. 1*, *Set Theory, Ch. 1* and *The Real Analysis Minute!* — the Carnie refusal
with better production. This hunt also taught `lib/rules.ts` the shape directly:
a clause that is a bare «Chapter N» is now support material, which retired 171
playlists that had each been binding to their own course as confidently as the
course itself.

**Conference archives wearing a course's name.** `@econrsa`'s «ERSA Course:»
playlists are real, and four fifths of the channel is webinars and workshops.

### Courses that are genuinely empty, re-confirmed

**poetics** is now the only course in the catalogue with nothing, and for a
recorded reason rather than for want of looking. Two channels were added
specifically for it and neither filled it: what they teach is *poetry* —
«Lectures on English Poetry», «A Survey of English Poetry» — and a poetry survey
is a literature course, not a course on verse theory. Binding them would have
filled the number and emptied the meaning, which is the trade `lib/rules.ts` is
written to refuse. They earn their line for world literature instead. The only
Russian стиховедение found, `@litweb1888`'s mini-courses, runs to seven and
eight videos.

**field-archaeology, by contrast, was wrong rather than empty** — see the
section above. The difference between the two is worth keeping in mind before
the next hunt writes a course off: nobody had searched for field archaeology in
Hindi-university courseware, and everybody had searched for poetics.

**ethnomusicology**
was searched again in both languages and holds: the discipline publishes field
recordings and interviews, not syllabi. **model-theory** and Russian
**enzymology**, **corpus-linguistics** and **demography** have no channel at all;
they will stay where they are until somebody films one.

## The fourth hunt, 2026-08-15 — asking YouTube, and reading who owns the videos

The first hunt that did not read a list. By this point the day's own pipeline
had drained the video queue, `data:mine` had stopped returning anything and
`discover` reported `0 of 299 due` — four keys untouched and some 38 000 units
that would expire at midnight regardless. That is the only situation in which
`search.list` at 100 units a query is the right call, and the reasoning is in
[harvest.md](harvest.md#seam-8--asking-youtube-itself).

106 queries, 10 600 units: the 23 courses under four playlists and the 30 under
seven, each asked for under its Russian and its English name. 4079 playlists
came back, 597 of which the crawl already had.

**The finding is the ownership test.** Of the 2058 that named a course of this
catalogue and were long enough to be one, **611 were somebody's bookmarks** —
«Linguistics» with fifty videos in it, collected from forty other channels, by a
channel called *A random human*. Nothing in `playlists.list` separates those
from a course; `playlistItems.list` does, for one unit, because it carries the
owner of each video. A further 282 were mirrors of a single outside channel.
That is 43% of everything that passed every free filter, and before this pass
all of it would have been crawled and most of it published.

### What was added

20 channels, taking the file from 299 to 319. Two thirds arrived as *mirrors* —
found because somebody else had collected their lectures, never because a search
returned them directly.

| Channel | Why | How found |
|---|---|---|
| Virtual University of Pakistan | 466 playlists carrying course codes — a distance university publishing whole courses | own |
| University of Scholars | semester courses with codes and terms, Bangladesh | own |
| Свободный юридический факультет | ТГП, гражданское, административное — law is the thinnest domain here | own |
| TVSEMINARY Distance-Education | coded theology courses, the same one in Russian, English and Turkish | own |
| Dr. Najeeb Lectures | neuroanatomy, pharmacology, physiology, in order and at length | own |
| Liberty Home Bible Institute | systematic theology, Old and New Testament surveys, 80 lectures each | own |
| Living Anthropologically | *Introduction to Anthropology* filmed again every year — the anthropology hole, closed by one channel | own |
| Victor Gijsbers | Kant's first Critique, a course in epistemology — Leiden | mirror |
| Milan Barac | Irwin Weil on Dostoevsky, Tolstoy and Pushkin | mirror |
| Elena Clark | Russian grammar in two ordered courses, a seminar in Russian literature | own |
| Алексей Гончаров и КУЛЬТ-УРАЛ | История России, Древнего мира, Средних веков, Нового времени | own |
| Language & Linguistics Online | syntax, stylistics, sociolinguistics | own |
| Патан амебного уровня | общая и частная патологическая анатомия | own |
| Дмитрий Смыслов | история психологии, психология личности | own |
| moscoweducation, Сетевой Лекторий, Колледж КПСУ | Russian college lecture courses, one subject per playlist | own |
| CD Duka Law, L.A.W (Law And Wisdom) | Philippine and Pakistani LL.B lecture series | own |
| не economist [Dmitro] | макро- и микроэкономика ВШЭ, теория игр — three playlists, three courses | own |

### What this hunt refused

44 candidates were vetted at a unit each and 24 refused. The refusals cluster
into four shapes, and every one of them looked like a hit in the ranked list:

**Topic bins wearing an institution's name**, again — the category that has
survived four hunts. *Образование для всех* (10 mirrors pointed at it) files a
decade of educational television under «Мировая история» and «Человек и
общество», 400–700 videos apiece. *ПостНаука* has «Лекции по химии» meaning
every chemistry video it has ever made. *Vidya-mitra*, 1455 playlists, tops out
at «Social Sciences: WOS» with 3100.

**Conference archives.** *TALE: The Archaeology Lecture E-library* is 438
playlists and, at 85 of them over ten videos, looked like the answer to the
archaeology hole. They are *CAAUK 2018 Edinburgh*, *TAG@25 2003*, *Scotland's
Community Heritage Conference* — different people, different days.

**Chapters published as playlists.** *Jacob Stewart* has 42 playlists of ten or
more and they are «General Chemistry 1 Chapter 7», «Chapter 8», «Chapter 9». The
unit here is the semester.

**Re-uploads and exam coaching.** *mehranshargh* is The Great Courses, lifted
whole. *The Law Academy* is SQE preparation, *PMC Lounge* is PMP certification,
*Last Minute Lecture* is textbook chapter summaries read aloud. And the shape
that had never been seen before this hunt because no vetted channel produces it:
the civil-service and accountancy coaching industry — «Anthropology for UPSC»,
«CA Inter Strategic Management», «Strategic Management - CS Professional». Those
were 49 of the 63 answers to one query, and `lib/rules.ts` now refuses them by
name, which cost the catalogue exactly two existing bindings, both correct.

## The fifth hunt, 2026-08-16 — the thin courses again, and reading the catalogue back

36 queries, 3600 units, aimed at the 18 courses under seven playlists. The
ownership pass is the number worth carrying forward: **316 probed, 17 own their
material, 68 mirrors, 231 collections.** Five per cent. The 2026-08-15 hunt put
the failure rate at 43%; asked of thinner courses, whose names are ordinary
words in a search box, it is nineteen in twenty.

**The thin courses stayed thin, and that is the finding.** Not one of `poetics`,
`field-archaeology`, `ancient-art` or `typology` gained anything. What the
search returned instead was material for courses that are already healthy —
Jim Hefferon and Gabriel Robins (UVA CS3102) on `theory-of-computation`, ВШЭ's
«Теория литературы» on `literary-theory`. A search for a course this catalogue
is empty in mostly proves the course is empty on YouTube too, which is what
[data-traps.md](agents/data-traps.md#and-a-course-can-be-genuinely-empty-and-must-be-left-that-way)
says to expect and to leave alone.

### What was added, and what was refused

Three channels, all found by `_holes.ts` — channels the catalogue keeps binding
playlists from and has never crawled — rather than by the search:

| Channel | Why |
|---|---|
| RAIL | Berkeley CS 285 Deep RL, filmed four years running, and CS 182 |
| Lantertronics | Georgia Tech ECE, one coded course per playlist |
| Lalit Vashishtha | formal languages and automata, compiler design, information theory |

Refused, each after reading the titles:

- **Stanford** `UC-EnprmCZ3OXyAoG7vjVNCA` — 235 playlists, and they are «Stanford
  News 2010», «Reunion Homecoming», «Commencement», conference archives. The
  institutional channel, not the teaching one; `stanfordonline` is already here.
  The topic-bin-wearing-an-institution's-name shape, for the fifth hunt running.
- **CosmoLearning** — 213 playlists, and it is an aggregator: «Ohio State: Jim
  Fowler's Calculus One Lectures», «The Joy of Painting», «Laura in the Kitchen».
  Somebody else's lectures, filed under the collector.
- **Coding Ninjas** — «Success Stories», «YouTube Live Webinars»: a bootcamp's
  marketing. **Google DeepMind** — «The Podcast», «Gemini», «Veo»: product
  launches.
- **Lindsey Kuper** — two real playlists (UCSC CSE138 Distributed Systems) and
  nothing else, so not a channel. Both turned out to be **already bound at
  0.95**, mined from a link: the check before adding is a query, not a memory.

## The sixth seam, 2026-08-17 — the catalogue naming its own candidates

Not a hunt: `data:authors --min=20` probed 1336 published bindings at a unit
each — **1253 own their material, 75 mirrors, 8 collections** — and the mirrors
are a channel list nobody had to search for. A mirror is a course this catalogue
already publishes, already judged worth publishing, with the name of whoever
actually filmed it attached. That is a stronger vetting than any ranked search
result, and it costs nothing extra: the unit was spent on the attribution.

The 75 mirrors have 58 distinct owners. 14 of them are channels this catalogue
already knows, and the build now files their 26 playlists under them — 23 of
which a reader also confirmed, so they carry the right name in the catalogue
today, with nothing written by hand. The other **44
owners, behind 49 playlists, are not here yet**, and they are the next hunt's
input rather than this iteration's work: adding one means crawling it, and a
crawl is a day of quota.

The largest, by videos already published under somebody else's name:

| Owner | What of ours it made |
|---|---|
| Brandon Foltz | «Statistics 101», 115 videos under `statistics` |
| DTUdk | DTU Introduction to Statistics, 111 |
| Brian Caffo | Statistical Inference (Coursera), 68 |
| Michel Bierlaire | Optimization: principles and algorithms, 65 (EPFL) |
| Sarada Herke | Graph Theory, 62 |
| Stanford Dbclass | Jennifer Widom's Introduction to Databases, 58 |
| William Hoff | Computer Vision Lectures, 57 (Mines) |
| JimKurose | Computer Networking: A Top-Down Approach, 54 |
| Jordan Boyd-Graber | NLP, CMSC 470 Maryland, 51 |
| Christof Paar | Introduction to Cryptography, 48 |
| Remzi Arpaci-Dusseau | CS-537 Operating Systems, 39 (Wisconsin) |
| Jeffrey A. Bilmes | EE514/515 Information Theory, 37 (UW) |

Most of them are **a lecturer's own channel**, which is the shape a search
ranks last and this seam ranks first. Note also that *Stanford*
`UC-EnprmCZ3OXyAoG7vjVNCA` turns up again, refused in the fifth hunt as the
institutional channel — a mirror pointing at a channel is evidence about *one
playlist*, not a recommendation of the whole channel, and the refusals above
still stand.

## Doing it again

`scripts/_vet.ts` and `scripts/_owners.ts` are the two throwaway scripts this
used; they take a file of handles or ids and print the numbers above. Neither is
wired into `pnpm` — a channel hunt happens once or twice a year, and the useful
half of it is the judgement, not the script. `scripts/_hunt.ts` joined them on
2026-08-15 and is the one that produces the candidate list rather than checking
it; `--from` re-reads a finished report, so a rule written after the search still
reaches everything the search paid for.

A hunt now has a second half worth budgeting for. `scripts/_refusals.ts` sorts
the playlists the rules refused by *why*, and the 2026-08-14 hunt found that the
larger win was there rather than in the channels: adding a channel bought nine
playlists across five courses, while the keywords the refusals named bought
about two hundred. A course that looks thin is as likely to be a matching
problem as a coverage one — `Appreciating linguistics: A typological approach`,
66 lectures, had been sitting in the cache bound to `linguistics-intro` at 0.68
the whole time.

The method that worked twice now: **count the holes first, and let the empty
courses write the brief.** A ranked list of channels answers a question nobody
asked; a list of courses with nought playlists is a search anyone can run.

The seam still unspent is `data/overrides.yaml`: every playlist a human has
bound by hand names a channel, and a channel that keeps turning up in reviewed
decisions and is not in `channels.yaml` is a hole in it. The 2026-08-13 hunt
used the whole `matches` table rather than the reviewed rows alone, which is the
same trick with a worse signal-to-noise ratio — 34 of 160 — so the narrower
version is still worth running.

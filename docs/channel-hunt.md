# Where the channels came from

[← docs](README.md) · [pipeline.md](pipeline.md) for what the crawl does with them

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

## Doing it again

`scripts/_vet.ts` and `scripts/_owners.ts` are the two throwaway scripts this
used; they take a file of handles or ids and print the numbers above. Neither is
wired into `pnpm` — a channel hunt happens once or twice a year, and the useful
half of it is the judgement, not the script.

The obvious next seam is the same trick applied to `data/overrides.yaml`: every
playlist a human has bound by hand names a channel, and a channel that keeps
turning up in reviewed decisions and is not in `channels.yaml` is a hole in it.

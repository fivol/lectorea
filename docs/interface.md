# The interface

[← docs](README.md) · [the live site](https://fivol.github.io/lectorea/)

Three screens, and the profile is the thread running through them.

## The map — `/`

![The map](images/map.webp)

The way in. Three continents — formal and natural, social, humanities — with the
fields of knowledge marked out on them as territories, each sized by how many
courses it holds and carrying an icon, so the empty outskirts are visible as
work still to be done.

It is two drawings of one world — `public/map.svg` and `public/map-portrait.svg`
— carrying coastlines and territory outlines and nothing else, with the colours,
the lettering and the sea painted by the app, so the whole map follows the light
and dark themes. Which one loads is decided by the shape of the window and not
by the size of the device: see [two shapes of paper](#two-shapes-of-paper) below.
It is a plan on disk and a view
on screen — the app lays the ground back a little and stands the continents in
the water as slabs with a cliff at the coast, the same projection the tile
collection draws in ([tiles.md](tiles.md)). The ground inside a territory comes
from that collection, and so does the water around them.

Each continent is a climate — the formal one ice and stone, the social one grass
and sand, the humanities wood, water and heather — and each field inside it is a
biome: a range, a glacier, a steppe, a marsh, with an island biome that exists
nowhere on the mainland. One table says which country a field is and, on the
same line, what colour it is painted, so a continent reads as one place and no
two neighbours look alike ([biomes.md](biomes.md)); the grid is read back off the
outlines rather than stored, so a redrawn map keeps its ground.

Pick a territory to enter the columns filtered to it, or search.

The map is moved rather than looked at: two fingers on a trackpad carry it, a
pinch or `⌘`/`Ctrl` and the wheel magnifies about the pointer, and dragging does
what dragging a map does. A press that turns into a drag stops being a press, so
the territory under it is not opened. Three buttons in the corner do the same
for a pointer with no second gesture in it, and the last of them puts the map
back. It goes in four times and no further — that is one continent filling the
window, and past it a reader is looking at two territories and a lot of
hexagons.

The lettering only half follows. Everything written on the map — names, counts,
icons, the halo behind them — takes a share of the magnification rather than all
of it, so four times in the ground is four times bigger and the names not quite
twice. Growing with the ground would make going in pointless: the same map at
the same density, drawn larger. Holding perfectly still is the other mistake —
a continent filling the window, read through eight-pixel labels. A share gets
both: the names shrink against the territories, so fields that had to put their
names out at sea, or go unnamed until pointed at, take them back — and they are
still comfortable to read at the far end.

The size the map comes to rest at is what all of that is measured from, and it
is arrived at from two boxes rather than one. `map.svg` is a rectangle with the
continents in the middle of it and a third of its width in open water round the
outside; fitting the rectangle to the window drew the land at two thirds the
size of the room it had. So the land is what the window is measured against and
the water is what runs off the edges — up to a comfortable width, past which the
land stops growing and the sea around it grows instead, so a large display gets
the map at a readable size rather than a wall map and a name is the same size
there as on a laptop.

The window it is fitted to is not quite the window either. The drawing runs edge
to edge and passes under the header — the sea has to carry on behind the
wordmark, or the header reads as a lid on it rather than something lying on it,
and dragging the map has to slide the land under its own controls. What the map
is *fitted* to is the part nothing is standing on, so the northernmost names
come to rest below the search field even though the water behind it is theirs.
The lettering with no plate under it takes the same halo the map gives its own
names.

### Where you were

A front page answers "what is there"; somebody who has been here before is
asking "where was I", and that answer used to be two presses away behind an
avatar in the corner. So for a reader with a past here the front page carries
it: the lecture that was playing, and the three numbers that say whether the
habit is alive — days in a row, lectures watched, courses done. On a wide window
it is a plate in the corner, on a narrower one a bar at the foot of the screen
— where a thumb reaches it — and on the blocks list the first section of the
page. A profile with nothing in it yet shows none of it.

The avatar stays in the header either way. The summary is a shortcut into the
profile, not a replacement for the door to it, and two ways in cost nothing next
to a reader looking for the button where it has always been.

Nothing on it costs a download. The playlist that was open last, the lecture
that was playing, the ticks and the days of study are all in the profile
already; the one thing it cannot know without the playlist shards is how far
through that playlist somebody is, so it does not claim to. That number is in
the panel, where the files are worth fetching.

The drawing is not moved out of its way. Both shapes float over open water at
the size the map opens at, and a card that made the continents shrink to avoid
covering sea would be charging the whole map for a corner of it.

### Two shapes of paper

A map of three continents ranged side by side wants a window wider than it is
tall. Fitted into a phone held upright it is a strip of land across the middle of
a great deal of water, with the names at three pixels — and no amount of zooming
fixes the shape of the paper. So a phone used to be sent to the blocks whatever
it asked for.

There are two drawings now. The same generator lays the same territories out
again with the continents stacked instead of ranged, and writes
`public/map-portrait.svg` — same areas, same dependency order read bottom to top
inside each continent, same landforms, a canvas the shape of a phone. Nothing is
hand-placed and nothing is a second copy of the catalogue: add a domain and both
files are one command away from carrying it. See
[the pipeline](pipeline.md#the-two-maps).

Which one loads is a question about the window rather than about the device —
`(orientation: portrait)`, so a tablet held upright gets the stacked one and a
phone turned on its side gets the ranged one. Turning the device swaps the file
and re-fits it: the two are different worlds, and carrying a reader's zoom from
one into the other would land them somewhere else entirely. The cell size, the
depth of the cliffs and the chrome the land is kept clear of all follow the file
that actually loaded rather than the one that happened to be written first.

The tall map also does not open on the whole of its world. Stacking the
continents fixes the shape of the paper but not the arithmetic: three continents
fitted into a phone still puts every name at four pixels. So the plan carries a
third box beside the land — where the map *opens*, measured down from the
northern coast, far enough to hold the first continent, the whole of the second,
and the northern shore of the third, which is what says there is more below. The
corner button still shows the world entire, and out is still bounded by it; what
changed is only where the map starts. On a wide window the two boxes are the
same box and nothing about the map moves.

Lettering is measured in cells rather than in map units, so a field of eight
hexes is named the same way on both maps whatever grid each is drawn on. The
tall one is then set larger still, and that part is a decision rather than a
correction: it is read on a phone at arm's length, where a name wants eleven
pixels and not eight. Fewer names fit inside their own borders at that size and
more go out to sea or wait for the reader to come closer — on a screen that size
the better trade, and the same one the map has always made.

The blocks are still there, and are still the same catalogue drawn as a grid of
cards.

![The blocks fallback](images/blocks.webp)

Both views are now a choice on every screen. On a wide one the switch sits in the
header; on a phone there is no room for it beside the wordmark — and a control
that decides what the whole screen is belongs under the thumb rather than in the
far corner — so it floats at the foot of the screen instead, thumb-sized, in the
same place over both views. Over the blocks it rides the bottom of the scrolling
column rather than standing over the middle of a card.

That choice
lasts the visit and no longer: the map is the front door, so every visit opens
on the drawing, and the wordmark leads back to it from anywhere. The way back
from the columns is the other half of that pair — it returns to the view you
left, blocks included, and says which one it is.

## The columns — `/courses`

![The columns with a course selected](images/courses.webp)

The catalogue proper. A column is «сложность N» — the length of the longest
chain of prerequisites ending at that course — so reading left to right is
reading how much has to come first, and a line above the columns says exactly
that.

Pointing at a card lights up what it needs and fades the rest; selecting one
also draws the curves along that chain, and only that chain — over 200 cards
they were a web of noise, but over the six or seven of one path they answer what
the columns cannot, which of the cards on the left this one actually needs.
Select a course and the line above changes to say so — half the screen has just
dimmed, and the legend explaining the columns would leave the reason for it
unsaid; the **?** beside it opens the full legend, which also appears by itself
on a first visit.

Cards of one field stay together vertically, so switching on a domain filter
lights a stripe rather than a spray. The columns scroll sideways and say so: the
edges fade where there is more, and stop fading at the ends. Opening the panel
brings the selected card back into view rather than letting it disappear under
it.

Each card carries its one-line description and the stage a person normally meets
that course at — «9 класс», «2 курс», «аспирантура». That is the question people
arrive with, and it is not the same as the column: «Введение в социологию» and
«Школьная алгебра» share a column while one is a first-year university course
and the other is school.

## Filters

Three sit in the header:

- **Ступень** caps the catalogue at a school year or a university one — pick «11
  класс» and everything past it disappears, in every field and in the next
  session too, because it says something about the reader rather than about the
  view.
- **Область** and **Вуз** are per-view and searchable, and both name what is
  selected instead of counting it.

A domain filter shows that field and nothing else — not even a prerequisite from
elsewhere, which as a faded card several columns away read as part of the field
you asked for. Those live in the panel instead.

## Search

![Searching for «теорвер»](images/search.webp)

The search box matches titles, abbreviations and slang (`теорвер`, `линал`),
because morphology here is a list of forms, not a stemmer.

It opens on focus rather than on the first keystroke, and before anything is
typed it already holds rows.

![The search before anything is typed](images/search-suggest.webp)

On the map those are the largest areas, courses and
universities under their own headings: a field that says «Область, курс, вуз…»
is worth more when it shows the three rather than asking to be believed. Beside
the columns it opens on that slice instead — the courses and recordings that
survive the filters, since once a field has been picked, «the biggest area» is
no longer an answer to anything. Typing still reaches the whole catalogue; a
filter says what to look at, not what exists.

On a phone the search is its own screen — back arrow, full-width field, the
whole height for the list — and backing out of it leaves nothing typed behind.
Above the columns what opens it is a search icon: that row is three filters deep
already, and an input wedged into the 160px left between two buttons is a target
you have to aim at, dropping a list read through a letterbox. On the first
screen there is room for the field itself, so the field is what you tap — the
same screen opens, and course names arrive with the width to be read whole
rather than cut at «Дифференциальные уравне…».

## The course panel

Selecting a course opens it; the × in the panel, or a click on empty space, puts
the columns back to full width.

On a phone it is a sheet that comes up over the list and stops with the row it
was opened from still in sight. Drag it up for the whole card, down to put it
back, down again to send it away — or tap the grab bar to switch between the
two, and the × or the dimmed list behind it to close.

- **Опирается на** and **Открывает путь к** are the same relation read in either
  direction, so they use the same card and sit next to each other, whichever
  field the neighbour comes from, with the full chain below the pair. On the
  panel each list caps its height and scrolls inside itself: a course that opens
  eight others must not push its own recordings off the screen.

  On a phone the three of them fold into one line — **Связи и путь**, and under
  it which course to start with (the first step still unmarked, never one that
  already carries a tick) and what the whole path costs. Three sections of
  neighbouring courses used to stand between the title and the playlists the
  sheet was opened for. The fold is one answer for every course: it is kept in
  the profile, so a reader who wants the structure unfolds it once.
- **Path** — everything that has to come first, in order, with an hour estimate,
  a progress bar once there is progress to show, and how much of it you have
  already marked done. «Export» copies it to the clipboard and downloads it as a
  Markdown checklist with links.

  ![The path, expanded](images/path.webp)

- **Playlists** — the concrete recordings of that course, sorted by a bayesian
  rating rather than raw views.

  A row says four things, in four places. The **name** leads: the recording's
  own title with everything the screen already says taken out of it — the course
  name, the university, the lecturer, the term and the year — so what is left is
  the part that tells this recording from the one under it, and the university
  and lecturer follow it in a quieter grey. Roughly half the catalogue has no
  name of its own once that is done, and those rows simply start with who
  recorded them. Under it are the **facts**: year, language when the filter
  admits more than one, how many lectures there are and how many hours they come
  to — or, once you have started, how much of each is behind you. The hours
  replaced a word for the average lecture («пара», «урок»), which named a number
  the reader could already divide out and answered the question nobody asks
  first. Opening that line is the **type** — «Подборка», «Семинары», «Полный
  курс», «Разная длина» — which says what the thing is and never how good it
  is. On the right is the **status**, which says only how the
  numbers came out, and nothing about what the thing is. A finished playlist
  wears a «Просмотрен» plate, the same one a finished course wears.

  Filter by language, provider, lecturer, type, lecture
  length, captions, year, completeness; hide what you have watched. The language
  filter starts on the language of the interface and stays there even for a
  course that has nothing in it: rather than quietly dropping the filter, the
  list says there is nothing in that language and shows the other languages
  underneath, so «no Russian lectures on this at all» is something you learn
  instead of something you infer. The filters
  sit in one strip that scrolls sideways, ordered by how often they are reached
  for, and the button at its end unfolds the lot; sorting has its own row,
  because at the end of that strip it read as one more filter. The provider and
  lecturer lists are searchable — here and in the header above the columns — and
  every one of them names its rows before anything is typed, most first, so the
  field narrows a list you can already see rather than asking you to guess at a
  spelling. The lecturer filter disappears for a course whose recordings name
  nobody.

  ![The playlists of a course](images/playlists.webp)

Marking a course cycles it through *nothing → in progress → done*, which is what
makes "what can I study right now" answerable.

## Progress, down to the lecture

Three levels, and only the bottom one holds anything. A lecture is watched or it
is not; a playlist and a course are arithmetic over that.

- **A lecture** counts as watched at 90% of its length, or when the player says
  it ended. The last minutes of a recording are credits and a Q&A that trails
  off, and a bar that will not complete because of them is a bar people stop
  trusting. Every lecture also carries a tick of its own, for the ones watched
  on YouTube — without it, everything watched outside this player would be
  invisible here, which makes the progress it shows a lie of omission. Shift
  extends from the last tick, so twelve of thirty is one press and not twelve.
- **A playlist** is the share of its lectures behind you. «Отметить все» is a
  seal rather than thirty ticks — a playlist here runs to 1192 videos — so
  taking it off uncovers what was actually watched underneath instead of wiping
  it.
- **A course** is the recording it is being studied by: the furthest-along one,
  with the last one played breaking a tie. A course carries thirteen playlists
  on average and they are alternatives, not parts; summing them would turn a
  course barely begun into one nearly finished.

Watching promotes the course on its own — started on the first lecture,
finished when a whole playlist is behind you, and the modal says so with a way
to disagree. Pressing the status button yourself claims the course, and the
automation then leaves it alone; clearing the status is not an opinion but the
withdrawal of one, so it hands the course back to being counted from lectures.

The path bar is counted in whole courses and filled in fractions: the label
says how many are behind you, and the lighter part of the bar is the course in
hand. Counting only milestones leaves the bar still for a fortnight while
somebody works through a forty-hour prerequisite; counting only fractions loses
the milestone.

**Coming back.** The embedded player is followed through the `postMessage`
handshake that a YouTube embed answers when it is loaded with `enablejsapi=1` —
no script from `youtube.com`, so the only third-party origin on the page stays
the one already serving the video. It reports the position about four times a
second and the profile writes one every five; it also reports which video is in
the frame, which is what makes the playlist's own autoplay countable instead of
losing the session after the first lecture. Reopening a part-watched lecture
picks up where it stopped, and «Место остановки» in the settings turns that off
without turning off which lectures are behind you.

## The profile

![The profile](images/profile.webp)

A modal, not a page — it opens over whatever you were looking at. Three tabs:
**Обучение**, **Настройки**, **Данные**.

Everything a reader has done here is on the first of them. It used to be three —
courses, playlists, history — and they answered the same question three times: a
saved playlist is a course you meant to watch, and a course in progress is a
playlist you are watching. Split up, nothing anywhere said what somebody was
actually in the middle of; you had to know which half of your own studying you
were looking for before you could look.

So it reads top to bottom as the routine it describes:

- **The numbers.** Hours watched, lectures behind you, courses finished, days in
  a row — then four weeks of days as a strip, and the path to everything marked
  as a goal, as one bar with the hours still to spend beside it. Three of them
  only ever go up, one says whether it is still happening, and only the bar has
  somewhere to get to: a shelf of goals on its own is a list of debts, and
  opening the panel to nothing but debts is why people stop opening it.

  Each caption names what it counts and agrees with the number over it — «4
  курса пройдено», not «4 курсов пройдено». A bare «27» over the word «лекций»
  is four different facts depending on who is reading: watched, saved,
  available, left.

  The run of days is the one thing here the rest of the profile cannot answer.
  Every other timestamp in it is a *last* time — study the same playlist for ten
  days running and it records one date — so the days are logged as they happen,
  in `profile.days`, by the writes that mean somebody was working. Switching the
  theme is not a day of study, and a streak that could be kept alive by pressing
  the light switch would be worth nothing. A run may end yesterday rather than
  today: a day is not lost until it is over.
- **Продолжить** — the last thing opened that is not finished, at the lecture
  and the second it was left at, one press away. The only card in the profile
  about right now; everything under it is a shelf of things decided at some
  point.
- **Сейчас изучаю**, **Избранное**, **Сохранённые плейлисты**, **Недавно
  открытые**, **Пройдено**. A favourite course is a goal — the word is
  «избранное» because that is the button that makes one, and its card counts the
  whole path to it. The cards under «сейчас изучаю» count lectures instead: the
  path to a course you are already watching is ancient history, and what is left
  of the recording is the useful number.

Each shelf shows a handful and opens into the whole of itself — a back button in
the corner, the tabs still above it, because a longer list of the same things is
not a different place. The way in appears only when there is something behind
it: a section showing everything it has needs no door, and a row of dead
«показать все» links teaches people to stop reading them.

The hours are a floor and say so with «≈». Lecture lengths live in the playlist
shards, which are fetched per course and capped at the dozen most recently
touched: somebody who has opened forty courses should not pay ten megabytes to
be told roughly how long they have spent. History carries a bar for its most
recent rows and no further, for the same reason.

Light and dark also have a one-click toggle in the header of both screens — that
choice is about the room you are sitting in, not about your account, and behind
a modal most people put up with the wrong one; «Авто» stays in the settings.

The language sits on the same plate, for a harder reason: someone who cannot
read the interface cannot find the settings that would fix it, and two letters
in the corner are what that person looks for. Russian and English, and like the
theme button it shows where the click leads rather than where you are. Only the
interface is translated — course titles and descriptions stay in the language
the catalogue is written in.

There is no account and no backend: it all lives in `localStorage`. The **Data**
tab exports it as a JSON file and imports one back, either replacing what is
there or merging it — on a conflict the more advanced status wins, and histories
interleave by time. That is the whole sync story, and it works between browsers
without a server.

## What lives in the URL

The domain and provider filters, the selected course and the open playlist — so
a link carries the exact view and the back button behaves.

The stage cap and the display settings do not: they belong to the reader, not to
the view being shared, and stay in `localStorage`. Map or blocks is neither — it
is not what a link points at, and it is not something one visit should decide
for the next, so it lives in memory for the length of the visit.

## Keyboard

| Key | |
|---|---|
| `/` | search |
| `t` | theme |
| `m` | swap map and columns |
| `Esc` | close the top layer |
| `?` | list all of them |

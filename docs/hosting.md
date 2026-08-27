# The address, the deploy and being found

[← docs](README.md) · the site itself: [lectorea.org](https://lectorea.org/)

A static catalogue on GitHub Pages, served from its own domain. Nothing here is
needed to work on the site — it is what to read when the site has to move, when
a fork is deployed, or when a page is not turning up in search.

## The domain

`lectorea.org` is registered through Beget and answers from GitHub Pages:

| Record | Name | Value |
|---|---|---|
| A | @ | 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 |
| AAAA | @ | 2606:50c0:8000::153, ::8001::153, ::8002::153, ::8003::153 |
| CNAME | www | fivol.github.io |

`www` points at the github.io host rather than at the apex: pointing a subdomain
at its own apex breaks Enforce HTTPS. GitHub redirects `www` to the apex on its
own, and `fivol.github.io/lectorea/*` to the domain — an old link never dies.

The domain itself is set in **Settings → Pages → Custom domain**, and that is
the only place it exists. A `CNAME` file in the repository would do nothing:
Pages ignores it when a site is published from Actions rather than from a
branch. The same setting carries the Let's Encrypt certificate and the Enforce
HTTPS switch.

## What the build knows about where it lives

The catalogue is served from the root of its domain, a fork from
`/<repo>/` on github.io, and a bundle has to be told which — an absolute path to
`/assets/…` is a 404 on a fork, and `/lectorea/assets/…` is a 404 on the domain.

`BASE_PATH` is that switch, passed by [deploy.yml](../.github/workflows/deploy.yml)
only for this repository; a fork gets an empty value and falls back to its
subdirectory. Everything downstream follows it: Vite's `base`, the PWA manifest,
and the absolute URLs in the pages below.

`VITE_GA4_ID` is passed the same way and for the same reason — the analytics
stream is this site's and this site's only, so a fork sends nothing at all
([analytics.md](analytics.md)). **`vite preview` re-reads the config without
those variables**, so a build made with `BASE_PATH=/` is served from
`/lectorea/` by the preview and answers 404 for every asset. Give the preview
the same environment as the build, or build without `BASE_PATH` when the point
is to look at the result locally.

## Pages for the crawlers

Pages serves files, and a single-page app is one file. A path it has never heard
of — `/courses/calculus-1` — is answered with `404.html`, **and with the status
to match**: the reader sees the course, a crawler sees `HTTP 404` and leaves.
Nothing below `/` could be indexed while that was true.

[`scripts/prerender.ts`](../scripts/prerender.ts) runs after `vite build` (it is
part of `pnpm build`) and writes a real file for every URL the catalogue offers:

- `courses/<id>.html` — one per course, plus `index.html`. Each is the bundle's
  own `index.html` with its head rewritten: the title, the description and the
  card of *that* course, a canonical link, and JSON-LD (`Course`,
  `BreadcrumbList`). Same hashed script, so the app boots exactly as it does
  anywhere else.
- `fields/<id>.html` — one per field of knowledge, with its own title,
  description and an `ItemList` of the courses in it, in the order they are
  meant to be taken. See [a field is a page](#a-field-is-a-page-not-a-query-string).
- A `<noscript>` copy of what the page says — the description, what the course
  needs, what it opens up, links to both — for whatever does not run JavaScript.
  It also names **the recordings themselves**: six of them, by university where
  the catalogue knows one, with the playlist's own title and how many lectures
  are in it. Everything above them is the catalogue's prose, in the same shape
  on all 225 pages; this is the part that is unlike every other page and the
  shape of the question people actually ask, which is never «математический
  анализ» on its own but «матанализ МГУ лекции». The page's own language first,
  because rating alone put six English playlists on the Russian page of half the
  mathematics in the catalogue.
- **The other names a course goes by** — «ТФКП», «теорвер», «линал». The build
  already writes them into the dictionary for the card, and they are exactly
  what a student types, being what the subject is called on a timetable rather
  than in a syllabus. They go on the page as a line of prose and into the
  `Course` markup as `alternateName`.
- `robots`, on every page: `index, follow, max-image-preview:large` for the
  ones that want to be found, `noindex, follow` for the two that do not.
  Without the image clause Google shows a thumbnail the size of a favicon
  beside a result and the page is not eligible for Discover at all — which
  would waste the one thing a result of ours has that a list of YouTube links
  does not, the 1200×630 card drawn for it.
- `<path>/index.html` beside every page, byte for byte the same. A link that
  picked up a trailing slash somewhere — `/courses/calculus-1/` — is otherwise
  a path this site has no file for, and Pages answers it with `404.html` and
  the 404 status to match. The twin carries a canonical link naming the
  slashless address, which is what a crawler consolidates the pair on. Written
  as the whole page rather than as a redirect on purpose: which of
  `courses.html` and `courses/index.html` a static host prefers for the bare
  `/courses` is undocumented, and a redirect that turned out to be the file
  *both* addresses resolve to would be a page redirecting to itself.
- `sitemap.xml`, every course and field of knowledge, dated from the build.
- `robots.txt`, pointing at the sitemap. It also `Allow`s `/data/` out loud:
  every screen is drawn from those JSON files, so a crawler that runs the
  bundle has to be able to fetch them, and blocking them would leave it
  rendering an empty page and reporting a site with nothing on it. The
  `Clean-param` line is Yandex's, and is intersectional — it needs no section
  of its own.
- `llms.txt` — what the catalogue is and which of its addresses are worth
  reading, for whatever reads a site as an answer rather than as a result to
  rank. Fields rather than courses: 225 lines would be the sitemap written
  twice, and each field page carries its own courses anyway. Not written for a
  fork, which asks to be left out of search by every other route as well.
- `404.html` and `courses.html`, the two pages marked `noindex`. The 404 is
  written once, in the catalogue's language: Pages answers every unknown path
  with that one file whatever language the path was in, so it has no
  translation to name.
- All of the above twice, once per language, plus a small redirecting page at
  each address with no language on it — see
  [a language is an address](#a-language-is-an-address). The sitemap carries
  the language trees only, each `<url>` naming its translations with
  `xhtml:link`, so a crawler that starts from the sitemap learns the pair
  before fetching either page.

Pages resolves `/courses/calculus-1` to `courses/calculus-1.html` on its own, so
the URLs do not change and neither does the router.

`/courses` with no filter on it is the second of those two for a reason worth
writing down. It draws all 225 cards across nine columns of every subject at
once — the one view of the catalogue that answers no question — so the app
sends a reader who lands on it back to the map. An address that redirects must
not also be offered as a search result, hence `noindex`; `follow`, because the
list on it is still 225 links; and the file stays, because it is also what
serves `/courses?provider=…`, which is a slice somebody asked for.

## A field is a page, not a query string

A field of knowledge used to be `/courses?domain=math`. Pages serves one file
per **path** and cannot vary on a query string, so all thirty-nine of them were
`courses.html`: the same bytes, the same title, the same list of every course
in the catalogue, until the bundle had run and rewritten the head. A crawler
that indexes what it is served had thirty-nine copies of one page and no reason
to keep any of them — and «курсы по математике» is the shape of the question
people actually ask.

So a single field of knowledge is `/fields/<id>`, a route of its own, and every
other combination stays a query string on `/courses`. The rule lives in
`useCatalogParams` in [src/lib/url.ts](../src/lib/url.ts) and nothing else needs
to know it: `fieldHref` builds the address, `columnsHref` reads it back, and
`params.search` still hands every other screen the filter as `domain=…`, so a
course opened from a field is `/courses/<id>?domain=math` exactly as before.

`?domain=` keeps working — it is what every link shared so far says — and the
canonical link of the view it opens names the `/fields/…` form, so the two
never compete.

**The columns always look at something.** A course opened by its bare address —
`/courses/inorganic-chemistry`, which is what a search result is — brings its
own fields of knowledge along with it, the same slice the search box and the
profile already opened it in. Without that, a result from search landed the
reader inside the wall of all 225 cards with one of them selected.

That slice is **derived while the screen renders**, in `useCatalogParams`, and
the address is left alone. Correcting it afterwards with a `replace` is the
obvious way to write it and the wrong one: an effect runs after the first
render, so the wall is built, painted and then rebuilt into the field — a
visible lurch, and the expensive half of the work thrown away. Leaving the URL
alone is also what keeps `/courses/<id>` the clean canonical address it is in
the sitemap, instead of `?domain=…` appearing under every reader who arrived
from search.

The picture in those cards is `public/og.png` — the real map at 1200×630, drawn
by [scripts/og-image.ts](../scripts/og-image.ts) from `map.svg` and the domain
colours, with the wordmark over it. It is committed like any other asset and
redrawn by hand when the map changes:

```bash
pnpm og:build
```

That needs a Chrome on the machine (`CHROME_PATH` if it lives somewhere
unusual) and a moment of network for the two typefaces, which are embedded into
the page it screenshots rather than linked — headless Chrome renders one frame,
and a font that arrives after it is a card set in the wrong face. CI never runs
this and does not need to.

### The mark, and the icons cut from it

`public/favicon.svg` is the mark, and the source of every raster beside it: the
`.ico` a tab reads, the two PWA sizes, the maskable icon Android crops and the
touch icon iOS puts on a home screen. `index.html` had said exactly that for a
year and nothing enforced it — the five files were made once by hand, and the
next person to change the mark would have had to find all of them and match
them by eye.

```bash
pnpm icons:build
```

[scripts/icons.ts](../scripts/icons.ts) renders the SVG once at 1024 and cuts
the rest out of it. Two shapes come from the one file. **The plate** is the
rounded tile with its corners transparent — what a tab, a bookmark and the
Product Hunt thumbnail want, because each puts it on a background of its own.
**The bleed** is the same mark with the plate dropped and the ground painted to
the edge, shrunk to sit inside the mask its platform will cut: Android clips a
maskable icon to a circle of 80% of the width and crops whatever is outside it,
iOS rounds the corners itself and shows the wallpaper through a transparent
one, so the two get different scales. The plate is found by `data-tile` on its
rects, and that convention is written down in the SVG rather than here.

The mark itself is three hexagons — two cells of the map already behind you and
the one they open. It used to be three circles joined by two lines, which is
stroke for stroke the system «share» glyph: at the size a tab gives it, that is
what it read as, and it said nothing about this site in particular. Hexagons
are the material the map is tiled from
([shared/tiles/hex.ts](../shared/tiles/hex.ts)), pointy-top on the same grid,
so the icon is now a piece of the product rather than a stock graph.

`favicon.ico` is the one output that needs ImageMagick. Without it the script
says so and leaves the file alone, because half an icon set is worse than an
old one.

Once the app has booted it takes the head over itself — `useDocumentMeta` in
[src/lib/meta.ts](../src/lib/meta.ts). Two reasons: navigation inside the app
never reloads the document, and one file still serves several views — the older
`/courses?domain=math`, and `/courses?provider=…` — so only the running app can
say which one this is and which address it should name as canonical. Both use
the same `seo.*` dictionary keys, so the static page and the rendered one agree.

**A fork is kept out of search** — `Disallow: /` and `noindex` on every page.
Two addresses with one catalogue between them only split the results, and the
original is the one with the domain. Set `SITE_ORIGIN` if a fork is meant to be
a site of its own.

## A language is an address

Every language lives in a directory named after it — `/ru/courses/calculus-1`
and `/en/courses/calculus-1` — and none of them at the root. Each declares the
other with `hreflang`, and `x-default` names the address with no language on
it at all.

The language used to live in `localStorage`, which is fine for a reader and
useless for everything else. One address served both, so a search engine had
one URL and no way to be told which language was on it; a link pasted into a
chat carried the language of whoever pasted it rather than of whoever opened
it; and a page that is two languages can declare neither.

Russian sat at the root for one build in between, which is the cheaper
arrangement and the wrong one: it makes one language the exception to every
rule about addresses, so a link is `/courses/x` or `/en/courses/x` depending on
which, and every function that builds one has to know which. Symmetry is worth
a redirect at the door.

### The door

`scripts/prerender.ts` still writes a page at every address *without* a
language — `/`, `/courses/calculus-1`, `/fields/math` — and its whole job is to
choose one and leave. It carries no *body*, because prose there would be a
third copy of a page that already exists in two languages; it carries the
choice, the `hreflang` pair for a crawler that will not run the script, and a
`<noscript>` refresh to the catalogue's own language.

Its **head** is another matter, and was nearly empty for a while — a title and
the language links, nothing else. That was wrong twice over, because these are
the addresses people actually pass around: `lectorea.org` is what goes into a
chat, a post or a README, and a link with no `og:` tags unfolds into a grey
rectangle with a hostname in it. So the door states everything a scraper reads
— description, card, canonical, `og:locale` and its alternate, the icons — in
the catalogue's own language, which is also the one it sends an unknown reader
to. The card is *that address's* card rather than the site's, so a shared
`/courses/calculus-1` unfolds into the same picture `/ru/courses/calculus-1`
does, and the description is taken from the page it opens rather than written a
second time: two wordings for one address is how the card and the page behind it
come to disagree.

The canonical link on a door names **itself**. It is what `x-default` points at,
and pointing it into the Russian tree would leave `x-default` on a page that
disclaims being canonical — and would fold every `?utm_source=…` copy of the
root into a language rather than into the address that was shared.

The order of preference is the honest one:

1. **what the reader chose**, from the profile in `localStorage` — nobody is
   sent to a language they have already switched away from;
2. **what their browser asks for**, `navigator.languages` matched by its
   first tag, which is where an `Accept-Language` of `ru-RU` ends up;
3. **the catalogue's own language**, for anything else.

It uses `location.replace`, so the back button leaves the site rather than
returning to a door that opens the same way again. And it is the same script on
the app's own pages, where it returns on its first line because the path
already names a language — which is what makes `404.html` work, since that one
file answers `/courses/typo` and `/ru/courses/typo` alike and only the path can
say which just happened.

These pages are also what keeps every link shared before the languages had
addresses alive: `/courses/calculus-1` is a redirect now rather than a 404.

### Inside the app

The seam is [src/lib/lang.ts](../src/lib/lang.ts) and it is deliberately one
line of consequence: the language is read from the path **before React mounts**
and becomes the router's `basename`. Every `to=` and `navigate()` resolves
against it, so no screen, no `href` builder and no route knows there is a
prefix at all — `/courses/calculus-1` is what the code says in both trees. The
two things that do know are the canonical link, which has to name the address
of the page it is actually on, and the header switch, which is a real
`<a href>` to the other tree: a link can be copied, opened in a new tab, and
followed by a crawler that would otherwise never learn the second tree exists.

Switching language reloads the document rather than re-routing. The `basename`
is fixed when the router mounts and so is the dictionary the page was rendered
from, and a language is changed rarely enough that the honest reload is worth
more than the machinery to avoid it.

The profile still records the choice — an export carries it, and the switch
writes it on its way out — and the door reads it, but nothing renders from it.

`scripts/prerender.ts` writes both trees, and `check:i18n` gates them: the
prose in those pages is in `data/i18n/*.json` like everything else, and the
checker reads `prerender.ts` alongside `src/` so a key only the pages use is
not mistaken for an orphan.

**The service worker has no single-page fallback**, and that is part of this.
`vite-plugin-pwa` answers every navigation from the precached `index.html` by
default, which is right for an app that is one file — and the file at the root
is now the door, not the app. See
[pitfalls.md](agents/pitfalls.md#the-service-worker-was-still-serving-the-app-shell-for-every-address).

## The card a shared link unfolds into

`public/og.png` is the picture for the site as a whole: the real map, drawn by
`pnpm og:build`, committed like any other asset. Every course and every field
has one of its own on top of that — its name, its field of knowledge in the
field's colour, and how many recordings there are — written by
[scripts/og-cards.ts](../scripts/og-cards.ts) during `pnpm build` into
`dist/og/<lang>/…`, and named by `og:image` when the file is there.

Three decisions in it are worth keeping:

- **One Chrome, five hundred pictures.** A `--screenshot` per card is seven
  seconds of process start each, which is an hour for a catalogue this size.
  The browser is started once and driven over its own debugging protocol
  instead: the page is loaded and the fonts laid out a single time, and each
  card is a text substitution and a capture, about sixty milliseconds apiece.
  The whole set takes under twenty seconds.
- **Built, not committed.** The site card is a picture somebody decided on;
  these are a function of the catalogue, which changes every night. Five
  hundred files in the repository would be five hundred rewritten on every
  title fix, and stale the day after.
- **JPEG.** The card is mostly a soft wash of the field's colour, which is the
  one thing PNG cannot compress — 55 MB as PNG against 15 as JPEG, for pictures
  no reader ever looks at closely. It also keeps them out of the service
  worker's precache, whose glob list is deliberately without `jpg`.

A machine with no Chrome is a supported way to build the site: the script says
so and stops, and `prerender.ts` looks for each file rather than assuming it,
so those pages fall back to the site card and nothing else is wrong.

## The typefaces are ours to serve

Unbounded, Onest and JetBrains Mono live in [src/fonts/](../src/fonts/) and are
bundled with the CSS. They used to be a `<link>` to `fonts.googleapis.com`,
which puts four things in front of the first letter drawn: a DNS lookup and a
TLS handshake to `googleapis` for a stylesheet, then the same again to
`gstatic` for the files that stylesheet names. Self-hosted they are one more
request to a host the browser is already connected to — and Core Web Vitals is
the one thing about this site a search engine measures directly.

`pnpm fonts:build` ([scripts/fonts.ts](../scripts/fonts.ts)) is what refetches
them when a weight is added; it rewrites every file and `src/fonts.css` with
them, and CI never runs it. Two things it does that are worth knowing:

- **Four subsets of six.** Google splits each face by alphabet; `greek` and
  `vietnamese` would be a third of the bytes for glyphs no page has asked for.
  Each rule keeps its `unicode-range` exactly as served, so a browser still
  downloads only the alphabet it is about to draw — 28 files, 688 KB on disk,
  and about 90 KB actually fetched by a Russian page.
- **Relative URLs in the stylesheet.** Vite hashes each file and rewrites the
  reference against `base`, so a fork served from `/<repo>/` gets working
  fonts. An absolute `/fonts/…` would be a 404 there, and one nobody sees until
  somebody forks.

All three are under the SIL Open Font License 1.1, whose text and notice travel
with them in [src/fonts/README.md](../src/fonts/README.md).

## When the site moves

The order matters, because the bundle is built for one base path:

1. Point DNS at the new host and wait for it to resolve.
2. Set the domain in Settings → Pages.
3. Push — the deploy rebuilds with the right `BASE_PATH` and rewrites every
   absolute URL, sitemap included.
4. Turn Enforce HTTPS on once the certificate is issued.

Between 2 and 3 the new address serves the previous build for a few minutes.
That is the whole of the downtime, and it lands on the address nobody has yet.

**The profile does not come along.** It lives in `localStorage`, which belongs
to the origin: everything marked on `fivol.github.io` is unreachable from
`lectorea.org`, and the old address only redirects, so no script of ours ever
runs there again. The **Данные** tab exports and imports it as one JSON file —
that is the migration, and it has to happen before the address changes.

## After a move

- Add the domain in [Google Search Console](https://search.google.com/search-console)
  and [Yandex Webmaster](https://webmaster.yandex.ru/), and submit
  `https://lectorea.org/sitemap.xml` in both. Verification is a DNS TXT record.
- Check a course page returns `200` and not `404`:

```bash
curl -sI https://lectorea.org/courses/calculus-1 | head -1
```

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
- `404.html` and `courses.html`, the two pages marked `noindex`.

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

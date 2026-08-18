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

- `courses/<id>.html` — one per course, plus `courses.html` and `index.html`.
  Each is the bundle's own `index.html` with its head rewritten: the title, the
  description and the card of *that* course, a canonical link, and JSON-LD
  (`Course`, `BreadcrumbList`). Same hashed script, so the app boots exactly as
  it does anywhere else.
- A `<noscript>` copy of what the page says — the description, what the course
  needs, what it opens up, links to both — for whatever does not run JavaScript.
- `sitemap.xml`, every course and field of knowledge, dated from the build.
- `robots.txt`, pointing at the sitemap.
- `404.html`, the only page marked `noindex`.

Pages resolves `/courses/calculus-1` to `courses/calculus-1.html` on its own, so
the URLs do not change and neither does the router.

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
never reloads the document, and `/courses?domain=math` is one file serving every
field of knowledge, so only the running app can say which one this is. Both use
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

# Launching on Product Hunt

[← docs](README.md) · the site itself: [lectorea.org](https://lectorea.org/)

Everything the Product Hunt submission form asks for, answered in advance where
it can be answered from the repository, and marked **[decide]** where it cannot.
The rest is the part that is not a form: what the platform rewards in 2026, what
quietly kills a launch, what has to be fixed on this site before it is shown to
an English-speaking audience, and how far the catalogue's own languages should
go.

Nothing here is published. This page is the worksheet; the launch is a decision
with a date on it.

## What Product Hunt is in 2026

Four facts change how a launch is prepared:

- **The homepage is curated, not automatic.** An editorial *Featured / All*
  split decides what reaches the homepage, the app and the daily newsletter.
  Between 2020 and 2023 most launches were featured; by 2024–2026 the share
  trackers report is around **10%**. The stated criteria are *useful,
  interesting, well-made, creative* — a bar on the product, not on the
  marketing.
- **Engagement outweighs raw upvotes.** Comments, maker replies and time on the
  page feed the ranking. A launch with fewer votes and a real discussion can
  outrank one with more votes and an empty thread.
- **Coordinated voting is discounted.** Accounts created within ~72 hours of a
  launch are filtered, votes from accounts that log in once and vanish decay,
  and counters visibly drop when a burst looks organised. Asking for upvotes is
  against the community guidelines; asking for feedback is not.
- **The day is a Pacific day.** The leaderboard runs 00:00–23:59 PT, so a
  listing published at 12:01 AM PT gets the full 24 hours and one published at
  noon gets half of them. A launch can be scheduled up to a month ahead.

So it is a six-week project with a one-day finale, and the part actually under
our control is the first comment and the replies during the first hours.

## The submission form, field by field

Limits are Product Hunt's own help centre where it states one. Where the docs
and the guides disagree — the description is the only case — the shorter number
is the safe one.

| Field | Spec | Required | Lectorea |
|---|---|---|---|
| URL | direct product link, no tracking or press links | yes | `https://lectorea.org/en/` — see below |
| Name | name only, no emoji, no descriptor | yes | `Lectorea` |
| Tagline | max 60 characters | yes | see below |
| Topics / launch tags | a few, most relevant only (guides: up to 3) | yes | Education, Open Source, Productivity |
| Thumbnail | square, 240×240, <3 MB, GIF allowed | yes | `.launch/thumbnail.png` from `pnpm ph:assets` — the app icon, see below |
| Pricing tag | free · paid · free trial/plan | yes | **Free** |
| Status | beta / not yet released | no | leave empty — it is live and has been for months |
| Gallery | 1270×760, ≥2 images, <3 MB each, first is the social preview | in practice yes | six slides from `pnpm ph:assets` |
| Video | YouTube only, full URL, public | no | script below; **[decide]** whether to record it |
| Interactive demo | Arcade, Storylane, Supademo, … | no | skip |
| Description | within 260 characters (some guides say 500) | yes | see below |
| Promo code | discount for the PH community | no | n/a — nothing to pay for |
| Makers | added by PH username | no | **[decide]** — solo, or credit contributors |
| Product X account | company/product account | no | **[decide]** — none exists today |
| First comment | the maker's kickoff | yes | drafted below |
| Schedule | date + 12:01 AM PT, or save as draft | yes | **[decide]** — the account is the gate, see the timeline |

### The URL: `/en/`, not the root

English is a different address. `lectorea.org/` is a redirector that sends a
reader to `/ru/` or `/en/` ([`src/lib/lang.ts`](../src/lib/lang.ts)), and while
it reads the browser's languages, the launch does not need to depend on that:
a Product Hunt audience is an English audience, and `https://lectorea.org/en/`
puts them on the English site with certainty. The cost is that the canonical,
share-everywhere address is the bare domain — which matters for search engines
and not at all for a listing that lives for a day.

### Tagline — max 60

The tagline says what it *does*, not what it *is*. Candidates, with lengths:

- `University lecture courses on YouTube, in the right order` — 57
- `The prerequisite map for university lectures on YouTube` — 55
- `Free university lecture courses, ordered by what comes first` — 60
- `YouTube lecture courses, arranged by what you need first` — 56

The first is the recommendation: it names the material, the source, and the one
thing a search engine does not do. `What to learn, and in what order` (32) is
the README's line and the better sentence, but on a list of forty launches it
does not say what the product is made of — keep it for the first comment.

### Description — keep under 260

> A catalogue of university lecture courses on YouTube that knows what depends
> on what. Pick a goal, get the path: every prerequisite in order, an estimate
> in hours, and thousands of recordings from 300+ universities. Free, no
> sign-up, open data, nightly re-crawl.

Re-check the numbers against `public/data/meta.json` on the morning of the
launch — the README's badge is generated, this copy is not, and the two have
already drifted apart once (see *Before it is shown to anybody* below).

## The assets

```bash
pnpm ph:assets
```

Six gallery slides and the thumbnail, into `.launch/` (ignored, rebuildable).
The script — [`scripts/ph-assets.ts`](../scripts/ph-assets.ts) — drives a
headless Chrome the way `og-cards.ts` does, and three of its decisions are the
reason it exists rather than a folder of hand-made pictures:

- **It shoots `/en/`.** Every screenshot in `docs/images` is of the Russian
  interface. A gallery of Russian screenshots tells an English reader the site
  is not for them before they have read the tagline.
- **The thumbnail is the app icon, not a picture of its own.** It is
  `public/pwa-512.png` cut down to 240, and that PNG is itself rendered from
  `public/favicon.svg` by `pnpm icons:build`
  ([hosting.md](hosting.md#the-mark-and-the-icons-cut-from-it)). So the tile in
  the Product Hunt feed, the icon in a browser tab and the one on a home screen
  are the same drawing, and changing the mark changes all three at once — but
  run `icons:build` before `ph:assets`, or the launch goes out with the icon
  the site had yesterday.
- **It seeds a profile first.** The screens worth showing are the ones that know
  who is looking: seven of twelve courses done, a streak, something to carry on
  with. It writes that into `localStorage` before the page loads — built out of
  real playlists from the catalogue, and parsed with the site's own
  `ProfileSchema`, because a profile the schema rejects is silently replaced by
  an empty one and the gallery comes out a set of empty states.
- **It burns the caption in.** The strip is scrolled without the description
  being read, so each slide says its one sentence by itself.

The running order is an argument, not a tour: the map answers *what is this*,
the columns *how is it ordered*, the course *what do I get when I open one*, the
path is the thing nothing else does, and the profile and the phone answer the
two questions a reader asks last — does it remember me, and does it work where I
actually watch. The first slide is also the social preview, which is why it is
the map.

Captions live in `SHOTS` at the top of the script; they are the part that gets
rewritten. Keep them under about 56 characters or they wrap to two lines.

### The video — 45–60 seconds

Optional, and about half the products that took Product of the Day carry one.
No voice-over: captions burnt in, one idea per shot, and the site doing the
talking. Record the English site in a 1440×900 window, dark theme, with a
profile that has some study in it (the one `pnpm ph:assets` seeds is exactly
right — sign in on a scratch browser profile, or use your own).

| Time | Shot | Caption |
|---|---|---|
| 0:00–0:06 | The map, a slow pinch into the formal sciences | Every field of knowledge is a territory |
| 0:06–0:14 | Click Computer science; the columns fill in | Columns are levels: what has to come first |
| 0:14–0:24 | Open *Deep learning*; hover its card so the chain lights | A course knows what it needs, and what it opens |
| 0:24–0:34 | Star it; unfold *Path* — 12 courses, hours, 7 done | A goal turns into a route |
| 0:34–0:46 | The playlists: filter by university, open one, tick a lecture | Every recording of it, ranked — watch it here |
| 0:46–0:54 | The profile: hours, streak, Continue | It counts itself. No account, nothing to pay |
| 0:54–0:58 | End card: the map, `lectorea.org`, "free and open data" | — |

Export at 1080p, upload to YouTube as **public** (Product Hunt will not load a
private one), and paste the full URL — shortened links do not resolve.

## The first comment

Product Hunt's own figure: 70% of products that took Product of the Day, Week or
Month had a maker's first comment. Written before the launch, pasted at 12:01,
and asking for feedback rather than votes. Draft:

> **What to learn, and in what order.**
>
> I kept hitting the same wall teaching myself: YouTube will find me a lecture
> on tensor analysis, but it will not tell me I won't understand it without
> linear algebra. Search gives you links. What is missing is the order.
>
> Lectorea is a catalogue of university lecture courses where every course knows
> what it depends on and what it opens up — 236 courses across 39 fields, and
> some 10,000 recordings of them from 300+ universities and channels. It answers
> the two questions a search box cannot: *what do I need before this*, and *what
> can I start right now with what I already know*.
>
> - Mark a course as a goal and it lays out the path: every prerequisite in
>   order, with an estimate in hours and a bar that fills as you go.
> - Recordings are ranked by how strongly people reacted per view rather than by
>   view count, so a careful course from a small university can outrank a famous
>   one. Dead and half-deleted playlists drop out on their own.
> - Watch in the built-in player and progress counts itself, lecture by lecture.
> - No account and no ads. Everything you mark lives in your browser; signing in
>   with Google is optional and only there to carry the same JSON between your
>   own devices.
> - The catalogue is open data on GitHub, and it re-crawls itself every night.
>
> What I would most like from you: **tell me a course that is missing, or a
> prerequisite I got wrong.** Where would you have expected the path to start?

Two rules for the day: reply to every comment inside 15–30 minutes, and never
ask for an upvote in any channel. "We are live, feedback welcome" is fine;
"upvote us" is what gets a launch filtered.

## The timeline

The gate is the **maker account**, not the product. An account younger than a
month is the exact pattern the vote filter looks for, so the launch date is set
by when the account was made plus thirty days — everything else fits inside
that.

- **Now · age the account.** Fill the profile, add an avatar, and comment
  genuinely on other launches a few times a week. This is the only item with a
  hard clock on it.
- **Now · get sync onto the live site.** It is committed (`An account is a copy
  of the profile, never its primary key`) and not yet pushed, so
  lectorea.org does not have it. Until it deploys, "my profile is trapped in one
  browser" is still true, and it is the first objection a careful reader raises.
- **T−14 · the assets and the copy.** `pnpm ph:assets`, the video if it is
  happening, and the tagline, description and first comment read out loud and cut
  by a third.
- **T−7 · the people.** Everyone who should hear about it on the day, listed by
  name and channel — not a mass DM. Anyone told "upvote me" is a liability;
  anyone told "I'm launching Tuesday, I'd value your read" is not.
- **T−1 · the freeze.** No data changes and no deploys after the evening before.
  Check that the nightly refresh finished and the site rebuilt green: the launch
  minute (12:01 AM PT ≈ 07:01 UTC in summer) sits right on top of the nightly
  publish window, and a half-deployed catalogue on launch morning cannot be
  recovered in time. Open the site cold on a phone, in both themes, from a clean
  browser.
- **Day · presence.** Publish at 12:01 AM PT, then be at the keyboard: every
  comment answered, every "you are missing X" turned into an issue in front of
  the person who said it. That is what the ranking now measures.
- **T+1 … T+7 · the tail.** Answer the late comments, and turn the launch day's
  empty searches into the next harvest ([harvest.md](harvest.md)) — a search
  that returns nothing is a course the catalogue is missing
  ([analytics.md](analytics.md)), and launch day produces more of them than a
  normal month.

## What quietly kills a launch

From the community guidelines and the failure reports around them: asking for
upvotes anywhere (DMs, Slack, Telegram, LinkedIn); mass messaging, vote-exchange
groups, incentives of any kind; votes from accounts registered that week, which
are filtered rather than refused, so the counter rises and the rank does not;
and a listing written in marketing language, which reads as noise to the
curators and the readers both. None of it is enforced by a human writing back to
explain — the launch simply does not move.

## Before it is shown to anybody

Two things on the site are wrong for an English reader, and both were found
while making the gallery:

- **The README says the catalogue is mostly Russian. It is not, any more.** Of
  10,857 playlists, 7,370 are English; 234 of 236 courses have at least one
  English recording, 221 have a full English course, and for 163 of them the
  top-ranked recording is English. Two courses have nothing in English at all
  (`classical-philology`, `poetics`). The sentence in `README.md` — "most of the
  catalogue is Russian for now" — now argues against the site to exactly the
  audience a launch brings, and the badge numbers (225 courses, 5,800
  recordings) are stale as well.
- **A provider label is untranslated.** `data/providers.yaml` gives the fallback
  provider `unknown` the title `Прочие каналы`, and it is rendered as-is on the
  English site, under recordings whose channel is not in the list. Provider
  titles are single strings while the site is bilingual, so this is one instance
  of a class: proper names (МГУ, МФТИ) are arguably right in Cyrillic, but a
  *label* is not a name. The narrow fix is an i18n key for the fallback; the
  general one is a check in [`scripts/check-i18n.ts`](../scripts/check-i18n.ts)
  that no string reachable on `/en/` is Cyrillic that is not somebody's name.

Neither is a launch blocker on its own. Both are cheap, and both are the kind of
detail a curator reads as craft.

## Which languages the catalogue should speak

The question the launch raises, since Product Hunt's audience is global: is
English enough, and if not, what comes after it?

**The graph does not care.** A course is an abstract unit and a playlist is one
realisation of it ([data.md](data.md)), so a language is not a new catalogue —
it is more recordings hung on the 236 courses that already exist. That makes
adding one cheap in design and expensive only in crawl quota and in the human
pass that confirms each binding ([harvest.md](harvest.md)). It also means a
language can be added at any time, which is an argument for not doing it now.

**English is not finished, and depth beats breadth.** 15 courses have fewer
than three full English courses behind them, two have none, and 73 still rank a
Russian recording first. The reader the launch brings hits exactly those gaps —
and the filter starts on the language of the page, so an English visitor is
looking at the English catalogue and nothing else. Every hour spent there is an
hour spent on the audience that is actually arriving. **This is the
recommendation: finish English before opening a third language.**

When English is deep, the order to consider is set by how much *complete
semester lecture course* material actually exists on YouTube in each language,
which is not the same as the number of speakers:

- **Spanish** — the largest academic YouTube after English: UNAM, UPV, several
  Latin American universities, plus lecturers who publish whole courses. The
  obvious second language.
- **German** — smaller, but unusually well suited: German universities publish
  entire *Vorlesungen* with the semester structure intact, which is exactly the
  unit this catalogue is built out of.
- **Portuguese** — Brazilian universities (USP, Unicamp and others) put real
  courses up; a good third.
- **Hindi** — enormous volume, but most of it is exam-preparation coaching
  rather than university semester courses, so the bar in
  [CONTRIBUTING.md](../CONTRIBUTING.md) ("one unit is one semester course")
  would reject most of what a crawl returns. Note also that much Indian
  university material (NPTEL, the IITs) is already in the catalogue *as
  English*.
- **French** — weak fit rather than weak volume: the famous French material is
  public lecture series (Collège de France) rather than taught courses.
- **Chinese** — out of scope, and not for lack of material: it lives on Bilibili,
  not on YouTube.

**The rule worth writing down before any of this:** a language earns a place in
the filter when it can cover a majority of the courses that already exist in it.
Below that, the filter is a promise the catalogue cannot keep — a reader picks
their language, sees four courses, and concludes the site is empty. The site
already applies the same logic to individual courses, which are kept in the data
and hidden from view until a recording matches them.

## Still to decide

- [x] Launch after sync ships — sync is committed; it still has to be pushed and
      deployed
- [x] Assets: gallery and thumbnail built by `pnpm ph:assets`; video script above
- [ ] Launch date = the account's 30th day, on a Tuesday, Wednesday or Thursday
- [ ] Record the video, or launch without one
- [ ] Self-hunt, or find a hunter who actually uses the site
- [ ] An X account for the product, or leave the field empty
- [ ] Makers to credit besides the author
- [ ] What the day is meant to leave behind: GitHub stars, issues, or nothing
      but traffic — there is no sign-up, so whatever it is has to exist before
      the day
- [ ] Fix the two English-facing details above

## Sources

Read in August 2026. Product Hunt changes its form and its curation more often
than it announces it, so re-read the first three on the week of the launch.

- [How to post a product — PH Help Center](https://help.producthunt.com/en/articles/479557-how-to-post-a-product)
- [Preparing for launch — PH](https://www.producthunt.com/launch/preparing-for-launch)
- [Community guidelines — PH Help Center](https://help.producthunt.com/en/articles/3615694-community-guidelines)
- [Launch assets: sizes, video and the first comment](https://submitator.com/blog/product-hunt-launch-assets)
- [Launch statistics 2026: featured rate, traffic, conversion](https://www.shno.co/marketing-statistics/product-hunt-launch-statistics)
- [Launch checklist 2026](https://getlaunchlist.com/checklists/producthunt)

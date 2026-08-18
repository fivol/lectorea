# What the site counts

[← docs](README.md) · the site itself: [lectorea.org](https://lectorea.org/)

The catalogue has no backend and no accounts, and everything a reader marks
lives in their own browser ([interface.md](interface.md)). This page is the one
exception to "nothing leaves the machine", written down in full: what is
counted, what is refused, and how to turn it off.

It exists for one reason that no other source can answer. **A search that finds
nothing is a course the catalogue is missing.** The crawl can say which
playlists failed to bind to a course we have ([matching.md](scripts/matching.md));
nothing in the pipeline can say that forty people this month looked for
functional analysis and were shown an empty panel. That question comes from
readers or from nowhere, and it decides what
[`_gaps.ts`](agents/iteration.md#3d-and-when-the-answer-is-a-course-the-catalogue-does-not-have)
is pointed at next.

## What goes, and what does not

Everything leaves through one function — `track` in
[src/lib/analytics.ts](../src/lib/analytics.ts) — and that function scrubs what
it is given rather than trusting its caller. Three rules do the work:

- **Ids out of the catalogue may travel.** A course id, a domain, a YouTube
  playlist or video id, a provider, a level, a count. All of them are public
  facts about the catalogue and most are already in a link a reader would share.
- **Free text may not**, with one exception. The search box is the only place on
  the site that takes any, and a query goes only after `searchTerm` has
  lower-cased it, refused anything over sixty characters, and refused anything
  shaped like an e-mail address, a phone number, a handle or a long run of
  digits. A query that is refused still counts as a search — the totals stay
  true, the words simply do not go.
- **The URL is rebuilt, not forwarded.** A page view is named by the page's own
  canonical path, and its query string is filtered to an allowlist of four
  parameters. A parameter added to the app next year cannot start leaving the
  browser without somebody adding it to that list.

  One consequence worth knowing before reading a report across 2026-08-18: a
  field of knowledge is `/fields/<id>` from that build on, where it used to be
  `/courses?domain=<id>` ([hosting.md](hosting.md#a-field-is-a-page-not-a-query-string)).
  Both are the same screen and both are counted, but they are two rows in a
  page-path report, so a trend over that date has to sum them.

Nothing identifies a person. There is no user id, no advertising storage, no
Google signals — `allow_google_signals: false` is set before the first event, so
the half of GA4 that infers age and interests from a signed-in Google account is
off, and `pnpm ga4:setup` turns it off at the property as well. Consent Mode is
declared with all three advertising purposes denied and never granted.

**The profile itself is never sent.** Exporting it counts as one event carrying
two numbers — how many courses and how many playlists were in it — and the file
goes to the reader's disk and nowhere else.

## The switch

**Профиль → Настройки → «Анонимная статистика»**, on by default, and stated in
plain words next to the switch rather than in a policy nobody opens. There is no
cookie banner: everything a banner would ask about is denied by construction.

Three other things switch it off, each on its own:

| | |
|---|---|
| no `VITE_GA4_ID` in the build | a fork, a local checkout, `pnpm dev` — no script is loaded and no request is made |
| `Do Not Track` or Global Privacy Control | read on every event, so a signal that arrives late still counts |
| a development build | unless `VITE_GA4_DEBUG=1`, or an afternoon of work lands in the readers' reports |

Turning the switch off stops an already-loaded gtag as well as the next one, so
it takes effect on the press. The press that turns it **off** is not itself
counted: the store notifies its subscribers synchronously, so consent is already
withdrawn by the time the event would be sent. The cost is that the opt-out rate
is unknowable, which is the right way round — a switch that sends one last event
on its way out is not a switch anybody should believe.

## The events

The full list, with what each parameter means, is
[shared/analytics.ts](../shared/analytics.ts) — it is the registry both sides
read, and it is the documentation. In outline:

| | |
|---|---|
| **Reading** | `page_view`, `course_open` (with the course's level, field and how many recordings it has), `map_view`, `filter_apply` |
| **Searching** | `search`, `search_no_results`, `search_select` |
| **Watching** | `playlist_open`, `video_start`, `video_progress` at 10/25/50/75/90%, `video_complete` |
| **Marking** | `lectures_marked`, `playlist_sealed`, `playlist_saved`, `course_status`, `course_goal` |
| **The profile** | `profile_open`, `resume_continue`, `setting_change`, `profile_export`, `profile_import`, `profile_reset`, `copy` |
| **Everything else** | `outbound_click` (the host, never the URL), `app_error` |

`video_start` and friends keep GA4's own names rather than better ones of ours,
because the built-in reports are keyed on them and a synonym buys a second,
emptier version of a report that already exists.

Two of these are worth knowing about in more detail.

**`app_error`** is the only error reporting this site has. There is no server to
log to, so an exception on somebody's phone is otherwise invisible until they
report it — and a static site that breaks on one browser breaks silently for
everybody using it. The message is cut to a hundred characters and the stack
never goes: a stack costs a report nothing it can use and is the one field with
a chance of carrying a URL somebody was on. Five per session, because the
failure worth knowing about is the first one.

**`video_progress`** is four events per lecture, not four hundred. The player
reports its position about four times a second and the profile already throttles
that to one write in five seconds; what a report can use is the shape of the
drop-off, so the milestones go once each.

## Where the events are wired

Almost nowhere, and that is deliberate. A `track()` beside every button rots the
first time somebody adds a button and forgets one, so the events are taken at
the four places everything already passes through:

| Chokepoint | What it counts |
|---|---|
| `useDocumentMeta` ([src/lib/meta.ts](../src/lib/meta.ts)) | every page view — it is the function that already knows the canonical path and the title, for every screen there is and every screen there will be |
| the profile store ([src/store/profile.ts](../src/store/profile.ts)) | every progress write, through a table of actions rather than a call inside each one |
| `useSearchResults` ([src/lib/search.ts](../src/lib/search.ts)) | every search, once it has settled — both screens search through it |
| one document-level listener | every link that leaves the site |

The mechanism is `reporting()` in
[src/lib/analytics.ts](../src/lib/analytics.ts): it wraps an object of actions,
runs the original, and asks a table what happened — with the state from **both**
sides of the call, which is what lets an event be described by its outcome.
`cycleCourseStatus` is given an id and no status, and which of the three it
landed on is only knowable afterwards. The playlist filters are counted the same
way, by diffing the panel's state, so all twelve of them — and the reset button,
which no control owns — are covered by one function.

## Setting the property up

The site needs one thing: a measurement id, which is public by construction
since it ships inside the bundle. [deploy.yml](../.github/workflows/deploy.yml)
passes it for this repository only, so a fork is silent without editing
anything. Locally it is `VITE_GA4_ID` in `.env` — [setup.md](setup.md).

The property needs rather more, and this is the part that is invisible until it
is missing:

```bash
pnpm ga4:setup
```

```bash
pnpm ga4:setup --apply
```

**GA4 accepts any parameter on any event, stores it, and then offers none of
them in a report unless a custom dimension or metric has been registered for
that exact name.** Events arrive, the totals go up, and the breakdown the event
was added for is simply not in the menu — discovered a month later, by which
time that month's data cannot be recovered. `ga4:setup` reads the registry in
`shared/analytics.ts`, creates what is missing, and is safe to re-run; it also
turns Google signals off and sets retention to fourteen months, because two
months cannot answer whether a course opened last autumn is still opened.

The property is `properties/550301710`, which `--property=` takes directly and
saves the three round trips it otherwise costs to find the stream. A label GA4
refuses — it allows letters, digits, underscores and spaces and nothing else,
which «Watched %» found out — is reported and the run carries on, because one
name being wrong is not a reason to leave the other thirty unregistered.

So the rule is one line: **an event is added to `shared/analytics.ts` first**,
and `pnpm ga4:setup --apply` is run before it ships. In development the console
warns about any event or parameter that is not in the registry, which is the
only moment anybody is watching.

The script needs administrative access, which is granted by hand and cannot be
granted any other way: an analytics *account* cannot be created by an API at
all, and a service account cannot be given rights by an API it has no rights on.

1. [analytics.google.com](https://analytics.google.com/) → **Admin** → **Account
   access management**
2. **+** → **Add users** → the `client_email` from `keys/ga4-admin.json`
3. role **Administrator**

`keys/` is in `.gitignore` and stays there. Neither the site nor CI ever needs
that key — only the script that registers the dimensions a report is read
through.

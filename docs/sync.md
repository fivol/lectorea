# The sync account

[← docs](README.md) · the optional account that carries a profile between a
laptop and a phone

Everything a reader marks lives in one `localStorage` key and always will
([interface.md](interface.md#the-profile)). That is what makes the catalogue
usable with no account, no password and no server that can read anybody's
history — and it costs exactly one thing, which readers hit immediately: **the
profile is trapped in one browser.** Study on a laptop, open the site on a
phone, and it does not know you.

The account is the way out of that, and it is a *setting*. Nothing on the site
is behind it, nothing is taken away without it, and a reader who never signs in
loses no feature and downloads not a byte of the code that would have signed
them in. That constraint is the one this whole design is arranged around —
[roadmap.md](roadmap.md#1-sync-between-devices) explains why it was chosen over
the two cheaper shapes.

![The Данные tab, signed out](images/data.webp)

## What a reader sees

**Профиль → Данные → Синхронизация.** Signed out it is one sentence and a
button. Signed in it is the account, one word of status, «Выйти», and — set
apart, in red — «Удалить копию в облаке».

Two buttons rather than one, because they are two different questions:

| | What it does |
|---|---|
| **Выйти** | this device stops syncing. Nothing is deleted, here or on the server; signing in again picks the profile back up |
| **Удалить копию в облаке** | the document is deleted from Firestore and the device signs out. **The profile in this browser is untouched** — the copy goes, the marks stay |

The second is the only way anything is removed from the server, and it removes
all of it: there is no backup, no tombstone and no other copy.

Outside that section syncing shows itself in exactly one place — the profile
disc in the header carries the account's initial instead of the anonymous
glyph. There is no avatar: it would be the only request this site makes to a
third party for a picture, on a screen whose argument is that nothing about a
reader leaves the browser.

## How it works

One Firestore document per account, at `profiles/{uid}`:

```
rev        an integer, incremented on every write
version    PROFILE_VERSION of the build that wrote it
updatedAt  the profile's own timestamp, for reading in a console
data       the whole profile, as one JSON string
```

**The profile travels as a string, not as a map.** A map is indexed, and a
reader with three thousand ticked lectures is a map with three thousand keys —
well past the index entries one document is allowed. A string is opaque to
Firestore, costs one write whatever is in it, and is the same bytes the export
button already produces.

**`rev` is a counter, not a clock.** Two devices writing in the same second
still get different numbers, and comparing numbers needs no agreement about
whose clock is right or which time zone it is in.

### Fast-forward, or merge

Each device keeps a mark in `localStorage` — which revision it is standing on,
and whether the profile has been written since. Every time the cloud copy is
read, `decideSync` in [`src/lib/sync.ts`](../src/lib/sync.ts) answers with one
of four words:

| | When | What happens |
|---|---|---|
| **push** | the cloud has nothing, or is behind | this device's profile goes up |
| **pull** | the cloud moved, this device did not | the cloud copy replaces the local one |
| **merge** | both moved — or this device has never synced this account | union, then push |
| **idle** | neither moved | nothing |

The shape is git's, and the distinction between **pull** and **merge** is the
whole design. `mergeProfiles` is a union — a lecture watched on either machine
is watched, a day studied on either is studied — which is what makes it safe to
run on a device that cannot know whether it has already run: merging in either
order gives the same answer, and merging twice changes nothing.

The price of a union is that **a merge cannot carry an erasure**. Untick a
lecture on the phone, merge with a laptop that still holds the tick, and the
tick comes back. So the union is reserved for the case where two histories
genuinely diverged, and everywhere else one side is simply ahead and is taken
wholesale. That is the line that lets an untick on the phone reach the laptop,
and it is the one behaviour in the sync worth testing on its own —
[`tests/sync.test.ts`](../tests/sync.test.ts) does nothing else.

A device that has never synced this account is always a merge, whatever the
numbers say: what is in that browser and what is in the cloud are two
independent histories, and dropping either is the one unrecoverable mistake
available here. So signing in on a laptop that already has a year of marks adds
to the cloud copy rather than being overwritten by it.

### Settings, which do not merge

Settings travel with the profile — a goal set on the laptop should be the goal
on the phone — and the **newer profile's win wholesale** rather than field by
field. A per-field merge of a theme and a playback speed is a reconciliation
problem with no right answer and no way to explain it.

`splitRatio` is the exception, because it is not a preference: it is where the
drag handle sits between the columns and the panel, measured against one screen.
A 27-inch monitor's split arriving on a laptop is a panel off the edge, so it
stays where it was measured.

### What a write costs

The free tier is 20 000 document writes a day for everybody together, and the
player reports where the playhead is **every five seconds** for as long as a
lecture runs. Left alone that is two thousand writes for one afternoon of
watching.

So a write is debounced by 4 seconds — a shift-click over forty lectures is one
write — with a **floor of 60 seconds between writes**, and a flush when the tab
is hidden or closed (`pagehide`, which fires where `beforeunload` does not). A
minute late is invisible to a reader and is the difference between this costing
nothing and costing money.

### What is never sent up

- A profile from a **newer build** of the site. The local one is left alone and
  a banner asks for a reload; pushing it would turn "this browser cannot read
  it" into "nobody can".
- A profile over **900 KB**. One document is a megabyte, and a decade of daily
  study is a few hundred kilobytes — but the failure to avoid is the silent
  one, where the server refuses the write and the reader believes they have a
  backup. The sync stops and says so.

### Where the code is

| | |
|---|---|
| [`src/lib/sync.ts`](../src/lib/sync.ts) | the rules, with no Firebase in them — the decision, the mark, the document's shape |
| [`src/lib/profile-merge.ts`](../src/lib/profile-merge.ts) | the union, also used by the file import |
| [`src/lib/sync-engine.ts`](../src/lib/sync-engine.ts) | everything that talks to Firebase |
| [`src/store/sync.ts`](../src/store/sync.ts) | what the interface knows, and the lazy import |
| [`src/screens/Profile/SyncSection.tsx`](../src/screens/Profile/SyncSection.tsx) | the section in **Данные** |

**The SDK is never in the main bundle.** It is 165 KB gzipped, and it is behind
a dynamic import that only runs for a reader who has signed in or is coming back
from a sign-in redirect. It is also named as its own chunk and excluded from the
service worker's precache in [`vite.config.ts`](../vite.config.ts) — without
that the lazy import buys nothing on an installed app, which pulls every `.js`
in the build down on first run.

## Setting it up

The site is static and stays on GitHub Pages; Firebase is used for two things
only, and Firebase Hosting is not one of them.

1. **A project.** [console.firebase.google.com](https://console.firebase.google.com/)
   → *Add project*. Google Analytics for it can be declined — the site has its
   own ([analytics.md](analytics.md)).
2. **Authentication → Sign-in method → Google.** Set the support email. That is
   the only provider wired up; see *What is deliberately not here* below.
3. **Authentication → Settings → Authorized domains.** Add `lectorea.org` and
   keep `localhost`. A domain that is not on this list gets
   `auth/unauthorized-domain` and nothing else — it is the first thing to check
   when sign-in works locally and not in production.
4. **Firestore Database → Create database.** Production mode, and a region
   close to the readers (`europe-west3` for this one). The rules that ship in
   production mode deny everything, which is the right starting point.
5. **The rules.** [`firebase/firestore.rules`](../firebase/firestore.rules) —
   one document per reader, readable and writable by that reader alone. Deploy
   them, or paste them into the *Rules* tab:

   ```bash
   firebase deploy --only firestore:rules --project <project-id>
   ```

6. **The web config.** *Project settings → Your apps → Web app*. Four of its
   fields become the environment variables below.

### The environment variables

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

**Locally** they go in `.env`, next to the YouTube keys —
[`.env.example`](../.env.example) has them commented out. **On CI** they are
repository secrets named without the `VITE_` prefix (`FIREBASE_API_KEY` and so
on), passed to the build by
[deploy.yml](../.github/workflows/deploy.yml); the environment wins over the
file, so a checked-out `.env` cannot override what the workflow hands in.

**All four empty is a working site with no accounts.** The section does not
appear in the profile, `bootSync` returns before loading anything, and the SDK
is never fetched. That is what a fork gets, and it is deliberate: a fork must
not build against this project's Firestore.

None of the four is a secret, whatever the word "key" suggests. A Firebase web
config ships inside the bundle by construction and is public the moment the site
is; what protects a profile is the security rule and nothing else. They are kept
out of the repository so a fork is silent by default, not because knowing them
buys anything.

### Popups, and where they are not allowed

Sign-in uses `signInWithPopup`, which is the better flow everywhere it is
allowed. It is not allowed in an installed app on iOS, in some in-app browsers,
and wherever a blocker is on — so a blocked popup falls back to
`signInWithRedirect`, which leaves the page and comes back.

The redirect needs one thing the popup does not: something on the way back in
has to know a sign-in is in flight, because the mark is only written after a
sync has actually happened and a fresh load would otherwise say "no account
here" and load nothing. That is the `catalog.sync.returning` key, and it is why
`getRedirectResult` is called at all.

## What is deliberately not here

- **No anonymous accounts.** An account nobody chose is an identity attached to
  a browser, which is the thing the profile is designed not to have.
- **No second provider, yet.** Google is one button and covers most of the
  audience. Apple needs a paid developer account; email links need a mail
  template and a second flow to explain. Adding one is a line in the engine when
  there is a reason.
- **No Firebase Hosting.** The site is built and deployed by
  [deploy.yml](../.github/workflows/deploy.yml) to GitHub Pages and there is no
  reason for a second host — see [hosting.md](hosting.md).
- **No server-side anything.** No Cloud Function, no admin path, nothing that
  reads across accounts. The rules file is the entire server, and it fits on a
  screen.
- **Nothing new in the analytics.** Four events — a sign-in attempted, a device
  meeting the cloud copy, a sign-out, a failure — and none of them per write.
  The profile itself never travels through `track`, which is unchanged from
  [analytics.md](analytics.md): what is counted is that syncing happened, never
  what was in it.

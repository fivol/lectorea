# The environment

[← agents](README.md) · what is slow here, what must not be run blind, and how
this repository differs from an ordinary one with a frontend

The shared half: [scripts/README.md](../scripts/README.md) documents the
commands, [pipeline.md](../pipeline.md) what the crawl does. Only what an agent
needs in order not to stall is here.

## Quota is the scarce resource

10 000 units a day **per Google Cloud project**; the configured ceiling is 9500
per key. `.env` holds ten keys from ten projects — **95 000 units a day**. It
resets at Pacific midnight whether or not anything used it.

The number of keys is not written down in the code: `youtubeKeys()` reads
whichever `YOUTUBE_API_KEY<N>` the environment has. It used to enumerate a fixed
range, which silently dropped the tenth key and cost a day's worth of it
([pitfalls.md](pitfalls.md#a-tenth-key-was-in-env-and-the-crawler-read-nine)).

Before planning anything, look at what is left:

```bash
pnpm exec tsx -e "import {openDb, quotaDateKey} from './scripts/lib/db.ts'; const db=openDb({readonly:true}); console.log(quotaDateKey(), db.prepare('SELECT * FROM quota WHERE date = ?').all(quotaDateKey()))"
```

**The day here is the Pacific one** — `quotaDateKey()`, and nothing else. SQL
`date()` gives the UTC day and points at the wrong one for part of every day; the
local date is wrong more often. The reason is in the comment on `lib/db.ts`: the
quota resets at Pacific midnight, and from a zone ahead of UTC a naive conversion
would have the crawler reading yesterday's spend at exactly the hour the nightly
job runs.

A key with no row for today is an untouched key. Four of them are 38 000 units
that will expire by morning, and the only situation in which `_hunt.ts` is the
right call ([harvest.md](../harvest.md#seam-8--asking-youtube-itself), seam 8).

**The prices everything else follows from:** walking a playlist's videos ~2.3
units, metadata for 50 playlists 1, `search.list` 100. Hence the ordering rule:
match before crawling, because matching is free and decides what the day buys.

## The nightly job crawls what the laptop published, not what the laptop has

`refresh.yml` fires at **08:30 UTC** — half an hour after the quota resets, and
with GitHub's cron lag that has meant 09:00 both days it was watched — and it
restores the `data-cache` release before it crawls. So a day of local crawling
that was never published is invisible to it: it re-walks a queue the laptop has
already paid for and then publishes a snapshot *behind* the laptop.

**The runner has one key, not three.** `refresh.yml` passes
`YOUTUBE_API_KEY2` and `3` as well, and both secrets are empty — the run log
prints them blank and the job stops at `квота исчерпана, потрачено 9504`. So the
night is worth **9500 units and about 3200 playlists walked**, which is the
number to plan the morning around: the laptop's ten keys are ten times the
night, and the queue the night cannot finish is the queue the day inherits.

That was the state on 2026-08-19 at 08:00 UTC — release 63 077 playlists, laptop
79 475 — and the fix is one command with a deadline:

```bash
pnpm cache:publish            # ~4 minutes: 24 GB on disk → 686 MB → 210 MB uploaded
```

**If the laptop has crawled since the last publish, publish before 08:30 UTC.**
Then the nightly restores that generation and spends the night on the real
queue. Checking costs nothing:

```bash
gh release download data-cache --pattern 'cache.db.stamp' -D /tmp --clobber && cat /tmp/cache.db.stamp
pnpm exec tsx -e "import {openDb} from './scripts/lib/db.ts'; const db=openDb({readonly:true}); console.log(db.prepare('SELECT count(*) c FROM playlists').get())"
```

The mirror of the same rule holds for the rest of the day: **anything the
nightly crawls after that is only reachable by `make pull`**, and a pull
replaces the local database — so it goes *before* the day's own crawling and
hunting, never after. A laptop that hunts first and pulls second throws the
searches away; one that publishes over the release without pulling throws the
night away.

## What to run in the background

The crawl comfortably outlives the `Bash` timeout of 600 s; `data:refresh` on a
full queue runs for hours.

- A long step gets `run_in_background: true`; carry on with docs and code.
- To wait for a condition, use an `until` loop in the background — a foreground
  `sleep` is blocked.
- Watch progress by querying `cache.db`, not only the log: the log buffers, the
  database does not.
- **One writer on `cache.db` at a time.** Reading alongside a crawl is safe and
  is how you watch it; a second *writing* process kills the crawl outright with
  `SQLITE_BUSY_SNAPSHOT`, and the busy timeout does not cover that case
  ([pitfalls.md](pitfalls.md#two-processes-wrote-to-cachedb-and-the-crawl-was-the-one-that-died)).
  A day with more quota than one process can spend is spent in the expensive
  currency — a hunt at 100 units a query — not in a second crawl.

```bash
pnpm exec tsx -e "import {openDb} from './scripts/lib/db.ts'; const db=openDb({readonly:true}); console.log(db.prepare(\"SELECT count(*) c FROM jobs WHERE status='pending' AND type='videos'\").get())"
```

## The dashboard is a file, not a page you can open in the preview

`pnpm stats` recomputes everything from an 18 GB `cache.db` — about 35 seconds,
most of it one group-by over the 1.8 million rows of `videos` — and `--serve`
does the whole thing again on every request. Reading it through the browser
preview did not work on 2026-08-18: the same server answered `curl` in 30 s
while the preview tab, which re-requests while the first one is still
computing, never rendered and left the queue draining for ten minutes.

So look at what plain `pnpm stats` writes:

```bash
pnpm stats && open .stats/dashboard.html
```

The page is one self-contained file with no script and no external request, so
it opens from disk exactly as it would be served — which also means the markup
can simply be read when what is being checked is a number rather than a colour.

## The order that must not be rearranged

`import → discover → mine → match → refresh → subscribers → match → authors → embeds → build`.
The reasons are in [scripts/README.md](../scripts/README.md#make-pipeline); two
of them matter to an agent:

- **match before the crawl** — otherwise the day goes on playlists nothing will
  show;
- **match again after it** — the crawl gave titles to playlists that had none,
  and the rule pass reads nothing but the title.

When the spend has to be aimed rather than "however much it takes": `data:refresh`
spends everything there is, while `data:playlists` buys metadata only (1 unit per
50) and leaves the video walk for later. That is how to prepare a queue without
emptying the day into it.

## Building and checking

- `make check` runs CI's own order: `typecheck`, `test`, `data:build`,
  `check:i18n`, `build`.
- `data:build` reads `cache.db`. Do not run it during a crawl — a half-way
  snapshot answers nothing.
- Do not run linters or builds unasked; `make check` before a commit is the
  exception, being a functional check rather than formatting.

## What must not be committed

- `data/cache.db` — a week of quota, in `.gitignore`, published through the
  `data-cache` release.
- `.env` — ten keys. Never print the values; counting them is fine
  (`make doctor`).
- `public/data/` — generated by the build.

Committed: `data/*.yaml`, `data/courses/`, `data/i18n|keywords|aliases`,
`scripts/`, `shared/`, `src/`, `docs/`.

## The scratch scripts

`scripts/_*.ts` are deliberately not wired into `pnpm`: they are run a few times
a year, and the useful half of the work is the judgement rather than the script.
The full list with prices is in
[iteration.md](iteration.md#the-tools-in-one-place). The order to reach for them
in is set by price: the free ones first (`_refusals`, `_noisy`, `_probe`,
`_holes`), then the per-unit ones (`_vet`), and `_hunt` only on untouched keys.

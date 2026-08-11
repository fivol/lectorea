# Crawling YouTube

[← all scripts](README.md) · everything that spends quota, plus the two content
imports that feed it.

These need `YOUTUBE_API_KEY` in `.env` ([setup.md](../setup.md)). They share a
10 000 unit daily quota, and all of them stop at `YOUTUBE_QUOTA_CEILING`
(default 9500) rather than dying on a 403. Running out of quota prints
`квота исчерпана, продолжу завтра` and **exits 0** — it is the normal end of a
working day, not a failure, and CI stays green.

Every response body is kept verbatim in `raw_responses`, so a parser bug is
fixed and re-run locally instead of costing another day of quota.

State lives in `cache.db`, including the job queue, so any of these can be killed
and restarted. Costs, retry policy and refresh periods: [pipeline.md](../pipeline.md).

## `pnpm data:discover`

Channels → playlists. Reads `data/channels.yaml`, resolves each channel and lists
the playlists it owns. Costs 1 unit per channel plus 1 per 50 playlists.

```bash
pnpm data:discover
```

Incremental: a channel is only re-scanned every 30 days. `--force` ignores that
and re-scans everything — useful right after adding channels in bulk, expensive
otherwise:

```bash
pnpm data:discover --force
```

Run it roughly monthly, or after editing `data/channels.yaml`. Where the channels
in that file came from: [channel-hunt.md](../channel-hunt.md).

## `pnpm data:refresh`

The nightly job, and the one to reach for by default. Runs metadata → videos →
liveness in that order until the queue drains or the quota does.

```bash
pnpm data:refresh
```

Before the first step it seeds any playlist named in `overrides.yaml` that the
crawl has never seen. `overrides.yaml` is committed and `cache.db` is not, so a
playlist bound on somebody's laptop reaches CI only through that file — and a
playlist that has never had metadata is scanned first, ahead of the popular
ones. There are more playlists than the metadata scan window holds, and a new
row has no view count to sort by, so without that it would fall outside the
window every night and never be fetched at all.

### The three steps

Also available separately, which is mostly useful when debugging one of them.

Playlist titles, descriptions and statistics, in batches of 50 per unit.
Incremental by `next_refresh_at`, so repeat runs are nearly free:

```bash
pnpm data:playlists
```

The expensive one. Walks queued playlists, stores their videos, and rolls
durations and statistics up onto the playlist. One unit per 50 videos listed,
plus one per 50 detailed:

```bash
pnpm data:videos
```

Marks playlists that were deleted or went private. A dead playlist is never
retried: 404 and 403 are permanent here:

```bash
pnpm data:liveness
```

## `pnpm data:images`

By default, nothing is called and nothing is paid for: course art is procedural
SVG generated deterministically from the course id, both here and in the
frontend, so it never needs storing.

The flag is for domain images only — about 40 of them, generated once and
committed:

```bash
pnpm data:images --openai --only=math,physics
```

`--only=` takes a comma-separated list of domain ids; without it every domain is
covered. Needs `OPENAI_API_KEY`; model is `OPENAI_IMAGE_MODEL` (default
`gpt-image-1`). Look changes go through `scripts/lib/visual.config.ts` — editing
`seedSalt` there redraws all procedural art, which is one string instead of 500
API calls.

Both modes **skip images already on disk**, since there is no table to record
what is done and the file is the record. That is what makes the limit work
(`pnpm data:images --openai 5` twice generates ten different images), and it is
also what keeps a re-run from paying for the same pictures twice. A changed
`seedSalt` or prompt therefore needs `--force`, which regenerates regardless.

## `pnpm data:import`

```bash
pnpm data:import
```

Pulls YouTube playlist links out of the awesome-lists declared in
`data/sources.yaml` and queues them for the normal crawl.

Courses are **never** created automatically. Titles that match nothing in
`data/courses/` are dropped into `data/proposed-courses.yaml` (gitignored) for a
human to add by hand with real `deps` taken from a syllabus. Auto-generated
dependencies would quietly ruin the graph, and the graph is the whole product.

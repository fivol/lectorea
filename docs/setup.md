# Setup

[← docs](README.md) · the site itself: [fivol.github.io/lectorea](https://fivol.github.io/lectorea/)

The frontend needs nothing but `pnpm install`. Everything below is for the
crawl scripts and for deploying somewhere other than this repository's Pages
site.

```bash
cp .env.example .env
```

## YouTube Data API

Required by every script that touches YouTube ([pipeline.md](pipeline.md)).

1. Open [console.cloud.google.com](https://console.cloud.google.com), create a
   project.
2. **APIs & Services → Library** → **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials** → **Create credentials** → **API key**.
4. **Edit API key** → **API restrictions** → **Restrict key**, tick only YouTube
   Data API v3. Leave application restrictions at **None** — the key is used
   from a server and the CI runner's IP moves around.
5. Put it in `.env` as `YOUTUBE_API_KEY=AIza…`.
6. For CI: **Settings → Secrets and variables → Actions → New repository
   secret**.

**Quota.** 10 000 units a day, resetting at midnight Pacific. Current spend is
visible under **APIs & Services → YouTube Data API v3 → Quotas**. An extension
is requested through the "YouTube API Services — Audit and Quota Extension Form"
and takes weeks; this project does not need one. Incremental refresh fits inside
a day, and the first full crawl takes two or three of them.

`YOUTUBE_QUOTA_CEILING` (default 9500) stops the crawler short of the limit, and
it counts per key.

**More than one key.** The quota belongs to the **project**, not to the key, so
a second key is worth having only when it comes from a second Google Cloud
project — repeat steps 1–5 there and add it as `YOUTUBE_API_KEY2`:

```
YOUTUBE_API_KEY=AIza…      # project one
YOUTUBE_API_KEY2=AIza…     # project two — another 10 000 units
```

Slots run to `YOUTUBE_API_KEY9`. The crawler spends them in order and moves to
the next when one runs out, so two keys turn the two-day first crawl into one
evening. Two keys of the *same* project share one budget: the crawler will find
the second already empty and say so. Nothing needs configuring beyond the
variable — the ledger in `cache.db` counts each key's day separately.

## OpenAI

Optional, and only for LLM matching (`pnpm data:match --llm`) and domain images
(`pnpm data:images --openai`). Without it the pipeline still works: matching
falls back to rules plus manual review, images to the procedural generator.

```
OPENAI_API_KEY=sk-…
```

## Which repository the site points at

Every course panel has a «Исправить данные» link straight to the file, and every
empty course a «Предложить плейлист» button that opens a pre-filled issue. Both
point at whichever repository the site was built from — CI takes it from the run
itself, so a fork sends its readers to its own issues and its own files without
a line being edited.

A build outside CI assumes `fivol/lectorea`. Two variables override that:

| Variable | |
|---|---|
| `VITE_REPO` | the repository the links point at, `owner/name` |
| `BASE_PATH` | the subdirectory the site is built for — it otherwise follows the repository name, since Pages serves a project site from `/<repo>/`. Set it to `/` for a custom domain |

## Other variables

| Variable | |
|---|---|
| `DEFAULT_LANG` | interface language to build. Only `ru` exists so far |
| `YOUTUBE_API_KEY2`…`9` | extra keys, spent in order after the first — one per Google Cloud project |
| `YOUTUBE_QUOTA_CEILING` | where the crawler stops inside each key's daily quota, default 9500 |
| `OPENAI_CLASSIFY_MODEL`, `OPENAI_IMAGE_MODEL` | override the models used for matching and images |

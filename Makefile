# Lectorea — the commands worth having a short name for.
#
# Everything here is a thin wrapper over the pnpm scripts in package.json, which
# stay the interface CI uses: nothing below is a second implementation of
# anything. What a Makefile adds is the three things that are a *sequence*
# rather than a command —
#
#   make pipeline   spend the day's quota, in the order that buys the most
#   make publish    local state → GitHub → a deploy built off exactly that
#   make stats      the dashboard, served and opened
#
# — plus the guards that turn "ran it in the wrong order" from a wasted day of
# quota into an error message. Run `make` on its own for the list.
#
# Batching: every crawl target takes N=<count>, which caps how many items that
# run takes on (`make refresh N=10`) and leaves the rest for the next run. Why
# that works: docs/scripts/README.md#doing-it-in-batches.

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
MAKEFLAGS += --no-print-directory
.DEFAULT_GOAL := help

PNPM := pnpm

# A leading positive integer caps a step; empty means "everything due".
N ?=
# --force on discover and match: re-read what the incremental windows would skip.
FORCE ?=
# --llm on match: costs OpenAI money, so it is opt-in rather than the default.
LLM ?=

DISCOVER_FLAGS := $(N) $(if $(FORCE),--force)
MATCH_FLAGS    := $(N) $(if $(FORCE),--force) $(if $(LLM),--llm)

# What an uncommitted change is allowed to be before `publish` stops. Written as
# what to skip rather than what to catch, for the reason deploy.yml gives about
# its own `paths-ignore`: a forgotten entry here costs one needless nag, while a
# forgotten entry in a list of things to *check* would let a real change ship
# unpublished, and say nothing.
PUBLISH_IGNORE := ':(exclude)docs' ':(exclude)tests' ':(exclude)sandbox' ':(exclude)*.md'

# The dashboard port from scripts/stats.ts, kept in sync by hand — it is one
# number and inventing a way to read it back would cost more than it saves.
STATS_PORT ?= 5180
OPEN := $(shell command -v open >/dev/null 2>&1 && echo open || echo xdg-open)


##@ The three sequences

.PHONY: pipeline
pipeline: require-key ## Everything the crawl does, in quota order, until the day runs out
	@echo "▸ 1/9  import       · playlists named by the catalogues in data/sources.yaml"
	@$(MAKE) import || echo "·· import failed — carrying on; it is the one step that needs the open web"
	@echo
	@echo "▸ 2/9  discover     · channels → their playlists (skips any scanned in the last 30 days)"
	@$(MAKE) discover
	@echo
	@echo "▸ 3/9  mine         · playlists linked from bodies already on disk — no quota, no network"
	@$(MAKE) mine
	@echo
	@echo "▸ 4/9  match        · before the crawl on purpose: matching is free and decides"
	@echo "                      which playlists the expensive video step walks first"
	@$(MAKE) match
	@echo
	@echo "▸ 5/9  refresh      · metadata → videos → liveness, until the queue or the quota drains"
	@$(MAKE) refresh
	@echo
	@echo "▸ 6/9  subscribers  · single digits of quota; without it the rating has no room size"
	@$(MAKE) subscribers
	@echo
	@echo "▸ 7/9  match        · again: the refresh gave titles to playlists that had none,"
	@echo "                      and a title is the whole of what the rule pass reads"
	@$(MAKE) match
	@echo
	@echo "▸ 8/9  embeds       · which playlists the player refuses as list= (oEmbed, no quota)"
	@$(MAKE) embeds
	@echo
	@echo "▸ 9/9  build        · data/ + cache.db → public/data, and the validator with it"
	@$(MAKE) data
	@echo
	@echo "✓ pipeline done. What it bought: make stats. Where it goes: make publish."

.PHONY: publish
publish: require-gh require-crawl ## Publish local state whole: validate → snapshot → release → deploy
	@echo "▸ 1/4  what the deploy will actually build from"
	@dirty="$$(git status --porcelain -- . $(PUBLISH_IGNORE) 2>/dev/null)"; \
	if [ -n "$$dirty" ] && [ -z "$(FORCE)" ]; then \
		echo "!! uncommitted changes the deploy would not see:"; \
		echo "$$dirty" | sed 's/^/     /'; \
		echo "   The site is built from main on GitHub, never from this working copy —"; \
		echo "   commit and push first, or FORCE=1 to publish the crawl cache alone."; \
		exit 1; \
	fi
	@ahead="$$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"; \
	if [ "$$ahead" != "0" ] && [ -z "$(FORCE)" ]; then \
		echo "!! $$ahead commit(s) not pushed — the deploy would build the state before them."; \
		echo "   git push, or FORCE=1 to publish the crawl cache alone."; \
		exit 1; \
	fi
	@echo "·  the working copy is what main would build"
	@echo
	@echo "▸ 2/4  data:build — the validator CI runs, before anything leaves this machine"
	@$(PNPM) data:build
	@echo
	@echo "▸ 3/4  cache.db → the data-cache release (raw API bodies stay at home)"
	@$(PNPM) cache:publish
	@echo
	@echo "▸ 4/4  deploy, pinned to the snapshot just uploaded"
	@gh workflow run deploy.yml --ref main -f snapshot=true
	@echo
	@echo "✓ queued. The Actions cache is deliberately bypassed for this run — otherwise"
	@echo "  the deploy would rebuild from last night's crawl and ignore what was just sent."
	@echo "  Watch it: gh run watch \$$(gh run list --workflow=deploy.yml --limit=1 --json databaseId -q '.[0].databaseId')"

.PHONY: stats
stats: ## The dashboard — coverage, the crawl, the queue, what is left — served and opened
	@echo "· http://localhost:$(STATS_PORT) — reload recomputes everything; Ctrl-C to stop"
	@( sleep 1 && $(OPEN) "http://localhost:$(STATS_PORT)" >/dev/null 2>&1 || true ) &
	@$(PNPM) stats --serve


##@ Everyday

.PHONY: install
install: ## pnpm install
	@$(PNPM) install

.PHONY: dev
dev: ## The frontend on localhost:5173 (needs `make data` at least once)
	@$(PNPM) dev

.PHONY: data
data: ## data/ + cache.db → public/data. Also the validator: schemas, cycles, dangling deps
	@$(PNPM) data:build

.PHONY: build
build: ## Production build → dist/
	@$(PNPM) build

.PHONY: preview
preview: ## Serve the last production build
	@$(PNPM) preview

.PHONY: check
check: ## Everything CI checks, in CI's order — run this before pushing
	@$(PNPM) typecheck
	@$(PNPM) test
	@$(PNPM) data:build
	@$(PNPM) check:i18n
	@$(PNPM) build

.PHONY: test
test: ## Tests: levels, cycles, column order, score, search
	@$(PNPM) test

.PHONY: typecheck
typecheck: ## tsc -b --noEmit
	@$(PNPM) typecheck

.PHONY: i18n
i18n: ## Localisation gate: every key used exists, every key present is used, every course has text
	@$(PNPM) check:i18n


##@ The crawl (each step of `pipeline`, on its own — N= caps it)

.PHONY: refresh
refresh: require-key ## Metadata → videos → liveness. The nightly job; quota
	@$(PNPM) data:refresh $(N)

.PHONY: discover
discover: require-key ## Channels in data/channels.yaml → their playlists. Quota; FORCE=1 ignores the 30-day window
	@$(PNPM) data:discover $(DISCOVER_FLAGS)

.PHONY: match
match: ## Bind playlists to courses. Free; LLM=1 adds the model pass, FORCE=1 re-reads settled matches
	@$(PNPM) data:match $(MATCH_FLAGS)

.PHONY: review
review: ## The review server: one playlist at a time, decisions → data/overrides.yaml
	@$(PNPM) data:review

.PHONY: mine
mine: ## Playlists linked from API bodies already on disk. No quota, no network
	@$(PNPM) data:mine $(N)

.PHONY: import
import: ## Playlists named by the lists in data/sources.yaml. Network, no quota
	@$(PNPM) data:import $(N)

.PHONY: subscribers
subscribers: require-key ## Channel subscriber counts — the denominator under the rating's reach signal
	@$(PNPM) data:subscribers

.PHONY: embeds
embeds: ## Which playlists the embedded player refuses as list=. oEmbed, no quota
	@$(PNPM) data:embeds $(N)


##@ The crawl cache (data/cache.db — a week of quota, and never committed)

.PHONY: cache-publish
cache-publish: require-gh require-crawl ## Local cache.db → the data-cache release
	@$(PNPM) cache:publish

.PHONY: cache-restore
cache-restore: require-gh ## The release → data/cache.db. A no-op when there is already a crawl here
	@$(PNPM) cache:restore

.PHONY: seed
seed: ## ~500 obviously fake playlists, so the interface has something to show without a crawl
	@$(PNPM) data:seed-dev $(N)
	@$(PNPM) data:build

.PHONY: unseed
unseed: ## Remove every seeded row, leaving real data alone
	@$(PNPM) data:seed-dev --wipe
	@$(PNPM) data:build


##@ Content

.PHONY: course
course: ## make course ID=probability DOMAIN=math STAGE=bachelor-2 DEPS=calculus-2
	@if [ -z "$(ID)" ] || [ -z "$(DOMAIN)" ] || [ -z "$(STAGE)" ]; then \
		echo "usage: make course ID=<id> DOMAIN=<d[,d]> STAGE=<school-8…phd> [DEPS=a,b] [SOFT=a,b] [TITLE=…]"; \
		echo "       STAGE has no default on purpose — a year written by a script reads exactly"; \
		echo "       like a year somebody answered, including to the reviewer."; \
		exit 1; \
	fi
	@$(PNPM) course:new $(ID) --domain=$(DOMAIN) --stage=$(STAGE) \
		$(if $(DEPS),--deps=$(DEPS)) $(if $(SOFT),--soft=$(SOFT)) $(if $(TITLE),--title="$(TITLE)")

.PHONY: playlist
playlist: ## make playlist URL=<link|PL…> [COURSE=<id>] — without COURSE it only looks, for 1 unit
	@if [ -z "$(URL)" ]; then echo "usage: make playlist URL=<link|PL…> [COURSE=<id>]"; exit 1; fi
	@$(PNPM) playlist:add "$(URL)" $(if $(COURSE),--course=$(COURSE))

.PHONY: map
map: ## Regenerate public/map.svg from data/domains.yaml
	@$(PNPM) data:map

.PHONY: map-portrait
map-portrait: ## The same world stacked → public/map-portrait.svg
	@$(PNPM) map:portrait

.PHONY: map-sandbox
map-sandbox: ## The map generator with sliders, as one HTML file
	@$(PNPM) map:sandbox


##@ Housekeeping

.PHONY: doctor
doctor: ## What this machine has: tools, keys (counted, never printed), cache, build output
	@echo "node        $$(node --version 2>/dev/null || echo '— not installed')"
	@echo "pnpm        $$(pnpm --version 2>/dev/null || echo '— not installed')"
	@echo "gh          $$(gh --version 2>/dev/null | head -1 | cut -d' ' -f3 || echo '— not installed')"
	@if gh auth status >/dev/null 2>&1; then echo "gh auth     logged in"; else echo "gh auth     — not logged in (gh auth login)"; fi
	@if [ -f .env ]; then \
		keys=$$(grep -cE '^[[:space:]]*YOUTUBE_API_KEY[0-9]*[[:space:]]*=[[:space:]]*[^[:space:]#]' .env || true); \
		echo ".env        present, $$keys YouTube key(s)"; \
		if grep -qE '^[[:space:]]*OPENAI_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]#]' .env; then \
			echo "openai      set (optional: LLM matching, domain images)"; \
		else echo "openai      unset — rules matching and procedural art still work"; fi; \
	else echo ".env        missing — cp .env.example .env, then docs/setup.md"; fi
	@if [ -f data/cache.db ]; then \
		echo "cache.db    $$(du -h data/cache.db | cut -f1)"; \
		$(MAKE) --silent require-crawl 2>/dev/null && echo "            holds a crawl" || echo "            tables but no material — nothing worth publishing"; \
	else echo "cache.db    absent — make cache-restore, or build a graph with no playlists"; fi
	@if [ -d public/data ]; then echo "public/data $$(ls public/data/*.json 2>/dev/null | wc -l | tr -d ' ') files"; \
		else echo "public/data absent — make data"; fi

.PHONY: clean
clean: ## Remove everything regenerable. Never touches data/cache.db — that is a week of quota
	@rm -rf public/data public/images/courses dist .stats .map-poc .tiles
	@echo "✓ cleaned. data/cache.db left alone on purpose — rebuild the rest with make data."


# ─── Guards ──────────────────────────────────────────────────────────────────
# Prerequisites of the targets above rather than entries in the help, because
# nobody runs one of these on purpose: their whole job is to fail early, with
# the fix in the message, instead of half a sequence later.

.PHONY: require-key
require-key:
	@if [ -n "$${YOUTUBE_API_KEY:-}" ] || \
	   grep -qE '^[[:space:]]*YOUTUBE_API_KEY[0-9]*[[:space:]]*=[[:space:]]*[^[:space:]#]' .env 2>/dev/null; then :; else \
		echo "!! No YouTube key, and every step below spends quota."; \
		echo "   cp .env.example .env and put one in it — docs/setup.md says where to get it."; \
		exit 1; \
	fi

.PHONY: require-gh
require-gh:
	@command -v gh >/dev/null 2>&1 || { echo "!! gh is not installed — https://cli.github.com"; exit 1; }
	@gh auth status >/dev/null 2>&1 || { echo "!! gh is not logged in — run: gh auth login"; exit 1; }

# "Has this database anything in it worth publishing?" and not "does it have
# tables?": openDb writes the whole schema before the first request, so a run
# that died on a missing key leaves a complete and entirely empty cache. CI
# learned that the expensive way — five days of an empty catalogue in August.
.PHONY: require-crawl
require-crawl:
	@$(PNPM) exec tsx -e "import { dbHasMaterial } from './scripts/lib/db.ts'; process.exit(dbHasMaterial() ? 0 : 1)" >/dev/null 2>&1 || { \
		echo "!! data/cache.db holds no crawl."; \
		echo "   make pipeline to fill it, or make cache-restore to pull the published snapshot."; \
		exit 1; \
	}


.PHONY: help
help: ## This list
	@echo "Lectorea — make <target>. Crawl steps take N=<count>; see docs/scripts/README.md"
	@awk 'BEGIN {FS = ":.*?## "} \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_-]+:.*?## / { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

# Adopted practices

[← agents](README.md)

Not code style — ways of solving **classes** of problem that have been tried
here. Each one is named together with the case it came from, so it is visible
what it is for and when it does not apply.

---

## A rule that has to hold becomes code

«Never call `search.list`» lived as a comment in `lib/youtube.ts`, and a comment
cannot stop anything. Now the method does not exist until the caller says
`createClient(db, { allowSearch: true })`: a pipeline step that reaches for it by
inattention fails on the first call instead of turning up in tomorrow's ledger.

**Generally:** when breaking a rule is expensive and invisible, the rule should
be unavailable by default rather than described. A good sign is a rule written
with the word "never".

## Expensive discovery has to be resumable

Search is the only expensive half of a hunt; judging what it found is free.
`_hunt.ts --from=report.json` re-reads a finished report and **re-judges** it
against the current rules, asking nothing again. That matters because the rules
get written *after* the hunt shows what a seam drags in: a rule written half an
hour after the search has to reach the candidates the search already paid for.

**Generally:** separate "what cost money" from "what we think about it", and be
able to replay the second over a saved first. Asking the same question twice is
the one thing quota must never buy.

## Nothing is written without `--apply`

The scratch scripts (`_hunt`, `_vet`, `_probe`, `_refusals`) look and print by
default. Writing is a separate explicit flag. That is what makes it possible to
run an expensive step, read the result unhurriedly and decide — rather than
discover the decision already taken.

## A rule change is probed against the whole catalogue

`_probe.ts` shows what an edit to the rules would do to all ~38 000 live
playlists: what binds for the first time, what loses its binding, which courses
stop being empty. A keyword is a guess about thirty thousand titles and cannot be
committed unverified.

Proven on the exam-coaching brands added to `NOT_A_COURSE`: the probe showed a
loss of exactly two bindings, both correct refusals. Without it that would have
been an assumption.

## Filters go in rising order of price

In the hunt: already in the cache (free) → too short or not-a-course (free) →
names no course of this catalogue (free) → **who owns the videos** (1 unit). The
paid filter runs last and only on what is left — 1 unit × 2611 rather than
× 4079.

**Generally:** the order of filters is a budget, not a matter of taste. An
expensive filter placed first pays for what a free one would have removed for
nothing.

## A refusal is a finding, and gets written down

[channel-hunt.md](../channel-hunt.md) keeps the list of **refused** channels with
reasons, and across four hunts that half has been the more useful one: each of
them looks like a hit in a ranked list, and re-checking one costs a unit and a
judgement call. The same in code: `matches` stores the verdict "not a course" as
a decision, so nothing pays for it again on the next run.

## Collect what an expensive step refills for free

Resolving candidates through `playlists.list` also put 3500 playlist descriptions
on disk, out of which the free `data:mine` read 2796 new links — and 4278 more
once their videos had been walked. An expensive step often pays for a free one;
check whether new material has appeared for the cheap seams before calling the
step finished.

## A failed step does not cancel the rest of the day

`make pipeline` does not stop on a failed step: it remembers it, names it at the
end and exits non-zero. The reason is the shape of the order — the expensive
steps in the middle, and the free ones that publish the day's work at the end. To
stop at step six is to throw away five that were already paid for.

**For an agent:** in a long sequence, first finish everything that does not
depend on what failed, and only then report — but **report the failure
explicitly** rather than continuing quietly.

## A channel takes three files, not one

1. `data/channels.yaml` — the entry, with a comment saying **what it is for**;
2. `data/providers.yaml` — the matching provider, or `resolveProvider` silently
   substitutes `unknown` and the attribution is lost without a single message;
3. `make discover && make refresh && make match && make data`.

The check after editing is one line, and it is not optional:

```bash
pnpm exec tsx -e "import {loadSources} from './scripts/lib/sources.ts'; const s=loadSources(); const ids=new Set(s.providers.map(p=>p.id)); console.log(s.channels.filter(c=>!ids.has(c.providerId)).map(c=>c.id))"
```

**Generally:** where code substitutes a default instead of failing, the failure
will not surface on its own — whoever edits the data writes the check.

## Commit an explicit list of files

The working tree is shared with concurrent sessions. `git add` names files one by
one, and `git status --short` is checked before committing. See
[pitfalls.md](pitfalls.md#the-git-index-is-shared-with-other-sessions).

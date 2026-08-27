# The day's report — the template, and why each row is in it

Written to `.stats/harvest/<pacific-day>.md` when the day ends. `.stats/` is
gitignored, so this is working memory rather than documentation: the marker that
tells a loop today is finished, and the handover that tells tomorrow where to
start.

Every figure is **summed from rows, never inferred about the whole** — the count
of playlists is a fact about `playlists`, the refusal rate is a fact about the
verdicts imported today, and neither is extrapolated to what the catalogue "is
like". A number that is a guess goes in the last section, labelled as one.

```markdown
# <pacific-day>

## The ledger
| | |
|---|---|
| spent / budget | 90 431 of 95 000 |
| where it went | crawl 2 562 · search 79 800 · ownership 8 069 |
| left to expire | 4 569 — and why: <reason, or "nothing left to buy"> |

## What moved
| | before | after |
|---|---|---|
| playlists | | |
| videos | | |
| channels | | |
| published bindings | | |
| questions asked | | |

## The reader
N bindings read in M batches — X ok, Y wrong-course, Z not-a-course, W unsure.
Refused R% — <which seam it came from, and whether that matches the band:
faculty channel ≈15%, wide search or mined ≈30–46%>.

## What the rules learned
One line per keyword, refusal word or course, each with its probe: `+N, −M`.
And the ones **rejected**, with the measurement that rejected them — that half
is what stops tomorrow re-deriving it.

## Left for tomorrow
- the queue published for the night: N playlists (one key walks ≈3200)
- unasked questions: N playlist, N channel
- unconfirmed bindings: N
- the thing this day ran out of time for, named exactly enough to start from
```

Two rules about the last section, both learned the expensive way:

- **Name where you looked, not what you concluded.** "No Western field-school
  channel publishes a method course" is a finding; "field archaeology does not
  exist on YouTube" was wrong, and cost a course being written off.
- **Write the refusals down.** A candidate channel, phrasing or course that was
  considered and rejected is worth more than one accepted: it is the only thing
  that stops the next day spending itself on the same question.

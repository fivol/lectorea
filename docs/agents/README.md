# The agent's notebook

This project is built by an agent. These pages are its memory, not the project's
documentation: what to know **before** doing anything, and what has already cost
time or quota once. A reader who wants to understand the service wants
[docs/README.md](../README.md) instead — nothing here explains what Lectorea is.

Read first, because it is the cheapest thing to read: a pass over these pages is
a minute, and repeating one mistake from them is an hour to a day of quota.

| Page | What is in it |
|---|---|
| **[iteration.md](iteration.md)** | how to spend a day on the catalogue — the four phases, and how to work the refusals |
| **[data-traps.md](data-traps.md)** | what the data keeps doing that no amount of reading the code would predict |
| **[pitfalls.md](pitfalls.md)** | mistakes already made, and the assumption behind each one |
| **[practices.md](practices.md)** | the approaches adopted here, each with the case it came from |
| **[workflow.md](workflow.md)** | the environment: quota, what runs for hours, what must not be committed |

## What belongs here, and what belongs in `docs/`

The line is **who needs to know it**.

| `docs/*.md` | `docs/agents/*.md` |
|---|---|
| what the system does and how to use it | what the agent got wrong, and on what exactly |
| where material comes from, what a seam costs | which tool behaves unlike it looks |
| why a decision about data or interface was made | which check to run before committing |
| an incident that explains **a rule in the code** | an incident that explains **how to work** |

If an entry explains the system, it is documentation, even when an agent found
it. The pagination loop that spent 54 000 units lives in `pipeline.md`, because
it explains why the crawl stops on a repeated token. "Read the shape of the JSON
before writing `.map`" lives here.

When a page is mostly a runbook, it belongs here whole — that is why
[iteration.md](iteration.md) and [data-traps.md](data-traps.md) moved out of
`docs/review.md` rather than being split.

## The end-of-iteration ritual

Required, not "if there is time". Before committing, answer four questions:

1. **Did I get something wrong?** A mistake that cost more than five minutes goes
   into [pitfalls.md](pitfalls.md) with the assumption behind it. Not "there was
   a bug" — which belief turned out to be false.
2. **Did I find a general approach?** Something that closes a class of problems
   goes into [practices.md](practices.md). A one-off patch does not.
3. **Did I learn something about the system?** That goes into the user-facing
   docs: extend the page that already covers it rather than starting a second one.
4. **Did I reject something?** Write down the option and the reason. A rejection
   is worth more than an acceptance — it stops the next iteration spending a day
   on the same thing.

Four empty answers is a legitimate outcome, but it has to be an answer rather
than a step that was skipped.

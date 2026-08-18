# The typefaces

Three families, served from this origin rather than from `fonts.googleapis.com`.
Why, and what a refetch costs: [scripts/fonts.ts](../../scripts/fonts.ts) and
[docs/hosting.md](../../docs/hosting.md#the-typefaces-are-ours-to-serve).

The files here are generated — `pnpm fonts:build` rewrites all of them and
[../fonts.css](../fonts.css) with them. Nothing in this directory is edited by
hand.

| Family | Weights | Where it is used |
|---|---|---|
| Unbounded | 500, 700 | the wordmark and every display heading (`font-display`) |
| Onest | 400, 500, 600 | body text, which is most of the interface (`font-sans`) |
| JetBrains Mono | 400, 500 | counts, labels and the spaced caps (`font-mono`) |

Each is split by alphabet the way Google serves it, and only four subsets are
kept — `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`. The `unicode-range` on
each rule is unchanged, so a browser still downloads only the alphabet it is
about to draw.

## Licence

All three are under the **SIL Open Font License, Version 1.1**, whose full text
is in [OFL.txt](OFL.txt) beside them. The licence permits redistribution,
including bundling into a web application, and asks that this notice travel
with the files.

- Unbounded — Copyright 2022 The Unbounded Project Authors,
  <https://github.com/googlefonts/unbounded>
- Onest — Copyright 2021 The Onest Project Authors,
  <https://github.com/googlefonts/onest>
- JetBrains Mono — Copyright 2020 The JetBrains Mono Project Authors,
  <https://github.com/JetBrains/JetBrainsMono>

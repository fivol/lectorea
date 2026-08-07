## What this changes

<!-- One or two sentences. If it is a data change, name the domain. -->

## Checklist for data changes

- [ ] One unit = one semester course. No topic-sized entries, no merged year-long blocks
- [ ] `deps` are **direct only** — if A needs B and B needs C, A does not list C
- [ ] Dependencies come from a syllabus, not from intuition. Link it in `refs.syllabus`
- [ ] Anything helpful-but-not-required is in `soft`, not `deps`
- [ ] Mutual links (logic ↔ philosophy) are in `related`, written on one side only
- [ ] Each course is in `data/courses/<its first domain>.yaml`
- [ ] `stage` is what a real curriculum says, not a reading of the computed `level`
- [ ] Any `minLevel` carries a comment saying why the computed level is wrong
- [ ] Every new course has `course.<id>.title` and `course.<id>.desc` in `data/i18n/ru.json`
- [ ] Search keywords added to `data/keywords/ru.json` — abbreviations, slang, transliterations
- [ ] `pnpm data:build && pnpm check:i18n` passes locally, and its warnings are read

## Checklist for code changes

- [ ] `pnpm typecheck && pnpm test` passes
- [ ] No user-facing string is hard-coded — it goes through `t()`

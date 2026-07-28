# Bot strength work — checkpoint

**Date:** 2026-07-28
**Branch:** `bot-improvements`
**Status:** harness landed, bot changes not started

This file is the resume point: it says what is left to do, not what happened.

## Why

A human game log showed the bot playing badly in three specific ways. All three
were reproduced against `src/bot.ts` before any change was made.

1. **It cannot hold position.** `legalActions()` only emits troop counts
   `1..min(count, 8)` (plus the full count when >8), so every slot in the trio
   must move troops somewhere. A human can submit a 0-troop move (`a0b`) and
   bank restock troops at home; the bot only ever emits `PASS_MOVE` as a
   fallback when it owns no populated square. Result: the bot drains its home
   garrison into the middle every single round.
2. **It never defends.** `scoredActions()` scores advance-toward-enemy-home at
   ×1.2, so a retreat scores about −0.75 against +1.65 for an advance, and
   `sampleTrio()` only ever samples from the top 3. Defensive trios are
   therefore never *generated*, so the home-exposure term in `evaluate()` has
   nothing to select. Probe: with an enemy 10-stack on `h` (adjacent to the bot
   home `i`, which holds 2), the bot planned `f3e, e3d, d3a` — it walked away
   from its own home and lost it next round.
3. **It mirrors into mutual annihilation.** On the symmetric opening the bot's
   plan is the mirror image of the greedy heuristic's (`a3b, b3c, c3f` vs
   `i3f, f3c, c3b` — collision on `c`). Equal-count collisions annihilate both
   sides, `evaluate()` scores that as neutral, and the opponent model (`K=6`
   trios from the same greedy sampler) makes it look unavoidable.

## Baseline (measured, do not re-derive)

`BOT_SWEEP=1 npx vitest run test/eval/sweep.test.ts --reporter=verbose --silent=false`
— 25 games per seat per opponent, 50 total, both seats played:

```
random               W:50 L:0 D:0  (100%)
heuristic            W:43 L:5 D:2  (86%)
baseline-bot         W:26 L:23 D:1  (52%)   <- self-play sanity check, should be ~50%
stacker(build=2)     W:50 L:0 D:0  (100%)
stacker(build=4)     W:50 L:0 D:0  (100%)
turtle(keep=3)       W:50 L:0 D:0  (100%)
turtle(keep=6)       W:50 L:0 D:0  (100%)
```

The scripted opponents are all too weak to show the defects above — they lose
to the race even while the bot misplays. `baseline-bot` (the frozen copy in
`test/eval/bot-baseline.ts`) is the meaningful A/B number: any real improvement
must beat it well above 52%.

## What exists already

- `test/eval/harness.ts` — `playGame`, `sweep` (plays both seats), the
  `Planner` type, and the opponent pool (`randomBot`, `heuristicBot`,
  `baselineBot`, `makeStacker`, `makeTurtle`).
- `test/eval/bot-baseline.ts` — frozen copy of the pre-tuning `src/bot.ts`.
  Never edit it; it is the A/B control.
- `test/eval/sweep.test.ts` — skipped unless `BOT_SWEEP=1`.

## Remaining steps

1. **Hold action.** Add a 0-troop hold to the bot's action space so a trio slot
   can decline to move. Watch the engine semantics: a 0-troop move still enters
   `MovePair` swap/collision resolution, and `applyMove` early-returns on
   `troopCount < 1`, so a hold is a true no-op for the holder. `PASS_MOVE`
   already has the right shape.
2. **Defense-aware action scoring.** Give `scoredActions()` a term for
   defending the bot's own home when enemy troops are within distance 2, so
   retreat/garrison actions reach the top-3 sampling pool. Keep it off when no
   threat exists, or the bot will turtle and stop winning the race.
3. **Opponent model.** Add a home-rush trio (opponent beelines for the bot's
   home along the shortest path, largest stack first) to the `K_OPPONENT` set,
   so the `MIN_WEIGHT` worst-case term punishes an undefended home.
4. **Optional, only if 1–3 are not enough:** two-round lookahead for the top
   few candidates. Compute is cheap (currently 16×6 = 96 round sims,
   sub-millisecond) but keep it bounded — this runs in a Cloudflare Worker
   request.
5. **Re-measure** with the sweep after each change; record numbers in this file.
   Target: >=65% vs `baseline-bot` head-to-head, with the existing gates in
   `test/bot.strength.test.ts` still passing.
6. **Keep green:** `npm test` (parity fixtures in `test/parity.test.ts` are a
   golden regression suite for the *engine* — a bot change must not touch
   engine behavior) and `npx tsc`.
7. Update `test/bot.strength.test.ts` to use the shared harness, and raise the
   gates to whatever the new bot reliably clears (leave margin for variance).
8. Update the "Bot" section of `README.md` and
   `docs/superpowers/specs/2026-07-10-search-bot-design.md` to describe the new
   action space / scoring, since that spec is now stale.

## Constraints

- No `Math.random()` / `Date.now()` in `src/bot.ts` — planning is seeded from
  `${gameGuid}:${completedRounds}` and must stay deterministic.
- `src/engine.ts` is the canonical rules definition. Do not change it to make
  the bot stronger.
- Do not merge to `main` without the user's say-so; open a PR instead.

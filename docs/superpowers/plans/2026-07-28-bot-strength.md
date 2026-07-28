# Bot strength work

**Date:** 2026-07-28
**Branch:** `bot-improvements`
**Status:** bot changes landed and measured; docs remaining

## Why

A human game log showed the bot playing badly. Three defects were reproduced
against the shipped `src/bot.ts` before anything was changed.

1. **It could not hold position.** `legalActions()` only emits troop counts
   `1..min(count, 8)` (plus the full count when >8), so every slot in the trio
   had to move troops somewhere. A human can submit a 0-troop move (`a0b`) and
   bank restock troops at home; the bot only ever emitted `PASS_MOVE` as a
   fallback when it owned no populated square. It drained its home garrison
   into the middle every round.
2. **It never defended.** `scoredActions()` scores advance-toward-enemy-home at
   ×1.2, so a retreat scored about −0.75 against +1.65 for an advance, and
   `sampleTrio()` only samples from the top 3. Defensive trios were never
   *generated*, so the home-exposure term in `evaluate()` had nothing to
   select. Probe: with an enemy 10-stack on `h` (adjacent to the bot home `i`,
   holding 2), the bot planned `f3e, e3d, d3a` — it walked away from its own
   home and lost it the next round.
3. **It mirrored into mutual annihilation.** On the symmetric opening the
   bot's plan was the mirror image of the greedy heuristic's (`a3b, b3c, c3f`
   vs `i3f, f3c, c3b` — collision on `c`). Equal-count collisions annihilate
   both sides and `evaluate()` scores that as neutral.

## What actually mattered

Measured, in order of effect. The first two rounds of work were spent on
defects 1 and 2 and moved the head-to-head number **not at all** (50% → 50%).
The reason turned out to be upstream of the evaluation function:

**Candidate diversity was the bottleneck.** All 16 candidate trios were drawn
from the top 3 actions of one greedy scorer, so the search was choosing between
near-identical plans. No evaluation weight can change an answer when every
option is the same answer. Widening generation — 40 candidates, alternating
top-3 and top-8 sampling, plus the deterministic rush trio — moved the
head-to-head from 50% to 70% on its own.

Ablations against the frozen pre-tuning bot (120 games, both seats):

| Config | Result |
|---|---|
| All changes | 68% |
| Income term off (`INCOME_WEIGHT = 0`) | 62% |
| Defense scoring + hold off (`DEFEND_WEIGHT = 0`) | 68% |

So: diversity is the big lever, the income term is worth ~6 points, and the
defense work is worth **nothing measurable** against these opponents. It was
kept anyway because it fixes visibly bad play a human will punish even when the
scripted opponents cannot — in the 10-stack probe above the bot now garrisons
its home instead of walking away. That is a judgement call, not a measurement.

### The income term

`evaluate()` counted only *populated* squares, but ownership is sticky — a
square keeps its owner after the troops leave, and `restock()` pays one troop
per owned square per round. An empty owned square is income and the evaluation
scored it as nothing. That was the bot misunderstanding its own economy.

## Results

`BOT_SWEEP=1 BOT_GAMES=40 npx vitest run test/eval/sweep.test.ts --reporter=verbose --silent=false`
— 80 games per opponent, both seats:

| Opponent | Before | After |
|---|---|---|
| random | 100% | 100% |
| heuristic | 86% | 98% |
| pre-tuning bot | — | **70%** |
| rush (beeline at home) | — | 99% |
| human(2,2) | 98% | 100% |
| human(4,3) | 91% | 99% |
| **human(6,2)** — the reported failure mode | **86%** | **99%** |
| stacker, turtle | 100% | 100% |

`human(t,b)` trades for `t` rounds, banks at home for `b`, then marches: the
line from the reported game. The pre-tuning bot lost 14% of those.

### Cost

Planning cost per bot turn, measured over 100 turns per position:

| | Before | After |
|---|---|---|
| Pre-tuning bot | 13 ms | 2 ms |
| This bot | — | 4.5–8 ms |

The search got 2.5× wider and still runs ~2.5× faster than what is deployed,
because `structuredClone` in `Board.clone()`/`snapshot()` dominated everything
else. Planning clones now skip history bookkeeping (they are simulated, never
rendered) and state copies share the immutable `neighbors` arrays. Parity
fixtures confirm the engine behaviour is unchanged.

Note for anyone reading the original design spec: it claims the bot turn is
"sub-millisecond". That was never true — the shipped bot took 13 ms.

## Remaining

1. Update the "Bot" section of `README.md`.
2. `docs/superpowers/specs/2026-07-10-search-bot-design.md` is stale (action
   space, candidate generation, evaluation terms, and the timing claim).
3. Open a PR against `main`. Do not merge without the user's say-so.

## Constraints

- No `Math.random()` / `Date.now()` in `src/bot.ts` — planning is seeded from
  `${gameGuid}:${completedRounds}` and must stay deterministic.
- Never edit `test/eval/bot-baseline.ts`; it is the A/B control.
- `src/engine.ts` is the canonical rules definition. The optimisation above is
  behaviour-preserving and parity-guarded; do not change game *rules* to make
  the bot stronger.

## Tools

- `test/eval/harness.ts` — `playGame`, `sweep` (both seats), the opponent pool.
- `test/eval/sweep.test.ts` — W/L/D table. `BOT_SWEEP=1`, plus optional
  `BOT_GAMES`, `BOT_ONLY`, `BOT_UNDER_TEST=baseline`.
- `test/eval/probe.test.ts` — positional probes and turn timing. `BOT_PROBE=1`.
- `test/eval/diagnose.test.ts` — behaviour stats over real games (holds, dead
  slots by trio position, average garrison, home-lost rate). `BOT_DIAG=1`.

Vitest hides `console.log` unless **both** `--reporter=verbose` and
`--silent=false` are passed.

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

| Opponent | Before | After first pass | Final |
|---|---|---|---|
| random | 100% | 100% | 100% |
| heuristic | 86% | 98% | 99% |
| pre-tuning bot | — | 70% | **85–87%** |
| rush (beeline at home) | — | 99% | 99% |
| human(2,2) | 98% | 100% | 100% |
| human(4,3) | 91% | 99% | 100% |
| **human(6,2)** — the reported failure mode | **86%** | 99% | **100%** |
| stacker, turtle | 100% | 100% | 100% |

The pre-tuning number is 85% in the 80-game sweep above and 87% in a dedicated
300-game run; the scripted opponents are saturated and no longer discriminate.

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

## Second pass: what the search budget was worth

With the engine 6× cheaper, the search could afford to be much bigger. Screened
against the frozen bot at 120 games per point, both seats.

| Change | Result |
|---|---|
| Reference (40 candidates, 6 opponent trios) | 68% |
| 64 candidates | 78% |
| 96 candidates | 78% |
| 16 opponent trios | 74% |
| 24 opponent trios (with 64 candidates) | 89% |
| **64 candidates + 16 opponent trios** | **88%** |

The two compound — 78% and 74% separately, 88% together. A wider candidate pool
is only worth having if the opponent model can tell the candidates apart, and a
better opponent model only helps if there is something to choose between. Past
those points it flattens, so this takes the cheaper of the tied settings.
Confirmed at 300 games: **87%**, even across seats.

`MIN_WEIGHT` was already at a good value: 0.25 and 0.5 tie at 68%, 0 gives 65%,
0.75 gives 62%.

## Second pass: three things that did not work

Recorded because each is an obvious idea someone will want to retry.

**Two-round lookahead — worse, monotonically.** Re-ranking the top candidates by
playing a second round (both sides answering with their greedy trio) scored 79%
against the one-round bot's 88%. Blending it back toward the one-round score
recovers in proportion to how much lookahead is removed: blend 0.25 → 85%,
blend 0.5 → 82%, pure two-round → 79%. The depth-2 reply model is a worse
predictor than no model at all, so the extra depth is pure noise. A better reply
model — not a deeper search — is what this would need.

**A wider opponent model — worse.** Sampling opponent trios at mixed top-3/top-8
width, the way candidates are generated, drops it to 75%. Narrowing to top-2
gives 82%. Top-3 is the sweet spot: the useful opponent model is one that plays
*well*, not one that covers the space.

**Re-deriving the action-scorer weights — nothing there.** Every weight is flat
across a wide range: advance 0.8/1.6/2.4 → 87/88/87%, capture 0.2/1.5 →
85/86%, enemy-home 0/4.0 → 84/86%, claim 1.0/2.0/3.0 → 88/77/78%. Even setting
the enemy-home bonus to zero costs 4 points. These weights drive candidate
*generation*, and with 64 candidates sampled from the top 3 and top 8, the
search filters whatever they produce. They are named constants now with that
finding recorded next to them; they are not worth tuning.

## Remaining

Nothing outstanding. Possible future work, in rough order of promise:

1. A better reply model for depth-2 (the lookahead result above suggests the
   ceiling is in the opponent model, not the depth).
2. Tuning the evaluation weights (`material`/`squares`/`progress`/`exposed`),
   which have never been swept — only `INCOME_WEIGHT` was.
3. Revisiting the defensive terms against an opponent strong enough to punish an
   open home, which none of the current pool does.

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

# RESUME — read this first

This file exists for a scheduled cloud session that is picking up unfinished
work with no memory of how it started. If you are a human and the branch has
been merged or abandoned, delete this file.

**Branch:** `bot-improvements` — work here, never on `main`.

## Goal

The game's bot (`src/bot.ts`) plays badly against simple human strategies. Make
it measurably stronger. A human game log showed it walking away from its own
undefended home, trading its whole army into mutual annihilation, and wasting
moves.

## Task list

`docs/superpowers/plans/2026-07-28-bot-strength.md` is the real plan: the
defects, what fixed them, the measured results, and a "Remaining" list. Read it
in full and work that list.

The bot changes have landed and are measured (70% head-to-head against the
pre-tuning bot; 99% against the human line that beat it). What is left is
finishing the docs and opening the PR. Check `git log --oneline
main..bot-improvements` and the code before starting any step; trust the code
over the plan's status line, and update the plan as you go.

## Setup

```shell
npm install
npm test                 # must stay green; parity fixtures guard the engine
npx tsc --noEmit
```

The tuning sweep is opt-in and takes about a minute:

```shell
BOT_SWEEP=1 npx vitest run test/eval/sweep.test.ts --reporter=verbose --silent=false
```

Vitest hides `console.log` unless **both** `--reporter=verbose` and
`--silent=false` are passed — without them the sweep looks like it printed
nothing.

Re-run the sweep after every change to `src/bot.ts` and record the numbers in
the plan file. The number that matters is head-to-head vs `baseline-bot` (the
frozen pre-tuning copy in `test/eval/bot-baseline.ts`); it was 52% at the start,
and the target is >=65%. The scripted opponents are too weak to show the
defects — do not tune against them alone.

## Constraints

- No `Math.random()` / `Date.now()` in `src/bot.ts`. Planning is seeded from
  `${gameGuid}:${completedRounds}` and must stay deterministic — this runs in a
  Cloudflare Worker.
- Never edit `test/eval/bot-baseline.ts`. It is the A/B control.
- `src/engine.ts` is the canonical rules definition. Do not change game rules to
  make the bot stronger.
- Keep `test/bot.strength.test.ts` passing, and keep the bot's per-turn compute
  bounded — it runs inside a Worker request.

## Finishing

Commit and push to `bot-improvements`, then open a PR against `main` with a
bullet list of the changes and the before/after sweep numbers. Do not merge.

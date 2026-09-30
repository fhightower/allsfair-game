// The bot's public entry point.
//
// One function, three settings. Everything below it is pure: no I/O, no clock,
// no globals, and randomness only through an injected Rng — so the same seed
// always plays the same game, which is what makes the strength measurements in
// test/bot.strength.test.ts mean anything.
import type { BoardState } from "../engine";
import type { Plan } from "./simulate";
import {
  candidateMoves,
  dedupePlansByOutcome,
  enumeratePlans,
  passFor,
} from "./plans";
import { evaluate, WIN_SCORE } from "./eval";
import { resolveRound } from "./simulate";
import { searchBestPlan, type SearchOptions } from "./search";
import { systemRng, type Rng } from "./rng";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface BotOptions {
  difficulty?: Difficulty;
  rng?: Rng;
}

export interface BotDecision {
  plan: Plan;
  difficulty: Difficulty;
  /** True only when the plan was proven to win against every reply. */
  forcedWin: boolean;
  simulations: number;
  /**
   * The mixture the plan was drawn from. Exposed because it, not the single
   * sampled plan, is what the bot's strength is a property of: exploitability is
   * measured against this distribution.
   */
  strategy: { plan: Plan; probability: number }[];
}

/**
 * How often easy throws away its best idea and picks at random.
 *
 * Easy has to be beatable by someone learning the rules, and the honest way to
 * do that is to blunder outright rather than to play well and stop short. It
 * keeps no lookahead and runs no proofs, so it walks into losing positions on
 * its own too.
 */
const EASY_BLUNDER_RATE = 0.35;

/** Plans easy will look at. It does not need the whole space to play sensibly. */
const EASY_POOL_LIMIT = 600;

const PRESETS: Record<Exclude<Difficulty, "easy">, SearchOptions> = {
  // One round of equilibrium play with both proofs on. It punishes real
  // mistakes and never hands over the game, but plans no further than this
  // round, so its shape can be out-manoeuvred over several.
  medium: {
    depth: 1,
    candidateLimit: 12,
    oracleRounds: 3,
    oraclePoolLimit: 120,
    refutationScanLimit: 90,
    rootSolverIterations: 400,
    maxSimulations: 60_000,
    exactSimulations: 80_000,
    useExactLayer: true,
  },
  // The same algorithm as medium, approximated far more closely: a wide support,
  // a best-response oracle over a large pool, many more solver iterations, and
  // proofs run over several times as many plans.
  //
  // Depth is 1 deliberately. Lookahead was measured and *hurt*: exploitability
  // against a best-responding opponent over its full plan space came out at
  // 0.267 at depth 2 against 0.148 for this preset, and depth 2 also lost its
  // head-to-head against medium. Lookahead nodes have to pick candidates with a
  // narrow greedy beam ranked against a passive opponent, and those values are
  // noisier than simply evaluating the position — so searching deeper replaced a
  // reliable signal with an unreliable one. The `depth` option remains for when
  // the evaluation is good enough to earn it.
  //
  // Width was swept: exploitability 0.309 (medium), 0.202, 0.148, 0.137 at
  // supports of 12/28/40/64, costing 75ms/764ms/2.0s/3.0s. 40 is where the curve
  // flattens. Measured cost is roughly 1-4 seconds a round depending on the
  // position; the sweep figures below are means.
  //
  // Thirty oracle rounds is where the double oracle *converges*, not a guess:
  // 12 rounds measured 0.148, 30 rounds 0.1193, and 30-rounds-with-8000-solver-
  // iterations and 60-rounds-with-a-5000-plan-pool both measured 0.1193 exactly.
  // Identical numbers across three settings mean the equilibrium of the candidate
  // pool has been found and more solving cannot help.
  //
  // What is left — 0.1193 rather than 0 — is the pool, not the solver. Plans are
  // built from candidateMoves, which collapses troop counts to a ladder of four
  // (see plans.ts), and collisions net troop for troop so intermediate counts are
  // genuinely strategic. Enriching the pool is the next lever for anyone wanting
  // more, and it costs time rather than accuracy.
  hard: {
    depth: 1,
    candidateLimit: 40,
    oracleRounds: 30,
    oraclePoolLimit: 2000,
    refutationScanLimit: 1200,
    rootSolverIterations: 4000,
    maxSimulations: 3_000_000,
    exactSimulations: 2_000_000,
    useExactLayer: true,
  },
};

const other = (team: number): number => (team === 1 ? 2 : 1);

/**
 * Greedy: the plan that looks best once played, against an opponent assumed to
 * do nothing — with a real chance of ignoring that answer entirely.
 */
function easyDecision(state: BoardState, team: number, rng: Rng): BotDecision {
  const opponentPass = passFor(other(team));
  const passive: Plan = [opponentPass, opponentPass, opponentPass];
  const pool = dedupePlansByOutcome(
    state,
    team,
    enumeratePlans(state, team, candidateMoves, EASY_POOL_LIMIT)
  );
  const fallback: Plan = [passFor(team), passFor(team), passFor(team)];
  const only = (plan: Plan, simulations: number): BotDecision => ({
    plan,
    difficulty: "easy",
    forcedWin: false,
    simulations,
    strategy: [{ plan, probability: 1 }],
  });

  if (pool.length === 0) return only(fallback, 0);

  if (rng.next() < EASY_BLUNDER_RATE) {
    return only(pool[Math.floor(rng.next() * pool.length)] ?? fallback, pool.length);
  }

  let best = pool[0];
  let bestScore = -Infinity;
  let simulations = 0;
  for (const plan of pool) {
    simulations++;
    const result =
      team === 1
        ? resolveRound(state, plan, passive)
        : resolveRound(state, passive, plan);
    const score =
      result.winner !== 0
        ? result.winner === team
          ? WIN_SCORE
          : -WIN_SCORE
        : evaluate(result.state, team);
    if (score > bestScore) {
      bestScore = score;
      best = plan;
    }
  }
  return only(best, simulations);
}

/** Picks a round's three moves for `team`. */
export function chooseRound(
  state: BoardState,
  team: number,
  options: BotOptions = {}
): BotDecision {
  const difficulty = options.difficulty ?? "medium";
  if (!DIFFICULTIES.includes(difficulty)) {
    throw new Error(`Unknown bot difficulty: ${difficulty}`);
  }
  const rng = options.rng ?? systemRng;

  if (difficulty === "easy") return easyDecision(state, team, rng);

  const result = searchBestPlan(state, team, { ...PRESETS[difficulty], rng });
  return {
    plan: result.plan,
    difficulty,
    forcedWin: result.forcedWin,
    simulations: result.simulations,
    strategy: result.strategy,
  };
}

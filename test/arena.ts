// Self-play harness. Used by test/bot.strength.test.ts and test/tournament.ts.
//
// Not shipped: nothing under src/ imports this.
import { Move, startingBoardState, type BoardState } from "../src/engine";
import { chooseRound, type Difficulty } from "../src/bot";
import { seededRng, type Rng } from "../src/bot/rng";
import {
  cloneBoardState,
  resolveRound,
  type Plan,
} from "../src/bot/simulate";
import { candidateMoves, enumeratePlans, legalMoves } from "../src/bot/plans";
import { evaluate, WIN_SCORE } from "../src/bot/eval";

/** The game has no round limit and no draw rule, so the harness supplies one. */
export const DEFAULT_MAX_ROUNDS = 25;

export interface GameOutcome {
  /** 1, 2, or 0 for a game still undecided when the round cap was reached. */
  winner: number;
  rounds: number;
  final: BoardState;
}

export interface PlayGameOptions {
  p1: Difficulty;
  p2: Difficulty;
  seed: number;
  maxRounds?: number;
  start?: BoardState;
  onRound?: (round: number, p1Plan: Plan, p2Plan: Plan, state: BoardState) => void;
}

/** Throws if a plan contains anything the engine would reject. */
function assertPlayable(plan: Plan, difficulty: Difficulty, team: number): void {
  if (plan.length !== 3) {
    throw new Error(`${difficulty} (team ${team}) returned ${plan.length} moves`);
  }
  for (const move of plan) {
    try {
      new Move(move);
    } catch (error) {
      throw new Error(
        `${difficulty} (team ${team}) returned an illegal move "${move}": ${
          (error as Error).message
        }`
      );
    }
  }
}

export function playGame(options: PlayGameOptions): GameOutcome {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let state = cloneBoardState(options.start ?? startingBoardState());
  // Separate streams per side, so swapping seats does not also swap luck.
  const rng1 = seededRng(options.seed);
  const rng2 = seededRng(options.seed + 777_777);

  for (let round = 1; round <= maxRounds; round++) {
    const first = chooseRound(state, 1, { difficulty: options.p1, rng: rng1 }).plan;
    const second = chooseRound(state, 2, { difficulty: options.p2, rng: rng2 }).plan;
    assertPlayable(first, options.p1, 1);
    assertPlayable(second, options.p2, 2);

    const result = resolveRound(state, first, second);
    state = result.state;
    options.onRound?.(round, first, second, state);
    if (result.winner !== 0) {
      return { winner: result.winner, rounds: round, final: state };
    }
  }
  return { winner: 0, rounds: maxRounds, final: state };
}

/**
 * A varied opening, reached by random legal play.
 *
 * The standard opening is symmetric, and a symmetric zero-sum game is a draw, so
 * two competent bots starting there deadlock and the result carries no
 * information about which plays better.
 */
export function randomOpening(rng: Rng, rounds: number): BoardState {
  let state = startingBoardState();
  for (let round = 0; round < rounds; round++) {
    const pick = (team: number): Plan => {
      const plans = enumeratePlans(state, team, candidateMoves, 4000);
      return plans[Math.floor(rng.next() * plans.length)];
    };
    const result = resolveRound(state, pick(1), pick(2));
    // Never hand back an opening that is already over.
    if (result.winner !== 0) return startingBoardState();
    state = result.state;
  }
  return state;
}

export interface PairedResult {
  aPoints: number;
  bPoints: number;
  draws: number;
  games: number;
}

export interface PairedMatchOptions {
  a: Difficulty;
  b: Difficulty;
  positions: number;
  maxRounds?: number;
  openingRounds?: number;
  seed?: number;
}

/**
 * Plays every position twice with the seats swapped.
 *
 * A position that simply favours whoever moves as team 1 — and team 1 does win
 * simultaneous double-kills — then contributes a point to each side and cancels,
 * leaving only the difference in how the two settings play.
 */
export function pairedMatch(options: PairedMatchOptions): PairedResult {
  const seed = options.seed ?? 9000;
  const openingRounds = options.openingRounds ?? 2;
  let aPoints = 0;
  let bPoints = 0;
  let draws = 0;

  for (let index = 0; index < options.positions; index++) {
    const start = randomOpening(seededRng(seed + index), openingRounds);
    for (const aIsFirst of [true, false]) {
      const outcome = playGame({
        p1: aIsFirst ? options.a : options.b,
        p2: aIsFirst ? options.b : options.a,
        seed: seed + index,
        maxRounds: options.maxRounds,
        start,
      });
      const aTeam = aIsFirst ? 1 : 2;
      if (outcome.winner === 0) draws++;
      else if (outcome.winner === aTeam) aPoints++;
      else bPoints++;
    }
  }

  return { aPoints, bPoints, draws, games: options.positions * 2 };
}

/**
 * What a best-responding opponent can score against the bot's mixed strategy.
 *
 * The responder enumerates its full legal plan space, so this is the true worst
 * case rather than a sample of it. Zero means the mixture cannot be taken
 * advantage of at all; higher means more exploitable. This is the measurement
 * that separates settings which draw each other.
 */
export function exploitability(
  state: BoardState,
  team: number,
  difficulty: Difficulty,
  seed: number
): number {
  const decision = chooseRound(state, team, {
    difficulty,
    rng: seededRng(seed),
  });
  const mixture = decision.strategy.filter((entry) => entry.probability > 1e-6);
  if (mixture.length === 0) {
    throw new Error(`${difficulty} reported an empty strategy`);
  }

  const opponent = team === 1 ? 2 : 1;
  let best = -Infinity;
  for (const reply of enumeratePlans(state, opponent, legalMoves)) {
    let value = 0;
    for (const { plan, probability } of mixture) {
      const result =
        team === 1
          ? resolveRound(state, plan, reply)
          : resolveRound(state, reply, plan);
      const mine =
        result.winner !== 0
          ? result.winner === team
            ? WIN_SCORE
            : -WIN_SCORE
          : evaluate(result.state, team);
      // Zero-sum: the opponent receives the negation.
      value += probability * -mine;
    }
    if (value > best) best = value;
  }
  return best;
}

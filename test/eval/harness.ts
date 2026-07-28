// Bot evaluation harness. Not a test file (no `.test.ts` suffix, so vitest
// does not auto-run it) — imported by test/bot.strength.test.ts for the
// strength gates and by ad-hoc sweep scripts when tuning src/bot.ts.
//
// `test/eval/bot-baseline.ts` is a frozen copy of the pre-tuning bot; keep it
// around as the A/B opponent so any change to src/bot.ts can be measured
// head-to-head instead of only against weak scripted opponents.
import { planTrio } from "../../src/bot";
import {
  legalActions,
  PASS_MOVE,
  planTrio as planTrioBaseline,
  sampleTrio as sampleTrioBaseline,
} from "./bot-baseline";
import { Board, Move, MovePair } from "../../src/engine";
import { choice, makeRng } from "../../src/rng";

export const MAX_ROUNDS = 40;

/** Plans one round's trio for `player` from the round-start board. */
export type Planner = (
  board: Board,
  player: number,
  seed: string,
  round: number
) => string[];

export interface Tally {
  wins: number;
  losses: number;
  draws: number;
  games: number;
  /** Wins split by which seat the bot under test occupied. */
  winsAsP1: number;
  winsAsP2: number;
}

/** Returns the winning team (1 or 2), or 0 for a draw at MAX_ROUNDS. */
export function playGame(p1: Planner, p2: Planner, seed: string): number {
  const board = new Board();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const t1 = p1(board, 1, `${seed}-p1-${round}`, round);
    const t2 = p2(board, 2, `${seed}-p2-${round}`, round);
    for (let i = 0; i < 3; i++) {
      board.applyMovePair(new MovePair(new Move(t1[i]), new Move(t2[i])));
      if (board.winner) return board.winner;
    }
    board.restock();
    if (board.winner) return board.winner;
  }
  return 0;
}

/**
 * Plays `games` games with `p2` as the bot under test, then the same games
 * with the seats swapped, and tallies from the bot-under-test's side. Playing
 * both seats keeps a result from being an artifact of the first-listed
 * player's home square.
 */
export function sweep(
  opponent: Planner,
  botUnderTest: Planner,
  games: number
): Tally {
  const tally: Tally = {
    wins: 0,
    losses: 0,
    draws: 0,
    games: games * 2,
    winsAsP1: 0,
    winsAsP2: 0,
  };
  for (let g = 0; g < games; g++) {
    const asP2 = playGame(opponent, botUnderTest, `eval-${g}`);
    if (asP2 === 2) {
      tally.wins++;
      tally.winsAsP2++;
    } else if (asP2 === 1) tally.losses++;
    else tally.draws++;

    const asP1 = playGame(botUnderTest, opponent, `eval-swap-${g}`);
    if (asP1 === 1) {
      tally.wins++;
      tally.winsAsP1++;
    } else if (asP1 === 2) tally.losses++;
    else tally.draws++;
  }
  return tally;
}

export function formatTally(name: string, t: Tally): string {
  const pct = Math.round((t.wins / t.games) * 100);
  const half = t.games / 2;
  return (
    `${name.padEnd(20)} W:${t.wins} L:${t.losses} D:${t.draws}  (${pct}%)` +
    `  [as P1 ${t.winsAsP1}/${half}, as P2 ${t.winsAsP2}/${half}]`
  );
}

// --- opponents -------------------------------------------------------------

/** The bot under test. */
export const searchBot: Planner = (b, player, seed) =>
  planTrio(b, player, makeRng(seed));

/** Frozen pre-tuning bot, for head-to-head A/B. */
export const baselineBot: Planner = (b, player, seed) =>
  planTrioBaseline(b, player, makeRng(seed));

/**
 * Greedy argmax of the action heuristic — the old strength-gate opponent.
 * Deliberately built on the *baseline* scorer: if it used the live one, tuning
 * `scoredActions` would move the opponent too and the sweep would measure
 * nothing.
 */
export const heuristicBot: Planner = (b, player, seed) =>
  sampleTrioBaseline(b, player, makeRng(seed), 1);

export const randomBot: Planner = (b, player, seed) => {
  const rand = makeRng(seed);
  const plan = b.clone();
  const moves: string[] = [];
  for (let i = 0; i < 3; i++) {
    const actions = legalActions(plan, player);
    if (actions.length === 0) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    const a = choice(actions, rand);
    const s = `${a.start}${a.troops}${a.end}`;
    plan.applyPlannedMove(new Move(s), player);
    moves.push(s);
  }
  return moves;
};

// Distance to the enemy home, kept local so opponents never drift with
// src/bot.ts.
const DIST_TO_ENEMY_HOME: Record<number, Record<string, number>> = {
  1: { a: 4, b: 3, c: 2, d: 3, e: 2, f: 1, g: 2, h: 1, i: 0 },
  2: { a: 0, b: 1, c: 2, d: 1, e: 2, f: 3, g: 2, h: 3, i: 4 },
};

/**
 * Deterministic beeline at the enemy home with the biggest stack — the shape
 * of the human play that beat the shipped bot. Every move, the largest owned
 * stack steps one square closer.
 */
export const rushBot: Planner = (b, player) => {
  const dist = DIST_TO_ENEMY_HOME[player];
  const plan = b.clone();
  const moves: string[] = [];
  for (let i = 0; i < 3; i++) {
    const owned = plan.populatedSquaresOwned(player);
    if (owned.length === 0) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    let from = owned[0];
    for (const square of owned) {
      if (
        plan.state[square].troopCount > plan.state[from].troopCount ||
        (plan.state[square].troopCount === plan.state[from].troopCount &&
          dist[square] < dist[from])
      ) {
        from = square;
      }
    }
    let to = plan.state[from].neighbors[0];
    for (const neighbor of plan.state[from].neighbors) {
      if (dist[neighbor] < dist[to]) to = neighbor;
    }
    const s = `${from}${plan.state[from].troopCount}${to}`;
    plan.applyPlannedMove(new Move(s), player);
    moves.push(s);
  }
  return moves;
};

const RUSH_PATH: Record<number, string[]> = {
  1: ["a", "d", "g", "h", "i"],
  2: ["i", "h", "g", "d", "a"],
};

/**
 * Bank restock troops at home for `buildRounds`, then walk the whole stack
 * along the ring to the enemy home. This is the shape of the human play in the
 * reported game: hold everything back, then march one big stack. It exploits
 * a bot that cannot hold position, because the bot bleeds its home garrison
 * into the middle while the stack grows.
 */
export function makeStacker(buildRounds: number): Planner {
  return (b, player, _seed, round) => {
    const path = RUSH_PATH[player];
    const plan = b.clone();
    const moves: string[] = [];
    for (let i = 0; i < 3; i++) {
      if (round < buildRounds) {
        moves.push(PASS_MOVE[player]);
        continue;
      }
      let idx = -1;
      for (let p = 0; p < path.length - 1; p++) {
        const n = plan.state[path[p]];
        if (n.owner === player && n.troopCount > 0) idx = p;
      }
      if (idx < 0) {
        moves.push(PASS_MOVE[player]);
        continue;
      }
      const from = path[idx];
      const s = `${from}${plan.state[from].troopCount}${path[idx + 1]}`;
      plan.applyPlannedMove(new Move(s), player);
      moves.push(s);
    }
    return moves;
  };
}

/**
 * The line that actually beat the shipped bot, in three phases: trade pieces
 * off with the greedy heuristic (against a bot that mirrors, equal-count
 * collisions annihilate both sides), then sit at home banking restock, then
 * march the resulting stack at the enemy home. A bot that cannot hold position
 * loses the banking phase outright.
 */
export function makeHumanLike(tradeRounds: number, bankRounds: number): Planner {
  return (b, player, seed, round) => {
    if (round < tradeRounds) return heuristicBot(b, player, seed, round);
    if (round < tradeRounds + bankRounds) {
      return [PASS_MOVE[player], PASS_MOVE[player], PASS_MOVE[player]];
    }
    return rushBot(b, player, seed, round);
  };
}

/**
 * Holds a garrison at home and only commits troops beyond `keep`. Punishes a
 * bot that over-extends: it never leaves its own home capturable.
 */
export function makeTurtle(keep: number): Planner {
  return (b, player, seed) => {
    const home = player === 1 ? "a" : "i";
    const rand = makeRng(seed);
    const plan = b.clone();
    const moves: string[] = [];
    for (let i = 0; i < 3; i++) {
      const homeNode = plan.state[home];
      const spare =
        homeNode.owner === player ? Math.max(0, homeNode.troopCount - keep) : 0;
      const options = legalActions(plan, player).filter(
        (a) => a.start !== home || a.troops <= spare
      );
      if (options.length === 0) {
        moves.push(PASS_MOVE[player]);
        continue;
      }
      const scored = options
        .map((a) => ({ a, s: rand() }))
        .sort((x, y) => y.s - x.s);
      const s = `${scored[0].a.start}${scored[0].a.troops}${scored[0].a.end}`;
      plan.applyPlannedMove(new Move(s), player);
      moves.push(s);
    }
    return moves;
  };
}

// Bot evaluation harness. Not a test file (no `.test.ts` suffix, so vitest
// does not auto-run it) — imported by test/bot.strength.test.ts for the
// strength gates and by ad-hoc sweep scripts when tuning src/bot.ts.
//
// `test/eval/bot-baseline.ts` is a frozen copy of the pre-tuning bot; keep it
// around as the A/B opponent so any change to src/bot.ts can be measured
// head-to-head instead of only against weak scripted opponents.
import { legalActions, PASS_MOVE, planTrio, sampleTrio } from "../../src/bot";
import { planTrio as planTrioBaseline } from "./bot-baseline";
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
  const tally: Tally = { wins: 0, losses: 0, draws: 0, games: games * 2 };
  for (let g = 0; g < games; g++) {
    const asP2 = playGame(opponent, botUnderTest, `eval-${g}`);
    if (asP2 === 2) tally.wins++;
    else if (asP2 === 1) tally.losses++;
    else tally.draws++;

    const asP1 = playGame(botUnderTest, opponent, `eval-swap-${g}`);
    if (asP1 === 1) tally.wins++;
    else if (asP1 === 2) tally.losses++;
    else tally.draws++;
  }
  return tally;
}

export function formatTally(name: string, t: Tally): string {
  const pct = Math.round((t.wins / t.games) * 100);
  return `${name.padEnd(20)} W:${t.wins} L:${t.losses} D:${t.draws}  (${pct}%)`;
}

// --- opponents -------------------------------------------------------------

/** The bot under test. */
export const searchBot: Planner = (b, player, seed) =>
  planTrio(b, player, makeRng(seed));

/** Frozen pre-tuning bot, for head-to-head A/B. */
export const baselineBot: Planner = (b, player, seed) =>
  planTrioBaseline(b, player, makeRng(seed));

/** Greedy argmax of the action heuristic — the old strength-gate opponent. */
export const heuristicBot: Planner = (b, player, seed) =>
  sampleTrio(b, player, makeRng(seed), 1);

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

// Aggregate behaviour stats over real games, to check whether a bot change
// actually changes what the bot does.
//   BOT_DIAG=1 npx vitest run test/eval/diagnose.test.ts --reporter=verbose --silent=false
import { describe, it } from "vitest";
import { homeThreat } from "../../src/bot";
import { baselineBot, searchBot, type Planner } from "./harness";
import { Board, Move, MovePair } from "../../src/engine";

const HOME = { 1: "a", 2: "i" } as const;

interface Stats {
  rounds: number;
  holds: number;
  garrisonSum: number;
  threatenedRounds: number;
  homeLost: number;
  /** Slots whose start square was empty/not owned at execution time. */
  deadBySlot: [number, number, number];
}

function blank(): Stats {
  return {
    rounds: 0,
    holds: 0,
    garrisonSum: 0,
    threatenedRounds: 0,
    homeLost: 0,
    deadBySlot: [0, 0, 0],
  };
}

/**
 * Walks the trio against the live board as the round actually executes, so a
 * slot counts as dead only if it is dead at the moment the engine reaches it.
 */
function record(stats: Stats, board: Board, trio: string[], player: 1 | 2) {
  stats.rounds++;
  const home = board.state[HOME[player]];
  stats.garrisonSum += home.owner === player ? home.troopCount : 0;
  if (home.owner !== player) stats.homeLost++;
  if (homeThreat(board, player) > 0) stats.threatenedRounds++;
  for (const m of trio) {
    if (new Move(m).troopCount === 0) stats.holds++;
  }
}

function recordDeadSlot(
  stats: Stats,
  board: Board,
  moveStr: string,
  slot: number,
  player: 1 | 2
) {
  const parsed = new Move(moveStr);
  if (parsed.troopCount === 0) return; // an intentional hold is not waste
  const start = board.state[parsed.start];
  if (start.owner !== player || start.troopCount === 0) stats.deadBySlot[slot]++;
}

function line(name: string, s: Stats): string {
  const per = (n: number) => (n / s.rounds).toFixed(2);
  const pct = (n: number) => `${Math.round((n / s.rounds) * 100)}%`;
  const dead = s.deadBySlot.map(pct).join("/");
  return (
    `${name.padEnd(10)} rounds:${s.rounds}  holds/round:${per(s.holds)}  ` +
    `dead-by-slot:${dead}  avg-garrison:${per(s.garrisonSum)}  ` +
    `threatened:${pct(s.threatenedRounds)}  home-lost:${pct(s.homeLost)}`
  );
}

function playInstrumented(
  p1: Planner,
  p2: Planner,
  seed: string,
  s1: Stats,
  s2: Stats
): number {
  const board = new Board();
  for (let round = 0; round < 40; round++) {
    const t1 = p1(board, 1, `${seed}-p1-${round}`, round);
    const t2 = p2(board, 2, `${seed}-p2-${round}`, round);
    record(s1, board, t1, 1);
    record(s2, board, t2, 2);
    for (let i = 0; i < 3; i++) {
      recordDeadSlot(s1, board, t1[i], i, 1);
      recordDeadSlot(s2, board, t2[i], i, 2);
      board.applyMovePair(new MovePair(new Move(t1[i]), new Move(t2[i])));
      if (board.winner) return board.winner;
    }
    board.restock();
    if (board.winner) return board.winner;
  }
  return 0;
}

describe.skipIf(!process.env.BOT_DIAG)("behaviour diagnostics", () => {
  it("new bot vs baseline", { timeout: 900_000 }, () => {
    const nw = blank();
    const base = blank();
    let newWins = 0;
    for (let g = 0; g < 20; g++) {
      // new bot as P2
      if (playInstrumented(baselineBot, searchBot, `d-${g}`, base, nw) === 2) {
        newWins++;
      }
      // seats swapped
      if (playInstrumented(searchBot, baselineBot, `ds-${g}`, nw, base) === 1) {
        newWins++;
      }
    }
    console.log(
      `\n${line("new", nw)}\n${line("baseline", base)}\nnew wins ${newWins}/40\n`
    );
  });
});

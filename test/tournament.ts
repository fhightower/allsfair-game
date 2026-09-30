// Full-strength strength measurement.
//
//   npm run tournament                    # default: 6 positions per pairing
//   npm run tournament -- --positions 20  # more games, tighter numbers
//   npm run tournament -- --rounds 40
//   npm run tournament -- --trace         # print a single game move by move
//
// The automated version of this lives in test/bot.strength.test.ts and is cut
// down to fit a test suite. Hard thinks for about two seconds a round, so a full
// pairing here takes minutes.
import { startingBoardState, type BoardState } from "../src/engine";
import { DIFFICULTIES, chooseRound, type Difficulty } from "../src/bot";
import { seededRng } from "../src/bot/rng";
import { troopsHeld } from "../src/bot/simulate";
import {
  DEFAULT_MAX_ROUNDS,
  exploitability,
  pairedMatch,
  playGame,
  randomOpening,
} from "./arena";

function flag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const positions = flag("positions", 6);
const maxRounds = flag("rounds", DEFAULT_MAX_ROUNDS);
const trace = process.argv.includes("--trace");

function render(state: BoardState): string {
  const cell = (name: string) => {
    const node = state[name];
    return `${name}${node.owner === 0 ? "." : node.owner}${String(node.troopCount).padStart(2)}`;
  };
  return `${cell("a")} ${cell("b")} ${cell("c")} | ${cell("d")} ${cell("e")} ${cell("f")} | ${cell("g")} ${cell("h")} ${cell("i")}`;
}

const squares = (state: BoardState, team: number) =>
  Object.values(state).filter((node) => node.owner === team).length;

function traceGame(p1: Difficulty, p2: Difficulty): void {
  console.log(`\n=== ${p1} (P1) vs ${p2} (P2), traced ===`);
  const outcome = playGame({
    p1,
    p2,
    seed: 1,
    maxRounds,
    onRound: (round, first, second, state) => {
      console.log(
        `r${String(round).padStart(2)}  P1 ${first.join(" ").padEnd(14)}  P2 ${second
          .join(" ")
          .padEnd(14)}  ${render(state)}  sq ${squares(state, 1)}/${squares(
          state,
          2
        )}  tr ${troopsHeld(state, 1)}/${troopsHeld(state, 2)}`
      );
    },
  });
  console.log(
    outcome.winner === 0
      ? `  undecided after ${outcome.rounds} rounds`
      : `  team ${outcome.winner} wins on round ${outcome.rounds}`
  );
}

function headToHead(): void {
  console.log(
    `\n=== Head to head: ${positions} positions per pairing, ${positions * 2} games, ${maxRounds}-round cap ===`
  );
  console.log("Each position is played twice with the seats swapped.\n");

  for (let i = 0; i < DIFFICULTIES.length; i++) {
    for (let j = i + 1; j < DIFFICULTIES.length; j++) {
      const a = DIFFICULTIES[i];
      const b = DIFFICULTIES[j];
      const started = Date.now();
      const result = pairedMatch({ a, b, positions, maxRounds });
      const decided = result.aPoints + result.bPoints;
      const share = decided > 0 ? `${Math.round((result.bPoints / decided) * 100)}%` : "n/a";
      console.log(
        `  ${b} vs ${a}: ${result.bPoints} - ${result.aPoints}` +
          `  (${result.draws} drawn, ${share} of decided games to ${b}, ${(
            (Date.now() - started) / 1000
          ).toFixed(0)}s)`
      );
    }
  }

  console.log(
    "\n  Note: two settings that both approximate the equilibrium draw each other,\n" +
      "  because a symmetric zero-sum game has value zero. Use exploitability below\n" +
      "  to rank them."
  );
}

function exploitabilityTable(): void {
  console.log(
    `\n=== Exploitability over ${positions} positions (lower is better) ===`
  );
  console.log(
    "What a best-responding opponent, searching its whole legal plan space,\n" +
      "can score against the bot's mixed strategy. Zero means unexploitable.\n"
  );

  const states = [
    startingBoardState(),
    ...Array.from({ length: positions - 1 }, (_, i) =>
      randomOpening(seededRng(4000 + i), 2)
    ),
  ];

  for (const difficulty of DIFFICULTIES) {
    const started = Date.now();
    const values = states.map((state, i) =>
      exploitability(state, 1, difficulty, 100 + i)
    );
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    console.log(
      `  ${difficulty.padEnd(7)} mean ${mean.toFixed(4)}   opening ${values[0].toFixed(
        4
      )}   (${((Date.now() - started) / 1000).toFixed(0)}s)`
    );
  }
}

function timings(): void {
  console.log("\n=== Time to choose one round ===");
  const state = randomOpening(seededRng(31), 2);
  for (const difficulty of DIFFICULTIES) {
    const samples = [0, 1, 2].map((seed) => {
      const started = process.hrtime.bigint();
      chooseRound(state, 1, { difficulty, rng: seededRng(seed) });
      return Number(process.hrtime.bigint() - started) / 1e6;
    });
    const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
    console.log(`  ${difficulty.padEnd(7)} ${mean.toFixed(0)}ms`);
  }
}

if (trace) {
  traceGame("medium", "easy");
  traceGame("hard", "medium");
} else {
  timings();
  exploitabilityTable();
  headToHead();
}

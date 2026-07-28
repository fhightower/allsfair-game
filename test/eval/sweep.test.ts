// Tuning sweep, not a gate. Skipped unless BOT_SWEEP is set:
//
//   BOT_SWEEP=1 npx vitest run test/eval/sweep.test.ts --silent=false
//
// Prints a W/L/D table for src/bot.ts against every scripted opponent plus a
// head-to-head against the frozen pre-tuning bot in test/eval/bot-baseline.ts.
// Every matchup is played from both seats (see harness `sweep`).
import { describe, it } from "vitest";
import {
  baselineBot,
  formatTally,
  heuristicBot,
  makeStacker,
  makeTurtle,
  randomBot,
  searchBot,
  sweep,
  type Planner,
} from "./harness";

const GAMES = 25;

describe.skipIf(!process.env.BOT_SWEEP)("bot tuning sweep", () => {
  it("src/bot.ts vs the opponent pool", { timeout: 900_000 }, () => {
    const opponents: [string, Planner][] = [
      ["random", randomBot],
      ["heuristic", heuristicBot],
      ["baseline-bot", baselineBot],
      ["stacker(build=2)", makeStacker(2)],
      ["stacker(build=4)", makeStacker(4)],
      ["turtle(keep=3)", makeTurtle(3)],
      ["turtle(keep=6)", makeTurtle(6)],
    ];
    const lines: string[] = [];
    for (const [name, opponent] of opponents) {
      lines.push(formatTally(name, sweep(opponent, searchBot, GAMES)));
    }
    console.log("\n" + lines.join("\n") + "\n");
  });
});

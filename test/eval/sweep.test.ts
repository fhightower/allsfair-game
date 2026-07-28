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
  makeHumanLike,
  makeStacker,
  makeTurtle,
  randomBot,
  rushBot,
  searchBot,
  sweep,
  type Planner,
} from "./harness";

// BOT_GAMES sets games per seat (default 25); BOT_ONLY filters the pool by
// substring, e.g. BOT_ONLY=baseline for a fast A/B while tuning.
const GAMES = Number(process.env.BOT_GAMES ?? 25);
const ONLY = process.env.BOT_ONLY;
// BOT_UNDER_TEST=baseline reruns the same pool against the frozen pre-tuning
// bot, which is how you tell "the new bot wins this matchup" apart from "this
// matchup was always winnable".
const UNDER_TEST = process.env.BOT_UNDER_TEST === "baseline" ? baselineBot : searchBot;

describe.skipIf(!process.env.BOT_SWEEP)("bot tuning sweep", () => {
  it("src/bot.ts vs the opponent pool", { timeout: 900_000 }, () => {
    const pool: [string, Planner][] = [
      ["random", randomBot],
      ["heuristic", heuristicBot],
      ["baseline-bot", baselineBot],
      ["rush", rushBot],
      ["human(2,2)", makeHumanLike(2, 2)],
      ["human(4,3)", makeHumanLike(4, 3)],
      ["human(6,2)", makeHumanLike(6, 2)],
      ["stacker(build=2)", makeStacker(2)],
      ["stacker(build=4)", makeStacker(4)],
      ["turtle(keep=3)", makeTurtle(3)],
      ["turtle(keep=6)", makeTurtle(6)],
    ];
    const opponents = ONLY
      ? pool.filter(([name]) => name.includes(ONLY))
      : pool;
    const lines: string[] = [];
    for (const [name, opponent] of opponents) {
      lines.push(formatTally(name, sweep(opponent, UNDER_TEST, GAMES)));
    }
    console.log("\n" + lines.join("\n") + "\n");
  });
});

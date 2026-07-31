// Strength gates. These are floors with margin, not the measured numbers; the
// measured value is in a comment on each. To re-measure after a change, run the
// full sweep in test/eval/sweep.test.ts.
//
// Every matchup is played from both seats, so a gate cannot be passed by an
// artifact of which home square the bot starts on.
//
// The floors against the scripted opponents are low on purpose. They dropped
// once when the bot moved from argmax to an equilibrium (heuristic 99% -> 86%)
// and again when source-denial entered the model (86% -> 78%), and both times
// the same change bought a large gain against an opponent that adapts. The
// second one cost nothing head-to-head against the bot it replaced (26-24 over
// 50 games), so a lower scripted number here means the bot stopped over-fitting
// to opponents that never punish it — not that it got weaker. Raising these
// floors by making the bot greedier would undo that. See ADVERSARIAL_WEIGHT and
// DENIAL_EVERY in src/bot.ts for the swept curves.
import { describe, expect, it } from "vitest";
import {
  baselineBot,
  denialExploiterBot,
  exploiterBot,
  heuristicBot,
  makeHumanLike,
  randomBot,
  searchBot,
  sweep,
} from "./eval/harness";

// Per seat, so double this many games per gate. Lower than it used to be
// because solving the round costs ~110 ms a turn against the argmax bot's 15.
const GAMES = 8;

describe("bot strength gates", () => {
  it("beats a random mover", { timeout: 120_000 }, () => {
    const tally = sweep(randomBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.9); // measured 100%
  });

  it("beats the greedy heuristic", { timeout: 120_000 }, () => {
    const tally = sweep(heuristicBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.6); // measured 78%
  });

  it("beats the pre-tuning bot", { timeout: 120_000 }, () => {
    const tally = sweep(baselineBot, searchBot, GAMES);
    // Floor sits ~2 sigma under the measured rate: this gate plays 16 games, so
    // one sigma is ~12 points and a tighter floor fails on noise alone.
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.4); // measured 66%
  });

  // The line a human used to beat the shipped bot: trade pieces off, bank
  // restock troops at home, then march the stack. The pre-tuning bot lost 14%
  // of these; this gate is what stops that regressing.
  it("beats trade-then-bank-then-march", { timeout: 120_000 }, () => {
    const tally = sweep(makeHumanLike(6, 2), searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.65); // measured 80%
  });

  // The gate that matters, and the one no scripted opponent can enforce: an
  // opponent that samples the bot's policy and best-responds to it. A bot that
  // answers a position the same way every time scores ~4% here however strong
  // each individual answer is, so this is what stops a future change quietly
  // going back to a pure strategy. Deliberately a low floor with wide margin —
  // it is expensive per game, so it runs few of them and the variance is large.
  it("is not trivially exploitable", { timeout: 300_000 }, () => {
    const tally = sweep(exploiterBot, searchBot, 6);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.15); // measured 35%
  });

  // The second exploit axis, and the one the gate above could not see: empty the
  // square the bot is about to move from and it plays one move against three. A
  // human found this on a bot that scored 33% above, which is why both axes are
  // gated separately — the bot's real exposure is the worse of the two.
  //
  // Read this floor as loose. Like `heuristicBot`, this exploiter is built on the
  // frozen baseline scorer and evaluation so that tuning src/bot.ts cannot move
  // the yardstick — and that makes it markedly weaker than the same construction
  // on the live ones, which holds the bot to 38% where this reads 63%. The 38%
  // is the number to believe about the bot's exposure (the previous build scored
  // 25% there); this gate only catches a collapse.
  it("is not trivially exploitable by source-denial", { timeout: 300_000 }, () => {
    const tally = sweep(denialExploiterBot, searchBot, 6);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.3); // measured 63%
  });
});

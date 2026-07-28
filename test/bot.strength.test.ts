// Strength gates. These are floors with margin, not the measured numbers —
// see docs/superpowers/plans/2026-07-28-bot-strength.md for the full sweep and
// test/eval/sweep.test.ts to re-measure after a change.
//
// Every matchup is played from both seats, so a gate cannot be passed by an
// artifact of which home square the bot starts on.
import { describe, expect, it } from "vitest";
import {
  baselineBot,
  heuristicBot,
  makeHumanLike,
  randomBot,
  searchBot,
  sweep,
} from "./eval/harness";

const GAMES = 15; // per seat, so 30 games per gate

describe("bot strength gates", () => {
  it("beats a random mover", { timeout: 120_000 }, () => {
    const tally = sweep(randomBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.95); // measured 100%
  });

  it("beats the greedy heuristic", { timeout: 120_000 }, () => {
    const tally = sweep(heuristicBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.85); // measured 98%
  });

  it("beats the pre-tuning bot", { timeout: 120_000 }, () => {
    const tally = sweep(baselineBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.6); // measured 70%
  });

  // The line a human used to beat the shipped bot: trade pieces off, bank
  // restock troops at home, then march the stack. The pre-tuning bot lost 14%
  // of these; this gate is what stops that regressing.
  it("beats trade-then-bank-then-march", { timeout: 120_000 }, () => {
    const tally = sweep(makeHumanLike(6, 2), searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.85); // measured 99%
  });
});

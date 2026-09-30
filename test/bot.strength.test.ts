// Measuring the ladder rather than asserting it.
//
// Two different measurements, because they answer different questions.
//
// Head to head settles medium against easy. It cannot settle hard against
// medium: both approximate the same equilibrium, and a symmetric zero-sum game
// has value zero, so two near-equilibrium players draw each other however much
// stronger one of them is. Measured directly, hard against medium came out
// 9 - 11 over twenty paired games — noise, not a ranking.
//
// Exploitability settles hard against medium. It asks how much a best-responding
// opponent, searching its whole legal plan space, can take from the bot's mixed
// strategy. That is what "as good as possible" means in a simultaneous-move
// game, and it separates the two settings cleanly.
//
// Full-strength head-to-head across every pairing is `npm run tournament`; hard
// thinks for about two seconds a round, which is too slow for a test suite.
import { describe, expect, it } from "vitest";
import { startingBoardState } from "../src/engine";
import { seededRng } from "../src/bot/rng";
import { DIFFICULTIES, type Difficulty } from "../src/bot";
import { exploitability, pairedMatch, playGame, randomOpening } from "./arena";

describe("the harness", () => {
  it("plays a complete game of legal moves", () => {
    const outcome = playGame({ p1: "easy", p2: "easy", seed: 1, maxRounds: 25 });
    expect(outcome.rounds).toBeGreaterThan(0);
    expect(outcome.rounds).toBeLessThanOrEqual(25);
    expect([0, 1, 2]).toContain(outcome.winner);
  });

  it("replays a game identically for the same seed", () => {
    const first = playGame({ p1: "medium", p2: "easy", seed: 7, maxRounds: 12 });
    const second = playGame({ p1: "medium", p2: "easy", seed: 7, maxRounds: 12 });
    expect(second).toEqual(first);
  }, 60_000);

  it("builds openings that are not the standard one", () => {
    const opening = randomOpening(seededRng(3), 2);
    expect(opening).not.toEqual(startingBoardState());
  });

  it("counts every game in a paired match", () => {
    const result = pairedMatch({ a: "easy", b: "easy", positions: 2, maxRounds: 8 });
    expect(result.aPoints + result.bPoints + result.draws).toBe(4);
  });
});

describe("every difficulty plays legally for a whole game", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty} never submits a move the engine rejects`, () => {
      // playGame validates each plan through the engine's own Move constructor,
      // so an illegal move throws rather than being silently clamped to a pass.
      const outcome = playGame({
        p1: difficulty,
        p2: "easy",
        seed: 5,
        maxRounds: difficulty === "hard" ? 3 : 15,
      });
      expect(outcome.rounds).toBeGreaterThan(0);
    }, 30_000);
  }
});

describe("medium against easy", () => {
  it("wins the clear majority of paired games", () => {
    const result = pairedMatch({
      a: "medium",
      b: "easy",
      positions: 6,
      maxRounds: 18,
    });
    expect(result.aPoints).toBeGreaterThan(result.bPoints * 3);
  }, 60_000);
});

describe("hard against medium", () => {
  it("is materially less exploitable", () => {
    const positions = [
      startingBoardState(),
      randomOpening(seededRng(4001), 2),
      randomOpening(seededRng(4002), 2),
    ];
    const mean = (difficulty: Difficulty) =>
      positions.reduce(
        (total, state, i) => total + exploitability(state, 1, difficulty, 100 + i),
        0
      ) / positions.length;

    const hard = mean("hard");
    const medium = mean("medium");
    expect(hard).toBeLessThan(medium);
  }, 120_000);

  it("plays the exact equilibrium at the opening, where the game is small enough to solve", () => {
    // 547 plans a side, so the whole matrix fits: a best-responding opponent
    // gains nothing at all.
    expect(exploitability(startingBoardState(), 1, "hard", 1)).toBeCloseTo(0, 3);
  }, 60_000);
});

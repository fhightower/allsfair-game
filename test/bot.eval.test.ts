import { describe, expect, it } from "vitest";
import { startingBoardState, type BoardState } from "../src/engine";
import { evaluate, WIN_SCORE, deliverableToHome } from "../src/bot/eval";

function pos(spec: Record<string, [number, number]>): BoardState {
  const state = startingBoardState();
  for (const name of Object.keys(state)) {
    state[name] = { neighbors: state[name].neighbors, owner: 0, troopCount: 0 };
  }
  for (const [name, [owner, troopCount]] of Object.entries(spec)) {
    state[name] = { neighbors: state[name].neighbors, owner, troopCount };
  }
  return state;
}

describe("evaluate", () => {
  it("is zero-sum: what helps one team hurts the other equally", () => {
    // The matrix game is only well formed if one number describes both sides.
    const states = [
      startingBoardState(),
      pos({ a: [1, 5], b: [1, 1], e: [1, 2], f: [2, 3], i: [2, 4] }),
      pos({ a: [1, 1], d: [2, 8], i: [2, 6], g: [2, 1] }),
      pos({ a: [2, 3], b: [1, 9], i: [2, 2] }),
    ];
    for (const state of states) {
      expect(evaluate(state, 1)).toBeCloseTo(-evaluate(state, 2), 9);
    }
  });

  it("scores the symmetric opening as dead level", () => {
    expect(evaluate(startingBoardState(), 1)).toBeCloseTo(0, 9);
  });

  it("scores a won position at the win score", () => {
    const won = pos({ a: [1, 3], i: [1, 4] });
    expect(evaluate(won, 1)).toBe(WIN_SCORE);
    expect(evaluate(won, 2)).toBe(-WIN_SCORE);
  });

  it("ranks a won position above every unfinished one", () => {
    const won = pos({ a: [1, 3], i: [1, 4] });
    const dominant = pos({ a: [1, 40], b: [1, 40], c: [1, 40], i: [2, 1] });
    expect(evaluate(won, 1)).toBeGreaterThan(evaluate(dominant, 1));
  });

  it("prefers holding more squares, troops being equal", () => {
    const spread = pos({ a: [1, 1], b: [1, 1], d: [1, 1], i: [2, 3] });
    const stacked = pos({ a: [1, 3], i: [2, 3] });
    expect(evaluate(spread, 1)).toBeGreaterThan(evaluate(stacked, 1));
  });

  it("counts a square held with no troops as income", () => {
    // squaresOwned filters on owner alone, so an empty square still pays.
    const withEmpty = pos({ a: [1, 3], b: [1, 0], i: [2, 3] });
    const without = pos({ a: [1, 3], i: [2, 3] });
    expect(evaluate(withEmpty, 1)).toBeGreaterThan(evaluate(without, 1));
  });

  it("prefers more troops, squares being equal", () => {
    const rich = pos({ a: [1, 8], i: [2, 3] });
    const poor = pos({ a: [1, 4], i: [2, 3] });
    expect(evaluate(rich, 1)).toBeGreaterThan(evaluate(poor, 1));
  });

  it("stops counting income once the home is lost", () => {
    // No home, no restock — the squares stop paying, so a big empire without a
    // home must score below a smaller one that still has its home.
    const homeless = pos({ a: [2, 1], b: [1, 4], c: [1, 4], e: [1, 4], i: [2, 9] });
    const homed = pos({ a: [1, 4], b: [1, 4], i: [2, 9] });
    expect(evaluate(homeless, 1)).toBeLessThan(evaluate(homed, 1));
  });

  it("dislikes an enemy stack parked next to its home", () => {
    const exposed = pos({ a: [1, 2], b: [1, 1], d: [2, 9], i: [2, 3] });
    const safe = pos({ a: [1, 2], b: [1, 1], g: [2, 9], i: [2, 3] });
    expect(evaluate(exposed, 1)).toBeLessThan(evaluate(safe, 1));
  });

  it("punishes exposure specifically, with every other feature held equal", () => {
    // Both positions give team 2 eleven troops over three squares, the same
    // total degree, and the same distance-weighted pressure on a. They differ
    // only in what the three-move budget can actually deliver: two stacks two
    // hops out cost four moves, so only one of them arrives, while a single
    // stack of the same size at the same distance arrives whole.
    const budgetBlocksHalf = pos({ a: [1, 2], c: [2, 5], g: [2, 5], i: [2, 1] });
    const allArrives = pos({ a: [1, 2], c: [2, 10], g: [2, 0], i: [2, 1] });

    expect(deliverableToHome(budgetBlocksHalf, 1)).toBe(5);
    expect(deliverableToHome(allArrives, 1)).toBe(10);
    expect(evaluate(allArrives, 1)).toBeLessThan(evaluate(budgetBlocksHalf, 1));
  });
});

describe("deliverableToHome", () => {
  it("counts troops standing next to the home", () => {
    const state = pos({ a: [1, 2], b: [2, 4], d: [2, 3], i: [2, 1] });
    expect(deliverableToHome(state, 1)).toBe(7);
  });

  it("counts troops two squares out, which can chain in within a round", () => {
    // Three moves per round, so e -> d -> a arrives with the same troops.
    const state = pos({ a: [1, 2], e: [2, 5], i: [2, 1] });
    expect(deliverableToHome(state, 1)).toBe(5);
  });

  it("ignores troops too far away to arrive", () => {
    // i is four moves from a, beyond a single round's reach of three.
    const state = pos({ a: [1, 2], i: [2, 9] });
    expect(deliverableToHome(state, 1)).toBe(0);
  });

  it("is zero when the enemy has nothing in range", () => {
    expect(deliverableToHome(startingBoardState(), 1)).toBe(0);
  });
});

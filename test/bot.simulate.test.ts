import { describe, expect, it } from "vitest";
import { Board, Move, MovePair, startingBoardState } from "../src/engine";
import {
  resolvePair,
  resolveRound,
  winnerOfState,
  type Plan,
} from "../src/bot/simulate";

/** Drives the engine the way src/db.ts does, as the reference behaviour. */
function referenceRound(p1: Plan, p2: Plan) {
  const board = new Board();
  for (let i = 0; i < 3; i++) {
    board.applyMovePair(new MovePair(new Move(p1[i]), new Move(p2[i])));
  }
  board.restock();
  return board;
}

const P1: Plan = ["a3b", "b2e", "b1e"];
const P2: Plan = ["i3h", "h2e", "h1e"];

describe("resolveRound", () => {
  it("resolves three pairs and restocks, matching the engine", () => {
    const reference = referenceRound(P1, P2);
    const result = resolveRound(startingBoardState(), P1, P2);
    expect(result.state).toEqual(reference.state);
  });

  it("reports the winner the engine would report", () => {
    // P2 has one troop left on i and P1 holds enough to take it outright.
    const state = startingBoardState();
    state.f = { neighbors: state.f.neighbors, owner: 1, troopCount: 9 };
    state.i = { neighbors: state.i.neighbors, owner: 2, troopCount: 1 };
    const result = resolveRound(state, ["f9i", "a0b", "a0b"], ["i1h", "a0b", "a0b"]);
    expect(result.winner).toBe(1);
  });

  it("leaves the caller's state untouched", () => {
    const state = startingBoardState();
    const before = structuredClone(state);
    resolveRound(state, P1, P2);
    expect(state).toEqual(before);
  });

  it("returns identical results when the same plans are resolved twice", () => {
    // The engine mutates Move objects: isMovePossible clamps troopCount and the
    // collision branch zeroes it. Reusing Move instances across simulations
    // would silently corrupt every search that revisits a plan.
    const first = resolveRound(startingBoardState(), P1, P2);
    const second = resolveRound(startingBoardState(), P1, P2);
    expect(second.state).toEqual(first.state);
  });

  it("clamps a plan that over-commits troops instead of throwing", () => {
    const result = resolveRound(startingBoardState(), ["a99b", "a0b", "a0b"], [
      "i0h",
      "i0h",
      "i0h",
    ]);
    // All 3 troops leave a, then restock pays +2 for owning both a and b.
    expect(result.state.a.troopCount).toBe(2);
    expect(result.state.b).toMatchObject({ owner: 1, troopCount: 3 });
  });

  it("treats a move from an unowned square as a pass", () => {
    const result = resolveRound(startingBoardState(), ["c3f", "a0b", "a0b"], [
      "i0h",
      "i0h",
      "i0h",
    ]);
    expect(result.state.f).toMatchObject({ owner: 0, troopCount: 0 });
    expect(result.state.a.troopCount).toBe(4); // untouched, then restocked
  });
});

describe("resolvePair", () => {
  it("applies one move pair without restocking", () => {
    const result = resolvePair(startingBoardState(), "a3b", "i3h");
    expect(result.b).toMatchObject({ owner: 1, troopCount: 3 });
    expect(result.h).toMatchObject({ owner: 2, troopCount: 3 });
    // Restock would have paid both homes; it must not have run.
    expect(result.a.troopCount).toBe(0);
    expect(result.i.troopCount).toBe(0);
  });

  it("leaves the caller's state untouched", () => {
    const state = startingBoardState();
    const before = structuredClone(state);
    resolvePair(state, "a3b", "i3h");
    expect(state).toEqual(before);
  });

  it("nets colliding moves against each other", () => {
    const state = startingBoardState();
    state.b = { neighbors: state.b.neighbors, owner: 1, troopCount: 5 };
    state.h = { neighbors: state.h.neighbors, owner: 2, troopCount: 2 };
    const result = resolvePair(state, "b5e", "h2e");
    expect(result.e).toMatchObject({ owner: 1, troopCount: 3 });
  });
});

describe("winnerOfState", () => {
  const cases: [string, Record<string, [number, number]>, number][] = [
    ["nobody yet", { a: [1, 3], i: [2, 3] }, 0],
    ["team 1 holds i and team 2 is spent", { a: [1, 3], i: [1, 4] }, 1],
    ["team 2 holds a and team 1 is spent", { a: [2, 4], i: [2, 3] }, 2],
    [
      "home taken but the loser's field army still outnumbers the garrison",
      { a: [1, 9], i: [1, 2], c: [2, 5] },
      0,
    ],
    ["exactly equal counts as spent", { a: [1, 3], i: [1, 2], c: [2, 2] }, 1],
    ["both homes fall at once: team 1 wins the tie", { a: [2, 5], i: [1, 5] }, 1],
  ];

  for (const [label, spec, expected] of cases) {
    it(`matches the engine: ${label}`, () => {
      const state = startingBoardState();
      for (const name of Object.keys(state)) {
        state[name] = { neighbors: state[name].neighbors, owner: 0, troopCount: 0 };
      }
      for (const [name, [owner, troopCount]] of Object.entries(spec)) {
        state[name] = { neighbors: state[name].neighbors, owner, troopCount };
      }
      const board = new Board();
      board.state = state;
      expect(winnerOfState(state)).toBe(board.winner);
      expect(winnerOfState(state)).toBe(expected);
    });
  }
});

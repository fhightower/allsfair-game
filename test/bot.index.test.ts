import { describe, expect, it } from "vitest";
import { Move, startingBoardState, type BoardState } from "../src/engine";
import { resolveRound } from "../src/bot/simulate";
import { enumeratePlans, legalMoves } from "../src/bot/plans";
import { findRefutation } from "../src/bot/exact";
import { seededRng } from "../src/bot/rng";
import { DIFFICULTIES, chooseRound, type Difficulty } from "../src/bot";

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

const FORCED_WIN = pos({ a: [1, 0], f: [1, 5], i: [2, 1] });
const MUST_DEFEND = pos({ a: [1, 3], b: [1, 2], e: [1, 2], d: [2, 5], i: [2, 2] });

const refuted = (plan: readonly string[]) =>
  findRefutation(MUST_DEFEND, 1, plan as never).refutation !== null;

describe("DIFFICULTIES", () => {
  it("offers three settings", () => {
    expect(DIFFICULTIES).toEqual(["easy", "medium", "hard"]);
  });
});

describe("chooseRound", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty} returns three moves the engine accepts`, () => {
      const decision = chooseRound(startingBoardState(), 1, {
        difficulty,
        rng: seededRng(1),
      });
      expect(decision.plan).toHaveLength(3);
      for (const move of decision.plan) expect(() => new Move(move)).not.toThrow();
      expect(decision.difficulty).toBe(difficulty);
    });

    it(`${difficulty} plays both sides of the board`, () => {
      const decision = chooseRound(startingBoardState(), 2, {
        difficulty,
        rng: seededRng(2),
      });
      expect(decision.plan).toHaveLength(3);
      for (const move of decision.plan) expect(() => new Move(move)).not.toThrow();
    });

    it(`${difficulty} repeats itself for a given seed`, () => {
      const first = chooseRound(MUST_DEFEND, 1, { difficulty, rng: seededRng(9) });
      const second = chooseRound(MUST_DEFEND, 1, { difficulty, rng: seededRng(9) });
      expect(second.plan).toEqual(first.plan);
    }, 15_000);
  }

  it("rejects a difficulty it does not know", () => {
    expect(() =>
      chooseRound(startingBoardState(), 1, {
        difficulty: "nightmare" as Difficulty,
      })
    ).toThrow(/nightmare/);
  });

  it("defaults to medium", () => {
    const decision = chooseRound(startingBoardState(), 1, { rng: seededRng(3) });
    expect(decision.difficulty).toBe("medium");
  });
});

describe("the ladder", () => {
  it("hard finds and reports a forced win", () => {
    const decision = chooseRound(FORCED_WIN, 1, {
      difficulty: "hard",
      rng: seededRng(4),
    });
    expect(decision.forcedWin).toBe(true);
    for (const reply of enumeratePlans(FORCED_WIN, 2, legalMoves)) {
      expect(resolveRound(FORCED_WIN, decision.plan, reply).winner).toBe(1);
    }
  });

  it("medium finds a forced win too", () => {
    const decision = chooseRound(FORCED_WIN, 1, {
      difficulty: "medium",
      rng: seededRng(5),
    });
    expect(decision.forcedWin).toBe(true);
  });

  it("medium and hard never walk into a lost position", () => {
    for (const difficulty of ["medium", "hard"] as Difficulty[]) {
      for (let seed = 1; seed <= 6; seed++) {
        const decision = chooseRound(MUST_DEFEND, 1, { difficulty, rng: seededRng(seed) });
        expect(refuted(decision.plan), `${difficulty} seed ${seed}`).toBe(false);
      }
    }
  }, 30_000);

  it("easy does walk into lost positions — that is the point of it", () => {
    let blunders = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const decision = chooseRound(MUST_DEFEND, 1, {
        difficulty: "easy",
        rng: seededRng(seed),
      });
      if (refuted(decision.plan)) blunders++;
    }
    expect(blunders).toBeGreaterThan(0);
  });

  it("easy still plays coherently rather than at random", () => {
    // It should generally push troops off its home to claim ground, not sit
    // still — a beginner opponent, not a broken one.
    let expanded = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const decision = chooseRound(startingBoardState(), 1, {
        difficulty: "easy",
        rng: seededRng(seed),
      });
      const after = resolveRound(startingBoardState(), decision.plan, [
        "i0h",
        "i0h",
        "i0h",
      ]).state;
      const owned = Object.values(after).filter((n) => n.owner === 1).length;
      if (owned > 1) expanded++;
    }
    expect(expanded).toBeGreaterThan(10);
  });

  it("spends more effort as the difficulty rises", () => {
    const work = (difficulty: Difficulty) =>
      chooseRound(MUST_DEFEND, 1, { difficulty, rng: seededRng(11) }).simulations;
    expect(work("easy")).toBeLessThan(work("medium"));
    expect(work("medium")).toBeLessThan(work("hard"));
  }, 15_000);
});

describe("the reported strategy", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty} reports a distribution containing the plan it played`, () => {
      const decision = chooseRound(MUST_DEFEND, 1, { difficulty, rng: seededRng(21) });
      const total = decision.strategy.reduce((sum, e) => sum + e.probability, 0);
      expect(total).toBeCloseTo(1, 6);
      const played = decision.strategy.find(
        (e) => e.plan.join(",") === decision.plan.join(",")
      );
      expect(played?.probability).toBeGreaterThan(0);
    }, 15_000);
  }

  it("mixes over several plans at medium and hard, not just one", () => {
    // Exploitability is measured against this mixture, so a collapsed strategy
    // would be both weaker and untestable.
    for (const difficulty of ["medium", "hard"] as Difficulty[]) {
      const decision = chooseRound(MUST_DEFEND, 1, { difficulty, rng: seededRng(22) });
      const support = decision.strategy.filter((e) => e.probability > 1e-6);
      expect(support.length, difficulty).toBeGreaterThan(1);
    }
  }, 15_000);
});

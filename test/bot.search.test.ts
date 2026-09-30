import { describe, expect, it } from "vitest";
import { Move, startingBoardState, type BoardState } from "../src/engine";
import { resolveRound, type Plan } from "../src/bot/simulate";
import { enumeratePlans, legalMoves } from "../src/bot/plans";
import { filterRefutedPlans, findRefutation } from "../src/bot/exact";
import { seededRng } from "../src/bot/rng";
import { searchBestPlan } from "../src/bot/search";

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

// Team 1's home falls unless it pulls troops back this round: only 1423 of the
// 7603 plans survive, and passing is not one of them.
const MUST_DEFEND = pos({ a: [1, 3], b: [1, 2], e: [1, 2], d: [2, 5], i: [2, 2] });

describe("searchBestPlan", () => {
  it("takes a forced win and says that is what it found", () => {
    const result = searchBestPlan(FORCED_WIN, 1, { rng: seededRng(1) });
    expect(result.forcedWin).toBe(true);
    for (const reply of enumeratePlans(FORCED_WIN, 2, legalMoves)) {
      expect(resolveRound(FORCED_WIN, result.plan, reply).winner).toBe(1);
    }
  });

  it("defends a home that would otherwise fall, from any seed", () => {
    // The position is only a meaningful test if both outcomes are available.
    // Checked on a strided sample via the batched API — calling findRefutation
    // per plan over the whole space re-enumerates the replies every time.
    const plans = enumeratePlans(MUST_DEFEND, 1, legalMoves);
    const sample = plans.filter((_, i) => i % 37 === 0);
    const safe = filterRefutedPlans(MUST_DEFEND, 1, sample).safe;
    expect(safe.length).toBeGreaterThan(0);
    expect(safe.length).toBeLessThan(sample.length);
    expect(findRefutation(MUST_DEFEND, 1, ["a0b", "a0b", "a0b"]).refutation).not.toBeNull();

    for (let seed = 1; seed <= 8; seed++) {
      const result = searchBestPlan(MUST_DEFEND, 1, { rng: seededRng(seed) });
      const refutation = findRefutation(MUST_DEFEND, 1, result.plan).refutation;
      expect(refutation, `seed ${seed} chose ${result.plan.join(",")}`).toBeNull();
    }
  });

  it("only ever returns moves the engine accepts", () => {
    const result = searchBestPlan(startingBoardState(), 1, { rng: seededRng(3) });
    expect(result.plan).toHaveLength(3);
    for (const move of result.plan) expect(() => new Move(move)).not.toThrow();
  });

  it("plays for team 2 as readily as team 1", () => {
    const mirrored = pos({ i: [2, 0], d: [2, 5], a: [1, 1] });
    const result = searchBestPlan(mirrored, 2, { rng: seededRng(4) });
    expect(result.forcedWin).toBe(true);
    for (const reply of enumeratePlans(mirrored, 1, legalMoves)) {
      expect(resolveRound(mirrored, reply, result.plan).winner).toBe(2);
    }
  });

  it("repeats itself exactly for a given seed", () => {
    const first = searchBestPlan(MUST_DEFEND, 1, { rng: seededRng(42) });
    const second = searchBestPlan(MUST_DEFEND, 1, { rng: seededRng(42) });
    expect(second.plan).toEqual(first.plan);
    expect(second.value).toBe(first.value);
  });

  it("returns a mixed strategy that is a real distribution", () => {
    const result = searchBestPlan(startingBoardState(), 1, { rng: seededRng(5) });
    const total = result.strategy.reduce((sum, e) => sum + e.probability, 0);
    expect(total).toBeCloseTo(1, 6);
    for (const entry of result.strategy) {
      expect(entry.probability).toBeGreaterThanOrEqual(0);
    }
  });

  it("plays a plan its own strategy gives weight to", () => {
    const result = searchBestPlan(startingBoardState(), 1, { rng: seededRng(6) });
    const chosen = result.strategy.find(
      (e) => e.plan.join(",") === result.plan.join(",")
    );
    expect(chosen).toBeDefined();
    expect(chosen?.probability).toBeGreaterThan(0);
  });

  it("mixes rather than always repeating one plan", () => {
    // A deterministic bot is exploitable in a simultaneous-move game, so the
    // opening must not collapse to a single answer across seeds.
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      chosen.add(
        searchBestPlan(startingBoardState(), 1, { rng: seededRng(seed) }).plan.join(",")
      );
    }
    expect(chosen.size).toBeGreaterThan(1);
  });

  it("stays within the simulation budget it is given", () => {
    const result = searchBestPlan(MUST_DEFEND, 1, {
      rng: seededRng(7),
      maxSimulations: 4000,
      exactSimulations: 4000,
    });
    expect(result.simulations).toBeLessThan(40_000);
    expect(result.plan).toHaveLength(3);
  });

  it("still returns a plan when the team has no troops at all", () => {
    const broke = pos({ a: [1, 0], i: [2, 3] });
    const result = searchBestPlan(broke, 1, { rng: seededRng(8) });
    expect(result.plan).toHaveLength(3);
    for (const move of result.plan) expect(() => new Move(move)).not.toThrow();
  });

  it("searches deeper when asked without changing its contract", () => {
    const deep = searchBestPlan(startingBoardState(), 1, {
      rng: seededRng(9),
      depth: 2,
      candidateLimit: 12,
    });
    expect(deep.plan).toHaveLength(3);
    expect(deep.depth).toBe(2);
  });

  it("can be told to skip the exact layer", () => {
    const result = searchBestPlan(FORCED_WIN, 1, {
      rng: seededRng(10),
      useExactLayer: false,
    });
    expect(result.forcedWin).toBe(false);
    expect(result.plan).toHaveLength(3);
  });
});

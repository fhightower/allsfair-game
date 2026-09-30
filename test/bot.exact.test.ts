import { describe, expect, it } from "vitest";
import { startingBoardState, type BoardState } from "../src/engine";
import { resolveRound, type Plan } from "../src/bot/simulate";
import { enumeratePlans, legalMoves } from "../src/bot/plans";
import {
  filterRefutedPlans,
  findForcedWin,
  findRefutation,
} from "../src/bot/exact";

/** Builds a board from `{square: [owner, troops]}`, everything else neutral. */
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

const other = (team: number) => (team === 1 ? 2 : 1);

function outcome(state: BoardState, team: number, mine: Plan, theirs: Plan) {
  return team === 1
    ? resolveRound(state, mine, theirs).winner
    : resolveRound(state, theirs, mine).winner;
}

/** The definition, applied literally: a plan that wins against every reply. */
function bruteForceForcedWin(state: BoardState, team: number): Plan | null {
  const replies = enumeratePlans(state, other(team), legalMoves);
  for (const plan of enumeratePlans(state, team, legalMoves)) {
    if (replies.every((reply) => outcome(state, team, plan, reply) === team)) {
      return plan;
    }
  }
  return null;
}

/** The definition, applied literally: some reply that wins outright. */
function bruteForceRefutation(
  state: BoardState,
  team: number,
  plan: Plan
): Plan | null {
  for (const reply of enumeratePlans(state, other(team), legalMoves)) {
    if (outcome(state, team, plan, reply) === other(team)) return reply;
  }
  return null;
}

// Team 2 holds only its home with a single troop; team 1 has five troops next
// door on f. Every reply loses, including moving the lone defender out.
const FORCED_WIN = pos({ a: [1, 0], f: [1, 5], i: [2, 1] });

// The same idea, but team 2 keeps a reserve on c that outlasts i's garrison, so
// holding the home is not enough to end the game.
const NO_FORCED_WIN = pos({ a: [1, 0], f: [1, 3], c: [2, 4], i: [2, 1] });

describe("findForcedWin", () => {
  it("verifies a forced win against commitments from every square", () => {
    const result = findForcedWin(FORCED_WIN, 1);
    expect(result.proven).toBe(true);
    expect(result.plan).not.toBeNull();
    // The opponent has one troop, so counts above one clamp to one. Unlike
    // passive enumeration, this independent space includes every source,
    // including moves that gain an effect only through simultaneous actions.
    const moves = ["i0h", ...Object.entries(FORCED_WIN).flatMap(([name, node]) =>
      node.neighbors.map((neighbor) => `${name}1${neighbor}`)
    )];
    for (const first of moves) {
      for (const second of moves) {
        for (const third of moves) {
          expect(outcome(FORCED_WIN, 1, result.plan as Plan, [first, second, third])).toBe(1);
        }
      }
    }
  });

  it("finds a win, and the plan it returns really does beat every reply", () => {
    const result = findForcedWin(FORCED_WIN, 1);
    expect(result.plan).not.toBeNull();
    expect(result.proven).toBe(true);
    const replies = enumeratePlans(FORCED_WIN, 2, legalMoves);
    for (const reply of replies) {
      expect(outcome(FORCED_WIN, 1, result.plan as Plan, reply)).toBe(1);
    }
  });

  it("reports no win when none exists, and says so with proof", () => {
    expect(bruteForceForcedWin(NO_FORCED_WIN, 1)).toBeNull();
    const result = findForcedWin(NO_FORCED_WIN, 1);
    expect(result.plan).toBeNull();
    expect(result.proven).toBe(true);
  });

  it("agrees with brute force about whether a win exists", () => {
    const positions: [string, BoardState, number][] = [
      ["team 1 can finish", FORCED_WIN, 1],
      ["team 1 cannot finish", NO_FORCED_WIN, 1],
      ["mirrored for team 2", pos({ i: [2, 0], d: [2, 5], a: [1, 1] }), 2],
      ["nothing in reach", startingBoardState(), 1],
      ["home already lost", pos({ a: [2, 1], b: [1, 2], i: [2, 3] }), 1],
    ];
    for (const [label, state, team] of positions) {
      const expected = bruteForceForcedWin(state, team) !== null;
      const actual = findForcedWin(state, team);
      expect(actual.proven, label).toBe(true);
      expect(actual.plan !== null, label).toBe(expected);
    }
  });

  it("never claims proof it did not earn when the budget runs out", () => {
    const result = findForcedWin(FORCED_WIN, 1, 5);
    expect(result.proven).toBe(false);
  });

  it("stays cheap by refusing plans that lose to a passive opponent first", () => {
    // An all-pass reply is always legal, so any forced win must also beat it.
    // That prefilter is what keeps the proof affordable; without it this
    // position costs the full cross product.
    const result = findForcedWin(FORCED_WIN, 1);
    const full =
      enumeratePlans(FORCED_WIN, 1, legalMoves).length *
      enumeratePlans(FORCED_WIN, 2, legalMoves).length;
    expect(result.simulations).toBeLessThan(full / 10);
  });
});

describe("findRefutation", () => {
  it("checks replies whose later moves are enabled by an evacuated square", () => {
    const state = pos({ a: [1, 1], d: [1, 1], g: [2, 2], i: [2, 1] });
    const plan: Plan = ["d1e", "e1f", "f1c"];
    const reply: Plan = ["g2d", "d2a", "i0h"];
    // Against passes, g2d leaves only one troop at d, so the old enumeration
    // omitted d2a. Against this plan, both troops survive and take the home.
    expect(enumeratePlans(state, 2, legalMoves)).not.toContainEqual(reply);
    expect(outcome(state, 1, plan, reply)).toBe(2);
    const result = findRefutation(state, 1, plan);
    expect(result.proven).toBe(true);
    expect(result.refutation).not.toBeNull();
    expect(outcome(state, 1, plan, result.refutation as Plan)).toBe(2);
    expect(filterRefutedPlans(state, 1, [plan]).safe).toEqual([]);
  });

  it("finds the reply that punishes a losing plan", () => {
    // Team 1 has two troops on its home and nothing else; walking them out
    // hands over the home and the game.
    const state = pos({ a: [1, 2], d: [2, 3], i: [2, 3] });
    const suicidal: Plan = ["a2b", "a0b", "a0b"];
    expect(bruteForceRefutation(state, 1, suicidal)).not.toBeNull();

    const result = findRefutation(state, 1, suicidal);
    expect(result.refutation).not.toBeNull();
    expect(outcome(state, 1, suicidal, result.refutation as Plan)).toBe(2);
  });

  it("clears a plan that cannot be punished, with proof", () => {
    const state = pos({ a: [1, 6], b: [1, 4], d: [2, 2], i: [2, 3] });
    const solid: Plan = ["a0b", "a0b", "a0b"];
    expect(bruteForceRefutation(state, 1, solid)).toBeNull();

    const result = findRefutation(state, 1, solid);
    expect(result.refutation).toBeNull();
    expect(result.proven).toBe(true);
  });

  it("agrees with brute force across a set of plans", () => {
    const state = pos({ a: [1, 2], b: [1, 1], d: [2, 4], i: [2, 2] });
    const plans = enumeratePlans(state, 1, legalMoves).slice(0, 40);
    for (const plan of plans) {
      const expected = bruteForceRefutation(state, 1, plan) !== null;
      const actual = findRefutation(state, 1, plan);
      expect(actual.proven, plan.join(",")).toBe(true);
      expect(actual.refutation !== null, plan.join(",")).toBe(expected);
    }
  });

  it("does not claim proof when the budget runs out", () => {
    const state = pos({ a: [1, 6], b: [1, 4], d: [2, 2], i: [2, 3] });
    const result = findRefutation(state, 1, ["a0b", "a0b", "a0b"], 2);
    expect(result.proven).toBe(false);
  });
});

describe("findRefutation when the home is already lost", () => {
  // Team 1's home is team 2's, held by a single troop, and team 1 survives only
  // because it still has more troops than that garrison. A reply that destroys
  // them wins without any move ending on the home square, so the
  // ends-on-my-home shortcut must not be applied here.
  const state = pos({ a: [2, 1], b: [1, 3], i: [2, 3] });
  const plan: Plan = ["a0b", "a0b", "a0b"];

  it("still finds the reply that starves team 1 out", () => {
    expect(bruteForceRefutation(state, 1, plan)).not.toBeNull();
    const result = findRefutation(state, 1, plan);
    expect(result.refutation).not.toBeNull();
    expect(result.refutation?.some((move) => move.endsWith("a"))).toBe(false);
    expect(outcome(state, 1, plan, result.refutation as Plan)).toBe(2);
  });
});

describe("filterRefutedPlans", () => {
  // Team 1's home falls unless it pulls troops back, so the safe set is a
  // strict, non-empty subset — the case the search actually depends on.
  const state = pos({ a: [1, 3], b: [1, 2], e: [1, 2], d: [2, 5], i: [2, 2] });

  // A prefix of the enumeration is all "a0b,a0b,..." and uniformly refuted, so
  // a strided sample is used to get both outcomes into the batch.
  const sample = () =>
    enumeratePlans(state, 1, legalMoves).filter((_, i) => i % 61 === 0);

  it("keeps exactly the plans findRefutation clears", () => {
    const plans = sample();
    const expected = plans.filter(
      (plan) => findRefutation(state, 1, plan).refutation === null
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(plans.length);

    const result = filterRefutedPlans(state, 1, plans);
    expect(result.proven).toBe(true);
    expect(result.safe.map((p) => p.join(","))).toEqual(
      expected.map((p) => p.join(","))
    );
  });

  it("uses the same simulation budget as checking each plan separately", () => {
    // Each candidate is checked against its own response-dependent replies.
    const plans = sample();
    const separately = plans.reduce(
      (total, plan) => total + findRefutation(state, 1, plan).simulations,
      0
    );
    const batched = filterRefutedPlans(state, 1, plans);
    expect(batched.simulations).toBeLessThanOrEqual(separately);
    expect(batched.safe.length).toBeGreaterThan(0);
  });

  it("reports the safe set it managed and drops proof when cut short", () => {
    const plans = sample();
    const result = filterRefutedPlans(state, 1, plans, 10);
    expect(result.proven).toBe(false);
  });

  it("returns an empty safe set when every plan loses", () => {
    // Two troops on the home, six coming: nothing survives.
    const doomed = pos({ a: [1, 2], d: [2, 6], i: [2, 2] });
    const plans = enumeratePlans(doomed, 1, legalMoves);
    const result = filterRefutedPlans(doomed, 1, plans);
    expect(result.proven).toBe(true);
    expect(result.safe).toEqual([]);
  });
});

describe("refutation search order", () => {
  it("finds the punishing reply almost immediately", () => {
    // Replies are tried heaviest-strike-first, so a plan that abandons its home
    // is refuted within a handful of simulations rather than after scanning
    // most of the reply space. This is only an ordering: the set scanned is
    // unchanged, so a "no refutation" answer stays a proof.
    const state = pos({ a: [1, 3], b: [1, 2], e: [1, 2], d: [2, 5], i: [2, 2] });
    // 17 simulations ordered, against 792 in generation order.
    const result = findRefutation(state, 1, ["a0b", "a0b", "a0b"]);
    expect(result.refutation).not.toBeNull();
    expect(result.simulations).toBeLessThanOrEqual(25);
  });
});

describe("large troop stacks", () => {
  // Plan count grows cubically in troops held, and restock adds up to nine a
  // round, so a defensive game reaches stacks that would otherwise make the
  // proofs enumerate millions of plans before any budget check could fire.
  // Measured: 15k plans at 10 troops, 368k at 30, 1.2M at 45.
  const huge = pos({ a: [1, 60], b: [1, 20], i: [2, 3], h: [2, 4] });

  it("findForcedWin stays responsive instead of enumerating everything", () => {
    const started = Date.now();
    const result = findForcedWin(huge, 1);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.simulations).toBeLessThan(2_000_000);
  });

  it("findForcedWin does not claim a proof it could not complete", () => {
    // The space was truncated, so "no forced win found" is not "none exists".
    expect(findForcedWin(huge, 1).proven).toBe(false);
  });

  it("findRefutation stays responsive too", () => {
    const started = Date.now();
    const result = findRefutation(huge, 1, ["a0b", "a0b", "a0b"]);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.simulations).toBeLessThan(2_000_000);
  });

  it("filterRefutedPlans stays responsive", () => {
    const started = Date.now();
    const result = filterRefutedPlans(huge, 1, [
      ["a0b", "a0b", "a0b"],
      ["a60b", "a0b", "a0b"],
    ]);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.safe.length).toBeGreaterThanOrEqual(0);
  });

  it("still proves what it can in positions small enough to enumerate", () => {
    // The cap must not cost proofs on ordinary positions.
    expect(findForcedWin(FORCED_WIN, 1).proven).toBe(true);
    expect(findForcedWin(NO_FORCED_WIN, 1).proven).toBe(true);
  });
});

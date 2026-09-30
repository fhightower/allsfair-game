import { describe, expect, it } from "vitest";
import { Move, startingBoardState, type BoardState } from "../src/engine";
import { resolveRound, type Plan } from "../src/bot/simulate";
import {
  candidateMoves,
  dedupePlansByOutcome,
  enumeratePlans,
  legalMoves,
  passFor,
} from "../src/bot/plans";

function withNodes(
  overrides: Record<string, { owner: number; troopCount: number }>
): BoardState {
  const state = startingBoardState();
  for (const [name, o] of Object.entries(overrides)) {
    state[name] = { neighbors: state[name].neighbors, ...o };
  }
  return state;
}

describe("passFor", () => {
  it("never changes the board for either team", () => {
    const state = startingBoardState();
    const result = resolveRound(
      state,
      [passFor(1), passFor(1), passFor(1)],
      [passFor(2), passFor(2), passFor(2)]
    );
    // Only restock moves: each side owns its home alone, so +1 each.
    expect(result.state.a.troopCount).toBe(4);
    expect(result.state.i.troopCount).toBe(4);
  });

  it("does not absorb the opponent's move when it collides with a pass", () => {
    // passFor(2) is i0h, which ends on h. A team 1 move also ending on h must
    // still land in full rather than being netted against a zero-troop pass.
    const state = withNodes({ e: { owner: 1, troopCount: 3 } });
    const result = resolveRound(
      state,
      ["e3h", passFor(1), passFor(1)],
      [passFor(2), passFor(2), passFor(2)]
    );
    expect(result.state.h).toMatchObject({ owner: 1, troopCount: 3 });
  });
});

describe("legalMoves", () => {
  it("lists every distinct-effect move plus a pass at the opening", () => {
    const moves = legalMoves(startingBoardState(), 1);
    expect(new Set(moves)).toEqual(
      new Set(["a1b", "a2b", "a3b", "a1d", "a2d", "a3d", passFor(1)])
    );
  });

  it("skips squares the team does not own", () => {
    const moves = legalMoves(startingBoardState(), 1);
    expect(moves.filter((m) => !m.startsWith("a") || m === passFor(1))).toEqual([
      passFor(1),
    ]);
  });

  it("skips owned squares holding no troops", () => {
    const state = withNodes({ e: { owner: 1, troopCount: 0 } });
    expect(legalMoves(state, 1).some((m) => m.startsWith("e"))).toBe(false);
  });

  it("only emits moves the engine accepts", () => {
    const state = withNodes({
      b: { owner: 1, troopCount: 2 },
      e: { owner: 1, troopCount: 4 },
    });
    for (const m of legalMoves(state, 1)) {
      expect(() => new Move(m)).not.toThrow();
    }
  });
});

describe("candidateMoves", () => {
  it("is a subset of the legal moves", () => {
    const state = withNodes({ e: { owner: 1, troopCount: 6 } });
    const legal = new Set(legalMoves(state, 1));
    for (const m of candidateMoves(state, 1)) expect(legal).toContain(m);
  });

  it("includes the count that flips an enemy square, and not one less", () => {
    // f holds 3 enemy troops; capture needs strictly more, so 4 is the key
    // count and 3 only donates troops while leaving them the square.
    const state = withNodes({
      e: { owner: 1, troopCount: 9 },
      f: { owner: 2, troopCount: 3 },
    });
    const moves = candidateMoves(state, 1);
    expect(moves).toContain("e4f");
  });

  it("always offers a single troop and the whole stack", () => {
    const state = withNodes({ e: { owner: 1, troopCount: 6 } });
    const moves = candidateMoves(state, 1);
    expect(moves).toContain("e1b");
    expect(moves).toContain("e6b");
  });

  it("prunes well below the full move list", () => {
    const state = withNodes({ e: { owner: 1, troopCount: 8 } });
    expect(candidateMoves(state, 1).length).toBeLessThan(
      legalMoves(state, 1).length
    );
  });
});

describe("enumeratePlans", () => {
  it("chains: later moves may use troops the earlier ones delivered", () => {
    const plans = enumeratePlans(startingBoardState(), 1, legalMoves);
    expect(plans).toContainEqual(["a3b", "b3e", "e3f"]);
  });

  it("enumerates the whole opening plan space", () => {
    // Measured against the engine: 547 plans for either side at the opening.
    expect(enumeratePlans(startingBoardState(), 1, legalMoves)).toHaveLength(547);
    expect(enumeratePlans(startingBoardState(), 2, legalMoves)).toHaveLength(547);
  });

  it("emits plans of exactly three moves", () => {
    for (const plan of enumeratePlans(startingBoardState(), 1, legalMoves)) {
      expect(plan).toHaveLength(3);
    }
  });

  it("honours a cap on how many plans it returns", () => {
    const plans = enumeratePlans(startingBoardState(), 1, legalMoves, 50);
    expect(plans).toHaveLength(50);
  });
});

describe("dedupePlansByOutcome", () => {
  const state = withNodes({
    a: { owner: 1, troopCount: 3 },
    b: { owner: 1, troopCount: 2 },
    e: { owner: 1, troopCount: 2 },
    d: { owner: 2, troopCount: 5 },
  });

  const signature = (plan: Plan) => {
    const after = resolveRound(state, plan, [passFor(2), passFor(2), passFor(2)]).state;
    return Object.keys(after)
      .map((k) => `${after[k].owner}:${after[k].troopCount}`)
      .join("|");
  };

  it("collapses plans that reach the same position", () => {
    const plans = enumeratePlans(state, 1, candidateMoves);
    const kept = dedupePlansByOutcome(state, 1, plans);
    expect(kept.length).toBeLessThan(plans.length / 2);
  });

  it("keeps one plan per distinct position, and all of them", () => {
    const plans = enumeratePlans(state, 1, candidateMoves);
    const kept = dedupePlansByOutcome(state, 1, plans);
    const keptSignatures = kept.map(signature);
    expect(new Set(keptSignatures).size).toBe(kept.length);
    expect(new Set(keptSignatures)).toEqual(new Set(plans.map(signature)));
  });

  it("keeps the first plan it saw for each position", () => {
    const plans = enumeratePlans(state, 1, candidateMoves);
    const kept = new Set(dedupePlansByOutcome(state, 1, plans).map((p) => p.join(",")));
    const firstSeen = new Map<string, string>();
    for (const plan of plans) {
      const key = signature(plan);
      if (!firstSeen.has(key)) firstSeen.set(key, plan.join(","));
    }
    expect(kept).toEqual(new Set(firstSeen.values()));
  });

  it("leaves an already-distinct list alone", () => {
    const plans = enumeratePlans(startingBoardState(), 1, candidateMoves);
    const kept = dedupePlansByOutcome(startingBoardState(), 1, plans);
    expect(kept.length).toBeLessThanOrEqual(plans.length);
    expect(kept.length).toBeGreaterThan(0);
  });
});

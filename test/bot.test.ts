import { describe, expect, it } from "vitest";
import {
  DIST_TO_ENEMY_HOME,
  evaluate,
  holdAction,
  homeDeficit,
  homeThreat,
  legalActions,
  planBotTrio,
  planTrio,
  rushTrio,
  sampleTrio,
  scoredActions,
} from "../src/bot";
import { Board, Move, MovePair, startingBoardState } from "../src/engine";
import { makeRng } from "../src/rng";

/** Board with only the listed squares occupied: square -> [owner, troops]. */
function position(spec: Record<string, [number, number]>): Board {
  const board = new Board();
  for (const node of Object.values(board.state)) {
    node.owner = 0;
    node.troopCount = 0;
  }
  for (const [square, [owner, troops]] of Object.entries(spec)) {
    board.state[square].owner = owner;
    board.state[square].troopCount = troops;
  }
  return board;
}

function bfs(from: string): Record<string, number> {
  const graph = startingBoardState();
  const dist: Record<string, number> = { [from]: 0 };
  const queue = [from];
  while (queue.length) {
    const node = queue.shift()!;
    for (const n of graph[node].neighbors) {
      if (!(n in dist)) {
        dist[n] = dist[node] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

describe("constants", () => {
  it("distance tables match a BFS over the board", () => {
    expect(DIST_TO_ENEMY_HOME[1]).toEqual(bfs("i"));
    expect(DIST_TO_ENEMY_HOME[2]).toEqual(bfs("a"));
  });
});

describe("legalActions", () => {
  it("enumerates neighbors x troop options", () => {
    const actions = legalActions(new Board(), 1); // a: 3 troops, 2 neighbors
    expect(actions).toHaveLength(6);
  });

  it("adds the full-count option above the 8-troop cap", () => {
    const board = new Board();
    board.state.a.troopCount = 12;
    const actions = legalActions(board, 1);
    expect(actions).toHaveLength(18); // 2 neighbors x (8 + full 12)
    expect(actions.some((a) => a.troops === 12)).toBe(true);
  });

  it("is empty when the player has no populated squares", () => {
    const board = new Board();
    board.state.a.troopCount = 0;
    expect(legalActions(board, 1)).toHaveLength(0);
  });
});

describe("scoredActions", () => {
  it("prefers capturing an overwhelmed adjacent enemy", () => {
    const board = new Board();
    board.state.b = { ...board.state.b, owner: 2, troopCount: 1 };
    const top = scoredActions(board, 1)[0];
    expect(top.action.end).toBe("b");
  });

  it("sorts best-first deterministically", () => {
    const board = new Board();
    const once = scoredActions(board, 2).map((s) => s.action);
    const twice = scoredActions(board, 2).map((s) => s.action);
    expect(once).toEqual(twice);
    const scores = scoredActions(board, 2).map((s) => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe("sampleTrio", () => {
  it("returns three parseable move strings", () => {
    const trio = sampleTrio(new Board(), 2, makeRng("x"), 1);
    expect(trio).toHaveLength(3);
    for (const m of trio) expect(() => new Move(m)).not.toThrow();
  });

  it("emits pass moves when the player has nothing to move", () => {
    const board = new Board();
    board.state.i.troopCount = 0;
    expect(sampleTrio(board, 2, makeRng("x"), 1)).toEqual(["i0h", "i0h", "i0h"]);
  });
});

describe("home threat", () => {
  it("is zero when no enemy is within reach of home", () => {
    expect(homeThreat(position({ a: [1, 3], i: [2, 3] }), 2)).toBe(0);
  });

  it("counts enemies up to a full round's march away", () => {
    // d is 3 squares from i — reachable inside one 3-move round, which the
    // distance-2 horizon this replaced could not see.
    expect(homeThreat(position({ d: [1, 6], i: [2, 4] }), 2)).toBeGreaterThan(0);
  });

  it("weighs nearer enemies more heavily", () => {
    const near = homeThreat(position({ h: [1, 4], i: [2, 1] }), 2);
    const far = homeThreat(position({ e: [1, 4], i: [2, 1] }), 2);
    expect(near).toBeGreaterThan(far);
  });

  it("counts an occupied home double", () => {
    const occupied = position({ i: [1, 3] });
    expect(homeThreat(occupied, 2)).toBe(6);
  });

  it("deficit is what the garrison cannot absorb", () => {
    expect(homeDeficit(position({ h: [1, 10], i: [2, 2] }), 2)).toBe(8);
    expect(homeDeficit(position({ h: [1, 2], i: [2, 10] }), 2)).toBe(0);
  });
});

describe("hold action", () => {
  it("is a legal no-op move for either player", () => {
    for (const player of [1, 2]) {
      const action = holdAction(player);
      expect(action.troops).toBe(0);
      expect(() => new Move(`${action.start}0${action.end}`)).not.toThrow();
    }
  });

  it("leaves the board untouched when both players hold", () => {
    const board = new Board();
    const before = JSON.stringify(board.state);
    board.applyMovePair(new MovePair(new Move("a0b"), new Move("i0h")));
    expect(JSON.stringify(board.state)).toBe(before);
  });

  it("is offered as a candidate so a trio slot can decline to move", () => {
    const actions = scoredActions(new Board(), 2).map((s) => s.action);
    expect(actions.some((a) => a.troops === 0)).toBe(true);
  });

  it("outranks emptying a home that is under real threat", () => {
    // Bot home i holds 2 against a 10-stack next door: spending the garrison
    // on anything is worse than keeping it.
    const top = scoredActions(position({ h: [1, 10], i: [2, 2] }), 2)[0];
    expect(top.action.troops).toBe(0);
  });

  it("stays out of the pool on a quiet board", () => {
    const top3 = scoredActions(new Board(), 2).slice(0, 3);
    expect(top3.every((s) => s.action.troops > 0)).toBe(true);
  });
});

describe("rushTrio", () => {
  it("walks the biggest stack one square closer each move", () => {
    const trio = rushTrio(position({ a: [1, 9], i: [2, 3] }), 1);
    const dist = DIST_TO_ENEMY_HOME[1];
    for (const [i, moveStr] of trio.entries()) {
      const move = new Move(moveStr);
      expect(move.troopCount).toBe(9); // the whole stack, never split
      expect(dist[move.end]).toBe(dist[move.start] - 1);
      if (i > 0) expect(move.start).toBe(new Move(trio[i - 1]).end);
    }
  });

  it("passes when there is nothing to move", () => {
    expect(rushTrio(position({ a: [1, 3] }), 2)).toEqual(["i0h", "i0h", "i0h"]);
  });

  it("is deterministic", () => {
    const board = position({ a: [1, 4], d: [1, 2], i: [2, 5] });
    expect(rushTrio(board, 1)).toEqual(rushTrio(board, 1));
  });
});

describe("evaluate", () => {
  it("returns +/-1e6 on win/loss", () => {
    const board = new Board();
    board.state.i.owner = 1;
    expect(evaluate(board, 1)).toBe(1_000_000);
    expect(evaluate(board, 2)).toBe(-1_000_000);
  });

  it("penalizes an exposed home", () => {
    const safe = new Board();
    const exposed = new Board();
    exposed.state.b = { ...exposed.state.b, owner: 2, troopCount: 5 };
    expect(evaluate(exposed, 1)).toBeLessThan(evaluate(safe, 1));
  });

  it("rewards material and progress", () => {
    const ahead = new Board();
    ahead.state.h = { ...ahead.state.h, owner: 2, troopCount: 2 }; // bot advanced
    expect(evaluate(ahead, 2)).toBeGreaterThan(evaluate(new Board(), 2));
  });

  it("values an owned square the troops have already left", () => {
    // Restock pays per square owned, empty or not, so a claimed-then-vacated
    // square is income — it used to score exactly the same as neutral ground.
    const claimed = position({ i: [2, 3], h: [2, 0], a: [1, 3] });
    const neutral = position({ i: [2, 3], a: [1, 3] });
    expect(evaluate(claimed, 2)).toBeGreaterThan(evaluate(neutral, 2));
  });

  it("does not pay income for a home it no longer holds", () => {
    const held = position({ i: [2, 1], h: [2, 0], a: [1, 3] });
    const lost = position({ i: [1, 1], h: [2, 0], a: [1, 3] });
    expect(evaluate(lost, 2)).toBeLessThan(evaluate(held, 2));
  });
});

describe("planTrio", () => {
  it("keeps a garrison home instead of marching past a threat", () => {
    // Enemy 8-stack one square from the bot home, which holds 6. The plan has
    // to leave something behind or reinforce; emptying the home loses it.
    const board = position({ f: [1, 8], i: [2, 6], h: [2, 3], a: [1, 1] });
    const trio = planTrio(board, 2, makeRng("garrison"));
    const sim = board.clone();
    for (const move of trio) sim.applyPlannedMove(new Move(move), 2);
    expect(sim.state.i.owner).toBe(2);
    expect(sim.state.i.troopCount).toBeGreaterThan(0);
  });
});

describe("planBotTrio", () => {
  it("is deterministic per game and round", () => {
    const a = planBotTrio(new Board(), "guid-1", 0);
    const b = planBotTrio(new Board(), "guid-1", 0);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    for (const m of a) expect(() => new Move(m)).not.toThrow();
  });

  it("varies with seed (round or game)", () => {
    const r0 = planBotTrio(new Board(), "guid-1", 0);
    const r1 = planBotTrio(new Board(), "guid-1", 1);
    const g2 = planBotTrio(new Board(), "guid-2", 0);
    expect(
      [r1, g2].some((t) => JSON.stringify(t) !== JSON.stringify(r0))
    ).toBe(true);
  });
});

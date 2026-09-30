import { beforeEach, describe, expect, it } from "vitest";
import {
  claimPlayer2Slot,
  GameNotFound,
  getBoardAndRoundState,
  getGameByGuid,
  getMovesForGuid,
  saveMove,
  writeGame,
  writeMove,
} from "../src/db";
import { Board, Move } from "../src/engine";
import { createTestDb } from "./d1-shim";

const game = { gameGuid: "g-1", player1Secret: "s1", player2Secret: "" };

let db: D1Database;
beforeEach(() => {
  db = createTestDb();
});

describe("games", () => {
  it("writes and reads a game", async () => {
    await writeGame(db, game);
    expect(await getGameByGuid(db, "g-1")).toEqual(game);
  });

  it("throws GameNotFound for an unknown guid", async () => {
    await expect(getGameByGuid(db, "nope")).rejects.toBeInstanceOf(GameNotFound);
    await expect(getGameByGuid(db, "nope")).rejects.toThrow(
      "No game found with guid: nope"
    );
  });

  it("claims the player 2 slot exactly once", async () => {
    await writeGame(db, game);
    expect(await claimPlayer2Slot(db, "g-1", "s2")).toBe(true);
    expect((await getGameByGuid(db, "g-1")).player2Secret).toBe("s2");
    // second concurrent-style claim loses
    expect(await claimPlayer2Slot(db, "g-1", "s3")).toBe(false);
    expect((await getGameByGuid(db, "g-1")).player2Secret).toBe("s2");
  });
});

describe("moves and round state", () => {
  it.each([[3, 1], [3, 2], [1, 3], [2, 3], [2, 2]])(
    "hides the board and history of a partial round at counts %i/%i",
    async (p1Count, p2Count) => {
      for (const move of ["a3b", "b3e", "e3f"].slice(0, p1Count)) {
        await writeMove(db, "g-1", new Move(move), 1);
      }
      for (const move of ["i3h", "h3e", "e3d"].slice(0, p2Count)) {
        await writeMove(db, "g-1", new Move(move), 2);
      }
      const rs = await getBoardAndRoundState(db, "g-1");
      expect(rs.board.toHtmlTable()).toBe(new Board().toHtmlTable());
      expect(rs.board.history).toEqual([]);
      expect(rs.p1Count).toBe(p1Count);
      expect(rs.p2Count).toBe(p2Count);
      expect(rs.completedRounds).toBe(0);
      expect(rs.roundComplete).toBe(false);
    }
  );

  it.each([1, 2])("keeps only the previous round visible with %i paired moves pending", async (pending) => {
    for (const move of ["a1b", "a1d", "b1e"]) {
      await writeMove(db, "g-1", new Move(move), 1);
    }
    for (const move of ["i1h", "i1f", "h1e"]) {
      await writeMove(db, "g-1", new Move(move), 2);
    }
    const completed = await getBoardAndRoundState(db, "g-1");
    for (const move of ["a4b", "b4e", "e4f"]) {
      await writeMove(db, "g-1", new Move(move), 1);
    }
    for (const move of ["i4h", "h4e", "e4d"].slice(0, pending)) {
      await writeMove(db, "g-1", new Move(move), 2);
    }
    const partial = await getBoardAndRoundState(db, "g-1");
    expect(partial.board.toHtmlTable()).toBe(completed.board.toHtmlTable());
    expect(partial.board.history).toHaveLength(3);
    expect(partial.completedRounds).toBe(1);
    expect(partial.roundComplete).toBe(false);
  });

  it("returns moves in insertion order", async () => {
    await writeMove(db, "g-1", new Move("a1b"), 1);
    await writeMove(db, "g-1", new Move("i1h"), 2);
    expect(await getMovesForGuid(db, "g-1")).toEqual([
      { moveString: "a1b", player: 1 },
      { moveString: "i1h", player: 2 },
    ]);
  });

  it("replays the board and reports round state", async () => {
    for (const m of ["a1b", "a1d", "b1e"]) {
      await writeMove(db, "g-2", new Move(m), 1);
    }
    for (const m of ["i1h", "i1f", "h1e"]) {
      await writeMove(db, "g-2", new Move(m), 2);
    }
    const rs = await getBoardAndRoundState(db, "g-2");
    expect(rs.p1Count).toBe(3);
    expect(rs.p2Count).toBe(3);
    expect(rs.completedRounds).toBe(1);
    expect(rs.roundComplete).toBe(true);
    // pair 3 (b1e vs h1e) is an equal collision, then restock: 3 squares each
    expect(rs.board.state.e.troopCount).toBe(0);
    expect(rs.board.state.a.troopCount).toBe(4);
    expect(rs.board.state.i.troopCount).toBe(4);
    expect(rs.board.history).toHaveLength(3);
  });

  it("saveMove writes then returns fresh state", async () => {
    const rs = await saveMove(db, "g-3", new Move("a1b"), 1);
    expect(rs.p1Count).toBe(1);
    expect(rs.p2Count).toBe(0);
    expect(rs.roundComplete).toBe(false);
  });
});

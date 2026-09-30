import { describe, expect, it } from "vitest";
import { Board, Move, MovePair, startingBoardState } from "../src/engine";
import { parseBoardHtml } from "../src/bot/board-html";

const pair = (a: string, b: string) => new MovePair(new Move(a), new Move(b));

describe("parseBoardHtml", () => {
  it("reads back the starting board the server renders", () => {
    expect(parseBoardHtml(new Board().toHtmlTable())).toEqual(startingBoardState());
  });

  it("round-trips a board that has been played on", () => {
    const board = new Board();
    board.applyMovePair(pair("a3b", "i3h"));
    board.applyMovePair(pair("b2e", "h1e"));
    board.restock();
    expect(parseBoardHtml(board.toHtmlTable())).toEqual(board.state);
  });

  it("reads the live board, not an entry from the history", () => {
    // toHtmlTable renders the current board first and then every past board, so
    // a parser that took the last table would read an obsolete position.
    const board = new Board();
    board.applyMovePair(pair("a3b", "i3h"));
    board.applyMovePair(pair("a0b", "i0h"));
    board.applyMovePair(pair("a0b", "i0h"));
    board.restock();
    const parsed = parseBoardHtml(board.toHtmlTable());
    expect(parsed.b).toMatchObject({ owner: 1, troopCount: 3 });
    expect(parsed).toEqual(board.state);
  });

  it("handles troop counts of more than one digit", () => {
    const board = new Board();
    board.state.a = { neighbors: board.state.a.neighbors, owner: 1, troopCount: 137 };
    expect(parseBoardHtml(board.toHtmlTable()).a.troopCount).toBe(137);
  });

  it("keeps the board readable once a winner is announced", () => {
    const board = new Board();
    board.state.i = { neighbors: board.state.i.neighbors, owner: 1, troopCount: 4 };
    expect(board.winner).toBe(1);
    const parsed = parseBoardHtml(board.toHtmlTable());
    expect(parsed.i).toMatchObject({ owner: 1, troopCount: 4 });
  });

  it("carries the canonical adjacency, so the bot can plan from it", () => {
    const parsed = parseBoardHtml(new Board().toHtmlTable());
    expect(parsed.e.neighbors).toEqual(["b", "d", "f", "h"]);
    expect(parsed.a.neighbors).toEqual(["b", "d"]);
  });

  it("refuses html that is not a board", () => {
    expect(() => parseBoardHtml("<p>nothing here</p>")).toThrow(/board/i);
  });

  it("refuses a board that is missing squares", () => {
    const truncated =
      "<table><tr><td class='player1'>a: 3</td><td class='player0'>b: 0</td></tr></table>";
    expect(() => parseBoardHtml(truncated)).toThrow(/board/i);
  });
});

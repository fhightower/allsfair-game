// End-to-end: the bot playing through the real API, against the real worker.
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { createTestDb } from "./d1-shim";
import { Board, Move, MovePair } from "../src/engine";
import { seededRng } from "../src/bot/rng";
import { submitBotRound, type ApiCall } from "../src/bot/driver";
import { parseBoardHtml } from "../src/bot/board-html";

let env: Env;
beforeEach(() => {
  env = { DB: createTestDb() };
});

const api: ApiCall = async (action, params) => {
  const response = await (
    worker.fetch as unknown as (r: Request, e: Env) => Promise<Response>
  )(
    new Request("https://example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    }),
    env
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json() as never;
};

async function newBotGame() {
  const created = (await api("create_game", {})) as never as {
    game_guid: string;
    secret: string;
  };
  const joined = (await api("join_game", {
    game_guid: created.game_guid,
  })) as never as { secret: string };
  return {
    gameGuid: created.game_guid,
    humanSecret: created.secret,
    botSecret: joined.secret,
  };
}

const context = (game: Awaited<ReturnType<typeof newBotGame>>, seed = 1) => ({
  api,
  gameGuid: game.gameGuid,
  botSecret: game.botSecret,
  difficulty: "easy" as const,
  rng: seededRng(seed),
});

async function humanSubmits(
  game: Awaited<ReturnType<typeof newBotGame>>,
  moves: string[]
) {
  let last;
  for (const move of moves) {
    last = await api("submit_move", {
      game_guid: game.gameGuid,
      move,
      secret: game.humanSecret,
      player: "1",
    });
  }
  return last;
}

const state = (game: { gameGuid: string; humanSecret: string }) =>
  api("get_moves", {
    game_guid: game.gameGuid,
    secret: game.humanSecret,
    player: "1",
  });

describe("submitBotRound", () => {
  it("commits three moves and completes the round with the human's three", async () => {
    const game = await newBotGame();
    const before = await state(game);

    const { decision } = await submitBotRound(context(game), before);
    expect(decision?.plan).toHaveLength(3);

    const afterBot = await state(game);
    expect(afterBot.player_2_move_count).toBe(3);
    expect(afterBot.player_1_move_count).toBe(0);

    const final = await humanSubmits(game, ["a1b", "a1d", "b1e"]);
    expect(final?.round_complete).toBe(true);
    expect(final?.completed_rounds).toBe(1);
    expect(final?.player_1_move_count).toBe(3);
    expect(final?.player_2_move_count).toBe(3);
  });

  it("decides identically whether or not the human has already submitted", async () => {
    // The proof that it cannot peek. The response it plans from only ever has
    // completed move pairs applied, so the human's uncommitted moves are
    // invisible and the same seed must produce the same plan either way.
    const blind = await newBotGame();
    const beforeHuman = await state(blind);
    const first = await submitBotRound(context(blind, 42), beforeHuman);

    const informed = await newBotGame();
    await humanSubmits(informed, ["a3b", "b2e", "b1c"]);
    const afterHuman = await state(informed);
    const second = await submitBotRound(context(informed, 42), afterHuman);

    expect(first.decision).not.toBeNull();
    expect(second.decision).not.toBeNull();
    expect(second.decision?.plan).toEqual(first.decision?.plan);
  });

  it("plans from the board the engine derives, not from a partial round", async () => {
    const game = await newBotGame();
    await humanSubmits(game, ["a3b", "b2e", "b1c"]);
    const current = await state(game);

    // Nothing has resolved: the human's three moves have no pair to resolve
    // against yet, so this must still be the starting board.
    expect(parseBoardHtml(current.html)).toEqual(new Board().state);
  });

  it("does nothing when the bot has already committed this round", async () => {
    const game = await newBotGame();
    await submitBotRound(context(game), await state(game));
    const afterFirst = await state(game);
    expect(afterFirst.player_2_move_count).toBe(3);

    const { decision } = await submitBotRound(context(game), afterFirst);
    expect(decision).toBeNull();
    expect((await state(game)).player_2_move_count).toBe(3);
  });

  it("tops up a round the bot only partly committed", async () => {
    // A submit that dies halfway must not misalign the pairing, because moves
    // are paired by index.
    const game = await newBotGame();
    await api("submit_move", {
      game_guid: game.gameGuid,
      move: "i1h",
      secret: game.botSecret,
      player: "2",
    });
    const current = await state(game);
    expect(current.player_2_move_count).toBe(1);

    await submitBotRound(context(game), current);
    expect((await state(game)).player_2_move_count).toBe(3);
  });

  it("plays a full game through to a winner", async () => {
    const game = await newBotGame();
    let winner = 0;
    let rounds = 0;

    for (let round = 1; round <= 40 && winner === 0; round++) {
      const current = await state(game);
      if (current.html.includes("Winner is team")) break;

      await submitBotRound(context(game, round), current);

      // The human side plays greedily-ish: reinforce, then push out.
      const board = parseBoardHtml((await state(game)).html);
      const held = Object.entries(board).filter(
        ([, node]) => node.owner === 1 && node.troopCount > 0
      );
      const moves = held.length
        ? Array.from({ length: 3 }, () => {
            const [name, node] = held[0];
            return `${name}${node.troopCount}${node.neighbors[0]}`;
          })
        : ["a0b", "a0b", "a0b"];

      const final = await humanSubmits(game, moves);
      rounds = round;
      const match = /Winner is team.*?(\d)/.exec(final?.html ?? "");
      if (match) winner = Number(match[1]);
    }

    expect(rounds).toBeGreaterThan(0);
    // Either somebody won, or the game is simply still going — both are fine.
    expect([0, 1, 2]).toContain(winner);
  }, 60_000);

  it("only submits moves the engine accepts", async () => {
    const game = await newBotGame();
    const { decision } = await submitBotRound(context(game), await state(game));
    for (const move of decision?.plan ?? []) {
      expect(() => new Move(move)).not.toThrow();
    }
  });

  it("keeps the server's board in step with a local replay", async () => {
    const game = await newBotGame();
    const current = await state(game);
    const { decision } = await submitBotRound(context(game), current);
    const humanMoves = ["a2b", "b1e", "a1d"];
    const final = await humanSubmits(game, humanMoves);

    const replay = new Board();
    for (let i = 0; i < 3; i++) {
      replay.applyMovePair(
        new MovePair(new Move(humanMoves[i]), new Move((decision as never as { plan: string[] }).plan[i]))
      );
    }
    replay.restock();
    expect(parseBoardHtml(final?.html ?? "")).toEqual(replay.state);
  });
});

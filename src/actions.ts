// Game API actions.
import { Board, Move } from "./engine";
import { InvalidSecret } from "./exceptions";
import { ActionError } from "./errors";
import {
  type Game,
  type RoundState,
  getBoardAndRoundState,
  getGameByGuid,
  claimPlayer2Slot,
  saveMove,
  writeGame,
} from "./db";

export interface ResponseContent {
  game_guid: string;
  secret: string;
  html: string;
  player_1_move_count?: number;
  player_2_move_count?: number;
  completed_rounds?: number;
  round_complete?: boolean;
}

function requireFields(
  body: Record<string, unknown>,
  fields: string[]
): unknown[] {
  return fields.map((field) => {
    if (!(field in body)) {
      throw new ActionError(`Missing required field: ${field}`);
    }
    return body[field];
  });
}

function secretForPlayer(game: Game, player: unknown): string {
  const key = String(player);
  if (key === "1") return game.player1Secret;
  if (key === "2") return game.player2Secret;
  throw new ActionError(`Invalid player: ${key}`);
}

function roundStateResponse(
  gameGuid: string,
  secret: string,
  rs: RoundState
): ResponseContent {
  return {
    game_guid: gameGuid,
    secret,
    html: rs.board.toHtmlTable(),
    player_1_move_count: rs.p1Count,
    player_2_move_count: rs.p2Count,
    completed_rounds: rs.completedRounds,
    round_complete: rs.roundComplete,
  };
}

export async function createGame(
  d1: D1Database,
  _body: Record<string, unknown>
): Promise<ResponseContent> {
  const game: Game = {
    gameGuid: crypto.randomUUID(),
    player1Secret: crypto.randomUUID(),
    player2Secret: "",
  };
  await writeGame(d1, game);
  return {
    game_guid: game.gameGuid,
    secret: game.player1Secret,
    html: new Board().toHtmlTable(),
  };
}

export async function joinGame(
  d1: D1Database,
  body: Record<string, unknown>
): Promise<ResponseContent> {
  const [gameGuid] = requireFields(body, ["game_guid"]) as [string];
  const game = await getGameByGuid(d1, gameGuid);

  const secret = crypto.randomUUID();
  const claimed = await claimPlayer2Slot(d1, gameGuid, secret);
  if (!claimed) {
    throw new ActionError("Game is already joined");
  }

  return {
    game_guid: game.gameGuid,
    secret,
    html: new Board().toHtmlTable(),
  };
}

export async function submitMove(
  d1: D1Database,
  body: Record<string, unknown>
): Promise<ResponseContent> {
  const [gameGuid, moveStr, secret, player] = requireFields(body, [
    "game_guid",
    "move",
    "secret",
    "player",
  ]) as [string, string, string, unknown];

  const game = await getGameByGuid(d1, gameGuid);
  if (secretForPlayer(game, player) !== secret) {
    throw new InvalidSecret();
  }

  const move = new Move(moveStr);
  const rs = await saveMove(d1, gameGuid, move, Number(player));
  return roundStateResponse(gameGuid, secret, rs);
}

export async function getMoves(
  d1: D1Database,
  body: Record<string, unknown>
): Promise<ResponseContent> {
  const [gameGuid, secret, player] = requireFields(body, [
    "game_guid",
    "secret",
    "player",
  ]) as [string, string, unknown];

  const game = await getGameByGuid(d1, gameGuid);
  if (secretForPlayer(game, player) !== secret) {
    throw new InvalidSecret();
  }

  const rs = await getBoardAndRoundState(d1, gameGuid);
  return roundStateResponse(gameGuid, secret, rs);
}

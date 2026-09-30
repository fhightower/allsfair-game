// Driving a bot game through the ordinary API.
//
// This is the whole integration. The page that plays a bot game holds both
// players' secrets, so it can submit for both seats with no server change, no
// schema change, and no new endpoint. The logic lives here rather than inline in
// public/index.html so that it can be tested against the real worker — the
// round-boundary arithmetic below is exactly the kind of thing that looks
// obviously right and is not.
import { chooseRound, type BotDecision, type Difficulty } from "./index";
import { parseBoardHtml } from "./board-html";
import type { Rng } from "./rng";

/** The bot always takes the second seat; the human creates the game as team 1. */
const BOT_TEAM = 2;
const MOVES_PER_ROUND = 3;

export interface ApiResponse {
  html: string;
  player_1_move_count?: number;
  player_2_move_count?: number;
  completed_rounds?: number;
  round_complete?: boolean;
}

export type ApiCall = (
  action: string,
  params: Record<string, unknown>
) => Promise<ApiResponse>;

export interface BotRoundContext {
  api: ApiCall;
  gameGuid: string;
  botSecret: string;
  difficulty: Difficulty;
  rng?: Rng;
  /** Awaited before the search runs, so a UI can paint a thinking state first. */
  onThinking?: () => void | Promise<void>;
}

export interface BotRoundOutcome {
  response: ApiResponse;
  /** Null when the bot had already committed this round and nothing was sent. */
  decision: BotDecision | null;
}

/**
 * Commits the bot's share of the round described by `current`.
 *
 * Two properties matter and both come from the same place.
 *
 * The bot cannot see the human's moves. Its plan comes from `current.html`,
 * which the server renders from completed move pairs only, so a human who has
 * already submitted this round is invisible in it. The plan is fixed before
 * anything is sent, which is what keeps a round simultaneous.
 *
 * The bot cannot get out of step. Moves are paired by index, so committing too
 * many would misalign every later round. The bot is only ever topped up to the
 * boundary the human is currently completing — which also repairs a previous
 * submit that died halfway, rather than compounding it.
 */
export async function submitBotRound(
  context: BotRoundContext,
  current: ApiResponse
): Promise<BotRoundOutcome> {
  const humanCount = current.player_1_move_count ?? 0;
  const botCount = current.player_2_move_count ?? 0;

  const roundStart = humanCount - (humanCount % MOVES_PER_ROUND);
  const target = roundStart + MOVES_PER_ROUND;
  const needed = Math.max(0, Math.min(MOVES_PER_ROUND, target - botCount));
  if (needed === 0) return { response: current, decision: null };

  const board = parseBoardHtml(current.html);
  await context.onThinking?.();
  const decision = chooseRound(board, BOT_TEAM, {
    difficulty: context.difficulty,
    rng: context.rng,
  });

  let response = current;
  for (const move of decision.plan.slice(MOVES_PER_ROUND - needed)) {
    response = await context.api("submit_move", {
      game_guid: context.gameGuid,
      move,
      secret: context.botSecret,
      player: String(BOT_TEAM),
    });
  }
  return { response, decision };
}

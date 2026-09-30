// Reading a board back out of the HTML the API returns.
//
// The API's only view of the game is `Board.toHtmlTable`, so a browser-side bot
// has to parse it. That keeps the bot working against the deployed server with
// no API change; the cost is this parser, which is pinned to the renderer by
// round-trip tests in test/bot.board-html.test.ts.
import { startingBoardState, type BoardState } from "../engine";

/** `<td class='player1'>a: 3</td>` — one square, as `stateToHtmlTable` writes it. */
const SQUARE = /<td class='player(\d+)'>([a-i]): (\d+)<\/td>/g;

const SQUARE_COUNT = 9;

/**
 * Parses the live board out of a `toHtmlTable` response.
 *
 * That response holds the current board first and then every past board inside
 * a `<details>` history block, so only the first nine squares are the live
 * position. A winner announcement may precede them, but it renders as a `<span>`
 * and cannot be mistaken for a square.
 */
export function parseBoardHtml(html: string): BoardState {
  const state = startingBoardState();
  let found = 0;

  SQUARE.lastIndex = 0;
  for (let match = SQUARE.exec(html); match; match = SQUARE.exec(html)) {
    const [, owner, name, troopCount] = match;
    state[name] = {
      neighbors: state[name].neighbors,
      owner: Number(owner),
      troopCount: Number(troopCount),
    };
    if (++found === SQUARE_COUNT) break;
  }

  if (found < SQUARE_COUNT) {
    throw new Error(
      `Could not read a board from the response: found ${found} of ${SQUARE_COUNT} squares.`
    );
  }
  return state;
}

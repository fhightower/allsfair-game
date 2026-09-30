// Resolving a round the way the server does, but without touching the caller's
// state — the search resolves the same position thousands of times.
import {
  Board,
  Move,
  MovePair,
  TEAM_1,
  TEAM_1_HOME_SQUARE,
  TEAM_2,
  TEAM_2_HOME_SQUARE,
  type BoardState,
} from "../engine";

/** A round's worth of moves: three move strings, committed blind. */
export type Plan = [string, string, string];

export interface RoundResult {
  state: BoardState;
  winner: number;
}

/**
 * Copies like the engine's own cloneState: key order (a..i) is preserved and
 * `neighbors` is shared, because adjacency never changes and copying it is the
 * single largest cost of a clone.
 */
export function cloneBoardState(state: BoardState): BoardState {
  const copy: BoardState = {};
  for (const name of Object.keys(state)) {
    const node = state[name];
    copy[name] = {
      neighbors: node.neighbors,
      owner: node.owner,
      troopCount: node.troopCount,
    };
  }
  return copy;
}

function boardFrom(state: BoardState): Board {
  const board = new Board();
  board.state = cloneBoardState(state);
  return board;
}

/**
 * Applies a single move pair, without restocking.
 *
 * Plan generation needs this: move two of a plan may spend troops move one
 * delivered, so each step has to see the board the previous step left behind.
 */
export function resolvePair(
  state: BoardState,
  p1Move: string,
  p2Move: string
): BoardState {
  const board = boardFrom(state);
  board.applyMovePair(new MovePair(new Move(p1Move), new Move(p2Move)));
  return board.state;
}

/**
 * Applies three move pairs then restocks, mirroring src/db.ts exactly.
 *
 * Plans are strings rather than Move objects on purpose. The engine mutates
 * Moves in place — `isMovePossible` clamps `troopCount` to what the source
 * holds, and the collision branch zeroes the loser — so a Move instance reused
 * across two simulations would carry the first one's clamping into the second.
 * Fresh Moves are built per resolution.
 */
export function resolveRound(
  state: BoardState,
  p1Plan: Plan,
  p2Plan: Plan
): RoundResult {
  const board = boardFrom(state);
  for (let i = 0; i < 3; i++) {
    board.applyMovePair(new MovePair(new Move(p1Plan[i]), new Move(p2Plan[i])));
  }
  board.restock();
  return { state: board.state, winner: board.winner };
}

/** Total troops on squares a team owns. */
export function troopsHeld(state: BoardState, team: number): number {
  let total = 0;
  for (const name of Object.keys(state)) {
    const node = state[name];
    if (node.owner === team) total += node.troopCount;
  }
  return total;
}

/**
 * The engine's `winner`, computed straight from a state.
 *
 * Duplicating it avoids allocating a Board for every evaluated leaf. The order
 * matters and mirrors the engine: team 2's home is tested first, so when a move
 * pair takes both homes at once team 1 wins.
 */
export function winnerOfState(state: BoardState): number {
  const team1Home = state[TEAM_1_HOME_SQUARE];
  const team2Home = state[TEAM_2_HOME_SQUARE];

  if (
    team2Home.owner === TEAM_1 &&
    troopsHeld(state, TEAM_2) <= team2Home.troopCount
  ) {
    return TEAM_1;
  }
  if (
    team1Home.owner === TEAM_2 &&
    troopsHeld(state, TEAM_1) <= team1Home.troopCount
  ) {
    return TEAM_2;
  }
  return 0;
}

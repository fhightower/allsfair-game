// Generating the moves and three-move plans the search chooses between.
import { startingBoardState, type BoardState } from "../engine";
import { resolvePair, resolveRound, type Plan } from "./simulate";

/** Adjacency never changes, so one shared copy stands in for the whole game. */
const ADJACENCY = startingBoardState();

export type MoveGenerator = (state: BoardState, team: number) => string[];

/**
 * A move that does nothing: zero troops out of the team's own home.
 *
 * Zero-count moves are always available — `applyMove` returns before touching
 * the board when `troopCount < 1` — so every team always has a legal pass, and
 * a plan of three passes is always a legal reply. The exact search leans on
 * that: an all-pass opponent plan is guaranteed to be in the space it must
 * refute against.
 */
export function passFor(team: number): string {
  return team === 1 ? "a0b" : "i0h";
}

/**
 * Every move with a distinct effect, plus a pass.
 *
 * Moves out of squares the team does not own, or that hold no troops, are
 * omitted: the engine clamps those to zero troops, so they are passes wearing
 * a different name and would only inflate the search.
 */
export function legalMoves(state: BoardState, team: number): string[] {
  const moves: string[] = [passFor(team)];
  for (const name of Object.keys(state)) {
    const node = state[name];
    if (node.owner !== team || node.troopCount < 1) continue;
    for (const neighbor of ADJACENCY[name].neighbors) {
      for (let count = 1; count <= node.troopCount; count++) {
        moves.push(`${name}${count}${neighbor}`);
      }
    }
  }
  return moves;
}

/**
 * The strategically meaningful subset of `legalMoves`.
 *
 * Troop counts collapse to four ideas rather than every integer: one troop
 * (enough to claim a neutral square, and the cheapest probe), the whole stack,
 * half of it, and — against an enemy square — exactly one more than its
 * garrison. That last count is the important one: `applyMove` only changes the
 * owner when the subtraction goes negative, so matching the garrison merely
 * donates troops and leaves the enemy owning the square, and owners are paid
 * restock even on zero troops.
 *
 * This is where strict exactness is given up. Collisions net troop for troop,
 * so out-bidding a contested square by exactly one is a real idea that the
 * ladder can miss. Only the approximate search uses this; the proofs in
 * exact.ts enumerate `legalMoves` in full.
 */
export function candidateMoves(state: BoardState, team: number): string[] {
  const moves: string[] = [passFor(team)];
  for (const name of Object.keys(state)) {
    const node = state[name];
    if (node.owner !== team || node.troopCount < 1) continue;
    const held = node.troopCount;
    for (const neighbor of ADJACENCY[name].neighbors) {
      const target = state[neighbor];
      const counts = new Set([1, held, Math.ceil(held / 2)]);
      if (target.owner !== team && target.owner !== 0) {
        counts.add(target.troopCount + 1);
      }
      for (const count of counts) {
        if (count >= 1 && count <= held) moves.push(`${name}${count}${neighbor}`);
      }
    }
  }
  return moves;
}

/**
 * All three-move plans reachable from `state`, chaining each move onto the
 * board the previous one left.
 *
 * The opponent is assumed to pass while chaining. That is the team's own view
 * of what it can set up, and it is the only view available at commit time: the
 * plan is fixed before the opponent's moves are known. A plan whose later moves
 * the opponent disrupts is not wasted — the engine clamps the broken move to a
 * pass, which is exactly what happens to a human's predetermined plan.
 */
export function enumeratePlans(
  state: BoardState,
  team: number,
  moves: MoveGenerator,
  limit = Infinity
): Plan[] {
  const opponentPass = passFor(team === 1 ? 2 : 1);
  const step = (from: BoardState, move: string): BoardState =>
    team === 1
      ? resolvePair(from, move, opponentPass)
      : resolvePair(from, opponentPass, move);

  const plans: Plan[] = [];
  for (const first of moves(state, team)) {
    const afterFirst = step(state, first);
    for (const second of moves(afterFirst, team)) {
      const afterSecond = step(afterFirst, second);
      for (const third of moves(afterSecond, team)) {
        plans.push([first, second, third]);
        if (plans.length >= limit) return plans;
      }
    }
  }
  return plans;
}

/**
 * Collapses plans that reach the same position.
 *
 * Plans are permutations of each other far more often than not — three moves
 * spending the same troops on the same squares in a different order usually land
 * in one place — and the measured reduction on a mid-game position is sevenfold.
 * Positions are compared after resolving against a passive opponent, which is
 * the same view `enumeratePlans` chains under.
 *
 * This is an approximation and belongs only to the approximate search. Two plans
 * with the same passive outcome can still differ against an active opponent,
 * because collisions net move by move. The proofs in exact.ts never dedupe.
 */
export function dedupePlansByOutcome(
  state: BoardState,
  team: number,
  plans: Plan[]
): Plan[] {
  const opponentPass = passFor(team === 1 ? 2 : 1);
  const passive: Plan = [opponentPass, opponentPass, opponentPass];
  const seen = new Set<string>();
  const kept: Plan[] = [];

  for (const plan of plans) {
    const after =
      team === 1
        ? resolveRound(state, plan, passive).state
        : resolveRound(state, passive, plan).state;
    let signature = "";
    for (const name of Object.keys(after)) {
      signature += `${after[name].owner}:${after[name].troopCount}|`;
    }
    if (seen.has(signature)) continue;
    seen.add(signature);
    kept.push(plan);
  }
  return kept;
}

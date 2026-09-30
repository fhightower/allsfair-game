// Scoring an unfinished position.
//
// The weights encode four things the rules make true:
//
//   Land is income. `restock` pays a home one troop per square its team owns,
//   counting squares that hold no troops at all, so a single troop dropped on a
//   neutral square buys a permanent income stream. Income compounds; troops do
//   not. It is weighted above material for that reason.
//
//   Income stops when the home falls. `restock` pays nothing to a team whose
//   home is not its own, so an empire without a home is a shrinking asset.
//
//   A home falls when the enemy can deliver more troops to it in one round than
//   the defender's entire army holds. Capture leaves a garrison of (delivered -
//   defenders) and the defender's remaining army is (total - defenders), so the
//   defenders on the square cancel and the comparison is army against strike.
//
//   Reach is three moves, and only the opposite corner is further than that from
//   a home. Proximity is therefore about how much of the move budget an attack
//   consumes, not about whether it is possible at all.
import { startingBoardState, type BoardState } from "../engine";
import { troopsHeld, winnerOfState } from "./simulate";

/**
 * A win outscores every unfinished position. The evaluation of an unfinished
 * position is squashed into (-1, 1), which never reaches the bound, so this
 * comparison holds however large troop counts grow over a long game.
 */
export const WIN_SCORE = 1;

const MOVES_PER_ROUND = 3;

/** Raw feature score at which the squash reaches about 0.76. */
const SCALE = 20;

const WEIGHTS = {
  income: 3,
  material: 1,
  degree: 0.15,
  exposure: 0.8,
  pressure: 0.1,
};

const ADJACENCY = startingBoardState();
const SQUARES = Object.keys(ADJACENCY);
const HOME: Record<number, string> = { 1: "a", 2: "i" };

/** Hop counts from a square to every other, over the fixed adjacency. */
function distancesFrom(origin: string): Record<string, number> {
  const distance: Record<string, number> = { [origin]: 0 };
  const queue = [origin];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const neighbor of ADJACENCY[current].neighbors) {
      if (neighbor in distance) continue;
      distance[neighbor] = distance[current] + 1;
      queue.push(neighbor);
    }
  }
  return distance;
}

const DISTANCE_TO: Record<string, Record<string, number>> = {
  a: distancesFrom("a"),
  i: distancesFrom("i"),
};

const other = (team: number): number => (team === 1 ? 2 : 1);

function squaresOwned(state: BoardState, team: number): number {
  let count = 0;
  for (const name of SQUARES) if (state[name].owner === team) count++;
  return count;
}

/**
 * The most troops the enemy could land on `team`'s home in a single round.
 *
 * A stack `d` hops out spends `d` of the round's three moves getting there, so
 * stacks are taken nearest-first while the move budget lasts. This is an
 * approximation in the optimistic direction — it assumes the path is clear —
 * which is the right bias for a danger signal.
 */
export function deliverableToHome(state: BoardState, team: number): number {
  const distance = DISTANCE_TO[HOME[team]];
  const enemy = other(team);

  const stacks: { cost: number; troops: number }[] = [];
  for (const name of SQUARES) {
    const node = state[name];
    if (node.owner !== enemy || node.troopCount < 1) continue;
    const cost = distance[name];
    if (cost > MOVES_PER_ROUND) continue;
    stacks.push({ cost, troops: node.troopCount });
  }
  stacks.sort((x, y) => x.cost - y.cost || y.troops - x.troops);

  let spent = 0;
  let delivered = 0;
  for (const stack of stacks) {
    if (spent + stack.cost > MOVES_PER_ROUND) continue;
    spent += stack.cost;
    delivered += stack.troops;
  }
  return delivered;
}

/** The one-sided feature score, before the two sides are subtracted. */
function featureScore(state: BoardState, team: number): number {
  const home = HOME[team];
  const enemyHome = HOME[other(team)];
  const holdsHome = state[home].owner === team;

  const income = holdsHome ? squaresOwned(state, team) : 0;
  const material = troopsHeld(state, team);

  let degree = 0;
  let pressure = 0;
  for (const name of SQUARES) {
    const node = state[name];
    if (node.owner !== team) continue;
    degree += ADJACENCY[name].neighbors.length;
    const reach = MOVES_PER_ROUND + 1 - DISTANCE_TO[enemyHome][name];
    if (reach > 0) pressure += node.troopCount * reach;
  }

  // Only a shortfall matters: an army comfortably larger than any possible
  // strike is already credited through material.
  const exposure = Math.max(0, deliverableToHome(state, team) - material);

  return (
    WEIGHTS.income * income +
    WEIGHTS.material * material +
    WEIGHTS.degree * degree +
    WEIGHTS.pressure * pressure -
    WEIGHTS.exposure * exposure
  );
}

/**
 * Scores `state` from `team`'s point of view.
 *
 * Exactly zero-sum by construction — one number is computed for team 1 and
 * negated for team 2 — because the matrix game is only well formed if a single
 * payoff describes both sides.
 */
export function evaluate(state: BoardState, team: number): number {
  const winner = winnerOfState(state);
  if (winner !== 0) return winner === team ? WIN_SCORE : -WIN_SCORE;

  const raw = featureScore(state, 1) - featureScore(state, 2);
  const squashed = Math.tanh(raw / SCALE);
  return team === 1 ? squashed : -squashed;
}

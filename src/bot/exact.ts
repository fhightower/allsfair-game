// The layer that plays perfectly, with proof.
//
// Two questions have exact answers at any point in the game, and neither needs
// an evaluation function or a solver — they are quantifier checks over the plan
// space:
//
//   forced win  is there a plan of mine that wins against EVERY reply?
//   refutation  is there a reply that beats THIS plan of mine outright?
//
// Replies are enumerated on the actual board produced by each fixed plan.
// Forced-win candidates use conservative troop bounds so interference cannot
// hide a plan. Neither proof uses the approximate candidate set. Where a budget
// cuts the search short, `proven` is false and a null answer means "not shown".
//
// EXACT_PLAN_LIMIT bounds enumeration before the simulation budget is checked.
// A truncated space never supports a claim that no winning reply exists.
import type { BoardState } from "../engine";
import { resolvePair, resolveRound, troopsHeld, type Plan } from "./simulate";
import { legalMoves, passFor } from "./plans";

export interface ForcedWinResult {
  plan: Plan | null;
  proven: boolean;
  simulations: number;
}

export interface RefutationResult {
  refutation: Plan | null;
  proven: boolean;
  simulations: number;
}

const other = (team: number): number => (team === 1 ? 2 : 1);

const HOME: Record<number, string> = { 1: "a", 2: "i" };

/** Plans a single proof may enumerate before it gives up on completeness. */
const EXACT_PLAN_LIMIT = 150_000;

interface PlanSpace {
  plans: Plan[];
  /** False when the cap truncated the space, so "none found" proves nothing. */
  complete: boolean;
}

/**
 * A superset of the plans that can matter against any simultaneous reply.
 * Enemy garrisons may move away, so passive simulation cannot bound later
 * moves. Instead, track an upper bound on our troops at each square. Incoming
 * troops increase it; outgoing troops do not reduce it, since interference
 * may prevent an earlier transfer. No square can exceed our initial army.
 * Requests above a bound have the same effect as requesting the bound because
 * the engine clamps them. This includes every distinct response-dependent plan.
 */
function planSpace(state: BoardState, team: number): PlanSpace {
  const army = troopsHeld(state, team);
  const bounds = Object.fromEntries(
    Object.entries(state).map(([name, node]) => [
      name,
      node.owner === team ? node.troopCount : 0,
    ])
  );
  const plans: Plan[] = [];
  const extend = (prefix: string[], available: Record<string, number>): void => {
    if (plans.length >= EXACT_PLAN_LIMIT) return;
    if (prefix.length === 3) {
      plans.push(prefix as Plan);
      return;
    }
    extend([...prefix, passFor(team)], available);
    for (const [start, count] of Object.entries(available)) {
      for (const end of state[start].neighbors) {
        for (let troops = 1; troops <= count; troops++) {
          extend([...prefix, `${start}${troops}${end}`], {
            ...available,
            [end]: Math.min(army, available[end] + troops),
          });
          if (plans.length >= EXACT_PLAN_LIMIT) return;
        }
      }
    }
  };
  extend([], bounds);
  return { plans, complete: plans.length < EXACT_PLAN_LIMIT };
}

/**
 * Enumerate replies on the actual board produced by the fixed opposing plan.
 * A later move can spend troops preserved by the opponent vacating a square.
 * Enumerating against passes would miss those replies and give false proofs.
 */
function replySpace(state: BoardState, team: number, opposingPlan: Plan): PlanSpace {
  const plans: Plan[] = [];
  const extend = (board: BoardState, prefix: string[]): void => {
    for (const move of legalMoves(board, team)) {
      const next = [...prefix, move];
      if (next.length === 3) {
        plans.push(next as Plan);
      } else {
        const opposingMove = opposingPlan[prefix.length];
        const after =
          team === 1
            ? resolvePair(board, move, opposingMove)
            : resolvePair(board, opposingMove, move);
        extend(after, next);
      }
      if (plans.length >= EXACT_PLAN_LIMIT) return;
    }
  };
  extend(state, []);
  return { plans, complete: plans.length < EXACT_PLAN_LIMIT };
}

function winnerOf(
  state: BoardState,
  team: number,
  mine: Plan,
  theirs: Plan
): number {
  return team === 1
    ? resolveRound(state, mine, theirs).winner
    : resolveRound(state, theirs, mine).winner;
}

function passivePlan(team: number): Plan {
  const pass = passFor(team);
  return [pass, pass, pass];
}

/**
 * A plan that wins whatever the opponent does, or null.
 *
 * The prefilter is what makes this affordable. Zero-troop moves are always
 * legal, so an all-pass reply is always in the opponent's plan space; a plan
 * that fails to win against a passive opponent therefore cannot be a forced
 * win. That reduces the candidates from the whole plan space to the handful
 * that finish the game, and only those pay for exhaustive verification. Since
 * the filter only removes plans that provably are not forced wins, the proof
 * survives it.
 */
export function findForcedWin(
  state: BoardState,
  team: number,
  maxSimulations = Infinity
): ForcedWinResult {
  const opponent = other(team);
  const passive = passivePlan(opponent);
  const mine = planSpace(state, team);
  let simulations = 0;

  for (const plan of mine.plans) {
    if (simulations >= maxSimulations) {
      return { plan: null, proven: false, simulations };
    }
    simulations++;
    if (winnerOf(state, team, plan, passive) !== team) continue;

    const replies = replySpace(state, opponent, plan);
    let forced = true;
    for (const reply of replies.plans) {
      if (simulations >= maxSimulations) {
        return { plan: null, proven: false, simulations };
      }
      simulations++;
      if (winnerOf(state, team, plan, reply) !== team) {
        forced = false;
        break;
      }
    }
    // A win is only reported when every reply was actually checked. Against a
    // truncated reply space the plan may well still win, but calling it forced
    // would be a claim this did not establish.
    if (forced && replies.complete) {
      return { plan, proven: true, simulations };
    }
    if (forced) return { plan: null, proven: false, simulations };
  }

  return { plan: null, proven: mine.complete, simulations };
}

/** Troops a move commits, from a move string of the form `{square}{n}{square}`. */
function troopsCommitted(move: string): number {
  return parseInt(move.slice(1, -1), 10);
}

/**
 * Winning needs two things at once: the home taken, and the defender's field
 * army cut to no more than the garrison left on it. Replies are therefore
 * ordered by force at the home first and total force committed second, which
 * puts the plans that can actually finish at the front.
 *
 * Ordering only — the set is unchanged, so "no refutation" remains a proof.
 */
function threatKeys(plan: Plan, home: string): { atHome: number; committed: number } {
  let atHome = 0;
  let committed = 0;
  for (const move of plan) {
    const troops = troopsCommitted(move);
    committed += troops;
    if (move.endsWith(home)) atHome += troops;
  }
  return { atHome, committed };
}

/**
 * The replies that could possibly beat `team` this round.
 *
 * While the team still holds its home, only replies containing a move that ends
 * on that home can take it — ownership changes nowhere but on a move's
 * destination — so replies that never touch it cannot win and are dropped. Once
 * the home is already lost that reasoning no longer applies, because the
 * opponent can finish by destroying the field army instead, and every reply
 * stays in.
 */
function threateningReplies(state: BoardState, team: number, plan: Plan): PlanSpace {
  const space = replySpace(state, other(team), plan);
  const home = HOME[team];
  const reachable =
    state[home].owner === team
      ? space.plans.filter((reply) => reply.some((move) => move.endsWith(home)))
      : space.plans;

  // Keys are computed once per plan rather than inside the comparator, which
  // would recompute them O(n log n) times over a space of this size.
  const keyed = reachable.map((plan) => ({ plan, ...threatKeys(plan, home) }));
  keyed.sort((a, b) => b.atHome - a.atHome || b.committed - a.committed);
  return { plans: keyed.map((entry) => entry.plan), complete: space.complete };
}

/** A reply that makes the opponent the winner against `plan`, or null. */
export function findRefutation(
  state: BoardState,
  team: number,
  plan: Plan,
  maxSimulations = Infinity
): RefutationResult {
  return refute(
    state, team, plan, threateningReplies(state, team, plan), maxSimulations
  );
}

/**
 * A refutation that is found is always proven — it is a witness, checked by
 * simulation. Only the absence of one depends on having scanned every reply.
 */
function refute(
  state: BoardState,
  team: number,
  plan: Plan,
  replies: PlanSpace,
  maxSimulations: number
): RefutationResult {
  const opponent = other(team);
  let simulations = 0;

  for (const reply of replies.plans) {
    if (simulations >= maxSimulations) {
      return { refutation: null, proven: false, simulations };
    }
    simulations++;
    if (winnerOf(state, team, plan, reply) === opponent) {
      return { refutation: reply, proven: true, simulations };
    }
  }

  return { refutation: null, proven: replies.complete, simulations };
}

export interface FilterResult {
  safe: Plan[];
  proven: boolean;
  simulations: number;
}

/**
 * Splits `plans` into those with no refutation and those with one.
 *
 * Each plan needs its own reply space because simultaneous moves change which
 * replies have an effect. If the budget runs out partway, checked plans are
 * still returned with `proven` false. An unchecked plan is dropped rather than
 * assumed safe.
 */
export function filterRefutedPlans(
  state: BoardState,
  team: number,
  plans: Plan[],
  maxSimulations = Infinity
): FilterResult {
  const safe: Plan[] = [];
  let simulations = 0;

  for (const plan of plans) {
    if (simulations >= maxSimulations) {
      return { safe, proven: false, simulations };
    }
    const result = findRefutation(state, team, plan, maxSimulations - simulations);
    simulations += result.simulations;
    if (!result.refutation && !result.proven) {
      // Could not clear this plan, so it is not put in the safe set and the
      // batch stops claiming completeness.
      return { safe, proven: false, simulations };
    }
    if (!result.refutation) safe.push(plan);
  }

  return { safe, proven: true, simulations };
}

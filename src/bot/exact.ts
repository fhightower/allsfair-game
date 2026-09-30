// The layer that plays perfectly, with proof.
//
// Two questions have exact answers at any point in the game, and neither needs
// an evaluation function or a solver — they are quantifier checks over the plan
// space:
//
//   forced win  is there a plan of mine that wins against EVERY reply?
//   refutation  is there a reply that beats THIS plan of mine outright?
//
// Both enumerate `legalMoves` in full rather than the pruned candidate set, so
// an answer of "none" is a proof rather than a guess. Where a budget cuts the
// search short, `proven` comes back false and a null answer means "not shown",
// never "does not exist".
//
// The plan space grows cubically in troops held, and restock pays a home up to
// nine troops a round, so a long defensive game reaches stacks where the space
// stops being enumerable: measured at 15k plans for 10 troops on a home, 368k for
// 30, and 1.2M for 45. EXACT_PLAN_LIMIT bounds that. Past it the layer keeps
// working over as much as it enumerated but stops calling the result a proof,
// which is the honest reading — and a genuinely winning plan is not lost either
// way, because it still scores near the top of the equilibrium search.
import type { BoardState } from "../engine";
import { resolveRound, type Plan } from "./simulate";
import { enumeratePlans, legalMoves, passFor } from "./plans";

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

function planSpace(state: BoardState, team: number): PlanSpace {
  const plans = enumeratePlans(state, team, legalMoves, EXACT_PLAN_LIMIT);
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
  let replies: PlanSpace | null = null;

  for (const plan of mine.plans) {
    if (simulations >= maxSimulations) {
      return { plan: null, proven: false, simulations };
    }
    simulations++;
    if (winnerOf(state, team, plan, passive) !== team) continue;

    replies ??= planSpace(state, opponent);
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
function threateningReplies(state: BoardState, team: number): PlanSpace {
  const space = planSpace(state, other(team));
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
  return refute(state, team, plan, threateningReplies(state, team), maxSimulations);
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
 * The search checks hundreds of plans against the same position, so the reply
 * space is enumerated once for the whole batch instead of once per plan. If the
 * budget runs out partway the plans checked so far are still returned, with
 * `proven` false — an unchecked plan is dropped rather than assumed safe.
 */
export function filterRefutedPlans(
  state: BoardState,
  team: number,
  plans: Plan[],
  maxSimulations = Infinity
): FilterResult {
  const replies = threateningReplies(state, team);
  const safe: Plan[] = [];
  let simulations = 0;

  for (const plan of plans) {
    if (simulations >= maxSimulations) {
      return { safe, proven: false, simulations };
    }
    const result = refute(state, team, plan, replies, maxSimulations - simulations);
    simulations += result.simulations;
    if (!result.refutation && !result.proven) {
      // Could not clear this plan, so it is not put in the safe set and the
      // batch stops claiming completeness.
      return { safe, proven: false, simulations };
    }
    if (!result.refutation) safe.push(plan);
  }

  return { safe, proven: replies.complete, simulations };
}

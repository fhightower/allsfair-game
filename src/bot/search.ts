// Choosing a round's plan.
//
// Three layers, strongest first:
//
//   1. Proof. A forced win is played outright; plans with a refutation are
//      discarded. Neither step approximates anything (see exact.ts).
//   2. Equilibrium. What survives is a matrix game — both sides commit blind —
//      solved by double oracle: a small support is solved exactly, then each
//      side's best response over the whole candidate pool is invited in, until
//      neither side can improve. That yields an equilibrium of the full pool
//      while only ever solving a small matrix.
//   3. Lookahead. The support is re-scored with several rounds of search before
//      the final mix is taken, so plans are judged by where they lead.
//
// The chosen plan is *sampled* from the equilibrium mixture. Playing the single
// highest-value plan every time would be exploitable: in a simultaneous-move
// game a predictable opponent can be answered, and mixing is what removes that.
import type { BoardState } from "../engine";
import {
  resolvePair,
  resolveRound,
  winnerOfState,
  type Plan,
} from "./simulate";
import {
  candidateMoves,
  dedupePlansByOutcome,
  enumeratePlans,
  passFor,
} from "./plans";
import { evaluate, WIN_SCORE } from "./eval";
import { filterRefutedPlans, findForcedWin } from "./exact";
import { solveMatrix } from "./nash";
import { sampleIndex, systemRng, type Rng } from "./rng";

export interface SearchOptions {
  /** Rounds of lookahead. 1 evaluates the position after this round. */
  depth?: number;
  rng?: Rng;
  /** Deterministic ceiling on approximate search work. */
  maxSimulations?: number;
  /** Separate ceiling for the proofs, which are worth more per simulation. */
  exactSimulations?: number;
  /** Plans kept in the equilibrium support. */
  candidateLimit?: number;
  rootSolverIterations?: number;
  innerSolverIterations?: number;
  /** Plans explored per side at a lookahead node. */
  innerWidth?: number;
  /** Best-response rounds the double oracle may run. */
  oracleRounds?: number;
  /** Plans the best-response oracle may scan. */
  oraclePoolLimit?: number;
  /** Plans put through the refutation proof. Only these can be played. */
  refutationScanLimit?: number;
  useExactLayer?: boolean;
}

export interface SearchResult {
  plan: Plan;
  value: number;
  forcedWin: boolean;
  strategy: { plan: Plan; probability: number }[];
  simulations: number;
  depth: number;
}

const DEFAULTS = {
  depth: 1,
  maxSimulations: 120_000,
  exactSimulations: 150_000,
  candidateLimit: 20,
  rootSolverIterations: 600,
  innerSolverIterations: 60,
  innerWidth: 5,
  oracleRounds: 5,
  oraclePoolLimit: 300,
  refutationScanLimit: 220,
  useExactLayer: true,
};

/** Guards against a pathological position making enumeration unbounded. */
const POOL_LIMIT = 20_000;

const other = (team: number): number => (team === 1 ? 2 : 1);

interface Context {
  simulations: number;
  limit: number;
  innerWidth: number;
  innerIterations: number;
}

function passivePlan(team: number): Plan {
  const pass = passFor(team);
  return [pass, pass, pass];
}

/** Resolves a round with `team`'s plan on the correct side of the pair. */
function play(state: BoardState, team: number, mine: Plan, theirs: Plan) {
  return team === 1
    ? resolveRound(state, mine, theirs)
    : resolveRound(state, theirs, mine);
}

/**
 * `team`'s payoff for one cell of the matrix, looking `depth` rounds ahead.
 * A decided game short-circuits: nothing after a win needs evaluating.
 */
function payoff(
  state: BoardState,
  team: number,
  mine: Plan,
  theirs: Plan,
  depth: number,
  ctx: Context
): number {
  ctx.simulations++;
  const result = play(state, team, mine, theirs);
  if (result.winner !== 0) {
    return result.winner === team ? WIN_SCORE : -WIN_SCORE;
  }
  if (depth <= 1) return evaluate(result.state, team);
  return roundValue(result.state, team, depth - 1, ctx);
}

/**
 * A narrow beam of plans, for lookahead nodes where full enumeration would be
 * far too expensive. Each of the three moves is extended greedily and only the
 * best partial plans survive to the next step.
 */
function beamPlans(
  state: BoardState,
  team: number,
  width: number,
  ctx: Context
): Plan[] {
  const opponentPass = passFor(other(team));
  const step = (from: BoardState, move: string): BoardState =>
    team === 1
      ? resolvePair(from, move, opponentPass)
      : resolvePair(from, opponentPass, move);

  let beam: { moves: string[]; state: BoardState }[] = [{ moves: [], state }];
  for (let depth = 0; depth < 3; depth++) {
    const next: { moves: string[]; state: BoardState; score: number }[] = [];
    for (const node of beam) {
      for (const move of candidateMoves(node.state, team)) {
        ctx.simulations++;
        const after = step(node.state, move);
        next.push({
          moves: [...node.moves, move],
          state: after,
          score: evaluate(after, team),
        });
      }
    }
    if (next.length === 0) break;
    next.sort((x, y) => y.score - x.score);
    beam = next.slice(0, width);
  }
  return beam.map((node) => node.moves as Plan);
}

/** The value of the position to `team`, as the value of the round's matrix game. */
function roundValue(
  state: BoardState,
  team: number,
  depth: number,
  ctx: Context
): number {
  if (winnerOfState(state) !== 0) return evaluate(state, team);
  // Out of budget: fall back on the static score rather than searching on.
  if (ctx.simulations >= ctx.limit) return evaluate(state, team);

  const mine = beamPlans(state, team, ctx.innerWidth, ctx);
  const theirs = beamPlans(state, other(team), ctx.innerWidth, ctx);
  if (mine.length === 0 || theirs.length === 0) return evaluate(state, team);

  const matrix = mine.map((m) =>
    theirs.map((t) => payoff(state, team, m, t, depth, ctx))
  );
  return solveMatrix(matrix, ctx.innerIterations).value;
}

/** Ranks plans by how they look against a passive opponent. */
function rankByStaticScore(
  state: BoardState,
  team: number,
  plans: Plan[],
  ctx: Context
): Plan[] {
  const passive = passivePlan(other(team));
  const scored = plans.map((plan) => {
    ctx.simulations++;
    const result = play(state, team, plan, passive);
    const score =
      result.winner !== 0
        ? result.winner === team
          ? WIN_SCORE
          : -WIN_SCORE
        : evaluate(result.state, team);
    return { plan, score };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.map((entry) => entry.plan);
}

/** The plan from `pool` that does best against a mixture of opponent plans. */
function bestResponse(
  state: BoardState,
  team: number,
  pool: Plan[],
  opponentSupport: Plan[],
  opponentMix: number[],
  ctx: Context
): { plan: Plan; value: number } | null {
  let best: { plan: Plan; value: number } | null = null;
  for (const plan of pool) {
    if (ctx.simulations >= ctx.limit) break;
    let value = 0;
    for (let j = 0; j < opponentSupport.length; j++) {
      if (opponentMix[j] === 0) continue;
      value += opponentMix[j] * payoff(state, team, plan, opponentSupport[j], 1, ctx);
    }
    if (best === null || value > best.value) best = { plan, value };
  }
  return best;
}

export function searchBestPlan(
  state: BoardState,
  team: number,
  options: SearchOptions = {}
): SearchResult {
  const opts = { ...DEFAULTS, ...options };
  const rng = options.rng ?? systemRng;
  const opponent = other(team);
  const ctx: Context = {
    simulations: 0,
    limit: opts.maxSimulations,
    innerWidth: opts.innerWidth,
    innerIterations: opts.innerSolverIterations,
  };

  const fallback = passivePlan(team);

  if (opts.useExactLayer) {
    const forced = findForcedWin(state, team, opts.exactSimulations);
    ctx.simulations += forced.simulations;
    if (forced.plan) {
      return {
        plan: forced.plan,
        value: WIN_SCORE,
        forcedWin: true,
        strategy: [{ plan: forced.plan, probability: 1 }],
        simulations: ctx.simulations,
        depth: opts.depth,
      };
    }
  }

  // Enumerate, collapse plans that reach the same position, then rank. Ranking
  // first and proving second matters: the proof is the expensive step, so it is
  // spent on the plans actually in contention.
  const myPool = dedupePlansByOutcome(
    state,
    team,
    enumeratePlans(state, team, candidateMoves, POOL_LIMIT)
  );
  const theirPool = dedupePlansByOutcome(
    state,
    opponent,
    enumeratePlans(state, opponent, candidateMoves, POOL_LIMIT)
  );

  let ranked =
    myPool.length > 0 ? rankByStaticScore(state, team, myPool, ctx) : [fallback];
  const theirRanked =
    theirPool.length > 0
      ? rankByStaticScore(state, opponent, theirPool, ctx)
      : [passivePlan(opponent)];

  if (opts.useExactLayer) {
    // Only plans proven free of a refutation may be played. If none of the
    // scanned plans survives, the position is lost however it is played and
    // refusing to move gains nothing.
    const scanned = ranked.slice(0, opts.refutationScanLimit);
    const filtered = filterRefutedPlans(
      state,
      team,
      scanned,
      opts.exactSimulations
    );
    ctx.simulations += filtered.simulations;
    if (filtered.safe.length > 0) ranked = filtered.safe;
  }

  const oraclePool = ranked.slice(0, opts.oraclePoolLimit);
  let mySupport = ranked.slice(0, opts.candidateLimit);
  let theirSupport = theirRanked.slice(0, opts.candidateLimit);

  // Double oracle always runs at depth 1, whatever `depth` asks for: cells are
  // cheap there, which is what lets the best-response oracle scan a pool of
  // thousands. Only the support it settles on is re-scored with lookahead, and
  // only when lookahead was requested.
  let solution = solveMatrix(
    mySupport.map((m) => theirSupport.map((t) => payoff(state, team, m, t, 1, ctx))),
    opts.rootSolverIterations
  );

  for (let round = 0; round < opts.oracleRounds; round++) {
    if (ctx.simulations >= ctx.limit) break;
    let grew = false;

    const mine = bestResponse(
      state,
      team,
      oraclePool,
      theirSupport,
      solution.colStrategy,
      ctx
    );

    // Compute both responses before expanding either support so the plans and
    // probabilities still describe the same equilibrium.
    // The opponent's best response is the plan that minimises our payoff, which
    // is their best response in their own (negated) game.
    const theirs = bestResponse(
      state,
      opponent,
      theirRanked.slice(0, opts.oraclePoolLimit),
      mySupport,
      solution.rowStrategy,
      ctx
    );
    if (mine && mine.value > solution.value + 1e-6) {
      const key = mine.plan.join(",");
      if (!mySupport.some((p) => p.join(",") === key)) {
        mySupport = [...mySupport, mine.plan];
        grew = true;
      }
    }

    if (theirs && -theirs.value < solution.value - 1e-6) {
      const key = theirs.plan.join(",");
      if (!theirSupport.some((p) => p.join(",") === key)) {
        theirSupport = [...theirSupport, theirs.plan];
        grew = true;
      }
    }

    if (!grew) break;
    solution = solveMatrix(
      mySupport.map((m) =>
        theirSupport.map((t) => payoff(state, team, m, t, 1, ctx))
      ),
      opts.rootSolverIterations
    );
  }

  if (opts.depth > 1) {
    solution = solveMatrix(
      mySupport.map((m) =>
        theirSupport.map((t) => payoff(state, team, m, t, opts.depth, ctx))
      ),
      opts.rootSolverIterations
    );
  }

  const chosen = sampleIndex(solution.rowStrategy, rng);
  return {
    plan: mySupport[chosen] ?? fallback,
    value: solution.value,
    forcedWin: false,
    strategy: mySupport.map((plan, i) => ({
      plan,
      probability: solution.rowStrategy[i] ?? 0,
    })),
    simulations: ctx.simulations,
    depth: opts.depth,
  };
}

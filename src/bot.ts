// Trio-level candidate-search bot. Started as a port of a Python prototype
// (scripts/search_bot_eval.py in the archived allsfair-python repo, measured
// 76% wins vs heuristic and 94% vs the old hybrid Q-bot) but is now the only
// implementation: this bot breaks score ties on the real move string rather
// than the mirrored action key, and its RNG stream differs, so it never
// matched the prototype move-for-move.
//
// Weights and search parameters below are inherited from those measurements.
// test/bot.strength.test.ts is the authority on how strong this bot actually
// is (>=60% vs heuristic, >=90% vs random over 50 games) — re-run it after any
// change here. To tune rather than just gate, build a W/L/D sweep on top of
// its playGame helper; there is no external eval harness anymore.
import { Board, Move, MovePair, TEAM_1, TEAM_2 } from "./engine";
import { choice, makeRng } from "./rng";

export const N_CANDIDATES = 64;
export const K_OPPONENT = 16;
// Second, wider sampling width for candidate generation (see planTrio).
export const WIDE_TOP_N = 8;
export const MIN_WEIGHT = 0.25;
export const MAX_TROOPS_PER_ACTION = 8;
const MOVES_PER_ROUND = 3;

// How hard the action scorer pulls toward home defense. Multiplies the home
// deficit (threat the garrison cannot absorb), so it is inert on a quiet board
// and only outweighs the ~1.65 of a routine advance once a real threat exists.
export const DEFEND_WEIGHT = 0.9;
// A hold is a wasted move on a quiet board; this keeps it out of the sampling
// pool until the deficit term above carries it.
export const HOLD_BASE = -0.1;
// Value of one square of restock income. Each owned square pays one troop per
// round for the rest of the game, so it is worth several rounds of material
// (weighted 3 per troop) — not the 0 the evaluation used to give an empty
// square it owned.
export const INCOME_WEIGHT = 4;

export const PASS_MOVE: Record<number, string> = { 1: "a0b", 2: "i0h" };
export const HOME_SQUARE: Record<number, string> = { 1: "a", 2: "i" };

// BFS distances to the ENEMY home on the fixed 9-node board
// (test/bot.test.ts asserts these equal a BFS over startingBoardState()).
export const DIST_TO_ENEMY_HOME: Record<number, Record<string, number>> = {
  1: { a: 4, b: 3, c: 2, d: 3, e: 2, f: 1, g: 2, h: 1, i: 0 },
  2: { a: 0, b: 1, c: 2, d: 1, e: 2, f: 3, g: 2, h: 3, i: 4 },
};

export interface CandidateAction {
  start: string;
  troops: number;
  end: string;
}

function toMoveString(a: CandidateAction): string {
  return `${a.start}${a.troops}${a.end}`;
}

export function legalActions(board: Board, player: number): CandidateAction[] {
  const actions: CandidateAction[] = [];
  for (const start of board.populatedSquaresOwned(player)) {
    const node = board.state[start];
    const troopOptions: number[] = [];
    const capped = Math.min(node.troopCount, MAX_TROOPS_PER_ACTION);
    for (let t = 1; t <= capped; t++) troopOptions.push(t);
    if (node.troopCount > MAX_TROOPS_PER_ACTION) {
      troopOptions.push(node.troopCount);
    }
    for (const end of node.neighbors) {
      for (const troops of troopOptions) {
        actions.push({ start, troops, end });
      }
    }
  }
  return actions;
}

// Weight per square of distance from our home. The board is 4 squares across
// and a round is 3 moves, so a stack 3 away can reach home before the bot gets
// to plan again — the old distance-2 horizon simply could not see the stack
// that killed it.
const THREAT_BY_DISTANCE: Record<number, number> = {
  0: 2,
  1: 1,
  2: 0.6,
  3: 0.3,
};

/**
 * Enemy pressure on `player`'s home: opposing troops close enough to reach it
 * within one round, weighted by how soon they arrive. Troops already standing
 * on the home count double — the square is lost and has to be taken back.
 */
export function homeThreat(board: Board, player: number): number {
  const opponent = player === 1 ? TEAM_2 : TEAM_1;
  // The opponent's distance-to-enemy-home IS their distance to our home.
  const distToOurHome = DIST_TO_ENEMY_HOME[opponent];
  let threat = 0;
  for (const [name, node] of Object.entries(board.state)) {
    if (node.owner !== opponent || node.troopCount <= 0) continue;
    const weight = THREAT_BY_DISTANCE[distToOurHome[name]];
    if (weight) threat += node.troopCount * weight;
  }
  return threat;
}

/** Threat the home garrison cannot absorb. 0 on a quiet board. */
export function homeDeficit(board: Board, player: number): number {
  const home = board.state[HOME_SQUARE[player]];
  const garrison = home.owner === player ? home.troopCount : 0;
  return Math.max(0, homeThreat(board, player) - garrison);
}

/** The no-op move, as a candidate action so a trio slot can decline to move. */
export function holdAction(player: number): CandidateAction {
  const pass = PASS_MOVE[player];
  return { start: pass[0], troops: 0, end: pass[2] };
}

export function scoredActions(
  board: Board,
  player: number
): { score: number; action: CandidateAction }[] {
  const opponent = player === 1 ? TEAM_2 : TEAM_1;
  const dist = DIST_TO_ENEMY_HOME[player];
  const enemyHome = player === 1 ? "i" : "a";
  const home = HOME_SQUARE[player];
  const deficit = homeDeficit(board, player);

  const scored = legalActions(board, player).map((action) => {
    const destination = board.state[action.end];
    let score = (dist[action.start] - dist[action.end]) * 1.2;
    score += action.troops * 0.08;
    if (destination.owner === opponent) {
      score += Math.min(action.troops, destination.troopCount) * 0.6;
      if (action.troops >= destination.troopCount) score += 1.0;
    } else if (destination.owner === 0) {
      score += 0.45;
    }
    if (action.end === enemyHome) score += 1.5;
    // Defense. Both terms are scaled by the deficit, so a bot that is not
    // under threat scores exactly as it did before these were added.
    if (deficit > 0) {
      if (action.start === home) {
        score -= Math.min(action.troops, deficit) * DEFEND_WEIGHT;
      }
      if (action.end === home) {
        score += Math.min(action.troops, deficit) * DEFEND_WEIGHT;
      }
    }
    return { score, action };
  });

  // Holding is what lets the bot bank restock troops instead of bleeding its
  // garrison into the middle every round. Without it every slot in the trio
  // must push troops somewhere.
  scored.push({
    score: HOLD_BASE + deficit * DEFEND_WEIGHT * 0.6,
    action: holdAction(player),
  });

  scored.sort(
    (x, y) =>
      y.score - x.score ||
      (toMoveString(x.action) < toMoveString(y.action) ? -1 : 1)
  );
  return scored;
}

/** Heuristic trio; topN > 1 samples each slot from the top-n actions. */
export function sampleTrio(
  board: Board,
  player: number,
  rand: () => number,
  topN: number
): string[] {
  const plan = board.clone();
  const moves: string[] = [];
  for (let i = 0; i < MOVES_PER_ROUND; i++) {
    const scored = scoredActions(plan, player);
    if (scored.length === 0) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    const pool = scored.slice(0, Math.min(topN, scored.length));
    const { action } = choice(pool, rand);
    const moveString = toMoveString(action);
    plan.applyPlannedMove(new Move(moveString), player);
    moves.push(moveString);
  }
  return moves;
}

/**
 * Deterministic beeline: each move, send the biggest stack one square closer to
 * the enemy home. The heuristic sampler never produces this — it spreads troops
 * — so without it in the opponent model the bot never has to answer the one
 * plan that actually kills it: a single stack marching on its home.
 */
export function rushTrio(board: Board, player: number): string[] {
  const dist = DIST_TO_ENEMY_HOME[player];
  const plan = board.clone();
  const moves: string[] = [];
  for (let i = 0; i < MOVES_PER_ROUND; i++) {
    const owned = plan.populatedSquaresOwned(player);
    if (owned.length === 0) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    let from = owned[0];
    for (const square of owned) {
      const better =
        plan.state[square].troopCount > plan.state[from].troopCount ||
        (plan.state[square].troopCount === plan.state[from].troopCount &&
          dist[square] < dist[from]);
      if (better) from = square;
    }
    let to = plan.state[from].neighbors[0];
    for (const neighbor of plan.state[from].neighbors) {
      if (dist[neighbor] < dist[to]) to = neighbor;
    }
    const moveString = `${from}${plan.state[from].troopCount}${to}`;
    plan.applyPlannedMove(new Move(moveString), player);
    moves.push(moveString);
  }
  return moves;
}

export function evaluate(board: Board, me: number): number {
  const them = me === 1 ? TEAM_2 : TEAM_1;
  const winner = board.winner;
  if (winner === me) return 1_000_000;
  if (winner === them) return -1_000_000;

  const myHome = me === 1 ? "a" : "i";
  const theirHome = them === 1 ? "a" : "i";
  const myDist = DIST_TO_ENEMY_HOME[me];
  const theirDist = DIST_TO_ENEMY_HOME[them];

  let material = 0;
  let squares = 0;
  let progress = 0;
  let ownedSquares = 0;
  let theirOwnedSquares = 0;

  for (const [name, node] of Object.entries(board.state)) {
    if (node.owner === me) {
      // Ownership is sticky: a square keeps its owner after the troops leave,
      // and restock pays per square owned, empty or not. That income is the
      // whole economy of the game, so it is counted separately from the
      // populated-square term below.
      ownedSquares += 1;
      if (node.troopCount > 0) {
        material += node.troopCount;
        squares += 1;
        progress += node.troopCount * (4 - myDist[name]);
      }
    } else if (node.owner === them) {
      theirOwnedSquares += 1;
      if (node.troopCount > 0) {
        material -= node.troopCount;
        squares -= 1;
        progress -= node.troopCount * (4 - theirDist[name]);
      }
    }
  }

  const myHomeNode = board.state[myHome];
  const theirHomeNode = board.state[theirHome];
  const garrison = myHomeNode.owner === me ? myHomeNode.troopCount : 0;
  // One definition of threat, shared with the action scorer, so the search and
  // the candidate generator cannot disagree about what counts as danger.
  let threat = homeThreat(board, me) * 2;
  if (myHomeNode.owner === them) threat += 50;
  const exposed = Math.max(0, threat * 2 - garrison);
  const captureProgress = theirHomeNode.owner === me ? 6 : 0;
  // Restock only pays out to a home you still hold.
  const income =
    (myHomeNode.owner === me ? ownedSquares : 0) -
    (theirHomeNode.owner === them ? theirOwnedSquares : 0);

  return (
    material * 3 +
    squares * 2 +
    progress * 0.6 -
    exposed * 1.5 +
    captureProgress +
    income * INCOME_WEIGHT
  );
}

function simulateRound(
  board: Board,
  myTrio: string[],
  oppTrio: string[],
  me: number
): number {
  const sim = board.clone();
  for (let i = 0; i < MOVES_PER_ROUND; i++) {
    const [p1, p2] =
      me === 1 ? [myTrio[i], oppTrio[i]] : [oppTrio[i], myTrio[i]];
    sim.applyMovePair(new MovePair(new Move(p1), new Move(p2)));
    if (sim.winner) break;
  }
  sim.restock();
  return evaluate(sim, me);
}

export function planTrio(
  board: Board,
  me: number,
  rand: () => number
): string[] {
  const them = me === 1 ? TEAM_2 : TEAM_1;

  // Diversity matters more than count here: every trio drawn from the top of
  // the same greedy scorer gives the search a pool of near-identical plans, and
  // then no evaluation weight can change the answer. Mix the greedy argmax, two
  // widths of sampling, and the deterministic rush.
  const candidates: string[][] = [
    sampleTrio(board, me, rand, 1),
    rushTrio(board, me),
  ];
  for (let i = candidates.length; i < N_CANDIDATES; i++) {
    candidates.push(sampleTrio(board, me, rand, i % 2 === 0 ? 3 : WIDE_TOP_N));
  }
  const seen = new Set<string>();
  const unique = candidates.filter((trio) => {
    const key = trio.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const oppTrios: string[][] = [
    sampleTrio(board, them, rand, 1),
    rushTrio(board, them),
  ];
  for (let i = oppTrios.length; i < K_OPPONENT; i++) {
    oppTrios.push(sampleTrio(board, them, rand, 3));
  }

  let best = unique[0];
  let bestScore = -Infinity;
  for (const trio of unique) {
    const outcomes = oppTrios.map((opp) => simulateRound(board, trio, opp, me));
    const mean = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
    const score = MIN_WEIGHT * Math.min(...outcomes) + (1 - MIN_WEIGHT) * mean;
    if (score > bestScore) {
      bestScore = score;
      best = trio;
    }
  }
  return best;
}

/** Entry point: plan player 2's trio for the given round, deterministically. */
export function planBotTrio(
  board: Board,
  gameGuid: string,
  completedRounds: number
): string[] {
  const rand = makeRng(`${gameGuid}:${completedRounds}`);
  return planTrio(board, 2, rand);
}

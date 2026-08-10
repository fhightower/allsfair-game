// Trio-level candidate-search bot. Started as a port of a Python prototype
// (scripts/search_bot_eval.py in the archived allsfair-python repo, measured
// 76% wins vs heuristic and 94% vs the old hybrid Q-bot) but is now the only
// implementation: this bot breaks score ties on the real move string rather
// than the mirrored action key, and its RNG stream differs, so it never
// matched the prototype move-for-move.
//
// The search parameters below are no longer the prototype's: they were swept
// against a frozen copy of that bot (test/eval/bot-baseline.ts). The 87%-over-
// 300-games figure that used to sit here belonged to the argmax generation
// (now frozen at test/eval/bot-argmax.ts); this bot measures 59% against that
// same baseline, deliberately — see ADVERSARIAL_WEIGHT. The action-scorer
// weights ARE still the prototype's — see the note above them.
//
// WHY THIS IS A GAME SOLVER AND NOT AN ARGMAX. Every bot before this one picked
// the single best trio against a fixed guess at the opponent. That is a pure
// strategy in a simultaneous-move game, and pure strategies are maximally
// exploitable: against `makeExploiter` in test/eval/harness.ts — an opponent
// that samples the bot's policy and best-responds to it — the argmax bot wins
// 4% of games. It was not a compute gap. An identical exploiter whose guesses
// come from the greedy heuristic instead of from the bot's own policy *loses*
// 66-34, so the entire effect is that the bot was predictable. A human who has
// played a few games is approximating that exploiter, which is why the bot was
// easy to beat in a way no scripted opponent in test/eval/ could show — they
// are all pinned at 99-100% and cannot see this at all.
//
// Tie-break noise does not fix it (sampling from the top 3 trios reaches 18%
// and costs 58-42 in strength), and neither does a better opponent guess:
// seeding the opponent model with trios from a *searcher* rather than the
// heuristic was worth 68% head-to-head and moved exploitability not at all.
// That bot is frozen at test/eval/bot-argmax.ts as the control for this change.
//
// So the round is solved as the matrix game it actually is — see planTrio.
//
// test/bot.strength.test.ts gates strength; test/eval/ is the harness for
// measuring it. Re-run both after any change here:
//
//   BOT_SWEEP=1 npx vitest run test/eval/sweep.test.ts --reporter=verbose --silent=false
import { Board, Move, MovePair, TEAM_1, TEAM_2 } from "./engine";
import { choice, makeRng } from "./rng";

// Trios each side starts the double oracle holding. These are the *model*: the
// greedy argmax, the rush, and heuristic samples — what an opponent who is not
// specifically countering this bot would play. The oracle appends counters to
// them; see planTrio.
export const SEED_TRIOS = 12;
// Trios each best-response oracle searches over. Bigger buys raw strength and
// nothing else: at 60 the bot still scores 46% against its exploiter but drops
// from 46% to 33% head-to-head.
export const POOL_TRIOS = 120;
// Best-response rounds. The loop also stops early when neither side finds a
// counter it does not already hold.
export const ORACLE_ROUNDS = 4;
// Opponent mixture entries an oracle best-responds against, heaviest first.
export const SUPPORT_CAP = 8;
export const SOLVER_ITERS = 400;
// Second, wider sampling width for trio generation.
export const WIDE_TOP_N = 8;

// One trio in this many is a `denialTrio` — an attack on whatever the opponent
// has troops on, rather than a push at their home. Both the seed model and the
// oracle pools get them; see denialTrio for why both, and why this number is
// touchy. Measured against a denial-capable exploiter / the greedy heuristic.
// NOTE: that exploiter is a live-scorer variant, not `makeDenialExploiter` in
// test/eval/harness.ts, which is pinned to the frozen baseline scorer and is a
// weaker opponent (it reads 60% where this column reads 38%). Reproducing this
// table means swapping the harness exploiter's generators for the live ones.
//
//   cadence         denial exploiter   heuristic
//   none                  25%             86%
//   every 6               25%              —
//   every 4               38%             78%
//   every 2               13%              —
//   pools only, every 4   13%              —
//   seeds only, every 4   38%             58%
//
// Non-monotonic in both directions, so do not "round it up" — every 2 saturates
// the model, every 6 is indistinguishable from having none.
export const DENIAL_EVERY = 4;

// How adversarial the opponent is assumed to be. The opponent plays the seed
// model with probability 1 - ADVERSARIAL_WEIGHT and plays a counter to this bot
// with probability ADVERSARIAL_WEIGHT, and the bot solves against that mixture.
//
// 1.0 is a pure Nash equilibrium: unexploitable, but it also refuses to *punish*
// anyone, which costs more than it is worth. Measured across the pool, 24 games
// a cell (so roughly +/-9 points of noise on each):
//
//   q     heuristic  baseline  human(6,2)  vs argmax bot  exploiter
//   1.0      58%       58%        67%          38%          44%
//   0.7      75%       58%        75%          29%          69%
//   0.5      83%       75%        83%          33%          38%
//   0.3      88%       67%        92%          42%          19%
//   argmax   99%       88%       100%           —            4%
//
// This was 0.5 for a generation, picked as the knee of the scripted columns.
// The production record says those columns were the wrong thing to read: the bot
// won 4 of the 17 decided games it played against real people while that pool
// showed it at 75-100%. The humans beat it the way the exploiters do rather than
// the way the scripted opponents do — 13 of the 17 opened with the identical
// trio `a3b b3e e3f`, and they win by baiting a habit, not by out-searching
// anything. On the real position 0deb12a4 r3 the bot answered `i4f` in 30 of 30
// seeds, emptying its home onto a square the human vacates that same move. Only
// the exploiter columns can see any of that; see test/bot.positions.test.ts.
//
// Re-measured 0.5 against 0.7 at 60 games a cell (80 for the head-to-heads),
// against exploiters built on the *live* bot, which are stronger than the
// frozen-scorer ones in the table above:
//
//   q     exploiter  denial-expl  WORSE  heuristic  human(6,2)  baseline  argmax
//   0.5      35%         60%       35%      78%        80%        63%      40%
//   0.7      47%         47%       47%      75%        77%        59%      48%
//
// 0.7 is what ships. The two exploit axes matter more than their average and the
// worse of them is the bot's real exposure, so trading a lopsided 35/60 for a
// balanced 47/47 is worth the three points off the scripted columns and the four
// off the head-to-head — all of which sit inside their own error bars, while the
// exploiter move does not. It also gains 8 points head-to-head against the
// frozen argmax bot, which is the most exploitable opponent in the pool.
//
// 0.85 was measured too and is worse on every column (46/63 exploiters, 63/70
// scripted, at 24 games a cell). This knob is not monotonic — the 1.0 row above
// already showed that — so do not extrapolate it in either direction without
// re-measuring.
export const ADVERSARIAL_WEIGHT = 0.7;
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

// Action-scorer weights. These drive candidate *generation*, not the final
// choice — the search picks between whole trios, and with a candidate pool this
// wide it filters whatever the scorer produces.
//
// Every one of them was swept individually against a frozen copy of the
// pre-tuning bot and they are all flat: advance 0.8/1.6/2.4 scores 87/88/87%,
// capture 0.2/1.5 scores 85/86%, enemy-home 0/4.0 scores 84/86%. Even removing
// the enemy-home bonus entirely costs 4 points. Treat them as "roughly sane"
// rather than tuned, and do not spend a day re-deriving them.
export const ADVANCE_WEIGHT = 1.2;
export const TROOPS_WEIGHT = 0.08;
export const CAPTURE_WEIGHT = 0.6;
export const OVERWHELM_BONUS = 1.0;
export const CLAIM_BONUS = 0.45;
export const ENEMY_HOME_BONUS = 1.5;

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
    let score = (dist[action.start] - dist[action.end]) * ADVANCE_WEIGHT;
    score += action.troops * TROOPS_WEIGHT;
    if (destination.owner === opponent) {
      score += Math.min(action.troops, destination.troopCount) * CAPTURE_WEIGHT;
      if (action.troops >= destination.troopCount) score += OVERWHELM_BONUS;
    } else if (destination.owner === 0) {
      score += CLAIM_BONUS;
    }
    if (action.end === enemyHome) score += ENEMY_HOME_BONUS;
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
    // Never empty: scoredActions always appends the hold action.
    const scored = scoredActions(plan, player);
    const pool = scored.slice(0, Math.min(topN, scored.length));
    const { action } = choice(pool, rand);
    const moveString = toMoveString(action);
    plan.applyPlannedMove(new Move(moveString), player);
    moves.push(moveString);
  }
  return moves;
}

/**
 * One step of the beeline: send `player`'s biggest stack a square closer to
 * `dist`'s target, breaking ties toward the stack that is already nearer.
 * Returns null when the player has nothing to move.
 */
function beelineMove(
  plan: Board,
  player: number,
  dist: Record<string, number>
): string | null {
  const owned = plan.populatedSquaresOwned(player);
  if (owned.length === 0) return null;
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
  return `${from}${plan.state[from].troopCount}${to}`;
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
    const moveString = beelineMove(plan, player, dist);
    if (moveString === null) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    plan.applyPlannedMove(new Move(moveString), player);
    moves.push(moveString);
  }
  return moves;
}

/**
 * The long way in: step a stack adjacent to the enemy home *off* that square,
 * then come at the home from the other side.
 *
 * This is the plan that beats this bot, found by a human twice in one game and
 * visible all over the production log. Against a stack sitting next to its home
 * the bot's best-scoring reply is to empty the garrison onto it — `i4f` at 4.32
 * on a board where `f` held 3 and `i` held 4. Both moves resolve at once, so if
 * the stack has already left, that attack captures an empty square and the home
 * is left on zero with two moves still to play. The stack walks back in via the
 * *other* neighbour of the home and takes it:
 *
 *   f3e e3h h3i     and, mirrored,     h2e e2f f2i
 *
 * No generator here can express it. `rushTrio` takes the short path and enters
 * the home immediately; `scoredActions` pays ADVANCE_WEIGHT for closing distance,
 * so the first move of this line — stepping *away* from the home — is scored as
 * a retreat and never sampled. The oracle can only best-respond with a trio some
 * generator emitted, which is why widening the search never found the answer.
 *
 * It goes to both sides. In the opponent model so the bot stops believing its
 * garrison can safely leave home to take a square (`denialTrio` is in the model
 * for the same reason and measured *worse than nothing* when it was left out of
 * one side), and in the bot's own pool so it can play the line too.
 *
 * Ties go to the neighbour with the most exits — the middle of a 9-square board
 * is what keeps both approaches open, and committing to a corner hands the
 * defender the guess back.
 *
 * What it is worth, on the four recorded positions where a human ran this line,
 * 40 seeds each — "held" is the bot still owning its home at the end of the
 * round, "emptied" is it shipping the whole garrison out on the first move:
 *
 *   position            held before   held after   emptied before   after
 *   live game r1            0/40         39/40         37/40         1/40
 *   live game r3           12/40         14/40         16/40        12/40
 *   D1 0deb12a4 r3          0/40         37/40         37/40         4/40
 *   D1 9b7aac1c r1          0/40         40/40         39/40         2/40
 *
 * And across the pool, 60 games a cell, against the build before it:
 *
 *   column              before   after
 *   exploiter             47%     43%
 *   denial-exploiter      47%     53%
 *   heuristic             75%     93%
 *   human(6,2)            77%     97%
 *   pre-tuning bot        59%     85%
 *   real positions        62%     74%
 *
 * Note which way that reads. Four earlier attempts at this file bought scripted
 * strength and paid for it against the two opponents that adapt — the fan-out
 * generator went +18/+15 scripted and -21/-34 adaptive, and was reverted. This
 * one leaves both adaptive columns where they were, inside their own error bars
 * and moving in opposite directions, because it is not making the bot greedier.
 * It is filling a hole in the model: the plan existed, both sides can now see it,
 * and the equilibrium accounts for it.
 */
export function flankTrio(board: Board, player: number): string[] {
  const dist = DIST_TO_ENEMY_HOME[player];
  const enemyHome = player === 1 ? "i" : "a";
  const plan = board.clone();
  const moves: string[] = [];
  // Where the walking stack stands, and the square it just left — the second is
  // what it must not step back onto.
  let carrying: string | null = null;
  let previous: string | null = null;

  for (let i = 0; i < MOVES_PER_ROUND; i++) {
    const owned = plan.populatedSquaresOwned(player);
    if (owned.length === 0) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    // Keep walking the stack this trio picked up; before it has moved, take the
    // biggest one that can still reach the home inside the round.
    let from: string;
    if (carrying !== null && owned.includes(carrying)) {
      from = carrying;
    } else {
      const reachable = owned.filter((s) => dist[s] <= MOVES_PER_ROUND - i);
      const pool: string[] = reachable.length > 0 ? reachable : owned;
      from = pool[0];
      for (const square of pool) {
        const better =
          plan.state[square].troopCount > plan.state[from].troopCount ||
          (plan.state[square].troopCount === plan.state[from].troopCount &&
            dist[square] < dist[from]);
        if (better) from = square;
      }
      previous = null;
    }

    const neighbors: string[] = plan.state[from].neighbors;
    // Only decline the home on the opening move, and only when a detour still
    // arrives: stepping aside spends one of the three moves.
    const detour =
      i === 0 &&
      neighbors.includes(enemyHome) &&
      neighbors.some(
        (n) => n !== enemyHome && dist[n] <= MOVES_PER_ROUND - 1
      );
    const options = neighbors.filter(
      (n) => n !== previous && (!detour || n !== enemyHome)
    );
    const usable: string[] = options.length > 0 ? options : neighbors;

    let to: string = usable[0];
    for (const n of usable) {
      const closer = dist[n] < dist[to];
      const tied = dist[n] === dist[to];
      // More exits is a better staging square: it leaves both approaches live.
      const roomier =
        plan.state[n].neighbors.length > plan.state[to].neighbors.length;
      if (closer || (tied && roomier)) to = n;
    }

    const moveString = `${from}${plan.state[from].troopCount}${to}`;
    plan.applyPlannedMove(new Move(moveString), player);
    moves.push(moveString);
    previous = from;
    carrying = to;
  }
  return moves;
}

/**
 * The beeline pointed the other way: mass troops onto our *own* home and take it
 * back, then carry on at the enemy once it is ours again.
 *
 * Everything else in this file is oriented at the enemy home. `scoredActions`
 * scores a move by the distance it closes on it, so a move toward our own home
 * is scored as a retreat, and `rushTrio` walks the biggest stack the wrong way
 * entirely. While the home stands that is exactly right. Once it falls it leaves
 * the bot with no plan that goes back, and the search cannot pick one that no
 * generator emitted.
 *
 * That only bites because the engine needs *strictly* more troops than the
 * defender to flip a square (see Board.applyMove): a 3-stack bouncing off a home
 * held by 3 leaves it enemy-owned and empty, so retaking generally costs two
 * moves — merge, then storm — and no single-move scorer will ever propose the
 * first of them. Observed in a real game at `aH8 bB1 cB0 dH0 eB3 fB3 g.0 hH0
 * iH3`: `f3i` was the top-scored action at 4.54 and bounced, while `e3f f6i`
 * takes the home and appeared in none of a dozen sampled plans, because `e3f`
 * scores -0.96.
 *
 * Deterministic, like rushTrio, and it collapses to rushTrio whenever the home
 * is already ours — `dedupe` in candidateTrios drops the copy.
 */
export function reclaimTrio(board: Board, player: number): string[] {
  const home = HOME_SQUARE[player];
  const attack = DIST_TO_ENEMY_HOME[player];
  // Our distance to our own home is the opponent's distance to the home they
  // attack, which is the same table read from the other side.
  const retreat = DIST_TO_ENEMY_HOME[player === 1 ? TEAM_2 : TEAM_1];
  const plan = board.clone();
  const moves: string[] = [];

  for (let i = 0; i < MOVES_PER_ROUND; i++) {
    let moveString: string | null = null;

    if (plan.state[home].owner !== player) {
      const garrison = plan.state[home].troopCount;
      const outside = plan
        .populatedSquaresOwned(player)
        .filter((square) => square !== home);
      // Strictly more than the defender, or the square does not change hands.
      const stormable = outside.filter(
        (square) =>
          retreat[square] === 1 && plan.state[square].troopCount > garrison
      );
      if (stormable.length > 0) {
        const from = stormable.reduce((a, b) =>
          plan.state[b].troopCount > plan.state[a].troopCount ? b : a
        );
        moveString = `${from}${plan.state[from].troopCount}${home}`;
      } else {
        // Nothing can take it yet, so consolidate: walk the biggest stack that
        // can still reach home this round one square closer, which merges it
        // with whatever is already waiting there. Ties go to the *farther*
        // stack, since the near one is what it is merging into.
        const movable = outside.filter(
          (square) => retreat[square] <= MOVES_PER_ROUND - i
        );
        if (movable.length > 0) {
          const from = movable.reduce((a, b) => {
            const bigger = plan.state[b].troopCount > plan.state[a].troopCount;
            const tied = plan.state[b].troopCount === plan.state[a].troopCount;
            return bigger || (tied && retreat[b] > retreat[a]) ? b : a;
          });
          let to = plan.state[from].neighbors[0];
          for (const neighbor of plan.state[from].neighbors) {
            if (retreat[neighbor] < retreat[to]) to = neighbor;
          }
          moveString = `${from}${plan.state[from].troopCount}${to}`;
        }
      }
    }

    // Home is ours, or nothing can be sent at it: spend the slot the way
    // rushTrio would.
    if (moveString === null) moveString = beelineMove(plan, player, attack);
    if (moveString === null) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    plan.applyPlannedMove(new Move(moveString), player);
    moves.push(moveString);
  }
  return moves;
}

/**
 * A trio aimed at whatever the opponent has troops on, biggest stack first —
 * their *sources* for the rest of the round, not their home.
 *
 * This exists because a trio is committed for the whole round, so a plan like
 * `a3b, b3e, e3f` dies if the opponent empties `b` on the first pair: the engine
 * clamps the orphaned moves to 0 troops and the bot spends the round playing one
 * move against three. Measured, that was 21% of all third slots. `sampleTrio`
 * plans on an optimistically-advanced clone, so it *prefers* exactly these
 * fragile chains, and no amount of search fixes it — `scoredActions` rewards
 * advancing toward the enemy home, so no generator here could express "hit the
 * square they are about to move from", and the best-response oracle can only
 * choose from what a generator emits.
 *
 * These trios go into BOTH the seed model and the oracle pools, for two separate
 * reasons, and leaving them out of either measured *worse than having none*:
 *   - in the seed model, so the bot believes source-denial is ordinary play and
 *     stops choosing fragile chains (pools-only scored 13%)
 *   - in the oracle pools, so it has a reply available when it believes that
 *     (seeds-only knows the danger, cannot answer it, and goes passive: 58%
 *     against the greedy heuristic, down from 86%)
 */
export function denialTrio(
  board: Board,
  player: number,
  rand: () => number,
  greedy: boolean
): string[] {
  const opponent = player === 1 ? TEAM_2 : TEAM_1;
  const plan = board.clone();
  const moves: string[] = [];
  for (let i = 0; i < MOVES_PER_ROUND; i++) {
    const attacks = legalActions(plan, player).filter((action) => {
      const destination = plan.state[action.end];
      return destination.owner === opponent && destination.troopCount > 0;
    });
    if (attacks.length === 0) {
      moves.push(PASS_MOVE[player]);
      continue;
    }
    const scored = attacks.map((action) => {
      const destination = plan.state[action.end];
      // Emptying the square is what matters, so overwhelming it beats trading
      // into it, and trading beats bouncing off it. Bigger stacks first, and
      // spend as few troops as the job takes.
      const overwhelms =
        action.troops > destination.troopCount
          ? 2
          : action.troops === destination.troopCount
            ? 1
            : 0;
      return {
        action,
        score: overwhelms * 10 + destination.troopCount - action.troops * 0.1,
      };
    });
    scored.sort((x, y) => y.score - x.score);
    // The greedy variant must not touch `rand`: it is the deterministic seed
    // trio, and drawing here would shift the RNG stream for every trio generated
    // after it.
    const { action } = greedy
      ? scored[0]
      : choice(scored.slice(0, Math.min(4, scored.length)), rand);
    const moveString = toMoveString(action);
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

/**
 * Zero-sum payoff to `me` for one round: how much better the end state is for
 * me than it is for them.
 *
 * `evaluate` on its own is not zero-sum — the home-exposure and enemy-home
 * bonuses are one-sided, so both players can score badly at once — and a matrix
 * game only has the equilibrium guarantees this bot relies on if the payoffs
 * sum to zero. Subtracting their evaluation makes it antisymmetric by
 * construction.
 */
/**
 * Memo for `payoff`, valid only within one `planTrio` call — it is keyed on the
 * trio pair alone, so it must be cleared whenever the board changes.
 *
 * The oracles re-score a fixed pool against a support set that grows by at most
 * one entry per round, so the same pairing is simulated many times: measured at
 * 69% of calls on the opening board and 68% mid-game. Caching them is
 * output-identical, not an approximation.
 */
const payoffMemo = new Map<string, number>();

function payoff(
  board: Board,
  myTrio: string[],
  oppTrio: string[],
  me: number
): number {
  const key = `${myTrio[0]},${myTrio[1]},${myTrio[2]}|${oppTrio[0]},${oppTrio[1]},${oppTrio[2]}`;
  const cached = payoffMemo.get(key);
  if (cached !== undefined) return cached;
  const value = computePayoff(board, myTrio, oppTrio, me);
  payoffMemo.set(key, value);
  return value;
}

function computePayoff(
  board: Board,
  myTrio: string[],
  oppTrio: string[],
  me: number
): number {
  const them = me === 1 ? TEAM_2 : TEAM_1;
  const sim = board.clone();
  for (let i = 0; i < MOVES_PER_ROUND; i++) {
    const [p1, p2] =
      me === 1 ? [myTrio[i], oppTrio[i]] : [oppTrio[i], myTrio[i]];
    sim.applyMovePair(new MovePair(new Move(p1), new Move(p2)));
    if (sim.winner) break;
  }
  sim.restock();
  return evaluate(sim, me) - evaluate(sim, them);
}

function dedupe(trios: string[][]): string[][] {
  const seen = new Set<string>();
  return trios.filter((trio) => {
    const key = trio.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Diversity matters more than count here: every trio drawn from the top of the
 * same greedy scorer gives the search a pool of near-identical plans, and then
 * no evaluation weight can change the answer. Mix the greedy argmax, two widths
 * of sampling, the deterministic rush, and source-denial at DENIAL_EVERY.
 */
function candidateTrios(
  board: Board,
  player: number,
  rand: () => number,
  count: number
): string[][] {
  const trios: string[][] = [
    sampleTrio(board, player, rand, 1),
    rushTrio(board, player),
    flankTrio(board, player),
    denialTrio(board, player, rand, true),
  ];
  // Only when there is a home to win back. With the home standing reclaimTrio
  // *is* rushTrio, so adding it unconditionally would buy a duplicate and shift
  // every index below it — moving the DENIAL_EVERY cadence and the RNG stream in
  // every position on the board to fix one the bot only reaches after its home
  // has already fallen.
  if (board.state[HOME_SQUARE[player]].owner !== player) {
    trios.push(reclaimTrio(board, player));
  }
  for (let i = trios.length; i < count; i++) {
    trios.push(
      i % DENIAL_EVERY === 0
        ? denialTrio(board, player, rand, false)
        : sampleTrio(board, player, rand, i % 2 === 0 ? 3 : WIDE_TOP_N)
    );
  }
  return dedupe(trios);
}

function normalise(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  return total > 0
    ? weights.map((w) => w / total)
    : weights.map(() => 1 / weights.length);
}

/** Regret matching's current strategy: positive regret, normalised. */
function fromRegret(regret: number[]): number[] {
  return normalise(regret.map((r) => (r > 0 ? r : 0)));
}

/**
 * Solves the restricted matrix game by regret matching, which converges to a
 * Nash equilibrium because `payoff` is zero-sum.
 *
 * The column player only controls `adversarial` of its own probability mass;
 * the rest sits on `model`, a fixed distribution over how the opponent actually
 * plays. At adversarial = 1 this is a plain equilibrium. Below 1 the bot is
 * solving against "an opponent who is countering me some of the time and
 * playing normally the rest of the time", which is what buys back the ability
 * to punish weak play — see ADVERSARIAL_WEIGHT.
 *
 * Returns my mix and the blended opponent mix the oracles should answer.
 */
export function solve(
  matrix: number[][],
  model: number[],
  adversarial: number,
  iterations: number
): { mine: number[]; theirs: number[] } {
  const rows = matrix.length;
  const columns = matrix[0].length;
  const rowRegret = new Array(rows).fill(0);
  const columnRegret = new Array(columns).fill(0);
  const rowSum = new Array(rows).fill(0);
  const columnSum = new Array(columns).fill(0);

  for (let t = 0; t < iterations; t++) {
    const rowStrategy = fromRegret(rowRegret);
    const columnStrategy = fromRegret(columnRegret);
    const effective = columnStrategy.map(
      (p, j) => adversarial * p + (1 - adversarial) * model[j]
    );
    for (let i = 0; i < rows; i++) rowSum[i] += rowStrategy[i];
    for (let j = 0; j < columns; j++) columnSum[j] += columnStrategy[j];

    const rowUtility = matrix.map((row) =>
      row.reduce((acc, v, j) => acc + v * effective[j], 0)
    );
    const rowValue = rowUtility.reduce((a, v, i) => a + v * rowStrategy[i], 0);
    for (let i = 0; i < rows; i++) rowRegret[i] += rowUtility[i] - rowValue;

    // Zero-sum, so the column player's utility is the negation of mine.
    const columnUtility: number[] = [];
    for (let j = 0; j < columns; j++) {
      let acc = 0;
      for (let i = 0; i < rows; i++) acc -= matrix[i][j] * rowStrategy[i];
      columnUtility.push(acc);
    }
    const columnValue = columnUtility.reduce(
      (a, v, j) => a + v * columnStrategy[j],
      0
    );
    for (let j = 0; j < columns; j++) {
      columnRegret[j] += columnUtility[j] - columnValue;
    }
  }

  const free = normalise(columnSum);
  return {
    mine: normalise(rowSum),
    theirs: normalise(
      free.map((p, j) => adversarial * p + (1 - adversarial) * model[j])
    ),
  };
}

/** The `cap` heaviest entries of a mix, renormalised. */
function heaviest(
  trios: string[][],
  probabilities: number[],
  cap: number
): { trio: string[]; probability: number }[] {
  const chosen = probabilities
    .map((_, i) => i)
    .sort((a, b) => probabilities[b] - probabilities[a])
    .slice(0, cap);
  const total = chosen.reduce((a, i) => a + probabilities[i], 0) || 1;
  return chosen.map((i) => ({
    trio: trios[i],
    probability: probabilities[i] / total,
  }));
}

/** The trio in `pool` with the best expected payoff against a mix. */
function bestResponse(
  board: Board,
  me: number,
  pool: string[][],
  against: { trio: string[]; probability: number }[],
  forOpponent: boolean
): string[] {
  let best = pool[0];
  let bestScore = -Infinity;
  for (const candidate of pool) {
    let expected = 0;
    for (const { trio, probability } of against) {
      // Zero-sum: the opponent maximises by minimising my payoff.
      const value = forOpponent
        ? -payoff(board, trio, candidate, me)
        : payoff(board, candidate, trio, me);
      expected += probability * value;
    }
    if (expected > bestScore) {
      bestScore = expected;
      best = candidate;
    }
  }
  return best;
}

/**
 * Plans a trio by solving the round as the simultaneous-move matrix game it is,
 * via double oracle:
 *
 *   1. seed both sides with SEED_TRIOS from the usual generators — the model of
 *      an opponent who is not specifically countering us
 *   2. solve the restricted game for a mix (see `solve`)
 *   3. have each side best-respond to the other's mix over POOL_TRIOS
 *   4. add those counters to the strategy sets and repeat
 *
 * Step 3 is the point of the whole thing. It is the only mechanism here that
 * puts a counter *to this bot* into the opponent model; every generator in this
 * file produces trios an opponent might play in general, never a trio chosen to
 * beat what the bot is about to do. That is what a human does after a few games,
 * and it is what the argmax bot had no answer to.
 *
 * The returned trio is *sampled* from the equilibrium mix, not maximised. That
 * is not a flourish: an unexploitable strategy in a simultaneous-move game is a
 * mixed one, and a bot that always answers a position the same way can be
 * learned and farmed no matter how strong each individual answer is.
 */
export function planTrio(
  board: Board,
  me: number,
  rand: () => number
): string[] {
  payoffMemo.clear(); // keyed on trios only, so it must not outlive this board
  const them = me === 1 ? TEAM_2 : TEAM_1;
  const mine = candidateTrios(board, me, rand, SEED_TRIOS);
  const theirs = candidateTrios(board, them, rand, SEED_TRIOS);
  const myPool = candidateTrios(board, me, rand, POOL_TRIOS);
  const theirPool = candidateTrios(board, them, rand, POOL_TRIOS);

  // Only the seeds are the model of ordinary play; counters get appended after,
  // and must not be treated as something the opponent does by default.
  const modelSize = theirs.length;
  const model = () => theirs.map((_, j) => (j < modelSize ? 1 / modelSize : 0));

  const matrix = mine.map((a) => theirs.map((b) => payoff(board, a, b, me)));
  const key = (trio: string[]) => trio.join(",");
  const mineSeen = new Set(mine.map(key));
  const theirsSeen = new Set(theirs.map(key));

  let mix = solve(matrix, model(), ADVERSARIAL_WEIGHT, SOLVER_ITERS);
  for (let round = 0; round < ORACLE_ROUNDS; round++) {
    const myCounter = bestResponse(
      board,
      me,
      myPool,
      heaviest(theirs, mix.theirs, SUPPORT_CAP),
      false
    );
    const theirCounter = bestResponse(
      board,
      me,
      theirPool,
      heaviest(mine, mix.mine, SUPPORT_CAP),
      true
    );

    let grew = false;
    if (!mineSeen.has(key(myCounter))) {
      mineSeen.add(key(myCounter));
      mine.push(myCounter);
      matrix.push(theirs.map((b) => payoff(board, myCounter, b, me)));
      grew = true;
    }
    if (!theirsSeen.has(key(theirCounter))) {
      theirsSeen.add(key(theirCounter));
      theirs.push(theirCounter);
      for (let i = 0; i < mine.length; i++) {
        matrix[i].push(payoff(board, mine[i], theirCounter, me));
      }
      grew = true;
    }
    // Neither side found anything it does not already hold: this is as solved
    // as it is going to get, and more rounds are wasted simulations.
    if (!grew) break;
    mix = solve(matrix, model(), ADVERSARIAL_WEIGHT, SOLVER_ITERS);
  }

  let draw = rand();
  for (let i = 0; i < mix.mine.length; i++) {
    draw -= mix.mine[i];
    if (draw <= 0) return mine[i];
  }
  return mine[mix.mine.indexOf(Math.max(...mix.mine))];
}

/**
 * Entry point: plan player 2's trio for the given round, deterministically.
 *
 * `seedSource` must be something the opponent cannot see. It used to be the
 * game guid, which player 1 receives from `create_game` and sends on every
 * call — and since the board and round index are public too and this code is
 * open source, that let them recompute this exact trio and answer it. A mixed
 * strategy whose draw is public is a pure strategy; the whole point of solving
 * the round (see planTrio) is lost. `src/actions.ts` passes the bot's own
 * `player_2_secret`, which is generated server-side and never returned by any
 * endpoint.
 *
 * Determinism per (game, round) is still required and still holds:
 * `generateMlMovesIfNeeded` replans on retry and completes a partially written
 * trio by slicing this result, which only works if replanning reproduces it.
 */
export function planBotTrio(
  board: Board,
  seedSource: string,
  completedRounds: number
): string[] {
  const rand = makeRng(`${seedSource}:${completedRounds}`);
  return planTrio(board, 2, rand);
}

// Regenerates test/fixtures/loss-positions.json from a dump of production D1.
//
// The opponents in harness.ts are all scripted, and a scripted approximation of
// a human is a much weaker opponent than the human — the pool reads 66-100%
// while the deployed bot wins 4 of 17 decided games against real people. These
// positions are the real thing: every round in a play-against-bot game where the
// human's trio actually put troops onto a bot-owned `i`, together with the trio
// they played to do it.
//
// Dump the two tables first (note the account id — the one in wrangler.toml is
// not the one D1 answers under):
//
//   export CLOUDFLARE_ACCOUNT_ID=9fd4adf553675a533efbd460e4f10f91
//   npx wrangler d1 execute allsfair --remote --json \
//     --command "SELECT game_guid, player_2_secret FROM games ORDER BY rowid;" > /tmp/games.json
//   npx wrangler d1 execute allsfair --remote --json \
//     --command "SELECT id, game_guid, move_string, player FROM moves ORDER BY id;" > /tmp/moves.json
//   npx tsx test/eval/extract-positions.ts /tmp/games.json /tmp/moves.json
import { readFileSync, writeFileSync } from "node:fs";
import { Board, Move, MovePair } from "../../src/engine";
import { legalActions } from "../../src/bot";

const [gamesPath, movesPath] = process.argv.slice(2);
if (!gamesPath || !movesPath) {
  throw new Error("usage: extract-positions.ts <games.json> <moves.json>");
}

interface GameRow {
  game_guid: string;
  player_2_secret: string;
}
interface MoveRow {
  id: number;
  game_guid: string;
  move_string: string;
  player: number;
}

const readD1 = <T>(path: string): T[] =>
  JSON.parse(readFileSync(path, "utf8"))[0].results as T[];

const games = readD1<GameRow>(gamesPath).filter((g) =>
  g.player_2_secret.startsWith("__ML_BOT__")
);
const moves = readD1<MoveRow>(movesPath);

const byGame = new Map<string, MoveRow[]>();
for (const m of moves) {
  if (!byGame.has(m.game_guid)) byGame.set(m.game_guid, []);
  byGame.get(m.game_guid)!.push(m);
}

export interface LossPosition {
  game: string;
  round: number;
  /** Board at the start of the round, as [owner, troopCount] per square. */
  board: Record<string, [number, number]>;
  /** What the human actually played that round. */
  humanTrio: string[];
  /** True if some bot trio provably holds `i` against that trio (see below). */
  defensible: boolean;
  savingTrio: string[] | null;
  /**
   * Biggest single human stack within three squares of `i` at the start of the
   * round, against the garrison it faces. A round is three moves, so that stack
   * arrives at full strength: `strike > garrison` is the condition that
   * separates the games the bot lost (28% of round-starts) from the ones it won
   * (2%).
   */
  strike: number;
  garrison: number;
  materialHuman: number;
  materialBot: number;
}

const DIST_TO_I: Record<string, number> = {
  i: 0, f: 1, h: 1, c: 2, e: 2, g: 2, b: 3, d: 3, a: 4,
};

function snapshot(b: Board): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const [k, n] of Object.entries(b.state)) out[k] = [n.owner, n.troopCount];
  return out;
}
function restore(spec: Record<string, [number, number]>): Board {
  const b = new Board();
  for (const [square, [owner, troops]] of Object.entries(spec)) {
    b.state[square].owner = owner;
    b.state[square].troopCount = troops;
  }
  return b;
}
const material = (b: Board, t: number) =>
  Object.values(b.state).filter((n) => n.owner === t).reduce((s, n) => s + n.troopCount, 0);

/**
 * Exhaustive depth-3 search for a bot trio that still owns `i` after the human's
 * recorded trio is played against it. This is what `defensible` means: not that
 * the bot should have found it, but that one exists at all. Positions where none
 * does are already lost when they are reached and cannot be gated.
 */
function findSavingTrio(board: Board, humanTrio: string[]): string[] | null {
  const search = (state: Board, ply: number, sofar: string[]): string[] | null => {
    if (state.winner === 1) return null;
    if (ply === 3) return state.state["i"].owner === 2 ? sofar : null;
    const options = legalActions(state, 2).map((a) => `${a.start}${a.troops}${a.end}`);
    options.push("i0h"); // the pass move: a slot may decline to move
    for (const option of options) {
      const next = state.clone();
      next.applyMovePair(new MovePair(new Move(humanTrio[ply]), new Move(option)));
      const found = search(next, ply + 1, [...sofar, option]);
      if (found) return found;
    }
    return null;
  };
  return search(board.clone(), 0, []);
}

const positions: LossPosition[] = [];

for (const g of games) {
  const rows = byGame.get(g.game_guid) ?? [];
  const p1 = rows.filter((r) => r.player === 1).map((r) => r.move_string);
  const p2 = rows.filter((r) => r.player === 2).map((r) => r.move_string);
  const pairs = Math.min(p1.length, p2.length);

  const board = new Board();
  let roundStart = snapshot(board);
  let capturedThisRound = false;

  for (let i = 0; i < pairs; i++) {
    const round = Math.floor(i / 3);
    if (i % 3 === 0) {
      roundStart = snapshot(board);
      capturedThisRound = false;
    }
    const human = new Move(p1[i]);
    const attacks = human.end === "i" && board.state["i"].owner === 2;
    board.applyMovePair(new MovePair(human, new Move(p2[i])));

    if (attacks && !capturedThisRound) {
      capturedThisRound = true; // one fixture per round, not per move
      const start = restore(roundStart);
      const humanTrio = p1.slice(round * 3, round * 3 + 3);
      if (humanTrio.length !== 3) continue; // truncated final round
      const garrison =
        start.state["i"].owner === 2 ? start.state["i"].troopCount : 0;
      let strike = 0;
      for (const [name, node] of Object.entries(start.state)) {
        if (node.owner === 1 && node.troopCount > 0 && DIST_TO_I[name] <= 3) {
          strike = Math.max(strike, node.troopCount);
        }
      }
      const saving = findSavingTrio(start, humanTrio);
      positions.push({
        game: g.game_guid.slice(0, 8),
        round,
        board: roundStart,
        humanTrio,
        defensible: saving !== null,
        savingTrio: saving,
        strike,
        garrison,
        materialHuman: material(start, 1),
        materialBot: material(start, 2),
      });
    }

    if (board.winner) break;
    if ((i + 1) % 3 === 0) board.restock();
  }
}

positions.sort((a, b) => (a.game === b.game ? a.round - b.round : a.game < b.game ? -1 : 1));

const out = new URL("../fixtures/loss-positions.json", import.meta.url).pathname;
writeFileSync(out, JSON.stringify(positions, null, 2) + "\n");

const defensible = positions.filter((p) => p.defensible);
console.log(`${positions.length} positions from ${games.length} bot games -> ${out}`);
console.log(`  defensible: ${defensible.length}`);
console.log(`  strike > garrison: ${positions.filter((p) => p.strike > p.garrison).length}`);

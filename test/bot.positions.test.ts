// The gate built from people rather than from code.
//
// Every opponent in test/eval/harness.ts is scripted, and a scripted
// approximation of a human is a far weaker opponent than the human: that pool
// reads 75-100% while the deployed bot won 4 of the 17 decided games it played
// against real people. `test/fixtures/loss-positions.json` is what actually
// happened — every round in a production play-against-bot game where the human's
// trio put troops onto a bot-held `i`, with the trio they played to do it.
// Regenerate it from D1 with test/eval/extract-positions.ts as games accumulate.
//
// What the 22 games say. Of the 27 attacks on a home the bot still held, 10 were
// held, 10 arrived with more troops than the garrison had at the *start of the
// round*, and 7 were the bot emptying a home that would otherwise have survived
// — `02dcb90d` r3, `9b7aac1c` r1 and `0deb12a4` r3 all read incoming 3 against a
// garrison of 4, with the bot having shipped all 4 out. Those seven are the bait
// that `flankTrio` in src/bot.ts exists for.
//
// Measure that split at the round start, not at the moment of impact. Counting
// the garrison as it stood when the killing move landed says 15 outnumbered and
// 1 self-inflicted, which is wrong in the most misleading direction available:
// in the bait line the home is empty precisely *because* the bot left two moves
// earlier in the same round, so its own mistake gets recorded as an opposing
// stack being too big.
//
// The other half is real, though. The stack that does outnumber a garrison is
// visible a round ahead -- the extractor's `strike > garrison` held at 28% of
// round-starts in the games the bot lost and 2% of the ones it won -- and it sits
// two squares out, not adjacent, because a trio is three moves and the human
// assembles and strikes inside one round. Teaching the evaluation to see it at
// full strength was tried and made the bot worse where it counts (see the table
// in the README): the search already simulates the real trio, so it was never
// blind to the arrival inside the round it was planning. The number this file
// gates is the *outcome*, not any one theory of it.
//
// `defensible` marks the positions where an exhaustive depth-3 search proves
// some bot trio still owns `i` at the end of the round. The other 10 are already
// lost when they are reached — the bot arrives at them with 6.2 material against
// 15.1 — so they are the economy problem, not a defensive one, and gating them
// would be gating the impossible. They are still measured below, without a
// floor, because a change that rescues one of them is worth knowing about.
import { describe, expect, it } from "vitest";
import rawPositions from "./fixtures/loss-positions.json";
import { planTrio } from "../src/bot";
import { Board, Move, MovePair } from "../src/engine";
import { makeRng } from "../src/rng";

interface LossPosition {
  game: string;
  round: number;
  board: Record<string, [number, number]>;
  humanTrio: string[];
  defensible: boolean;
  savingTrio: string[] | null;
  strike: number;
  garrison: number;
  materialHuman: number;
  materialBot: number;
}

const positions = rawPositions as unknown as LossPosition[];
const defensible = positions.filter((p) => p.defensible);
const SEEDS = 20;

function build(spec: Record<string, [number, number]>): Board {
  const board = new Board();
  for (const [square, [owner, troops]] of Object.entries(spec)) {
    board.state[square].owner = owner;
    board.state[square].troopCount = troops;
  }
  return board;
}

/** Plays the human's recorded trio against a freshly planned bot trio. */
function holdsHome(position: LossPosition, seed: string): boolean {
  const board = build(position.board);
  const bot = planTrio(board, 2, makeRng(seed));
  const sim = board.clone();
  for (let i = 0; i < 3; i++) {
    sim.applyMovePair(
      new MovePair(new Move(position.humanTrio[i]), new Move(bot[i]))
    );
    if (sim.winner) break;
  }
  return sim.state["i"].owner === 2;
}

function holdRate(set: LossPosition[], tag: string): number {
  let held = 0;
  for (const p of set) {
    for (let s = 0; s < SEEDS; s++) {
      if (holdsHome(p, `${tag}-${p.game}-${p.round}-${s}`)) held++;
    }
  }
  return held / (set.length * SEEDS);
}

describe("real losing positions", () => {
  it("the fixture still describes what it claims", () => {
    expect(positions.length).toBeGreaterThanOrEqual(27);
    expect(defensible.length).toBeGreaterThanOrEqual(17);
    for (const p of positions) {
      expect(p.humanTrio).toHaveLength(3);
      for (const m of p.humanTrio) expect(() => new Move(m)).not.toThrow();
      // Every one of these is a human trio that reaches the bot's home, so the
      // last move of it lands on `i`.
      expect(p.humanTrio.some((m) => new Move(m).end === "i")).toBe(true);
      if (p.defensible) expect(p.savingTrio).toHaveLength(3);
    }
  });

  it("the recorded strike and garrison match the recorded board", () => {
    // `strike` and `garrison` are the columns the commentary above is drawn
    // from, so they have to keep describing the board they sit next to.
    const distToI: Record<string, number> = {
      i: 0, f: 1, h: 1, c: 2, e: 2, g: 2, b: 3, d: 3, a: 4,
    };
    for (const p of positions) {
      const where = `${p.game} r${p.round}`;
      let strike = 0;
      for (const [square, [owner, troops]] of Object.entries(p.board)) {
        if (owner === 1 && troops > 0 && distToI[square] <= 3) {
          strike = Math.max(strike, troops);
        }
      }
      expect(strike, where).toBe(p.strike);
      const [owner, troops] = p.board["i"];
      expect(owner === 2 ? troops : 0, where).toBe(p.garrison);
    }
  });

  it("the saving trio really does hold the home", () => {
    // Guards the extraction itself: if this fails the fixture is wrong, not the
    // bot.
    for (const p of defensible) {
      const sim = build(p.board).clone();
      for (let i = 0; i < 3; i++) {
        sim.applyMovePair(
          new MovePair(new Move(p.humanTrio[i]), new Move(p.savingTrio![i]))
        );
        if (sim.winner) break;
      }
      expect(sim.state["i"].owner, `${p.game} r${p.round}`).toBe(2);
    }
  });

  it(
    "holds the home on positions where holding is possible",
    { timeout: 600_000 },
    () => {
      const rate = holdRate(defensible, "defensible");
      // 74%, over 40 seeds a position (this gate runs 20, so read it as +/-3):
      // 64% at ADVERSARIAL_WEIGHT 0.5, 62% at the 0.7 this ships, then +12 from
      // `flankTrio`, which put the two positions that never survived — the ones
      // the humans baited — at 95% and 100%. The floor is a collapse detector set
      // well under that, not the measurement; raising what it measures is the
      // point of any work here.
      expect(rate).toBeGreaterThanOrEqual(0.5);
    }
  );

  it(
    "reports the rate over every recorded position",
    { timeout: 600_000 },
    () => {
      // No floor: 10 of these are unwinnable and the number is here to be read,
      // not to pass. Measured 39% at ADVERSARIAL_WEIGHT 0.5, 38% at 0.7, 46%
      // once `flankTrio` was in the model.
      const rate = holdRate(positions, "all");
      expect(rate).toBeGreaterThan(0);
    }
  );
});

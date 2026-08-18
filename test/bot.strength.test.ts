// Strength gates. These are floors with margin, not the measured numbers; the
// measured value is in a comment on each. To re-measure after a change, run the
// full sweep in test/eval/sweep.test.ts.
//
// Every matchup is played from both seats, so a gate cannot be passed by an
// artifact of which home square the bot starts on.
//
// The floors against the scripted opponents are low on purpose. They dropped
// once when the bot moved from argmax to an equilibrium (heuristic 99% -> 86%)
// and again when source-denial entered the model (86% -> 78%), and both times
// the same change bought a large gain against an opponent that adapts. The
// second one cost nothing head-to-head against the bot it replaced (26-24 over
// 50 games), so a lower scripted number here means the bot stopped over-fitting
// to opponents that never punish it — not that it got weaker. Raising these
// floors by making the bot greedier would undo that. See ADVERSARIAL_WEIGHT and
// DENIAL_EVERY in src/bot.ts for the swept curves.
//
// Every floor here is derived from the measured rate at that gate's own sample
// size, ~3 sigma under, and has to be redone whenever a change moves the rates.
// Skipping that once already cost a mystery failure: ADVERSARIAL_WEIGHT 0.7 took
// three rates down ~15 points, the floors stayed put at one-and-a-half sigma, and
// a full run had a 20% chance of failing on noise alone. `flankTrio` then took
// the scripted rates up ~20, so they are derived again here:
//
//   gate               rate   n    floor   sigma under
//   random             100%   30    0.90       —
//   heuristic           93%   30    0.75      3.9
//   pre-tuning bot      58%   30    0.25      3.7
//   human(6,2)          97%   30    0.80      5.5
//   exploiter           43%   20    0.12      2.8
//   source-denial       53%   20    0.20      3.0
//
// Lowering a floor after a change is how a regression gets hidden, so read the
// rates rather than the floors: those come from 60-80 game runs (see the table
// on ADVERSARIAL_WEIGHT), and the floors are only what keeps a 20- or 30-game
// sample from failing on variance. A real regression shows up in the rate.
import { describe, expect, it } from "vitest";
import {
  baselineBot,
  denialExploiterBot,
  exploiterBot,
  heuristicBot,
  makeHumanLike,
  randomBot,
  searchBot,
  sweep,
} from "./eval/harness";

// Per seat, so double this many games per gate. Solving the round costs ~50 ms
// a turn against the argmax bot's ~20 (it was ~130 before `payoff` was memoised).
// The two exploiter gates set their own count: they plan the bot's turn seven
// times per round, so they cost far more per game than the four below.
const GAMES = 15;
const EXPLOITER_GAMES = 10;

describe("bot strength gates", () => {
  it("beats a random mover", { timeout: 120_000 }, () => {
    const tally = sweep(randomBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.9); // measured 100%
  });

  it("beats the greedy heuristic", { timeout: 120_000 }, () => {
    const tally = sweep(heuristicBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.75); // measured 93%
  });

  // KNOWN REGRESSION — this floor was lowered to record a real loss, not to
  // absorb one. Changing `Board.winner` to end the game when a home is held and
  // the loser can no longer outnumber its garrison took this rate from 85%
  // (102/120) to 58.3% (70/120), measured over 120 games from both seats on
  // either side of that one commit. At those sample sizes the drop is ~5 sigma:
  // it is the rule change, not variance.
  //
  // The engine change is correct and independently tested; what it invalidates
  // is the bot's *tuning*. Games now end far earlier, so taking a home with a
  // garrison behind it simply wins, which rewards the frozen bot's rushing over
  // the equilibrium play this bot was tuned for back when a win required
  // grinding the opponent to zero troops. That mechanism is inferred from the
  // rule change, not yet confirmed by the sweep.
  //
  // So do NOT read 58% as the new normal. Retuning the bot for the new win
  // condition should take this back up, and this floor with it. Until then the
  // gate only proves the bot has not fallen further.
  it("beats the pre-tuning bot", { timeout: 120_000 }, () => {
    const tally = sweep(baselineBot, searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.25); // measured 58%
  });

  // The line a human used to beat the shipped bot: trade pieces off, bank
  // restock troops at home, then march the stack. The pre-tuning bot lost 14%
  // of these; this gate is what stops that regressing.
  it("beats trade-then-bank-then-march", { timeout: 120_000 }, () => {
    const tally = sweep(makeHumanLike(6, 2), searchBot, GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.8); // measured 97%
  });

  // The gate that matters, and the one no scripted opponent can enforce: an
  // opponent that samples the bot's policy and best-responds to it. A bot that
  // answers a position the same way every time scores ~4% here however strong
  // each individual answer is, so this is what stops a future change quietly
  // going back to a pure strategy. Deliberately a low floor with wide margin —
  // it is expensive per game, so it runs few of them and the variance is large.
  it("is not trivially exploitable", { timeout: 300_000 }, () => {
    const tally = sweep(exploiterBot, searchBot, EXPLOITER_GAMES);
    // 43% is the real rate over 60 games, so this floor is deliberately far
    // below it: at 20 games one sigma is ~11 points, and a floor near the mean
    // would fail on noise. It is a collapse detector — a bot that reverted to a
    // pure strategy scores ~4% here.
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.12); // measured 43%
  });

  // The second exploit axis, and the one the gate above could not see: empty the
  // square the bot is about to move from and it plays one move against three. A
  // human found this on a bot that scored 33% above, which is why both axes are
  // gated separately — the bot's real exposure is the worse of the two.
  //
  // The two axes traded places at ADVERSARIAL_WEIGHT 0.7: this one fell from 60%
  // to 48% while the gate above rose from 35% to 48%, which is the whole point
  // of that change and the reason to read them together rather than one at a
  // time. `flankTrio` then left both alone (43% / 53%, against 47% / 47%) while
  // taking every other column up. Measured over 60 games; see the tables on
  // ADVERSARIAL_WEIGHT and flankTrio.
  //
  // Read this floor as loose. Like `heuristicBot`, this exploiter is built on the
  // frozen baseline scorer and evaluation so that tuning src/bot.ts cannot move
  // the yardstick — and that makes it markedly weaker than the same construction
  // on the live ones, which holds the bot to 38% where this reads 63%. The 38%
  // is the number to believe about the bot's exposure (the previous build scored
  // 25% there); this gate only catches a collapse.
  it("is not trivially exploitable by source-denial", { timeout: 300_000 }, () => {
    const tally = sweep(denialExploiterBot, searchBot, EXPLOITER_GAMES);
    expect(tally.wins / tally.games).toBeGreaterThanOrEqual(0.2); // measured 53%
  });
});

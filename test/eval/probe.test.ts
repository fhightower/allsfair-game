// Ad-hoc positional probes. Skipped unless BOT_PROBE=1.
//   BOT_PROBE=1 npx vitest run test/eval/probe.test.ts --reporter=verbose --silent=false
import { describe, it } from "vitest";
import {
  evaluate,
  homeDeficit,
  homeThreat,
  planTrio,
  rushTrio,
  scoredActions,
} from "../../src/bot";
import { planTrio as planTrioBaseline } from "./bot-baseline";
import { Board } from "../../src/engine";
import { makeRng } from "../../src/rng";

function position(spec: Record<string, [number, number]>): Board {
  const b = new Board();
  for (const node of Object.values(b.state)) {
    node.owner = 0;
    node.troopCount = 0;
  }
  for (const [square, [owner, troops]] of Object.entries(spec)) {
    b.state[square].owner = owner;
    b.state[square].troopCount = troops;
  }
  return b;
}

function report(name: string, b: Board) {
  console.log(`\n--- ${name}`);
  console.log(
    "  threat:",
    homeThreat(b, 2).toFixed(1),
    " deficit:",
    homeDeficit(b, 2).toFixed(1),
    " eval:",
    evaluate(b, 2).toFixed(1)
  );
  console.log(
    "  top actions:",
    scoredActions(b, 2)
      .slice(0, 6)
      .map((s) => `${s.action.start}${s.action.troops}${s.action.end}=${s.score.toFixed(2)}`)
      .join(" ")
  );
  console.log("  baseline plan:", planTrioBaseline(b, 2, makeRng("p")).join(" "));
  console.log("  new plan     :", planTrio(b, 2, makeRng("p")).join(" "));
  console.log("  enemy rush   :", rushTrio(b, 1).join(" "));
}

describe.skipIf(!process.env.BOT_PROBE)("planning cost", () => {
  it("times a bot turn", () => {
    const positions = [
      new Board(),
      position({ a: [1, 6], b: [1, 2], e: [2, 4], i: [2, 7], h: [2, 3] }),
      position({ a: [1, 12], d: [1, 5], e: [1, 3], f: [2, 9], i: [2, 11] }),
    ];
    for (const [n, b] of positions.entries()) {
      const runs = 100;
      const time = (plan: (b: Board, p: number, r: () => number) => string[]) => {
        const started = performance.now();
        for (let i = 0; i < runs; i++) plan(b, 2, makeRng(`t${i}`));
        return (performance.now() - started) / runs;
      };
      const base = time(planTrioBaseline);
      const now = time(planTrio);
      console.log(
        `  position ${n}: baseline ${base.toFixed(2)} ms/turn, new ${now.toFixed(2)} ms/turn`
      );
    }
  }, 120_000);
});

describe.skipIf(!process.env.BOT_PROBE)("positional probes", () => {
  it("defensive positions", () => {
    report("enemy 10-stack on h, bot home i=2", position({ a: [1, 2], h: [1, 10], i: [2, 2], f: [2, 3] }));
    report("enemy 8-stack on f, bot home i=6", position({ f: [1, 8], i: [2, 6], h: [2, 3], a: [1, 1] }));
    report("enemy 6-stack on d (two away)", position({ d: [1, 6], i: [2, 4], a: [1, 1] }));
    report("quiet opening", new Board());
  });
});

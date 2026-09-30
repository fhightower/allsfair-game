import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

describe("bot submission errors", () => {
  it("restores the form and displays the error after thinking has started", async () => {
    const elements = new Map<string, {
      style: Record<string, string>;
      value: string;
      textContent: string;
      disabled: boolean;
    }>();
    const element = (id: string) => {
      if (!elements.has(id)) {
        elements.set(id, { style: {}, value: "", textContent: "", disabled: false });
      }
      return elements.get(id)!;
    };
    const context = createContext({
      document: { getElementById: element },
      localStorage: { getItem: () => null },
      // Run the paint delay immediately; the failure happens after the page
      // has entered the thinking state, just as a rejected API request would.
      setTimeout: (fn: () => void) => fn(),
      AllsfairBot: {
        submitBotRound: async (options: { onThinking: () => Promise<void> }) => {
          await options.onThinking();
          throw new Error("Network interrupted");
        },
      },
    });
    runInContext(script, context);
    runInContext(`
      gameGuid = 'test'; secret = 'human'; playerNumber = 1;
      botSecret = 'bot'; botDifficulty = 'easy';
      api = async () => ({player_1_move_count: 0, player_2_move_count: 0});
    `, context);
    for (const id of ["move1", "move2", "move3"]) element(id).value = "a0b";

    await runInContext("submitMoves({preventDefault() {}})", context);

    expect(element("move-form").style.display).toBe("block");
    expect(element("waiting-msg").style.display).toBe("none");
    expect(element("move-error").textContent).toBe("Network interrupted");
    expect(element("submit-btn").disabled).toBe(false);
    expect(element("move1").value).toBe("a0b");
  });
});

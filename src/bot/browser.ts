// Bundle entry for the browser build.
//
// esbuild turns this into public/bot.js as an IIFE exposing `window.AllsfairBot`,
// so public/index.html can use the bot without a module loader. Rules come from
// src/engine.ts through this bundle, so the browser and the server share one
// definition of the game and cannot drift.
export { DIFFICULTIES, chooseRound } from "./index";
export type { BotDecision, BotOptions, Difficulty } from "./index";
export { parseBoardHtml } from "./board-html";
export { submitBotRound } from "./driver";
export type { ApiCall, ApiResponse, BotRoundContext } from "./driver";
export { seededRng } from "./rng";

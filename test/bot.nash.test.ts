import { describe, expect, it } from "vitest";
import { solveMatrix } from "../src/bot/nash";

const CLOSE = 0.02;

describe("solveMatrix", () => {
  it("mixes uniformly in rock-paper-scissors", () => {
    const rps = [
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ];
    const { value, rowStrategy, colStrategy } = solveMatrix(rps);
    expect(value).toBeCloseTo(0, 1);
    for (const p of rowStrategy) expect(p).toBeCloseTo(1 / 3, 1);
    for (const q of colStrategy) expect(q).toBeCloseTo(1 / 3, 1);
  });

  it("mixes evenly in matching pennies", () => {
    const { value, rowStrategy } = solveMatrix([
      [1, -1],
      [-1, 1],
    ]);
    expect(value).toBeCloseTo(0, 1);
    expect(rowStrategy[0]).toBeCloseTo(0.5, 1);
  });

  it("plays a dominant row purely", () => {
    const { value, rowStrategy } = solveMatrix([
      [1, 1],
      [0, 0],
    ]);
    expect(value).toBeCloseTo(1, 1);
    expect(rowStrategy[0]).toBeGreaterThan(0.9);
  });

  it("finds the known equilibrium of a mixed 2x2 game", () => {
    // A = [[2,-1],[-1,1]] equalises at p = q = 0.4 with value 0.2.
    const { value, rowStrategy, colStrategy } = solveMatrix([
      [2, -1],
      [-1, 1],
    ]);
    expect(value).toBeCloseTo(0.2, 1);
    expect(rowStrategy[0]).toBeCloseTo(0.4, 1);
    expect(colStrategy[0]).toBeCloseTo(0.4, 1);
  });

  it("returns strategies that are probability distributions", () => {
    const { rowStrategy, colStrategy } = solveMatrix([
      [3, -2, 0],
      [-1, 4, 1],
    ]);
    expect(rowStrategy.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(colStrategy.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    for (const p of [...rowStrategy, ...colStrategy]) {
      expect(p).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the value inside the matrix's range", () => {
    const matrix = [
      [5, -3],
      [-4, 2],
    ];
    const { value } = solveMatrix(matrix);
    const flat = matrix.flat();
    expect(value).toBeGreaterThanOrEqual(Math.min(...flat));
    expect(value).toBeLessThanOrEqual(Math.max(...flat));
  });

  it("solves a one-by-one game exactly", () => {
    const { value, rowStrategy, colStrategy } = solveMatrix([[7]]);
    expect(value).toBe(7);
    expect(rowStrategy).toEqual([1]);
    expect(colStrategy).toEqual([1]);
  });

  it("is deterministic — no hidden randomness", () => {
    const matrix = [
      [1, -2, 3],
      [0, 1, -1],
      [-2, 2, 0],
    ];
    expect(solveMatrix(matrix)).toEqual(solveMatrix(matrix));
  });

  it("gives neither side a profitable deviation", () => {
    // The equilibrium test that matters: against the solved column strategy no
    // single row beats the value, and against the row strategy no single column
    // holds the value down.
    const matrix = [
      [4, 0, -1],
      [-1, 3, 2],
      [1, -2, 5],
    ];
    const { value, rowStrategy, colStrategy } = solveMatrix(matrix);
    for (const row of matrix) {
      const payoff = row.reduce((sum, a, j) => sum + a * colStrategy[j], 0);
      expect(payoff).toBeLessThanOrEqual(value + CLOSE);
    }
    for (let j = 0; j < matrix[0].length; j++) {
      const payoff = matrix.reduce((sum, row, i) => sum + row[j] * rowStrategy[i], 0);
      expect(payoff).toBeGreaterThanOrEqual(value - CLOSE);
    }
  });
});

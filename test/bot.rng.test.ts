import { describe, expect, it } from "vitest";
import { sampleIndex, seededRng } from "../src/bot/rng";

describe("seededRng", () => {
  it("repeats its sequence for the same seed", () => {
    const draw = () => {
      const rng = seededRng(12345);
      return Array.from({ length: 8 }, () => rng.next());
    };
    expect(draw()).toEqual(draw());
  });

  it("gives different sequences for different seeds", () => {
    const first = seededRng(1);
    const second = seededRng(2);
    expect(first.next()).not.toBe(second.next());
  });

  it("stays inside the unit interval", () => {
    const rng = seededRng(99);
    for (let i = 0; i < 2000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("spreads across the interval rather than clustering", () => {
    const rng = seededRng(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) buckets[Math.floor(rng.next() * 10)]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });
});

describe("sampleIndex", () => {
  it("respects the weights it is given", () => {
    const rng = seededRng(4);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[sampleIndex([0.2, 0.5, 0.3], rng)]++;
    expect(counts[0] / 6000).toBeCloseTo(0.2, 1);
    expect(counts[1] / 6000).toBeCloseTo(0.5, 1);
    expect(counts[2] / 6000).toBeCloseTo(0.3, 1);
  });

  it("never picks a zero-weight option", () => {
    const rng = seededRng(5);
    for (let i = 0; i < 500; i++) {
      expect(sampleIndex([0.5, 0, 0.5], rng)).not.toBe(1);
    }
  });

  it("falls back to the first option when every weight is zero", () => {
    expect(sampleIndex([0, 0, 0], seededRng(1))).toBe(0);
  });

  it("handles a single option", () => {
    expect(sampleIndex([1], seededRng(1))).toBe(0);
  });
});

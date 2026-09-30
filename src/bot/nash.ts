// Solving a two-player zero-sum matrix game.
//
// Regret matching+ with linearly weighted averaging (the CFR+ update, applied
// to a bare matrix). Chosen over a simplex LP because it is a few dozen lines
// with no dependency, and its residual error sits far below the error already
// present in the leaf evaluation it consumes. Nothing provable is lost by the
// approximation: the proofs in exact.ts are quantifier checks and use no solver
// at all.

export interface MatrixSolution {
  /** The row player's value of the game. */
  value: number;
  rowStrategy: number[];
  colStrategy: number[];
}

/** Positive regrets, normalised; uniform while every regret is still zero. */
function strategyFromRegret(regret: Float64Array, out: Float64Array): void {
  let total = 0;
  for (let i = 0; i < regret.length; i++) total += regret[i];
  if (total <= 0) {
    out.fill(1 / regret.length);
    return;
  }
  for (let i = 0; i < regret.length; i++) out[i] = regret[i] / total;
}

function normalise(sums: Float64Array): number[] {
  let total = 0;
  for (let i = 0; i < sums.length; i++) total += sums[i];
  if (total <= 0) return Array.from({ length: sums.length }, () => 1 / sums.length);
  return Array.from(sums, (s) => s / total);
}

/**
 * `payoffs[i][j]` is the row player's payoff; the column player receives its
 * negation. Both sides run regret matching+ against each other and the averaged
 * strategies converge to an equilibrium.
 */
export function solveMatrix(
  payoffs: number[][],
  iterations = 3000
): MatrixSolution {
  const rows = payoffs.length;
  const cols = rows > 0 ? payoffs[0].length : 0;
  if (rows === 0 || cols === 0) {
    return { value: 0, rowStrategy: [], colStrategy: [] };
  }

  const rowRegret = new Float64Array(rows);
  const colRegret = new Float64Array(cols);
  const rowSum = new Float64Array(rows);
  const colSum = new Float64Array(cols);
  const rowStrategy = new Float64Array(rows);
  const colStrategy = new Float64Array(cols);
  const rowUtility = new Float64Array(rows);
  const colPayoff = new Float64Array(cols);

  for (let t = 1; t <= iterations; t++) {
    strategyFromRegret(rowRegret, rowStrategy);
    strategyFromRegret(colRegret, colStrategy);

    // One pass over the matrix yields both sides' utilities.
    rowUtility.fill(0);
    colPayoff.fill(0);
    for (let i = 0; i < rows; i++) {
      const row = payoffs[i];
      const pi = rowStrategy[i];
      let util = 0;
      for (let j = 0; j < cols; j++) {
        util += row[j] * colStrategy[j];
        colPayoff[j] += row[j] * pi;
      }
      rowUtility[i] = util;
    }

    let expected = 0;
    for (let i = 0; i < rows; i++) expected += rowStrategy[i] * rowUtility[i];

    // Regret matching+: accumulate, then clamp at zero rather than letting
    // negative regret build up and stall the response to a strategy change.
    for (let i = 0; i < rows; i++) {
      const next = rowRegret[i] + rowUtility[i] - expected;
      rowRegret[i] = next > 0 ? next : 0;
      rowSum[i] += t * rowStrategy[i];
    }
    // The column player's utility is -colPayoff[j], and its expected value is
    // -expected, so its regret is (expected - colPayoff[j]).
    for (let j = 0; j < cols; j++) {
      const next = colRegret[j] + expected - colPayoff[j];
      colRegret[j] = next > 0 ? next : 0;
      colSum[j] += t * colStrategy[j];
    }
  }

  const averagedRow = normalise(rowSum);
  const averagedCol = normalise(colSum);

  let value = 0;
  for (let i = 0; i < rows; i++) {
    const row = payoffs[i];
    const pi = averagedRow[i];
    if (pi === 0) continue;
    for (let j = 0; j < cols; j++) value += pi * row[j] * averagedCol[j];
  }

  return { value, rowStrategy: averagedRow, colStrategy: averagedCol };
}

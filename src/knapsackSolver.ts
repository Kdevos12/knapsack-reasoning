import type { KnapsackInstance, SolvedInstance } from './types';

// Exact 0/1 knapsack DP. Fine for the item/capacity ranges this app generates
// (n <= ~14, capacity <= a few hundred).
export function solveKnapsack(instance: KnapsackInstance): SolvedInstance {
  const { weights, values, capacity } = instance;
  const n = weights.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const w = weights[i - 1];
    const v = values[i - 1];
    for (let c = 0; c <= capacity; c++) {
      dp[i][c] = w > c ? dp[i - 1][c] : Math.max(dp[i - 1][c], dp[i - 1][c - w] + v);
    }
  }

  const optimalSelection = new Array(n).fill(false);
  let c = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][c] !== dp[i - 1][c]) {
      optimalSelection[i - 1] = true;
      c -= weights[i - 1];
    }
  }

  return { ...instance, optimalValue: dp[n][capacity], optimalSelection };
}

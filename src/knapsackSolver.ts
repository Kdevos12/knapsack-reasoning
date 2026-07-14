import type { KnapsackInstance, SolvedInstance } from './types';

// Exact 0/1 knapsack DP. Fine for the item/capacity ranges this app generates
// (n <= ~24, capacity <= a few hundred to a few thousand).
export function solveKnapsack(instance: KnapsackInstance): SolvedInstance {
  const { weights, values, capacity, weights2, capacity2, conflicts } = instance;
  if (weights2 && capacity2 !== undefined) {
    return solveKnapsack2D(instance, weights2, capacity2);
  }
  if (conflicts && conflicts.length > 0) {
    return solveKnapsackConflict(instance, conflicts);
  }

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

// Two independent capacity constraints (e.g. weight + volume). Keeps the
// full dp[i][c1][c2] table (not just the current row) so the optimal
// selection can be backtracked the same way the 1D solver does, matching
// item counts/capacities are capped (see instanceGenerator.MAX_SPREAD_WITH_DIM2)
// specifically so this table stays a few million cells at most.
function solveKnapsack2D(instance: KnapsackInstance, weights2: number[], capacity2: number): SolvedInstance {
  const { weights, values, capacity } = instance;
  const n = weights.length;

  // dp[i] is a flattened (capacity+1) x (capacity2+1) grid for the first i items.
  const rowSize = capacity2 + 1;
  const dp: Int32Array[] = new Array(n + 1);
  dp[0] = new Int32Array((capacity + 1) * rowSize);

  for (let i = 1; i <= n; i++) {
    const w1 = weights[i - 1];
    const w2 = weights2[i - 1];
    const v = values[i - 1];
    const prev = dp[i - 1];
    const cur = new Int32Array(prev.length);
    for (let c1 = 0; c1 <= capacity; c1++) {
      const base = c1 * rowSize;
      for (let c2 = 0; c2 <= capacity2; c2++) {
        let best = prev[base + c2];
        if (c1 >= w1 && c2 >= w2) {
          const withItem = prev[(c1 - w1) * rowSize + (c2 - w2)] + v;
          if (withItem > best) best = withItem;
        }
        cur[base + c2] = best;
      }
    }
    dp[i] = cur;
  }

  const optimalSelection = new Array(n).fill(false);
  let c1 = capacity;
  let c2 = capacity2;
  for (let i = n; i > 0; i--) {
    if (dp[i][c1 * rowSize + c2] !== dp[i - 1][c1 * rowSize + c2]) {
      optimalSelection[i - 1] = true;
      c1 -= weights[i - 1];
      c2 -= weights2[i - 1];
    }
  }

  return { ...instance, optimalValue: dp[n][capacity * rowSize + capacity2], optimalSelection };
}

// Pairwise item conflicts (e.g. mutually exclusive equipment choices) have
// no representation in capacity-indexed DP — there's no state dimension for
// "which specific items are already picked," which is what a conflict check
// needs. This is a Horowitz-Sahni branch-and-bound instead: sort by
// value/weight ratio descending, DFS trying include-then-exclude at each
// item, pruned by a fractional-knapsack relaxation bound that drops
// conflicts entirely (still admissible — conflicts only ever remove
// feasible options relative to the unconstrained relaxation, never add
// value, so ignoring them can't make the bound too low). Item counts are
// capped well within 32 bits (see instanceGenerator.MAX_EXTRA_ITEMS), so
// both the running selection and each item's conflict set are tracked as
// plain bitmasks.
function solveKnapsackConflict(instance: KnapsackInstance, conflicts: [number, number][]): SolvedInstance {
  const { weights, values, capacity } = instance;
  const n = weights.length;

  const conflictMask = new Array<number>(n).fill(0);
  for (const [a, b] of conflicts) {
    conflictMask[a] |= 1 << b;
    conflictMask[b] |= 1 << a;
  }

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => values[b] / weights[b] - values[a] / weights[a],
  );

  function bound(from: number, remainingCapacity: number): number {
    let cap = remainingCapacity;
    let value = 0;
    for (let k = from; k < n; k++) {
      const idx = order[k];
      const w = weights[idx];
      if (w <= cap) {
        cap -= w;
        value += values[idx];
      } else {
        value += (values[idx] / w) * cap;
        break;
      }
    }
    return value;
  }

  let bestValue = 0;
  let bestMask = 0;

  function dfs(k: number, remainingCapacity: number, selectedMask: number, currentValue: number): void {
    if (currentValue > bestValue) {
      bestValue = currentValue;
      bestMask = selectedMask;
    }
    if (k >= n || currentValue + bound(k, remainingCapacity) <= bestValue) return;

    const idx = order[k];
    const w = weights[idx];
    if (w <= remainingCapacity && (conflictMask[idx] & selectedMask) === 0) {
      dfs(k + 1, remainingCapacity - w, selectedMask | (1 << idx), currentValue + values[idx]);
    }
    dfs(k + 1, remainingCapacity, selectedMask, currentValue);
  }

  dfs(0, capacity, 0, 0);

  const optimalSelection = new Array(n).fill(false);
  for (let i = 0; i < n; i++) optimalSelection[i] = (bestMask & (1 << i)) !== 0;

  return { ...instance, optimalValue: bestValue, optimalSelection };
}

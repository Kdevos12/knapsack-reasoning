#!/usr/bin/env node
/**
 * Extended measurement harness for proper calibration audit.
 * Tests multiple heuristics that actually matter:
 * - greedy-by-ratio (baseline, naive)
 * - combined-ratio (for dim2 rounds)
 * - best-of-20 random-fill conflict-aware (for conflict rounds)
 * - uncorrelated baseline (to verify onboarding isn't already too hard)
 *
 * Usage: npx tsx src/harness-extended.ts
 */

import { difficultyToParams, generateInstance } from './instanceGenerator';
import { solveKnapsack } from './knapsackSolver';
import type { SolvedInstance } from './types';

/**
 * Greedy-by-ratio: value/weight descending.
 */
function greedyByRatio(instance: SolvedInstance): number {
  const { weights, values, capacity, weights2, capacity2, conflicts } = instance;
  const n = weights.length;

  const ratios = weights.map((w, i) => ({
    index: i,
    ratio: values[i] / w,
  }));

  ratios.sort((a, b) => b.ratio - a.ratio);

  const selected = new Array(n).fill(false);
  let remainingCap = capacity;
  let remainingCap2 = capacity2 ?? Infinity;

  for (const { index } of ratios) {
    const w = weights[index];
    const w2 = weights2?.[index] ?? 0;

    if (w > remainingCap || w2 > remainingCap2) continue;

    if (conflicts) {
      let conflictOk = true;
      for (const [a, b] of conflicts) {
        if ((index === a && selected[b]) || (index === b && selected[a])) {
          conflictOk = false;
          break;
        }
      }
      if (!conflictOk) continue;
    }

    selected[index] = true;
    remainingCap -= w;
    if (capacity2) remainingCap2 -= w2;
  }

  return selected.reduce((sum, sel, i) => (sel ? sum + values[i] : sum), 0);
}

/**
 * Combined-ratio heuristic for dim2: sort by value / (w1 + w2) ratio.
 * Used for 2-constraint rounds.
 */
function combinedRatioDim2(instance: SolvedInstance): number {
  const { weights, values, capacity, weights2, capacity2 } = instance;
  if (!weights2 || !capacity2) return 0; // Not a dim2 instance

  const n = weights.length;
  const ratios = weights.map((w, i) => ({
    index: i,
    ratio: values[i] / (w + weights2[i]),
  }));

  ratios.sort((a, b) => b.ratio - a.ratio);

  const selected = new Array(n).fill(false);
  let remainingCap = capacity;
  let remainingCap2 = capacity2;

  for (const { index } of ratios) {
    const w = weights[index];
    const w2 = weights2[index];

    if (w > remainingCap || w2 > remainingCap2) continue;

    selected[index] = true;
    remainingCap -= w;
    remainingCap2 -= w2;
  }

  return selected.reduce((sum, sel, i) => (sel ? sum + values[i] : sum), 0);
}

/**
 * Best-of-20 random-fill conflict-aware: 20 random selections,
 * return the one with highest value that respects conflicts.
 * (Documented in README as remaining 65-85% success vs optimal under old metric.)
 */
function bestOf20RandomFillConflictAware(instance: SolvedInstance, seed: number): number {
  const { weights, values, capacity, weights2, capacity2, conflicts } = instance;
  const n = weights.length;

  let bestValue = 0;

  for (let attempt = 0; attempt < 20; attempt++) {
    const indices = Array.from({ length: n }, (_, i) => i);

    // Shuffle with a simple seeded RNG
    let rng = seed + attempt;
    for (let i = indices.length - 1; i > 0; i--) {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      const j = rng % (i + 1);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const selected = new Array(n).fill(false);
    let remainingCap = capacity;
    let remainingCap2 = capacity2 ?? Infinity;

    for (const index of indices) {
      const w = weights[index];
      const w2 = weights2?.[index] ?? 0;

      if (w > remainingCap || w2 > remainingCap2) continue;

      // Check conflicts
      if (conflicts) {
        let conflictOk = true;
        for (const [a, b] of conflicts) {
          if ((index === a && selected[b]) || (index === b && selected[a])) {
            conflictOk = false;
            break;
          }
        }
        if (!conflictOk) continue;
      }

      selected[index] = true;
      remainingCap -= w;
      if (capacity2) remainingCap2 -= w2;
    }

    const value = selected.reduce((sum, sel, i) => (sel ? sum + values[i] : sum), 0);
    bestValue = Math.max(bestValue, value);
  }

  return bestValue;
}

interface MeasurementRow {
  difficulty: number;
  nItems: number;
  mechanism: 'none' | 'trap' | 'dim2' | 'conflict';
  correlation: string;
  greedyRatio: number; // % exact-optimal
  combinedRatio: number; // % exact-optimal (for dim2 only)
  random20: number; // % exact-optimal (for conflict only)
}

function measureAtDifficulty(difficulty: number, sampleCount: number = 20): MeasurementRow {
  const baseParams = difficultyToParams(difficulty);
  const params = { ...baseParams, correlation: 'strongly_correlated' as const };

  let greedySuccess = 0;
  let combinedSuccess = 0;
  let randomSuccess = 0;
  let mechanism: 'none' | 'trap' | 'dim2' | 'conflict' = 'none';
  let nItemsSum = 0;

  for (let i = 0; i < sampleCount; i++) {
    const seed = difficulty * 10000 + i;
    const instance = solveKnapsack(generateInstance(params, seed, difficulty));
    const optimal = instance.optimalValue;

    // Greedy ratio
    const greedyValue = greedyByRatio(instance);
    if (greedyValue === optimal) greedySuccess++;

    // Combined ratio (only for dim2)
    if (params.dim2) {
      const combinedValue = combinedRatioDim2(instance);
      if (combinedValue === optimal) combinedSuccess++;
    }

    // Best-of-20 random fill (only for conflict)
    if (params.conflict) {
      const randomValue = bestOf20RandomFillConflictAware(instance, seed);
      if (randomValue === optimal) randomSuccess++;
    }

    nItemsSum += params.nItems;

    if (params.trap) mechanism = 'trap';
    else if (params.dim2) mechanism = 'dim2';
    else if (params.conflict) mechanism = 'conflict';
  }

  return {
    difficulty,
    nItems: Math.round(nItemsSum / sampleCount),
    mechanism,
    correlation: params.correlation,
    greedyRatio: (greedySuccess / sampleCount) * 100,
    combinedRatio: params.dim2 ? (combinedSuccess / sampleCount) * 100 : -1,
    random20: params.conflict ? (randomSuccess / sampleCount) * 100 : -1,
  };
}

function runExtendedAudit() {
  // Include lower difficulties to verify onboarding baseline
  const difficulties = [
    0, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400,
    500, 600,
  ];

  console.log('\n=== EXTENDED RAMP AUDIT (exactOptimal, multiple heuristics) ===\n');
  console.log(
    'Difficulty | nItems | Mechanism | Greedy % | Combined % | Random20 %',
  );
  console.log(
    '-----------|--------|-----------|----------|------------|------------',
  );

  const results: MeasurementRow[] = [];

  for (const d of difficulties) {
    const result = measureAtDifficulty(d, 20);
    results.push(result);

    const mechStr = result.mechanism.padEnd(9);
    const greedyStr = result.greedyRatio.toFixed(1).padStart(7);
    const combinedStr = result.combinedRatio >= 0 ? result.combinedRatio.toFixed(1).padStart(9) : '     —  ';
    const randomStr = result.random20 >= 0 ? result.random20.toFixed(1).padStart(10) : '     —  ';

    console.log(
      `${String(result.difficulty).padEnd(10)} | ${String(result.nItems).padEnd(6)} | ${mechStr} | ${greedyStr}% | ${combinedStr}% | ${randomStr}%`,
    );
  }

  console.log('\n=== ONBOARDING BASELINE (difficulty 0-50) ===\n');

  const baseline = results.filter((r) => r.difficulty <= 50);
  if (baseline.length > 0) {
    const avgGreedy = baseline.reduce((s, r) => s + r.greedyRatio, 0) / baseline.length;
    console.log(`Average greedy-ratio success (uncorrelated/weakly, low nItems): ${avgGreedy.toFixed(1)}%`);
    if (avgGreedy < 50) {
      console.log(
        `  WARNING: Onboarding may be too hard even under basic conditions.`,
      );
    } else {
      console.log(`  OK: Onboarding baseline looks reasonable.`);
    }
  }

  console.log('\n=== MECHANISM UNLOCK ANALYSIS ===\n');

  const trapRows = results.filter((r) => r.mechanism === 'trap' && r.difficulty >= 400);
  if (trapRows.length > 0) {
    console.log('TRAP (difficulty 400+):');
    for (const row of trapRows.slice(-3)) {
      console.log(
        `  D${row.difficulty}: greedy=${row.greedyRatio.toFixed(1)}%`,
      );
    }
    const avgTrapGreedy = trapRows.reduce((s, r) => s + r.greedyRatio, 0) / trapRows.length;
    console.log(`  Average greedy success: ${avgTrapGreedy.toFixed(1)}%`);
  }

  const dim2Rows = results.filter((r) => r.mechanism === 'dim2' && r.difficulty >= 250);
  if (dim2Rows.length > 0) {
    console.log('DIM2 (difficulty 250+):');
    for (const row of dim2Rows.slice(-3)) {
      console.log(
        `  D${row.difficulty}: greedy=${row.greedyRatio.toFixed(1)}%, combined=${row.combinedRatio.toFixed(1)}%`,
      );
    }
    const avgDim2Combined = dim2Rows.reduce((s, r) => s + r.combinedRatio, 0) / dim2Rows.length;
    console.log(`  Average combined-ratio success: ${avgDim2Combined.toFixed(1)}%`);
    if (avgDim2Combined > 50) {
      console.log(
        `  INFO: combined-ratio still >50% — dim2 ramping may need acceleration.`,
      );
    }
  }

  const conflictRows = results.filter((r) => r.mechanism === 'conflict' && r.difficulty >= 350);
  if (conflictRows.length > 0) {
    console.log('CONFLICT (difficulty 350+):');
    for (const row of conflictRows) {
      console.log(
        `  D${row.difficulty}: greedy=${row.greedyRatio.toFixed(1)}%, random-fill=${row.random20.toFixed(1)}%`,
      );
    }
    const avgConflictRandom = conflictRows.reduce((s, r) => s + r.random20, 0) / conflictRows.length;
    console.log(`  Average random-fill success: ${avgConflictRandom.toFixed(1)}%`);
    if (avgConflictRandom > 50) {
      console.log(
        `  INFO: random-fill still >50% — conflict ramping may need acceleration.`,
      );
    }
  }

  console.log('\n=== CONCLUSIONS ===\n');
  console.log('If combined-ratio or random-fill show >50% at high difficulty,');
  console.log('that suggests the ramps are still too lenient for the exactOptimal criterion.');
  console.log('Adjust *_GROWTH_RATE or strength parameters accordingly.\n');
}

runExtendedAudit();

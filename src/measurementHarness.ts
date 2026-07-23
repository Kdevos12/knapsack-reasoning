/**
 * Measurement harness: audit greedy heuristic success rates under exact-optimal
 * criterion, against target success bands (~30–50%), to calibrate ramp constants.
 *
 * This is a manual offline tool, not part of the live app. Run it to validate
 * that empirical success rates match design targets before changing TRAP_*,
 * CONFLICT_*, DIM2_* constants.
 *
 * Usage (Node.js):
 *   npx ts-node src/measurementHarness.ts
 */

import { difficultyToParams, generateInstance } from './instanceGenerator';
import { solveKnapsack } from './knapsackSolver';
import type { SolvedInstance } from './types';

interface MeasurementResult {
  difficulty: number;
  nItems: number;
  mechanism: 'none' | 'trap' | 'dim2' | 'conflict';
  correlation: string;
  greedySuccessRate: number; // % of trials where greedy reached exact optimum
  greedyAvgQuality: number; // average qualityRatio
  sampleCount: number;
}

/**
 * Greedy-by-ratio heuristic: sort by value/weight descending, pack until full.
 * Returns the total value of the greedy selection.
 */
function greedyByRatio(instance: SolvedInstance): number {
  const { weights, values, capacity, weights2, capacity2, conflicts } = instance;
  const n = weights.length;

  const ratios = weights.map((w, i) => ({
    index: i,
    ratio: values[i] / w,
  }));

  // Sort by ratio descending
  ratios.sort((a, b) => b.ratio - a.ratio);

  const selected = new Array(n).fill(false);
  let remainingCap = capacity;
  let remainingCap2 = capacity2 ?? Infinity;

  for (const { index } of ratios) {
    const w = weights[index];
    const w2 = weights2?.[index] ?? 0;

    // Check capacity constraints
    if (w > remainingCap || w2 > remainingCap2) continue;

    // Check conflict constraints
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

    // Take this item
    selected[index] = true;
    remainingCap -= w;
    if (capacity2) remainingCap2 -= w2;
  }

  return selected.reduce((sum, sel, i) => (sel ? sum + values[i] : sum), 0);
}

/**
 * Measure heuristic success rate at a given difficulty level.
 * Generates `sampleCount` instances, runs greedy, measures exact-optimal rate.
 */
function measureAtDifficulty(
  difficulty: number,
  sampleCount: number = 20,
): MeasurementResult {
  const baseParams = difficultyToParams(difficulty);
  const params = { ...baseParams, correlation: 'strongly_correlated' as const };

  let successCount = 0;
  let totalQuality = 0;
  let mechanism: 'none' | 'trap' | 'dim2' | 'conflict' = 'none';
  let nItemsSum = 0;

  for (let i = 0; i < sampleCount; i++) {
    const instance = solveKnapsack(generateInstance(params, difficulty * 1000 + i));
    const greedyValue = greedyByRatio(instance);
    const isExactOptimal = greedyValue === instance.optimalValue;
    const quality = instance.optimalValue > 0 ? greedyValue / instance.optimalValue : 0;

    if (isExactOptimal) successCount++;
    totalQuality += quality;
    nItemsSum += params.nItems;

    // Track which mechanism was active
    if (params.trap) mechanism = 'trap';
    else if (params.dim2) mechanism = 'dim2';
    else if (params.conflict) mechanism = 'conflict';
  }

  return {
    difficulty,
    nItems: Math.round(nItemsSum / sampleCount),
    mechanism,
    correlation: params.correlation,
    greedySuccessRate: (successCount / sampleCount) * 100,
    greedyAvgQuality: (totalQuality / sampleCount) * 100,
    sampleCount,
  };
}

/**
 * Run full audit across difficulty range, reporting results.
 * Looks for mechanism transitions and success bands.
 */
export function auditRampConstants(): void {
  const difficulties = [
    0, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 500, 600,
  ];

  console.log('\n=== RAMP CONSTANT AUDIT ===\n');
  console.log(
    'difficulty | nItems | mechanism | correlation        | greedy-exact % | avg-quality %',
  );
  console.log(
    '-----------|--------|-----------|---------------------|----------------|---------------',
  );

  const results: MeasurementResult[] = [];

  for (const d of difficulties) {
    const result = measureAtDifficulty(d, 20);
    results.push(result);

    const mechStr = result.mechanism.padEnd(9);
    const corrStr = result.correlation.padEnd(19);
    console.log(
      `${String(result.difficulty).padEnd(10)}| ${String(result.nItems).padEnd(6)}| ${mechStr}| ${corrStr}| ${result.greedySuccessRate.toFixed(1).padStart(13)}% | ${result.greedyAvgQuality.toFixed(1).padStart(12)}%`,
    );
  }

  console.log('\n=== ANALYSIS ===\n');

  // Find mechanism unlock points
  const trapUnlock = results.find((r) => r.mechanism === 'trap');
  const dim2Unlock = results.find((r) => r.mechanism === 'dim2');
  const conflictUnlock = results.find((r) => r.mechanism === 'conflict');

  if (trapUnlock) {
    console.log(`Trap unlocks at difficulty ~${trapUnlock.difficulty}`);
    console.log(`  → At unlock: ${trapUnlock.greedySuccessRate.toFixed(1)}% exact-optimal`);
  }

  if (dim2Unlock) {
    console.log(`Dim2 unlocks at difficulty ~${dim2Unlock.difficulty}`);
    console.log(`  → At unlock: ${dim2Unlock.greedySuccessRate.toFixed(1)}% exact-optimal`);
  }

  if (conflictUnlock) {
    console.log(`Conflict unlocks at difficulty ~${conflictUnlock.difficulty}`);
    console.log(`  → At unlock: ${conflictUnlock.greedySuccessRate.toFixed(1)}% exact-optimal`);
  }

  // Check target band (30–50%) for each mechanism
  const checkBand = (results: MeasurementResult[], mechanism: string, bandMin = 30, bandMax = 50) => {
    const filtered = results.filter((r) => r.mechanism === mechanism && r.difficulty >= 150);
    if (filtered.length === 0) return;

    const inBand = filtered.filter((r) => r.greedySuccessRate >= bandMin && r.greedySuccessRate <= bandMax);
    const ratio = inBand.length / filtered.length;

    console.log(`\n${mechanism.toUpperCase()}:`);
    console.log(`  Coverage of ${bandMin}–${bandMax}% target: ${(ratio * 100).toFixed(0)}%`);

    if (ratio < 0.5) {
      const avgRate = filtered.reduce((s, r) => s + r.greedySuccessRate, 0) / filtered.length;
      if (avgRate > bandMax) {
        console.log(`  ⚠ Success rate is too high (avg ${avgRate.toFixed(1)}%) — increase difficulty or reduce strength.`);
      } else {
        console.log(
          `  ⚠ Success rate is too low (avg ${avgRate.toFixed(1)}%) — decrease difficulty or increase strength.`,
        );
      }
    } else {
      console.log(`  ✓ Success rates well-calibrated.`);
    }
  };

  checkBand(results, 'trap');
  checkBand(results, 'dim2');
  checkBand(results, 'conflict');

  console.log(
    '\nNote: Target band is 30–50% exact-optimal for the dominant heuristic at each tier.',
  );
  console.log('If your empirical rates drift significantly, adjust TRAP_START_DIFFICULTY,');
  console.log(
    'TRAP_GROWTH_RATE, DIM2_GROWTH_RATE, CONFLICT_GROWTH_RATE in instanceGenerator.ts.\n',
  );
}

export default auditRampConstants;

#!/usr/bin/env node
/**
 * Standalone measurement harness runner.
 * Executes inline to measure ramp constants without needing build/import gymnastics.
 * Usage: npx ts-node src/harness-runner.ts
 */

import { difficultyToParams, generateInstance } from './instanceGenerator';
import { solveKnapsack } from './knapsackSolver';
import type { SolvedInstance } from './types';

/**
 * Greedy-by-ratio heuristic: sort by value/weight descending, pack until full.
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

interface MeasurementResult {
  difficulty: number;
  nItems: number;
  mechanism: 'none' | 'trap' | 'dim2' | 'conflict';
  greedySuccessRate: number;
  greedyAvgQuality: number;
}

function measureAtDifficulty(difficulty: number, sampleCount: number = 20): MeasurementResult {
  const baseParams = difficultyToParams(difficulty);
  const params = { ...baseParams, correlation: 'strongly_correlated' as const };

  let successCount = 0;
  let totalQuality = 0;
  let mechanism: 'none' | 'trap' | 'dim2' | 'conflict' = 'none';
  let nItemsSum = 0;

  for (let i = 0; i < sampleCount; i++) {
    const instance = solveKnapsack(
      generateInstance(params, difficulty * 1000 + i),
    );
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
    greedySuccessRate: (successCount / sampleCount) * 100,
    greedyAvgQuality: (totalQuality / sampleCount) * 100,
  };
}

function runAudit() {
  const difficulties = [
    0, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 500, 600,
  ];

  console.log('\n=== RAMP CONSTANT AUDIT (exactOptimal criterion) ===\n');
  console.log(
    'Difficulty | nItems | Mechanism | Greedy Exact % | Avg Quality %',
  );
  console.log(
    '------------|--------|-----------|----------------|---------------',
  );

  const results: MeasurementResult[] = [];

  for (const d of difficulties) {
    const result = measureAtDifficulty(d, 20);
    results.push(result);

    const mechStr = result.mechanism.padEnd(9);
    console.log(
      `${String(result.difficulty).padEnd(10)} | ${String(result.nItems).padEnd(6)} | ${mechStr} | ${result.greedySuccessRate.toFixed(1).padStart(13)}% | ${result.greedyAvgQuality.toFixed(1).padStart(12)}%`,
    );
  }

  console.log('\n=== MECHANISM UNLOCK POINTS ===\n');

  const trapUnlock = results.find((r) => r.mechanism === 'trap');
  if (trapUnlock) {
    console.log(`Trap unlocks around difficulty ${trapUnlock.difficulty}`);
    console.log(`  → Initial exact-optimal rate: ${trapUnlock.greedySuccessRate.toFixed(1)}%`);
  }

  const dim2Unlock = results.find((r) => r.mechanism === 'dim2');
  if (dim2Unlock) {
    console.log(`Dim2 unlocks around difficulty ${dim2Unlock.difficulty}`);
    console.log(`  → Initial exact-optimal rate: ${dim2Unlock.greedySuccessRate.toFixed(1)}%`);
  }

  const conflictUnlock = results.find((r) => r.mechanism === 'conflict');
  if (conflictUnlock) {
    console.log(`Conflict unlocks around difficulty ${conflictUnlock.difficulty}`);
    console.log(`  → Initial exact-optimal rate: ${conflictUnlock.greedySuccessRate.toFixed(1)}%`);
  }

  console.log('\n=== TARGET BAND ANALYSIS (30–50% exactOptimal) ===\n');

  const checkBand = (
    results: MeasurementResult[],
    mechanism: string,
    bandMin = 30,
    bandMax = 50,
  ) => {
    const filtered = results.filter(
      (r) => r.mechanism === mechanism && r.difficulty >= 150,
    );
    if (filtered.length === 0) return;

    const inBand = filtered.filter(
      (r) => r.greedySuccessRate >= bandMin && r.greedySuccessRate <= bandMax,
    );
    const coverage = (inBand.length / filtered.length) * 100;
    const avgRate = filtered.reduce((s, r) => s + r.greedySuccessRate, 0) / filtered.length;

    console.log(`${mechanism.toUpperCase()}:`);
    console.log(`  Coverage of ${bandMin}–${bandMax}% target: ${coverage.toFixed(0)}%`);
    console.log(`  Average exact-optimal rate: ${avgRate.toFixed(1)}%`);

    if (coverage < 50) {
      if (avgRate > bandMax) {
        console.log(
          `  WARNING: Success rate too HIGH — increase unlock difficulty or reduce strength.`,
        );
      } else {
        console.log(
          `  WARNING: Success rate too LOW — decrease unlock difficulty or increase strength.`,
        );
      }
    } else {
      console.log(`  OK: Well-calibrated.`);
    }
    console.log();
  };

  checkBand(results, 'trap');
  checkBand(results, 'dim2');
  checkBand(results, 'conflict');

  console.log('Recommendation:');
  console.log('  If any mechanism is out of band, adjust in instanceGenerator.ts:');
  console.log(
    '    - TRAP_START_DIFFICULTY, TRAP_GROWTH_RATE for trap',
  );
  console.log(
    '    - DIM2_START_DIFFICULTY, DIM2_GROWTH_RATE for dim2',
  );
  console.log(
    '    - CONFLICT_START_DIFFICULTY, CONFLICT_GROWTH_RATE for conflict',
  );
  console.log();
}

runAudit();

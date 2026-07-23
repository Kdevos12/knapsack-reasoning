#!/usr/bin/env node
/**
 * Diagnostic harness: decomposed by correlation type to identify
 * if greedy success collapses at unlock or progressively.
 *
 * Tests each correlation type separately at difficulties spanning
 * before/at/after its unlock point.
 *
 * Usage: npx tsx src/harness-diagnostic.ts
 */

import { difficultyToParams, generateInstance } from './instanceGenerator';
import { solveKnapsack } from './knapsackSolver';
import type { CorrelationType, SolvedInstance } from './types';

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

interface CorrelationMeasure {
  difficulty: number;
  correlation: CorrelationType;
  tightness: number;
  greedySuccessRate: number;
  sampleCount: number;
}

function measureGreedyAtDifficultyForCorrelation(
  difficulty: number,
  correlation: CorrelationType,
  sampleCount: number = 25,
): CorrelationMeasure {
  const baseParams = difficultyToParams(difficulty);
  const params = { ...baseParams, correlation };

  let successCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    const seed = difficulty * 10000 + i;
    const instance = solveKnapsack(generateInstance(params, seed, difficulty));
    const greedyValue = greedyByRatio(instance);
    if (greedyValue === instance.optimalValue) {
      successCount++;
    }
  }

  return {
    difficulty,
    correlation,
    tightness: params.correlationTightness ?? 0,
    greedySuccessRate: (successCount / sampleCount) * 100,
    sampleCount,
  };
}

function runDiagnosticAudit() {
  // Difficulties to test: fine-grained around unlocks
  const testDifficulties = [
    0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100,
    120, 150, 200,
  ];

  const allCorrelations: CorrelationType[] = [
    'uncorrelated',
    'weakly_correlated',
    'strongly_correlated',
    'subset_sum',
  ];

  const correlationUnlocks = {
    uncorrelated: 0,
    weakly_correlated: 30,
    strongly_correlated: 60,
    subset_sum: 85,
  };

  console.log(
    '\n=== DIAGNOSTIC: Greedy Success by Correlation Type (exactOptimal) ===\n',
  );

  const allResults: CorrelationMeasure[] = [];

  // Measure each correlation at each difficulty
  for (const corr of allCorrelations) {
    console.log(`\n--- ${corr.toUpperCase()} (unlock at D${correlationUnlocks[corr]}) ---\n`);
    console.log('Difficulty | Tightness | Greedy Success % | Status');
    console.log('-----------|-----------|-----------------|--------------------------------------');

    const results = testDifficulties
      .filter((d) => d >= correlationUnlocks[corr]) // Only test at/after unlock
      .map((d) => measureGreedyAtDifficultyForCorrelation(d, corr, 25));

    for (const result of results) {
      allResults.push(result);
      const status = getStatus(result, correlationUnlocks[corr]);
      const tightnessStr = result.tightness.toFixed(3);
      const successStr = result.greedySuccessRate.toFixed(1).padStart(5);
      console.log(
        `${String(result.difficulty).padEnd(10)} | ${tightnessStr.padEnd(9)} | ${successStr}%           | ${status}`,
      );
    }
  }

  console.log(
    '\n=== ANALYSIS: Do heuristics collapse at unlock or degrade progressively? ===\n',
  );

  for (const corr of allCorrelations) {
    const unlock = correlationUnlocks[corr];
    const measurements = allResults.filter((r) => r.correlation === corr);

    if (measurements.length === 0) {
      console.log(`${corr}: No data (unlock too late for test range).`);
      continue;
    }

    const first = measurements[0];
    const last = measurements[measurements.length - 1];
    const avg = measurements.reduce((s, m) => s + m.greedySuccessRate, 0) / measurements.length;

    console.log(`${corr.toUpperCase()}:`);
    console.log(`  Unlock: D${unlock}, tightness=${first.tightness.toFixed(3)}`);
    console.log(
      `  At unlock (D${first.difficulty}): ${first.greedySuccessRate.toFixed(1)}% success`,
    );
    console.log(`  Latest (D${last.difficulty}): ${last.greedySuccessRate.toFixed(1)}% success`);
    console.log(`  Average across range: ${avg.toFixed(1)}%`);

    // Detect pattern
    if (first.greedySuccessRate < 20 && avg < 20) {
      console.log(`  PATTERN: Collapsed at unlock and stayed low → tightnessSinceUnlock fix needed.`);
    } else if (first.greedySuccessRate > 40 && last.greedySuccessRate < 20) {
      console.log(`  PATTERN: Degraded progressively from unlock → ramp is working as intended.`);
    } else if (first.greedySuccessRate > 40 && avg > 30) {
      console.log(`  PATTERN: Stayed strong across range → may be too lenient.`);
    } else {
      console.log(`  PATTERN: Mixed/unclear.`);
    }
    console.log();
  }

  console.log(
    '=== INTERPRETATION GUIDE ===\n',
  );
  console.log(
    'If uncorrelated/weakly/strongly show COLLAPSED pattern at unlock,',
  );
  console.log('the fix is to add tightnessSinceUnlock (like dim2Params does),');
  console.log('NOT to lower a global correlationTightness parameter.\n',
  );
}

function getStatus(result: CorrelationMeasure, unlockD: number): string {
  const diff = result.difficulty - unlockD;
  const pct = result.greedySuccessRate;

  if (diff === 0) return `[UNLOCK POINT] ${pct.toFixed(1)}%`;
  if (pct < 20) return `LOW (${pct.toFixed(1)}%)`;
  if (pct < 40) return `MEDIUM (${pct.toFixed(1)}%)`;
  return `HIGH (${pct.toFixed(1)}%)`;
}

runDiagnosticAudit();

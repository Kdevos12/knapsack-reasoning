#!/usr/bin/env node
/**
 * Extended diagnostic harness: full table output with dense sampling
 * from each correlation unlock point, to validate calibration with
 * anchored tightness.
 *
 * OUTPUTS: Complete raw table with all measurements (not summaries).
 *
 * Usage: npx tsx src/harness-validate-fix.ts
 */

import { difficultyToParams, generateInstance } from './instanceGenerator';
import { solveKnapsack } from './knapsackSolver';
import type { CorrelationType, SolvedInstance } from './types';

/**
 * Greedy-by-ratio
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

interface Measurement {
  difficulty: number;
  correlation: CorrelationType;
  greedyExactOptimalCount: number; // raw count
  sampleCount: number;
  greedySuccessPercent: number; // computed
}

function measureAtDifficultyCorrelation(
  difficulty: number,
  correlation: CorrelationType,
  sampleCount: number = 30,
): Measurement {
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
    greedyExactOptimalCount: successCount,
    sampleCount,
    greedySuccessPercent: (successCount / sampleCount) * 100,
  };
}

function runValidationAudit() {
  console.log('=== RAW MEASUREMENT TABLE (correlationTightnessFor anchored) ===\n');
  console.log(
    'Difficulty | Correlation         | Samples | Exact-Optimal Count | Success %',
  );
  console.log(
    '------------|---------------------|---------|---------------------|----------',
  );

  const allMeasurements: Measurement[] = [];

  // Dense sampling: from each unlock point, measure every 10-15 points for 100 difficulty units past unlock
  const testPoints = [
    // Uncorrelated (unlock D0): 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    { corr: 'uncorrelated' as CorrelationType, diffs: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] },
    // Weakly (unlock D30): 30, 40, 50, 60, 70, 80, 90, 100, 120
    { corr: 'weakly_correlated' as CorrelationType, diffs: [30, 40, 50, 60, 70, 80, 90, 100, 120] },
    // Strongly (unlock D60): 60, 70, 80, 90, 100, 120, 150, 180, 200
    { corr: 'strongly_correlated' as CorrelationType, diffs: [60, 70, 80, 90, 100, 120, 150, 180, 200] },
    // Subset_sum (unlock D85): 90, 100, 120, 150, 180, 200, 250, 300, 350
    { corr: 'subset_sum' as CorrelationType, diffs: [90, 100, 120, 150, 180, 200, 250, 300, 350] },
  ];

  for (const { corr, diffs } of testPoints) {
    for (const diff of diffs) {
      const m = measureAtDifficultyCorrelation(diff, corr, 30);
      allMeasurements.push(m);

      const corrStr = corr.padEnd(21);
      const countStr = String(m.greedyExactOptimalCount).padStart(3);
      const pctStr = m.greedySuccessPercent.toFixed(1).padStart(5);
      console.log(
        `${String(diff).padEnd(10)} | ${corrStr} | ${String(m.sampleCount).padEnd(7)} | ${countStr}/30                  | ${pctStr}%`,
      );
    }
    console.log(); // Blank line between correlation types
  }

  console.log('\n=== VALIDATION CHECKS ===\n');

  // 1. Check each type at its own unlock point
  console.log('At unlock points (should be 30-50%):');
  const unlockPoints = [
    { corr: 'uncorrelated' as CorrelationType, d: 0 },
    { corr: 'weakly_correlated' as CorrelationType, d: 30 },
    { corr: 'strongly_correlated' as CorrelationType, d: 60 },
    { corr: 'subset_sum' as CorrelationType, d: 90 }, // First measurement point after D85 unlock
  ];

  for (const { corr, d } of unlockPoints) {
    const m = allMeasurements.find((x) => x.difficulty === d && x.correlation === corr);
    if (m) {
      const status = m.greedySuccessPercent >= 30 && m.greedySuccessPercent <= 50 ? 'OK' : 'OUT OF BAND';
      console.log(`  ${corr.padEnd(21)} @ D${d}: ${m.greedySuccessPercent.toFixed(1)}% [${status}]`);
    }
  }

  // 2. Check transition smoothness: weakly @ D30 vs strongly @ D60
  console.log('\nTransition smoothness (weakly D30 vs strongly D60):');
  const weakly30 = allMeasurements.find((x) => x.difficulty === 30 && x.correlation === 'weakly_correlated');
  const strongly60 = allMeasurements.find((x) => x.difficulty === 60 && x.correlation === 'strongly_correlated');
  if (weakly30 && strongly60) {
    const diff = Math.abs(weakly30.greedySuccessPercent - strongly60.greedySuccessPercent);
    console.log(`  Weakly @ D30: ${weakly30.greedySuccessPercent.toFixed(1)}%`);
    console.log(`  Strongly @ D60: ${strongly60.greedySuccessPercent.toFixed(1)}%`);
    console.log(`  Gap: ${diff.toFixed(1)}% (should be < 20% for smooth transition)`);
  }

  // 3. Check subset_sum ramp window (D85 -> D485 under new scheme)
  console.log('\nSubset_sum ramp window (D85 -> D485):');
  const subsetAtUnlock = allMeasurements.filter((x) => x.correlation === 'subset_sum').slice(0, 2);
  const subsetLate = allMeasurements.filter((x) => x.correlation === 'subset_sum').slice(-1);
  if (subsetAtUnlock.length > 0 && subsetLate.length > 0) {
    console.log(`  Early (D${subsetAtUnlock[0].difficulty}): ${subsetAtUnlock[0].greedySuccessPercent.toFixed(1)}%`);
    console.log(`  Late (D${subsetLate[0].difficulty}): ${subsetLate[0].greedySuccessPercent.toFixed(1)}%`);
    console.log(`  Window length: ~400 points (D85 to D485, then ramps to tightness=1)`);
  }

  console.log('\n=== DECISION CRITERIA ===');
  console.log('PASS if:');
  console.log('  1. Each type 30-50% at unlock');
  console.log('  2. Weakly/Strongly gap < 20% at transition');
  console.log('  3. Subset_sum ramp not anomalously flat');
  console.log('  Otherwise: adjust lerp bounds in correlation tightness calculation.\n');
}

runValidationAudit();

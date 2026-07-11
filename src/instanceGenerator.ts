import { mulberry32, randInt } from './rng';
import type { CorrelationType, GenerationParams, KnapsackInstance } from './types';
import { SAFETY_BOUNDS } from './types';

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * Math.max(0, Math.min(1, t));
}

// Deterministic difficulty -> generation params mapping. One monotonic table,
// no search/optimization loop: the item count, ranges and correlation type
// scale directly with the requested difficulty scalar (0-100).
export function difficultyToParams(difficulty: number): GenerationParams {
  const t = difficulty / 100;
  const nItems = Math.round(lerp(SAFETY_BOUNDS.nItemsMin, SAFETY_BOUNDS.nItemsMax, t));
  const spread = Math.round(lerp(12, SAFETY_BOUNDS.weightMax, t));

  let correlation: CorrelationType;
  if (t < 0.3) correlation = 'uncorrelated';
  else if (t < 0.6) correlation = 'weakly_correlated';
  else if (t < 0.85) correlation = 'strongly_correlated';
  else correlation = 'subset_sum';

  // Harder instances sit closer to the 0.5 capacity/total-weight phase
  // transition (Pisinger 2005); easy instances give more slack so most
  // items plausibly fit and the choice isn't a tight packing puzzle.
  const capacityRatio = lerp(0.72, 0.5, t);

  return {
    nItems,
    weightRange: [1, spread],
    valueRange: [1, spread],
    capacityRatio,
    correlation,
  };
}

export function generateInstance(params: GenerationParams, seed: number = Date.now()): KnapsackInstance {
  const rng = mulberry32(seed);
  const { nItems, weightRange, valueRange, capacityRatio, correlation } = params;

  const weights = Array.from({ length: nItems }, () => randInt(rng, weightRange[0], weightRange[1]));
  const [vMin, vMax] = valueRange;

  const values = weights.map((w) => {
    switch (correlation) {
      case 'uncorrelated':
        return randInt(rng, vMin, vMax);
      case 'weakly_correlated': {
        const jitter = Math.round((vMax - vMin) * 0.2) || 1;
        return Math.max(vMin, Math.min(vMax, w + randInt(rng, -jitter, jitter)));
      }
      case 'strongly_correlated':
        return Math.max(vMin, Math.min(vMax, w + Math.round((vMax - vMin) * 0.1)));
      case 'subset_sum':
        return Math.max(vMin, Math.min(vMax, w));
      default:
        return randInt(rng, vMin, vMax);
    }
  });

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const capacity = Math.max(weightRange[0], Math.round(totalWeight * capacityRatio));

  return { weights, values, capacity };
}

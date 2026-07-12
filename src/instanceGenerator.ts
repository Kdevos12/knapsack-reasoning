import { mulberry32, randInt } from './rng';
import type { CorrelationType, GenerationParams, KnapsackInstance } from './types';
import { SAFETY_BOUNDS } from './types';

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * Math.max(0, Math.min(1, t));
}

// Deterministic difficulty -> generation params mapping (everything except
// correlation, which is drawn separately — see unlockedCorrelations/
// drawCorrelation below). One monotonic table, no search/optimization loop:
// item count and ranges scale directly with the requested difficulty scalar.
// 0-100 is the tuned "core" range; there is no ceiling above that — the
// adaptive staircase can push difficulty past 100 indefinitely, so item
// count and spread keep growing (sqrt-scaled, so the exact DP solver stays
// fast) instead of freezing every instance at its difficulty-100 shape.
export function difficultyToParams(difficulty: number): Omit<GenerationParams, 'correlation'> {
  const t = Math.min(1, difficulty / 100);
  const over = Math.max(0, difficulty - 100);
  const extraItems = Math.floor(Math.sqrt(over));
  const extraSpread = Math.round(Math.sqrt(over) * 4);

  const nItems = Math.round(lerp(SAFETY_BOUNDS.nItemsMin, SAFETY_BOUNDS.nItemsMax, t)) + extraItems;
  const spread = Math.round(lerp(12, SAFETY_BOUNDS.weightMax, t)) + extraSpread;

  // Harder instances sit closer to the 0.5 capacity/total-weight phase
  // transition (Pisinger 2005); easy instances give more slack so most
  // items plausibly fit and the choice isn't a tight packing puzzle.
  const capacityRatio = lerp(0.72, 0.5, t);

  return {
    nItems,
    weightRange: [1, spread],
    valueRange: [1, spread],
    capacityRatio,
  };
}

// Correlation type is what actually forces a heuristic switch (a ratio/greedy
// strategy that works when weight and value are independent breaks down once
// they're tied together), so it must not collapse to a single fixed value
// once the staircase settles near one difficulty. Unlock is still gated by
// difficulty (cumulative — earlier types stay in the mix, matching
// interleaved-practice designs rather than replacing old regimes outright),
// but which unlocked type comes up each round is drawn from a shuffled bag
// that never repeats the same type twice in a row. That guarantees a rule
// change within every unlocked.length rounds instead of leaving it to chance
// (a plain random pick can streak on 1-2 of N unlocked types for a long run).
export function unlockedCorrelations(difficulty: number): CorrelationType[] {
  const t = Math.min(1, difficulty / 100);
  const pool: CorrelationType[] = ['uncorrelated'];
  if (t >= 0.3) pool.push('weakly_correlated');
  if (t >= 0.6) pool.push('strongly_correlated');
  if (t >= 0.85) pool.push('subset_sum');
  return pool;
}

export interface CorrelationBag {
  pool: CorrelationType[];
  queue: CorrelationType[];
  lastDrawn: CorrelationType | null;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function drawCorrelation(
  difficulty: number,
  bag: CorrelationBag | null,
  rng: () => number,
): { correlation: CorrelationType; bag: CorrelationBag } {
  const pool = unlockedCorrelations(difficulty);
  const poolChanged = !bag || bag.pool.length !== pool.length || bag.pool.some((c, i) => c !== pool[i]);
  let queue = poolChanged ? [] : bag!.queue;
  const lastDrawn = poolChanged ? (bag?.lastDrawn ?? null) : bag!.lastDrawn;

  if (queue.length === 0) {
    queue = shuffle(pool, rng);
    // Don't let a fresh cycle open with the type that just closed the last one.
    if (queue.length > 1 && queue[0] === lastDrawn) {
      const swapWith = 1 + Math.floor(rng() * (queue.length - 1));
      [queue[0], queue[swapWith]] = [queue[swapWith], queue[0]];
    }
  }

  const [correlation, ...rest] = queue;
  return { correlation, bag: { pool, queue: rest, lastDrawn: correlation } };
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

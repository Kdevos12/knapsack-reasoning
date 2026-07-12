import { mulberry32, randInt } from './rng';
import type { CorrelationType, GenerationParams, KnapsackInstance } from './types';
import { SAFETY_BOUNDS } from './types';

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * Math.max(0, Math.min(1, t));
}

// Empirically measured (see repo history): greedy-by-ratio's success rate
// against the exact DP optimum climbs toward 100% as nItems grows, *at any*
// fixed correlation type — more items let a naive fill converge on the
// packing regardless of structure (a fixed-ratio-band greedy heuristic
// approaches the LP relaxation as n grows). Item count is capped well below
// where that washout kicks in, so it can't become the difficulty lever;
// spread has no such effect (measured flat) and keeps scaling freely.
const MAX_EXTRA_ITEMS = 10;

// Deterministic difficulty -> generation params mapping (everything except
// correlation, which is drawn separately — see unlockedCorrelations/
// drawCorrelation below). One monotonic table, no search/optimization loop:
// item count and ranges scale directly with the requested difficulty scalar.
// 0-100 is the tuned "core" range; there is no ceiling above that — the
// adaptive staircase can push difficulty past 100 indefinitely, so spread
// and correlationTightness keep growing (nItems is capped, see
// MAX_EXTRA_ITEMS) instead of freezing every instance at its difficulty-100
// shape.
export function difficultyToParams(difficulty: number): Omit<GenerationParams, 'correlation'> {
  const t = Math.min(1, difficulty / 100);
  const over = Math.max(0, difficulty - 100);
  const extraItems = Math.min(MAX_EXTRA_ITEMS, Math.floor(Math.sqrt(over)));
  const extraSpread = Math.round(Math.sqrt(over) * 4);

  const nItems = Math.round(lerp(SAFETY_BOUNDS.nItemsMin, SAFETY_BOUNDS.nItemsMax, t)) + extraItems;
  const spread = Math.round(lerp(12, SAFETY_BOUNDS.weightMax, t)) + extraSpread;

  // Harder instances sit closer to the 0.5 capacity/total-weight phase
  // transition (Pisinger 2005); easy instances give more slack so most
  // items plausibly fit and the choice isn't a tight packing puzzle.
  const capacityRatio = lerp(0.72, 0.5, t);

  // How tightly weakly/strongly/subset_sum cluster value around weight (see
  // generateInstance). Keeps tightening slowly for a long stretch past 100
  // instead of settling at its difficulty-100 value forever — measured to
  // hold correlated regimes' greedy-failure rate roughly flat out to
  // difficulty 2000+ rather than letting it erode back toward 0.
  const correlationTightness = Math.min(1, difficulty / 400);

  return {
    nItems,
    weightRange: [1, spread],
    valueRange: [1, spread],
    capacityRatio,
    correlationTightness,
    trap: trapParams(difficulty) ?? undefined,
  };
}

// Correlation-tightness (above) has an intrinsic ceiling: measured across a
// fine offsetFrac sweep, greedy's failure rate plateaus around 45-55% no
// matter how close the offset gets to 0 (0 itself is the degenerate
// subset-sum tie, which is *easier*, not harder — see subset_sum above). For
// players who blow past that ceiling (elite-tail users, per the design
// brief), further difficulty comes from a deterministic construction instead
// of a statistical one: the textbook proof that greedy fails 0/1 knapsack.
// Pick a "decoy" item at the best ratio in the instance whose weight wastes
// `decoyWasteFrac` of capacity (so nothing else fits alongside it), versus a
// 2-item "trap" combination that tiles the capacity exactly at a slightly
// lower ratio but a strictly higher guaranteed total value. Greedy always
// takes the decoy (best ratio); the true optimum always takes the trap.
// decoyWasteFrac is fixed (not grown) — it must stay safely below the trap
// split's ~45% floor or the trap item can start fitting back into the
// decoy's leftover space, which was measured to make instances *easier*
// again past difficulty ~10000 (the opposite of intended). marginFrac
// (< decoyWasteFrac, enforced) is what grows, asymptotically approaching but
// never reaching decoyWasteFrac, so this keeps intensifying indefinitely —
// measured stable (no reversal) out to difficulty 500,000+.
const TRAP_START_DIFFICULTY = 350;
const TRAP_DECOY_WASTE_FRAC = 0.2;
const TRAP_GROWTH_RATE = 400;

function trapParams(difficulty: number): { decoyWasteFrac: number; marginFrac: number } | null {
  if (difficulty < TRAP_START_DIFFICULTY) return null;
  const x = (difficulty - TRAP_START_DIFFICULTY) / TRAP_GROWTH_RATE;
  const growth = x / (1 + x); // asymptotic: -> 1 as difficulty -> infinity, never reaches it
  const marginFrac = TRAP_DECOY_WASTE_FRAC * (0.15 + 0.82 * growth);
  return { decoyWasteFrac: TRAP_DECOY_WASTE_FRAC, marginFrac };
}

// Overwrites 3 items in place with the decoy + 2-item trap combination
// described above. Layered on top of whichever correlation already
// generated the rest of the instance — orthogonal to correlation type, so it
// composes with all four rather than being a fifth type of its own.
function injectGreedyTrap(
  weights: number[],
  values: number[],
  capacity: number,
  trap: { decoyWasteFrac: number; marginFrac: number },
  rng: () => number,
): void {
  if (weights.length < 3) return;

  const bestRatio = Math.max(...weights.map((w, i) => values[i] / w));
  const split = 0.45 + rng() * 0.1; // 45-55%: both trap items comfortably exceed the decoy's leftover slack
  const w1 = Math.max(1, Math.round(capacity * split));
  const w2 = Math.max(1, capacity - w1);
  const v1 = Math.max(1, Math.round(w1 * bestRatio));
  const v2 = Math.max(1, Math.round(w2 * bestRatio));
  const trapValue = v1 + v2;

  const decoyWeight = Math.max(1, Math.round(capacity * (1 - trap.decoyWasteFrac)));
  const decoyValue = Math.max(1, Math.round(trapValue * (1 - trap.marginFrac)));

  weights[0] = decoyWeight;
  values[0] = decoyValue;
  weights[1] = w1;
  values[1] = v1;
  weights[2] = w2;
  values[2] = v2;
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
  const { nItems, weightRange, valueRange, capacityRatio, correlation, correlationTightness = 0 } = params;

  const weights = Array.from({ length: nItems }, () => randInt(rng, weightRange[0], weightRange[1]));
  const [vMin, vMax] = valueRange;
  const span = vMax - vMin;

  const values = weights.map((w) => {
    switch (correlation) {
      case 'uncorrelated':
        return randInt(rng, vMin, vMax);
      case 'weakly_correlated': {
        const jitter = Math.max(1, Math.round(span * lerp(0.2, 0.06, correlationTightness)));
        return Math.max(vMin, Math.min(vMax, w + randInt(rng, -jitter, jitter)));
      }
      case 'strongly_correlated': {
        const offset = Math.max(1, Math.round(span * lerp(0.1, 0.04, correlationTightness)));
        return Math.max(vMin, Math.min(vMax, w + offset));
      }
      case 'subset_sum': {
        // Not literal value = weight: random subset-sum instances are
        // provably easy on average (Borgs et al.; "almost all subset sum
        // problems are easy") — measured here to be *more* greedy-solvable
        // than strongly_correlated once nItems grows, because a dead ratio
        // tie lets a naive fill land near-optimal by sheer combinatorics.
        // A small but tighter-than-strongly_correlated offset keeps ratios
        // distinguishable-but-nearly-tied, which is what actually resists a
        // ratio-sort heuristic — measured to hold up across the full
        // difficulty range instead of washing out.
        const offset = Math.max(1, Math.round(span * lerp(0.05, 0.005, correlationTightness)));
        return Math.max(vMin, Math.min(vMax, w + offset));
      }
      default:
        return randInt(rng, vMin, vMax);
    }
  });

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const capacity = Math.max(weightRange[0], Math.round(totalWeight * capacityRatio));

  if (params.trap) {
    injectGreedyTrap(weights, values, capacity, params.trap, rng);
  }

  return { weights, values, capacity };
}

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
    // The dim2 config an unlocked round *would* use if drawn — advanced
    // mode's "seed from difficulty" wants this unconditionally. Adaptive
    // mode overrides it per round via drawDim2 instead of using it directly
    // (see App.tsx), so dim2 doesn't dominate every round once unlocked.
    dim2: dim2Params(difficulty) ?? undefined,
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

// Manual-mode equivalents of trapParams, so advanced mode can dial the same
// trap in directly (as a single 0-1 "strength" knob) instead of only ever
// getting it indirectly through a difficulty number. Both use the same fixed
// decoyWasteFrac, so seeding from a difficulty and hand-tuning afterward
// round-trip consistently.
export function trapFromStrength(strength: number): GenerationParams['trap'] {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) return undefined;
  return { decoyWasteFrac: TRAP_DECOY_WASTE_FRAC, marginFrac: TRAP_DECOY_WASTE_FRAC * 0.97 * s };
}

export function trapStrengthOf(trap: GenerationParams['trap']): number {
  if (!trap) return 0;
  return Math.max(0, Math.min(1, trap.marginFrac / (TRAP_DECOY_WASTE_FRAC * 0.97)));
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

// Tightness and the trap both keep the classic single-constraint 0/1
// knapsack hard, but they're still one algorithmic axis: how informative a
// value/weight ratio is. A second, independent capacity constraint (e.g.
// "volume" alongside "weight") is a qualitatively different kind of hardness
// — no single ratio can rank items once two constraints compete, which is
// documented to require different solution machinery (Lagrangian/surrogate
// relaxation, not plain 1D DP) and engages a documented multi-attribute
// integration process in human decision-making, distinct from single-value
// comparison. Value depends on both dimensions jointly (see
// jointValuesForDim2) specifically so this holds against more than one
// naive strategy: measured against rank-by-dimension-1-ratio,
// rank-by-dimension-2-ratio, rank-by-combined-ratio, rank-by-bottleneck-
// ratio, and rank-by-raw-value-ignoring-weight, all five stay under ~45%
// success within a few hundred difficulty points of unlock and hold there
// (an earlier version made weight2 fully independent of value, which left
// dimension-2/combined/bottleneck ratios climbing to 85-98% success even
// though dimension-1-ratio alone stayed hard).
//
// The exact 2D DP is O(n * capacity1 * capacity2) in both time AND memory
// (it keeps the full table to backtrack the optimal selection — see
// knapsackSolver.solveKnapsack2D), so dimension 1's otherwise-uncapped
// spread is clamped whenever dim2 is active: without this, an elite-tier
// player's spread (already in the hundreds by difficulty ~50,000) would
// blow the DP table up to tens of millions of cells.
const DIM2_START_DIFFICULTY = 75;
const DIM2_GROWTH_RATE = 400;
export const MAX_SPREAD_WITH_DIM2 = SAFETY_BOUNDS.weightMax;

function dim2Params(difficulty: number): GenerationParams['dim2'] {
  if (difficulty < DIM2_START_DIFFICULTY) return undefined;
  const t2 = Math.min(1, (difficulty - DIM2_START_DIFFICULTY) / DIM2_GROWTH_RATE);
  return dim2FromStrength(t2);
}

// Manual-mode equivalent, mirroring trapFromStrength/trapStrengthOf: reuses
// the same 8-35 spread2 / 0.85-0.5 capRatio2 curve dim2Params sweeps through
// difficulty, so seeding from a difficulty and hand-tuning afterward
// round-trip consistently.
export function dim2FromStrength(strength: number): GenerationParams['dim2'] {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) return undefined;
  return { spread2: Math.round(lerp(8, 35, s)), capRatio2: lerp(0.85, 0.5, s) };
}

export function dim2StrengthOf(dim2: GenerationParams['dim2']): number {
  if (!dim2) return 0;
  return Math.max(0, Math.min(1, (0.85 - dim2.capRatio2) / (0.85 - 0.5)));
}

// Naively, once dim2 unlocks it could just apply to every round — but that
// makes it the dominant mode rather than a special case to recognize, and
// crowds out the correlation-regime switching that's the rest of this
// engine's whole point. Held to a fixed 1-in-10 (10%) rate instead, via the
// same shuffle-bag pattern as drawCorrelation (bounded worst-case gap of
// ~19 rounds between dim2 rounds) rather than a flat 10% coin flip per
// round, which could leave long droughts or unlucky streaks to chance the
// same way pure-random correlation picking did before the correlation bag
// existed.
const DIM2_ROUND_POOL: readonly boolean[] = [true, false, false, false, false, false, false, false, false, false];

export interface Dim2Bag {
  unlocked: boolean;
  queue: boolean[];
}

export function drawDim2(
  difficulty: number,
  bag: Dim2Bag | null,
  rng: () => number,
): { dim2: GenerationParams['dim2']; bag: Dim2Bag } {
  const unlocked = difficulty >= DIM2_START_DIFFICULTY;
  if (!unlocked) {
    return { dim2: undefined, bag: { unlocked: false, queue: [] } };
  }

  let queue = bag?.unlocked ? bag.queue : [];
  if (queue.length === 0) {
    queue = shuffle(DIM2_ROUND_POOL as boolean[], rng);
  }

  const [isDim2Round, ...rest] = queue;
  return {
    dim2: isDim2Round ? dim2Params(difficulty) : undefined,
    bag: { unlocked: true, queue: rest },
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

// Value depends on *both* weight dimensions jointly (see generateInstance),
// clamped into dimension 1's own range the same way the single-constraint
// correlation types clamp value into weightRange. Two things were measured
// necessary here, not just "make weight2 independent":
// - If value only depended on weight1 (weight2 fully independent noise, the
//   first version of this feature), weight2 behaved like the *uncorrelated*
//   regime — easy for a ratio heuristic — so "rank by dimension-2 ratio" or
//   "rank by a combined/bottleneck ratio" climbed to 85-98% success even
//   while "rank by dimension-1 ratio" (the only one originally tested)
//   stayed hard. Tying value to a joint w1+w2 quantity instead means no
//   single dimension's ratio, nor a fixed linear combination, reliably
//   ranks items — the right combination depends on which capacity binds,
//   which varies per instance.
// - Without the clamp, value scales with total size roughly unboundedly, so
//   "rank by raw value, ignore weight entirely" alone reached 85%+ (this
//   heuristic stays under ~45% for the equivalent single-constraint
//   correlation types, which clamp for the same reason).
//
// DIM2_VALUE_SCALE: naively normalizing weight2's contribution to exactly
// match weight1's range (scale = 1) leaves "rank by combined ratio
// value/(w1+w2)" exploitable (~55-58% success, holding regardless of
// difficulty) — because value ends up close to a 1:1 mix of w1 and w2, so
// value/(w1+w2) is nearly constant across items, which (like any
// near-degenerate ratio) lets a naive fill land close to optimal by
// combinatorics rather than ranking. Deliberately under-weighting weight2's
// contribution breaks that near-tie; measured across dim1/dim2/combined/
// bottleneck/raw-value ratios and both low (just-unlocked, small spread2)
// and high difficulty, 0.6 keeps all five under ~30% success.
const DIM2_VALUE_SCALE = 0.6;

function jointValuesForDim2(weights1: number[], weights2: number[], spread1: number, spread2: number, tightness: number): number[] {
  const offsetFrac = lerp(0.15, 0.03, tightness);
  return weights1.map((w1, i) => {
    const base = w1 + weights2[i] * (spread1 / spread2) * DIM2_VALUE_SCALE;
    const offset = Math.max(1, Math.round(base * offsetFrac));
    return Math.max(1, Math.min(spread1, Math.round(base + offset)));
  });
}

export function generateInstance(params: GenerationParams, seed: number = Date.now()): KnapsackInstance {
  const rng = mulberry32(seed);
  const { nItems, capacityRatio, correlation, correlationTightness = 0, dim2 } = params;

  // See MAX_SPREAD_WITH_DIM2: dimension 1 is clamped to a bounded, fixed
  // range whenever a second constraint is active so the 2D DP table can't
  // grow past a few million cells regardless of how high difficulty (and
  // the otherwise-uncapped spread) has climbed.
  const weightRange: [number, number] = dim2
    ? [params.weightRange[0], Math.min(params.weightRange[1], MAX_SPREAD_WITH_DIM2)]
    : params.weightRange;
  const valueRange: [number, number] = dim2
    ? [params.valueRange[0], Math.min(params.valueRange[1], MAX_SPREAD_WITH_DIM2)]
    : params.valueRange;

  const weights = Array.from({ length: nItems }, () => randInt(rng, weightRange[0], weightRange[1]));
  const [vMin, vMax] = valueRange;
  const span = vMax - vMin;

  // Trap and dim2 are two different mechanisms for defeating the same
  // trained "rank by ratio" heuristic and were measured to interfere badly
  // when combined on the same instance (the trap's decoy/combo weights are
  // tuned against a single capacity and can accidentally violate or dodge
  // the second one, producing an unpredictable — and once measured,
  // anomalously *easier* — result). App.tsx's drawDim2 already keeps them
  // mutually exclusive for adaptive mode; this coin flip is the remaining
  // safeguard for advanced mode, where a player can set both sliders by
  // hand.
  const useTrap = !!params.trap && (!dim2 || rng() < 0.5);
  const useDim2 = !!dim2 && !useTrap;

  let values: number[];
  let weights2: number[] | undefined;

  if (useDim2) {
    weights2 = Array.from({ length: nItems }, () => randInt(rng, 1, dim2!.spread2));
    values = jointValuesForDim2(weights, weights2, weightRange[1], dim2!.spread2, correlationTightness);
  } else {
    values = weights.map((w) => {
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
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const capacity = Math.max(weightRange[0], Math.round(totalWeight * capacityRatio));

  if (useTrap) {
    injectGreedyTrap(weights, values, capacity, params.trap!, rng);
  }

  if (useDim2) {
    const totalWeight2 = weights2!.reduce((s, w) => s + w, 0);
    const capacity2 = Math.max(1, Math.round(totalWeight2 * dim2!.capRatio2));
    return { weights, values, capacity, weights2, capacity2 };
  }

  return { weights, values, capacity };
}

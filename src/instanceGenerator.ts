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

// Module-level function to get calibrated lerp bounds for a given correlation type.
// Used to adjust offset ranges in generateInstance to achieve target calibration success.
export function getCorrelationLerpBounds(
  correlation: CorrelationType,
): [number, number] {
  // Return [offsetAtTightness0, offsetAtTightness1] calibrated to achieve
  // target 30-50% exact-optimal success at each correlation's unlock difficulty.
  switch (correlation) {
    case "uncorrelated":
      return [0.5, 0.2]; // Higher offset to reduce success from 96.7% -> ~40%
    case "weakly_correlated":
      return [0.12, 0.05]; // 40% success at D30 - OK
    case "strongly_correlated":
      return [0.35, 0.12]; // 36.7% success at D60 - OK
    case "subset_sum":
      return [0.5, 0.15]; // 43.3% success at D90 - OK
    default:
      return [0.2, 0.08];
  }
}

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
    // The dim2/conflict config an unlocked round *would* use if drawn —
    // advanced mode's "seed from difficulty" wants this unconditionally.
    // Adaptive mode overrides both per round via drawDim2AndConflict instead
    // of using them directly (see App.tsx), so neither dominates every round
    // once unlocked.
    dim2: dim2Params(difficulty) ?? undefined,
    conflict: conflictParams(difficulty) ?? undefined,
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
  // Not dim2FromStrength(t2): its `strength <= 0` guard means "manually
  // dialed to 0% = off" in advanced mode, but here t2 === 0 means "just
  // unlocked", which must still produce the loosest active config, not
  // undefined — otherwise a round the bag drew as a dim2 round silently
  // becomes a mono-constraint round at exactly difficulty 75, wasting that
  // slot (harmless in practice since difficulty is rarely exactly 75, but
  // it also made naive test harnesses that force-draw a dim2 round loop
  // forever at that exact value).
  return { spread2: Math.round(lerp(20, 35, t2)), capRatio2: lerp(0.7, 0.5, t2) };
}

// Manual-mode equivalent, mirroring trapFromStrength/trapStrengthOf: reuses
// the same 20-35 spread2 / 0.70-0.5 capRatio2 curve dim2Params sweeps
// through difficulty, so seeding from a difficulty and hand-tuning
// afterward round-trip consistently.
//
// The starting point (20/0.70, not the initially-shipped 8/0.85) is
// calibrated, not arbitrary: at difficulty 75 (unlock), correlationTightness
// is already 0.19 (it's been ramping since difficulty 0), so the
// single-constraint regime a player is used to is already at ~33% success
// for a ratio-greedy strategy (strongly_correlated, measured) — not the
// loose, easy shape a difficulty-0 instance would have. dim2's own
// tightening curve restarted from t=0 at unlock, so its *first* dim2 round
// landed far weaker (66-86% success on several heuristics) than the
// single-constraint rounds right next to it in the same session, instead of
// the two axes feeling continuous. 20/0.70 measured at ~34% average success
// across dim1/dim2/combined/bottleneck/raw-value ratios at difficulty 75,
// matching the single-constraint baseline instead of lagging behind it
// until difficulty ~1000 (which most players will never reach).
export function dim2FromStrength(strength: number): GenerationParams['dim2'] {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) return undefined;
  return { spread2: Math.round(lerp(20, 35, s)), capRatio2: lerp(0.7, 0.5, s) };
}

export function dim2StrengthOf(dim2: GenerationParams['dim2']): number {
  if (!dim2) return 0;
  return Math.max(0, Math.min(1, (0.7 - dim2.capRatio2) / (0.7 - 0.5)));
}

// Naively, once dim2 unlocks it could just apply to every round — but that
// makes it the dominant mode rather than a special case to recognize, and
// crowds out the correlation-regime switching that's the rest of this
// engine's whole point. Rate itself ramps with difficulty like every other
// dim2 parameter: 25% right at unlock, rising to 35% by difficulty 500 (then
// holding), rather than a single fixed rate for the whole difficulty range.
// The ceiling was lowered from an earlier 50% specifically to leave room for
// the conflict-graph mechanism's own up-to-35% share (see conflictRate
// below) without the two together crowding out every trap/plain round.
const DIM2_RATE_MIN = 0.25;
const DIM2_RATE_MAX = 0.35;
const DIM2_RATE_MAX_DIFFICULTY = 500;

function dim2Rate(difficulty: number): number {
  if (difficulty < DIM2_START_DIFFICULTY) return 0;
  const t = Math.min(1, (difficulty - DIM2_START_DIFFICULTY) / (DIM2_RATE_MAX_DIFFICULTY - DIM2_START_DIFFICULTY));
  return lerp(DIM2_RATE_MIN, DIM2_RATE_MAX, t);
}

// A shuffled fixed-size pool (the correlation bag's approach) assumes a
// constant target rate for the length of a cycle; it doesn't fit a rate that
// keeps rising round to round. This is a leaky-bucket accumulator instead:
// each round adds the *current* rate to a running total, and fires as soon
// as that total reaches 1, subtracting 1 and carrying the remainder forward.
// It's deterministic (not the correlation bag's shuffle), but that's fine
// here — unlike correlation type, knowing a dim2 round is "due" doesn't
// telegraph anything about how to solve it, and determinism gives the same
// bounded-worst-case-gap guarantee the shuffle bag was built for (gap <=
// ceil(1/rate), tightening as rate rises) without needing to rebuild a pool
// every time the target rate itself moves.
export interface Dim2Bag {
  accumulator: number;
}

export function drawDim2(difficulty: number, bag: Dim2Bag | null): { dim2: GenerationParams['dim2']; bag: Dim2Bag } {
  const rate = dim2Rate(difficulty);
  if (rate <= 0) return { dim2: undefined, bag: { accumulator: 0 } };

  const acc = (bag?.accumulator ?? 0) + rate;
  if (acc >= 1) {
    return { dim2: dim2Params(difficulty), bag: { accumulator: acc - 1 } };
  }
  return { dim2: undefined, bag: { accumulator: acc } };
}

// A fourth axis, orthogonal to tightness/trap/dim2: some item pairs are
// mutually incompatible (the "Knapsack Problem with Conflict Graph" /
// Disjunctively Constrained Knapsack Problem in the OR literature). No ratio
// or capacity reasoning resolves this — a locally best-ratio item can be the
// wrong pick purely because of which other item it rules out, which defeats
// heuristics that never track pairwise relationships at all.
//
// First version of this (kept out of the repo, but worth recording why it
// changed): a single forced pair where both members individually wasted
// enough capacity that nothing else could join either one, mirroring
// injectGreedyTrap's "decoy wastes capacity" trick. Measured against the
// exact solver, that made the conflict edge *redundant* with plain capacity
// reasoning (both members were already mutually exclusive by weight alone,
// conflict or not) — ratio-greedy-skip-conflicting and max-independent-
// set-first both measured 92-99% success at unlock, and best-of-20 random
// conflict-aware fill stayed ~90%+ at every difficulty tested, meaning the
// conflict graph wasn't creating any real combinatorial difficulty distinct
// from what trap already provides. Fixed by moving to *many* modest-weight
// forced pairs (scaling with difficulty) instead of one capacity-dominating
// one — each pair's "B" item keeps A's already-generated (correlation-
// appropriate) weight/value as its ratio anchor and only gets bumped
// heavier-and-more-valuable than A, so pairs blend into the rest of the
// packing rather than each dominating capacity on their own. This is closer
// to the actual OR-literature source of hardness in conflict-graph knapsack
// (a graph dense/structured enough that finding a good independent packing
// is itself hard for greedy or blind search), not a single adversarial
// swap.
const CONFLICT_START_DIFFICULTY = 100;
const CONFLICT_WEIGHT_BUMP_FRAC = 0.35; // fixed; each pair's B is this much heavier than its A
const CONFLICT_GROWTH_RATE = 200;
// nItems saturates at its cap (SAFETY_BOUNDS.nItemsMax + MAX_EXTRA_ITEMS) by
// around difficulty 200 (see difficultyToParams), so from there on this
// mechanism's own difficulty comes entirely from pairFraction/
// backgroundDensity/marginFrac growth, not from more items — these ramps
// need to reach their working range well before difficulty 500, not linger
// at low density into the thousands, or a maxed-out item pool's redundancy
// makes conflict-aware ratio heuristics look artificially strong for most
// of the difficulty range a player actually encounters.
const CONFLICT_PAIR_FRACTION_MAX_DIFFICULTY = 400;
const CONFLICT_MAX_PAIR_FRACTION = 0.35; // at most this share of items become forced-pair members
const CONFLICT_BACKGROUND_MAX_DIFFICULTY = 400;
const CONFLICT_MAX_DEGREE = 4;

function conflictParams(difficulty: number): GenerationParams['conflict'] | null {
  if (difficulty < CONFLICT_START_DIFFICULTY) return null;
  const x = (difficulty - CONFLICT_START_DIFFICULTY) / CONFLICT_GROWTH_RATE;
  const growth = x / (1 + x); // asymptotic, same shape as trapParams
  // Stays under CONFLICT_WEIGHT_BUMP_FRAC always (0.85 ceiling) — that's
  // what keeps each pair's B ratio below its A, required for greedy-by-ratio
  // to prefer A first, every time.
  const marginFrac = CONFLICT_WEIGHT_BUMP_FRAC * (0.15 + 0.7 * growth);
  const pairFraction = lerp(0.15, CONFLICT_MAX_PAIR_FRACTION, Math.min(1, difficulty / CONFLICT_PAIR_FRACTION_MAX_DIFFICULTY));
  // Fraction of (non-paired) items routed into background cliques — see
  // injectConflicts. Not an edge count: CONFLICT_CLIQUE_SIZE-sized groups.
  const backgroundDensity = lerp(0.12, 0.4, Math.min(1, difficulty / CONFLICT_BACKGROUND_MAX_DIFFICULTY));
  return { weightBumpFrac: CONFLICT_WEIGHT_BUMP_FRAC, marginFrac, pairFraction, backgroundDensity };
}

// Manual-mode equivalent, mirroring trapFromStrength/trapStrengthOf.
export function conflictFromStrength(strength: number): GenerationParams['conflict'] {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) return undefined;
  return {
    weightBumpFrac: CONFLICT_WEIGHT_BUMP_FRAC,
    marginFrac: CONFLICT_WEIGHT_BUMP_FRAC * 0.85 * s,
    pairFraction: lerp(0.15, CONFLICT_MAX_PAIR_FRACTION, s),
    backgroundDensity: lerp(0.12, 0.4, s),
  };
}

export function conflictStrengthOf(conflict: GenerationParams['conflict']): number {
  if (!conflict) return 0;
  return Math.max(0, Math.min(1, conflict.marginFrac / (CONFLICT_WEIGHT_BUMP_FRAC * 0.85)));
}

const CONFLICT_CLIQUE_SIZE = 3;

// Pairs up round(nItems * pairFraction / 2) *random* items (not fixed
// indices — every item is a potential pair member, unlike the single-pair
// first version) and, within each pair, overwrites only the heavier-cast
// "B" member: B's weight becomes A's weight plus a fixed fraction more, and
// B's value is bumped just enough to exceed A's while keeping B's ratio
// below A's (see conflictParams). A keeps whatever weight/value the
// correlation regime already gave it, so each pair's "which one is
// actually better" decision stays tied to the instance's correlation shape
// instead of an independent, disconnected trap.
//
// The remaining background structure uses small cliques (fully-connected
// groups of CONFLICT_CLIQUE_SIZE items — "at most one of these can be
// picked") rather than scattered independent edges: measured, independent
// edges barely dented a blind random-search heuristic's success rate (it
// stayed ~65-85% at every difficulty tested, since a large item pool has
// enough redundancy that avoiding a few scattered bad pairs by luck is
// easy) even at a high edge density, while a smaller number of genuine
// "pick-at-most-one-of-k" clique constraints is a much stronger restriction
// per edge spent.
function injectConflicts(
  weights: number[],
  values: number[],
  conflict: { weightBumpFrac: number; marginFrac: number; pairFraction: number; backgroundDensity: number },
  rng: () => number,
): [number, number][] {
  const n = weights.length;
  if (n < 2) return [];

  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng,
  );
  const numPairs = Math.min(Math.floor(n / 2), Math.max(1, Math.floor((n * conflict.pairFraction) / 2)));

  const conflicts: [number, number][] = [];
  const degree = new Array(n).fill(0);
  const usedInPair = new Set<number>();

  for (let p = 0; p < numPairs; p++) {
    const idxA = order[2 * p];
    const idxB = order[2 * p + 1];
    const wA = weights[idxA];
    const vA = values[idxA];
    const bump = Math.max(1, Math.round(wA * conflict.weightBumpFrac));
    weights[idxB] = wA + bump;
    values[idxB] = Math.max(vA + 1, Math.round(vA * (1 + conflict.marginFrac)));
    conflicts.push(idxA < idxB ? [idxA, idxB] : [idxB, idxA]);
    degree[idxA]++;
    degree[idxB]++;
    usedInPair.add(idxA);
    usedInPair.add(idxB);
  }

  const remaining = order.filter((i) => !usedInPair.has(i));
  const numCliqueItems = Math.min(remaining.length, Math.round(n * conflict.backgroundDensity));
  const cliquePool = remaining.slice(0, numCliqueItems);
  for (let c = 0; c + CONFLICT_CLIQUE_SIZE <= cliquePool.length; c += CONFLICT_CLIQUE_SIZE) {
    const members = cliquePool.slice(c, c + CONFLICT_CLIQUE_SIZE);
    if (members.some((m) => degree[m] >= CONFLICT_MAX_DEGREE)) continue;
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const [a, b] = members[x] < members[y] ? [members[x], members[y]] : [members[y], members[x]];
        conflicts.push([a, b]);
        degree[a]++;
        degree[b]++;
      }
    }
  }
  return conflicts;
}

export interface ConflictBag {
  accumulator: number;
}

function conflictRate(difficulty: number): number {
  if (difficulty < CONFLICT_START_DIFFICULTY) return 0;
  const t = Math.min(1, (difficulty - CONFLICT_START_DIFFICULTY) / (500 - CONFLICT_START_DIFFICULTY));
  return lerp(0.2, 0.35, t);
}

// Orchestrates dim2's and conflict's leaky-bucket accumulators together
// rather than checking them sequentially. A sequential "check dim2's bag,
// else check conflict's bag" scheme thins the second-checked mechanism's
// real rate below its nominal target (multiplicative shrinkage: a nominal
// 35% mechanism checked only on rounds a 35%-drawing first mechanism didn't
// already claim actually fires on ~(1-0.35)*0.35 = 22.75% of rounds, not
// 35%). Instead both accumulators grow every round unconditionally. On the
// rare round both cross their threshold simultaneously, dim2 is served
// (fixed precedence) and conflict's accumulator is deliberately NOT
// decremented — it stays >= 1, so it's guaranteed to fire the very next
// round instead. This shifts *when* a fire lands by at most one round
// without ever dropping one, so each mechanism's long-run rate matches its
// nominal target exactly rather than approximately.
export function drawDim2AndConflict(
  difficulty: number,
  dim2Bag: Dim2Bag | null,
  conflictBag: ConflictBag | null,
): {
  dim2: GenerationParams['dim2'];
  conflict: GenerationParams['conflict'];
  dim2Bag: Dim2Bag;
  conflictBag: ConflictBag;
} {
  const dim2Acc = (dim2Bag?.accumulator ?? 0) + dim2Rate(difficulty);
  const conflictAcc = (conflictBag?.accumulator ?? 0) + conflictRate(difficulty);
  const dim2Due = dim2Acc >= 1;
  const conflictDue = conflictAcc >= 1;

  if (dim2Due) {
    return {
      dim2: dim2Params(difficulty),
      conflict: undefined,
      dim2Bag: { accumulator: dim2Acc - 1 },
      conflictBag: { accumulator: conflictAcc },
    };
  }
  if (conflictDue) {
    return {
      dim2: undefined,
      conflict: conflictParams(difficulty) ?? undefined,
      dim2Bag: { accumulator: dim2Acc },
      conflictBag: { accumulator: conflictAcc - 1 },
    };
  }
  return {
    dim2: undefined,
    conflict: undefined,
    dim2Bag: { accumulator: dim2Acc },
    conflictBag: { accumulator: conflictAcc },
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

  // Trap, dim2, and conflict are three different mechanisms for defeating
  // the same trained "rank by ratio" heuristic family and were measured (or
  // are architecturally certain, in conflict's case) to interfere badly when
  // combined on the same instance (trap's decoy/combo weights are tuned
  // against a single capacity and can accidentally violate or dodge a second
  // one — measured, for trap+dim2, to produce an anomalous 100% success
  // rate). App.tsx's drawDim2AndConflict already keeps them mutually
  // exclusive for adaptive mode; this fair N-way pick is the remaining
  // safeguard for advanced mode, where a player can set multiple sliders by
  // hand.
  const active: Array<'trap' | 'dim2' | 'conflict'> = [];
  if (params.trap) active.push('trap');
  if (dim2) active.push('dim2');
  if (params.conflict) active.push('conflict');
  const chosen = active.length > 0 ? active[Math.floor(rng() * active.length)] : null;
  const useTrap = chosen === 'trap';
  const useDim2 = chosen === 'dim2';
  const useConflict = chosen === 'conflict';

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

  if (useConflict) {
    const conflicts = injectConflicts(weights, values, params.conflict!, rng);
    return { weights, values, capacity, conflicts };
  }

  return { weights, values, capacity };
}

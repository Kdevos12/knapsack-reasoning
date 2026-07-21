// Domain model for the knapsack trainer. Kept flat and dependency-free.

export interface KnapsackInstance {
  weights: number[];
  values: number[];
  capacity: number;
  // Second, independent capacity constraint (e.g. "volume" alongside
  // "weight"). Undefined = the classic single-constraint 0/1 knapsack.
  // A single value/weight ratio ranking a player has trained on a
  // single-constraint instance stops being a valid heuristic once a second,
  // independent constraint can also bind — see instanceGenerator.dim2Params.
  weights2?: number[];
  capacity2?: number;
  // Pairwise incompatibilities: index pairs that can never both be selected — see
  // instanceGenerator.conflictParams/injectConflicts. Mutually exclusive with weights2/capacity2;
  // solveKnapsack dispatches to the branch-and-bound conflict solver instead of the 2D DP whenever
  // this is present, never both.
  conflicts?: [number, number][];
}

export interface SolvedInstance extends KnapsackInstance {
  optimalValue: number;
  optimalSelection: boolean[];
}

export type CorrelationType =
  | 'uncorrelated'
  | 'weakly_correlated'
  | 'strongly_correlated'
  | 'subset_sum';

// Shared with SetupScreen (advanced mode picker), GameScreen (round badge)
// and SessionHistory (heuristic-mix breakdown) so the label text and the
// four regimes stay in one place.
export const CORRELATION_LABELS: Record<CorrelationType, string> = {
  uncorrelated: 'Uncorrelated',
  weakly_correlated: 'Weakly correlated',
  strongly_correlated: 'Strongly correlated',
  subset_sum: 'Subset sum',
};

export interface GenerationParams {
  nItems: number;
  weightRange: [number, number];
  valueRange: [number, number];
  capacityRatio: number; // capacity = round(totalWeight * capacityRatio)
  correlation: CorrelationType;
  // 0-1, how tightly weakly/strongly/subset_sum cluster value around weight
  // (see instanceGenerator.generateInstance). Defaults to 0 (loosest) when
  // omitted — adaptive mode (via difficultyToParams) drives it above 0;
  // advanced mode's manual params start at 0 unless hand-tuned or seeded.
  correlationTightness?: number;
  // A deterministic (not statistical) greedy-defeating construction — see
  // instanceGenerator.injectGreedyTrap. Correlation-tightness alone plateaus
  // around a ~45-55% greedy success floor no matter how tight (measured);
  // this is the mechanism that keeps giving skilled players further headroom
  // past that floor without relying on distributional luck.
  trap?: { decoyWasteFrac: number; marginFrac: number };
  // Adds a second, independent capacity constraint — see
  // instanceGenerator.dim2Params. A qualitatively different kind of hardness
  // from tightness/trap: no single value/weight ratio can rank items once
  // two constraints compete, which the operations-research and multi-attribute
  // decision-making literature both treat as requiring different solution
  // machinery, not just a harder version of the same one.
  dim2?: { spread2: number; capRatio2: number };
  // A deterministic adversarial conflict pair (mirrors `trap`'s decoy logic) plus a background
  // density of random conflict edges — see instanceGenerator.conflictParams/injectConflicts. A
  // fourth distinct axis from tightness/trap/dim2: no ratio or capacity reasoning resolves it,
  // since a locally best item can be the wrong pick purely because of which other item it rules out.
  conflict?: { weightBumpFrac: number; marginFrac: number; pairFraction: number; backgroundDensity: number };
}

// 'training' (fixed-difficulty, no auto-adjustment) was removed: advanced
// mode's "seed from difficulty" control (SetupScreen) reuses the exact same
// difficultyToParams/unlockedCorrelations formulas to fill in a one-shot
// fixed-difficulty config, then lets it be hand-tuned — a strict superset of
// what training mode offered, so keeping both was redundant surface area.
export type SessionMode = 'advanced' | 'adaptive';
export type TimeMode = 'none' | 'timed';

// One round = one problem.
export interface SessionConfig {
  mode: SessionMode;
  rounds: number;
  timeMode: TimeMode;
  timeLimitSeconds: number; // per round, used when timeMode === 'timed'
  advancedParams: GenerationParams; // used when mode === 'advanced'
  soundEnabled: boolean;
  // When true, a one-shot warning is shown after submission if the solution is
  // sub-optimal — giving the player a single chance to reconsider before the
  // result is recorded. No optimality % is revealed.
  subOptimalWarning: boolean;
}

export interface Trial {
  round: number;
  difficulty: number;
  correlation: CorrelationType;
  success: boolean;
  qualityRatio: number; // achievedValue / optimalValue, in [0,1]
  timeUsedMs: number;
  timeLimitMs: number | null;
}

export const SAFETY_BOUNDS = {
  minDifficulty: 0,
  // No upper bound: the adaptive staircase (adaptiveEngine.ts) is only
  // floor-clamped so skilled players keep climbing instead of pinning at a
  // ceiling. 100 remains the tuned "full difficulty" reference point that
  // instanceGenerator.ts scales tiers against.
  nItemsMin: 4,
  nItemsMax: 14,
  capacityRatioMin: 0.4,
  capacityRatioMax: 0.6,
  weightMin: 1,
  weightMax: 40,
  valueMin: 1,
  valueMax: 40,
} as const;

// A trial counts as a success once it's within a hair of the true optimum,
// not only on an exact match — matching how the cognitive-training studies
// score "near-optimal" solutions instead of demanding the unique best one.
export const SUCCESS_QUALITY_THRESHOLD = 0.95;

export const DEFAULT_ADVANCED_PARAMS: GenerationParams = {
  nItems: 8,
  weightRange: [1, 20],
  valueRange: [1, 30],
  capacityRatio: 0.5,
  correlation: 'uncorrelated',
};

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  mode: 'adaptive',
  rounds: 10,
  timeMode: 'timed',
  timeLimitSeconds: 90,
  advancedParams: DEFAULT_ADVANCED_PARAMS,
  soundEnabled: true,
  subOptimalWarning: true,
};

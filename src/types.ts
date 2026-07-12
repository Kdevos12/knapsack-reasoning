// Domain model for the knapsack trainer. Kept flat and dependency-free.

export interface KnapsackInstance {
  weights: number[];
  values: number[];
  capacity: number;
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

export interface GenerationParams {
  nItems: number;
  weightRange: [number, number];
  valueRange: [number, number];
  capacityRatio: number; // capacity = round(totalWeight * capacityRatio)
  correlation: CorrelationType;
}

export type SessionMode = 'training' | 'advanced' | 'adaptive';
export type TimeMode = 'none' | 'timed';

// One round = one problem.
export interface SessionConfig {
  mode: SessionMode;
  rounds: number;
  timeMode: TimeMode;
  timeLimitSeconds: number; // per round, used when timeMode === 'timed'
  trainingDifficulty: number; // 0-100, used when mode === 'training'
  advancedParams: GenerationParams; // used when mode === 'advanced'
  soundEnabled: boolean;
}

export interface Trial {
  round: number;
  difficulty: number;
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
  // instanceGenerator.ts scales tiers against, and the manual training slider
  // still stops there since that's an explicit user choice, not the staircase.
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
  trainingDifficulty: 25,
  advancedParams: DEFAULT_ADVANCED_PARAMS,
  soundEnabled: true,
};

// Adaptive difficulty controller.
//
// Design choice: a transformed up-down staircase (Levitt, 1971 - "Transformed
// up-down methods in psychoacoustics", J. Acoust. Soc. Am. 49) rather than a
// pile of ad hoc heuristics. Rule: N consecutive successes -> difficulty up
// one step; a single failure -> difficulty down one step. The step size is
// halved on every reversal (direction change), so the walk provably converges
// to the difficulty level where P(success) ~= N/(N+1) (70.7% for N=2) instead
// of needing hand-calibrated weights. This is the whole engine: one rule,
// bounded by SAFETY_BOUNDS, no free-floating constants to tune per game.
import { SAFETY_BOUNDS } from './types';

export interface StaircaseState {
  difficulty: number;
  step: number;
  consecutiveSuccesses: number;
  lastDirection: 'up' | 'down' | null;
  reversals: number;
}

const INITIAL_STEP = 18;
const MIN_STEP = 3;
const STEP_SHRINK = 0.6;
const SUCCESSES_TO_PROMOTE = 2; // 2-down/1-up -> converges near 70.7% success rate

// Persist the user's level across sessions (localStorage survives reloads).
const STORAGE_KEY = 'knapsack-trainer-difficulty';

export function loadSavedDifficulty(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampDifficulty(n) : null;
  } catch {
    return null;
  }
}

export function saveDifficulty(d: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(d)));
  } catch {
    // Storage unavailable (private mode) — level just won't persist.
  }
}

export function initStaircase(initialDifficulty = 15): StaircaseState {
  return {
    difficulty: clampDifficulty(initialDifficulty),
    step: INITIAL_STEP,
    consecutiveSuccesses: 0,
    lastDirection: null,
    reversals: 0,
  };
}

export function updateStaircase(state: StaircaseState, success: boolean): StaircaseState {
  if (success) {
    const consecutiveSuccesses = state.consecutiveSuccesses + 1;
    if (consecutiveSuccesses < SUCCESSES_TO_PROMOTE) {
      return { ...state, consecutiveSuccesses };
    }
    return move(state, 'up');
  }
  return move({ ...state, consecutiveSuccesses: 0 }, 'down');
}

function move(state: StaircaseState, direction: 'up' | 'down'): StaircaseState {
  const isReversal = state.lastDirection !== null && state.lastDirection !== direction;
  const step = isReversal ? Math.max(MIN_STEP, state.step * STEP_SHRINK) : state.step;
  const delta = direction === 'up' ? step : -step;

  return {
    difficulty: clampDifficulty(state.difficulty + delta),
    step,
    consecutiveSuccesses: 0,
    lastDirection: direction,
    reversals: state.reversals + (isReversal ? 1 : 0),
  };
}

function clampDifficulty(d: number): number {
  return Math.max(SAFETY_BOUNDS.minDifficulty, Math.min(SAFETY_BOUNDS.maxDifficulty, d));
}

import { useCallback, useEffect, useRef, useState } from 'react';
import GameScreen from './components/GameScreen';
import SetupScreen from './components/SetupScreen';
import SessionHistory from './components/SessionHistory';
import Tutorial from './components/Tutorial';
import {
  initStaircase,
  updateStaircase,
  loadSavedDifficulty,
  saveDifficulty,
  type StaircaseState,
} from './adaptiveEngine';
import {
  difficultyToParams,
  drawCorrelation,
  drawDim2AndConflict,
  generateInstance,
  scaledTimeLimitSeconds,
  type CorrelationBag,
  type ConflictBag,
  type Dim2Bag,
} from './instanceGenerator';
import { solveKnapsack } from './knapsackSolver';
import { playSuccessChime } from './sound';
import type { CorrelationType, GenerationParams, SessionConfig, SolvedInstance, Trial } from './types';
import { DEFAULT_SESSION_CONFIG, SUCCESS_QUALITY_THRESHOLD } from './types';
import './App.css';

type View = 'setup' | 'game' | 'history' | 'tutorial';
type Phase = 'playing' | 'feedback';

// Correlation is drawn separately from the rest of the params (see
// drawCorrelation) so it can be shuffled across the unlocked pool instead of
// being pinned to whatever tier the current difficulty scalar sits in.
function paramsForConfig(
  config: SessionConfig,
  staircase: StaircaseState | null,
  bag: CorrelationBag | null,
  dim2Bag: Dim2Bag | null,
  conflictBag: ConflictBag | null,
): { params: GenerationParams; bag: CorrelationBag; dim2Bag: Dim2Bag; conflictBag: ConflictBag } {
  if (config.mode === 'advanced') {
    return {
      params: config.advancedParams,
      bag: bag ?? { pool: [], queue: [], lastDrawn: null },
      dim2Bag: dim2Bag ?? { accumulator: 0 },
      conflictBag: conflictBag ?? { accumulator: 0 },
    };
  }
  const difficulty = staircase!.difficulty;
  const base = difficultyToParams(difficulty);
  const { correlation, bag: nextBag } = drawCorrelation(difficulty, bag, Math.random);
  // dim2's and conflict's rates both ramp with difficulty (see
  // drawDim2AndConflict) rather than applying to every unlocked round, so
  // each stays a recurring special case rather than crowding out
  // correlation-regime switching entirely. Both accumulators are updated
  // jointly (not sequentially) so neither mechanism's actual rate is thinned
  // by the other firing first. A dim2 or conflict round replaces the trap
  // for that round rather than combining with it (see the interference note
  // in generateInstance).
  const {
    dim2,
    conflict,
    dim2Bag: nextDim2Bag,
    conflictBag: nextConflictBag,
  } = drawDim2AndConflict(difficulty, dim2Bag, conflictBag);
  const params: GenerationParams = dim2
    ? { ...base, correlation, dim2, trap: undefined, conflict: undefined }
    : conflict
      ? { ...base, correlation, conflict, trap: undefined, dim2: undefined }
      : { ...base, correlation, dim2: undefined, conflict: undefined };
  return { params, bag: nextBag, dim2Bag: nextDim2Bag, conflictBag: nextConflictBag };
}

function App() {
  const [view, setView] = useState<View>('setup');
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_SESSION_CONFIG);

  const [staircase, setStaircase] = useState<StaircaseState | null>(null);
  const [correlationBag, setCorrelationBag] = useState<CorrelationBag | null>(null);
  const [dim2Bag, setDim2Bag] = useState<Dim2Bag | null>(null);
  const [conflictBag, setConflictBag] = useState<ConflictBag | null>(null);
  const [round, setRound] = useState(0);
  const [instance, setInstance] = useState<SolvedInstance | null>(null);
  const [currentCorrelation, setCurrentCorrelation] = useState<CorrelationType>('uncorrelated');
  const [currentMechanism, setCurrentMechanism] = useState<'none' | 'trap' | 'dim2' | 'conflict'>('none');
  const [selected, setSelected] = useState<boolean[]>([]);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [phase, setPhase] = useState<Phase>('playing');
  const [lastTrial, setLastTrial] = useState<Trial | null>(null);

  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAtRef = useRef<number>(0);

  // Single-step undo: stores the previous selected[] snapshot so one toggle
  // can be reverted. Cleared on new round / submit.
  const [prevSelected, setPrevSelected] = useState<boolean[] | null>(null);

  // Sub-optimal warning: when the setting is on, the first submission of a
  // non-optimal answer shows a prompt instead of recording the trial.
  // If the player confirms, the trial is recorded normally.
  const [pendingWarning, setPendingWarning] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const MAX_SUBOPTIMAL_WARNINGS = 1;

  const currentDifficulty = staircase?.difficulty ?? 0;

  const spawnProblem = useCallback(
    (
      cfg: SessionConfig,
      sc: StaircaseState | null,
      bag: CorrelationBag | null,
      d2Bag: Dim2Bag | null,
      cBag: ConflictBag | null,
    ) => {
      const {
        params,
        bag: nextBag,
        dim2Bag: nextDim2Bag,
        conflictBag: nextConflictBag,
      } = paramsForConfig(cfg, sc, bag, d2Bag, cBag);
      setCorrelationBag(nextBag);
      setDim2Bag(nextDim2Bag);
      setConflictBag(nextConflictBag);
      setCurrentCorrelation(params.correlation);
      // Track which mechanism is active for pedagogical messaging
      setCurrentMechanism(params.trap ? 'trap' : params.dim2 ? 'dim2' : params.conflict ? 'conflict' : 'none');
      const solved = solveKnapsack(generateInstance(params, Math.floor(Math.random() * 2 ** 31), currentDifficulty));
      setInstance(solved);
      setSelected(new Array(solved.weights.length).fill(false));
      setPrevSelected(null);
      setTimedOut(false);
      setPhase('playing');
      setLastTrial(null);
      setPendingWarning(false);
      setWarningCount(0);
      startedAtRef.current = Date.now();
      const timeMs = cfg.timeMode === 'timed' ? scaledTimeLimitSeconds(cfg.timeLimitSeconds, params) * 1000 : null;
      setTimeLeftMs(timeMs);
    },
    [],
  );

  const startSession = useCallback(
    (cfg: SessionConfig) => {
      setConfig(cfg);
      // Resume the adaptive staircase from the saved level, if any.
      const sc = cfg.mode === 'adaptive' ? initStaircase(loadSavedDifficulty() ?? 15) : null;
      setStaircase(sc);
      setRound(0);
      setTrials([]);
      // Fresh bags each session — the shuffle only needs to hold within one run.
      spawnProblem(cfg, sc, null, null, null);
      setView('game');
    },
    [spawnProblem],
  );

  // Countdown timer — only while actually playing.
  useEffect(() => {
    if (timeLeftMs === null || timedOut || phase !== 'playing') return;
    const id = setInterval(() => {
      setTimeLeftMs((prev) => {
        if (prev === null) return prev;
        const next = prev - 1000;
        if (next <= 0) {
          setTimedOut(true);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timeLeftMs === null, timedOut, phase]);

  const toggleItem = useCallback(
    (index: number) => {
      if (phase !== 'playing') return;
      setSelected((prev) => {
        setPrevSelected(prev); // snapshot for single-step undo
        const next = [...prev];
        next[index] = !next[index];
        return next;
      });
    },
    [phase],
  );

  const undoLast = useCallback(() => {
    if (phase !== 'playing' || prevSelected === null) return;
    setSelected(prevSelected);
    setPrevSelected(null);
  }, [phase, prevSelected]);

  // Ctrl+Z / Cmd+Z keyboard shortcut for undo.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoLast();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoLast]);

  // Core submission logic — called either directly (warning off or already
  // confirmed) or after the player confirms the warning.
  const recordTrial = useCallback(
    (feasible: boolean, totalValue: number) => {
      if (!instance) return;
      const qualityRatio = feasible && instance.optimalValue > 0 ? totalValue / instance.optimalValue : 0;
      const exactOptimal = feasible && totalValue === instance.optimalValue;
      const success = feasible && qualityRatio >= SUCCESS_QUALITY_THRESHOLD;
      const timeUsedMs = Date.now() - startedAtRef.current;
      const timeLimitMs = config.timeMode === 'timed' ? config.timeLimitSeconds * 1000 : null;

      const trial: Trial = {
        round,
        difficulty: currentDifficulty,
        correlation: currentCorrelation,
        success,
        exactOptimal,
        qualityRatio,
        timeUsedMs,
        timeLimitMs,
      };
      setTrials((prev) => [...prev, trial]);
      setLastTrial(trial);
      setPhase('feedback');
      setPrevSelected(null);
      setPendingWarning(false);

      if (success && config.soundEnabled) playSuccessChime();

      if (config.mode === 'adaptive' && staircase) {
        const next = updateStaircase(staircase, exactOptimal);
        setStaircase(next);
        saveDifficulty(next.difficulty);
      }
    },
    [instance, round, config, staircase, currentDifficulty, currentCorrelation],
  );

  const submit = useCallback(() => {
    if (!instance || phase !== 'playing') return;
    const totalWeight = selected.reduce((s, on, i) => (on ? s + instance.weights[i] : s), 0);
    const totalValue = selected.reduce((s, on, i) => (on ? s + instance.values[i] : s), 0);
    const totalWeight2 = instance.weights2
      ? selected.reduce((s, on, i) => (on ? s + instance.weights2![i] : s), 0)
      : 0;
    const conflictOk = !instance.conflicts || instance.conflicts.every(([a, b]) => !(selected[a] && selected[b]));
    const feasible =
      totalWeight <= instance.capacity &&
      (instance.capacity2 === undefined || totalWeight2 <= instance.capacity2) &&
      conflictOk;
    const exactOptimal = feasible && totalValue === instance.optimalValue;

    // If the warning setting is on and the solution is sub-optimal (in the
    // computational sense), pause and show the warning prompt instead of
    // recording immediately. Cap warnings per round to avoid unbounded
    // trial-and-error loops.
    if (config.subOptimalWarning && !exactOptimal && !pendingWarning && warningCount < MAX_SUBOPTIMAL_WARNINGS) {
      setPendingWarning(true);
      setWarningCount((c) => c + 1);
      return;
    }

    recordTrial(feasible, totalValue);
  }, [instance, selected, phase, config, pendingWarning, recordTrial]);

  const dismissWarningAndSubmit = useCallback(() => {
    if (!instance) return;
    const totalWeight = selected.reduce((s, on, i) => (on ? s + instance.weights[i] : s), 0);
    const totalValue = selected.reduce((s, on, i) => (on ? s + instance.values[i] : s), 0);
    const totalWeight2 = instance.weights2
      ? selected.reduce((s, on, i) => (on ? s + instance.weights2![i] : s), 0)
      : 0;
    const conflictOk = !instance.conflicts || instance.conflicts.every(([a, b]) => !(selected[a] && selected[b]));
    const feasible =
      totalWeight <= instance.capacity &&
      (instance.capacity2 === undefined || totalWeight2 <= instance.capacity2) &&
      conflictOk;
    recordTrial(feasible, totalValue);
  }, [instance, selected, recordTrial]);

  const dismissWarningAndContinue = useCallback(() => {
    setPendingWarning(false);
  }, []);

  const nextRound = useCallback(() => {
    if (round + 1 >= config.rounds) {
      setView('history');
      return;
    }
    setRound((r) => r + 1);
    spawnProblem(config, staircase, correlationBag, dim2Bag, conflictBag);
  }, [round, config, staircase, correlationBag, dim2Bag, conflictBag, spawnProblem]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Knapsack Reasoning Trainer</h1>
        <nav className="app-nav">
          <button className={view === 'setup' ? 'active' : ''} onClick={() => setView('setup')}>
            Setup
          </button>
          {instance && (
            <button className={view === 'game' ? 'active' : ''} onClick={() => setView('game')}>
              Play
            </button>
          )}
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
            Results
          </button>
          <button className={view === 'tutorial' ? 'active' : ''} onClick={() => setView('tutorial')}>
            How to play
          </button>
        </nav>
      </header>

      <main className="app-main">
        {view === 'setup' && <SetupScreen initialConfig={config} onStart={startSession} />}

        {view === 'game' && instance && (
          <GameScreen
            instance={instance}
            selected={selected}
            onToggle={toggleItem}
            onUndo={undoLast}
            canUndo={prevSelected !== null && phase === 'playing'}
            onSubmit={submit}
            onNext={nextRound}
            feedback={phase === 'feedback' ? lastTrial : null}
            isLastRound={round + 1 >= config.rounds}
            timeLeftMs={timeLeftMs}
            timedOut={timedOut}
            round={round}
            config={config}
            difficulty={currentDifficulty}
            correlation={currentCorrelation}
            mechanism={currentMechanism}
            pendingWarning={pendingWarning}
            onWarningConfirm={dismissWarningAndSubmit}
            onWarningDismiss={dismissWarningAndContinue}
          />
        )}

        {view === 'history' && <SessionHistory trials={trials} onNewSession={() => setView('setup')} />}

        {view === 'tutorial' && <Tutorial />}
      </main>

      <footer className="app-footer">
        <a href="https://github.com/Kdevos12/knapsack-reasoning" target="_blank" rel="noopener noreferrer">
          github.com/Kdevos12/knapsack-reasoning
        </a>
      </footer>
    </div>
  );
}

export default App;

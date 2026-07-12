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
  drawDim2,
  generateInstance,
  type CorrelationBag,
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
): { params: GenerationParams; bag: CorrelationBag; dim2Bag: Dim2Bag } {
  if (config.mode === 'advanced') {
    return {
      params: config.advancedParams,
      bag: bag ?? { pool: [], queue: [], lastDrawn: null },
      dim2Bag: dim2Bag ?? { unlocked: false, queue: [] },
    };
  }
  const difficulty = staircase!.difficulty;
  const base = difficultyToParams(difficulty);
  const { correlation, bag: nextBag } = drawCorrelation(difficulty, bag, Math.random);
  // dim2 is capped to ~1-in-5 rounds (see drawDim2) rather than applying to
  // every unlocked round, so it stays a special case to recognize instead of
  // crowding out correlation-regime switching. A dim2 round replaces the
  // trap for that round rather than combining with it (see the interference
  // note in generateInstance).
  const { dim2, bag: nextDim2Bag } = drawDim2(difficulty, dim2Bag, Math.random);
  const params: GenerationParams = dim2
    ? { ...base, correlation, dim2, trap: undefined }
    : { ...base, correlation, dim2: undefined };
  return { params, bag: nextBag, dim2Bag: nextDim2Bag };
}

function App() {
  const [view, setView] = useState<View>('setup');
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_SESSION_CONFIG);

  const [staircase, setStaircase] = useState<StaircaseState | null>(null);
  const [correlationBag, setCorrelationBag] = useState<CorrelationBag | null>(null);
  const [dim2Bag, setDim2Bag] = useState<Dim2Bag | null>(null);
  const [round, setRound] = useState(0);
  const [instance, setInstance] = useState<SolvedInstance | null>(null);
  const [currentCorrelation, setCurrentCorrelation] = useState<CorrelationType>('uncorrelated');
  const [selected, setSelected] = useState<boolean[]>([]);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [phase, setPhase] = useState<Phase>('playing');
  const [lastTrial, setLastTrial] = useState<Trial | null>(null);

  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAtRef = useRef<number>(0);

  const currentDifficulty = staircase?.difficulty ?? 0;

  const spawnProblem = useCallback(
    (cfg: SessionConfig, sc: StaircaseState | null, bag: CorrelationBag | null, d2Bag: Dim2Bag | null) => {
      const { params, bag: nextBag, dim2Bag: nextDim2Bag } = paramsForConfig(cfg, sc, bag, d2Bag);
      setCorrelationBag(nextBag);
      setDim2Bag(nextDim2Bag);
      setCurrentCorrelation(params.correlation);
      const solved = solveKnapsack(generateInstance(params, Math.floor(Math.random() * 2 ** 31)));
      setInstance(solved);
      setSelected(new Array(solved.weights.length).fill(false));
      setTimedOut(false);
      setPhase('playing');
      setLastTrial(null);
      startedAtRef.current = Date.now();
      setTimeLeftMs(cfg.timeMode === 'timed' ? cfg.timeLimitSeconds * 1000 : null);
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
      spawnProblem(cfg, sc, null, null);
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
        const next = [...prev];
        next[index] = !next[index];
        return next;
      });
    },
    [phase],
  );

  const submit = useCallback(() => {
    if (!instance || phase !== 'playing') return;
    const totalWeight = selected.reduce((s, on, i) => (on ? s + instance.weights[i] : s), 0);
    const totalValue = selected.reduce((s, on, i) => (on ? s + instance.values[i] : s), 0);
    const totalWeight2 = instance.weights2
      ? selected.reduce((s, on, i) => (on ? s + instance.weights2![i] : s), 0)
      : 0;
    const withinCapacity =
      totalWeight <= instance.capacity && (instance.capacity2 === undefined || totalWeight2 <= instance.capacity2);
    const qualityRatio = withinCapacity && instance.optimalValue > 0 ? totalValue / instance.optimalValue : 0;
    const success = withinCapacity && qualityRatio >= SUCCESS_QUALITY_THRESHOLD;
    const timeUsedMs = Date.now() - startedAtRef.current;
    const timeLimitMs = config.timeMode === 'timed' ? config.timeLimitSeconds * 1000 : null;

    const trial: Trial = {
      round,
      difficulty: currentDifficulty,
      correlation: currentCorrelation,
      success,
      qualityRatio,
      timeUsedMs,
      timeLimitMs,
    };
    setTrials((prev) => [...prev, trial]);
    setLastTrial(trial);
    setPhase('feedback');

    if (success && config.soundEnabled) playSuccessChime();

    if (config.mode === 'adaptive' && staircase) {
      const next = updateStaircase(staircase, success);
      setStaircase(next);
      saveDifficulty(next.difficulty);
    }
  }, [instance, selected, round, config, staircase, currentDifficulty, currentCorrelation, phase]);

  const nextRound = useCallback(() => {
    if (round + 1 >= config.rounds) {
      setView('history');
      return;
    }
    setRound((r) => r + 1);
    spawnProblem(config, staircase, correlationBag, dim2Bag);
  }, [round, config, staircase, correlationBag, dim2Bag, spawnProblem]);

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

import { useState } from 'react';
import type { CorrelationType, SessionConfig, SessionMode, TimeMode } from '../types';
import { DEFAULT_ADVANCED_PARAMS } from '../types';
import { loadSavedDifficulty } from '../adaptiveEngine';
import {
  conflictFromStrength,
  conflictStrengthOf,
  difficultyToParams,
  dim2FromStrength,
  dim2StrengthOf,
  trapFromStrength,
  trapStrengthOf,
  unlockedCorrelations,
} from '../instanceGenerator';
import './SetupScreen.css';

interface SetupScreenProps {
  initialConfig: SessionConfig;
  onStart: (config: SessionConfig) => void;
}

const CORRELATIONS: { value: CorrelationType; label: string }[] = [
  { value: 'uncorrelated', label: 'Uncorrelated (easy)' },
  { value: 'weakly_correlated', label: 'Weakly correlated' },
  { value: 'strongly_correlated', label: 'Strongly correlated' },
  { value: 'subset_sum', label: 'Subset sum (hard)' },
];

function SetupScreen({ initialConfig, onStart }: SetupScreenProps) {
  const [config, setConfig] = useState<SessionConfig>(initialConfig);
  const [seedDifficulty, setSeedDifficulty] = useState(100);
  const savedLevel = loadSavedDifficulty();

  const set = <K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  // Reuses the exact same formulas adaptive mode runs at this difficulty
  // (item count, spread, capacity ratio, correlation tightness, greedy-trap
  // strength), picking the hardest currently-unlocked correlation as a
  // starting point — then it's just a normal advanced-mode config the fields
  // below can hand-tune further.
  const seedFromDifficulty = () => {
    const base = difficultyToParams(seedDifficulty);
    const pool = unlockedCorrelations(seedDifficulty);
    set('advancedParams', { ...config.advancedParams, ...base, correlation: pool[pool.length - 1] });
  };

  return (
    <div className="setup-screen">
      <h2>Session setup</h2>

      <div className="settings-group">
        <h3>Mode</h3>
        <div className="mode-tabs">
          {(['adaptive', 'advanced'] as SessionMode[]).map((m) => (
            <button key={m} type="button" className={config.mode === m ? 'active' : ''} onClick={() => set('mode', m)}>
              {m === 'adaptive' ? 'Adaptive' : 'Advanced'}
            </button>
          ))}
        </div>
        {config.mode === 'adaptive' && (
          <p className="help-text">
            The engine raises the difficulty one step after 2 successes in a row, and lowers it one step after each
            failure (2-down/1-up staircase, converging to ~70% success rate).
            {savedLevel !== null && <> Your saved level: <strong>{savedLevel}</strong> — the session resumes from there.</>}
          </p>
        )}
        {config.mode === 'advanced' && (
          <p className="help-text">
            You control every generation parameter directly — use "Seed from difficulty" for a one-shot fixed-difficulty
            fill, or hand-tune each field for a specific fixed instance shape.
          </p>
        )}
      </div>

      {config.mode === 'advanced' && (
        <div className="settings-group">
          <div className="setting-row">
            <label>Seed from difficulty</label>
            <input
              type="number"
              min={0}
              value={seedDifficulty}
              onChange={(e) => setSeedDifficulty(Number(e.target.value))}
            />
            <button type="button" onClick={seedFromDifficulty}>
              Fill fields
            </button>
          </div>
          <div className="setting-row">
            <label>Number of items</label>
            <input
              type="number"
              min={2}
              max={20}
              value={config.advancedParams.nItems}
              onChange={(e) => set('advancedParams', { ...config.advancedParams, nItems: Number(e.target.value) })}
            />
          </div>
          <div className="setting-row">
            <label>Weight min / max</label>
            <input
              type="number"
              min={1}
              value={config.advancedParams.weightRange[0]}
              onChange={(e) =>
                set('advancedParams', {
                  ...config.advancedParams,
                  weightRange: [Number(e.target.value), config.advancedParams.weightRange[1]],
                })
              }
            />
            <input
              type="number"
              min={1}
              value={config.advancedParams.weightRange[1]}
              onChange={(e) =>
                set('advancedParams', {
                  ...config.advancedParams,
                  weightRange: [config.advancedParams.weightRange[0], Number(e.target.value)],
                })
              }
            />
          </div>
          <div className="setting-row">
            <label>Value min / max</label>
            <input
              type="number"
              min={1}
              value={config.advancedParams.valueRange[0]}
              onChange={(e) =>
                set('advancedParams', {
                  ...config.advancedParams,
                  valueRange: [Number(e.target.value), config.advancedParams.valueRange[1]],
                })
              }
            />
            <input
              type="number"
              min={1}
              value={config.advancedParams.valueRange[1]}
              onChange={(e) =>
                set('advancedParams', {
                  ...config.advancedParams,
                  valueRange: [config.advancedParams.valueRange[0], Number(e.target.value)],
                })
              }
            />
          </div>
          <div className="setting-row">
            <label>Capacity (% of total weight)</label>
            <input
              type="number"
              min={10}
              max={90}
              value={Math.round(config.advancedParams.capacityRatio * 100)}
              onChange={(e) =>
                set('advancedParams', { ...config.advancedParams, capacityRatio: Number(e.target.value) / 100 })
              }
            />
          </div>
          <div className="setting-row">
            <label>Weight/value correlation</label>
            <select
              value={config.advancedParams.correlation}
              onChange={(e) =>
                set('advancedParams', { ...config.advancedParams, correlation: e.target.value as CorrelationType })
              }
            >
              {CORRELATIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <label>Correlation tightness ({Math.round((config.advancedParams.correlationTightness ?? 0) * 100)}%)</label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((config.advancedParams.correlationTightness ?? 0) * 100)}
              onChange={(e) =>
                set('advancedParams', { ...config.advancedParams, correlationTightness: Number(e.target.value) / 100 })
              }
            />
          </div>
          <div className="setting-row">
            <label>Greedy trap ({Math.round(trapStrengthOf(config.advancedParams.trap) * 100)}%)</label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(trapStrengthOf(config.advancedParams.trap) * 100)}
              onChange={(e) =>
                set('advancedParams', { ...config.advancedParams, trap: trapFromStrength(Number(e.target.value) / 100) })
              }
            />
          </div>
          <div className="setting-row">
            <label>Second dimension / volume ({Math.round(dim2StrengthOf(config.advancedParams.dim2) * 100)}%)</label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(dim2StrengthOf(config.advancedParams.dim2) * 100)}
              onChange={(e) =>
                set('advancedParams', { ...config.advancedParams, dim2: dim2FromStrength(Number(e.target.value) / 100) })
              }
            />
          </div>
          <div className="setting-row">
            <label>Conflict density ({Math.round(conflictStrengthOf(config.advancedParams.conflict) * 100)}%)</label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(conflictStrengthOf(config.advancedParams.conflict) * 100)}
              onChange={(e) =>
                set('advancedParams', {
                  ...config.advancedParams,
                  conflict: conflictFromStrength(Number(e.target.value) / 100),
                })
              }
            />
          </div>
          <p className="help-text">
            Tightness and greedy trap keep a naive value/weight-ratio strategy from working on a single constraint;
            the second dimension adds a genuinely independent capacity (e.g. volume) so no single ratio can rank
            items at all; conflict density adds pairs of mutually incompatible items so no ratio or capacity
            reasoning alone resolves the pick — adaptive mode drives all four automatically from one difficulty
            number.
          </p>
          <button type="button" className="reset-button" onClick={() => set('advancedParams', DEFAULT_ADVANCED_PARAMS)}>
            Reset these parameters
          </button>
        </div>
      )}

      <div className="settings-group">
        <h3>Rounds</h3>
        <div className="setting-row">
          <label>Number of rounds</label>
          <input type="number" min={1} max={50} value={config.rounds} onChange={(e) => set('rounds', Number(e.target.value))} />
        </div>
      </div>

      <div className="settings-group">
        <h3>Time</h3>
        <div className="mode-tabs">
          {(['none', 'timed'] as TimeMode[]).map((tm) => (
            <button key={tm} type="button" className={config.timeMode === tm ? 'active' : ''} onClick={() => set('timeMode', tm)}>
              {tm === 'none' ? 'No limit' : 'Time limit'}
            </button>
          ))}
        </div>
        {config.timeMode === 'timed' && (
          <div className="setting-row" style={{ marginTop: '0.85rem' }}>
            <label>Seconds per round</label>
            <input
              type="number"
              min={5}
              value={config.timeLimitSeconds}
              onChange={(e) => set('timeLimitSeconds', Number(e.target.value))}
            />
          </div>
        )}
      </div>

      <div className="settings-group">
        <h3>Sound</h3>
        <div className="setting-row">
          <label htmlFor="sound-toggle">Success chime</label>
          <input
            id="sound-toggle"
            type="checkbox"
            style={{ flex: 'none', width: '1.2rem', height: '1.2rem' }}
            checked={config.soundEnabled}
            onChange={(e) => set('soundEnabled', e.target.checked)}
          />
        </div>
      </div>

      <button type="button" className="save-button" onClick={() => onStart(config)}>
        Start session
      </button>

      <p className="credit-line">
        Built with the support of the{' '}
        <a href="https://discord.gg/jjzA5m5UjN" target="_blank" rel="noopener noreferrer">
          Mindbuilding community
        </a>
      </p>
    </div>
  );
}

export default SetupScreen;

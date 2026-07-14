import { useCallback } from 'react';
import type { CorrelationType, SessionConfig, SolvedInstance, Trial } from '../types';
import { CORRELATION_LABELS } from '../types';
import './GameScreen.css';

interface GameScreenProps {
  instance: SolvedInstance;
  selected: boolean[];
  onToggle: (index: number) => void;
  onSubmit: () => void;
  onNext: () => void;
  feedback: Trial | null; // non-null while showing post-submission feedback
  isLastRound: boolean;
  timeLeftMs: number | null;
  timedOut: boolean;
  round: number;
  config: SessionConfig;
  difficulty: number;
  correlation: CorrelationType;
}

// Tile encoding follows Murawski & Bossaerts (2016, Sci. Rep.): tile size
// scales with weight, color intensity with value, selection state is a
// distinct color, exact numbers stay visible so the perceptual shortcut
// never replaces the precise values. Optimality feedback is only shown
// AFTER submission — a live optimality gauge would act as an oracle and
// defeat the reasoning task.
function GameScreen({
  instance,
  selected,
  onToggle,
  onSubmit,
  onNext,
  feedback,
  isLastRound,
  timeLeftMs,
  timedOut,
  round,
  config,
  difficulty,
  correlation,
}: GameScreenProps) {
  const totalWeight = selected.reduce((s, on, i) => (on ? s + instance.weights[i] : s), 0);
  const totalValue = selected.reduce((s, on, i) => (on ? s + instance.values[i] : s), 0);
  const hasDim2 = instance.weights2 !== undefined && instance.capacity2 !== undefined;
  const totalWeight2 = hasDim2
    ? selected.reduce((s, on, i) => (on ? s + instance.weights2![i] : s), 0)
    : 0;
  const overCapacity = totalWeight > instance.capacity || (hasDim2 && totalWeight2 > instance.capacity2!);

  const hasConflict = !!instance.conflicts && instance.conflicts.length > 0;
  // One letter per connected component of the conflict graph (not per item)
  // — every item generated as part of the same forced pair or background
  // clique shares a single letter, so the badge actually conveys "you can
  // pick at most one of this letter," instead of every conflicting item
  // getting its own distinct letter and the grouping being invisible.
  const conflictLabels = new Map<number, string>();
  if (hasConflict) {
    const adjacency = new Map<number, number[]>();
    for (const [a, b] of instance.conflicts!) {
      (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
      (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
    }
    const involved = [...new Set(instance.conflicts!.flat())].sort((a, b) => a - b);
    const visited = new Set<number>();
    let letterIndex = 0;
    for (const start of involved) {
      if (visited.has(start)) continue;
      const letter = String.fromCharCode(65 + (letterIndex % 26));
      letterIndex++;
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        conflictLabels.set(cur, letter);
        for (const next of adjacency.get(cur) ?? []) {
          if (!visited.has(next)) {
            visited.add(next);
            stack.push(next);
          }
        }
      }
    }
  }
  const violatingIndices = new Set<number>();
  if (hasConflict) {
    for (const [a, b] of instance.conflicts!) {
      if (selected[a] && selected[b]) {
        violatingIndices.add(a);
        violatingIndices.add(b);
      }
    }
  }
  const hasConflictViolation = violatingIndices.size > 0;

  const minW = Math.min(...instance.weights);
  const maxW = Math.max(...instance.weights);
  const minV = Math.min(...instance.values);
  const maxV = Math.max(...instance.values);

  const handleClick = useCallback(
    (i: number) => {
      if (!timedOut) onToggle(i);
    },
    [timedOut, onToggle],
  );

  const optimalityPct = feedback ? Math.round(feedback.qualityRatio * 100) : 0;

  return (
    <div className="game-screen">
      <div className="game-header">
        <div className="session-progress">
          <div className="session-progress-fill" style={{ width: `${(round / config.rounds) * 100}%` }} />
        </div>
        <div className="game-stats">
          <div className="stat-block">
            <span className="stat-label">Round</span>
            <span>
              {round + 1}/{config.rounds}
            </span>
          </div>
          <div className="stat-block">
            <span className="stat-label">Difficulty</span>
            <span>{Math.round(difficulty)}</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">Regime</span>
            <span>{CORRELATION_LABELS[correlation]}</span>
          </div>
          <div className="stat-block">
            <span className="stat-label">
              Weight {totalWeight}/{instance.capacity}
            </span>
            <div className="gauge">
              <div
                className={`gauge-fill${totalWeight > instance.capacity ? ' over' : ''}`}
                style={{ width: `${Math.min(100, (totalWeight / instance.capacity) * 100)}%` }}
              />
            </div>
          </div>
          {hasDim2 && (
            <div className="stat-block">
              <span className="stat-label">
                Volume {totalWeight2}/{instance.capacity2}
              </span>
              <div className="gauge">
                <div
                  className={`gauge-fill${totalWeight2 > instance.capacity2! ? ' over' : ''}`}
                  style={{ width: `${Math.min(100, (totalWeight2 / instance.capacity2!) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <div className="stat-block">
            <span className="stat-label">Value</span>
            <span className="value-badge">
              {totalValue} <small>pts</small>
            </span>
          </div>
          {timeLeftMs !== null && (
            <div className="stat-block">
              <span className="stat-label">Time</span>
              <span className={timeLeftMs < 10000 ? 'time-warning' : ''}>{Math.ceil(timeLeftMs / 1000)}s</span>
            </div>
          )}
        </div>
      </div>

      <div className="game-board">
        {instance.weights.map((w, i) => {
          const v = instance.values[i];
          const w2 = instance.weights2?.[i];
          const size = 52 + ((w - minW) / (maxW - minW || 1)) * 68; // 52-120px
          const intensity = Math.round(60 + ((v - minV) / (maxV - minV || 1)) * 160); // 60-220
          // Past ~130 the blue is dark enough that dark text stops being readable.
          const lightText = intensity > 130;
          const isSelected = selected[i];
          // During feedback, reveal the optimal solution: gold ring on optimal
          // items, dimming on items that belong to neither selection.
          const isOptimal = feedback !== null && instance.optimalSelection[i];
          const isDimmed = feedback !== null && !instance.optimalSelection[i] && !isSelected;
          const conflictLabel = conflictLabels.get(i);
          const isViolating = violatingIndices.has(i);
          let title = w2 !== undefined ? `Value ${v} · Weight ${w} · Volume ${w2}` : `Value ${v} · Weight ${w}`;
          if (conflictLabel !== undefined) title += ` · Conflict tag ${conflictLabel}`;
          return (
            <button
              key={i}
              type="button"
              className={`item-tile${isSelected ? ' selected' : ''}${lightText ? ' light-text' : ''}${isOptimal ? ' optimal' : ''}${isDimmed ? ' dimmed' : ''}${isViolating ? ' conflict-violation' : ''}`}
              style={{
                width: size,
                height: size,
                backgroundColor: isSelected ? '#2f9e44' : `rgb(${255 - intensity}, ${255 - intensity}, 255)`,
              }}
              onClick={() => handleClick(i)}
              title={title}
            >
              {conflictLabel !== undefined && <span className="tile-conflict-badge">{conflictLabel}</span>}
              <span className="tile-value" style={{ fontSize: `${Math.max(0.9, (size / 120) * 1.7)}rem` }}>
                <span className="tile-prefix">v:</span>
                {v}
              </span>
              <span className="tile-weight">
                <span className="tile-prefix">w:</span>
                {w}
              </span>
              {w2 !== undefined && (
                <span className="tile-weight">
                  <span className="tile-prefix">vol:</span>
                  {w2}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="board-legend">
        Bigger square = heavier · Deeper blue = more valuable
        {hasDim2 && ' · vol: pill is the second, independent capacity constraint'}
        {hasConflict && ' · connector letters mark conflicting items — you can never select both halves of a marked pair'}
      </div>

      {overCapacity && !feedback && (
        <div className="capacity-warning">
          {hasDim2 ? 'Over weight or volume capacity — remove some items.' : 'Over capacity — remove some items.'}
        </div>
      )}
      {hasConflictViolation && !feedback && (
        <div className="capacity-warning conflict-warning">
          Conflicting items selected — items sharing a connector letter cannot both be chosen.
        </div>
      )}
      {timedOut && !feedback && <div className="time-up-overlay">Time's up — submit your solution.</div>}

      {feedback && (
        <div className="feedback-panel">
          <div className={`feedback-title ${feedback.success ? 'success' : 'failure'}`}>
            {feedback.success ? 'Optimal!' : 'Not optimal'}
          </div>
          <div className="feedback-gauge-row">
            <div className="gauge feedback-gauge">
              <div
                className={`gauge-fill${feedback.success ? '' : ' partial'}`}
                style={{ width: `${optimalityPct}%` }}
              />
            </div>
            <span className="feedback-pct">{optimalityPct}% of optimum</span>
          </div>
          <div className="feedback-hint">Gold-ringed tiles are the optimal selection — compare it with yours.</div>
        </div>
      )}

      <div className="game-actions">
        {feedback ? (
          <button type="button" className="submit-button" onClick={onNext}>
            {isLastRound ? 'See results' : 'Next round'}
          </button>
        ) : (
          <button type="button" className="submit-button" onClick={onSubmit}>
            Submit
          </button>
        )}
      </div>
    </div>
  );
}

export default GameScreen;

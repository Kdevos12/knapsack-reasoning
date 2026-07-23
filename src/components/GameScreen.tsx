import { useCallback } from 'react';
import type { CorrelationType, SessionConfig, SolvedInstance, Trial } from '../types';
import { CORRELATION_LABELS } from '../types';
import './GameScreen.css';

interface GameScreenProps {
  instance: SolvedInstance;
  selected: boolean[];
  onToggle: (index: number) => void;
  onUndo: () => void;
  canUndo: boolean;
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
  // Sub-optimal warning state: shown once before recording a non-optimal trial.
  pendingWarning: boolean;
  onWarningConfirm: () => void;
  onWarningDismiss: () => void;
  // Which special mechanism this round used (for pedagogical hints)
  mechanism: 'none' | 'trap' | 'dim2' | 'conflict';
}

// Tile encoding follows Murawski & Bossaerts (2016, Sci. Rep.): tile size
// scales with weight (or volume in dim2 rounds), color intensity with value,
// selection state is conveyed via border + checkmark so the blue hue that
// encodes value stays visible, exact numbers stay visible so the perceptual
// shortcut never replaces the precise values. Optimality feedback is only shown
// AFTER submission — a live optimality gauge would act as an oracle and
// defeat the reasoning task.
function GameScreen({
  instance,
  selected,
  onToggle,
  onUndo,
  canUndo,
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
  pendingWarning,
  onWarningConfirm,
  onWarningDismiss,
  mechanism,
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

  const minV = Math.min(...instance.values);
  const maxV = Math.max(...instance.values);

  // In dim2 rounds, tile size encodes volume (weight2) — bigger = more volume.
  // In all other rounds, tile size encodes weight as before.
  const sizeWeights = hasDim2 ? instance.weights2! : instance.weights;
  const minSW = Math.min(...sizeWeights);
  const maxSW = Math.max(...sizeWeights);

  const handleClick = useCallback(
    (i: number) => {
      if (!timedOut) onToggle(i);
    },
    [timedOut, onToggle],
  );

  // Right-click on a selected tile deselects it; no browser context menu.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, i: number) => {
      e.preventDefault();
      if (!timedOut && selected[i]) onToggle(i);
    },
    [timedOut, selected, onToggle],
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

      {/* Feedback panel — placed ABOVE the board so it's front-and-center */}
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
          {/* Pedagogical hint for trap rounds: explain greedy-decoy failure when
              the player found a high-quality ratio but did not reach the exact
              optimum. Keeps tone neutral and non-judgmental. */}
          {mechanism === 'trap' && feedback && !feedback.exactOptimal && feedback.qualityRatio >= 0.9 && (
            <div className="feedback-pedagogy">
              You chose a high-ratio item, but a different combination yields a
              higher total — this is the greedy "decoy" trap: the locally best
              item prevents a better pair from fitting. Try looking for pairs
              that together beat the single high-ratio item.
            </div>
          )}
        </div>
      )}

      {/* Sub-optimal warning: shown once before committing a non-optimal trial */}
      {pendingWarning && !feedback && (
        <div className="warning-panel">
          <div className="warning-title">⚠ Your solution may be improvable</div>
          <div className="warning-body">
            Take another look — you might find a better combination. Or submit as-is if you're confident.
          </div>
          <div className="warning-actions">
            <button type="button" className="warning-back-button" onClick={onWarningDismiss}>
              ← Keep editing
            </button>
            <button type="button" className="warning-confirm-button" onClick={onWarningConfirm}>
              Submit anyway
            </button>
          </div>
        </div>
      )}

      {overCapacity && !feedback && !pendingWarning && (
        <div className="capacity-warning">
          {hasDim2 ? 'Over weight or volume capacity — remove some items.' : 'Over capacity — remove some items.'}
        </div>
      )}
      {hasConflictViolation && !feedback && !pendingWarning && (
        <div className="capacity-warning conflict-warning">
          Conflicting items selected — items sharing a connector letter cannot both be chosen.
        </div>
      )}
      {timedOut && !feedback && <div className="time-up-overlay">Time's up — submit your solution.</div>}

      <div className="game-board">
        {instance.weights.map((w, i) => {
          const v = instance.values[i];
          const w2 = instance.weights2?.[i];
          // Size encodes volume (w2) in dim2 rounds, weight otherwise.
          const sw = sizeWeights[i];
          const size = 52 + ((sw - minSW) / (maxSW - minSW || 1)) * 68; // 52-120px
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
                // Keep the blue even when selected — selection is shown via border + checkmark.
                backgroundColor: `rgb(${255 - intensity}, ${255 - intensity}, 255)`,
              }}
              onClick={() => handleClick(i)}
              onContextMenu={(e) => handleContextMenu(e, i)}
              title={title}
            >
              {isSelected && <span className="tile-selected-mark">✓</span>}
              {conflictLabel !== undefined && <span className="tile-conflict-badge">{conflictLabel}</span>}
              <span className="tile-value" style={{ fontSize: `${Math.max(0.9, (size / 120) * 1.7)}rem` }}>
                <span className="tile-icon">★</span>
                {v}
              </span>
              <span className="tile-weight">
                <span className="tile-icon">⚖</span>
                {w}
              </span>
              {w2 !== undefined && (
                <span className="tile-weight">
                  <span className="tile-icon">📦</span>
                  {w2}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="board-legend">
        {hasDim2
          ? 'Bigger square = more volume · Deeper blue = more valuable · ⚖ weight · 📦 volume'
          : 'Bigger square = heavier · Deeper blue = more valuable'}
        {hasConflict && ' · connector letters mark conflicting items — you can never select both halves of a marked pair'}
      </div>

      <div className="game-actions">
        {feedback ? (
          <button type="button" className="submit-button" onClick={onNext}>
            {isLastRound ? 'See results' : 'Next round'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="undo-button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo last action (Ctrl+Z)"
            >
              ↩ Undo
            </button>
            <button type="button" className="submit-button" onClick={onSubmit} disabled={!!pendingWarning}>
              Submit
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default GameScreen;

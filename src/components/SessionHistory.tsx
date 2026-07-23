import type { CorrelationType, Trial } from '../types';
import { CORRELATION_LABELS } from '../types';
import './SessionHistory.css';

interface SessionHistoryProps {
  trials: Trial[];
  onNewSession: () => void;
}

const ALL_CORRELATIONS = Object.keys(CORRELATION_LABELS) as CorrelationType[];

function SessionHistory({ trials, onNewSession }: SessionHistoryProps) {
  const total = trials.length;
  const successCount = trials.filter((t) => t.success).length;
  const successRate = total > 0 ? (successCount / total) * 100 : 0;
  const avgQuality = total > 0 ? (trials.reduce((s, t) => s + t.qualityRatio, 0) / total) * 100 : 0;
  const finalDifficulty = trials.length > 0 ? trials[trials.length - 1].difficulty : 0;
  const correlationCounts = ALL_CORRELATIONS.map((c) => ({
    type: c,
    count: trials.filter((t) => t.correlation === c).length,
  })).filter((c) => c.count > 0);

  return (
    <div className="session-history">
      <h2>Session results</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Rounds played</h3>
          <div className="stat-value">{total}</div>
        </div>
        <div className="stat-card">
          <h3>Success rate</h3>
          <div className="stat-value">{successRate.toFixed(0)}%</div>
        </div>
        <div className="stat-card">
          <h3>Average optimality</h3>
          <div className="stat-value">{avgQuality.toFixed(0)}%</div>
        </div>
        <div className="stat-card">
          <h3>Final difficulty</h3>
          <div className="stat-value">{Math.round(finalDifficulty)}</div>
        </div>
      </div>

      {correlationCounts.length > 0 && (
        <div className="trial-list">
          <h3>Heuristic mix</h3>
          <p className="help-text">
            How many rounds pulled from each weight/value regime — the tool's premise is that switching between
            these (not just raw difficulty) is what forces you off a single static strategy.
          </p>
          <table>
            <thead>
              <tr>
                <th>Regime</th>
                <th>Rounds</th>
              </tr>
            </thead>
            <tbody>
              {correlationCounts.map(({ type, count }) => (
                <tr key={type}>
                  <td>{CORRELATION_LABELS[type]}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="trial-list">
        <h3>Round details</h3>
        {total === 0 ? (
          <p>No rounds recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Difficulty</th>
                <th>Regime</th>
                <th>Result</th>
                <th>Optimality</th>
                <th>Time</th>
              </tr>
            </thead>
              <tbody>
                {trials.map((t, i) => (
                  <tr key={i} className={t.exactOptimal ? 'success' : 'failure'}>
                    <td>{t.round + 1}</td>
                    <td>{Math.round(t.difficulty)}</td>
                    <td>{CORRELATION_LABELS[t.correlation]}</td>
                    <td>{t.exactOptimal ? 'Optimal' : 'Sub-optimal'}</td>
                    <td>{(t.qualityRatio * 100).toFixed(0)}%</td>
                    <td>{(t.timeUsedMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
          </table>
        )}
      </div>

      <button type="button" className="reset-button" onClick={onNewSession}>
        New session
      </button>
    </div>
  );
}

export default SessionHistory;

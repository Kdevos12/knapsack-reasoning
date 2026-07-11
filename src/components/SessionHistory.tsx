import type { SessionConfig, Trial } from '../types';
import './SessionHistory.css';

interface SessionHistoryProps {
  trials: Trial[];
  config: SessionConfig;
  onNewSession: () => void;
}

function SessionHistory({ trials, config, onNewSession }: SessionHistoryProps) {
  const total = trials.length;
  const successCount = trials.filter((t) => t.success).length;
  const successRate = total > 0 ? (successCount / total) * 100 : 0;
  const avgQuality = total > 0 ? (trials.reduce((s, t) => s + t.qualityRatio, 0) / total) * 100 : 0;
  const finalDifficulty = trials.length > 0 ? trials[trials.length - 1].difficulty : config.trainingDifficulty;

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
                <th>Result</th>
                <th>Optimality</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {trials.map((t, i) => (
                <tr key={i} className={t.success ? 'success' : 'failure'}>
                  <td>{t.round + 1}</td>
                  <td>{Math.round(t.difficulty)}</td>
                  <td>{t.success ? 'Optimal' : 'Sub-optimal'}</td>
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

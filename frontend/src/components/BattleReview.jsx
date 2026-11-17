import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getBattleAnalysis } from '../services/battleService';
import { getSocket } from '../services/socket';
import './BattleReview.css';

const CATEGORY = {
  edge_case: 'Edge case', logic: 'Logic', complexity: 'Complexity', implementation: 'Implementation', time_management: 'Time management',
};
const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** Post-battle review: what happened, what went wrong, and what to practise. */
export default function BattleReview({ battleId }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const res = await getBattleAnalysis(battleId);
      setState({ status: 'ready', data: res.data.data, error: '' });
    } catch (err) {
      setState({ status: 'error', data: null, error: err.response?.data?.message || err.message });
    }
  }, [battleId]);

  useEffect(() => {
    load();
    const socket = getSocket();
    const onReady = (d) => { if (d.battleId === battleId) load(); };
    socket?.on('analysis_ready', onReady);
    return () => socket?.off('analysis_ready', onReady);
  }, [battleId, load]);

  if (state.status === 'loading') return <div className="review review--muted" role="status">Analysing your battle…</div>;
  if (state.status === 'error') {
    return <div className="review review--muted">Review unavailable: {state.error} <button className="review__link" onClick={load}>Retry</button></div>;
  }

  const { analysis, metrics, source } = state.data;
  return (
    <section className="review" aria-label="Battle review">
      <header className="review__head">
        <h3>Battle review</h3>
        <span className={`review__badge review__badge--${source}`}>{source === 'llm' ? 'AI coach' : 'Rule-based coach'}</span>
      </header>
      <p className="review__summary">{analysis.summary}</p>

      <div className="review__stats">
        <div><b>{mmss(metrics.timing.firstKeystrokeSec)}</b><span>first editor sync</span></div>
        <div><b>{mmss(metrics.timing.firstRunSec)}</b><span>first sample run</span></div>
        <div><b>{metrics.submissions.count}</b><span>submissions</span></div>
        <div><b>{Math.round(metrics.submissions.bestPassRatio * 100)}%</b><span>best tests passed</span></div>
      </div>

      {analysis.mistakes.length > 0 && (
        <div className="review__block">
          <h4>What went wrong</h4>
          <ul>{analysis.mistakes.map((m, i) => (
            <li key={i}><span className="review__chip">{CATEGORY[m.category] || m.category}</span>{m.what}</li>
          ))}</ul>
        </div>
      )}
      {analysis.behaviour_insights.length > 0 && (
        <div className="review__block"><h4>Your habits</h4><ul>{analysis.behaviour_insights.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
      )}
      {analysis.strengths.length > 0 && (
        <div className="review__block review__block--good"><h4>What you did well</h4><ul>{analysis.strengths.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
      )}
      {analysis.improvements.length > 0 && (
        <div className="review__block"><h4>Do this next time</h4><ul>{analysis.improvements.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
      )}
      {analysis.recommended_practice.length > 0 && (
        <div className="review__block">
          <h4>Practise</h4>
          <ul>{analysis.recommended_practice.map((p, i) => (
            <li key={i}><Link className="review__chip review__chip--link" to={`/problems?tag=${encodeURIComponent(p.tag)}`}>{p.tag}</Link>{p.why}</li>
          ))}</ul>
        </div>
      )}
    </section>
  );
}

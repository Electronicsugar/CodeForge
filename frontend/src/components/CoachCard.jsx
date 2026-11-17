import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyCoach } from '../services/coachService';
import './CoachCard.css';

const HABIT = {
  submits_without_running_samples: 'Submits without running samples',
  frequent_compile_errors: 'Frequent compile errors',
  too_slow_solutions: 'Solutions too slow',
  missed_edge_cases: 'Missed edge cases',
  long_stalls: 'Long stalls',
  integrity_warnings: 'Integrity warnings',
};

/** Long-term coach on the profile page: patterns across your last battles + practice. */
export default function CoachCard() {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = async (refresh = false) => {
    setState((s) => ({ ...s, loading: true }));
    try { const res = await getMyCoach(refresh); setState({ loading: false, data: res.data.data, error: '' }); }
    catch (err) { setState({ loading: false, data: null, error: err.response?.data?.message || err.message }); }
  };
  useEffect(() => { load(); }, []);

  if (state.loading && !state.data) return <section className="coach"><p className="coach__muted">Loading your coach…</p></section>;
  if (state.error) return <section className="coach"><p className="coach__muted">Coach unavailable: {state.error}</p></section>;

  const { stats, narrative, source, aiEnabled } = state.data;
  return (
    <section className="coach" aria-label="Your coach">
      <header className="coach__head">
        <h3>Your coach</h3>
        <span className="coach__badge">{source === 'llm' ? 'AI-written' : aiEnabled ? 'Rule-based' : 'Rule-based (AI not configured)'}</span>
      </header>
      <p className="coach__headline">{narrative?.headline}</p>

      {stats.battles > 0 && (
        <div className="coach__stats">
          <div><b>{stats.winRate}%</b><span>win rate ({stats.battles} battles)</span></div>
          <div><b>{stats.avgSubmissionsPerBattle ?? '—'}</b><span>submissions / battle</span></div>
          <div><b>{stats.avgFirstRunSec != null ? `${stats.avgFirstRunSec}s` : '—'}</b><span>avg first sample run</span></div>
        </div>
      )}
      {stats.habits.length > 0 && (
        <div className="coach__tags">{stats.habits.map((h) => <span key={h.habit} className="coach__tag" title={h.evidence}>{HABIT[h.habit] || h.habit}</span>)}</div>
      )}
      {narrative?.focus?.length > 0 && <><h4>Focus next</h4><ul>{narrative.focus.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
      {narrative?.strengths?.length > 0 && <><h4 className="coach__good">Strengths</h4><ul>{narrative.strengths.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
      {stats.weakTags.length > 0 && (
        <p className="coach__practice">Practise: {stats.weakTags.map((t) => <Link key={t.tag} to={`/problems?tag=${encodeURIComponent(t.tag)}`} title={t.evidence}>{t.tag}</Link>)}</p>
      )}
    </section>
  );
}

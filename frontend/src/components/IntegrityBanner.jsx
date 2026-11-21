import { useEffect } from 'react';
import './IntegrityBanner.css';

/** Warning banner + always-visible monitoring notice. `mode` is "battle" or "contest". */
export default function IntegrityBanner({ warning, strikes = 0, maxStrikes = 0, mode = 'battle', active = true, forfeitText = 'you forfeit this battle', onDismiss }) {
  useEffect(() => {
    if (!warning) return undefined;
    const t = setTimeout(() => onDismiss?.(), 9000);
    return () => clearTimeout(t);
  }, [warning, onDismiss]);

  const last = mode === 'battle' && maxStrikes > 0 && strikes >= maxStrikes - 1;
  return (
    <div className="integrity">
      <div className="integrity__status" title="Leaving the tab, large pastes and code appearing without typing are recorded.">
        <span className="integrity__dot" /> {active?'Integrity monitoring on':'Integrity rules'}
        {mode === 'battle' && maxStrikes > 0 && <span className="integrity__count"> · warnings {strikes}/{maxStrikes}</span>}
        {mode === 'contest' && <span className="integrity__count"> · recorded for organisers</span>}
      </div>
      {warning && (
        <div className={`integrity__banner ${last ? 'integrity__banner--danger' : ''}`} role="alert">
          <strong>{warning.message}</strong>
          {mode === 'battle' && maxStrikes > 0 && (
            <span> Warning {warning.strikes} of {maxStrikes}{warning.strikes>=maxStrikes?' — strike limit reached.':last?` — one more and ${forfeitText}.`:'.'}</span>
          )}
          {mode === 'contest' && <span> This has been recorded.</span>}
          <button type="button" className="integrity__close" onClick={onDismiss} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}

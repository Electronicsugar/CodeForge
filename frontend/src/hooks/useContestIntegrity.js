import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';
import { attachIntegrityListeners } from '../services/integrity';

/** Anti-cheat for contests: events are recorded for organisers; nobody is disqualified automatically. */
export function useContestIntegrity({ contestId, problemId, enabled, scopeRef }) {
  const [notice, setNotice] = useState(null);
  const listeners = useRef(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!contestId) return undefined;
    const send = async (type, meta) => {
      try {
        const res = await api.post(`/contests/${contestId}/integrity`, { type, meta, problemId });
        const warning = res.data?.data?.warning;
        if (warning) setNotice({ message: warning, strikes: res.data.data.strikes, at: Date.now() });
      } catch { /* reporting must never disturb the contest */ }
    };
    listeners.current = attachIntegrityListeners({ send, scope: () => scopeRef?.current || null, enabled: () => enabledRef.current });
    return () => { listeners.current?.dispose(); listeners.current = null; };
  }, [contestId, problemId, scopeRef]);

  const noteChange = useCallback((prev, next, inputType) => listeners.current?.noteChange(prev, next, inputType), []);
  return { notice, noteChange, dismiss: () => setNotice(null) };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '../services/socket';
import { attachIntegrityListeners } from '../services/integrity';

/**
 * Anti-cheat for a live 1v1 battle: reports signals over the socket and surfaces the
 * server's warnings. `scopeRef` limits paste/context-menu reports to the editor area.
 */
export function useBattleIntegrity({ battleId, enabled, scopeRef }) {
  const [warning, setWarning] = useState(null);       // { message, strikes, maxStrikes, action }
  const [strikes, setStrikes] = useState(0);
  const [maxStrikes, setMaxStrikes] = useState(0);
  const [opponentAway, setOpponentAway] = useState(false);
  const listeners = useRef(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!battleId) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const send = (type, meta) => {
      if (socket.connected) socket.emit('integrity_event', { battleId, type, meta });
    };
    listeners.current = attachIntegrityListeners({ send, scope: () => scopeRef?.current || null, enabled: () => enabledRef.current });

    const onWarning = (data) => {
      if (data.battleId !== battleId) return;
      setStrikes(data.strikes); setMaxStrikes(data.maxStrikes);
      setWarning({ ...data, at: Date.now() });
    };
    const onPresence = (data) => { if (data.battleId === battleId) setOpponentAway(Boolean(data.away)); };
    socket.on('integrity_warning', onWarning);
    socket.on('opponent_presence', onPresence);

    return () => {
      listeners.current?.dispose(); listeners.current = null;
      socket.off('integrity_warning', onWarning);
      socket.off('opponent_presence', onPresence);
    };
  }, [battleId, scopeRef]);

  const noteChange = useCallback((prev, next, inputType) => listeners.current?.noteChange(prev, next, inputType), []);
  const dismiss = useCallback(() => setWarning(null), []);
  return { warning, strikes, maxStrikes, opponentAway, noteChange, dismiss };
}
